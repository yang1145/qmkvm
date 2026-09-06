/**
 * 领域事件：EVENT_NAMES 常量 + emitEvent。
 *
 * 投递策略（经 enqueueJob）：
 * - payload 带数值 userId → 走 "notify.user"（data = { userId, event, vars }），
 *   worker 侧由通知模块按事件名渲染模板并多通道发送；
 * - 其余 → 专用事件 job "domain.event"（data = { event, payload }），worker 侧统一消费。
 *
 * db 参数按 SPEC 签名保留（P2 事件外发 webhook 时用于持久化），当前未使用。
 */
import type { DbLike } from "./lifecycle/service-actions.js";
import { enqueueJob } from "./queue.js";

/** 通知类 job 名（与 worker 侧注册的 handler 对应） */
export const NOTIFY_JOB = "notify.user";
/** 通用领域事件 job 名 */
export const DOMAIN_EVENT_JOB = "domain.event";

export const EVENT_NAMES = {
  orderPaid: "order.paid",
  invoicePaid: "invoice.paid",
  serviceProvisionRequested: "service.provision_requested",
  serviceActivated: "service.activated",
  serviceSuspended: "service.suspended",
  serviceTerminated: "service.terminated",
  provisionTaskFailed: "provision.task_failed",
  ticketReplied: "ticket.replied",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

export type EventPayload = Record<string, unknown>;

/**
 * 发射领域事件：入队投递（notify/provision 消费），不抛出队列错误。
 * 可传入事务 tx 或 db 连接（当前仅签名保留）。
 */
export async function emitEvent(db: DbLike, name: string, payload: EventPayload): Promise<void> {
  void db; // 预留：P2 写 webhook_deliveries / 事件持久化
  const userId = payload.userId;
  if (typeof userId === "number") {
    const vars: Record<string, unknown> = { ...payload };
    delete vars.userId;
    await enqueueJob(NOTIFY_JOB, { userId, event: name, vars });
    return;
  }
  await enqueueJob(DOMAIN_EVENT_JOB, { event: name, payload });
}
