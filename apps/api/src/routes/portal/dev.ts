import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@pinhaoji/db";

type User = typeof schema.users.$inferSelect;
import { appError } from "@pinhaoji/core";
import { handleGatewayCallback, processPaymentEvent } from "@pinhaoji/payments";
import { requireAuth } from "../../middleware/auth.js";
import { env } from "../../env.js";

/**
 * 开发辅助：mock 网关立即支付（仅非生产 + DEV_MOCK_PAYMENTS）。
 * 复用真实回调管线：handleGatewayCallback(mock) → processPaymentEvent，保证幂等语义一致。
 */
export const portalDevRoutes = new Hono();

portalDevRoutes.post("/dev/mock-pay/:invoiceNo", requireAuth(), async (c) => {
  if (env.isProd || !env.devMockPayments) throw appError("NOT_FOUND", "未开放");
  const invoiceNo = c.req.param("invoiceNo");
  const user = c.get("user") as User;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.invoiceNo, invoiceNo), eq(schema.invoices.userId, user.id)))
    .limit(1);
  const inv = rows[0];
  if (!inv) throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  if (inv.status === "paid") return c.json({ paid: true, alreadyPaid: true });

  const intentRows = await db
    .select()
    .from(schema.paymentIntents)
    .where(and(eq(schema.paymentIntents.invoiceId, inv.id), eq(schema.paymentIntents.gatewayCode, "mock")))
    .orderBy(desc(schema.paymentIntents.id))
    .limit(1);
  let intent = intentRows[0];
  if (!intent || ["success", "expired", "canceled"].includes(intent.status)) {
    const inserted = await db
      .insert(schema.paymentIntents)
      .values({
        userId: user.id,
        invoiceId: inv.id,
        gatewayCode: "mock",
        amount: inv.total,
        status: "paying",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });
    const created = await db
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, inserted[0].insertId))
      .limit(1);
    intent = created[0]!;
  }

  const payload = {
    outTradeNo: `PI${intent.id}`,
    gatewayTxnId: `mock_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    amountFen: intent.amount,
  };
  const res = await handleGatewayCallback(db, "mock", {
    headers: {},
    rawBody: JSON.stringify(payload),
    query: {},
  });
  if (res.status !== 200) return c.json({ ok: false, step: "callback", res }, 500);

  // Redis 队列模式下事件由 Worker 异步消费；dev 端点同步处理一次保证体验
  const evRows = await db
    .select()
    .from(schema.gatewayEvents)
    .where(eq(schema.gatewayEvents.gatewayCode, "mock"))
    .orderBy(desc(schema.gatewayEvents.id))
    .limit(1);
  const ev = evRows[0];
  if (ev && ev.status === "received") {
    await processPaymentEvent(db, ev.id);
  }
  const after = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)).limit(1);
  return c.json({ paid: after[0]?.status === "paid" });
});
