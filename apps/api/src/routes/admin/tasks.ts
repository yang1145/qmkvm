/** 供应任务：列表（status/action 筛选）、重试、跳过（tasks.manage）。 */
import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";
import {
  idParamSchema,
  pageQuerySchema,
  provisionActionEnum,
  provisionStatusEnum,
  provisionTaskDto,
} from "@pinhaoji/contracts";
import { retryTask, skipTask } from "@pinhaoji/provisioning";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

export const adminTaskRoutes = new Hono();

const { provisionTasks, services, users } = schema;

const listQuery = z.object({
  ...pageQuerySchema.shape,
  status: provisionStatusEnum.optional(),
  action: provisionActionEnum.optional(),
  serviceId: z.coerce.number().int().positive().optional(),
});

adminTaskRoutes.get("/tasks", requireAdmin("tasks.manage"), async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = and(
    q.status ? eq(provisionTasks.status, q.status) : undefined,
    q.action ? eq(provisionTasks.action, q.action) : undefined,
    q.serviceId ? eq(provisionTasks.serviceId, q.serviceId) : undefined,
  );

  const rows = await db
    .select({ task: provisionTasks, serviceName: services.name, userId: services.userId, userName: users.name })
    .from(provisionTasks)
    .leftJoin(services, eq(services.id, provisionTasks.serviceId))
    .leftJoin(users, eq(users.id, services.userId))
    .where(where)
    .orderBy(desc(provisionTasks.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(provisionTasks).where(where);

  return c.json({
    items: rows.map((r) => ({
      ...(provisionTaskDto.parse({
        id: r.task.id,
        serviceId: r.task.serviceId,
        action: r.task.action,
        status: r.task.status,
        attempts: r.task.attempts,
        maxAttempts: r.task.maxAttempts,
        lastError: r.task.lastError,
        createdAt: iso(r.task.createdAt),
        executedAt: iso(r.task.executedAt),
      }) as z.infer<typeof provisionTaskDto>),
      serviceName: r.serviceName,
      userId: r.userId,
      userName: r.userName,
      result: r.task.result,
      payload: r.task.payload,
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** 重试 failed/dead 任务（重新入队执行） */
adminTaskRoutes.post("/tasks/:id/retry", requireAdmin("tasks.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const admin = c.get("admin");
  await retryTask(getDb(), id);
  await writeAdminAudit(c, admin, {
    action: "task.retry",
    targetType: "provision_task",
    targetId: id,
  });
  return c.json({ ok: true });
});

/** 跳过 queued/failed 任务（记录原因） */
adminTaskRoutes.post("/tasks/:id/skip", requireAdmin("tasks.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z.object({ reason: z.string().min(1).max(255) }).parse(await c.req.json());
  const admin = c.get("admin");
  await skipTask(getDb(), id, body.reason);
  await writeAdminAudit(c, admin, {
    action: "task.skip",
    targetType: "provision_task",
    targetId: id,
    after: { reason: body.reason },
  });
  return c.json({ ok: true });
});
