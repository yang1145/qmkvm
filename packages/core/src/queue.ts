/**
 * 任务队列抽象：统一单队列 `kvm`（BullMQ，attempts 默认 5 + 指数退避）。
 *
 * - 配置了 REDIS_URL：经 BullMQ 入队，由 worker 进程消费（worker 侧用
 *   processEnqueuedJob 统一分发到 registerJobHandler 注册的 handler）。
 * - 未配置 Redis：inline 降级 —— setImmediate 直接执行本进程注册的 handler，
 *   handler 异常仅记日志不抛出（通知/供应等异步动作不阻断主流程）。
 */
import { Queue } from "bullmq";
import { getRedis } from "@qmkvm/db/redis";
import { logger } from "@qmkvm/logger";

/** 队列名（worker 侧消费同名队列） */
export const QUEUE_NAME = "kvm";

/**
 * 队列分组（微服务化部署形态）：worker 按 --group 只订阅本组队列。
 * 路由规则集中在一处；分组缺失的 job 一律回落主队列 kvm（兼容既有部署）。
 * 开发态（未配置分组路由环境变量）时全部走主队列，行为与单队列完全一致。
 */
export const QUEUE_TX = "kvm";
export const QUEUE_NOTIFY = "kvm-notify";
export const QUEUE_SUPPLY = "kvm-supply";
export const QUEUE_OCR = "kvm-ocr";

/** job 名 → 队列映射（一处定义，API/worker 双侧共用） */
const QUEUE_ROUTING: Record<string, string> = {
  "notify.user": QUEUE_NOTIFY,
  "domain.event": QUEUE_TX,
  "provision.task": QUEUE_SUPPLY,
  "provision.retry": QUEUE_SUPPLY,
  "payment.process_event": QUEUE_TX,
  "cron.run": QUEUE_TX,
  "ocr.verify": QUEUE_OCR,
};

export const QUEUE_GROUPS = ["tx", "notify", "supply", "ocr"] as const;
export type QueueGroup = (typeof QUEUE_GROUPS)[number];

/** 组 → 订阅的队列名列表（worker 启动时用） */
export function queuesForGroup(group: string): string[] {
  const queues = new Set<string>([QUEUE_TX]);
  for (const q of Object.values(QUEUE_ROUTING)) {
    if (q !== QUEUE_TX) queues.add(q);
  }
  // 主队列 kvm 始终属于 tx 组；其余组只订阅本组队列 + 不含主队列
  if (group !== "tx") {
    return Object.values(QUEUE_ROUTING).filter(
      (q) => routeGroupOf(q) === group && q !== QUEUE_TX,
    );
  }
  return [...queues];
}

/** 队列名 → 所属组（无映射的队列归 tx） */
function routeGroupOf(queue: string): QueueGroup {
  if (queue === QUEUE_NOTIFY) return "notify";
  if (queue === QUEUE_SUPPLY) return "supply";
  if (queue === QUEUE_OCR) return "ocr";
  return "tx";
}

/** 入队时的队列选择：按 job 名路由；未配置分组时统一走主队列 */
export function queueForJob(job: string): string {
  const routingEnabled = process.env.QUEUE_ROUTING === "split";
  if (!routingEnabled) return QUEUE_NAME;
  return QUEUE_ROUTING[job] ?? QUEUE_NAME;
}

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

const queueInstances = new Map<string, Queue>();

function getQueue(name: string): Queue | null {
  const cached = queueInstances.get(name);
  if (cached) return cached;
  const redis = getRedis();
  if (!redis) {
    return null;
  }
  const queue = new Queue(name, {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
  queueInstances.set(name, queue);
  return queue;
}

/**
 * 入队任务。Redis 模式下入队失败仅记日志不抛出（避免通知/供应等异步动作
 * 阻断主业务事务，掉单由定时任务兜底）；inline 模式下 handler 异常同样不抛。
 */
export async function enqueueJob(job: string, data: unknown, opts?: EnqueueOptions): Promise<void> {
  const queue = getQueue(queueForJob(job));
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
