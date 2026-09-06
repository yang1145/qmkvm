import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";
import { orders } from "./orders.js";
import { createdAt, id, updatedAt, type Json } from "./_shared.js";

/**
 * 账单（invoice）：催收与对账依据。
 * invoiceNo 规则：PHJ-YYYYMM-XXXXXX。
 */
export const invoices = mysqlTable(
  "invoices",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    invoiceNo: varchar("invoice_no", { length: 32 }).notNull(),
    type: mysqlEnum("type", ["order", "renewal", "upgrade", "recharge", "manual"]).notNull(),
    status: mysqlEnum("status", [
      "unpaid",
      "paid",
      "void",
      "refunded",
      "partially_refunded",
    ]).notNull(),
    orderId: bigint("order_id", { mode: "number" }).references(() => orders.id, {
      onDelete: "set null",
    }),
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    discount: bigint("discount", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    balanceUsed: bigint("balance_used", { mode: "number" }).notNull().default(0),
    paidAt: datetime("paid_at", { mode: "date" }),
    dueAt: datetime("due_at", { mode: "date" }),
    voidReason: varchar("void_reason", { length: 255 }),
    voidedByAdminId: bigint("voided_by_admin_id", { mode: "number" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_no_uq").on(t.invoiceNo),
    index("invoices_user_idx").on(t.userId, t.status),
    index("invoices_status_idx").on(t.status),
  ],
);

export const invoiceItems = mysqlTable(
  "invoice_items",
  {
    id: id(),
    invoiceId: bigint("invoice_id", { mode: "number" })
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: varchar("description", { length: 255 }).notNull(),
    qty: int("qty").notNull().default(1),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull().default(0),
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    meta: json("meta").$type<Json>(),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId)],
);

/** 网关资金流水。唯一键 (gatewayCode, gatewayTxnId) 保证回调幂等之外的一层防护 */
export const transactions = mysqlTable(
  "transactions",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    invoiceId: bigint("invoice_id", { mode: "number" }).references(() => invoices.id, {
      onDelete: "set null",
    }),
    paymentIntentId: bigint("payment_intent_id", { mode: "number" }),
    gatewayCode: varchar("gateway_code", { length: 30 }).notNull(),
    gatewayTxnId: varchar("gateway_txn_id", { length: 64 }).notNull(),
    type: mysqlEnum("type", ["payment", "refund"]).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    fee: bigint("fee", { mode: "number" }).notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    status: mysqlEnum("status", ["pending", "success", "failed", "refunded"]).notNull(),
    raw: json("raw").$type<Json>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("transactions_gateway_uq").on(t.gatewayCode, t.gatewayTxnId),
    index("transactions_user_idx").on(t.userId, t.createdAt),
    index("transactions_status_idx").on(t.status),
  ],
);

/** 网关异步事件（回调）幂等表：eventId = 网关事件唯一标识 */
export const gatewayEvents = mysqlTable(
  "gateway_events",
  {
    id: id(),
    gatewayCode: varchar("gateway_code", { length: 30 }).notNull(),
    eventId: varchar("event_id", { length: 128 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    payload: json("payload").$type<Json>(),
    status: mysqlEnum("status", ["received", "processed", "failed", "duplicate"]).notNull(),
    error: text("error"),
    receivedAt: datetime("received_at", { mode: "date" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    processedAt: datetime("processed_at", { mode: "date" }),
  },
  (t) => [uniqueIndex("gateway_events_uq").on(t.gatewayCode, t.eventId)],
);

/**
 * 余额双式账本：amount 为带符号变动（正入负出），balanceAfter 为变动后快照。
 * users.creditBalance 必须与最后一条流水 balanceAfter 一致（对账校验点）。
 */
export const creditLedger = mysqlTable(
  "credit_ledger",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: mysqlEnum("type", [
      "recharge",
      "payment",
      "refund",
      "adjustment",
      "upgrade_refund",
      "promo_bonus",
    ]).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    refType: varchar("ref_type", { length: 30 }),
    refId: bigint("ref_id", { mode: "number" }),
    remark: varchar("remark", { length: 255 }),
    adminId: bigint("admin_id", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [index("credit_ledger_user_idx").on(t.userId, t.createdAt)],
);

/** 退款单：原路退回，财务二次确认后提交网关 */
export const refunds = mysqlTable(
  "refunds",
  {
    id: id(),
    transactionId: bigint("transaction_id", { mode: "number" })
      .notNull()
      .references(() => transactions.id, { onDelete: "restrict" }),
    invoiceId: bigint("invoice_id", { mode: "number" }).references(() => invoices.id, {
      onDelete: "set null",
    }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: mysqlEnum("status", ["pending", "succeeded", "failed"]).notNull().default("pending"),
    reason: varchar("reason", { length: 255 }),
    gatewayRefundId: varchar("gateway_refund_id", { length: 64 }),
    adminId: bigint("admin_id", { mode: "number" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("refunds_invoice_idx").on(t.invoiceId)],
);
