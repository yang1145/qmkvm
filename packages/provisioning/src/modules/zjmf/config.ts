/**
 * zjmf 模块配置解析。
 *
 * 商品 moduleConfig（service.moduleConfig 快照可覆盖，经 mergeModuleConfig 合并）：
 * {
 *   "supplier": {                       // 方式 A：内联供应商配置（与 pve.auth 同模式）
 *     "baseUrl": "https://upstream.example.com",
 *     "username": "agent-account",
 *     "password": "xxxx",               // 也接受 {"__enc":true,"v":"..."} 密文
 *     "apiTimeoutSec": 30,
 *     "allowSelfSigned": false
 *   },
 *   "supplierCode": "main",             // 方式 B：引用设置表 provisioning.zjmf.suppliers 的供应商
 *   "upProductId": 42,                  // 上游商品 ID（必填）
 *   "upCycles": { "monthly": "monthly" },  // 本地周期 → 上游 billingcycle 键（可省，自动别名匹配）
 *   "upConfigOption": { "12": "34" },   // 上游配置项默认值 optionId→subId（可省，缺省自动探测）
 *   "pollTimes": 4                      // 开通后轮询上游主机 ID 次数（默认 4，间隔 2s）
 * }
 *
 * 密钥安全：设置表中的 password 以 {"__enc":true} 密文落库（APP_KEY AES-256-GCM）；
 * 解析统一输出明文 ZjmfSupplierConfig 供 client 使用，密文/明文均接受。
 */
import { eq } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db/client";
import type { ModuleConfig } from "../../types.js";
import { decryptSettingValue, isEncryptedSettingValue } from "./crypto.js";
import type { ZjmfSupplierConfig } from "./client.js";

/** 设置表存储键：魔方供应商列表（JSON 数组，password 字段加密） */
export const ZJMF_SUPPLIERS_SETTING_KEY = "provisioning.zjmf.suppliers";

/** 设置表中的供应商条目（password 落库时为密文，解析后为明文） */
export interface ZjmfSupplierSetting {
  code: string;
  name: string;
  baseUrl: string;
  username: string;
  password: string | { __enc: true; v: string };
  apiTimeoutSec?: number;
  allowSelfSigned?: boolean;
  allowInsecureUrl?: boolean;
  /** 预留：admin 表示凭据为上游管理端 API（可完整暂停/终止）；当前实现仅用 member 能力 */
  apiTier?: "member" | "admin";
}

/** 商品级模块配置（解析后） */
export interface ZjmfModuleConfig {
  supplier: ZjmfSupplierConfig;
  supplierCode?: string;
  upProductId: number;
  upCycles: Record<string, string>;
  upConfigOption: Record<string, string>;
  pollTimes: number;
  pollIntervalMs: number;
}

function requirePositiveInt(v: unknown, label: string): number {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  throw new Error(`zjmf 模块配置 ${label} 无效（需正整数）`);
}

function parseSupplier(raw: unknown, label: string): ZjmfSupplierConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`zjmf 模块配置缺少 ${label}（供应商连接信息）`);
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.baseUrl !== "string" || !/^https?:\/\//i.test(s.baseUrl)) {
    throw new Error(`zjmf 模块配置 ${label}.baseUrl 缺失或非法（形如 https://upstream.example.com）`);
  }
  if (typeof s.username !== "string" || s.username === "" || typeof s.password !== "string" || s.password === "") {
    throw new Error(`zjmf 模块配置 ${label}.username/password 缺失`);
  }
  return {
    baseUrl: s.baseUrl.replace(/\/+$/, ""),
    username: s.username,
    password: s.password,
    ...(typeof s.apiTimeoutSec === "number" && s.apiTimeoutSec > 0 ? { apiTimeoutSec: s.apiTimeoutSec } : {}),
    allowSelfSigned: s.allowSelfSigned === true,
  };
}

/**
 * 解析设置表中的供应商列表（password 密文不在此处解密，返回原始条目）。
 * 读取失败/未配置返回空数组（不抛错，便于首次使用前查询）。
 */
