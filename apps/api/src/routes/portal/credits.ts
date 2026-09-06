import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";

type User = typeof schema.users.$inferSelect;
import { pageQuerySchema } from "@pinhaoji/contracts";
import { appError } from "@pinhaoji/core";
import { requireAuth } from "../../middleware/auth.js";

export const portalCreditRoutes = new Hono();
portalCreditRoutes.use("*", requireAuth());

/** 余额与流水 */
portalCreditRoutes.get("/credits", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const where = eq(schema.creditLedger.userId, user.id);
  const rows = await db
    .select()
    .from(schema.creditLedger)
    .where(where)
    .orderBy(desc(schema.creditLedger.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const all = await db.select({ id: schema.creditLedger.id }).from(schema.creditLedger).where(where);
  return c.json({
    balance: Number(user.creditBalance ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      remark: r.remark,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
    total: all.length,
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** 余额充值：生成充值账单 + 支付单（mock/支付宝/微信） */
portalCreditRoutes.post("/credits/recharge", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const body = z
    .object({ amount: z.number().int().min(100, "最低充值 ¥1").max(10_000_000) })
    .parse(await c.req.json());

  const { createInvoiceWithItems, generateInvoiceNo } = await import("@pinhaoji/core");
  const invoiceNo = await generateInvoiceNo(db);
  const inserted = await db
    .insert(schema.invoices)
    .values({
      userId: user.id,
      invoiceNo,
      type: "recharge",
      status: "unpaid",
      subtotal: body.amount,
      total: body.amount,
    });
  const invoiceId = inserted[0].insertId;
  await db.insert(schema.invoiceItems).values({
    invoiceId,
    description: "账户余额充值",
    qty: 1,
    unitPrice: body.amount,
    amount: body.amount,
  });

  const { getGateway } = await import("@pinhaoji/payments");
  const gatewayCode = (c.req.query("gateway") as "alipay" | "wechat" | "mock" | undefined) ?? "mock";
  const gateway = await getGateway(db, gatewayCode);
  if (!gateway) throw appError("PAY_GATEWAY_UNAVAILABLE", "该支付方式暂不可用");

  const intentInserted = await db
    .insert(schema.paymentIntents)
    .values({
      userId: user.id,
      invoiceId,
      gatewayCode,
      amount: body.amount,
      status: "created",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
  const intentId = intentInserted[0].insertId;

  const invoiceNo0 = invoiceNo;
  const pay = await gateway.createPayment({
    outTradeNo: `PI${intentId}`,
    amountFen: body.amount,
    subject: `余额充值 ${invoiceNo0}`,
    returnUrl: `${process.env.PORTAL_URL ?? "http://localhost:3001"}/credits?recharged=1`,
    notifyUrl: `${process.env.API_PUBLIC_URL ?? ""}/api/v1/webhooks/${gatewayCode}`,
  });
  await db
    .update(schema.paymentIntents)
    .set({ status: "paying", payUrl: pay.payUrl ?? null, qrCode: pay.qrCode ?? null, gatewayPrepayId: pay.prepayId ?? null })
    .where(eq(schema.paymentIntents.id, intentId));

  return c.json({
    invoiceId,
    invoiceNo,
    amount: body.amount,
    intentId,
    payUrl: pay.payUrl ?? null,
    qrCode: pay.qrCode ?? null,
  });
});
