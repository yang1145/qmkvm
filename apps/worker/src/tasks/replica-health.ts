/**
 * 复制健康探测：每 5 分钟（UTC）。
 * 三节点主备形态下，备库/从库是生产关键路径，其复制状态必须可见（否则静默掉队，
 * 故障转移时才发现数据落后）。检查项：SHOW REPLICA STATUS 的 IO/SQL 线程是否为
 * Yes、Seconds_Behind 是否超阈值（REPLICA_LAG_ALERT_SECONDS，缺省 60s）。
 *
 * 探测目标：
 * - 只读从库：DATABASE_URL_RO（未配置则整体跳过——单库形态无需本任务）
 * - 备库：DATABASE_URL_STANDBY（可选）
 *
 * 告警去重：状态由"健康→异常"转变时推送 ALERT_WEBHOOK_URL（钉钉/飞书格式）；
 * 连续异常只记录不重复推送（查 job_runs 前一次运行结果判定），恢复时不推送。
 * 探测账号权限：REPLICATION CLIENT（SHOW REPLICA STATUS 所需，见 deployment.md §6.2）。
 */
import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { createDb, schema, type Db } from "@qmkvm/db";
import { logger } from "@qmkvm/logger";
import { workerEnv } from "../env.js";
import { postAlert } from "../alert.js";
import type { TaskDef } from "./framework.js";

const log = logger.child({ module: "worker:replica-health" });

const TASK_NAME = "system.replica_health";

interface ReplicaStatus {
  /** 目标名：readonly（只读从库）/ standby（备库） */
  name: string;
  /** 探测连接可达 */
  reachable: boolean;
  /** IO 线程（Yes/No/Connecting），不可达时 null */
  ioRunning: string | null;
  /** SQL 线程（Yes/No），不可达时 null */
  sqlRunning: string | null;
  /** 复制延迟秒数（SQL 线程非 Yes 时为 null） */
  secondsBehind: number | null;
  lastError: string | null;
}

export interface ReplicaHealthResult {
  checked: number;
  skipped?: string;
  targets: ReplicaStatus[];
  /** 存在异常项（本次新检出或延续） */
  alertNeeded: boolean;
  /** 本次是否实际推送（仅"健康→异常"转变时为 true） */
  alertSent: boolean;
}

/** 探测连接按 URL 缓存（进程级；探测为单查询，连接池按需建连） */
const probeDbs = new Map<string, Db>();

function probeDb(url: string): Db {
  let db = probeDbs.get(url);
  if (!db) {
    db = createDb(url);
    probeDbs.set(url, db);
  }
  return db;
}

/** SHOW REPLICA STATUS 结果行（8.0.22+/8.4 与旧版字段名二选一取值） */
function pickField(row: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const v = row[name];
    if (v !== undefined && v !== null) return String(v);
  }
  return null;
}

async function probe(name: string, url: string): Promise<ReplicaStatus> {
  const status: ReplicaStatus = {
    name,
    reachable: false,
    ioRunning: null,
    sqlRunning: null,
    secondsBehind: null,
    lastError: null,
  };
  try {
    const db = probeDb(url);
    const result = await db.execute(sql`SHOW REPLICA STATUS`);
    const rows = (Array.isArray(result) ? result[0] : null) as unknown;
    const row = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
    if (!row) {
      // 连接正常但本机不是 replica（未挂复制）——三节点形态下即为配置错误
      status.lastError = "本节点未配置复制（SHOW REPLICA STATUS 无结果行）";
      return status;
    }
    status.reachable = true;
    // 8.0.22+/8.4：Replica_IO_Running / Seconds_Behind_Source；旧版：Slave_*
    status.ioRunning = pickField(row, ["Replica_IO_Running", "Slave_IO_Running"]);
    status.sqlRunning = pickField(row, ["Replica_SQL_Running", "Slave_SQL_Running"]);
    const behind = pickField(row, ["Seconds_Behind_Source", "Seconds_Behind_Master"]);
    const n = behind === null ? NaN : Number(behind);
    status.secondsBehind = Number.isFinite(n) ? n : null;
    status.lastError =
      pickField(row, ["Last_IO_Error"]) ??
      pickField(row, ["Last_SQL_Error"]) ??
      null;
    if (status.lastError === "") status.lastError = null;
  } catch (err) {
    status.lastError = err instanceof Error ? err.message : String(err);
  }
  return status;
}

