/**
 * 系统运行状态（admin 仪表盘只读展示）：API/DB/Redis 三项探活 + worker 心跳 + 四队列积压。
 * 状态页语义：逐项 try/catch 降级，任何子项失败不影响整体响应（不抛 500）。
 */
import { Hono } from "hono";
import { desc, sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { getDb, getRedis, schema } from "@qmkvm/db";
import { QUEUE_NOTIFY, QUEUE_OCR, QUEUE_SUPPLY, QUEUE_TX } from "@qmkvm/core";
import { requireAdmin } from "../../middleware/auth.js";

export const adminSystemStatusRoutes = new Hono();

/** 心跳有效期：worker 每 30s 上报，> 90s 未刷新判离线 */
const HEARTBEAT_TTL_MS = 90_000;

/** 四队列（与 core QUEUE_ROUTING 的目标队列一致） */
const MONITORED_QUEUES = [QUEUE_TX, QUEUE_NOTIFY, QUEUE_SUPPLY, QUEUE_OCR];

/** worker_heartbeats 行 → 展示结构 */
type HeartbeatRow = typeof schema.workerHeartbeats.$inferSelect;

adminSystemStatusRoutes.get("/system/status", requireAdmin("reports.read"), async (c) => {
  const db = getDb();

  // —— DB：SELECT 1 前后计时 ——
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    const t0 = performance.now();
    await db.execute(sql`select 1`);
    dbLatencyMs = Math.round(performance.now() - t0);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  // —— Redis：PING 计时（未配置 REDIS_URL → ok:false） ——
  let redisOk = false;
  let redisLatencyMs: number | null = null;
  try {
    const redis = getRedis();
    if (redis) {
      const t0 = performance.now();
      const pong = await redis.ping();
      redisLatencyMs = Math.round(performance.now() - t0);
      redisOk = pong === "PONG";
    }
  } catch {
    redisOk = false;
  }

  // —— workers：心跳表倒序，online = last_seen_at 距今 < 90s ——
  let workers: Array<{
    group: string;
    pid: number;
    host: string;
    version: string | null;
    queues: string[];
    lastSeenAt: string;
    online: boolean;
  }> = [];
  try {
    const rows: HeartbeatRow[] = await db
      .select()
      .from(schema.workerHeartbeats)
      .orderBy(desc(schema.workerHeartbeats.lastSeenAt))
      .limit(50);
    const now = Date.now();
    workers = rows.map((r) => ({
      group: r.group,
      pid: r.pid,
      host: r.host,
      version: r.version,
      queues: Array.isArray((r.queues as { items?: unknown } | null)?.items)
        ? ((r.queues as { items: unknown[] }).items as string[])
        : [],
      lastSeenAt: (r.lastSeenAt instanceof Date ? r.lastSeenAt : new Date(r.lastSeenAt)).toISOString(),
      online: now - (r.lastSeenAt instanceof Date ? r.lastSeenAt : new Date(r.lastSeenAt)).getTime() < HEARTBEAT_TTL_MS,
    }));
  } catch {
    workers = [];
  }

  // —— queues：BullMQ getJobCounts（Redis 不可用 → 空数组） ——
  const queues: Array<{ name: string; waiting: number; active: number; failed: number; delayed: number }> = [];
  if (redisOk) {
    const redis = getRedis();
    if (redis) {
      for (const name of MONITORED_QUEUES) {
        const queue = new Queue(name, { connection: redis });
        try {
          const counts = await queue.getJobCounts("waiting", "active", "failed", "delayed");
          queues.push({
            name,
            waiting: Number(counts.waiting ?? 0),
            active: Number(counts.active ?? 0),
            failed: Number(counts.failed ?? 0),
            delayed: Number(counts.delayed ?? 0),
          });
        } catch {
          // 单队列计数失败不阻断其余队列
        } finally {
          // 不 close（connection 为共享 ioredis 实例，close 只关队列自身的引用计数）
        }
      }
    }
  }

  return c.json({
    api: { ok: true, ts: new Date().toISOString() },
    db: { ok: dbOk, latencyMs: dbLatencyMs },
    redis: { ok: redisOk, latencyMs: redisLatencyMs },
    workers,
    queues,
  });
});