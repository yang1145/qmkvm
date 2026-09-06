import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./users.js";
import { products } from "./catalog.js";
import { createdAt, id, updatedAt, type Json, type BillingCycle } from "./_shared.js";

/** 订单：购物车结算产物，type 区分新购/续费/升级/充值/人工 */
export const orders = mysqlTable(
  "orders",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: mysqlEnum("type", ["new", "renewal", "upgrade", "recharge", "manual"]).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "paid",
      "processing",
      "completed",
      "cancelled",
      "failed",
    ])
      .notNull()
      .default("pending"),
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    discount: bigint("discount", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    promoId: bigint("promo_id", { mode: "number" }),
    promoCode: varchar("promo_code", { length: 50 }),
    balanceUsed: bigint("balance_used", { mode: "number" }).notNull().default(0),
    paidAt: datetime("paid_at", { mode: "date" }),
    cancelledAt: datetime("cancelled_at", { mode: "date" }),
    note: varchar("note", { length: 500 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("orders_user_idx").on(t.userId, t.createdAt), index("orders_status_idx").on(t.status)],
);

export const orderItems = mysqlTable(
  "order_items",
  {
    id: id(),
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: bigint("product_id", { mode: "number" }).references(() => products.id, {
      onDelete: "set null",
    }),
    /** 续费/升级单指向既有服务 */
    serviceId: bigint("service_id", { mode: "number" }),
    description: varchar("description", { length: 255 }).notNull(),
    qty: int("qty").notNull().default(1),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull().default(0),
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    /** 配置快照：周期、选项、目标规格等 */
    meta: json("meta").$type<Json>(),
    createdAt: createdAt(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/** 服务端购物车：一行 = {itemId, productId, cycle, options:[{groupId,optionIds,quantity}], qty} */
export type CartLine = {
  itemId: string;
  productId: number;
  cycle: BillingCycle;
  options: { groupId: number; optionIds: number[]; quantity?: number }[];
  qty: number;
  addedAt: string;
};

export const carts = mysqlTable("carts", {
  userId: bigint("user_id", { mode: "number" })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  items: json("items").$type<CartLine[]>().notNull(),
  updatedAt: updatedAt(),
});
