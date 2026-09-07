/**
 * Worker 定时任务注册表（SPEC-P0 §3 共 9 个）。
 * BullMQ repeatable（UTC cron）+ `pnpm --filter @qmkvm/worker task -- <name>` 手动执行共用。
 */
import { renewalInvoicesTask } from "./renewal-invoices.js";
import { renewalAutoTask } from "./renewal-auto.js";
import { serviceRemindersTask } from "./service-reminders.js";
import { serviceSuspendOverdueTask } from "./service-suspend-overdue.js";
import { serviceTerminateOverdueTask } from "./service-terminate-overdue.js";
import { paymentCloseStaleTask } from "./payment-close-stale.js";
import { paymentReconcileTask } from "./payment-reconcile.js";
import { provisionRetryScanTask } from "./provision-retry-scan.js";
import { systemCleanupTask } from "./system-cleanup.js";
import { systemJobHealthTask } from "./system-job-health.js";
import type { TaskDef } from "./framework.js";

export const TASKS: readonly TaskDef[] = [
  renewalInvoicesTask,
  renewalAutoTask,
  serviceRemindersTask,
  serviceSuspendOverdueTask,
  serviceTerminateOverdueTask,
  paymentCloseStaleTask,
  paymentReconcileTask,
  provisionRetryScanTask,
  systemCleanupTask,
  systemJobHealthTask,
];

export { runTask, type TaskDef, type TaskRunOutcome, type TaskStatus } from "./framework.js";
