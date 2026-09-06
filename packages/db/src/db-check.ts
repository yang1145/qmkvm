import mysql from "mysql2/promise";

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });
const [rows] = await c.query(
  "SELECT table_name AS tn FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name",
);
const names = (rows as { tn: string }[]).map((r) => r.tn);
console.log("共", names.length, "张表:");
console.log(names.join(", "));
const [users] = await c.query("SELECT COUNT(*) AS n FROM users");
const [products] = await c.query("SELECT COUNT(*) AS n FROM products");
console.log("users:", (users as { n: number }[])[0]!.n, "| products:", (products as { n: number }[])[0]!.n);
await c.end();
