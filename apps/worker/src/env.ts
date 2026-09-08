/** Worker 进程环境变量（读取失败的项给安全默认值）。 */

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export const workerEnv = {
  isProd: process.env.NODE_ENV === "production",
  /** BullMQ 消费并发数 */
  concurrency: intEnv("WORKER_CONCURRENCY", 5, 1, 20),
  /** 钉钉/飞书告警机器人（job_health 汇总失败任务 / replica_health 复制异常时 POST） */
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL?.trim() || null,
  /** 备库探测连接串（system.replica_health 用；未配置则只探测只读从库） */
  standbyDbUrl: process.env.DATABASE_URL_STANDBY?.trim() || null,
  /** 复制延迟告警阈值（秒，Seconds_Behind 超过即告警） */
  replicaLagAlertSeconds: intEnv("REPLICA_LAG_ALERT_SECONDS", 60, 5, 3600),
  /** 无 Redis 时的兜底循环间隔 */
  fallbackIntervalMs: 60_000,
} as const;
