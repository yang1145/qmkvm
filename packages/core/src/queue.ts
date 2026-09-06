/**
 * 任务队列抽象：统一单队列 `phj`（BullMQ，attempts 默认 5 + 指数退避）。
 *
 * - 配置了 REDIS_URL：经 BullMQ 入队，由 worker 进程消费（worker 侧用
 *   processEnqueuedJob 统一分发到 registerJobHandler 注册的 handler）。
 * - 未配置 Redis：inline 降级 —— setImmediate 直接执行本进程注册的 handler，
 *   handler 异常仅记日志不抛出（通知/供应等异步动作不阻断主流程）。
 */
import { Queue } from "bullmq";
import { getRedis } from "@pinhaoji/db/redis";
import { logger } from "@pinhaoji/logger";

/** 队列名（worker 侧消费同名队列） */
export const QUEUE_NAME = "phj";

export type JobHandler = (data: any) => Promise<void>;

export interface EnqueueOptions {
  /** 延迟执行（毫秒），如 provision.retry 退避 */
  delayMs?: number;
  /** 幂等键：BullMQ 同 jobId 在等待中不重复入队 */
  jobId?: string;
  /** 覆盖默认重试次数（默认 5） */
  attempts?: number;
}

const log = logger.child({ module: "core:queue" });

const handlers = new Map<string, JobHandler>();

/** 注册任务处理器（api/worker 进程启动时注册；同名重复注册覆盖并告警） */
export function registerJobHandler(job: string, handler: JobHandler): void {
  if (handlers.has(job)) {
    log.warn({ job }, "任务处理器重复注册，已覆盖旧处理器");
  }
  handlers.set(job, handler);
}

/** 已注册的处理器表（worker 侧复用/自检） */
export function getRegisteredJobHandlers(): ReadonlyMap<string, JobHandler> {
  return handlers;
}

/**
 * 单任务分发：BullMQ processor 与无 Redis 的手动执行入口统一走这里。
 * 无对应 handler 时抛错 —— BullMQ 模式下会按 attempts 重试后标 failed。
 */
export async function processEnqueuedJob(job: string, data: unknown): Promise<void> {
  const handler = handlers.get(job);
  if (!handler) {
    throw new Error(`未注册的任务处理器：${job}`);
  }
  await handler(data);
}

// —— BullMQ 队列单例（惰性创建；无 REDIS_URL 恒为 null） ——

let queueInstance: Queue | null | undefined;

function getQueue(): Queue | null {
  if (queueInstance !== undefined) return queueInstance;
  const redis = getRedis();
  if (!redis) {
    queueInstance = null;
    return null;
  }
  queueInstance = new Queue(QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
  return queueInstance;
}

/**
 * 入队任务。Redis 模式下入队失败仅记日志不抛出（避免通知/供应等异步动作
 * 阻断主业务事务，掉单由定时任务兜底）；inline 模式下 handler 异常同样不抛。
 */
export async function enqueueJob(job: string, data: unknown, opts?: EnqueueOptions): Promise<void> {
  const queue = getQueue();
  if (queue) {
    try {
      await queue.add(job, data, {
        jobId: opts?.jobId,
        delay: opts?.delayMs,
        attempts: opts?.attempts,
      });
    } catch (err) {
      log.error({ job, err }, "BullMQ 入队失败（已忽略，等待兜底任务补偿）");
    }
    return;
  }

  // inline 降级：无 Redis 时在当前进程内异步执行
  const handler = handlers.get(job);
  if (!handler) {
    log.warn({ job }, "inline 队列无已注册处理器，任务被跳过（未配置 REDIS_URL）");
    return;
  }
  log.info({ job }, "inline 执行队列任务");
  setImmediate(() => {
    handler(data).catch((err: unknown) => {
      log.error({ job, err }, "inline 队列任务执行失败（不抛出）");
    });
  });
}
