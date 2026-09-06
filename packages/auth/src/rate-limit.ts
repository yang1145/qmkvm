/** 限流：Redis INCR+EXPIRE 固定窗口；无 Redis 时进程内 Map 降级 */

import { AppError } from "@pinhaoji/core/errors";
import { ERR } from "@pinhaoji/contracts";
import { getRedis } from "@pinhaoji/db/redis";

export interface RateLimitOptions {
  /** 窗口内允许的最大次数 */
  limit: number;
  /** 窗口长度（秒） */
  windowSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** 被限流时：建议的等待秒数（窗口剩余时间） */
  retryAfterSec?: number;
}

interface MemBucket {
  count: number;
  /** 窗口起点（毫秒时间戳） */
  windowStart: number;
}

/** 进程内降级桶（按 key 独立窗口） */
const memBuckets = new Map<string, MemBucket>();

function checkMemory(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSec * 1000;

  // 顺带清理过期桶，避免长驻进程内存缓慢膨胀
  if (memBuckets.size > 10_000) {
    for (const [k, b] of memBuckets) {
      if (now - b.windowStart >= windowMs) memBuckets.delete(k);
    }
  }

  const bucket = memBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    memBuckets.set(key, { count: 1, windowStart: now });
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  return { ok: true };
}

/**
 * 固定窗口限流检查。
 * Redis 路径：INCR 首次命中设置 EXPIRE，窗口内递增；超限返回 ok=false 与剩余秒数。
 */
export async function checkRateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const { limit, windowSec } = opts;
  const redis = getRedis();
  if (redis) {
    const fullKey = `phj:rl:${key}`;
    const count = await redis.incr(fullKey);
    if (count === 1) {
      await redis.expire(fullKey, windowSec);
    }
    if (count > limit) {
      const ttl = await redis.ttl(fullKey);
      // ttl=-1（无过期）或 -2（已消失）时回退为完整窗口
      const retryAfterSec = ttl > 0 ? ttl : windowSec;
      return { ok: false, retryAfterSec };
    }
    return { ok: true };
  }
  return checkMemory(key, limit, windowSec);
}

/** 限流强制执行：超限抛 AppError(RATE_LIMITED)，details 含 retryAfterSec */
export async function enforceRateLimit(key: string, opts: RateLimitOptions): Promise<void> {
  const result = await checkRateLimit(key, opts);
  if (!result.ok) {
    throw new AppError(ERR.RATE_LIMITED, "请求过于频繁，请稍后再试", {
      retryAfterSec: result.retryAfterSec,
    });
  }
}
