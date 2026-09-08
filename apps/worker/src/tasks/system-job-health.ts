/**
 * 任务健康告警：每日 07:00（UTC）。
 * 汇总昨日（UTC 自然日）job_runs 的失败记录；有失败且配置了 ALERT_WEBHOOK_URL 时
 * 按钉钉机器人格式 POST 告警（text 消息，飞书兼容）。无失败不打扰。
 */
import { and, gte, lt } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db";
import { logger } from "@qmkvm/logger";
import { postAlert } from "../alert.js";
import type { TaskDef } from "./framework.js";

const log = logger.child({ module: "worker:job-health" });

interface HealthSummary {
  date: string;
  total: number;
  failed: number;
  partial: number;
  failedByTask: { task: string; count: number }[];
  errorSamples: string[];
  alertSent: boolean;
}

/** UTC 零点 */
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function run(db: Db, now: Date): Promise<HealthSummary> {
  const dayEnd = utcMidnight(now);
  const dayStart = new Date(dayEnd.getTime() - 86_400_000);
  const date = dayStart.toISOString().slice(0, 10);

  const rows = await db
    .select({
      taskName: schema.jobRuns.taskName,
      status: schema.jobRuns.status,
      error: schema.jobRuns.error,
    })
    .from(schema.jobRuns)
    .where(and(gte(schema.jobRuns.startedAt, dayStart), lt(schema.jobRuns.startedAt, dayEnd)));

  const counts = new Map<string, number>();
  const errorSamples: string[] = [];
  let partial = 0;
  for (const row of rows) {
    if (row.status === "failed") {
      counts.set(row.taskName, (counts.get(row.taskName) ?? 0) + 1);
      if (errorSamples.length < 5 && row.error) {
        errorSamples.push(`${row.taskName}: ${row.error.slice(0, 200)}`);
      }
    } else if (row.status === "partial") {
      partial += 1;
    }
  }

  const summary: HealthSummary = {
    date,
    total: rows.length,
    failed: [...counts.values()].reduce((sum, n) => sum + n, 0),
    partial,
    failedByTask: [...counts.entries()]
      .map(([task, count]) => ({ task, count }))
      .sort((a, b) => b.count - a.count),
    errorSamples,
    alertSent: false,
  };

  if (summary.failed > 0) {
    const lines = [
      `【启明智联】定时任务告警 ${date}`,
      `昨日共执行 ${summary.total} 次，失败 ${summary.failed} 次（partial ${summary.partial} 次）`,
      ...summary.failedByTask.map((t) => `- ${t.task}：失败 ${t.count} 次`),
      ...(errorSamples.length > 0 ? ["", "错误样例：", ...errorSamples.map((e) => `- ${e}`)] : []),
    ];
    summary.alertSent = await postAlert(lines.join("\n"));
    if (!summary.alertSent) {
      log.warn({ summary }, "昨日存在失败任务，但未配置 ALERT_WEBHOOK_URL 或发送失败");
    }
  }

  return summary;
}

export const systemJobHealthTask: TaskDef = {
  name: "system.job_health",
  cron: "0 7 * * *",
  description: "汇总昨日 job_runs 失败并推送钉钉/飞书告警",
  run,
};
