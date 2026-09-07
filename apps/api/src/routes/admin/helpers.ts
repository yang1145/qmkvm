/**
 * admin 路由共享工具：时间序列化、联系方式脱敏、管理员审计写入。
 */
import type { Context } from "hono";
import { getDb, schema } from "@qmkvm/db";
import type { Json } from "@qmkvm/db/schema";
import { maskEmail, maskPhone } from "@qmkvm/auth";
import { getClientIp } from "../../middleware/request-id.js";

/** datetime 列 → ISO 字符串（null 安全） */
export function iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/** 客户联系方式脱敏视图（列表用） */
export function maskedContact(u: { phone: string | null; email: string | null }): {
  phone: string | null;
  email: string | null;
} {
  return {
    phone: u.phone ? maskPhone(u.phone) : null,
    email: u.email ? maskEmail(u.email) : null,
  };
}

/** 审计动作的发起管理员（来自 requireAdmin 注入的上下文或登录结果） */
export interface AdminActor {
  adminId: number;
  adminName: string | null;
}

/**
 * 写管理员审计日志（actorType=admin）：ip/userAgent/requestId 取自当前请求。
 * 注意：voidInvoice / adjustCredit / manuallyCompleteProvision 等 core 用例自带审计，
 * 调用方无需再重复写同动作记录。
 */
export async function writeAdminAudit(
  c: Context,
  actor: AdminActor,
  entry: {
    action: string;
    targetType?: string;
    targetId?: string | number;
    before?: Json;
    after?: Json;
  },
): Promise<void> {
  await getDb().insert(schema.auditLogs).values({
    actorType: "admin",
    actorId: actor.adminId,
    actorName: actor.adminName,
    action: entry.action.slice(0, 100),
    targetType: entry.targetType ?? null,
    targetId: entry.targetId != null ? String(entry.targetId) : null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent")?.slice(0, 255) ?? null,
    requestId: c.get("requestId") ?? null,
  });
}
