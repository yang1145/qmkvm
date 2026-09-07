/**
 * 报表与数据导出（PRD-billing F12）：
 * - /reports/*：收入、商品销量、留存（新增服务 vs 续费）、新增用户，按日聚合；
 * - 时间窗：from/to（YYYY-MM-DD，含头含尾），默认近 30 天；
 * - 权限：reports.read。
 */
import { Hono } from "hono";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDbRO, schema } from "@qmkvm/db";
import { appError, centsToYuan } from "@qmkvm/core";
import { requireAdmin } from "../../middleware/auth.js";

export const adminReportRoutes = new Hono();

const { users, orders, orderItems, invoices, services, products } = schema;

/** 日期窗口：from/to 为 YYYY-MM-DD；to 为结束日（含当天），返回 [fromStart, toEndExclusive) */
const rangeQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "from 需为 YYYY-MM-DD")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "to 需为 YYYY-MM-DD")
    .optional(),
});

function parseRange(c: { query: (k: string) => string | undefined }): { from: Date; to: Date } {
  const q = rangeQuery.parse({ from: c.query("from"), to: c.query("to") });
  const now = new Date();
  const toDay = q.to ? new Date(`${q.to}T00:00:00.000Z`) : now;
  const from = q.from
    ? new Date(`${q.from}T00:00:00.000Z`)
    : new Date(toDay.getTime() - 30 * 86400_000);
  const to = new Date(toDay.getTime() + 86400_000); // 含 to 当天
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw appError("VALIDATION_FAILED", "时间窗无效：from 需早于 to");
  }
  return { from, to };
}

const dayExpr = (col: unknown) => sql<string>`date_format(${col}, '%Y-%m-%d')`;

/** 按日聚合结果补零填充（图表需要连续日期轴） */
function fillDays(from: Date, to: Date, rows: { date: string }[]): string[] {
  const map = new Set(rows.map((r) => r.date));
  const out: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 86400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!map.has(d)) out.push(d);
  }
  return out;
}

/** 收入：paid 及以后账单按日 GMV / 订单数 */
adminReportRoutes.get("/reports/revenue", requireAdmin("reports.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const { from, to } = parseRange(c.req);
  const rows = await db
    .select({
      date: dayExpr(invoices.paidAt),
      gmv: sql<number>`coalesce(sum(${invoices.total}), 0)`,
      orders: sql<number>`count(*)`,
    })
    .from(invoices)
    .where(and(eq(invoices.status, "paid"), gte(invoices.paidAt, from), lt(invoices.paidAt, to)))
    .groupBy(dayExpr(invoices.paidAt))
    .orderBy(dayExpr(invoices.paidAt));

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const days: string[] = [];
  for (const r of rows) days.push(r.date);
  for (const d of fillDays(from, to, rows)) days.push(d);
  days.sort();
  return c.json({
    items: days.map((d) => ({
      date: d,
      gmv: centsToYuan(Number(byDate.get(d)?.gmv ?? 0)).toFixed(2),
      orders: Number(byDate.get(d)?.orders ?? 0),
    })),
    from: from.toISOString().slice(0, 10),
    to: new Date(to.getTime() - 86400_000).toISOString().slice(0, 10),
  });
});

/** 商品销量：paid 及以后订单的明细 join 商品，按商品聚合 */
adminReportRoutes.get("/reports/products", requireAdmin("reports.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const { from, to } = parseRange(c.req);
  const rows = await db
    .select({
      productId: orderItems.productId,
      name: products.name,
      count: sql<number>`coalesce(sum(${orderItems.qty}), 0)`,
      revenue: sql<number>`coalesce(sum(${orderItems.amount}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(
      and(
        inArray(orders.status, ["paid", "processing", "completed"]),
        gte(orders.createdAt, from),
        lt(orders.createdAt, to),
      ),
    )
    .groupBy(orderItems.productId, products.name)
    .orderBy(sql`coalesce(sum(${orderItems.amount}), 0) desc`)
    .limit(100);

  return c.json({
    items: rows.map((r) => ({
      productId: r.productId,
      name: r.name ?? "（已删除商品）",
      count: Number(r.count),
      revenue: centsToYuan(Number(r.revenue)).toFixed(2),
    })),
    from: from.toISOString().slice(0, 10),
    to: new Date(to.getTime() - 86400_000).toISOString().slice(0, 10),
  });
});

/** 留存：新增服务 vs paid 续费单按日（续费率 = 续费单数 / 存量服务可按前端口径自行计算） */
adminReportRoutes.get("/reports/retention", requireAdmin("reports.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const { from, to } = parseRange(c.req);

  const newRows = await db
    .select({ date: dayExpr(services.createdAt), n: sql<number>`count(*)` })
    .from(services)
    .where(and(gte(services.createdAt, from), lt(services.createdAt, to)))
    .groupBy(dayExpr(services.createdAt));
  const renewalRows = await db
    .select({ date: dayExpr(invoices.paidAt), n: sql<number>`count(*)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.type, "renewal"),
        eq(invoices.status, "paid"),
        gte(invoices.paidAt, from),
        lt(invoices.paidAt, to),
      ),
    )
    .groupBy(dayExpr(invoices.paidAt));

  const newMap = new Map(newRows.map((r) => [r.date, Number(r.n)]));
  const renewalMap = new Map(renewalRows.map((r) => [r.date, Number(r.n)]));
  const seen = new Set([...newRows.map((r) => r.date), ...renewalRows.map((r) => r.date)]);
  const days: string[] = [];
  for (const d of seen) days.push(d);
  for (const d of fillDays(from, to, [...seen].map((date) => ({ date })))) days.push(d);
  days.sort();
  return c.json({
    items: days.map((d) => ({
      date: d,
      newServices: newMap.get(d) ?? 0,
      renewals: renewalMap.get(d) ?? 0,
    })),
    from: from.toISOString().slice(0, 10),
    to: new Date(to.getTime() - 86400_000).toISOString().slice(0, 10),
  });
});

/** 新增用户按日 */
adminReportRoutes.get("/reports/users", requireAdmin("reports.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const { from, to } = parseRange(c.req);
  const rows = await db
    .select({ date: dayExpr(users.createdAt), count: sql<number>`count(*)` })
    .from(users)
    .where(and(gte(users.createdAt, from), lt(users.createdAt, to)))
    .groupBy(dayExpr(users.createdAt))
    .orderBy(dayExpr(users.createdAt));

  const byDate = new Map(rows.map((r) => [r.date, Number(r.count)]));
  const days: string[] = [];
  for (const r of rows) days.push(r.date);
  for (const d of fillDays(from, to, rows)) days.push(d);
  days.sort();
  return c.json({
    items: days.map((d) => ({ date: d, count: byDate.get(d) ?? 0 })),
    from: from.toISOString().slice(0, 10),
    to: new Date(to.getTime() - 86400_000).toISOString().slice(0, 10),
  });
});
