/**
 * 服务升级折算（P0 基础版）。
 *
 * 设计：纯计算（calculateProrata / previousCycleDate）与 IO 薄层（quoteUpgrade /
 * createUpgradeOrder）分离；IO 侧对并行实现的 billing/queue 模块采用动态导入，
 * 保证纯函数可被单元测试独立加载（SPEC「纯计算 + IO 薄层」要求）。
 *
 * 折算规则（金额均为整数分）：
 *   remainingDays   = max(0, next_due_date - today)          // 负数防御
 *   cycleTotalDays  = daysBetween(上期到期日, next_due_date)  // 用 addCycle 正向反推
 *   creditFromOld   = floor(renewalAmount × remainingDays / cycleTotalDays)
 *   payable         = max(0, newFirstAmount - creditFromOld)
 *   refund          = max(0, creditFromOld - newFirstAmount) // 差额退余额 upgrade_refund
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db/client";
import type { Json } from "@qmkvm/db/schema";
import { CYCLE_MONTHS, type BillingCycle } from "@qmkvm/contracts";
import { appError } from "../errors.js";
import {
  addCycle,
  addDays,
  daysBetween,
  formatDate,
  lastDayOfMonth,
  parseDate,
  todayStr,
} from "../date-utils.js";
import type { ServiceRow } from "../lifecycle/service-actions.js";

const { services, products, productPricing, orders, orderItems } = schema;

/** 周期中文标签（用户可见文案） */
const CYCLE_LABELS: Record<Exclude<BillingCycle, "onetime">, string> = {
  monthly: "月付",
  quarterly: "季付",
  semiannually: "半年付",
  annually: "年付",
  biennially: "两年付",
  triennially: "三年付",
};

export function cycleLabel(cycle: BillingCycle): string {
  return cycle === "onetime" ? "一次性" : CYCLE_LABELS[cycle];
}

/** —— 纯计算 —— */

/**
 * 上期到期日：寻找满足 addCycle(prev, cycle) === due 的最大 prev（用 addCycle 正向反推，
 * 兼容月末 clamp：due=2/28 时 prev=1/31 而非 1/28）。反向月份回退后找不到精确匹配时
 * （如 due=3/31 的月付），退化为简单回退日期，保证 cycleTotalDays 恒为正。
 */
export function previousCycleDate(due: string, cycle: BillingCycle): string {
  if (cycle === "onetime") return due;
  const months = CYCLE_MONTHS[cycle];
  const base = parseDate(due);
  const totalMonths = base.getUTCFullYear() * 12 + base.getUTCMonth() - months;
  const year = Math.floor(totalMonths / 12);
  const month0 = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(base.getUTCDate(), lastDayOfMonth(year, month0));
  let prev = formatDate(new Date(Date.UTC(year, month0, day)));
  // 向后微调：取满足条件的最大 prev（最多 31 步，防异常输入死循环）
  for (let i = 0; i < 31; i++) {
    const candidate = addDays(prev, 1);
    if (addCycle(candidate, cycle) === due) {
      prev = candidate;
    } else {
      break;
    }
  }
  return prev;
}

export interface ProrataInput {
  /** 当前周期续费金额（分） */
  renewalAmount: number;
  /** 当前计费周期 */
  cycle: BillingCycle;
  /** 当前到期日 "YYYY-MM-DD" */
  nextDueDate: string;
  /** 今日 "YYYY-MM-DD" */
  today: string;
  /** 目标商品同周期首价 + 开通费（分） */
  newFirstAmount: number;
}

export interface ProrataResult {
  remainingDays: number;
  cycleTotalDays: number;
  creditFromOld: number;
  newFirstAmount: number;
  payable: number;
  refund: number;
}

