/**
 * settings 表网关配置的加解密与解码。
 *
 * settings.value 为 JSON；敏感字段以 `{"__enc":true,"v":"<aes>"}` 形式存储，
 * 解密算法与 @pinhaoji/auth 的 crypto 保持一致：AES-256-GCM，密钥取 APP_KEY
 * （base64 解码后前 32 字节），密文格式 `iv:tag:ct`（三段 base64，":" 分隔）。
 *
 * payments 包不依赖 auth 包（避免越权依赖），故在此独立实现同一格式。
 */

import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";

/** 加密字段标记结构 */
export interface EncryptedSettingValue {
  __enc: true;
  /** AES-256-GCM 密文：iv:tag:ct（base64 三段） */
  v: string;
}

/** 判断 settings 值是否为加密包裹字段 */
export function isEncryptedSettingValue(v: unknown): v is EncryptedSettingValue {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  return rec.__enc === true && typeof rec.v === "string";
}

function appKey(): Buffer {
  const raw = process.env.APP_KEY;
  if (!raw) {
    throw new Error("APP_KEY 未配置（base64 编码的 32 字节密钥），无法解密网关敏感配置");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length < 32) {
    throw new Error("APP_KEY 无效：base64 解码后不足 32 字节");
  }
  return key.subarray(0, 32);
}

/** AES-256-GCM 加密（iv:tag:ct 三段 base64）；供后台设置写入与测试使用 */
export function encryptSettingValue(plaintext: string): EncryptedSettingValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", appKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __enc: true,
    v: [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":"),
  };
}

/** AES-256-GCM 解密（对应 encryptSettingValue 的输出格式），失败抛异常 */
export function decryptSettingValue(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("密文格式无效（应为 iv:tag:ct 三段 base64）");
  }
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", appKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * 解码单个网关配置对象：递归（最多两层）把 {"__enc":true,"v"} 包裹字段解密为明文字符串，
 * 其余值原样保留。两层深度用于覆盖嵌套结构（如 wechat.platformCerts 的 serial → 密文）。
 */
export function decodeGatewaySetting(raw: unknown): Record<string, unknown> {
  const decoded = decodeNode(raw, 2);
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return {};
  }
  return decoded as Record<string, unknown>;
}

function decodeNode(v: unknown, depth: number): unknown {
  if (isEncryptedSettingValue(v)) {
    return decryptSettingValue(v.v);
  }
  if (depth <= 0) return v;
  if (Array.isArray(v)) return v.map((item) => decodeNode(item, depth - 1));
  if (typeof v === "object" && v !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = decodeNode(val, depth - 1);
    }
    return out;
  }
  return v;
}
