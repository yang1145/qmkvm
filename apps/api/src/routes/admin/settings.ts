/**
 * 系统设置：GET（敏感字段脱敏）/ PUT（逐 key upsert；支付网关敏感字段 AES 加密包裹
 * {"__enc":true,"v":"<iv:tag:ct>"}，格式与 payments/settings-crypto.ts 一致）。
 *
 * 另含拆分后的子路由：
 * - GET|PUT /settings/payment：仅支付网关（payment.gateways）
 * - GET|PUT /settings/smtp：SMTP 邮件设置（key=smtp，密码加密）
 * - POST /settings/smtp/test：用落库 SMTP 配置真实发送测试邮件
 * - POST /settings/templates/test：按模板渲染示例变量后发送测试邮件
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";
import { settingsUpsertSchema } from "@pinhaoji/contracts";
import { appError } from "@pinhaoji/core";
import {
  encryptSettingValue,
  isEncryptedSettingValue,
  decodeGatewaySetting,
  PAYMENT_GATEWAYS_SETTING_KEY,
} from "@pinhaoji/payments";
import { renderTemplate, sendEmail } from "@pinhaoji/notifications";
import type { SmtpConfig } from "@pinhaoji/notifications";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

export const adminSettingRoutes = new Hono();

const { settings, notificationTemplates } = schema;

const MASK = "******";
/** 需要加密存储（读取脱敏）的网关配置字段 */
const SENSITIVE_GATEWAY_FIELDS = new Set(["privateKey", "apiv3Key", "apiKey", "hmacSecret"]);

/** SMTP 设置落库 key 与敏感字段 */
const SMTP_SETTING_KEY = "smtp";
const SENSITIVE_SMTP_FIELDS = new Set(["pass"]);

/** 读取脱敏：加密包裹 → 掩码；明文敏感字段也按字段名掩码 */
function maskSettingValue(v: unknown, depth = 3): unknown {
  if (isEncryptedSettingValue(v)) return MASK;
  if (depth <= 0 || typeof v !== "object" || v === null) return v;
  if (Array.isArray(v)) return v.map((i) => maskSettingValue(i, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    out[k] = SENSITIVE_GATEWAY_FIELDS.has(k) && typeof val === "string" && val.length > 0
      ? MASK
      : maskSettingValue(val, depth - 1);
  }
  return out;
}

adminSettingRoutes.get("/settings", requireAdmin("settings.manage"), async (c) => {
  const db = getDb();
  const rows = await db.select().from(settings).orderBy(settings.key);
  return c.json({
    items: rows.map((r) => ({
      key: r.key,
      value: maskSettingValue(r.value),
      updatedAt: iso(r.updatedAt),
    })),
  });
});

/**
 * 逐 key upsert。payment.gateways 特殊处理：
 * - 敏感字段（privateKey/apiv3Key/...）明文 → AES 加密包裹后落库；
 * - 值为掩码 "******" → 保留库中既有密文（表单未改动场景），库中为空则报错。
 */
adminSettingRoutes.put("/settings", requireAdmin("settings.manage"), async (c) => {
  const body = settingsUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const keys = Object.keys(body.values);
  if (keys.length === 0) throw appError("VALIDATION_FAILED", "values 不能为空");

  for (const key of keys) {
    let value = body.values[key];
    if (key === PAYMENT_GATEWAYS_SETTING_KEY) {
      value = await encryptGatewayValue(db, value);
    }
    await upsertSetting(key, value as Record<string, unknown>);
  }

  await writeAdminAudit(c, admin, {
    action: "settings.update",
    targetType: "settings",
    after: { keys },
  });
  return c.json({ ok: true, keys });
});

// ============ 支付设置（payment.gateways 子路由） ============

const paymentGatewaysSchema = z.object({
  gateways: z.record(z.string(), z.unknown()),
});

/** 仅读取支付网关配置（脱敏后） */
adminSettingRoutes.get("/settings/payment", requireAdmin("settings.manage"), async (c) => {
  const existing = await readSettingValue(PAYMENT_GATEWAYS_SETTING_KEY);
  return c.json({ value: existing ? maskSettingValue(existing) : {} });
});

/** 仅写支付网关配置：body { gateways }，敏感字段加密落库（掩码保留既有密文）；按网关 code 合并，未提交的 code 保留 */
adminSettingRoutes.put("/settings/payment", requireAdmin("settings.manage"), async (c) => {
  const body = paymentGatewaysSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const existing = (await readSettingValue(PAYMENT_GATEWAYS_SETTING_KEY)) ?? {};
  const encrypted = await encryptGatewayValue(db, body.gateways);
  await upsertSetting(PAYMENT_GATEWAYS_SETTING_KEY, { ...existing, ...encrypted });
  await writeAdminAudit(c, admin, {
    action: "settings.payment.update",
    targetType: "settings",
    after: { keys: [PAYMENT_GATEWAYS_SETTING_KEY] },
  });
  return c.json({ ok: true });
});

// ============ 邮件（SMTP）设置 ============

const smtpUpsertSchema = z
  .object({
    host: z.string().min(1).max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    user: z.string().max(255).nullable().optional(),
    pass: z.string().max(255).nullable().optional(),
    from: z.string().min(3).max(255).optional(),
  })
  .strict();

function maskSmtpValue(v: unknown): unknown {
  if (isEncryptedSettingValue(v)) return MASK;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] =
      SENSITIVE_SMTP_FIELDS.has(k) &&
      ((typeof val === "string" && val.length > 0) || isEncryptedSettingValue(val))
        ? MASK
        : val;
  }
  return out;
}

