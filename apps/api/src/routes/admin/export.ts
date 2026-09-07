/**
 * 数据导出（CSV）：客户 / 订单 / 账单。
 * - 格式：UTF-8 带 BOM（兼容 Excel），Content-Disposition attachment；
 * - 上限 10000 行，超出报 400（请缩小时间窗）；
 * - 时间窗 from/to（YYYY-MM-DD，含头含尾），默认近 30 天，按创建时间过滤；
 * - 联系方式脱敏输出；权限对应域 *.read。
 */
import { Hono } from "hono";
import { and, desc, eq, gte, like, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDbRO, schema } from "@qmkvm/db";
import {
  invoiceStatusEnum,
  invoiceTypeEnum,
  orderStatusEnum,
  orderTypeEnum,
} from "@qmkvm/contracts";
import { appError, centsToYuan } from "@qmkvm/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact } from "./helpers.js";

export const adminExportRoutes = new Hono();

const { users, orders, invoices } = schema;

const EXPORT_LIMIT = 10000;

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
  const to = new Date(toDay.getTime() + 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw appError("VALIDATION_FAILED", "时间窗无效：from 需早于 to");
  }
  return { from, to };
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvResponse(header: string[], rows: unknown[][], filename: string) {
  if (rows.length > EXPORT_LIMIT) {
    throw appError("VALIDATION_FAILED", `导出数据超过 ${EXPORT_LIMIT} 行上限，请缩小时间窗`);
  }
  const lines = [header.join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  const body = "\uFEFF" + lines.join("\r\n");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** 客户导出：ID/手机号(脱敏)/邮箱(脱敏)/状态/余额(元)/注册时间；筛选 q/status */
adminExportRoutes.get("/export/customers", requireAdmin("customers.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const { from, to } = parseRange(c.req);
  const q = c.req.query("q")?.trim().slice(0, 100);
  const status = z.enum(["active", "disabled"]).safeParse(c.req.query("status")).success
    ? (c.req.query("status") as "active" | "disabled")
    : undefined;
  const filters: SQL[] = [gte(users.createdAt, from), lt(users.createdAt, to)];
  if (status) filters.push(eq(users.status, status));
  if (q) {
    const kw = `%${q}%`;
    const cond = or(like(users.name, kw), like(users.phone, kw), like(users.email, kw));
    if (cond) filters.push(cond);
  }
  const rows = await db
    .select()
    .from(users)
    .where(and(...filters))
    .orderBy(desc(users.id))
    .limit(EXPORT_LIMIT + 1);

  return csvResponse(
    ["ID", "手机号", "邮箱", "状态", "余额(元)", "注册时间"],
    rows.map((u) => [
      u.id,
      maskedContact(u).phone ?? "",
      maskedContact(u).email ?? "",
      u.status === "active" ? "正常" : "已禁用",
      centsToYuan(u.creditBalance).toFixed(2),
      iso(u.createdAt),
    ]),
    `customers-${new Date().toISOString().slice(0, 10)}.csv`,
  );
});

/** 订单导出：ID/用户ID/类型/状态/小计/折扣/合计(元)/创建时间；筛选 status/type */
adminExportRoutes.get("/export/orders", requireAdmin("orders.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const { from, to } = parseRange(c.req);
  const status = orderStatusEnum.safeParse(c.req.query("status")).success
    ? (c.req.query("status") as z.infer<typeof orderStatusEnum>)
    : undefined;
  const type = orderTypeEnum.safeParse(c.req.query("type")).success
    ? (c.req.query("type") as z.infer<typeof orderTypeEnum>)
    : undefined;
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        gte(orders.createdAt, from),
        lt(orders.createdAt, to),
        status ? eq(orders.status, status) : undefined,
        type ? eq(orders.type, type) : undefined,
      ),
    )
    .orderBy(desc(orders.id))
    .limit(EXPORT_LIMIT + 1);

  const TYPE: Record<string, string> = {
    new: "新购",
    renewal: "续费",
    upgrade: "升级",
    recharge: "充值",
    manual: "人工",
  };
  const STATUS: Record<string, string> = {
    pending: "待支付",
    paid: "已支付",
    processing: "供应中",
    completed: "已完成",
    cancelled: "已取消",
    failed: "失败",
  };
  return csvResponse(
    ["ID", "用户ID", "类型", "状态", "小计(元)", "折扣(元)", "合计(元)", "创建时间"],
    rows.map((o) => [
      o.id,
      o.userId,
      TYPE[o.type] ?? o.type,
      STATUS[o.status] ?? o.status,
      centsToYuan(o.subtotal).toFixed(2),
      centsToYuan(o.discount).toFixed(2),
      centsToYuan(o.total).toFixed(2),
      iso(o.createdAt),
    ]),
    `orders-${new Date().toISOString().slice(0, 10)}.csv`,
  );
});

