import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { createdAt, id, updatedAt, type Json } from "./_shared.js";

/** 门户客户账户 */
export const users = mysqlTable(
  "users",
  {
    id: id(),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    name: varchar("name", { length: 100 }),
    /** 余额（分），只允许通过 creditLedger 流水变更 */
    creditBalance: bigint("credit_balance", { mode: "number" }).notNull().default(0),
    status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
    createdIp: varchar("created_ip", { length: 64 }),
    lastLoginAt: datetime("last_login_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_phone_uq").on(t.phone),
    uniqueIndex("users_email_uq").on(t.email),
  ],
);

/** 实名信息（证件号 AES-256-GCM 加密存储，脱敏展示） */
export const userProfiles = mysqlTable(
  "user_profiles",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", ["personal", "enterprise"]).notNull(),
    realName: varchar("real_name", { length: 100 }),
    idNumberEnc: text("id_number_enc"),
    companyName: varchar("company_name", { length: 200 }),
    creditCode: varchar("credit_code", { length: 50 }),
    status: mysqlEnum("status", ["unverified", "pending", "verified", "rejected"])
      .notNull()
      .default("unverified"),
    /** 审核驳回原因（rejected 时有值，重新提交后清空） */
    rejectReason: varchar("reject_reason", { length: 255 }),
    verifiedAt: datetime("verified_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("user_profiles_user_uq").on(t.userId)],
);

/** 门户会话（id 为不透明 token 的哈希） */
export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 255 }),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
    revokedAt: datetime("revoked_at", { mode: "date" }),
    lastSeenAt: datetime("last_seen_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** 短信验证码（哈希存储） */
export const smsCodes = mysqlTable(
  "sms_codes",
  {
    id: id(),
    phone: varchar("phone", { length: 20 }).notNull(),
    purpose: mysqlEnum("purpose", ["login", "reset", "bind"]).notNull(),
    codeHash: varchar("code_hash", { length: 128 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
    usedAt: datetime("used_at", { mode: "date" }),
    attempts: int("attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("sms_codes_phone_idx").on(t.phone, t.createdAt)],
);

export const passwordResetTokens = mysqlTable(
  "password_reset_tokens",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
    usedAt: datetime("used_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("prt_token_idx").on(t.tokenHash)],
);

/** 未来多身份登录（微信等）预留 */
export const userIdentities = mysqlTable(
  "user_identities",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", ["phone", "email", "wechat"]).notNull(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    meta: json("meta").$type<Json>(),
    verifiedAt: datetime("verified_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_identities_uq").on(t.type, t.identifier)],
);
