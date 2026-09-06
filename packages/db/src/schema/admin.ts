import {
  bigint,
  boolean,
  datetime,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { createdAt, id, updatedAt, type Json } from "./_shared.js";

export const adminRoles = mysqlTable("admin_roles", {
  id: id(),
  name: varchar("name", { length: 50 }).notNull(),
  /** 权限点 key 数组，见 @pinhaoji/contracts PERMISSIONS */
  permissions: json("permissions").$type<string[]>(),
  isSuper: boolean("is_super").notNull().default(false),
  createdAt: createdAt(),
});

export const adminUsers = mysqlTable(
  "admin_users",
  {
    id: id(),
    username: varchar("username", { length: 50 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 100 }),
    roleId: bigint("role_id", { mode: "number" }).references(() => adminRoles.id, {
      onDelete: "set null",
    }),
    status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
    lastLoginAt: datetime("last_login_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("admin_users_username_uq").on(t.username)],
);

export const adminSessions = mysqlTable(
  "admin_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    adminId: bigint("admin_id", { mode: "number" })
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 255 }),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
    revokedAt: datetime("revoked_at", { mode: "date" }),
    lastSeenAt: datetime("last_seen_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("admin_sessions_admin_idx").on(t.adminId)],
);

/** 审计日志：append-only，仅超管可读，保留 ≥ 180 天 */
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: id(),
    actorType: mysqlEnum("actor_type", ["admin", "user", "system"]).notNull(),
    actorId: bigint("actor_id", { mode: "number" }),
    actorName: varchar("actor_name", { length: 100 }),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 50 }),
    targetId: varchar("target_id", { length: 64 }),
    before: json("before").$type<Json>(),
    after: json("after").$type<Json>(),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 255 }),
    requestId: varchar("request_id", { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_action_idx").on(t.action, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorType, t.actorId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);