/** 账单导出：账单号/用户ID/类型/状态/金额(元)/支付时间/创建时间；筛选 status/type */
adminExportRoutes.get("/export/invoices", requireAdmin("invoices.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const { from, to } = parseRange(c.req);
  const status = invoiceStatusEnum.safeParse(c.req.query("status")).success
    ? (c.req.query("status") as z.infer<typeof invoiceStatusEnum>)
    : undefined;
  const type = invoiceTypeEnum.safeParse(c.req.query("type")).success
    ? (c.req.query("type") as z.infer<typeof invoiceTypeEnum>)
    : undefined;
  const rows = await db
    .select()
    .from(invoices)
    .where(
      and(
        gte(invoices.createdAt, from),
        lt(invoices.createdAt, to),
        status ? eq(invoices.status, status) : undefined,
        type ? eq(invoices.type, type) : undefined,
      ),
    )
    .orderBy(desc(invoices.id))
    .limit(EXPORT_LIMIT + 1);

  const TYPE: Record<string, string> = {
    order: "订单",
    renewal: "续费",
    upgrade: "升级",
    recharge: "充值",
    manual: "人工",
  };
  const STATUS: Record<string, string> = {
    unpaid: "未支付",
    paid: "已支付",
    void: "已作废",
    refunded: "已退款",
    partially_refunded: "部分退款",
  };
  return csvResponse(
    ["账单号", "用户ID", "类型", "状态", "金额(元)", "支付时间", "创建时间"],
    rows.map((i) => [
      i.invoiceNo,
      i.userId,
      TYPE[i.type] ?? i.type,
      STATUS[i.status] ?? i.status,
      centsToYuan(i.total).toFixed(2),
      iso(i.paidAt),
      iso(i.createdAt),
    ]),
    `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
  );
});

/** 交易流水导出：ID/用户ID/类型/网关/金额(元)/状态/创建时间；筛选 status/type */
adminExportRoutes.get("/export/transactions", requireAdmin("transactions.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const { from, to } = parseRange(c.req);
  const status = z.enum(["pending", "success", "failed", "refunded"]).safeParse(c.req.query("status"))
    .success
    ? (c.req.query("status") as "pending" | "success" | "failed" | "refunded")
    : undefined;
  const type = z.enum(["payment", "refund"]).safeParse(c.req.query("type")).success
    ? (c.req.query("type") as "payment" | "refund")
    : undefined;
  const rows = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        gte(schema.transactions.createdAt, from),
        lt(schema.transactions.createdAt, to),
        status ? eq(schema.transactions.status, status) : undefined,
        type ? eq(schema.transactions.type, type) : undefined,
      ),
    )
    .orderBy(desc(schema.transactions.id))
    .limit(EXPORT_LIMIT + 1);

  const TYPE: Record<string, string> = { payment: "支付", refund: "退款" };
  const STATUS: Record<string, string> = {
    pending: "处理中",
    success: "成功",
    failed: "失败",
    refunded: "已退款",
  };
  return csvResponse(
    ["ID", "用户ID", "类型", "网关", "金额(元)", "状态", "创建时间"],
    rows.map((t) => [
      t.id,
      t.userId,
      TYPE[t.type] ?? t.type,
      t.gatewayCode,
      centsToYuan(t.amount).toFixed(2),
      STATUS[t.status] ?? t.status,
      iso(t.createdAt),
    ]),
    `transactions-${new Date().toISOString().slice(0, 10)}.csv`,
  );
});
