/** 密码哈希：argon2id（@node-rs/argon2 默认参数） */

import { hash, verify } from "@node-rs/argon2";

/** 生成 argon2id 密码哈希（PHC 格式字符串，含盐与参数） */
export function hashPassword(pw: string): Promise<string> {
  return hash(pw);
}

/** 校验密码；哈希格式非法等异常一律按不匹配处理 */
export async function verifyPassword(pwHash: string, pw: string): Promise<boolean> {
  try {
    return await verify(pwHash, pw);
  } catch {
    return false;
  }
}
