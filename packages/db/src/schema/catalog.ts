import {
  bigint,
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { createdAt, id, updatedAt, type Json } from "./_shared.js";

/** 商品分组 */
export const productGroups = mysqlTable(
  "product_groups",
  {
    id: id(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    description: text("description"),
    sortOrder: int("sort_order").notNull().default(0),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("product_groups_slug_uq").on(t.slug)],
);

/** 商品 */
export const products = mysqlTable(
  "products",
  {
    id: id(),
    groupId: bigint("group_id", { mode: "number" })
      .notNull()
      .references(() => productGroups.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 150 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    tagline: varchar("tagline", { length: 255 }),
    descriptionHtml: text("description_html"),
    /** 供应模块 code：manual / http-api / demo / 自定义 */
    moduleCode: varchar("module_code", { length: 50 }).notNull().default("manual"),
    moduleConfig: json("module_config").$type<Json>(),
    /** null = 不限量 */
    stockTotal: int("stock_total"),
    stockUsed: int("stock_used").notNull().default(0),
    hidden: boolean("hidden").notNull().default(false),
    requiresIdentity: boolean("requires_identity").notNull().default(false),
    allowUpgrade: boolean("allow_upgrade").notNull().default(true),
    allowDowngrade: boolean("allow_downgrade").notNull().default(false),
    sortOrder: int("sort_order").notNull().default(0),
    status: mysqlEnum("status", ["active", "inactive"]).notNull().default("inactive"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("products_slug_uq").on(t.slug), index("products_group_idx").on(t.groupId)],
);

/** 商品按计费周期的价格（单位：分） */
export const productPricing = mysqlTable(
  "product_pricing",
  {
    id: id(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    cycle: mysqlEnum("cycle", [
      "onetime",
      "monthly",
      "quarterly",
      "semiannually",
      "annually",
      "biennially",
      "triennially",
    ]).notNull(),
    firstPrice: bigint("first_price", { mode: "number" }).notNull(),
    renewalPrice: bigint("renewal_price", { mode: "number" }).notNull(),
    setupFee: bigint("setup_fee", { mode: "number" }).notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("product_pricing_uq").on(t.productId, t.cycle)],
);

/** 可配置选项组（随商品购买，如 CPU/内存/带宽/地域） */
export const configGroups = mysqlTable(
  "config_groups",
  {
    id: id(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    type: mysqlEnum("type", ["select", "radio", "checkbox", "quantity"]).notNull(),
    required: boolean("required").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => [index("config_groups_product_idx").on(t.productId)],
);

/** 可配置选项（priceDelta 为每周期加价；setupDelta 为一次性加价） */
export const configOptions = mysqlTable(
  "config_options",
  {
    id: id(),
    groupId: bigint("group_id", { mode: "number" })
      .notNull()
      .references(() => configGroups.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 100 }).notNull(),
    value: varchar("value", { length: 100 }).notNull(),
    priceDelta: bigint("price_delta", { mode: "number" }).notNull().default(0),
    setupDelta: bigint("setup_delta", { mode: "number" }).notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => [index("config_options_group_idx").on(t.groupId)],
);
