import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDb>;
export { schema };

let cached: Db | undefined;
let cachedUrl: string | undefined;

export function createDb(url: string) {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 10,
    waitForConnections: true,
    // 计费事务需要可重复读默认隔离级（MySQL 默认 RR）
    timezone: "Z",
    supportBigNumbers: true,
    // 主备形态下 VIP/代理漂移时旧连接会断：failover 后新获取的连接重建即可，
    // connectTimeout 控制建连失败快速报错（由 BullMQ 退避重试与回调幂等兜底）
    connectTimeout: 10_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
  });
  return drizzle(pool, { schema, mode: "default" });
}

/** 进程级单例（按连接串缓存，便于测试注入不同库） */
export function getDb(url?: string): Db {
  const resolved = url ?? process.env.DATABASE_URL;
  if (!resolved) {
    throw new Error("DATABASE_URL 未配置（形如 mysql://user:pass@host:3306/db）");
  }
  if (!cached || cachedUrl !== resolved) {
    cached = createDb(resolved);
    cachedUrl = resolved;
  }
  return cached;
}

// —— 只读副本连接（主从兼容）：未配置 DATABASE_URL_RO 时回落主连接 ——
// 语义约定：getDbRO() 仅用于**可容忍主从延迟的读路径**（报表/导出/审计检索）；
// 任何"读后写"或强一致读（如审核前核对最新状态）必须用 getDb()。

let cachedRo: Db | undefined;
let cachedRoUrl: string | undefined;

/** 只读副本连接；DATABASE_URL_RO 未配置时返回主连接（单机部署零配置兼容） */
export function getDbRO(): Db {
  const roUrl = process.env.DATABASE_URL_RO;
  if (!roUrl) return getDb();
  if (!cachedRo || cachedRoUrl !== roUrl) {
    cachedRo = createDb(roUrl);
    cachedRoUrl = roUrl;
  }
  return cachedRo;
}
