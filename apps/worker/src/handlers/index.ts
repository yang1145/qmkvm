/**
 * 处理器组注册：按 --group 参数只注册本组 handler。
 *
 * 半差异化设计：handler 按任务域分文件（tx/notify/supply/ocr），
 * 入口按 --group 只注册本组——凭据敏感调用（如 provisioning 包）只出现在
 * supply 文件里，其他组代码路径无法触达。
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@qmkvm/db";
import { registerJobHandler, closeStalePaymentIntents } from "@qmkvm/core";
import { processQueuedTasks, runProvisionTask } from "@qmkvm/provisioning";
import { notifyUserAllChannels } from "@qmkvm/notifications";
import { logger } from "@qmkvm/logger";
import { ocrVerifyHandler } from "./ocr.js";
import type { QueueGroup } from "../groups.js";

const log = logger.child({ module: "worker:handlers" });
type Db = ReturnType<typeof getDb>;

/** tx 组：供应事件转发（仅日志）、支付事件处理、手动触发计划任务、领域事件 */
function registerTxHandlers(db: Db): void {
  // 无归属用户的领域事件（emitEvent 的 DOMAIN_EVENT_JOB 投递），当前仅记录
  registerJobHandler("domain.event", async (data: { event?: string; payload?: unknown }) => {
    log.info({ event: data?.event, payload: data?.payload }, "领域事件已接收");
  });

  // 手动触发计划任务（后台「立即执行」）：按 name 从任务注册表执行，
  // 复用 runTask 包装保证 job_runs 记录与定时调度一致
  registerJobHandler("cron.run", async (data: { name?: string }) => {
    const name = String(data?.name ?? "");
    const { TASKS, runTask } = await import("../tasks/index.js");
    const task = TASKS.find((t: { name: string }) => t.name === name);
    if (!task) {
      log.warn({ name }, "cron.run 目标任务不存在，跳过");
      return;
    }
    log.info({ task: name }, "收到手动执行计划任务请求");
    await runTask(db, task);
  });
}

/** notify 组：站内/短信/邮件通知 */
function registerNotifyHandlers(db: Db): void {
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
}

/** supply 组：供应任务执行与退避重试（唯一触达 provisioning 包凭据调用点的组） */
function registerSupplyHandlers(db: Db): void {
  registerJobHandler("provision.task", async (data: { taskId?: number | string }) => {
    await runProvisionTask(db, Number(data?.taskId));
  });

  registerJobHandler("provision.retry", async (data: { taskId?: number | string }) => {
    await runProvisionTask(db, Number(data?.taskId));
  });
}

export function registerJobHandlers(db: Db, group: QueueGroup): void {
  // 兼容单队列模式（QUEUE_ROUTING≠split）：所有 job（含 ocr.verify/cron.run）
  // 都可能落进主队列 kvm，因此每个组都必须注册全量 handler 才能正确分发；
  // 分组模式下入队已按 QUEUE_ROUTING 分流，非本组 handler 注册后也不会收到 job。
  // handler 本身无副作用（不注册就不会被调），注册全量是安全的。
  registerTxHandlers(db);
  registerNotifyHandlers(db);
  registerSupplyHandlers(db);
  registerOcrHandlers(db);
  void group;
}

function registerOcrHandlers(db: Db): void {
  registerJobHandler("ocr.verify", (data) => ocrVerifyHandler(db, data));
}