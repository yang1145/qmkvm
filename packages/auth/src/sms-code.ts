/** 短信验证码：限流签发 + 哈希落库 + 尝试次数控制 */

import { randomInt } from "node:crypto";

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { ERR } from "@qmkvm/contracts";
import { AppError } from "@qmkvm/core/errors";
import type { Db } from "@qmkvm/db/client";
import { smsCodes } from "@qmkvm/db/schema";
import { createLogger } from "@qmkvm/logger";

import { sha256hex } from "./crypto.js";
import { checkRateLimit } from "./rate-limit.js";

const log = createLogger("auth:sms");

export type SmsPurpose = "login" | "reset" | "bind";

/** 短信发送器由调用方注入（通常为 notifications 包的 sendSms），本包不依赖 notifications */
export type SmsSender = (phone: string, text: string) => Promise<void>;

/** 验证码有效期：5 分钟 */
const CODE_TTL_MS = 5 * 60 * 1000;
/** 单个验证码最大尝试次数 */
const MAX_ATTEMPTS = 5;

export interface IssueSmsCodeInput {
  phone: string;
  purpose: SmsPurpose;
  /** 发起方 IP（用于同 IP 限流；缺失时跳过 IP 维度） */
  ip?: string | null;
  send: SmsSender;
}

export interface VerifySmsCodeInput {
  phone: string;
  purpose: SmsPurpose;
  code: string;
}

async function limitOrThrow(
  key: string,
  limit: number,
  windowSec: number,
  message: string,
): Promise<void> {
  const result = await checkRateLimit(key, { limit, windowSec });
  if (!result.ok) {
    throw new AppError(ERR.AUTH_SMS_SEND_LIMIT, message, {
      retryAfterSec: result.retryAfterSec,
    });
  }
}

/**
 * 签发短信验证码：
 * 限流（同号 1 条/分钟、5 条/天；同 IP 20 条/小时）→ 6 位随机码 sha256 落库（5 分钟有效）→ 注入的 send 发送。
 * 发送失败仅记日志（mock/通道异常环境验证码仍有效），不阻断签发。
 */
export async function issueSmsCode(db: Db, input: IssueSmsCodeInput): Promise<{ ok: true }> {
  const { phone, purpose, ip, send } = input;
  await limitOrThrow(`sms:phone:min:${phone}`, 1, 60, "发送过于频繁，请 1 分钟后再试");
  await limitOrThrow(`sms:phone:day:${phone}`, 5, 24 * 60 * 60, "今日验证码发送次数已达上限，请明天再试");
  if (ip) {
    await limitOrThrow(`sms:ip:hour:${ip}`, 20, 60 * 60, "操作过于频繁，请稍后再试");
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(smsCodes).values({
    phone,
    purpose,
    codeHash: sha256hex(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const text = `【启明智联】验证码 ${code}，5 分钟内有效。为保障账户安全，请勿泄露给他人。`;
  try {
    await send(phone, text);
  } catch (err) {
    log.error({ err, phone, purpose }, "短信发送失败（验证码记录仍有效）");
  }
  return { ok: true };
}

/**
 * 校验短信验证码：过期/已使用/尝试超过 5 次均失效；
 * 错误码会使该手机号+用途下所有未用验证码 attempts+1；成功标记 usedAt（幂等）。
 */
export async function verifySmsCode(db: Db, input: VerifySmsCodeInput): Promise<boolean> {
  const { phone, purpose, code } = input;
  const now = new Date();
  const activeConditions = [
    eq(smsCodes.phone, phone),
    eq(smsCodes.purpose, purpose),
    isNull(smsCodes.usedAt),
    gt(smsCodes.expiresAt, now),
  ];

  const candidates = await db
    .select()
    .from(smsCodes)
    .where(and(...activeConditions))
    .orderBy(desc(smsCodes.createdAt))
    .limit(10);

  const codeHash = sha256hex(code);
  const matched = candidates.find((c) => c.codeHash === codeHash && c.attempts < MAX_ATTEMPTS);

  if (!matched) {
    // 未命中：活跃验证码尝试次数 +1（防跨多个验证码暴力枚举）
    await db
      .update(smsCodes)
      .set({ attempts: sql`${smsCodes.attempts} + 1` })
      .where(and(...activeConditions));
    return false;
  }

  // 原子标记已使用，保证幂等（并发校验只有一次成功）
  const result = await db
    .update(smsCodes)
    .set({ usedAt: now })
    .where(and(eq(smsCodes.id, matched.id), isNull(smsCodes.usedAt)));
  const affected = result[0]?.affectedRows ?? 0;
  return affected > 0;
}
