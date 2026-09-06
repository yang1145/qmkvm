import {
  bigint,
  boolean,
  datetime,
  index,
  mysqlEnum,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./users.js";
import { invoices } from "./billing.js";
import { createdAt, id, updatedAt } from "./_shared.js";

/** 开票抬头（个人/企业） */
export const invoiceTitles = mysqlTable(
  "invoice_titles",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", ["personal", "enterprise"]).notNull(),
    /** 个人姓名或企业名称 */
    name: varchar("name", { length: 200 }).notNull(),
    /** 纳税人识别号（企业必填） */
    taxNo: varchar("tax_no", { length: 50 }),
    /** 接收邮箱 */
    email: varchar("email", { length: 255 }),
    // 专票补充信息
    bankName: varchar("bank_name", { length: 200 }),
    bankAccount: varchar("bank_account", { length: 64 }),
    companyAddress: varchar("company_address", { length: 300 }),
    companyPhone: varchar("company_phone", { length: 30 }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("invoice_titles_user_idx").on(t.userId)],
);

/** 开票申请：对已支付账单发起，后台审核→线下开票→回填发票号 */
export const fapiaoRequests = mysqlTable(
  "fapiao_requests",
  {
    id: id(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    titleId: bigint("title_id", { mode: "number" })
      .notNull()
      .references(() => invoiceTitles.id, { onDelete: "restrict" }),
    invoiceId: bigint("invoice_id", { mode: "number" })
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    /** 开票金额（分），默认取账单 total */
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** electronic=增值税电子普票 special=增值税专用发票 */
    type: mysqlEnum("type", ["electronic", "special"]).notNull().default("electronic"),
    status: mysqlEnum("status", ["pending", "approved", "issued", "rejected"])
      .notNull()
      .default("pending"),
    remark: varchar("remark", { length: 255 }),
    rejectReason: varchar("reject_reason", { length: 255 }),
    fapiaoNo: varchar("fapiao_no", { length: 50 }),
    fapiaoUrl: varchar("fapiao_url", { length: 500 }),
    approvedById: bigint("approved_by_id", { mode: "number" }),
    issuedAt: datetime("issued_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("fapiao_requests_user_idx").on(t.userId, t.status),
    index("fapiao_requests_status_idx").on(t.status, t.createdAt),
    index("fapiao_requests_invoice_idx").on(t.invoiceId),
  ],
);
