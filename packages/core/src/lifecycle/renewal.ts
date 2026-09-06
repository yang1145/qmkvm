/**
 * 服务生命周期 · 续费：到期账单批量生成、续费支付推进服务到期日。
 */
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { schema, type Db } from "@pinhaoji/db/client";
import type { BillingCycle } from "@pinhaoji/contracts";
import { appError } from "../errors.js";
import { addCycle, addDays, maxDate, todayStr } from "../date-utils.js";
import { formatCny } from "../money.js";
import {
  createProvisionTask,
  readSettingNumber,
  updateServiceStatus,
  type DbLike,
} from "./service-actions.js";

const { services, invoices, invoiceItems, orders, orderItems } = schema;

/**
 * 扫描 active 服务，next_due_date 落在 [today, today + leadDays]（leadDays 读设置
 * "billing.renewal_lead_days"，默认 14）且尚无同服务未付 renewal 账单的，
 * 生成 renewal 账单并入队 renewal.created 通知。
 *
 * 账单项 meta 记录 serviceId（账单与服务关联约定）；若账单实现未持久化 meta，
 * 则退化为按 description（含「服务 #ID」字样）匹配去重。
 */
export async function generateDueRenewalInvoices(
  db: Db,
  now: Date,
): Promise<{ scanned: number; generated: number }> {
  const today = todayStr(now);
  const leadDays = Math.max(0, Math.round(await readSettingNumber(db, "billing.renewal_lead_days", 14)));
  const endDate = addDays(today, leadDays);

  const candidates = await db
    .select()
    .from(services)
    .where(
      and(
        eq(services.status, "active"),
        isNotNull(services.nextDueDate),
        gte(services.nextDueDate, today),
        lte(services.nextDueDate, endDate),
        // 用户申请到期取消的服务不再生成续费账单
        eq(services.cancelAtPeriodEnd, false),
      ),
    );

  // 汇总相关用户已有的未付 renewal 账单项，构建去重键集合
  const dedupByUser = new Map<number, Set<string>>();
  if (candidates.length > 0) {
    const userIds = [...new Set(candidates.map((s) => s.userId))];
    const existingItems = await db
      .select({ userId: invoices.userId, meta: invoiceItems.meta, description: invoiceItems.description })
      .from(invoices)
      .innerJoin(invoiceItems, eq(invoiceItems.invoiceId, invoices.id))
      .where(
        and(
          inArray(invoices.userId, userIds),
          eq(invoices.type, "renewal"),
          eq(invoices.status, "unpaid"),
        ),
      );
    for (const row of existingItems) {
      let set = dedupByUser.get(row.userId);
      if (!set) {
        set = new Set<string>();
        dedupByUser.set(row.userId, set);
      }
      const meta = row.meta as { serviceId?: unknown } | null;
      set.add(typeof meta?.serviceId === "number" ? `svc:${meta.serviceId}` : `desc:${row.description}`);
    }
  }

  let generated = 0;
  for (const service of candidates) {
    if (!service.nextDueDate) continue; // 前面 isNotNull 过滤，此处兜底收窄类型
    const dueDate: string = service.nextDueDate;
    const description = `${service.name}（服务 #${service.id}）续费`;
    const keys = dedupByUser.get(service.userId);
    if (keys !== undefined && (keys.has(`svc:${service.id}`) || keys.has(`desc:${description}`))) {
      continue; // 已有同服务未付续费账单
    }

    // items 用中间变量传递，避免账单实现收紧签名时的多余属性检查
    const items = [
      {
        description,
        qty: 1,
        unitPrice: service.renewalAmount,
        meta: { serviceId: service.id, cycle: service.cycle, dueDate },
      },
    ];
    let invoiceNo = "";
    let amount = service.renewalAmount;
    await db.transaction(async (tx) => {
      const { createInvoiceWithItems } = await import("../billing/invoice.js");
      const invoice = await createInvoiceWithItems(tx, {
        userId: service.userId,
        type: "renewal",
        items,
        // 付款期限 = 服务到期日当天
        dueAt: new Date(`${dueDate}T23:59:59.000Z`),
      });
      invoiceNo = String(invoice.invoiceNo ?? "");
      amount = Number(invoice.total ?? service.renewalAmount);
    });

    // 事务提交后再入队通知，避免 inline 队列早于提交执行
    const { enqueueJob } = await import("../queue.js");
    await enqueueJob("notify.user", {
      userId: service.userId,
      event: "renewal.created",
      vars: {
        serviceName: service.name,
        serviceId: service.id,
        invoiceNo,
        amount,
        amountText: formatCny(amount),
        dueDate,
      },
    });
    generated += 1;
  }

  return { scanned: candidates.length, generated };
}

