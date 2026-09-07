/** 余额自动续费：每日 00:30（UTC）扫描到期服务并从余额扣款续费。 */
import { autoRenewDueServices } from "@qmkvm/core";
import type { TaskDef } from "./framework.js";

export const renewalAutoTask: TaskDef = {
  name: "renewal.auto",
  cron: "30 0 * * *",
  description: "扫描到期服务并用余额自动续费（不足则通知失败）",
  run: (db, now) => autoRenewDueServices(db, now),
};
