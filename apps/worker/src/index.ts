/**
 * Worker 进程入口：BullMQ 消费者（队列 `kvm`）+ 9 个 repeatable 定时任务。
 *
 * - 启动时注册队列任务处理器（provision.task / provision.retry / notify.user /
 *   payment.process_event / domain.event），消费侧统一经 core 的
 *   processEnqueuedJob 分发（与 API 进程 inline 降级共用同一注册逻辑约定）。
 * - repeatable 定时任务用 BullMQ 6 job scheduler API（upsertJobScheduler，UTC cron）。
 * - 未配置 REDIS_URL：不启动消费者，退化为 60s 兜底循环
 *   （processQueuedTasks + closeStalePaymentIntents），进程保持存活。
 */
import { Worker, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { getDb, getRedis, schema } from "@qmkvm/db";
import { QUEUE_NAME, closeStalePaymentIntents, processEnqueuedJob, registerJobHandler } from "@qmkvm/core";
import { processQueuedTasks, runProvisionTask } from "@qmkvm/provisioning";
import { notifyUserAllChannels } from "@qmkvm/notifications";
import { logger } from "@qmkvm/logger";
import { workerEnv } from "./env.js";
import { TASKS, runTask } from "./tasks/index.js";

const log = logger.child({ module: "worker" });
type Db = ReturnType<typeof getDb>;

/** 注册队列任务处理器（worker 消费侧统一分发入口） */
function registerJobHandlers(db: Db): void {
  registerJobHandler("provision.task", async (data: { taskId?: number | string }) => {
    await runProvisionTask(db, Number(data?.taskId));
  });

  // 失败退避重投（processQueuedTasks 经此延迟重试）
  registerJobHandler("provision.retry", async (data: { taskId?: number | string }) => {
    await runProvisionTask(db, Number(data?.taskId));
  });

  registerJobHandler(
    "notify.user",
    async (data: { userId?: number | string; event?: string; vars?: Record<string, unknown> }) => {
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, Number(data?.userId)))
        .limit(1);
      const user = rows[0];
      if (!user) {
        log.warn({ userId: data?.userId, event: data?.event }, "通知目标用户不存在，跳过");
        return;
      }
      await notifyUserAllChannels(db, {
        user,
        event: String(data?.event ?? ""),
        vars: data?.vars ?? {},
      });
    },
  );

  registerJobHandler("payment.process_event", async (data: { eventId?: number | string }) => {
    const payments = await import("@qmkvm/payments");
    await payments.processPaymentEvent(db, Number(data?.eventId));
  });

  // 无归属用户的领域事件（emitEvent 的 DOMAIN_EVENT_JOB 投递），P0 仅记录
  registerJobHandler("domain.event", async (data: { event?: string; payload?: unknown }) => {
    log.info({ event: data?.event, payload: data?.payload }, "领域事件已接收");
  });

  // 手动触发计划任务（后台「立即执行」）：按 name 从任务注册表执行，
  // 复用 runTask 包装保证 job_runs 记录与定时调度一致
  registerJobHandler("cron.run", async (data: { name?: string }) => {
    const name = String(data?.name ?? "");
    const task = TASKS.find((t) => t.name === name);
    if (!task) {
      log.warn({ name }, "cron.run 目标任务不存在，跳过");
      return;
    }
    log.info({ task: name }, "收到手动执行计划任务请求");
    await runTask(db, task);
  });
}

/** 无 Redis 兜底循环：供应任务兜底 + 过期支付单关闭（驻留直至收到退出信号） */
async function runFallbackLoop(db: Db): Promise<void> {
  log.warn(
    "[worker] 未配置 REDIS_URL，BullMQ 消费者不启动；进入 60s 兜底循环（processQueuedTasks + closeStalePaymentIntents）",
  );

  let running = true;
  const tick = async (): Promise<void> => {
    if (!running) return;
    try {
      const scan = await processQueuedTasks(db, 50);
      const closed = await closeStalePaymentIntents(db, new Date());
      log.info({ scan, closed: closed.closed }, "兜底循环执行完成");
    } catch (err) {
      log.error({ err }, "兜底循环执行失败（下轮重试）");
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), workerEnv.fallbackIntervalMs);
  timer.unref();

  await new Promise<never>(() => {
    const shutdown = (): void => {
      running = false;
      clearInterval(timer);
      log.info("[worker] 兜底循环已停止，进程退出");
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function main(): Promise<void> {
  const db = getDb();
  registerJobHandlers(db);

  const redis = getRedis();
  if (!redis) {
    await runFallbackLoop(db);
    return;
  }

  // 1) 注册 repeatable 定时任务（upsert：重复启动安全，幂等更新 cron）
  const queue = new Queue(QUEUE_NAME, { connection: redis });
  for (const task of TASKS) {
    await queue.upsertJobScheduler(
      task.name,
      { pattern: task.cron, tz: "UTC" },
      { name: task.name, data: { __scheduled: true } },
    );
    log.info({ task: task.name, cron: task.cron }, "已注册 repeatable 定时任务");
  }

  // 2) 消费者：定时任务名走 runTask 包装（写 job_runs），其余经 processEnqueuedJob 分发
  const taskByName = new Map(TASKS.map((t) => [t.name, t]));
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const task = taskByName.get(job.name);
      if (task) {
        await runTask(db, task);
        return;
      }
      await processEnqueuedJob(job.name, job.data);
    },
    { connection: redis, concurrency: workerEnv.concurrency },
  );

  worker.on("failed", (job, err) => {
    log.error({ job: job?.name, jobId: job?.id, err: err.message }, "队列任务处理失败");
  });
  worker.on("error", (err) => {
    log.error({ err: err.message }, "Worker 异常");
  });

  log.info(
    { queue: QUEUE_NAME, concurrency: workerEnv.concurrency, tasks: TASKS.length },
    "[worker] BullMQ 消费者已启动",
  );

  // 3) 优雅退出：停止接新任务 → 等在跑任务完成 → 关闭队列连接
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    log.info({ signal }, "[worker] 收到退出信号，正在优雅关闭…");
    try {
      await worker.close();
      await queue.close();
    } catch (err) {
      log.warn({ err }, "关闭 Worker/Queue 异常（忽略）");
    }
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error({ err }, "[worker] 启动失败");
  process.exit(1);
});
