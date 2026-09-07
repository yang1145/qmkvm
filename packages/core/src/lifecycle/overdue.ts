/**
 * 服务生命周期 · 欠费处理：到期提醒（T-14/7/3/1）、宽限期暂停、超限终止、
 * 过期支付单关闭（含关联 pending 订单取消与库存释放）。
 */
import { and, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db/client";
import { addDays, daysBetween, todayStr } from "../date-utils.js";
import { createProvisionTask, hasPendingTask, readSettingNumber } from "./service-actions.js";

const {
  services,
  notificationLogs,
  paymentIntents,
  invoices,
  orders,
  orderItems,
  products,
} = schema;

/** 提醒时点：仅距到期 T-14/7/3/1 天提醒 */
export const REMINDER_OFFSETS = [14, 7, 3, 1] as const;

/** 纯函数：距到期天数是否应发提醒（仅 14/7/3/1 为 true） */
export function shouldRemind(daysUntilDue: number): boolean {
  return (REMINDER_OFFSETS as readonly number[]).includes(daysUntilDue);
}

/** 当日（UTC）该用户该事件是否已发过通知（用 notificationLogs 判重，避免重复提醒） */
async function hasNotifiedToday(db: Db, userId: number, event: string, now: Date): Promise<boolean> {
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const rows = await db
    .select({ id: notificationLogs.id })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.userId, userId),
        eq(notificationLogs.event, event),
        // 展示型发送可能失败仅记日志，判重以日志存在为准
        gt(notificationLogs.createdAt, startOfDay),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** —— 到期提醒 —— */

/**
 * 对 active 且即将到期的服务按 T-14/7/3/1 入队 invoice.reminder 通知。
 * 去重三重保险：shouldRemind 阈值 + 当日 notificationLogs 判重 + 队列 jobId 幂等键。
 */
export async function enqueueDueReminders(db: Db, now: Date): Promise<{ sent: number }> {
  const today = todayStr(now);
  const dayTag = today.replaceAll("-", "");
  const candidates = await db
    .select()
    .from(services)
    .where(
      and(eq(services.status, "active"), isNotNull(services.nextDueDate), gt(services.nextDueDate, today)),
    );

  const { enqueueJob } = await import("../queue.js");
  let sent = 0;
  for (const service of candidates) {
    if (!service.nextDueDate) continue;
    const dueDate: string = service.nextDueDate;
    const daysLeft = daysBetween(today, dueDate);
    if (!shouldRemind(daysLeft)) continue;
    if (await hasNotifiedToday(db, service.userId, "invoice.reminder", now)) continue;

    await enqueueJob(
      "notify.user",
      {
        userId: service.userId,
        event: "invoice.reminder",
        vars: { serviceName: service.name, serviceId: service.id, dueDate, daysLeft },
      },
      { jobId: `service.reminder:${service.id}:${daysLeft}:${dayTag}` },
    );
    sent += 1;
  }
  return { sent };
}

/** —— 欠费暂停 —— */

/**
 * next_due_date < today - graceDays 的 active 服务 → 调度 suspend 供应任务
 * （实际状态变更为任务执行器完成）。宽限期读设置 "billing.overdue_grace_days"，默认 3。
 */
export async function suspendOverdueServices(
  db: Db,
  now: Date,
  graceDays = 3,
): Promise<{ suspended: number }> {
  const grace = Math.max(0, Math.round(await readSettingNumber(db, "billing.overdue_grace_days", graceDays)));
  const today = todayStr(now);
  const cutoff = addDays(today, -grace);
  const overdue = await db
    .select()
    .from(services)
    .where(
      and(
        eq(services.status, "active"),
        isNotNull(services.nextDueDate),
        lt(services.nextDueDate, cutoff),
      ),
    );

  let suspended = 0;
  for (const service of overdue) {
    // 去重：已有在途 suspend 任务（queued/processing/failed）则跳过
    if (await hasPendingTask(db, service.id, "suspend")) continue;

    await createProvisionTask(db, {
      serviceId: service.id,
      action: "suspend",
      payload: { reason: "overdue", dueDate: service.nextDueDate, graceDays: grace },
    });
    suspended += 1;
  }
  return { suspended };
}

/** —— 欠费终止 —— */

/**
 * suspended_overdue 且 next_due_date < today - terminateDays → 调度 terminate 任务，
 * 终止前先发 service.terminated 最终预警通知。阈值读设置 "billing.terminate_days"，默认 15。
 */
export async function terminateOverdueServices(
  db: Db,
  now: Date,
  terminateDays = 15,
): Promise<{ terminated: number }> {
  const days = Math.max(1, Math.round(await readSettingNumber(db, "billing.terminate_days", terminateDays)));
  const today = todayStr(now);
  const dayTag = today.replaceAll("-", "");
  const cutoff = addDays(today, -days);
  const candidates = await db
    .select()
    .from(services)
    .where(
      and(
        eq(services.status, "suspended_overdue"),
        isNotNull(services.nextDueDate),
        lt(services.nextDueDate, cutoff),
      ),
    );

  const { enqueueJob } = await import("../queue.js");
  let terminated = 0;
  for (const service of candidates) {
    // 去重：已有在途 terminate 任务则跳过
    if (await hasPendingTask(db, service.id, "terminate")) continue;

    // 终止前最终预警（当日判重）
    if (!(await hasNotifiedToday(db, service.userId, "service.terminated", now))) {
      await enqueueJob(
        "notify.user",
        {
          userId: service.userId,
          event: "service.terminated",
          vars: {
            serviceName: service.name,
            serviceId: service.id,
            dueDate: service.nextDueDate,
            terminateDays: days,
          },
        },
        { jobId: `service.terminate_warn:${service.id}:${dayTag}` },
      );
    }

    await createProvisionTask(db, {
      serviceId: service.id,
      action: "terminate",
      payload: { reason: "overdue_terminated", dueDate: service.nextDueDate, terminateDays: days },
    });
    terminated += 1;
  }
  return { terminated };
}

/** —— 过期支付单关闭 —— */

/**
 * created/paying 且已过期的支付单 → expired；若关联订单仍 pending，
 * 取消订单并把库存 stock_used 减回（GREATEST 防负）。
 */
export async function closeStalePaymentIntents(
  db: Db,
  now: Date,
  minutes = 30,
): Promise<{ closed: number }> {
  const stale = await db
    .select()
    .from(paymentIntents)
    .where(
      and(
        inArray(paymentIntents.status, ["created", "paying"]),
        lt(paymentIntents.expiresAt, now),
      ),
    );

  let closed = 0;
  const handledOrderIds = new Set<number>();
  for (const intent of stale) {
    // 条件更新防并发：仅 created/paying 才置为 expired
    const res = await db
      .update(paymentIntents)
      .set({ status: "expired" })
      .where(
        and(
          eq(paymentIntents.id, intent.id),
          inArray(paymentIntents.status, ["created", "paying"]),
        ),
      );
    const affected = res[0].affectedRows;
    if (affected === 0) continue; // 已被并发处理
    closed += 1;

    const invRows = await db
      .select({ orderId: invoices.orderId })
      .from(invoices)
      .where(eq(invoices.id, intent.invoiceId))
      .limit(1);
    const orderId = invRows[0]?.orderId ?? null;
    if (orderId === null || handledOrderIds.has(orderId)) continue;
    handledOrderIds.add(orderId);

    await releaseOrderIfNeeded(db, orderId, now);
  }
  return { closed };
}

/** 取消仍 pending 的订单并释放库存（含库存下限保护），非 pending 订单不动 */
async function releaseOrderIfNeeded(db: Db, orderId: number, now: Date): Promise<void> {
  const orderRows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
    .limit(1);
  if (orderRows.length === 0) return; // 仅 pending 订单取消

  await db.transaction(async (tx) => {
    // 条件更新防并发：只有仍 pending 才取消
    const res = await tx
      .update(orders)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(orders.id, orderId), eq(orders.status, "pending")));
    if (res[0].affectedRows === 0) return;

    const items = await tx
      .select({ productId: orderItems.productId, qty: orderItems.qty })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      if (item.productId == null) continue;
      await tx
        .update(products)
        .set({ stockUsed: sql`GREATEST(${products.stockUsed} - ${item.qty}, 0)` })
        .where(eq(products.id, item.productId));
    }
  });
}
