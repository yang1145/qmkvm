/** 门户账户用例：注册登录、密码认证、找回/修改密码、换绑手机 */

import { and, eq, gt, isNull } from "drizzle-orm";

import { ERR, PHONE_RE } from "@qmkvm/contracts";
import { AppError } from "@qmkvm/core/errors";
import { enqueueJob } from "@qmkvm/core/queue";
import type { Db } from "@qmkvm/db/client";
import { passwordResetTokens, users } from "@qmkvm/db/schema";
import { createLogger } from "@qmkvm/logger";

import { maskPhone, randomToken, sha256hex } from "./crypto.js";
import { hashPassword, verifyPassword } from "./password.js";
import { revokeAllPortalSessions, type User } from "./session.js";
import { verifySmsCode } from "./sms-code.js";

const log = createLogger("auth:account");

/** 一次性重置 token 有效期：15 分钟 */
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

export type EmailSender = (to: string, subject: string, html: string) => Promise<void>;

function isDupEntry(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "ER_DUP_ENTRY"
  );
}

function portalUrl(): string {
  return process.env.PORTAL_URL ?? "http://localhost:3001";
}

async function findUserById(db: Db, userId: number): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

async function findUserByPhone(db: Db, phone: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  return rows[0] ?? null;
}

async function findUserByEmail(db: Db, email: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

/** 注册成功站内通知（通知失败不阻断注册） */
async function notifyRegistered(userId: number, name: string | null, phone: string | null): Promise<void> {
  try {
    await enqueueJob("notify.user", {
      userId,
      event: "user.registered",
      vars: { user: { name: name ?? (phone ? maskPhone(phone) : "") } },
    });
  } catch (err) {
    log.error({ err, userId }, "注册通知入队失败");
  }
}

/**
 * 手机号验证码注册/登录合一：存在即登录（更新 lastLoginAt），不存在创建（记 createdIp）。
 */
export async function registerOrLoginBySms(
  db: Db,
  input: { phone: string; name?: string | null; ip?: string | null },
): Promise<User> {
  const { phone, name, ip } = input;
  const existing = await findUserByPhone(db, phone);
  if (existing) {
    const lastLoginAt = new Date();
    await db.update(users).set({ lastLoginAt }).where(eq(users.id, existing.id));
    return { ...existing, lastLoginAt };
  }

  let insertId: number | undefined;
  try {
    const result = await db.insert(users).values({
      phone,
      name: name ?? null,
      createdIp: ip ?? null,
      lastLoginAt: new Date(),
    });
    insertId = result[0]?.insertId;
  } catch (err) {
    // 并发首登唯一键冲突 → 视为登录
    if (isDupEntry(err)) {
      const raced = await findUserByPhone(db, phone);
      if (raced) return raced;
    }
    throw err;
  }
  if (!insertId) {
    throw new AppError(ERR.INTERNAL, "创建用户失败");
  }
  const created = await findUserById(db, insertId);
  if (!created) {
    throw new AppError(ERR.INTERNAL, "创建用户失败");
  }
  await notifyRegistered(created.id, created.name, created.phone);
  return created;
}

/** 邮箱 + 密码注册：邮箱查重（AUTH_EMAIL_EXISTS） */
export async function registerByEmail(
  db: Db,
  input: { email: string; password: string; name?: string | null; ip?: string | null },
): Promise<User> {
  const { email, password, name, ip } = input;
  const existing = await findUserByEmail(db, email);
  if (existing) {
    throw new AppError(ERR.AUTH_EMAIL_EXISTS, "该邮箱已注册");
  }

  const passwordHash = await hashPassword(password);
  let insertId: number | undefined;
  try {
    const result = await db.insert(users).values({
      email,
      name: name ?? null,
      passwordHash,
      createdIp: ip ?? null,
      lastLoginAt: new Date(),
    });
    insertId = result[0]?.insertId;
  } catch (err) {
    if (isDupEntry(err)) {
      throw new AppError(ERR.AUTH_EMAIL_EXISTS, "该邮箱已注册");
    }
    throw err;
  }
  if (!insertId) {
    throw new AppError(ERR.INTERNAL, "创建用户失败");
  }
  const created = await findUserById(db, insertId);
  if (!created) {
    throw new AppError(ERR.INTERNAL, "创建用户失败");
  }
  await notifyRegistered(created.id, created.name, created.phone);
  return created;
}

/** 密码登录：login 可为手机号或邮箱；失败统一 AUTH_INVALID_CREDENTIALS（不暴露账号是否存在） */
export async function authenticatePassword(
  db: Db,
  login: string,
  password: string,
): Promise<User> {
  const byPhone = PHONE_RE.test(login);
  const user = byPhone ? await findUserByPhone(db, login) : await findUserByEmail(db, login);
  const passwordOk = user?.passwordHash
    ? await verifyPassword(user.passwordHash, password)
    : false;
  if (!user || !passwordOk) {
    throw new AppError(ERR.AUTH_INVALID_CREDENTIALS, "账号或密码错误");
  }
  if (user.status === "disabled") {
    throw new AppError(ERR.AUTH_DISABLED, "账号已被禁用");
  }
  const lastLoginAt = new Date();
  await db.update(users).set({ lastLoginAt }).where(eq(users.id, user.id));
  return { ...user, lastLoginAt };
}

export interface RequestPasswordResetInput {
  phone?: string;
  email?: string;
  /** 短信发送器（注入，避免依赖 notifications 包） */
  sendSms?: (phone: string, text: string) => Promise<void>;
  /** 邮件发送器 */
  sendEmail?: EmailSender;
}

/**
 * 发起密码重置：生成一次性 token（15 分钟）并经注入的发送器送达。
 * 账号不存在时静默返回（不暴露账号存在性）；发送失败仅记日志。
 */
export async function requestPasswordReset(db: Db, input: RequestPasswordResetInput): Promise<void> {
  const { phone, email, sendSms, sendEmail } = input;
  if (!phone && !email) {
    throw new AppError(ERR.VALIDATION_FAILED, "手机号与邮箱至少填一项");
  }
  const user = phone ? await findUserByPhone(db, phone) : await findUserByEmail(db, email!);
  if (!user) return;

  const token = randomToken(32);
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256hex(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  const resetUrl = `${portalUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    if (phone && sendSms) {
      await sendSms(
        phone,
        `【启明智联】您正在重置登录密码，15 分钟内有效。重置链接：${resetUrl}（如非本人操作请忽略）`,
      );
    }
    if (email && sendEmail) {
      await sendEmail(
        email,
        "重置您的启明智联登录密码",
        `<p>您好，</p><p>我们收到了您重置密码的请求。请在 15 分钟内点击以下链接完成密码重置：</p>` +
          `<p><a href="${resetUrl}">重置密码</a></p>` +
          `<p>如果链接无法点击，请复制到浏览器打开：<br/>${resetUrl}</p>` +
          `<p>如非本人操作，请忽略本邮件，您的账户不会受影响。</p>`,
      );
    }
  } catch (err) {
    log.error({ err, userId: user.id }, "密码重置消息发送失败");
  }
}

/** 内部：落地新密码并吊销全部会话（keepToken 保留当前会话） */
async function applyNewPassword(
  db: Db,
  userId: number,
  password: string,
  keepToken?: string,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  await revokeAllPortalSessions(db, userId, keepToken);
}

/** 手机号验证码重置密码 */
export async function resetPasswordBySms(
  db: Db,
  input: { phone: string; code: string; password: string },
): Promise<void> {
  const ok = await verifySmsCode(db, { phone: input.phone, purpose: "reset", code: input.code });
  if (!ok) {
    throw new AppError(ERR.AUTH_SMS_CODE_INVALID, "验证码错误或已过期");
  }
  const user = await findUserByPhone(db, input.phone);
  if (!user) {
    throw new AppError(ERR.AUTH_INVALID_CREDENTIALS, "账号不存在或状态异常");
  }
  await applyNewPassword(db, user.id, input.password);
}

/** 邮箱令牌重置密码（一次性，15 分钟有效） */
export async function resetPasswordByToken(
  db: Db,
  input: { token: string; password: string },
): Promise<void> {
  const now = new Date();
  const tokenHash = sha256hex(input.token);
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .limit(1);
  const prt = rows[0];
  if (!prt) {
    throw new AppError(ERR.AUTH_RESET_TOKEN_INVALID, "重置链接无效或已过期");
  }

  // 原子标记已使用（一次性），失败即视为已被消费
  const result = await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.id, prt.id), isNull(passwordResetTokens.usedAt)));
  if ((result[0]?.affectedRows ?? 0) === 0) {
    throw new AppError(ERR.AUTH_RESET_TOKEN_INVALID, "重置链接已被使用");
  }

  await applyNewPassword(db, prt.userId, input.password);
}

/** 修改密码：校验当前密码；成功后吊销全部会话（keepToken 保留当前会话） */
export async function changePassword(
  db: Db,
  userId: number,
  current: string,
  next: string,
  opts: { keepToken?: string } = {},
): Promise<void> {
  const user = await findUserById(db, userId);
  if (!user) {
    throw new AppError(ERR.NOT_FOUND, "用户不存在");
  }
  const currentOk = user.passwordHash
    ? await verifyPassword(user.passwordHash, current)
    : false;
  if (!currentOk) {
    throw new AppError(ERR.AUTH_INVALID_CREDENTIALS, "当前密码不正确");
  }
  await applyNewPassword(db, userId, next, opts.keepToken);
}

/** 换绑手机号：验证 bind 验证码 + （已设密码时）当前密码；成功后吊销全部会话 */
export async function bindPhone(
  db: Db,
  userId: number,
  input: { phone: string; code: string; password?: string },
  opts: { keepToken?: string } = {},
): Promise<void> {
  const user = await findUserById(db, userId);
  if (!user) {
    throw new AppError(ERR.NOT_FOUND, "用户不存在");
  }
  // 已设密码时必须校验当前密码（防会话劫持换绑）
  if (user.passwordHash) {
    if (!input.password) {
      throw new AppError(ERR.AUTH_INVALID_CREDENTIALS, "请输入当前密码以完成换绑");
    }
    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    if (!passwordOk) {
      throw new AppError(ERR.AUTH_INVALID_CREDENTIALS, "当前密码不正确");
    }
  }

  const ok = await verifySmsCode(db, { phone: input.phone, purpose: "bind", code: input.code });
  if (!ok) {
    throw new AppError(ERR.AUTH_SMS_CODE_INVALID, "验证码错误或已过期");
  }

  const taken = await findUserByPhone(db, input.phone);
  if (taken && taken.id !== userId) {
    throw new AppError(ERR.AUTH_PHONE_EXISTS, "该手机号已被其他账户绑定");
  }

  try {
    await db.update(users).set({ phone: input.phone }).where(eq(users.id, userId));
  } catch (err) {
    if (isDupEntry(err)) {
      throw new AppError(ERR.AUTH_PHONE_EXISTS, "该手机号已被其他账户绑定");
    }
    throw err;
  }
  await revokeAllPortalSessions(db, userId, opts.keepToken);
}
