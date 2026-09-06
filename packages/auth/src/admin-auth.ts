/** 后台管理员认证：登录 + RBAC 会话 + 失败审计 */

import { and, eq, gt, isNull } from "drizzle-orm";

import { ALL_PERMISSIONS, ERR, PERMISSIONS, type PermissionKey } from "@pinhaoji/contracts";
import { AppError } from "@pinhaoji/core/errors";
import type { Db } from "@pinhaoji/db/client";
import { adminRoles, adminSessions, adminUsers, auditLogs } from "@pinhaoji/db/schema";
import { createLogger } from "@pinhaoji/logger";

import { verifyPassword } from "./password.js";
import { randomToken, sha256hex } from "./crypto.js";

const log = createLogger("auth:admin");

export type AdminUser = typeof adminUsers.$inferSelect;
/** 不含密码哈希的安全视图（对外返回用） */
export type AdminUserSafe = Omit<AdminUser, "passwordHash">;

/** 管理员会话与门户一致：30 天滑动（剩余 < 15 天续满），lastSeen 每小时节流 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

export interface SessionMeta {
  ip?: string | null;
  ua?: string | null;
}

export interface AdminLoginResult {
  admin: AdminUserSafe;
  token: string;
  expiresAt: Date;
  permissions: PermissionKey[];
  isSuper: boolean;
}

export interface AdminSessionContext {
  admin: AdminUserSafe;
  permissions: PermissionKey[];
  isSuper: boolean;
}

function isPermissionKey(p: string): p is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, p);
}

/** 角色权限点（isSuper 返回全量），角色缺失时无任何权限 */
function permissionsOfRole(role: { permissions: string[] | null; isSuper: boolean } | null): {
  permissions: PermissionKey[];
  isSuper: boolean;
} {
  const isSuper = role?.isSuper ?? false;
  if (isSuper) return { permissions: [...ALL_PERMISSIONS], isSuper: true };
  return {
    permissions: (role?.permissions ?? []).filter(isPermissionKey),
    isSuper: false,
  };
}

/** 尽力写入审计日志（失败仅记日志，不阻断主流程） */
async function writeAudit(
  db: Db,
  entry: {
    actorId: number | null;
    actorName: string | null;
    action: string;
    after?: Record<string, unknown>;
    ip?: string | null;
    ua?: string | null;
  },
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorType: "admin",
      actorId: entry.actorId,
      actorName: entry.actorName,
      action: entry.action,
      targetType: "admin_user",
      targetId: entry.actorId != null ? String(entry.actorId) : null,
      after: entry.after,
      ip: entry.ip ?? null,
      userAgent: entry.ua?.slice(0, 255) ?? null,
    });
  } catch (err) {
    log.error({ err, action: entry.action }, "写入审计日志失败");
  }
}

/** 管理员登录：验证用户名密码，创建会话；失败写审计 */
export async function adminLogin(
  db: Db,
  username: string,
  password: string,
  meta: SessionMeta = {},
): Promise<AdminLoginResult> {
  const rows = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .limit(1);
  const admin = rows[0];

  const passwordOk = admin ? await verifyPassword(admin.passwordHash, password) : false;
  if (!admin || !passwordOk) {
    await writeAudit(db, {
      actorId: admin?.id ?? null,
      actorName: username,
      action: "admin.login_failed",
      after: { reason: "invalid_credentials" },
      ip: meta.ip,
      ua: meta.ua,
    });
    throw new AppError(ERR.AUTH_INVALID_CREDENTIALS, "用户名或密码错误");
  }
  if (admin.status === "disabled") {
    await writeAudit(db, {
      actorId: admin.id,
      actorName: username,
      action: "admin.login_failed",
      after: { reason: "disabled" },
      ip: meta.ip,
      ua: meta.ua,
    });
    throw new AppError(ERR.AUTH_DISABLED, "该管理员账号已被禁用");
  }

  let role: { permissions: string[] | null; isSuper: boolean } | null = null;
  if (admin.roleId != null) {
    const roleRows = await db
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.id, admin.roleId))
      .limit(1);
    role = roleRows[0] ?? null;
  }
  const { permissions, isSuper } = permissionsOfRole(role);

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(adminSessions).values({
    id: sha256hex(token),
    adminId: admin.id,
    ip: meta.ip ?? null,
    userAgent: meta.ua?.slice(0, 255) ?? null,
    expiresAt,
  });
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, admin.id));

  const { passwordHash: _passwordHash, ...safeAdmin } = admin;
  return { admin: safeAdmin, token, expiresAt, permissions, isSuper };
}

/**
 * 解析管理员会话：校验过期/已吊销/账号禁用；
 * 滑动续期与 lastSeen 节流同门户会话；权限实时读自 adminRoles。
 */
export async function resolveAdminSession(
  db: Db,
  token: string,
): Promise<AdminSessionContext | null> {
  if (!token) return null;
  const now = new Date();
  const rows = await db
    .select({ session: adminSessions, admin: adminUsers, role: adminRoles })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
    .leftJoin(adminRoles, eq(adminRoles.id, adminUsers.roleId))
    .where(
      and(
        eq(adminSessions.id, sha256hex(token)),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.admin.status === "disabled") return null;

  const remaining = row.session.expiresAt.getTime() - now.getTime();
  const lastSeenAt = row.session.lastSeenAt;
  const needsRenew = remaining < RENEW_THRESHOLD_MS;
  const needsSeen =
    !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS;
  if (needsRenew || needsSeen) {
    await db
      .update(adminSessions)
      .set({
        ...(needsRenew ? { expiresAt: new Date(now.getTime() + SESSION_TTL_MS) } : {}),
        ...(needsSeen ? { lastSeenAt: now } : {}),
      })
      .where(eq(adminSessions.id, row.session.id));
  }

  const { permissions, isSuper } = permissionsOfRole(row.role);
  const { passwordHash: _passwordHash, ...safeAdmin } = row.admin;
  return { admin: safeAdmin, permissions, isSuper };
}

/** 吊销单个管理员会话（幂等） */
export async function revokeAdminSession(db: Db, token: string): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(adminSessions.id, sha256hex(token)), isNull(adminSessions.revokedAt)),
    );
}
