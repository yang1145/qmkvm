/**
 * auth 纯模块快速自检（不依赖 DB/Redis）：
 * tsx tests/smoke.check.ts
 */

import { randomBytes } from "node:crypto";

// AES 主密钥需在调用前设置
process.env.APP_KEY = Buffer.from(randomBytes(32)).toString("base64");

import { aesDecrypt, aesEncrypt, maskEmail, maskPhone, randomToken, sha256hex } from "../src/crypto.js";
import { hashPassword, verifyPassword } from "../src/password.js";
import { checkRateLimit, enforceRateLimit } from "../src/rate-limit.js";
import { AppError } from "@pinhaoji/core/errors";

let failed = 0;

function expect(cond: boolean, label: string): void {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

// —— crypto ——
const token = randomToken(32);
expect(/^[A-Za-z0-9_-]{42,44}$/.test(token), `randomToken 为 base64url（len=${token.length}）`);
expect(sha256hex("abc").length === 64, "sha256hex 输出 64 位 hex");

const secret = "机密数据 secret-123";
const encrypted = aesEncrypt(secret);
expect(encrypted.split(":").length === 3, "aesEncrypt 输出 iv:tag:ct 三段");
expect(aesDecrypt(encrypted) === secret, "AES-256-GCM 加解密往返一致");

expect(maskPhone("13812341234") === "138****1234", "maskPhone 138****1234");
expect(maskEmail("alice@example.com") === "a***@example.com", "maskEmail a***@example.com");

// —— password ——
const pwHash = await hashPassword("passw0rd123");
expect(pwHash.startsWith("$argon2id$"), "hashPassword 为 argon2id");
expect(await verifyPassword(pwHash, "passw0rd123"), "verifyPassword 正确密码");
expect(!(await verifyPassword(pwHash, "wrongpass1")), "verifyPassword 错误密码");

// —— rate-limit（无 Redis → 内存降级） ——
if (process.env.REDIS_URL) delete process.env.REDIS_URL;
const key = `smoke:${Date.now()}`;
let limited: { ok: boolean; retryAfterSec?: number } | null = null;
for (let i = 0; i < 4; i += 1) {
  limited = await checkRateLimit(key, { limit: 3, windowSec: 60 });
}
expect(limited?.ok === false && (limited?.retryAfterSec ?? 0) > 0, "内存限流：超过 limit 返回 ok=false + retryAfterSec");

let threw: unknown;
try {
  for (let i = 0; i < 5; i += 1) {
    await enforceRateLimit(`smoke2:${Date.now()}`, { limit: 2, windowSec: 60 });
  }
} catch (err) {
  threw = err;
}
expect(
  threw instanceof AppError && threw.code === "RATE_LIMITED" && threw.status === 429,
  "enforceRateLimit 超限抛 AppError(RATE_LIMITED, 429)",
);

if (failed > 0) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log("\nauth 纯模块自检全部通过");
