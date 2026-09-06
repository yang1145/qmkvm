/** 通知发送：模板渲染 + email/sms/inapp 三通道分发 + 发送日志（失败不抛） */

import { and, eq } from "drizzle-orm";

import type { Db } from "@pinhaoji/db/client";
import {
  notificationLogs,
  notificationTemplates,
  settings,
  userNotifications,
  users,
} from "@pinhaoji/db/schema";
import { createLogger } from "@pinhaoji/logger";

import { sendEmail } from "./providers/email.js";
import { sendSms } from "./providers/sms.js";

const log = createLogger("notifications");

export type NotificationChannel = "email" | "sms" | "inapp";

/**
 * 模板渲染：{{a.b}} 点路径占位替换；直接命中顶层 key 优先，缺失一律替换为 ""。
 * vars 支持嵌套对象（{{user.name}} → vars.user.name）与含点平铺 key。
 */
export function renderTemplate(body: string, vars: Record<string, unknown>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = resolveVar(vars, path);
    return value == null ? "" : String(value);
  });
}

function resolveVar(vars: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(vars, path)) return vars[path];
  let current: unknown = vars;
  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export interface SendNotificationInput {
  /** 站内信必填；email/sms 用于回退解析目标（target 缺省时） */
  userId?: number;
  channel: NotificationChannel;
  event: string;
  /** 收件目标（邮箱地址/手机号）；缺省时按 userId 回退 user.email / user.phone */
  target?: string;
  /** 模板变量（支持嵌套，渲染 {{a.b}}） */
  vars: Record<string, unknown>;
  /** inapp/邮件 subject 缺失时的标题兜底 */
  title?: string;
}

/** 站点变量进程内缓存（60s）：所有模板可用 {{site.name}}，读失败/缺省回退「拼好机」 */
const SITE_VARS_TTL_MS = 60_000;
const DEFAULT_SITE_NAME = "拼好机";
let siteVarsCache: { value: Record<string, unknown>; at: number } | null = null;

async function getSiteVars(db: Db): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (siteVarsCache && now - siteVarsCache.at < SITE_VARS_TTL_MS) return siteVarsCache.value;
  let siteName = DEFAULT_SITE_NAME;
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, "site")).limit(1);
    const value = rows[0]?.value as { siteName?: unknown } | undefined;
    if (typeof value?.siteName === "string" && value.siteName.trim()) siteName = value.siteName.trim();
  } catch (err) {
    log.warn({ err }, "读取站点设置失败，使用默认站点名");
  }
  siteVarsCache = { value: { site: { name: siteName } }, at: now };
  return siteVarsCache.value;
}

