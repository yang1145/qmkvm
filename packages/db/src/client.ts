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
