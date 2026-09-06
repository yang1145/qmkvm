import { Redis } from "ioredis";

export type { Redis } from "ioredis";

let cached: Redis | undefined;
let cachedUrl: string | undefined;

/**
 * 进程级 Redis 单例。未配置 REDIS_URL 时返回 null，
 * 调用方必须实现内存降级（限流/队列）。
 */
export function getRedis(url?: string): Redis | null {
  const resolved = url ?? process.env.REDIS_URL;
  if (!resolved) return null;
  if (!cached || cachedUrl !== resolved) {
    cached = new Redis(resolved, {
      lazyConnect: false,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
    cachedUrl = resolved;
    cached.on("error", (err) => {
      // 避免 unhandled error 事件导致进程退出；具体限流/队列已有降级
      console.error("[redis] error:", err.message);
    });
  }
  return cached;
}
