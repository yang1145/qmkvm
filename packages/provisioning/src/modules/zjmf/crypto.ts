/**
 * 供应商 API 密钥的加解密（settings 表存储用）。
 *
 * 格式与 @qmkvm/payments settings-crypto.ts 完全一致：敏感字段以
 * `{"__enc":true,"v":"<iv:tag:ct>"}` 存储（AES-256-GCM，密钥取 APP_KEY base64
 * 解码后前 32 字节）。payments 与 provisioning 互不依赖（同层包禁止横向引用），
 * 故按 payments 的先例独立实现同一格式。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSettingValue {
  __enc: true;
  /** AES-256-GCM 密文：iv:tag:ct（base64 三段） */
  v: string;
}

export function isEncryptedSettingValue(v: unknown): v is EncryptedSettingValue {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  return rec.__enc === true && typeof rec.v === "string";
}

function appKey(): Buffer {
  const raw = process.env.APP_KEY;
  if (!raw) {
    throw new Error("APP_KEY 未配置（base64 编码的 32 字节密钥），无法处理魔方供应商密钥");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length < 32) {
    throw new Error("APP_KEY 无效：base64 解码后不足 32 字节");
  }
  return key.subarray(0, 32);
}

/** AES-256-GCM 加密（iv:tag:ct 三段 base64） */
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
