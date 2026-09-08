/**
 * 按供应商串行化魔方上游写操作（provision/renew/changePackage）。
 *
 * 背景：魔方购物车是上游账号级共享资源，cart/settle 会结算整辆购物车——
 * 同一上游账号的两个开通任务并发执行会互相污染（MNBT 版曾实测"一次开出多台机器"）。
 * runner 按任务原子领取防的是同一任务的重复执行，防不了不同服务命中同一上游账号。
 *
 * 实现：配置 REDIS_URL 时用 SET NX PX 跨进程互斥（api/worker 多副本安全）；
 * 无 Redis 降级为进程内 promise 链（单进程开发模式；每个任务终会完成或失败，
 * 链不会永久阻塞，故无需等待超时）。Redis 模式等待超时抛错，任务走重试轨道。
 */
import { getRedis } from "@qmkvm/db";

const LOCK_TTL_MS = 5 * 60_000; // 单次上游编排（含轮询）上限约 4 分钟，TTL 兜底防死锁
const LOCK_WAIT_MS = 30_000;
const LOCK_RETRY_MS = 500;

/** 进程内锁：key → 链尾 promise（吞掉异常避免毒化后续排队者） */
const localLocks = new Map<string, Promise<unknown>>();

function withLocalLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = localLocks.get(key) ?? Promise.resolve();
  const run = previous.then(
    () => fn(),
    () => fn(),
  );
  localLocks.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

async function withRedisLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (!redis) return withLocalLock(key, fn);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const ok = await redis.set(key, "1", "PX", LOCK_TTL_MS, "NX");
    if (ok === "OK") break;
    if (Date.now() > deadline) {
      throw new Error(`上游操作锁等待超时（${LOCK_WAIT_MS}ms）：${key}（并发任务过多或上游卡死）`);
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
  try {
    return await fn();
  } finally {
    await redis.del(key).catch(() => undefined);
  }
}

/** 供应商锁 key（含模块前缀避免与其他系统的 Redis key 冲突） */
export function supplierLockKey(supplierCodeOrUrl: string): string {
  return `qmkvm:lock:zjmf:${supplierCodeOrUrl}`;
}

/** 在供应商互斥锁内执行上游写操作 */
export function withSupplierLock<T>(lockId: string, fn: () => Promise<T>): Promise<T> {
  return withRedisLock(supplierLockKey(lockId), fn);
}
