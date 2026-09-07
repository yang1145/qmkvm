/** 审计日志查询（audit.read）：action/actor/日期筛选。 */
import { Hono } from "hono";
import { and, desc, eq, gte, like, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDbRO, schema } from "@qmkvm/db";
import { pageQuerySchema } from "@qmkvm/contracts";
import { requireAdmin } from "../../middleware/auth.js";
import { iso } from "./helpers.js";

export const adminAuditLogRoutes = new Hono();

const { auditLogs } = schema;

const listQuery = z.object({
  ...pageQuerySchema.shape,
  action: z.string().max(100).optional(),
  actorType: z.enum(["admin", "user", "system"]).optional(),
  actorId: z.coerce.number().int().positive().optional(),
  /** ISO 日期（YYYY-MM-DD）或完整时间戳；from ≥ / to ≤ */
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

/** "YYYY-MM-DD" 补全为 UTC 全天边界；完整时间戳原样解析 */
function parseDateBound(v: string, endOfDay: boolean): Date {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}` : v;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    return new Date(Number.NaN);
  }
  return d;
}

adminAuditLogRoutes.get("/audit-logs", requireAdmin("audit.read"), async (c) => {
  const db = getDbRO(); // 只读副本（可容忍主从延迟的读路径）；未配置 DATABASE_URL_RO 时回落主库
  const q = listQuery.parse(c.req.query());

  const conditions: SQL[] = [];
  if (q.action) conditions.push(like(auditLogs.action, `${q.action}%`));
  if (q.actorType) conditions.push(eq(auditLogs.actorType, q.actorType));
  if (q.actorId) conditions.push(eq(auditLogs.actorId, q.actorId));
  if (q.from) {
    const d = parseDateBound(q.from, false);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(auditLogs.createdAt, d));
  }
  if (q.to) {
    const d = parseDateBound(q.to, true);
    if (!Number.isNaN(d.getTime())) conditions.push(lte(auditLogs.createdAt, d));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(auditLogs).where(where);

  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      actorType: r.actorType,
      actorId: r.actorId,
      actorName: r.actorName,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      before: r.before,
      after: r.after,
      ip: r.ip,
      requestId: r.requestId,
      createdAt: iso(r.createdAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});