/** 读取 SMTP 配置（密码掩码） */
adminSettingRoutes.get("/settings/smtp", requireAdmin("settings.manage"), async (c) => {
  const existing = await readSettingValue(SMTP_SETTING_KEY);
  return c.json({ value: existing ? maskSmtpValue(existing) : {} });
});

/** 写 SMTP 配置：密码字段加密落库；掩码 "******" 保留既有密文 */
adminSettingRoutes.put("/settings/smtp", requireAdmin("settings.manage"), async (c) => {
  const body = smtpUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const existing = (await readSettingValue(SMTP_SETTING_KEY)) ?? {};

  const next: Record<string, unknown> = {};
  for (const [field, val] of Object.entries(body)) {
    if (SENSITIVE_SMTP_FIELDS.has(field)) {
      next[field] = mergeSensitiveField("smtp", field, val, existing[field]);
    } else {
      next[field] = val;
    }
  }
  if (Object.keys(next).length === 0) throw appError("VALIDATION_FAILED", "SMTP 配置不能为空");

  await upsertSetting(SMTP_SETTING_KEY, next);
  await writeAdminAudit(c, admin, {
    action: "settings.smtp.update",
    targetType: "settings",
    after: { keys: [SMTP_SETTING_KEY] },
  });
  return c.json({ ok: true });
});

const emailTargetSchema = z.object({ to: z.email() });

/** 用落库 SMTP 配置（缺省回退环境变量）发送测试邮件；未配置任何 SMTP 时走 mock */
adminSettingRoutes.post("/settings/smtp/test", requireAdmin("settings.manage"), async (c) => {
  const { to } = emailTargetSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const cfg = await loadSmtpConfig();
  const result = await sendEmail(to, "拼好机云业务系统 SMTP 测试邮件", smtpTestHtml(), cfg ?? undefined);
  await writeAdminAudit(c, admin, {
    action: "settings.smtp.test",
    targetType: "settings",
    after: { provider: result.provider, ok: result.ok },
  });
  return c.json({ ok: result.ok, provider: result.provider, error: result.error });
});

// ============ 通知模板测试发送 ============

const templateTestSchema = z.object({
  templateId: z.number().int().positive(),
  to: z.email(),
});

/** 按 email 模板渲染示例变量后发送测试邮件（SMTP 配置同 /settings/smtp/test） */
adminSettingRoutes.post("/settings/templates/test", requireAdmin("templates.manage"), async (c) => {
  const body = templateTestSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db
    .select()
    .from(notificationTemplates)
    .where(eq(notificationTemplates.id, body.templateId))
    .limit(1);
  const tpl = rows[0];
  if (!tpl) throw appError("NOT_FOUND", "通知模板不存在");
  if (tpl.channel !== "email") throw appError("VALIDATION_FAILED", "仅 email 渠道模板支持邮件测试发送");

  const vars = sampleTemplateVars(body.to);
  const subject = renderTemplate(tpl.subject ?? "拼好机通知", vars);
  const html = renderTemplate(tpl.body, vars);
  const cfg = await loadSmtpConfig();
  const result = await sendEmail(body.to, subject, html, cfg ?? undefined);
  await writeAdminAudit(c, admin, {
    action: "template.test",
    targetType: "notification_template",
    targetId: tpl.id,
    after: { provider: result.provider, ok: result.ok },
  });
  return c.json({
    ok: result.ok,
    provider: result.provider,
    error: result.error,
    subject,
    body: html,
  });
});

