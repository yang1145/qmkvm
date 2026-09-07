/** 工作台汇总（dashboardDto）：今日/本月新用户、订单数、GMV（已付账单合计）、支付成功率 + 待办计数。 */
import { Hono } from "hono";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDbRO, schema } from "@qmkvm/db";
import { requireAdmin } from "../../middleware/auth.js";

export const adminDashboardRoutes = new Hono();

const { users, orders, invoices, services, tickets, provisionTasks, transactions } = schema;

/** 时间窗口：UTC 自然日/自然月（与账单号前缀的 UTC 语义一致） */
function windowStart(now: Date, kind: "day" | "month"): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return kind === "day" ? new Date(Date.UTC(y, m, now.getUTCDate())) : new Date(Date.UTC(y, m, 1));
}

adminDashboardRoutes.get("/dashboard", requireAdmin("reports.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const now = new Date();
  const todayStart = windowStart(now, "day");
  const monthStart = windowStart(now, "month");

  const countUsers = async (since: Date): Promise<number> => {
    const rows = await db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .where(gte(users.createdAt, since));
    return Number(rows[0]?.n ?? 0);
  };

  const countOrders = async (since: Date): Promise<number> => {
    const rows = await db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(gte(orders.createdAt, since));
    return Number(rows[0]?.n ?? 0);
  };

  /** GMV：窗口内支付完成账单的 total 合计（分） */
  const paidGmv = async (since: Date): Promise<number> => {
    const rows = await db
      .select({ n: sql<number>`coalesce(sum(${invoices.total}), 0)` })
      .from(invoices)
      .where(and(eq(invoices.status, "paid"), gte(invoices.paidAt, since)));
    return Number(rows[0]?.n ?? 0);
  };

  /** 支付成功率：窗口内支付类交易 success / 全部（%，无数据时为 0） */
  const paymentSuccessRate = async (since: Date): Promise<number> => {
    const rows = await db
      .select({
        total: sql<number>`count(*)`,
        success: sql<number>`sum(case when ${transactions.status} = 'success' then 1 else 0 end)`,
      })
      .from(transactions)
      .where(and(eq(transactions.type, "payment"), gte(transactions.createdAt, since)));
    const total = Number(rows[0]?.total ?? 0);
    if (total === 0) return 0;
    return Math.round((Number(rows[0]?.success ?? 0) / total) * 1000) / 10;
  };

  const scalar = async (query: Promise<{ n: number | string }[]>): Promise<number> => {
    const rows = await query;
    return Number(rows[0]?.n ?? 0);
  };

  return c.json({
    today: {
      newUsers: await countUsers(todayStart),
      orders: await countOrders(todayStart),
      gmv: await paidGmv(todayStart),
      paymentSuccessRate: await paymentSuccessRate(todayStart),
    },
    month: {
      newUsers: await countUsers(monthStart),
      orders: await countOrders(monthStart),
      gmv: await paidGmv(monthStart),
    },
    pending: {
      unpaidInvoices: await scalar(
        db.select({ n: sql<number>`count(*)` }).from(invoices).where(eq(invoices.status, "unpaid")),
      ),
      overdueServices: await scalar(
        db.select({ n: sql<number>`count(*)` }).from(services).where(eq(services.status, "suspended_overdue")),
      ),
      openTickets: await scalar(
        db
          .select({ n: sql<number>`count(*)` })
          .from(tickets)
          .where(inArray(tickets.status, ["open", "customer_reply", "in_progress"])),
      ),
      provisionTasks: await scalar(
        db
          .select({ n: sql<number>`count(*)` })
          .from(provisionTasks)
          .where(inArray(provisionTasks.status, ["queued", "processing", "failed"])),
      ),
      deadTasks: await scalar(
        db.select({ n: sql<number>`count(*)` }).from(provisionTasks).where(eq(provisionTasks.status, "dead")),
      ),
    },
  });
});
