/** 交易流水列表 + 手动掉单补偿（reconcile）。 */
import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import { pageQuerySchema } from "@qmkvm/contracts";
import { queryAndSettleStaleIntents } from "@qmkvm/payments";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact, writeAdminAudit } from "./helpers.js";

export const adminTransactionRoutes = new Hono();

const { transactions, invoices, users } = schema;

const listQuery = z.object({
  ...pageQuerySchema.shape,
  status: z.enum(["pending", "success", "failed", "refunded"]).optional(),
  type: z.enum(["payment", "refund"]).optional(),
  gatewayCode: z.string().max(30).optional(),
  userId: z.coerce.number().int().positive().optional(),
});

adminTransactionRoutes.get("/transactions", requireAdmin("transactions.read"), async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = and(
    q.status ? eq(transactions.status, q.status) : undefined,
    q.type ? eq(transactions.type, q.type) : undefined,
    q.gatewayCode ? eq(transactions.gatewayCode, q.gatewayCode) : undefined,
    q.userId ? eq(transactions.userId, q.userId) : undefined,
  );

  const rows = await db
    .select({ txn: transactions, invoiceNo: invoices.invoiceNo, user: users })
    .from(transactions)
    .leftJoin(invoices, eq(invoices.id, transactions.invoiceId))
    .leftJoin(users, eq(users.id, transactions.userId))
    .where(where)
    .orderBy(desc(transactions.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(transactions).where(where);

  return c.json({
    items: rows.map((r) => ({
      id: r.txn.id,
      userId: r.txn.userId,
      user: r.user ? { name: r.user.name, ...maskedContact(r.user) } : null,
      invoiceId: r.txn.invoiceId,
      invoiceNo: r.invoiceNo,
      paymentIntentId: r.txn.paymentIntentId,
      gatewayCode: r.txn.gatewayCode,
      gatewayTxnId: r.txn.gatewayTxnId,
      type: r.txn.type,
      amount: r.txn.amount,
      fee: r.txn.fee,
      currency: r.txn.currency,
      status: r.txn.status,
      createdAt: iso(r.txn.createdAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** 手动触发掉单补偿：paying 状态未过期支付意图主动查网关并结算 */
adminTransactionRoutes.post("/reconcile/run", requireAdmin("invoices.manage"), async (c) => {
  const admin = c.get("admin");
  const result = await queryAndSettleStaleIntents(getDb(), new Date());
  await writeAdminAudit(c, admin, {
    action: "payment.reconcile",
    after: { settled: result.settled },
  });
  return c.json({ ok: true, settled: result.settled });
});
