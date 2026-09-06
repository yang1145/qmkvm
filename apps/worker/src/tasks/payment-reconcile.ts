/**
 * 掉单补偿：每小时第 15 分。调 payments.queryAndSettleStaleIntents 主动查网关。
 * payments 包经动态导入（实现落地前任务报错进 job_runs，不影响其他任务）。
 */
import type { Db } from "@pinhaoji/db";
import type { TaskDef } from "./framework.js";

async function run(db: Db, now: Date): Promise<unknown> {
  const payments = await import("@pinhaoji/payments");
  return payments.queryAndSettleStaleIntents(db, now);
}

export const paymentReconcileTask: TaskDef = {
  name: "payment.reconcile",
  cron: "15 * * * *",
  description: "主动查询支付网关补偿掉单（paying 未过期 intent）",
  run,
};
