/**
 * tx 组 handler：交易/编排主链路。
 *
 * 职责：domain.event（无归属用户的领域事件）、cron.run（手动触发计划任务）、
 * payment.process_event（网关支付事件结算，注册器在 payments 包）。
 * 订阅队列：kvm（主队列）——兜底循环与 repeatable 定时任务调度器也由本组驻留。
 * 凭据边界：无直接凭据调用；支付网关凭据经 payments 包按 db 配置读取。
 */
import { getDb } from "@qmkvm/db";
import { registerJobHandler } from "@qmkvm/core";
import { logger } from "@qmkvm/logger";

const log = logger.child({ module: "worker:tx" });
type Db = ReturnType<typeof getDb>;

/** tx 组注册：供应事件转发（仅日志）、手动触发计划任务、支付事件处理 */
export function registerTxHandlers(db: Db): void {
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

  // 支付网关事件结算：实现经动态 import 引入（payments 包）——
  // 凭据（网关密钥）只按 db 配置在运行时读取。handler 先同步注册，
  // import 在首次执行时才解析，避免启动竞态下出现「未注册处理器」。
  registerJobHandler(
    "payment.process_event",
    async (data: { eventId?: number | string }) => {
      const payments = await import("@qmkvm/payments");
      await payments.processPaymentEvent(db, Number(data?.eventId));
    },
  );
}