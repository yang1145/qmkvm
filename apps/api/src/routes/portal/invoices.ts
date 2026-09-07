import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";

type User = typeof schema.users.$inferSelect;
import { pageQuerySchema } from "@qmkvm/contracts";
import {
  payInvoiceWithBalance,
  markOrderPaid,
  appError,
} from "@qmkvm/core";
import { getGateway } from "@qmkvm/payments";
import { requireAuth } from "../../middleware/auth.js";

export const portalInvoiceRoutes = new Hono();
portalInvoiceRoutes.use("*", requireAuth());

function invoicePayload(inv: typeof schema.invoices.$inferSelect, items: (typeof schema.invoiceItems.$inferSelect)[]) {
  return {
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    type: inv.type,
    status: inv.status,
    subtotal: inv.subtotal,
    discount: inv.discount,
    total: inv.total,
    balanceUsed: inv.balanceUsed,
    dueAt: inv.dueAt?.toISOString?.() ?? null,
    paidAt: inv.paidAt?.toISOString?.() ?? null,
    createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : String(inv.createdAt),
    orderId: inv.orderId,
    items: items.map((it) => ({
      id: it.id,
      description: it.description,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
    })),
  };
}

portalInvoiceRoutes.get("/invoices", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const status = c.req.query("status");
  const where = status
    ? and(eq(schema.invoices.userId, user.id), eq(schema.invoices.status, status as never))
    : eq(schema.invoices.userId, user.id);
  const rows = await db
    .select()
    .from(schema.invoices)
    .where(where)
    .orderBy(desc(schema.invoices.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(where);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db.select().from(schema.invoiceItems).where(inArray(schema.invoiceItems.invoiceId, ids))
    : [];
  return c.json({
    items: rows.map((r) => invoicePayload(r, items.filter((i) => i.invoiceId === r.id))),
    total: totalRows.length,
    page: q.page,
    pageSize: q.pageSize,
  });
});

portalInvoiceRoutes.get("/invoices/:id", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const rows = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.userId, user.id)))
    .limit(1);
  const inv = rows[0];
  if (!inv) throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  const items = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, inv.id));
  return c.json(invoicePayload(inv, items));
});

const paySchema = z.object({
  gateway: z.enum(["alipay", "wechat", "mock"]).optional(),
  useBalance: z.boolean().optional(),
});

/**
 * 支付账单：
 * - useBalance=true → 余额支付（续费账单走 payRenewalInvoice 顺延到期日）
 * - gateway=alipay/wechat/mock → 创建支付单并返回 payUrl/qrCode
 */
portalInvoiceRoutes.post("/invoices/:id/pay", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const body = paySchema.parse(await c.req.json().catch(() => ({})));

  const rows = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.userId, user.id)))
    .limit(1);
  const inv = rows[0];
  if (!inv) throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  if (inv.status === "paid") return c.json({ paid: true, alreadyPaid: true });
  if (inv.status !== "unpaid") throw appError("BILL_INVOICE_STATUS_INVALID", "账单当前状态不可支付");

  // —— 余额支付 ——
  if (body.useBalance) {
    if (inv.type === "recharge") {
      throw appError("BILL_INVOICE_STATUS_INVALID", "充值账单请使用在线支付方式");
    }
    if (Number(user.creditBalance ?? 0) < inv.total) {
      throw appError("BILL_INSUFFICIENT_BALANCE", "余额不足，请先充值或选择在线支付");
    }
    if (inv.type === "renewal") {
      const { payRenewalInvoice } = await import("@qmkvm/core");
      await payRenewalInvoice(db, user.id, inv.id);
    } else {
      await payInvoiceWithBalance(db, user.id, inv.id);
      if (inv.orderId != null) {
        const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.id, inv.orderId)).limit(1);
        if (orderRows[0]?.status === "pending") {
          await db.transaction(async (tx) => {
            await markOrderPaid(tx, inv.orderId!);
          });
        }
      }
    }
    return c.json({ paid: true });
  }

  // —— 在线支付：创建支付单 ——
  const gatewayCode = body.gateway ?? "mock";
  const gateway = await getGateway(db, gatewayCode);
  if (!gateway) throw appError("PAY_GATEWAY_UNAVAILABLE", "该支付方式暂不可用");

  const timeoutMin = 30;
  const inserted = await db
    .insert(schema.paymentIntents)
    .values({
      userId: user.id,
      invoiceId: inv.id,
      gatewayCode,
      amount: inv.total,
      status: "created",
      expiresAt: new Date(Date.now() + timeoutMin * 60 * 1000),
    });
  const intentId = inserted[0].insertId;
  const outTradeNo = `PI${intentId}`;

  const pay = await gateway.createPayment({
    outTradeNo,
    amountFen: inv.total,
    subject: `账单 ${inv.invoiceNo}`,
    returnUrl: `${process.env.PORTAL_URL ?? "http://localhost:3001"}/invoices/${inv.id}?paid=1`,
    notifyUrl: `${process.env.API_PUBLIC_URL ?? process.env.PORTAL_URL ?? ""}/api/v1/webhooks/${gatewayCode}`,
  });

  await db
    .update(schema.paymentIntents)
    .set({
      status: "paying",
      gatewayPrepayId: pay.prepayId ?? null,
      payUrl: pay.payUrl ?? null,
      qrCode: pay.qrCode ?? null,
    })
    .where(eq(schema.paymentIntents.id, intentId));

  return c.json({
    paid: false,
    intentId,
    invoiceNo: inv.invoiceNo,
    amount: inv.total,
    payUrl: pay.payUrl ?? null,
    qrCode: pay.qrCode ?? null,
  });
});
