/**
 * 手动执行定时任务（无 Redis 依赖，交付后联调用）：
 *   pnpm --filter @qmkvm/worker task -- <taskName>
 * 例：pnpm --filter @qmkvm/worker task -- renewal.invoices
 */
import { getDb } from "@qmkvm/db";
import { TASKS, runTask } from "./tasks/index.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const taskName = args[0];
if (!taskName) {
  console.error("用法：pnpm --filter @qmkvm/worker task -- <taskName>");
  console.error("可用任务：");
  for (const t of TASKS) {
    console.error(`  ${t.name.padEnd(26)} ${t.cron.padEnd(12)} ${t.description}`);
  }
  process.exit(1);
}

const task = TASKS.find((t) => t.name === taskName);
if (!task) {
  console.error(`未知任务：${taskName}`);
  console.error(`可用任务：${TASKS.map((t) => t.name).join(", ")}`);
  process.exit(1);
}

const db = getDb();
const outcome = await runTask(db, task);

console.log(
  JSON.stringify(
    { task: task.name, status: outcome.status, result: outcome.result ?? null, error: outcome.error ?? null },
    null,
    2,
  ),
);
process.exit(outcome.status === "failed" ? 1 : 0);