export async function loadSupplierSettings(db: Db): Promise<ZjmfSupplierSetting[]> {
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, ZJMF_SUPPLIERS_SETTING_KEY))
    .limit(1);
  const raw = rows[0]?.value;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is ZjmfSupplierSetting =>
      v != null && typeof v === "object" &&
      typeof (v as Record<string, unknown>).code === "string" &&
      typeof (v as Record<string, unknown>).baseUrl === "string",
  );
}

/** 按 code 查找设置表供应商；不存在抛错 */
export async function findSupplierSetting(db: Db, code: string): Promise<ZjmfSupplierSetting> {
  const list = await loadSupplierSettings(db);
  const found = list.find((s) => s.code === code);
  if (!found) {
    throw new Error(`魔方供应商「${code}」不存在（设置键 ${ZJMF_SUPPLIERS_SETTING_KEY}）`);
  }
  return found;
}

/** 设置表条目 → 连接配置（password 密文在此解密为明文） */
export function supplierSettingToConfig(setting: ZjmfSupplierSetting): ZjmfSupplierConfig {
  const raw = setting.password;
  if (raw == null || raw === "") {
    throw new Error(`魔方供应商「${setting.code}」password 未配置`);
  }
  const password = isEncryptedSettingValue(raw) ? decryptSettingValue(raw.v) : raw;
  if (typeof password !== "string" || password === "") {
    throw new Error(`魔方供应商「${setting.code}」password 格式无效`);
  }
  return {
    baseUrl: setting.baseUrl.replace(/\/+$/, ""),
    username: setting.username,
    password,
    ...(typeof setting.apiTimeoutSec === "number" && setting.apiTimeoutSec > 0
      ? { apiTimeoutSec: setting.apiTimeoutSec }
      : {}),
    allowSelfSigned: setting.allowSelfSigned === true,
  };
}

/**
 * 解析合并后的模块配置。supplier 内联优先；否则按 supplierCode 从设置表解析。
 * 两种方式都未配置时抛错（错误信息进入供应任务轨道，便于后台排查）。
 */
export async function resolveZjmfConfig(db: Db, config: ModuleConfig): Promise<ZjmfModuleConfig> {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const upProductId = requirePositiveInt(cfg.upProductId, "upProductId");

  let supplier: ZjmfSupplierConfig;
  if (cfg.supplier && typeof cfg.supplier === "object") {
    supplier = parseSupplier(cfg.supplier, "supplier");
  } else if (typeof cfg.supplierCode === "string" && cfg.supplierCode !== "") {
    const setting = await findSupplierSetting(db, cfg.supplierCode);
    // 默认拒绝明文 http（会泄露 API 凭据）；allowInsecureUrl=true 仅为内网联调预留
    if (!setting.baseUrl.startsWith("https://") && setting.allowInsecureUrl !== true) {
      throw new Error(`魔方供应商「${setting.code}」baseUrl 必须为 https；如确需内网 http 请在供应商配置 allowInsecureUrl=true`);
    }
    supplier = supplierSettingToConfig(setting);
  } else {
    throw new Error("zjmf 模块配置缺少 supplier（内联）或 supplierCode（设置表引用）");
  }

  const upCycles: Record<string, string> = {};
  if (cfg.upCycles && typeof cfg.upCycles === "object" && !Array.isArray(cfg.upCycles)) {
    for (const [k, v] of Object.entries(cfg.upCycles as Record<string, unknown>)) {
      if (typeof v === "string" && v !== "") upCycles[k] = v;
    }
  }
  const upConfigOption: Record<string, string> = {};
  if (cfg.upConfigOption && typeof cfg.upConfigOption === "object" && !Array.isArray(cfg.upConfigOption)) {
    for (const [k, v] of Object.entries(cfg.upConfigOption as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== "") upConfigOption[k] = String(v);
    }
  }

  return {
    supplier,
    ...(typeof cfg.supplierCode === "string" ? { supplierCode: cfg.supplierCode } : {}),
    upProductId,
    upCycles,
    upConfigOption,
    pollTimes: typeof cfg.pollTimes === "number" && cfg.pollTimes > 0 ? Math.min(12, Math.round(cfg.pollTimes)) : 4,
    pollIntervalMs: 2_000,
  };
}

/** 供测试与连通测试路由使用：校验内联供应商配置形状（不解密设置表） */
export function parseInlineSupplier(raw: unknown): ZjmfSupplierConfig {
  return parseSupplier(raw, "supplier");
}
