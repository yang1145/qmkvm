import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./users.js";
import { services } from "./services.js";
import { createdAt, id, updatedAt } from "./_shared.js";

export const ticketDepartments = mysqlTable("ticket_departments", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull(),
  emailTo: varchar("email_to", { length: 255 }),
  sortOrder: int("sort_order").notNull().default(0),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: createdAt(),
});

export const tickets = mysqlTable(
  "tickets",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    departmentId: bigint("department_id", { mode: "number" })
      .notNull()
      .references(() => ticketDepartments.id, { onDelete: "restrict" }),
    serviceId: bigint("service_id", { mode: "number" }).references(() => services.id, {
      onDelete: "set null",
    }),
    subject: varchar("subject", { length: 200 }).notNull(),
    status: mysqlEnum("status", [
      "open",
      "answered",
      "customer_reply",
      "in_progress",
      "resolved",
      "closed",
    ])
      .notNull()
      .default("open"),
    priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"])
      .notNull()
      .default("medium"),
    lastReplyAt: datetime("last_reply_at", { mode: "date" }),
    lastReplyBy: mysqlEnum("last_reply_by", ["customer", "staff"]),
    closedAt: datetime("closed_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tickets_user_idx").on(t.userId, t.createdAt),
    index("tickets_status_idx").on(t.status, t.lastReplyAt),
    index("tickets_dept_idx").on(t.departmentId, t.status),
  ],
);

export const ticketReplies = mysqlTable(
  "ticket_replies",
  {
    id: id(),
    ticketId: bigint("ticket_id", { mode: "number" })
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorUserId: bigint("author_user_id", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    authorAdminId: bigint("author_admin_id", { mode: "number" }),
    authorType: mysqlEnum("author_type", ["customer", "staff", "system"]).notNull(),
    contentHtml: text("content_html").notNull(),
    /** 内部备注：客户不可见 */
    internalNote: boolean("internal_note").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("ticket_replies_ticket_idx").on(t.ticketId, t.createdAt)],
);

/** 工单附件：本地磁盘隔离存储（uploads/），白名单类型 */
export const attachments = mysqlTable(
  "attachments",
  {
    id: id(),
    ticketId: bigint("ticket_id", { mode: "number" }).references(() => tickets.id, {
      onDelete: "cascade",
    }),
    replyId: bigint("reply_id", { mode: "number" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    storedPath: varchar("stored_path", { length: 500 }).notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    createdByType: mysqlEnum("created_by_type", ["customer", "staff"]).notNull(),
    createdByUserId: bigint("created_by_user_id", { mode: "number" }),
    createdByAdminId: bigint("created_by_admin_id", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_ticket_idx").on(t.ticketId)],
);

/** 知识库（P1 首迭代）：分类 + 文章 */
export const kbCategories = mysqlTable("kb_categories", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

export const kbArticles = mysqlTable(
  "kb_articles",
  {
    id: id(),
    categoryId: bigint("category_id", { mode: "number" })
      .notNull()
      .references(() => kbCategories.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 200 }).notNull(),
    contentHtml: text("content_html").notNull(),
    /** public=未登录可见, login=需登录 */
    visibility: mysqlEnum("visibility", ["public", "login"]).notNull().default("public"),
    views: int("views").notNull().default(0),
    published: boolean("published").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("kb_articles_slug_uq").on(t.slug)],
);
