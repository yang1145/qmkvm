/** 订单管理：列表、人工确认收款（markInvoicePaid + markOrderPaid）、取消。 */
import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";
import { orderStatusEnum, orderTypeEnum, idParamSchema, pageQuerySchema } from "@pinhaoji/contracts";
import { appError, cancelOrder, creditUser, markInvoicePaid, markOrderPaid } from "@pinhaoji/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact, writeAdminAudit } from "./helpers.js";

export const adminOrderRoutes = new Hono();

const { orders, orderItems, invoices, users } = schema;

const listQuery = z.object({
  ...pageQuerySchema.shape,
  status: orderStatusEnum.optional(),
  type: orderTypeEnum.optional(),
  userId: z.coerce.number().int().positive().optional(),
});

adminOrderRoutes.get("/orders", requireAdmin("orders.read"), async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = and(
    q.status ? eq(orders.status, q.status) : undefined,
    q.type ? eq(orders.type, q.type) : undefined,
    q.userId ? eq(orders.userId, q.userId) : undefined,
  );

  const rows = await db
    .select({ order: orders, user: users })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .where(where)
    .orderBy(desc(orders.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(orders).where(where);

  const ids = rows.map((r) => r.order.id);
  const items = ids.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids))
    : [];

  return c.json({
    items: rows.map((r) => ({
      id: r.order.id,
      userId: r.order.userId,
      user: r.user ? { name: r.user.name, ...maskedContact(r.user) } : null,
      type: r.order.type,
      status: r.order.status,
      subtotal: r.order.subtotal,
      discount: r.order.discount,
      total: r.order.total,
      balanceUsed: r.order.balanceUsed,
      promoCode: r.order.promoCode,
      note: r.order.note,
      paidAt: iso(r.order.paidAt),
      createdAt: iso(r.order.createdAt),
      items: items
        .filter((i) => i.orderId === r.order.id)
        .map((i) => ({ id: i.id, description: i.description, qty: i.qty, amount: i.amount, serviceId: i.serviceId })),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** 订单详情（含订单项与关联账单） */
adminOrderRoutes.get("/orders/:id", requireAdmin("orders.read"), async (c) => {
  const db = getDb();
  const id = idParamSchema.parse(c.req.param()).id;
  const rows = await db
    .select({ order: orders, user: users })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw appError("ORDER_NOT_FOUND", "订单不存在");
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  const invoiceRows = await db.select().from(invoices).where(eq(invoices.orderId, id));
  return c.json({
    id: row.order.id,
    userId: row.order.userId,
    user: row.user ? { name: row.user.name, phone: row.user.phone, email: row.user.email } : null,
    type: row.order.type,
    status: row.order.status,
    subtotal: row.order.subtotal,
    discount: row.order.discount,
    total: row.order.total,
    balanceUsed: row.order.balanceUsed,
    promoCode: row.order.promoCode,
    note: row.order.note,
    paidAt: iso(row.order.paidAt),
    cancelledAt: iso(row.order.cancelledAt),
    createdAt: iso(row.order.createdAt),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      serviceId: i.serviceId,
      description: i.description,
      qty: i.qty,
      unitPrice: i.unitPrice,
      amount: i.amount,
      meta: i.meta,
    })),
    invoices: invoiceRows.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      status: i.status,
      total: i.total,
    })),
  });
});

/**
 * 人工确认收款（权限 invoices.manage）：事务内标记关联未付账单已付 + 推进订单
 * （new 型建服务与供应任务）；充值账单补记余额入账（与支付回调管线同语义）。
 */
adminOrderRoutes.post("/orders/:id/mark-paid", requireAdmin("invoices.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z.object({ note: z.string().max(255).optional() }).parse(await c.req.json().catch(() => ({})));
  const admin = c.get("admin");
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const orderRows = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
    const order = orderRows[0];
    if (!order) throw appError("ORDER_NOT_FOUND", "订单不存在");
    const invRows = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.orderId, id), eq(invoices.status, "unpaid")))
      .limit(1);
    const invoice = invRows[0];
    if (!invoice) throw appError("BILL_INVOICE_NOT_FOUND", "订单没有可支付的未付账单");

    const paid = await markInvoicePaid(tx, invoice.id, {});
    await markOrderPaid(tx, id);
    // 充值账单：人工确认收款同样入账余额（对齐 processPaymentEvent 的充值分支）
    if (invoice.type === "recharge") {
      await creditUser(tx, invoice.userId, {
        type: "recharge",
        amount: invoice.total,
        refType: "invoice",
        refId: invoice.id,
        remark: "人工确认收款入账",
        adminId: admin.adminId,
      });
    }
    return { orderStatusBefore: order.status, invoice: paid, credited: invoice.type === "recharge" };
  });

  await writeAdminAudit(c, admin, {
    action: "order.mark_paid",
    targetType: "order",
    targetId: id,
    before: { orderStatus: result.orderStatusBefore, invoiceStatus: "unpaid" },
    after: {
      invoiceId: result.invoice.id,
      invoiceNo: result.invoice.invoiceNo,
      total: result.invoice.total,
      balanceCredited: result.credited,
      note: body.note ?? null,
    },
  });
  return c.json({ ok: true, orderId: id, invoiceId: result.invoice.id, invoiceNo: result.invoice.invoiceNo });
});

/** 取消订单（仅 pending；core 负责释放库存与作废关联未付账单） */
adminOrderRoutes.post("/orders/:id/cancel", requireAdmin("orders.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z.object({ reason: z.string().max(255).optional() }).parse(await c.req.json().catch(() => ({})));
  const admin = c.get("admin");
  const db = getDb();

  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  const order = rows[0];
  if (!order) throw appError("ORDER_NOT_FOUND", "订单不存在");

  await cancelOrder(db, order.userId, id);
  await writeAdminAudit(c, admin, {
    action: "order.cancel",
    targetType: "order",
    targetId: id,
    before: { status: order.status, total: order.total },
    after: { status: "cancelled", reason: body.reason ?? null },
  });
  return c.json({ ok: true });
});
