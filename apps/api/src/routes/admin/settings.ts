/**
 * 系统设置：GET（敏感字段脱敏）/ PUT（逐 key upsert；支付网关敏感字段 AES 加密包裹
 * {"__enc":true,"v":"<iv:tag:ct>"}，格式与 payments/settings-crypto.ts 一致）。
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@pinhaoji/db";
import { settingsUpsertSchema } from "@pinhaoji/contracts";
import { appError } from "@pinhaoji/core";
import { encryptSettingValue, isEncryptedSettingValue, PAYMENT_GATEWAYS_SETTING_KEY } from "@pinhaoji/payments";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

export const adminSettingRoutes = new Hono();

const { settings } = schema;

const MASK = "******";
/** 需要加密存储（读取脱敏）的网关配置字段 */
const SENSITIVE_GATEWAY_FIELDS = new Set(["privateKey", "apiv3Key", "apiKey", "hmacSecret"]);

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
    await db
      .insert(settings)
      .values({ key, value: value as Record<string, unknown> })
      .onDuplicateKeyUpdate({ set: { value: value as Record<string, unknown>, updatedAt: new Date() } });
  }

  await writeAdminAudit(c, admin, {
    action: "settings.update",
    targetType: "settings",
    after: { keys },
  });
  return c.json({ ok: true, keys });
});

/** payment.gateways 写入前的敏感字段加密（{"__enc":true,"v"} 包裹） */
async function encryptGatewayValue(db: ReturnType<typeof getDb>, raw: unknown): Promise<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw appError("VALIDATION_FAILED", "payment.gateways 配置必须为对象");
  }
  const existingRows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, PAYMENT_GATEWAYS_SETTING_KEY))
    .limit(1);
  const existing = (existingRows[0]?.value ?? {}) as Record<string, unknown>;

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
        if (val === MASK) {
          const prevField =
            typeof prevCfg === "object" && prevCfg !== null ? (prevCfg as Record<string, unknown>)[field] : undefined;
          if (isEncryptedSettingValue(prevField)) {
            next[field] = prevField; // 保留既有密文
            continue;
          }
          if (typeof prevField === "string" && prevField) {
            next[field] = encryptSettingValue(prevField); // 旧明文补加密
            continue;
          }
          throw appError("VALIDATION_FAILED", `支付网关 ${code}.${field} 当前为空，请提供新值（不能保留掩码）`);
        }
        next[field] = typeof val === "string" && val.length > 0 ? encryptSettingValue(val) : val;
      } else {
        next[field] = val; // 普通字段或已加密包裹原样保留
      }
    }
    out[code] = next;
  }
  return out;
}
