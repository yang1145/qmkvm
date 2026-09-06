/**
 * 过期认证凭据清理：每周日 02:30（UTC）。
 * 清理已过期（expires_at < now）的门户/后台会话、短信验证码、找回密码 token。
 * 审计/通知等日志（>90 天）不在本任务范围内，一律保留。
 */
import { lt } from "drizzle-orm";
import { schema, type Db } from "@pinhaoji/db";
import type { TaskDef } from "./framework.js";

interface CleanupResult {
  sessions: number;
  adminSessions: number;
  smsCodes: number;
  passwordResetTokens: number;
}

async function run(db: Db, now: Date): Promise<CleanupResult> {
  const sessions = await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now));
  const adminSessions = await db
    .delete(schema.adminSessions)
    .where(lt(schema.adminSessions.expiresAt, now));
  const smsCodes = await db.delete(schema.smsCodes).where(lt(schema.smsCodes.expiresAt, now));
  const passwordResetTokens = await db
    .delete(schema.passwordResetTokens)
    .where(lt(schema.passwordResetTokens.expiresAt, now));

  return {
    sessions: sessions[0].affectedRows,
    adminSessions: adminSessions[0].affectedRows,
    smsCodes: smsCodes[0].affectedRows,
    passwordResetTokens: passwordResetTokens[0].affectedRows,
  };
}

export const systemCleanupTask: TaskDef = {
  name: "system.cleanup",
  cron: "30 2 * * 0",
  description: "清理过期会话/短信验证码/找回密码 token（日志保留不动）",
  run,
};
