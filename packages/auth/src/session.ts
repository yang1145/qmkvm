/** 门户会话：token 不落库（仅存 sha256），30 天滑动过期 */

import { and, eq, gt, isNull, ne } from "drizzle-orm";

import type { Db } from "@qmkvm/db/client";
import { sessions, users } from "@qmkvm/db/schema";

import { randomToken, sha256hex } from "./crypto.js";

export type User = typeof users.$inferSelect;

/** 会话固定时长：30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 滑动续期阈值：剩余不足 15 天时在 resolve 时续满 30 天 */
const RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;
/** lastSeenAt 更新节流：每小时最多一次 */
const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

export interface CreateSessionMeta {
  ip?: string | null;
  ua?: string | null;
}

/** 创建门户会话：token 交给调用方下发 Cookie，库中仅存其哈希 */
export async function createPortalSession(
  db: Db,
  userId: number,
  meta: CreateSessionMeta = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: sha256hex(token),
    userId,
    ip: meta.ip ?? null,
    userAgent: meta.ua?.slice(0, 255) ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * 解析门户会话：校验过期/已吊销/用户被禁用；
 * 滑动过期（剩余 < 15 天则续满 30 天）与 lastSeenAt 每小时节流更新。
 */
export async function resolvePortalSession(db: Db, token: string): Promise<User | null> {
  if (!token) return null;
  const now = new Date();
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, sha256hex(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.user.status === "disabled") return null;

  const remaining = row.session.expiresAt.getTime() - now.getTime();
  const lastSeenAt = row.session.lastSeenAt;
  const needsRenew = remaining < RENEW_THRESHOLD_MS;
  const needsSeen =
    !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS;

  if (needsRenew || needsSeen) {
    await db
      .update(sessions)
      .set({
        ...(needsRenew ? { expiresAt: new Date(now.getTime() + SESSION_TTL_MS) } : {}),
        ...(needsSeen ? { lastSeenAt: now } : {}),
      })
      .where(eq(sessions.id, row.session.id));
  }

  return row.user;
}

/** 吊销单个门户会话（幂等） */
export async function revokePortalSession(db: Db, token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sha256hex(token)), isNull(sessions.revokedAt)));
}

/** 吊销某用户全部门户会话；传入 keepToken 时保留当前会话（改密/换绑场景） */
export async function revokeAllPortalSessions(
  db: Db,
  userId: number,
  keepToken?: string,
): Promise<void> {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (keepToken) {
    conditions.push(ne(sessions.id, sha256hex(keepToken)));
  }
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(...conditions));
}
