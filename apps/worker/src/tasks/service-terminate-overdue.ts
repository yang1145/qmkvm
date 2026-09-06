/** 欠费终止调度：每日 04:30（UTC）。core 创建 terminate 供应任务（终止前先发最终提醒）。 */
import { terminateOverdueServices } from "@pinhaoji/core";
import type { TaskDef } from "./framework.js";

export const serviceTerminateOverdueTask: TaskDef = {
  name: "service.terminate_overdue",
  cron: "30 4 * * *",
  description: "超终止阈值的 suspended_overdue 服务调度 terminate 供应任务",
  run: (db, now) => terminateOverdueServices(db, now),
};
