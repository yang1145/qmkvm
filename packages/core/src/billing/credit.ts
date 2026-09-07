/**
 * 余额（credit）：入账/出账（条件 UPDATE 防负余额）+ 带符号双式流水 + 余额支付账单 + 管理员调整。
 * users.creditBalance 只允许经本模块变更，且每笔变动写 creditLedger
 * （amount 带符号，balanceAfter 回读快照，与最后一条流水一致为对账校验点）。
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db/client";
import type { Json } from "@qmkvm/db/schema";
import { appError } from "../errors.js";
import type { DbLike, Tx } from "../lifecycle/service-actions.js";
import { markInvoicePaid, type InvoiceRow, type MarkPaidOptions } from "./invoice.js";

const { users, creditLedger, auditLogs, invoices } = schema;

export type CreditType = typeof creditLedger.$inferInsert.type;
export type CreditLedgerRow = typeof creditLedger.$inferSelect;

export interface CreditOpInput {
  type: CreditType;
  /** 正整数分 */
  amount: number;
  refType?: string;
  refId?: number;
  remark?: string;
  adminId?: number;
}

export interface CreditOpResult {
  balanceAfter: number;
}

function assertPositiveAmount(amount: number, op: "credit" | "debit"): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw appError("VALIDATION_FAILED", `余额${op === "credit" ? "入账" : "出账"}金额须为正整数分：${amount}`);
  }
}

/** 回读余额（用户不存在抛 NOT_FOUND） */
async function readBalance(db: DbLike, userId: number): Promise<number> {
  const rows = await db
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw appError("NOT_FOUND", `用户不存在（#${userId}）`);
  }
  return row.balance;
}

/** 余额入账：credit_balance += amount，随后写正向流水 */
export async function creditUser(
  tx: DbLike,
  userId: number,
  input: CreditOpInput,
): Promise<CreditOpResult> {
  assertPositiveAmount(input.amount, "credit");
  const res = await tx
    .update(users)
    .set({ creditBalance: sql`${users.creditBalance} + ${input.amount}` })
    .where(eq(users.id, userId));
  if (res[0].affectedRows === 0) {
    throw appError("NOT_FOUND", `用户不存在（#${userId}）`);
  }
  const balanceAfter = await readBalance(tx, userId);
  await tx.insert(creditLedger).values({
    userId,
    type: input.type,
    amount: input.amount,
    balanceAfter,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    remark: input.remark ?? null,
    adminId: input.adminId ?? null,
  });
  return { balanceAfter };
}

/**
 * 余额出账：条件 UPDATE（credit_balance >= amount）原子防负余额/防并发超扣；
 * affected=0 → 余额不足抛 BILL_INSUFFICIENT_BALANCE；随后写带符号（负数）流水。
 */
export async function debitUser(
  tx: DbLike,
  userId: number,
  input: CreditOpInput,
): Promise<CreditOpResult> {
  assertPositiveAmount(input.amount, "debit");
  const res = await tx
    .update(users)
    .set({ creditBalance: sql`${users.creditBalance} - ${input.amount}` })
    .where(and(eq(users.id, userId), gte(users.creditBalance, input.amount)));
  if (res[0].affectedRows === 0) {
    const balance = await readBalance(tx, userId); // 用户不存在时此处抛 NOT_FOUND
    throw appError("BILL_INSUFFICIENT_BALANCE", "余额不足", {
      balance,
      required: input.amount,
    });
  }
  const balanceAfter = await readBalance(tx, userId);
  await tx.insert(creditLedger).values({
    userId,
    type: input.type,
    amount: -input.amount,
    balanceAfter,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    remark: input.remark ?? null,
    adminId: input.adminId ?? null,
  });
  return { balanceAfter };
}

export interface PayWithBalanceResult {
  invoice: InvoiceRow;
  balanceAfter: number;
}

/**
 * 余额支付账单（事务内版本，供外层事务复用）：
 * 锁 invoice（FOR UPDATE）→ 已 paid 幂等返回 → debitUser(剩余应付) → markInvoicePaid(balanceUsed=total)。
 * 余额不足抛 BILL_INSUFFICIENT_BALANCE（外层事务整体回滚）。
 */
export async function payInvoiceWithBalanceTx(
  tx: Tx,
  userId: number,
  invoiceId: number,
): Promise<PayWithBalanceResult> {
  const rows = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1).for("update");
  const invoice = rows[0];
  if (!invoice || invoice.userId !== userId) {
    throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  }
  if (invoice.status === "paid") {
    // 幂等：已支付不再扣款，直接返回当前余额
    const balanceAfter = await readBalance(tx, userId);
    return { invoice, balanceAfter };
  }
  if (invoice.status !== "unpaid") {
    throw appError("BILL_INVOICE_STATUS_INVALID", `账单当前状态 ${invoice.status} 不允许支付`);
  }

  const remaining = Math.max(0, invoice.total - invoice.balanceUsed);
  let balanceAfter: number;
  if (remaining > 0) {
    const debited = await debitUser(tx, userId, {
      type: "payment",
      amount: remaining,
      refType: "invoice",
      refId: invoice.id,
      remark: `余额支付账单 ${invoice.invoiceNo}`,
    });
    balanceAfter = debited.balanceAfter;
  } else {
    balanceAfter = await readBalance(tx, userId);
  }

  const paid = await markInvoicePaid(tx, invoice.id, { balanceUsed: invoice.total } satisfies MarkPaidOptions);
  return { invoice: paid, balanceAfter };
}

/** 余额支付账单（自管事务入口） */
export async function payInvoiceWithBalance(
  db: Db,
  userId: number,
  invoiceId: number,
): Promise<PayWithBalanceResult> {
  return db.transaction((tx) => payInvoiceWithBalanceTx(tx, userId, invoiceId));
}

export interface AdjustCreditInput {
  userId: number;
  /** 带符号金额（分），正入负出，非零 */
  amount: number;
  remark: string;
}

/**
 * 管理员调整余额：审计 + creditUser/debitUser(type=adjustment)。
 */
export async function adjustCredit(
  db: Db,
  adminId: number,
  input: AdjustCreditInput,
): Promise<CreditOpResult> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw appError("VALIDATION_FAILED", "调整金额须为非零整数分");
  }
  return db.transaction(async (tx): Promise<CreditOpResult> => {
    const balanceBefore = await readBalance(tx, input.userId);
    const opInput: CreditOpInput = {
      type: "adjustment",
      amount: Math.abs(input.amount),
      remark: input.remark,
      adminId,
    };
    const result =
      input.amount > 0
        ? await creditUser(tx, input.userId, opInput)
        : await debitUser(tx, input.userId, opInput);

    await tx.insert(auditLogs).values({
      actorType: "admin",
      actorId: adminId,
      action: "credit.adjust",
      targetType: "user",
      targetId: String(input.userId),
      before: { creditBalance: balanceBefore } as Json,
      after: { creditBalance: result.balanceAfter, amount: input.amount, remark: input.remark } as Json,
    });
    return result;
  });
}