/** 升级折算纯函数（负数/除零防御；整数运算，floor 取整） */
export function calculateProrata(input: ProrataInput): ProrataResult {
  const { renewalAmount, cycle, nextDueDate, today, newFirstAmount } = input;
  const rawRemaining = cycle === "onetime" ? 0 : daysBetween(today, nextDueDate);
  const remainingDays = Math.max(0, rawRemaining);
  const periodStart = cycle === "onetime" ? nextDueDate : previousCycleDate(nextDueDate, cycle);
  const cycleTotalDays = Math.max(1, daysBetween(periodStart, nextDueDate));
  const creditFromOld =
    renewalAmount > 0 && remainingDays > 0
      ? Math.floor((renewalAmount * remainingDays) / cycleTotalDays)
      : 0;
  const payable = Math.max(0, newFirstAmount - creditFromOld);
  const refund = Math.max(0, creditFromOld - newFirstAmount);
  return { remainingDays, cycleTotalDays, creditFromOld, newFirstAmount, payable, refund };
}

/** —— IO 薄层 —— */

export interface UpgradeQuote {
  creditFromOld: number;
  newFirstAmount: number;
  payable: number;
  preview: {
    serviceName: string;
    targetProductId: number;
    targetProductName: string;
    cycle: BillingCycle;
    renewalAmount: number;
    remainingDays: number;
    cycleTotalDays: number;
    refund: number;
  };
}

/** 目标商品同周期价格行（含首价/续费价/开通费校验） */
async function loadTargetPricing(db: Db, targetProductId: number, cycle: BillingCycle) {
  const rows = await db
    .select()
    .from(productPricing)
    .where(
      and(eq(productPricing.productId, targetProductId), eq(productPricing.cycle, cycle)),
    )
    .limit(1);
  const pricing = rows[0];
  if (!pricing) {
    throw appError("CATALOG_NOT_FOUND", "目标商品缺少对应周期的价格");
  }
  return pricing;
}

/**
 * 升级报价：校验服务/目标商品可升级，按剩余天数折算旧服务抵扣。
 * newFirstAmount = 目标商品同周期 firstPrice + setupFee。
 */
export async function quoteUpgrade(
  db: Db,
  service: ServiceRow,
  targetProductId: number,
  now: Date,
): Promise<UpgradeQuote> {
  if (service.status !== "active") {
    throw appError("SVC_STATUS_INVALID", "仅生效中的服务可升级");
  }
  if (service.cycle === "onetime") {
    throw appError("SVC_STATUS_INVALID", "一次性服务不支持升级");
  }
  if (service.nextDueDate == null) {
    throw appError("SVC_STATUS_INVALID", "服务缺少到期日，无法折算");
  }
  if (targetProductId === service.productId) {
    throw appError("CONFLICT", "目标商品与当前商品相同");
  }

  const targetRows = await db.select().from(products).where(eq(products.id, targetProductId)).limit(1);
  const target = targetRows[0];
  if (!target) {
    throw appError("CATALOG_NOT_FOUND", "目标商品不存在");
  }
  if (target.status !== "active" || target.hidden) {
    throw appError("CATALOG_INACTIVE", "目标商品不可购买");
  }
  const currentRows = await db.select().from(products).where(eq(products.id, service.productId)).limit(1);
  const current = currentRows[0];
  if (current && !current.allowUpgrade) {
    throw appError("PERM_DENIED", "当前商品不支持升级");
  }

  const pricing = await loadTargetPricing(db, targetProductId, service.cycle);
  const newFirstAmount = pricing.firstPrice + pricing.setupFee;
  const result = calculateProrata({
    renewalAmount: service.renewalAmount,
    cycle: service.cycle,
    nextDueDate: service.nextDueDate,
    today: todayStr(now),
    newFirstAmount,
  });

  return {
    creditFromOld: result.creditFromOld,
    newFirstAmount,
    payable: result.payable,
    preview: {
      serviceName: service.name,
      targetProductId,
      targetProductName: target.name,
      cycle: service.cycle,
      renewalAmount: service.renewalAmount,
      remainingDays: result.remainingDays,
      cycleTotalDays: result.cycleTotalDays,
      refund: result.refund,
    },
  };
}

