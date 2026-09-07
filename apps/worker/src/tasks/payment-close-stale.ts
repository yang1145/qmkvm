/** 过期支付单关闭：每分钟。core 关闭过期 intent 并释放关联 pending 订单库存。 */
import { closeStalePaymentIntents } from "@qmkvm/core";
import type { TaskDef } from "./framework.js";

export const paymentCloseStaleTask: TaskDef = {
  name: "payment.close_stale",
  cron: "* * * * *",
  description: "关闭过期支付单并取消关联 pending 订单（释放库存）",
  run: (db, now) => closeStalePaymentIntents(db, now),
};
