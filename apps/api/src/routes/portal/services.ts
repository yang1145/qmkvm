import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";

type User = typeof schema.users.$inferSelect;
import { pageQuerySchema, billingCycleEnum } from "@pinhaoji/contracts";
import { appError, addCycle, todayStr } from "@pinhaoji/core";
import { requireAuth } from "../../middleware/auth.js";

export const portalServiceRoutes = new Hono();
portalServiceRoutes.use("*", requireAuth());

function svcPayload(s: typeof schema.services.$inferSelect, productName: string) {
  return {
    id: s.id,
    name: s.name,
    productId: s.productId,
    productName,
    status: s.status,
    cycle: s.cycle,
    renewalAmount: s.renewalAmount,
    nextDueDate: s.nextDueDate,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    config: s.config,
    deliverInfo: s.deliverInfo,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
  };
}

portalServiceRoutes.get("/services", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const status = c.req.query("status");
  const where = status
    ? and(eq(schema.services.userId, user.id), eq(schema.services.status, status as never))
    : eq(schema.services.userId, user.id);
  const rows = await db
    .select()
    .from(schema.services)
    .where(where)
    .orderBy(desc(schema.services.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const all = await db.select({ id: schema.services.id }).from(schema.services).where(where);
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const products = productIds.length
    ? await db.select().from(schema.products).where(inArray(schema.products.id, productIds))
    : [];
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  return c.json({
    items: rows.map((s) => svcPayload(s, nameById.get(s.productId) ?? "")),
    total: all.length,
    page: q.page,
    pageSize: q.pageSize,
  });
});

portalServiceRoutes.get("/services/:id", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const rows = await db
    .select()
    .from(schema.services)
    .where(and(eq(schema.services.id, id), eq(schema.services.userId, user.id)))
    .limit(1);
  const s = rows[0];
  if (!s) throw appError("SVC_NOT_FOUND", "服务不存在");
  const productRows = await db.select().from(schema.products).where(eq(schema.products.id, s.productId)).limit(1);
  return c.json(svcPayload(s, productRows[0]?.name ?? ""));
});

/** 续费：按周期生成续费账单 */
portalServiceRoutes.post("/services/:id/renew", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const body = z.object({ cycle: billingCycleEnum }).parse(await c.req.json());
  if (body.cycle === "onetime") throw appError("VALIDATION_FAILED", "一次性商品无需续费");

  const rows = await db
    .select()
    .from(schema.services)
    .where(and(eq(schema.services.id, id), eq(schema.services.userId, user.id)))
    .limit(1);
  const s = rows[0];
  if (!s) throw appError("SVC_NOT_FOUND", "服务不存在");
  if (!["active", "suspended_overdue", "suspended_manual"].includes(s.status)) {
    throw appError("SVC_STATUS_INVALID", "当前状态不可续费");
  }

  const pricingRows = await db
    .select()
    .from(schema.productPricing)
    .where(and(eq(schema.productPricing.productId, s.productId), eq(schema.productPricing.cycle, body.cycle)))
    .limit(1);
  const pricing = pricingRows[0];
  if (!pricing) throw appError("CATALOG_NOT_FOUND", "该商品不支持所选周期");

  const { generateInvoiceNo } = await import("@pinhaoji/core");
  const invoiceNo = await generateInvoiceNo(db);
  const description = `${s.name}（服务 #${s.id}）续费`;

  // 续费也走订单（markOrderPaid 的 renewal 分支负责顺延到期日/恢复暂停服务）
  const orderIns = await db
    .insert(schema.orders)
    .values({
      userId: user.id,
      type: "renewal",
      status: "pending",
      subtotal: pricing.renewalPrice,
      total: pricing.renewalPrice,
    });
  const orderId = orderIns[0].insertId;
  await db.insert(schema.orderItems).values({
    orderId,
    productId: s.productId,
    serviceId: s.id,
    description,
    qty: 1,
    unitPrice: pricing.renewalPrice,
    amount: pricing.renewalPrice,
    meta: { serviceId: s.id, cycle: body.cycle },
  });

  const inserted = await db
    .insert(schema.invoices)
    .values({
      userId: user.id,
      invoiceNo,
      type: "renewal",
      status: "unpaid",
      orderId,
      subtotal: pricing.renewalPrice,
      total: pricing.renewalPrice,
    });
  const invoiceId = inserted[0].insertId;
  await db.insert(schema.invoiceItems).values({
    invoiceId,
    description,
    qty: 1,
    unitPrice: pricing.renewalPrice,
    amount: pricing.renewalPrice,
    meta: { serviceId: s.id, cycle: body.cycle },
  });

  const base = todayMax(s.nextDueDate);
  return c.json({
    orderId,
    invoiceId,
    invoiceNo,
    amount: pricing.renewalPrice,
    nextDueDateAfter: addCycle(base, body.cycle),
  });
});

function todayMax(due: string | null): string {
  const today = todayStr(new Date());
  if (!due) return today;
  return due > today ? due : today;
}

/** 升级：报价或确认下单 */
portalServiceRoutes.post("/services/:id/upgrade", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const body = z
    .object({ targetProductId: z.number().int().positive(), confirm: z.boolean().optional() })
    .parse(await c.req.json());

  const { quoteUpgrade, createUpgradeOrder } = await import("@pinhaoji/core");
  if (!body.confirm) {
    const rows = await db
      .select()
      .from(schema.services)
      .where(and(eq(schema.services.id, id), eq(schema.services.userId, user.id)))
      .limit(1);
    const s = rows[0];
    if (!s) throw appError("SVC_NOT_FOUND", "服务不存在");
    const quote = await quoteUpgrade(db, s, body.targetProductId, new Date());
    return c.json({
      serviceId: id,
      targetProductId: body.targetProductId,
      creditFromOld: quote.creditFromOld,
      newFirstAmount: quote.newFirstAmount,
      payable: quote.payable,
      preview: [
        {
          label: "剩余价值抵扣",
          from: `剩余 ${quote.preview.remainingDays} 天`,
          to: `抵扣 ¥${(quote.creditFromOld / 100).toFixed(2)}`,
        },
      ],
    });
  }
  const result = await createUpgradeOrder(db, { id: user.id }, id, body.targetProductId);
  return c.json({ ...result, payUrl: null });
});

/** 取消：立即（建终止任务）或到期取消（不生成续费账单，到期走终止） */
portalServiceRoutes.post("/services/:id/cancel", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const body = z.object({ when: z.enum(["now", "period_end"]) }).parse(await c.req.json());

  const rows = await db
    .select()
    .from(schema.services)
    .where(and(eq(schema.services.id, id), eq(schema.services.userId, user.id)))
    .limit(1);
  const s = rows[0];
  if (!s) throw appError("SVC_NOT_FOUND", "服务不存在");
  if (!["active", "suspended_overdue", "suspended_manual", "pending"].includes(s.status)) {
    throw appError("SVC_STATUS_INVALID", "当前状态不可取消");
  }

  if (body.when === "now") {
    const { createProvisionTask } = await import("@pinhaoji/core");
    const task = await createProvisionTask(db, {
      serviceId: s.id,
      action: "terminate",
      payload: { reason: "user_cancel_now" },
    });
    await db.update(schema.services).set({ cancelAtPeriodEnd: true }).where(eq(schema.services.id, s.id));
    return c.json({ ok: true, taskId: task.id, mode: "terminating" });
  }
  await db.update(schema.services).set({ cancelAtPeriodEnd: true }).where(eq(schema.services.id, s.id));
  return c.json({ ok: true, mode: "period_end", nextDueDate: s.nextDueDate });
});