export interface UpgradeCheckoutResult {
  orderId: number;
  invoiceId: number;
  invoiceNo: string;
  total: number;
  balanceUsed: number;
  payable: number;
  /** payable=0 时已直接支付完成（差额退余额 upgrade_refund） */
  paid: boolean;
  payUrl: string | null;
}

/**
 * 创建升级单（order type=upgrade + invoice）。支付完成后的 change_package 任务
 * 由 order-service 的 markOrderPaid 统一创建，本函数只负责报价与建单。
 * 若 newFirstAmount < creditFromOld（payable=0），直接标记已付并触发
 * markOrderPaid，同时把差额 creditUser(type=upgrade_refund) 入账余额。
 */
export async function createUpgradeOrder(
  db: Db,
  user: { id: number },
  serviceId: number,
  targetProductId: number,
): Promise<UpgradeCheckoutResult> {
  const svcRows = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  const service = svcRows[0];
  if (!service || service.userId !== user.id) {
    throw appError("SVC_NOT_FOUND", "服务不存在");
  }

  const now = new Date();
  const quote = await quoteUpgrade(db, service, targetProductId, now);
  const targetRows = await db.select().from(products).where(eq(products.id, targetProductId)).limit(1);
  const target = targetRows[0];
  if (!target) {
    throw appError("CATALOG_NOT_FOUND", "目标商品不存在");
  }
  const pricing = await loadTargetPricing(db, targetProductId, service.cycle);

  const description = `服务「${service.name}」升级为 ${target.name}（${cycleLabel(service.cycle)}）`;
  const itemMeta: Json = {
    serviceId: service.id,
    cycle: service.cycle,
    targetProductId,
    creditFromOld: quote.creditFromOld,
    targetRenewalPrice: pricing.renewalPrice,
    targetSetupFee: pricing.setupFee,
  };

  return db.transaction(async (tx): Promise<UpgradeCheckoutResult> => {
    const { createInvoiceWithItems } = await import("../billing/invoice.js");

    const orderInserted = await tx
      .insert(orders)
      .values({
        userId: user.id,
        type: "upgrade",
        status: "pending",
        subtotal: quote.newFirstAmount,
        discount: quote.creditFromOld,
        total: quote.payable,
      });
    const orderId = orderInserted[0].insertId;

    // items 用中间变量传递，避免账单实现收紧签名时的多余属性检查
    const items = [{ description, qty: 1, unitPrice: quote.newFirstAmount, meta: itemMeta }];
    const invoice = await createInvoiceWithItems(tx, {
      userId: user.id,
      type: "upgrade",
      orderId,
      items,
      discount: quote.creditFromOld,
    });

    await tx.insert(orderItems).values({
      orderId,
      productId: targetProductId,
      serviceId: service.id,
      description,
      qty: 1,
      unitPrice: quote.newFirstAmount,
      amount: quote.newFirstAmount,
      meta: itemMeta,
    });

    let paid = false;
    if (quote.payable === 0) {
      const { markInvoicePaid } = await import("../billing/invoice.js");
      const { markOrderPaid } = await import("../billing/order-service.js");
      await markInvoicePaid(tx, invoice.id, {});
      await markOrderPaid(tx, orderId);
      paid = true;
      if (quote.preview.refund > 0) {
        const { creditUser } = await import("../billing/credit.js");
        await creditUser(tx, user.id, {
          type: "upgrade_refund",
          amount: quote.preview.refund,
          refType: "order",
          refId: orderId,
          remark: "服务升级折抵差额退回余额",
        });
      }
    }

    return {
      orderId,
      invoiceId: Number(invoice.id ?? 0),
      invoiceNo: String(invoice.invoiceNo ?? ""),
      total: Number(invoice.total ?? quote.payable),
      balanceUsed: 0,
      payable: quote.payable,
      paid,
      payUrl: null,
    };
  });
}