/**
 * 续费支付推进：next_due_date = addCycle(max(today, next_due_date), cycle)；
 * suspended_overdue 服务恢复 active 并建 unsuspend 供应任务。
 */
export async function applyRenewalPayment(
  db: DbLike,
  serviceId: number,
  cycle: BillingCycle,
): Promise<void> {
  if (cycle === "onetime") return; // 一次性服务无到期概念
  const today = todayStr();
  const rows = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  const service = rows[0];
  if (!service) {
    throw appError("SVC_NOT_FOUND", `服务不存在（#${serviceId}）`);
  }

  const base = maxDate(today, service.nextDueDate ?? today);
  const nextDue = addCycle(base, cycle);

  if (service.status === "suspended_overdue") {
    // 欠费停机后补缴：恢复 active + 补排 unsuspend 任务
    await updateServiceStatus(db, serviceId, "active", { nextDueDate: nextDue });
    await createProvisionTask(db, {
      serviceId,
      action: "unsuspend",
      payload: { reason: "renewal_paid", nextDueDate: nextDue },
    });
  } else {
    await db.update(services).set({ nextDueDate: nextDue }).where(eq(services.id, serviceId));
  }
}

/**
 * 余额支付续费账单：复用 billing.payInvoiceWithBalance + applyRenewalPayment。
 * 服务定位约定：账单项 meta.serviceId → 订单项 serviceId（按此顺序）。
 */
export async function payRenewalInvoice(
  db: Db,
  userId: number,
  invoiceId: number,
  cycle?: BillingCycle,
): Promise<{ invoice: Record<string, unknown>; balanceAfter: number }> {
  const invRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
    .limit(1);
  const invoice = invRows[0];
  if (!invoice) {
    throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  }

  // 1) 账单项 meta.serviceId
  let serviceId: number | undefined;
  const items = await db
    .select({ meta: invoiceItems.meta })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId));
  for (const it of items) {
    const meta = it.meta as { serviceId?: unknown } | null;
    if (typeof meta?.serviceId === "number") {
      serviceId = meta.serviceId;
      break;
    }
  }
  // 2) 关联订单项 serviceId（renewal 订单约定）
  if (serviceId === undefined && invoice.orderId != null) {
    const oiRows = await db
      .select({ serviceId: orderItems.serviceId })
      .from(orderItems)
      .where(eq(orderItems.orderId, invoice.orderId));
    for (const r of oiRows) {
      if (typeof r.serviceId === "number") {
        serviceId = r.serviceId;
        break;
      }
    }
  }
  if (serviceId === undefined) {
    throw appError("SVC_NOT_FOUND", "续费账单未关联服务");
  }

  const svcRows = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  const service = svcRows[0];
  if (!service) {
    throw appError("SVC_NOT_FOUND", `服务不存在（#${serviceId}）`);
  }
  const effCycle = cycle ?? service.cycle;

  const { payInvoiceWithBalance } = await import("../billing/credit.js");
  const paid = await payInvoiceWithBalance(db, userId, invoiceId);
  await applyRenewalPayment(db, serviceId, effCycle);
  return {
    invoice: (paid.invoice ?? {}) as Record<string, unknown>,
    balanceAfter: Number(paid.balanceAfter ?? 0),
  };
}
