/** 账单管理：列表、手工开单（manual 类型）、作废。 */
import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import {
  idParamSchema,
  invoiceCreateSchema,
  invoiceStatusEnum,
  invoiceTypeEnum,
  pageQuerySchema,
} from "@qmkvm/contracts";
import { appError, createInvoiceWithItems, emitEvent, voidInvoice } from "@qmkvm/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact, writeAdminAudit } from "./helpers.js";

export const adminInvoiceRoutes = new Hono();

const { invoices, invoiceItems, users } = schema;

const listQuery = z.object({
  ...pageQuerySchema.shape,
  status: invoiceStatusEnum.optional(),
  type: invoiceTypeEnum.optional(),
  userId: z.coerce.number().int().positive().optional(),
});

adminInvoiceRoutes.get("/invoices", requireAdmin("invoices.read"), async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = and(
    q.status ? eq(invoices.status, q.status) : undefined,
    q.type ? eq(invoices.type, q.type) : undefined,
    q.userId ? eq(invoices.userId, q.userId) : undefined,
  );

  const rows = await db
    .select({ inv: invoices, user: users })
    .from(invoices)
    .leftJoin(users, eq(users.id, invoices.userId))
    .where(where)
    .orderBy(desc(invoices.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(invoices).where(where);

  const ids = rows.map((r) => r.inv.id);
  const items = ids.length
    ? await db.select().from(invoiceItems).where(inArray(invoiceItems.invoiceId, ids))
    : [];

  return c.json({
    items: rows.map((r) => ({
      id: r.inv.id,
      invoiceNo: r.inv.invoiceNo,
      userId: r.inv.userId,
      user: r.user ? { name: r.user.name, ...maskedContact(r.user) } : null,
      type: r.inv.type,
      status: r.inv.status,
      subtotal: r.inv.subtotal,
      discount: r.inv.discount,
      total: r.inv.total,
      balanceUsed: r.inv.balanceUsed,
      orderId: r.inv.orderId,
      dueAt: iso(r.inv.dueAt),
      paidAt: iso(r.inv.paidAt),
      voidReason: r.inv.voidReason,
      createdAt: iso(r.inv.createdAt),
      items: items
        .filter((i) => i.invoiceId === r.inv.id)
        .map((i) => ({ id: i.id, description: i.description, qty: i.qty, unitPrice: i.unitPrice, amount: i.amount })),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

/**
 * 手工开单（manual 类型）：建 unpaid 账单 + 明细，发射 invoice.created 通知客户；
 * 备注（note）记录于审计日志。
 */
adminInvoiceRoutes.post("/invoices", requireAdmin("invoices.manage"), async (c) => {
  const body = invoiceCreateSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();

  const userRows = await db.select({ id: users.id }).from(users).where(eq(users.id, body.userId)).limit(1);
  if (!userRows[0]) throw appError("NOT_FOUND", `客户不存在（#${body.userId}）`);

  const invoice = await db.transaction(async (tx) => {
    const created = await createInvoiceWithItems(tx, {
      userId: body.userId,
      type: "manual",
      items: body.items.map((it) => ({ description: it.description, qty: it.qty, unitPrice: it.unitPrice })),
    });
    await emitEvent(tx, "invoice.created", {
      userId: body.userId,
      invoiceId: created.id,
      invoiceNo: created.invoiceNo,
      total: created.total,
    });
    return created;
  });

  await writeAdminAudit(c, admin, {
    action: "invoice.create",
    targetType: "invoice",
    targetId: invoice.id,
    after: {
      userId: body.userId,
      invoiceNo: invoice.invoiceNo,
      total: invoice.total,
      note: body.note ?? null,
      items: body.items,
    },
  });
  return c.json({
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    type: invoice.type,
    status: invoice.status,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    total: invoice.total,
    createdAt: iso(invoice.createdAt),
  });
});

/** 作废账单（仅 unpaid；core voidInvoice 自带 invoice.void 审计） */
adminInvoiceRoutes.post("/invoices/:id/void", requireAdmin("invoices.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z.object({ reason: z.string().min(1).max(255) }).parse(await c.req.json());
  const admin = c.get("admin");
  const invoice = await voidInvoice(getDb(), id, admin.adminId, body.reason);
  return c.json({
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    status: invoice.status,
    voidReason: invoice.voidReason,
  });
});
