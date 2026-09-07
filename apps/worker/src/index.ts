/**
 * Worker 进程入口：BullMQ 消费者（按 --group 分组订阅）+ repeatable 定时任务。
 *
 * - 启动参数 --group tx|notify|supply|ocr（缺省 tx）：只注册并消费本组 handler，
 *   队列订阅范围由 core 的 queuesForGroup 决定（半差异化，同一镜像不同启动参数）。
 * - 定时任务调度器（upsertJobScheduler）始终由 tx 组负责注册，其余组不注册，
 *   避免 N 个副本重复注册 scheduler（upsert 本身幂等，但日志与写入量随副本线性增长）。
 * - 未配置 REDIS_URL：不启动消费者，退化为 60s 兜底循环（仅 tx 组保留）。
 */
import { Worker, Queue } from "bullmq";
import { getDb, getRedis } from "@qmkvm/db";
import {
  QUEUE_NAME,
  closeStalePaymentIntents,
  processEnqueuedJob,
  queueForJob,
  queuesForGroup,
} from "@qmkvm/core";
import { processQueuedTasks } from "@qmkvm/provisioning";
import { logger } from "@qmkvm/logger";
import { workerEnv } from "./env.js";
import { parseWorkerGroup } from "./groups.js";
import { registerJobHandlers } from "./handlers/index.js";
import { TASKS, runTask } from "./tasks/index.js";

const log = logger.child({ module: "worker" });
type Db = ReturnType<typeof getDb>;

/** 无 Redis 兜底循环（仅 tx 组驻留）：供应任务兜底 + 过期支付单关闭 */
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
    setTimeout(tick, workerEnv.fallbackIntervalMs).unref();
  };
  tick();

  const shutdown = (): void => {
    running = false;
    clearInterval(undefined as unknown as ReturnType<typeof setInterval>);
    log.info("[worker] 兜底循环已停止，进程退出");
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const group = parseWorkerGroup(process.argv);
  const db = getDb();
  registerJobHandlers(db, group);

  const redis = getRedis();
  if (!redis) {
    if (group !== "tx") {
      log.info(`[worker:${group}] 未配置 REDIS_URL，本组无可执行任务，进程空转退出`);
      process.exit(0);
    }
    await runFallbackLoop(db);
    return;
  }

  const queueNames = queuesForGroup(group);
  log.info({ group, queues: queueNames }, "[worker] 按组订阅队列");

  // 1) 定时任务调度器注册：仅 tx 组（repeatable scheduler 全局只需一份）
  if (group === "tx") {
    const scheduler = new Queue(QUEUE_NAME, { connection: redis });
    for (const task of TASKS) {
      await scheduler.upsertJobScheduler(
        task.name,
        { pattern: task.cron, tz: "UTC" },
        { name: task.name, data: { __scheduled: true } },
      );
      log.info({ task: task.name, cron: task.cron }, "已注册 repeatable 定时任务");
    }
  }

  // 2) 消费者：每组一个 Worker 实例；组内多队列轮询消费
  const taskByName = new Map(TASKS.map((t) => [t.name, t]));
  const workers: Worker[] = [];
  for (const queueName of queueNames) {
    const worker = new Worker(
      queueName,
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
      log.error({ group, queue: queueName, job: job?.name, jobId: job?.id, err: err.message }, "队列任务处理失败");
    });
    worker.on("error", (err) => {
      log.error({ group, queue: queueName, err: err.message }, "Worker 异常");
    });
    workers.push(worker);
  }

  log.info(
    { group, queues: queueNames, concurrency: workerEnv.concurrency, tasks: TASKS.length },
    "[worker] BullMQ 消费者已启动",
  );

  // 3) 优雅退出：停止接新任务 → 等在跑任务完成 → 关闭连接
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    log.info({ signal, group }, "[worker] 收到退出信号，正在优雅关闭…");
    try {
      await Promise.all(workers.map((w) => w.close()));
    } catch (err) {
      log.warn({ err }, "关闭 Worker 异常（忽略）");
    }
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  // 保持进程引用（避免 unused 提示）
  void queueForJob;
}

main().catch((err) => {
  log.error({ err }, "[worker] 启动失败");
  process.exit(1);
});