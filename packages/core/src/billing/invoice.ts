/**
 * 账单（invoice）：编号生成、建单（含明细）、标记支付（幂等）、作废。
 * invoiceNo 规则：KVM-YYYYMM-XXXXXX（6 位大写字母数字随机，查重重试）。
 * total = subtotal - discount；balance_used 在余额支付时写入实扣金额。
 */
import { and, eq } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { schema } from "@qmkvm/db/client";
import type { Json } from "@qmkvm/db/schema";
import { appError } from "../errors.js";
import type { DbLike, Tx } from "../lifecycle/service-actions.js";
import { emitEvent, EVENT_NAMES } from "../events.js";

const { invoices, invoiceItems, auditLogs } = schema;

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceStatus = InvoiceRow["status"];
export type InvoiceType = InvoiceRow["type"];

const INVOICE_NO_PREFIX = "KVM";
const SUFFIX_LENGTH = 6;
const SUFFIX_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_INVOICE_NO_ATTEMPTS = 5;

/** 账单号格式化（纯函数）：KVM-YYYYMM-XXXXXX（按 UTC 年月） */
export function formatInvoiceNo(now: Date, suffix: string): string {
  if (!new RegExp(`^[${SUFFIX_CHARS}]{${SUFFIX_LENGTH}}$`).test(suffix)) {
    throw appError("VALIDATION_FAILED", `账单号后缀须为 ${SUFFIX_LENGTH} 位大写字母数字：${suffix}`);
  }
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return `${INVOICE_NO_PREFIX}-${year}${String(month).padStart(2, "0")}-${suffix}`;
}

function randomSuffix(): string {
  let out = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    out += SUFFIX_CHARS[randomInt(SUFFIX_CHARS.length)];
  }
  return out;
}

/** 生成不重复的账单号（随机 6 位大写字母数字，查重重试） */
export async function generateInvoiceNo(db: DbLike): Promise<string> {
  const now = new Date();
  for (let attempt = 0; attempt < MAX_INVOICE_NO_ATTEMPTS; attempt++) {
    const candidate = formatInvoiceNo(now, randomSuffix());
    const rows = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.invoiceNo, candidate))
      .limit(1);
    if (rows.length === 0) return candidate;
  }
  throw appError("INTERNAL", "生成账单号失败（多次撞号）");
}

export interface InvoiceItemInput {
  description: string;
  qty: number;
  unitPrice: number;
  meta?: Json;
}

export interface CreateInvoiceInput {
  userId: number;
  type: InvoiceType;
  orderId?: number;
  items: readonly InvoiceItemInput[];
  /** 折扣（分），封顶为 subtotal */
  discount?: number;
  dueAt?: Date;
}

/** 建账单（状态 unpaid）+ 明细；subtotal = Σ qty×unitPrice，total = subtotal - discount */
export async function createInvoiceWithItems(
  tx: Tx,
  input: CreateInvoiceInput,
): Promise<InvoiceRow> {
  const subtotal = input.items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
  const discount = Math.max(0, Math.min(Math.trunc(input.discount ?? 0), subtotal));
  const total = subtotal - discount;

  const invoiceNo = await generateInvoiceNo(tx);
  const inserted = await tx
    .insert(invoices)
    .values({
      userId: input.userId,
      invoiceNo,
      type: input.type,
      status: "unpaid",
      orderId: input.orderId ?? null,
      subtotal,
      discount,
      total,
      dueAt: input.dueAt ?? null,
    });
  const invoiceId = inserted[0].insertId;

  if (input.items.length > 0) {
    await tx.insert(invoiceItems).values(
      input.items.map((it) => ({
        invoiceId,
        description: it.description,
        qty: it.qty,
        unitPrice: it.unitPrice,
        amount: it.qty * it.unitPrice,
        meta: it.meta ?? null,
      })),
    );
  }

  const rows = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const invoice = rows[0];
  if (!invoice) {
    throw appError("INTERNAL", "账单创建失败");
  }
  return invoice;
}

export interface MarkPaidOptions {
  /** 网关支付时由 payments 管线写入 transactions，此处仅透传语义 */
  gatewayCode?: string;
  gatewayTxnId?: string;
  /** 余额实扣金额（余额支付 = total） */
  balanceUsed?: number;
  paymentIntentId?: number;
}

/**
 * 标记账单已支付（幂等）：已 paid 直接返回原记录；
 * 条件更新（WHERE status='unpaid'）防并发重复标记；状态流转成功后发射 invoice.paid 事件。
 */
export async function markInvoicePaid(
  tx: Tx,
  invoiceId: number,
  opts: MarkPaidOptions = {},
): Promise<InvoiceRow> {
  const rows = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const invoice = rows[0];
  if (!invoice) {
    throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  }
  if (invoice.status === "paid") {
    return invoice; // 幂等：已支付直接返回原记录
  }
  if (invoice.status !== "unpaid") {
    throw appError("BILL_INVOICE_STATUS_INVALID", `账单当前状态 ${invoice.status} 不允许标记支付`);
  }

  const paidAt = new Date();
  const res = await tx
    .update(invoices)
    .set({
      status: "paid",
      paidAt,
      balanceUsed: opts.balanceUsed ?? invoice.balanceUsed,
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "unpaid")));

  if (res[0].affectedRows === 0) {
    // 并发竞争：另一事务已标记。回读确认；非 paid 视为状态并发异常
    const again = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    const current = again[0];
    if (!current) {
      throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
    }
    if (current.status !== "paid") {
      throw appError("BILL_INVOICE_STATUS_INVALID", "账单状态并发变更，标记支付失败");
    }
    return current;
  }

  const paidRows = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const paid = paidRows[0];
  if (!paid) {
    throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  }

  await emitEvent(tx, EVENT_NAMES.invoicePaid, {
    userId: paid.userId,
    invoiceId: paid.id,
    invoiceNo: paid.invoiceNo,
    total: paid.total,
  });
  return paid;
}

/**
 * 作废账单（仅 unpaid 可作废）：条件更新防并发，写管理员审计日志。
 */
export async function voidInvoice(
  db: DbLike,
  invoiceId: number,
  adminId: number,
  reason: string,
): Promise<InvoiceRow> {
  const rows = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const invoice = rows[0];
  if (!invoice) {
    throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  }
  if (invoice.status !== "unpaid") {
    throw appError("BILL_INVOICE_STATUS_INVALID", "仅未支付账单可作废");
  }

  const res = await db
    .update(invoices)
    .set({ status: "void", voidReason: reason, voidedByAdminId: adminId })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "unpaid")));
  if (res[0].affectedRows === 0) {
    throw appError("BILL_INVOICE_STATUS_INVALID", "账单状态已变更，作废失败");
  }

  await db.insert(auditLogs).values({
    actorType: "admin",
    actorId: adminId,
    action: "invoice.void",
    targetType: "invoice",
    targetId: String(invoiceId),
    before: { status: invoice.status, total: invoice.total } as Json,
    after: { status: "void", reason } as Json,
  });

  const updatedRows = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const updated = updatedRows[0];
  if (!updated) {
    throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  }
  return updated;
}
