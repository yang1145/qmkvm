import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";

type User = typeof schema.users.$inferSelect;
import { pageQuerySchema } from "@qmkvm/contracts";
import { appError } from "@qmkvm/core";
import { requireAuth } from "../../middleware/auth.js";

export const portalOrderRoutes = new Hono();
portalOrderRoutes.use("*", requireAuth());

portalOrderRoutes.get("/orders", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const status = c.req.query("status");
  const where = status
    ? and(eq(schema.orders.userId, user.id), eq(schema.orders.status, status as never))
    : eq(schema.orders.userId, user.id);
  const rows = await db
    .select()
    .from(schema.orders)
    .where(where)
    .orderBy(desc(schema.orders.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const all = await db.select({ id: schema.orders.id }).from(schema.orders).where(where);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, ids))
    : [];
  return c.json({
    items: rows.map((o) => ({
      id: o.id,
      type: o.type,
      status: o.status,
      subtotal: o.subtotal,
      discount: o.discount,
      total: o.total,
      balanceUsed: o.balanceUsed,
      promoCode: o.promoCode,
      paidAt: o.paidAt?.toISOString?.() ?? null,
      createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({ id: i.id, description: i.description, qty: i.qty, amount: i.amount, serviceId: i.serviceId })),
    })),
    total: all.length,
    page: q.page,
    pageSize: q.pageSize,
  });
});

portalOrderRoutes.get("/orders/:id", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const rows = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, id), eq(schema.orders.userId, user.id)))
    .limit(1);
  const o = rows[0];
  if (!o) throw appError("ORDER_NOT_FOUND", "订单不存在");
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
  const invoiceRows = await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, o.id));
  return c.json({
    id: o.id,
    type: o.type,
    status: o.status,
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    balanceUsed: o.balanceUsed,
    promoCode: o.promoCode,
    note: o.note,
    paidAt: o.paidAt?.toISOString?.() ?? null,
    createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
    items: items.map((i) => ({
      id: i.id,
      description: i.description,
      qty: i.qty,
      unitPrice: i.unitPrice,
      amount: i.amount,
      serviceId: i.serviceId,
      meta: i.meta,
    })),
    invoices: invoiceRows.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, status: i.status, total: i.total })),
  });
});
