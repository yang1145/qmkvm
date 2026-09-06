/**
 * 独立迁移脚本：pnpm db:migrate
 * 需要环境变量 DATABASE_URL。迁移文件位于 packages/db/drizzle。
 */
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../drizzle");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}

const connection = mysql.createPool({ uri: url, connectionLimit: 2 });
const db = drizzle(connection, { mode: "default" });

try {
  await migrate(db, { migrationsFolder });
  console.log("迁移完成:", migrationsFolder);
} catch (err) {
  console.error("迁移失败:", err);
  process.exitCode = 1;
} finally {
  await connection.end();
}
