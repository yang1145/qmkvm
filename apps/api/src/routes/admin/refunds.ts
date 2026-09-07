/** 退款：列表（transactions.read）、创建退款（refunds.manage，走网关原路退回）。 */
import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import { pageQuerySchema, refundCreateSchema } from "@qmkvm/contracts";
import { createRefund } from "@qmkvm/payments";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact, writeAdminAudit } from "./helpers.js";

export const adminRefundRoutes = new Hono();

const { refunds, transactions, invoices, users } = schema;

const listQuery = z.object({
  ...pageQuerySchema.shape,
  status: z.enum(["pending", "succeeded", "failed"]).optional(),
});

adminRefundRoutes.get("/refunds", requireAdmin("transactions.read"), async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = q.status ? eq(refunds.status, q.status) : undefined;

  const rows = await db
    .select({ refund: refunds, txn: transactions, invoiceNo: invoices.invoiceNo, user: users })
    .from(refunds)
    .leftJoin(transactions, eq(transactions.id, refunds.transactionId))
    .leftJoin(invoices, eq(invoices.id, refunds.invoiceId))
    .leftJoin(users, eq(users.id, transactions.userId))
    .where(where)
    .orderBy(desc(refunds.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(refunds).where(where);

  return c.json({
    items: rows.map((r) => ({
      id: r.refund.id,
      transactionId: r.refund.transactionId,
      gatewayCode: r.txn?.gatewayCode ?? null,
      gatewayTxnId: r.txn?.gatewayTxnId ?? null,
      gatewayRefundId: r.refund.gatewayRefundId,
      invoiceId: r.refund.invoiceId,
      invoiceNo: r.invoiceNo,
      userId: r.txn?.userId ?? null,
      user: r.user ? { name: r.user.name, ...maskedContact(r.user) } : null,
      amount: r.refund.amount,
      status: r.refund.status,
      reason: r.refund.reason,
      adminId: r.refund.adminId,
      createdAt: iso(r.refund.createdAt),
      updatedAt: iso(r.refund.updatedAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** 创建退款（网关原路退回；成功后聚合账单退款状态并通知客户） */
adminRefundRoutes.post("/refunds", requireAdmin("refunds.manage"), async (c) => {
  const body = refundCreateSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const refund = await createRefund(getDb(), admin.adminId, {
    transactionId: body.transactionId,
    amount: body.amount,
    reason: body.reason,
  });
  await writeAdminAudit(c, admin, {
    action: "refund.create",
    targetType: "refund",
    targetId: refund.id,
    after: {
      transactionId: body.transactionId,
      amount: body.amount,
      reason: body.reason,
      status: refund.status,
      gatewayRefundId: refund.gatewayRefundId,
    },
  });
  return c.json({
    id: refund.id,
    transactionId: refund.transactionId,
    amount: refund.amount,
    status: refund.status,
    gatewayRefundId: refund.gatewayRefundId,
    reason: refund.reason,
    createdAt: iso(refund.createdAt),
  });
});