async function loadTemplate(db: Db, channel: NotificationChannel, event: string) {
  const rows = await db
    .select()
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.channel, channel),
        eq(notificationTemplates.event, event),
        eq(notificationTemplates.active, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function userContact(
  db: Db,
  userId: number,
): Promise<{ email: string | null; phone: string | null }> {
  const rows = await db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? { email: null, phone: null };
}

interface LogEntry {
  userId?: number;
  channel: NotificationChannel;
  event: string;
  target: string;
  status: "sent" | "failed";
  error?: string;
  provider?: string;
  providerMessageId?: string;
}

/** 每次通知（含失败）写 notificationLogs；日志本身失败仅记 logger */
async function writeLog(db: Db, entry: LogEntry): Promise<void> {
  try {
    await db.insert(notificationLogs).values({
      userId: entry.userId ?? null,
      channel: entry.channel,
      event: entry.event,
      target: entry.target.slice(0, 255),
      status: entry.status,
      error: entry.error ?? null,
      provider: entry.provider ?? null,
      providerMessageId: entry.providerMessageId?.slice(0, 128) ?? null,
    });
  } catch (err) {
    log.error({ err, event: entry.event, channel: entry.channel }, "写入通知日志失败");
  }
}

/**
 * 单通道通知：查 active 模板（无模板跳过）→ 渲染 → 发送 → 写日志。
 * 任何失败仅记日志，不抛（通知不阻断主流程）。
 */
export async function sendNotification(db: Db, input: SendNotificationInput): Promise<void> {
  const { userId, channel, event, vars, title } = input;
  try {
    // 注入站点变量 {{site.name}}；调用方传入的同名键优先
    const mergedVars = { ...(await getSiteVars(db)), ...vars };
    const template = await loadTemplate(db, channel, event);
    if (!template) {
      log.info({ channel, event }, "无可用通知模板，跳过");
      return;
    }

    if (channel === "inapp") {
      if (!userId) {
        log.warn({ channel, event }, "站内信缺少 userId，跳过");
        return;
      }
      // title 用 subject 渲染，缺省回退 title 参数 / 事件名；列宽截断
      const renderedTitle = renderTemplate(template.subject ?? title ?? event, mergedVars).slice(0, 200);
      const renderedBody = renderTemplate(template.body, mergedVars).slice(0, 1000);
      await db.insert(userNotifications).values({
        userId,
        title: renderedTitle || event,
        body: renderedBody || null,
      });
      await writeLog(db, {
        userId,
        channel,
        event,
        target: `user:${userId}`,
        status: "sent",
        provider: "inapp",
      });
      return;
    }

    const target =
      input.target ?? (userId ? (await userContact(db, userId))[channel === "email" ? "email" : "phone"] : null);
    if (!target) {
      log.warn({ channel, event, userId }, "通知目标缺失，跳过");
      return;
    }

    if (channel === "email") {
      const subject = renderTemplate(template.subject ?? title ?? event, mergedVars);
      const html = renderTemplate(template.body, mergedVars);
      const result = await sendEmail(target, subject, html);
      await writeLog(db, {
        userId,
        channel,
        event,
        target,
        status: result.ok ? "sent" : "failed",
        error: result.error,
        provider: result.provider,
        providerMessageId: result.messageId,
      });
      return;
    }

    // sms
    const text = renderTemplate(template.body, mergedVars);
    const result = await sendSms(target, text);
    await writeLog(db, {
      userId,
      channel,
      event,
      target,
      status: result.ok ? "sent" : "failed",
      error: result.error,
      provider: result.provider,
      providerMessageId: result.messageId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, channel, event, userId }, "通知发送异常");
    await writeLog(db, {
      userId,
      channel,
      event,
      target: input.target ?? (userId ? `user:${userId}` : "-"),
      status: "failed",
      error: message,
      provider: "internal",
    });
  }
}

export interface NotifyUserAllChannelsInput {
  /** 最小结构：DB users 行或 API 层用户对象均可 */
  user: { id: number; email: string | null; phone: string | null; name?: string | null };
  event: string;
  vars: Record<string, unknown>;
}

/** 事件前缀 → 模板作用域（invoice.paid → {{invoice.xxx}}） */
function scopeOf(event: string): string | null {
  const prefix = event.split(".")[0] ?? "";
  return ["invoice", "service", "credit", "refund", "ticket", "user", "payment", "task", "renewal"].includes(prefix)
    ? prefix
    : null;
}

/**
 * 变量装饰：无论调用方传平铺还是嵌套 vars，都能命中模板的 {{scope.key}} 与 {{key}}，
 * 并派生 totalCny/amountCny（分 → ¥xx.xx）。
 */
function decorateVars(
  event: string,
  vars: Record<string, unknown>,
  user: { id: number; email: string | null; phone: string | null; name?: string | null },
): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...vars };
  for (const key of ["total", "amount"]) {
    const v = flat[key];
    if (typeof v === "number") flat[`${key}Cny`] = `¥${(v / 100).toFixed(2)}`;
  }
  const decorated: Record<string, unknown> = {
    user: { name: user.name ?? user.email?.split("@")[0] ?? `用户${user.id}`, email: user.email, phone: user.phone },
    ...flat,
  };
  const scope = scopeOf(event);
  if (scope) {
    const existing = typeof decorated[scope] === "object" && decorated[scope] !== null ? (decorated[scope] as Record<string, unknown>) : {};
    decorated[scope] = { ...existing, ...flat };
  }
  return decorated;
}

/** 三通道并行通知（Promise.allSettled，单通道失败不影响其余） */
export async function notifyUserAllChannels(
  db: Db,
  input: NotifyUserAllChannelsInput,
): Promise<void> {
  const { user, event, vars } = input;
  const decorated = decorateVars(event, vars, user);
  await Promise.allSettled([
    sendNotification(db, {
      userId: user.id,
      channel: "email",
      event,
      target: user.email ?? undefined,
      vars: decorated,
    }),
    sendNotification(db, {
      userId: user.id,
      channel: "sms",
      event,
      target: user.phone ?? undefined,
      vars: decorated,
    }),
    sendNotification(db, { userId: user.id, channel: "inapp", event, vars: decorated }),
  ]);
}
