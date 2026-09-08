import {
  bigint,
  boolean,
  date,
  datetime,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./users.js";
import { products } from "./catalog.js";
import { orders } from "./orders.js";
import { createdAt, id, updatedAt, type Json } from "./_shared.js";

/**
 * 服务实例（WHMCS 的 hosting service）：客户订购的一台云服务器等资源。
 * config 为购买时选项快照；deliverInfo 为供应模块回填的交付信息（IP 等）。
 */
export const services = mysqlTable(
  "services",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    orderId: bigint("order_id", { mode: "number" }).references(() => orders.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 150 }).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "active",
      "suspended_overdue",
      "suspended_manual",
      "terminated",
      "cancelled",
    ])
      .notNull()
      .default("pending"),
    config: json("config").$type<Json>(),
    cycle: mysqlEnum("cycle", [
      "onetime",
      "monthly",
      "quarterly",
      "semiannually",
      "annually",
      "biennially",
      "triennially",
    ]).notNull(),
    firstAmount: bigint("first_amount", { mode: "number" }).notNull().default(0),
    renewalAmount: bigint("renewal_amount", { mode: "number" }).notNull().default(0),
    nextDueDate: date("next_due_date", { mode: "string" }),
    moduleCode: varchar("module_code", { length: 50 }).notNull().default("manual"),
    moduleConfig: json("module_config").$type<Json>(),
    deliverInfo: json("deliver_info").$type<Json>(),
    /** 用户申请到期取消：不生成续费账单，到期后走终止流程 */
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** 余额自动续费开关（opt-in，默认关） */
    autoRenew: boolean("auto_renew").notNull().default(false),
    suspendedAt: datetime("suspended_at", { mode: "date" }),
    terminatedAt: datetime("terminated_at", { mode: "date" }),
    cancelledAt: datetime("cancelled_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("services_user_idx").on(t.userId, t.status),
    index("services_due_idx").on(t.nextDueDate),
    index("services_status_idx").on(t.status),
  ],
);

/** 供应任务：由事件或定时任务产生，Worker 执行供应模块并落结果 */
export const provisionTasks = mysqlTable(
  "provision_tasks",
  {
    id: id(),
    serviceId: bigint("service_id", { mode: "number" })
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    orderId: bigint("order_id", { mode: "number" }),
    action: mysqlEnum("action", [
      "provision",
      "suspend",
      "unsuspend",
      "terminate",
      "change_package",
      "sync",
      "renew",
    ]).notNull(),
    status: mysqlEnum("status", [
      "queued",
      "processing",
      "succeeded",
      "failed",
      "dead",
      "skipped",
    ])
      .notNull()
      .default("queued"),
    attempts: bigint("attempts", { mode: "number" }).notNull().default(0),
    maxAttempts: bigint("max_attempts", { mode: "number" }).notNull().default(5),
    payload: json("payload").$type<Json>(),
    result: json("result").$type<Json>(),
    lastError: text("last_error"),
    createdById: bigint("created_by_id", { mode: "number" }),
    executedAt: datetime("executed_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("provision_tasks_status_idx").on(t.status, t.createdAt),
    index("provision_tasks_service_idx").on(t.serviceId),
  ],
);
