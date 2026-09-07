/**
 * worker 进程心跳：启动即 upsert worker_heartbeats，之后每 30s 刷新 last_seen_at。
 * admin 仪表盘"系统运行状态"按 last_seen_at 距今 < 90s 判定在线。
 * 心跳失败仅 log.warn 不抛（不影响消费主流程）；interval.unref() 不阻止进程退出。
 */
import os from "node:os";
import { createRequire } from "node:module";
import { getDb, schema } from "@qmkvm/db";
import { logger } from "@qmkvm/logger";

const log = logger.child({ module: "worker:heartbeat" });
type Db = ReturnType<typeof getDb>;

const INTERVAL_MS = 30_000;
/** package.json version（读一次缓存；ESM 下经 createRequire 读取） */
const VERSION = readVersion();

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * 启动心跳上报：立即 upsert 一条记录，之后 setInterval 30s 刷新 last_seen_at。
 * 返回 stop 函数（当前优雅退出未挂接，依赖 unref + 进程退出兜底）。
 */
export function startHeartbeat(db: Db, group: string, queues: string[]): void {
  const startedAt = new Date();

  const upsert = async (): Promise<void> => {
    try {
      await db
        .insert(schema.workerHeartbeats)
        .values({
          group,
          pid: process.pid,
          host: os.hostname().slice(0, 100),
          version: VERSION,
          queues: { items: queues },
          lastSeenAt: new Date(),
          startedAt,
        })
        .onDuplicateKeyUpdate({
          set: { lastSeenAt: new Date() },
        });
      log.info({ group, pid: process.pid }, "worker 心跳已上报");
    } catch (err) {
      log.warn({ err, group }, "worker 心跳上报失败（下轮重试）");
    }
  };

  void upsert();
  const interval = setInterval(() => void upsert(), INTERVAL_MS);
  interval.unref();
}