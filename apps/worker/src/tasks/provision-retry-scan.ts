/** 供应任务兜底扫描：每 10 分钟。failed 退避重投 + queued 滞留补偿。 */
import { processQueuedTasks } from "@pinhaoji/provisioning";
import type { TaskDef } from "./framework.js";

interface ScanResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export const provisionRetryScanTask: TaskDef = {
  name: "provision.retry_scan",
  cron: "*/10 * * * *",
  description: "供应任务兜底：failed 指数退避重试 + queued 滞留补偿",
  run: (db) => processQueuedTasks(db, 50),
  evaluate: (result) => {
    const { failed } = (result ?? {}) as Partial<ScanResult>;
    return (failed ?? 0) > 0 ? "partial" : "success";
  },
};
