import { Hono } from "hono";
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@qmkvm/db";

type User = typeof schema.users.$inferSelect;
import { portalAuthRoutes, userPayload } from "./auth.js";
import { portalAccountRoutes } from "./account.js";
import { portalCartRoutes } from "./cart.js";
import { portalCheckoutRoutes } from "./checkout.js";
import { portalOrderRoutes } from "./orders.js";
import { portalInvoiceRoutes } from "./invoices.js";
import { portalFapiaoRoutes } from "./fapiao.js";
import { portalServiceRoutes } from "./services.js";
import { portalCreditRoutes } from "./credits.js";
import { portalTicketRoutes } from "./tickets.js";
import { portalKbRoutes } from "./kb.js";
import { portalNotificationRoutes } from "./notifications.js";
import { portalDevRoutes } from "./dev.js";
import { requireAuth } from "../../middleware/auth.js";

/**
 * 门户路由：auth 前置（免登录）→ requireAuth → 业务路由。
 * Hono 按注册顺序应用中间件。
 */
export const portalRoutes = new Hono();

portalRoutes.route("/auth", portalAuthRoutes);

/** 工作台汇总（需登录） */
portalRoutes.get("/me/summary", requireAuth(), async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const unpaid = await db
    .select({
      id: schema.invoices.id,
      invoiceNo: schema.invoices.invoiceNo,
      total: schema.invoices.total,
      type: schema.invoices.type,
      createdAt: schema.invoices.createdAt,
    })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.userId, user.id), eq(schema.invoices.status, "unpaid")))
    .limit(5);
  const unpaidTotal = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.userId, user.id), eq(schema.invoices.status, "unpaid")));

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const dueSoon = await db
    .select({ id: schema.services.id })
    .from(schema.services)
    .where(
      and(
        eq(schema.services.userId, user.id),
        eq(schema.services.status, "active"),
        gte(schema.services.nextDueDate, today),
        lte(schema.services.nextDueDate, in30),
      ),
    );
  const openTickets = await db
    .select({ id: schema.tickets.id })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.userId, user.id), eq(schema.tickets.status, "customer_reply")));

  return c.json({
    user: userPayload(user),
    balance: Number(user.creditBalance ?? 0),
    unpaidInvoices: unpaid.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      total: i.total,
      type: i.type,
      createdAt: i.createdAt instanceof Date ? i.createdAt.toISOString() : String(i.createdAt),
    })),
    unpaidCount: unpaidTotal.length,
    dueSoonCount: dueSoon.length,
    ticketsAwaitingReply: openTickets.length,
  });
});

/** 知识库公开读（免登录），必须挂在 requireAuth 之前 */
portalRoutes.route("/kb", portalKbRoutes);

portalRoutes.use("*", requireAuth());
portalRoutes.route("/account", portalAccountRoutes);
portalRoutes.route("/", portalCartRoutes);
portalRoutes.route("/", portalCheckoutRoutes);
portalRoutes.route("/", portalOrderRoutes);
portalRoutes.route("/", portalInvoiceRoutes);
portalRoutes.route("/", portalFapiaoRoutes);
portalRoutes.route("/", portalServiceRoutes);
portalRoutes.route("/", portalCreditRoutes);
portalRoutes.route("/", portalTicketRoutes);
portalRoutes.route("/", portalNotificationRoutes);
portalRoutes.route("/", portalDevRoutes);