// ============ 共享工具 ============

async function readSettingValue(key: string): Promise<Record<string, unknown> | null> {
  const rows = await getDb()
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return (rows[0]?.value ?? null) as Record<string, unknown> | null;
}

async function upsertSetting(key: string, value: Record<string, unknown>): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
}

/**
 * 敏感字段写入合并：掩码 → 保留既有密文 / 旧明文补加密 / 为空报错；
 * 明文 → 加密包裹；空串 → 清空。
 */
function mergeSensitiveField(scope: string, field: string, val: unknown, prevField: unknown): unknown {
  if (val === MASK) {
    if (isEncryptedSettingValue(prevField)) return prevField; // 保留既有密文
    if (typeof prevField === "string" && prevField) {
      return encryptSettingValue(prevField); // 旧明文补加密
    }
    throw appError("VALIDATION_FAILED", `${scope}.${field} 当前为空，请提供新值（不能保留掩码）`);
  }
  return typeof val === "string" && val.length > 0 ? encryptSettingValue(val) : val;
}

/** payment.gateways 写入前的敏感字段加密（{"__enc":true,"v"} 包裹） */
async function encryptGatewayValue(db: ReturnType<typeof getDb>, raw: unknown): Promise<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw appError("VALIDATION_FAILED", "payment.gateways 配置必须为对象");
  }
  const existing = (await readSettingValue(PAYMENT_GATEWAYS_SETTING_KEY)) ?? {};

  const out: Record<string, unknown> = {};
  for (const [code, cfg] of Object.entries(raw as Record<string, unknown>)) {
    const prevCfg = existing[code];
    if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
      out[code] = cfg;
      continue;
    }
    const next: Record<string, unknown> = {};
    for (const [field, val] of Object.entries(cfg as Record<string, unknown>)) {
      if (SENSITIVE_GATEWAY_FIELDS.has(field)) {
        const prevField =
          typeof prevCfg === "object" && prevCfg !== null ? (prevCfg as Record<string, unknown>)[field] : undefined;
        next[field] = mergeSensitiveField(`支付网关 ${code}`, field, val, prevField);
      } else {
        next[field] = val; // 普通字段或已加密包裹原样保留
      }
    }
    out[code] = next;
  }
  return out;
}

/**
 * 从 settings 表读取 SMTP 配置并解密为明文 SmtpConfig；
 * 未落库或缺 host/from 时返回 null（调用方回退环境变量 / mock）。
 */
async function loadSmtpConfig(): Promise<SmtpConfig | null> {
  const raw = await readSettingValue(SMTP_SETTING_KEY);
  if (!raw) return null;
  const decoded = decodeGatewaySetting(raw) as Record<string, unknown>;
  const host = typeof decoded.host === "string" ? decoded.host : "";
  const from = typeof decoded.from === "string" ? decoded.from : "";
  if (!host || !from) return null;
  const port = Number(decoded.port);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: decoded.secure === true,
    user: typeof decoded.user === "string" && decoded.user ? decoded.user : null,
    pass: typeof decoded.pass === "string" && decoded.pass ? decoded.pass : null,
    from,
  };
}

function smtpTestHtml(): string {
  return [
    "<div style=\"font-family: sans-serif; max-width: 480px;\">",
    "<h2 style=\"color:#1677ff;\">拼好机云业务系统</h2>",
    "<p>这是一封 SMTP 配置测试邮件。</p>",
    "<p>收到即说明当前邮件设置（SMTP 服务器）可正常发信。</p>",
    `<p style=\"color:#999;font-size:12px;\">发送时间：${new Date().toISOString()}</p>`,
    "</div>",
  ].join("\n");
}

/** 模板测试发送的示例变量（覆盖 VARIABLE_HINTS 常用占位符） */
function sampleTemplateVars(to: string): Record<string, unknown> {
  return {
    siteName: "拼好机",
    userName: "测试用户",
    userEmail: to,
    serviceName: "示例云服务器",
    invoiceNo: "INV-TEST-0001",
    amount: 9900,
    amountCny: "¥99.00",
    total: 9900,
    totalCny: "¥99.00",
    dueDate: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    ticketId: 1,
    ticketSubject: "测试工单",
    user: { name: "测试用户", email: to },
  };
}
