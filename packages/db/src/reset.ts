/**
 * 危险操作：清空数据库所有表（含 drizzle 迁移记录）。pnpm db:reset
 * 仅用于开发环境重置。
 */
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}

const connection = await mysql.createConnection({ uri: url, multipleStatements: true });

const [rows] = await connection.query(
  `SELECT table_name AS tn FROM information_schema.tables WHERE table_schema = DATABASE()`,
);
const tables = (rows as Record<string, unknown>[]).map((r) => String(r["tn"]));

if (tables.length === 0) {
  console.log("数据库已为空，无需清理");
} else {
  console.log(`将清空 ${tables.length} 张表:`, tables.join(", "));
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of tables) {
    await connection.query(`DROP TABLE IF EXISTS \`${t}\``);
  }
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  console.log("已清空全部表");
}

await connection.end();
