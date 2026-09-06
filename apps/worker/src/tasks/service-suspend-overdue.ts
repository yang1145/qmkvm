/** 欠费暂停调度：每日 04:00（UTC）。core 创建 suspend 供应任务，由供应模块执行。 */
import { suspendOverdueServices } from "@pinhaoji/core";
import type { TaskDef } from "./framework.js";

export const serviceSuspendOverdueTask: TaskDef = {
  name: "service.suspend_overdue",
  cron: "0 4 * * *",
  description: "宽限期已过的 active 服务调度 suspend 供应任务",
  run: (db, now) => suspendOverdueServices(db, now),
};
