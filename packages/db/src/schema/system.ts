import {
  bigint,
  datetime,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";
import { createdAt, id, updatedAt, type Json } from "./_shared.js";

/** 系统设置：key-value，value 为 JSON。敏感字段以 {"__enc":true,"v":"..."} 形式加密存储 */
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: json("value").$type<Json>().notNull(),
  updatedAt: updatedAt(),
});

/** 定时/后台任务执行记录：可视化与告警依据 */
export const jobRuns = mysqlTable("job_runs", {
  id: id(),
  taskName: varchar("task_name", { length: 50 }).notNull(),
  status: mysqlEnum("status", ["success", "partial", "failed"]).notNull(),
  result: json("result").$type<Json>(),
  error: text("error"),
  startedAt: datetime("started_at", { mode: "date" }).notNull(),
  finishedAt: datetime("finished_at", { mode: "date" }),
  createdAt: createdAt(),
});

/** 领域事件外发 Webhook（P2 启用，表结构先建） */
export const webhookEndpoints = mysqlTable("webhook_endpoints", {
  id: id(),
  url: varchar("url", { length: 500 }).notNull(),
  secret: varchar("secret", { length: 128 }).notNull(),
  events: json("events").$type<string[]>(),
  active: mysqlEnum("active", ["0", "1"]).notNull().default("1"),
  description: varchar("description", { length: 255 }),
  createdAt: createdAt(),
});

export const webhookDeliveries = mysqlTable(
  "webhook_deliveries",
  {
    id: id(),
    endpointId: bigint("endpoint_id", { mode: "number" }).notNull(),
    event: varchar("event", { length: 50 }).notNull(),
    payload: json("payload").$type<Json>().notNull(),
    status: mysqlEnum("status", ["pending", "delivered", "failed"]).notNull().default("pending"),
    attempts: bigint("attempts", { mode: "number" }).notNull().default(0),
    responseStatus: bigint("response_status", { mode: "number" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("webhook_deliveries_status_idx").on(t.status, t.createdAt)],
);
