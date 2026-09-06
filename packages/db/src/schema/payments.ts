import {
  bigint,
  datetime,
  index,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./users.js";
import { invoices } from "./billing.js";
import { createdAt, id, updatedAt } from "./_shared.js";

/**
 * 支付单：一次在线支付行为的独立凭证，与账单关联。
 * 余额支付不产生支付单（直接扣减并标记账单已付）。
 */
export const paymentIntents = mysqlTable(
  "payment_intents",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    invoiceId: bigint("invoice_id", { mode: "number" })
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    gatewayCode: varchar("gateway_code", { length: 30 }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: mysqlEnum("status", [
      "created",
      "paying",
      "success",
      "failed",
      "expired",
      "canceled",
    ])
      .notNull()
      .default("created"),
    gatewayPrepayId: varchar("gateway_prepay_id", { length: 128 }),
    payUrl: text("pay_url"),
    qrCode: text("qr_code"),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
    paidAt: datetime("paid_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payment_intents_invoice_idx").on(t.invoiceId, t.status),
    index("payment_intents_status_idx").on(t.status, t.expiresAt),
  ],
);
