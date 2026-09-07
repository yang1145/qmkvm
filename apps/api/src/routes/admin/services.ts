/** 服务实例管理：列表、生命周期动作（建供应任务）、手工标记开通、改名。 */
import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import { idParamSchema, pageQuerySchema, serviceActionSchema, serviceStatusEnum } from "@qmkvm/contracts";
import { appError, createProvisionTask, manuallyCompleteProvision } from "@qmkvm/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact, writeAdminAudit } from "./helpers.js";

export const adminServiceRoutes = new Hono();

const { services, products, users } = schema;

const listQuery = z.object({
  ...pageQuerySchema.shape,
  status: serviceStatusEnum.optional(),
  userId: z.coerce.number().int().positive().optional(),
  productId: z.coerce.number().int().positive().optional(),
});

adminServiceRoutes.get("/services", requireAdmin("services.read"), async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = and(
    q.status ? eq(services.status, q.status) : undefined,
    q.userId ? eq(services.userId, q.userId) : undefined,
    q.productId ? eq(services.productId, q.productId) : undefined,
  );

  const rows = await db
    .select({ svc: services, productName: products.name, user: users })
    .from(services)
    .leftJoin(products, eq(products.id, services.productId))
    .leftJoin(users, eq(users.id, services.userId))
    .where(where)
    .orderBy(desc(services.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(services).where(where);

  return c.json({
    items: rows.map((r) => ({
      id: r.svc.id,
      userId: r.svc.userId,
      user: r.user ? { name: r.user.name, ...maskedContact(r.user) } : null,
      name: r.svc.name,
      productId: r.svc.productId,
      productName: r.productName,
      status: r.svc.status,
      cycle: r.svc.cycle,
      firstAmount: r.svc.firstAmount,
      renewalAmount: r.svc.renewalAmount,
      nextDueDate: r.svc.nextDueDate,
      moduleCode: r.svc.moduleCode,
      deliverInfo: r.svc.deliverInfo,
      cancelAtPeriodEnd: r.svc.cancelAtPeriodEnd,
      createdAt: iso(r.svc.createdAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** 服务详情（含 config 快照与交付信息） */
adminServiceRoutes.get("/services/:id", requireAdmin("services.read"), async (c) => {
  const db = getDb();
  const id = idParamSchema.parse(c.req.param()).id;
  const rows = await db
    .select({ svc: services, productName: products.name, user: users })
    .from(services)
    .leftJoin(products, eq(products.id, services.productId))
    .leftJoin(users, eq(users.id, services.userId))
    .where(eq(services.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw appError("SVC_NOT_FOUND", "服务不存在");
  return c.json({
    id: row.svc.id,
    userId: row.svc.userId,
    user: row.user ? { name: row.user.name, phone: row.user.phone, email: row.user.email } : null,
    name: row.svc.name,
    productId: row.svc.productId,
    productName: row.productName,
    orderId: row.svc.orderId,
    status: row.svc.status,
    cycle: row.svc.cycle,
    firstAmount: row.svc.firstAmount,
    renewalAmount: row.svc.renewalAmount,
    nextDueDate: row.svc.nextDueDate,
    config: row.svc.config,
    moduleCode: row.svc.moduleCode,
    moduleConfig: row.svc.moduleConfig,
    deliverInfo: row.svc.deliverInfo,
    suspendedAt: iso(row.svc.suspendedAt),
    terminatedAt: iso(row.svc.terminatedAt),
    createdAt: iso(row.svc.createdAt),
  });
});

/** 生命周期动作：创建供应任务并入队执行（provision/suspend/unsuspend/terminate/sync） */
adminServiceRoutes.post("/services/:id/action", requireAdmin("services.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = serviceActionSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();

  const rows = await db.select().from(services).where(eq(services.id, id)).limit(1);
  const service = rows[0];
  if (!service) throw appError("SVC_NOT_FOUND", "服务不存在");

  const task = await createProvisionTask(db, {
    serviceId: id,
    action: body.action,
    payload: body.reason ? { reason: body.reason } : undefined,
    createdById: admin.adminId,
  });
  await writeAdminAudit(c, admin, {
    action: "service.action",
    targetType: "service",
    targetId: id,
    before: { status: service.status },
    after: { action: body.action, reason: body.reason ?? null, taskId: task.id },
  });
  return c.json({ ok: true, taskId: task.id });
});

/** 手工标记开通（manual 模块配套；core 自带 service.manual_complete 审计并通知客户） */
adminServiceRoutes.post("/services/:id/manual-complete", requireAdmin("services.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z
    .object({
      deliverInfo: z.record(z.string(), z.unknown()).optional(),
      activate: z.boolean().optional(),
    })
    .parse(await c.req.json().catch(() => ({})));
  const admin = c.get("admin");

  const service = await manuallyCompleteProvision(getDb(), admin.adminId, id, {
    deliverInfo: body.deliverInfo,
    activate: body.activate ?? true,
  });
  return c.json({
    ok: true,
    service: {
      id: service.id,
      status: service.status,
      nextDueDate: service.nextDueDate,
      deliverInfo: service.deliverInfo,
    },
  });
});

/** 修改服务显示名称 */
adminServiceRoutes.patch("/services/:id", requireAdmin("services.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z.object({ name: z.string().min(1).max(150) }).parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();

  const rows = await db.select().from(services).where(eq(services.id, id)).limit(1);
  const service = rows[0];
  if (!service) throw appError("SVC_NOT_FOUND", "服务不存在");
  if (service.name !== body.name) {
    await db.update(services).set({ name: body.name }).where(eq(services.id, id));
  }
  await writeAdminAudit(c, admin, {
    action: "service.rename",
    targetType: "service",
    targetId: id,
    before: { name: service.name },
    after: { name: body.name },
  });
  return c.json({ ok: true });
});
