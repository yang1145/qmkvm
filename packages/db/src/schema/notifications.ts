import {
  bigint,
  boolean,
  datetime,
  index,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./users.js";
import { createdAt, id, updatedAt } from "./_shared.js";

/** 通知模板：channel × event 唯一；body 支持 {{user.name}} 风格变量 */
export const notificationTemplates = mysqlTable(
  "notification_templates",
  {
    id: id(),
    channel: mysqlEnum("channel", ["email", "sms", "inapp"]).notNull(),
    /** 事件名：invoice.created / service.activated / ticket.replied ... */
    event: varchar("event", { length: 50 }).notNull(),
    subject: varchar("subject", { length: 255 }),
    body: text("body").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("notification_templates_uq").on(t.channel, t.event)],
);

export const notificationLogs = mysqlTable(
  "notification_logs",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    channel: mysqlEnum("channel", ["email", "sms", "inapp", "webhook"]).notNull(),
    event: varchar("event", { length: 50 }).notNull(),
    target: varchar("target", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["sent", "failed"]).notNull(),
    error: text("error"),
    provider: varchar("provider", { length: 30 }),
    providerMessageId: varchar("provider_message_id", { length: 128 }),
    createdAt: createdAt(),
  },
  (t) => [index("notification_logs_user_idx").on(t.userId, t.createdAt)],
);

/** 站内通知 */
export const userNotifications = mysqlTable(
  "user_notifications",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    body: varchar("body", { length: 1000 }),
    link: varchar("link", { length: 500 }),
    readAt: datetime("read_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("user_notifications_user_idx").on(t.userId, t.readAt)],
);