function statusIssue(s: ReplicaStatus): string | null {
  if (!s.reachable) return `${s.name}：探测失败（${s.lastError ?? "连接异常"}）`;
  if (s.ioRunning !== "Yes" || s.sqlRunning !== "Yes") {
    return `${s.name}：复制线程异常（IO=${s.ioRunning ?? "?"} SQL=${s.sqlRunning ?? "?"}）${s.lastError ? `：${s.lastError.slice(0, 200)}` : ""}`;
  }
  if (s.secondsBehind === null || s.secondsBehind > workerEnv.replicaLagAlertSeconds) {
    return `${s.name}：复制延迟 ${s.secondsBehind ?? "未知"}s（阈值 ${workerEnv.replicaLagAlertSeconds}s）`;
  }
  return null;
}

/** 上一次运行是否已处于告警状态（连续异常不重复推送） */
async function previousAlertNeeded(db: Db, now: Date): Promise<boolean> {
  // 框架在 run() 前已插入本次运行的 job_runs 行（result 为 NULL），
  // isNotNull(result) 把它排除——只看上一次"已完成"的运行
  const rows = await db
    .select({ result: schema.jobRuns.result })
    .from(schema.jobRuns)
    .where(
      and(
        eq(schema.jobRuns.taskName, TASK_NAME),
        lt(schema.jobRuns.startedAt, now),
        isNotNull(schema.jobRuns.result),
      ),
    )
    .orderBy(desc(schema.jobRuns.startedAt))
    .limit(1);
  const result = rows[0]?.result as unknown as { alertNeeded?: unknown } | null | undefined;
  return result?.alertNeeded === true;
}

async function run(db: Db, now: Date): Promise<ReplicaHealthResult> {
  const targets: Array<{ name: string; url: string | null }> = [
    { name: "readonly", url: process.env.DATABASE_URL_RO?.trim() || null },
    { name: "standby", url: workerEnv.standbyDbUrl },
  ];
  const configured = targets.filter((t): t is { name: string; url: string } => !!t.url);
  if (configured.length === 0) {
    return { checked: 0, skipped: "未配置 DATABASE_URL_RO，单库形态跳过复制探测", targets: [], alertNeeded: false, alertSent: false };
  }

  const statuses = await Promise.all(configured.map((t) => probe(t.name, t.url)));
  const issues = statuses.map(statusIssue).filter((s): s is string => !!s);
  const alertNeeded = issues.length > 0;

  let alertSent = false;
  if (alertNeeded && !(await previousAlertNeeded(db, now))) {
    const lines = [
      `【启明智联】复制健康告警`,
      ...issues,
      "",
      `处理参考：docs/deployment.md §6.2（延迟→观察追平；线程断开→SHOW REPLICA STATUS 排错）`,
    ];
    alertSent = await postAlert(lines.join("\n"));
    if (!alertSent) {
      log.warn({ issues }, "复制异常，但未配置 ALERT_WEBHOOK_URL 或发送失败");
    }
  }

  const result: ReplicaHealthResult = {
    checked: statuses.length,
    targets: statuses,
    alertNeeded,
    alertSent,
  };
  if (alertNeeded) {
    log.warn({ result }, "复制健康探测发现异常");
  }
  return result;
}

export const replicaHealthTask: TaskDef = {
  name: TASK_NAME,
  cron: "*/5 * * * *",
  description: "探测备/从库复制状态（线程+延迟），异常转变时推送钉钉/飞书告警",
  run,
};