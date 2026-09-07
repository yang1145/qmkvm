/** 到期提醒（T-14/7/3/1）：每日 09:00（UTC）。 */
import { enqueueDueReminders } from "@qmkvm/core";
import type { TaskDef } from "./framework.js";

export const serviceRemindersTask: TaskDef = {
  name: "service.reminders",
  cron: "0 9 * * *",
  description: "对即将到期服务按 T-14/7/3/1 发送到期提醒",
  run: (db, now) => enqueueDueReminders(db, now),
};
