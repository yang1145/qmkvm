/** 加密与脱敏工具：AES-256-GCM（主密钥取自 APP_KEY）、随机 token、SHA-256、手机号/邮箱脱敏 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/** 从 APP_KEY（base64 编码的 32 字节）解析 AES-256 主密钥 */
function appKey(): Buffer {
  const raw = process.env.APP_KEY;
  if (!raw) {
    throw new Error("APP_KEY 未配置（base64 编码的 32 字节密钥）");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length < 32) {
    throw new Error("APP_KEY 无效：base64 解码后不足 32 字节");
  }
  return key.subarray(0, 32);
}

/** 生成 base64url 随机 token（默认 32 字节熵） */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 十六进制摘要（小写） */
export function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * AES-256-GCM 加密。
 * 输出格式：base64(iv).base64(tag).base64(ct)，用 ":" 分隔。
 */
export function aesEncrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", appKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** AES-256-GCM 解密（对应 aesEncrypt 的输出格式），失败抛异常 */
export function aesDecrypt(payload: string): string {
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

/** 手机号脱敏：138****1234；过短时全遮蔽 */
export function maskPhone(p: string): string {
  if (p.length < 7) return "****";
  return `${p.slice(0, 3)}****${p.slice(-4)}`;
}

/** 邮箱脱敏：a***@b.com；无 @ 时全遮蔽 */
export function maskEmail(e: string): string {
  const at = e.indexOf("@");
  if (at <= 0) return "***";
  return `${e[0]}***${e.slice(at)}`;
}
