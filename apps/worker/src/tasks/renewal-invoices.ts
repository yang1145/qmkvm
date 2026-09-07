/** 续费账单批量生成：每日 03:00（UTC）。 */
import { generateDueRenewalInvoices } from "@qmkvm/core";
import type { TaskDef } from "./framework.js";

export const renewalInvoicesTask: TaskDef = {
  name: "renewal.invoices",
  cron: "0 3 * * *",
  description: "扫描即将到期服务并生成续费账单",
  run: (db, now) => generateDueRenewalInvoices(db, now),
};
