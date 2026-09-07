/**
 * seed 脚本专用 argon2 封装：与 @qmkvm/auth 使用相同算法参数，
 * 避免种子脚本依赖 auth 包（auth 依赖 core，core 依赖 db 形成环）。
 */
import { hash } from "@node-rs/argon2";

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}
