/** 管理员与角色管理（admins.manage）：密码 hashPassword；角色 permissions 存 key 数组。 */
import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import {
  adminCreateSchema,
  idParamSchema,
  pageQuerySchema,
  roleUpsertSchema,
} from "@qmkvm/contracts";
import { ALL_PERMISSIONS, type PermissionKey } from "@qmkvm/contracts";
import { appError } from "@qmkvm/core";
import { hashPassword } from "@qmkvm/auth";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";
import { adminPayload } from "./auth.js";

export const adminAdminRoutes = new Hono();

const { adminUsers, adminRoles, adminSessions } = schema;

// —— 管理员 ——

const adminUpdateSchema = z.object({
  name: z.string().max(100).nullable().optional(),
  roleId: z.number().int().positive().nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  password: z.string().min(8).max(72).optional(),
});

adminAdminRoutes.get("/admins", requireAdmin("admins.manage"), async (c) => {
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const rows = await db
    .select({ admin: adminUsers, roleName: adminRoles.name })
    .from(adminUsers)
    .leftJoin(adminRoles, eq(adminRoles.id, adminUsers.roleId))
    .orderBy(desc(adminUsers.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(adminUsers);
  return c.json({
    items: rows.map((r) => ({
      ...adminPayload(r.admin),
      roleName: r.roleName,
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

adminAdminRoutes.post("/admins", requireAdmin("admins.manage"), async (c) => {
  const body = adminCreateSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const dup = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, body.username)).limit(1);
  if (dup[0]) throw appError("CONFLICT", `管理员账号已存在：${body.username}`);
  const roleRows = await db.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.id, body.roleId)).limit(1);
  if (!roleRows[0]) throw appError("NOT_FOUND", "角色不存在");
  const passwordHash = await hashPassword(body.password);
  const inserted = await db.insert(adminUsers).values({
    username: body.username,
    passwordHash,
    name: body.name ?? null,
    roleId: body.roleId,
  });
  const id = inserted[0].insertId;
  await writeAdminAudit(c, admin, {
    action: "admin.create",
    targetType: "admin_user",
    targetId: id,
    after: { username: body.username, roleId: body.roleId },
  });
  return c.json({ id });
});

adminAdminRoutes.put("/admins/:id", requireAdmin("admins.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = adminUpdateSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
  const target = rows[0];
  if (!target) throw appError("NOT_FOUND", "管理员不存在");
  if (body.roleId != null) {
    const roleRows = await db.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.id, body.roleId)).limit(1);
    if (!roleRows[0]) throw appError("NOT_FOUND", "角色不存在");
  }
  if (id === admin.adminId && body.status === "disabled") {
    throw appError("CONFLICT", "不能禁用自己的账号");
  }

  const passwordHash = body.password != null ? await hashPassword(body.password) : undefined;
  await db
    .update(adminUsers)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(passwordHash != null ? { passwordHash } : {}),
    })
    .where(eq(adminUsers.id, id));
  // 改密/禁用时吊销该管理员的全部会话（改密后需重新登录）
  if (passwordHash != null || body.status === "disabled") {
    await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.adminId, id));
  }
  await writeAdminAudit(c, admin, {
    action: "admin.update",
    targetType: "admin_user",
    targetId: id,
    before: { name: target.name, roleId: target.roleId, status: target.status },
    after: {
      name: body.name ?? null,
      roleId: body.roleId ?? null,
      status: body.status ?? null,
      passwordChanged: body.password != null,
    },
  });
  return c.json({ ok: true });
});

// —— 角色 ——

adminAdminRoutes.get("/roles", requireAdmin("admins.manage"), async (c) => {
  const db = getDb();
  const rows = await db.select().from(adminRoles).orderBy(adminRoles.id);
  const counts = await db
    .select({ roleId: adminUsers.roleId, n: sql<number>`count(*)` })
    .from(adminUsers)
    .groupBy(adminUsers.roleId);
  const countMap = new Map(counts.map((r) => [r.roleId, Number(r.n)]));
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      permissions: r.permissions ?? [],
      isSuper: r.isSuper,
      adminCount: countMap.get(r.id) ?? 0,
      createdAt: iso(r.createdAt),
    })),
    total: rows.length,
    page: 1,
    pageSize: rows.length,
  });
});

adminAdminRoutes.post("/roles", requireAdmin("admins.manage"), async (c) => {
  const body = roleUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  assertPermissionsValid(body.permissions);
  const dup = await db.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.name, body.name)).limit(1);
  if (dup[0]) throw appError("CONFLICT", `角色名已存在：${body.name}`);
  const inserted = await db.insert(adminRoles).values({
    name: body.name,
    permissions: body.permissions,
    isSuper: body.isSuper,
  });
  const id = inserted[0].insertId;
  await writeAdminAudit(c, admin, {
    action: "role.create",
    targetType: "admin_role",
    targetId: id,
    after: { name: body.name, isSuper: body.isSuper, permissions: body.permissions },
  });
  return c.json({ id });
});

adminAdminRoutes.put("/roles/:id", requireAdmin("admins.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = roleUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(adminRoles).where(eq(adminRoles.id, id)).limit(1);
  const role = rows[0];
  if (!role) throw appError("NOT_FOUND", "角色不存在");
  assertPermissionsValid(body.permissions);
  if (body.name !== role.name) {
    const dup = await db.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.name, body.name)).limit(1);
    if (dup[0]) throw appError("CONFLICT", `角色名已存在：${body.name}`);
  }
  await db
    .update(adminRoles)
    .set({ name: body.name, permissions: body.permissions, isSuper: body.isSuper })
    .where(eq(adminRoles.id, id));
  await writeAdminAudit(c, admin, {
    action: "role.update",
    targetType: "admin_role",
    targetId: id,
    before: { name: role.name, isSuper: role.isSuper, permissions: role.permissions ?? [] },
    after: { name: body.name, isSuper: body.isSuper, permissions: body.permissions },
  });
  return c.json({ ok: true });
});

function assertPermissionsValid(permissions: string[]): void {
  const invalid = permissions.filter((p) => !ALL_PERMISSIONS.includes(p as PermissionKey));
  if (invalid.length > 0) {
    throw appError("VALIDATION_FAILED", `未知权限点：${invalid.join(", ")}`);
  }
}
