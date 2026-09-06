import {
  bigint,
  boolean,
  datetime,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./users.js";
import { createdAt, id, updatedAt, type Json } from "./_shared.js";

/** 优惠码：默认互斥（单订单仅一张） */
export const promotions = mysqlTable(
  "promotions",
  {
    id: id(),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    /** percent: value=1..100；fixed: value=分 */
    type: mysqlEnum("type", ["percent", "fixed"]).notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    scope: mysqlEnum("scope", ["all", "products", "groups"]).notNull().default("all"),
    scopeIds: json("scope_ids").$type<number[]>(),
    minAmount: bigint("min_amount", { mode: "number" }).notNull().default(0),
    maxUses: bigint("max_uses", { mode: "number" }),
    perUserLimit: bigint("per_user_limit", { mode: "number" }).notNull().default(1),
    newCustomerOnly: boolean("new_customer_only").notNull().default(false),
    startsAt: datetime("starts_at", { mode: "date" }),
    endsAt: datetime("ends_at", { mode: "date" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("promotions_code_uq").on(t.code)],
);

export const promotionUsages = mysqlTable(
  "promotion_usages",
  {
    id: id(),
    promotionId: bigint("promotion_id", { mode: "number" })
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    orderId: bigint("order_id", { mode: "number" }).notNull(),
    discountAmount: bigint("discount_amount", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("promotion_usages_order_uq").on(t.promotionId, t.orderId),
    index("promotion_usages_user_idx").on(t.userId),
  ],
);
