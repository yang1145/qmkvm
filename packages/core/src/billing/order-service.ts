/**
 * 订单用例：购物车结算（createOrderFromCart）、取消（cancelOrder）、
 * 支付完成推进（markOrderPaid）、完成（completeOrder）。
 *
 * createOrderFromCart（单事务）：服务端重新报价（不信任前端金额）→ 条件 UPDATE 锁定库存 →
 * 优惠码校验与用量记录 → 建 order(pending) + orderItems + invoice(unpaid) →
 * useBalance 且余额足额时 payInvoiceWithBalance + markOrderPaid（P0 仅全额余额或全额在线，不做混合）。
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db/client";
import type { Json } from "@qmkvm/db/schema";
import { billingCycleEnum, type BillingCycle } from "@qmkvm/contracts";
import { appError } from "../errors.js";
import { cycleLabel } from "../upgrade/prorata.js";
import { emitEvent, EVENT_NAMES } from "../events.js";
import {
  createProvisionTask,
  createServiceFromOrderItem,
  type Tx,
} from "../lifecycle/service-actions.js";
import { applyRenewalPayment } from "../lifecycle/renewal.js";
import { quoteProduct, type OptionSelection, type ProductQuote } from "./price.js";
import {
  recordPromoUsage,
  userHasPaidOrder,
  validatePromo,
  type PromotionRow,
} from "./promo.js";
import { createInvoiceWithItems, type InvoiceItemInput } from "./invoice.js";
import { payInvoiceWithBalanceTx } from "./credit.js";

const { orders, orderItems, products, invoices, users, services } = schema;

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;

function asBillingCycle(value: unknown, fallback: BillingCycle): BillingCycle {
  return typeof value === "string" && (billingCycleEnum.options as readonly string[]).includes(value)
    ? (value as BillingCycle)
    : fallback;
}

// —— 结算 ——

export interface CheckoutCartItem {
  /** 购物车项标识（服务端购物车） */
  itemId: string;
  productId: number;
  cycle: BillingCycle;
  qty: number;
  options: readonly OptionSelection[];
}

export interface CheckoutInput {
  /**
   * 服务端购物车项（只取商品/周期/数量/选项重新计价，金额一律不信任前端）。
   * quote.promoCode 作为 promoCode 未显式传入时的回退。
   */
  quote: {
    items: readonly CheckoutCartItem[];
    promoCode?: string | null;
  };
  promoCode?: string | null;
  /** 是否优先余额支付（余额足额时全额抵扣；P0 不做混合支付） */
  useBalance?: boolean;
  note?: string;
}

/** 与 contracts checkoutResultSchema 形状一致 */
export interface CheckoutResult {
  orderId: number;
  invoiceId: number;
  invoiceNo: string;
  total: number;
  balanceUsed: number;
  payable: number;
  /** payable=0 时已直接支付完成 */
  paid: boolean;
  /** payable>0 时由 API 层创建支付单后填充，core 恒为 null */
  payUrl: string | null;
}

export async function createOrderFromCart(
  db: Db,
  user: { id: number },
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const items = input.quote.items;
  if (items.length === 0) {
    throw appError("VALIDATION_FAILED", "购物车为空");
  }
  const promoCode = (input.promoCode ?? input.quote.promoCode ?? "")?.trim() || null;
  const useBalance = input.useBalance ?? true;

  return db.transaction(async (tx): Promise<CheckoutResult> => {
    // 1) 服务端重新报价（不信任前端 quote）
    const quotes: ProductQuote[] = [];
    for (const item of items) {
      quotes.push(
        await quoteProduct(tx, {
          productId: item.productId,
          cycle: item.cycle,
          selections: item.options,
          qty: item.qty,
        }),
      );
    }
    const subtotal = quotes.reduce((sum, q) => sum + q.amount, 0);

    // 2) 锁定库存：条件 UPDATE（不限量或余量足够），affected=0 → 库存不足
    for (const q of quotes) {
      const res = await tx
        .update(products)
        .set({ stockUsed: sql`${products.stockUsed} + ${q.qty}` })
        .where(
          and(
            eq(products.id, q.productId),
            sql`(${products.stockTotal} IS NULL OR ${products.stockUsed} + ${q.qty} <= ${products.stockTotal})`,
          ),
        );
      if (res[0].affectedRows === 0) {
        throw appError("CATALOG_OUT_OF_STOCK", `商品「${q.productName}」库存不足`);
      }
    }

    // 3) 优惠码校验（单订单一张，优惠只作用 subtotal）
    let promo: PromotionRow | undefined;
    let discount = 0;
    if (promoCode) {
      const isFirstOrder = !(await userHasPaidOrder(tx, user.id));
      const productIds = [...new Set(quotes.map((q) => q.productId))];
      const groupIds = [...new Set(quotes.map((q) => q.groupId))];
      const result = await validatePromo(tx, promoCode, {
        userId: user.id,
        subtotal,
        productIds,
        groupIds,
        isFirstOrder,
      });
      promo = result.promo;
      discount = Math.min(result.discount, subtotal);
    }
    const total = subtotal - discount;

    // 4) 订单 + 订单项
    const orderInserted = await tx
      .insert(orders)
      .values({
        userId: user.id,
        type: "new",
        status: "pending",
        subtotal,
        discount,
        total,
        promoId: promo?.id ?? null,
        promoCode: promo?.code ?? null,
        note: input.note ?? null,
      });
    const orderId = orderInserted[0].insertId;

    const invoiceItemsInput: InvoiceItemInput[] = [];
    for (const q of quotes) {
      const description = `${q.productName} × ${q.qty}（${cycleLabel(q.cycle)}）`;
      const meta: Json = {
        cycle: q.cycle,
        qty: q.qty,
        setupFee: q.setupFee,
        firstAmount: q.unitFirst,
        renewalAmount: q.unitRenewal,
        optionsSummary: q.optionsSummary,
        config: q.config,
      };
      await tx.insert(orderItems).values({
        orderId,
        productId: q.productId,
        description,
        qty: q.qty,
        unitPrice: q.unitFirst,
        amount: q.amount,
        meta,
      });
      invoiceItemsInput.push({ description, qty: q.qty, unitPrice: q.unitFirst, meta });
    }

    // 5) 账单（unpaid）+ 优惠用量记录
    const invoice = await createInvoiceWithItems(tx, {
      userId: user.id,
      type: "order",
      orderId,
      items: invoiceItemsInput,
      discount: discount > 0 ? discount : undefined,
    });
    if (promo) {
      await recordPromoUsage(tx, {
        promotionId: promo.id,
        userId: user.id,
        orderId,
        discountAmount: discount,
      });
    }

    // 6) 余额支付（P0：全额余额或全额在线；payable=0 直接标记已付）
    let paid = false;
    let balanceUsed = 0;
    if (useBalance || total === 0) {
      const balanceRows = await tx
        .select({ balance: users.creditBalance })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      const balance = balanceRows[0]?.balance ?? 0;
      if (total === 0 || balance >= total) {
        await payInvoiceWithBalanceTx(tx, user.id, invoice.id);
        await markOrderPaid(tx, orderId);
        paid = true;
        balanceUsed = total;
      }
    }

    // 7) 账单创建通知（事件经队列投递）
    await emitEvent(tx, "invoice.created", {
      userId: user.id,
      orderId,
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      total,
    });

    return {
      orderId,
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      total,
      balanceUsed,
      payable: paid ? 0 : total,
      paid,
      payUrl: null,
    };
  });
}

// —— 取消 ——

/**
 * 取消订单（仅 pending）：条件更新防并发，释放库存（GREATEST 防负），
 * 并将关联未付账单作废（防止已取消订单仍可支付）。
 */
export async function cancelOrder(db: Db, userId: number, orderId: number): Promise<void> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  const order = rows[0];
  if (!order) {
    throw appError("ORDER_NOT_FOUND", "订单不存在");
  }
  if (order.status !== "pending") {
    throw appError("ORDER_STATUS_INVALID", `订单当前状态 ${order.status} 不可取消`);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    const res = await tx
      .update(orders)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(orders.id, orderId), eq(orders.status, "pending")));
    if (res[0].affectedRows === 0) {
      throw appError("ORDER_STATUS_INVALID", "订单状态已变更，取消失败");
    }

    const items = await tx
      .select({ productId: orderItems.productId, qty: orderItems.qty })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      if (item.productId == null) continue;
      await tx
        .update(products)
        .set({ stockUsed: sql`GREATEST(${products.stockUsed} - ${item.qty}, 0)` })
        .where(eq(products.id, item.productId));
    }

    await tx
      .update(invoices)
      .set({ status: "void", voidReason: "订单取消" })
      .where(and(eq(invoices.orderId, orderId), eq(invoices.status, "unpaid")));
  });
}

// —— 支付完成推进 ——

/**
 * 订单标记已支付（pending→paid，幂等），并按订单类型推进：
 * - new：每个 item 建 service(pending) + provision_task(provision)；
 * - renewal：item → applyRenewalPayment 推进到期日；
 * - upgrade：item → provision_task(change_package)（供应成功后由 runner 应用新配置）；
 * - recharge/manual：由支付/后台流程各自处理，此处不做。
 * 全程在调用方事务内执行。
 */
export async function markOrderPaid(tx: Tx, orderId: number): Promise<void> {
  const now = new Date();
  const res = await tx
    .update(orders)
    .set({ status: "paid", paidAt: now })
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending")));

  if (res[0].affectedRows === 0) {
    // 并发/重复推进：已处于 paid 及以后状态视为幂等成功，否则拒绝
    const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = rows[0];
    if (!order) {
      throw appError("ORDER_NOT_FOUND", "订单不存在");
    }
    if (order.status === "paid" || order.status === "processing" || order.status === "completed") {
      return;
    }
    throw appError("ORDER_STATUS_INVALID", `订单当前状态 ${order.status} 不允许标记支付`);
  }

  const orderRows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = orderRows[0];
  if (!order) {
    throw appError("ORDER_NOT_FOUND", "订单不存在");
  }

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  if (order.type === "new") {
    const productIds = [
      ...new Set(items.map((i) => i.productId).filter((id): id is number => id != null)),
    ];
    const productRows =
      productIds.length > 0
        ? await tx.select().from(products).where(inArray(products.id, productIds))
        : [];
    const productById = new Map(productRows.map((p) => [p.id, p]));

    for (const item of items) {
      if (item.productId == null) continue;
      const product = productById.get(item.productId);
      if (!product) continue;
      const service = await createServiceFromOrderItem(tx, { order, item, product });
      await createProvisionTask(tx, {
        serviceId: service.id,
        orderId,
        action: "provision",
      });
      await emitEvent(tx, EVENT_NAMES.serviceProvisionRequested, {
        userId: order.userId,
        orderId,
        serviceId: service.id,
        action: "provision",
      });
    }
  } else if (order.type === "renewal") {
    for (const item of items) {
      if (item.serviceId == null) continue;
      const svcRows = await tx.select().from(services).where(eq(services.id, item.serviceId)).limit(1);
      const service = svcRows[0];
      if (!service) {
        throw appError("SVC_NOT_FOUND", `服务不存在（#${item.serviceId}）`);
      }
      const meta = (item.meta ?? {}) as { cycle?: unknown };
      await applyRenewalPayment(tx, item.serviceId, asBillingCycle(meta.cycle, service.cycle));
    }
  } else if (order.type === "upgrade") {
    for (const item of items) {
      if (item.serviceId == null) continue;
      const meta = (item.meta ?? {}) as {
        targetProductId?: unknown;
        cycle?: unknown;
        targetRenewalPrice?: unknown;
        creditFromOld?: unknown;
      };
      const payload: Json = {
        targetProductId: typeof meta.targetProductId === "number" ? meta.targetProductId : item.productId,
        cycle: asBillingCycle(meta.cycle, "monthly"),
        targetRenewalPrice: typeof meta.targetRenewalPrice === "number" ? meta.targetRenewalPrice : null,
        creditFromOld: typeof meta.creditFromOld === "number" ? meta.creditFromOld : null,
      };
      await createProvisionTask(tx, {
        serviceId: item.serviceId,
        orderId,
        action: "change_package",
        payload,
      });
    }
  }

  await emitEvent(tx, EVENT_NAMES.orderPaid, {
    userId: order.userId,
    orderId: order.id,
    type: order.type,
    total: order.total,
  });
}

/**
 * 订单完成（paid→completed，幂等）：全部服务 active 后由 worker 调用。
 */
export async function completeOrder(tx: Tx, orderId: number): Promise<void> {
  const res = await tx
    .update(orders)
    .set({ status: "completed" })
    .where(and(eq(orders.id, orderId), eq(orders.status, "paid")));

  if (res[0].affectedRows === 0) {
    const rows = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
    const status = rows[0]?.status;
    if (status === "completed") return; // 幂等
    if (status === undefined) {
      throw appError("ORDER_NOT_FOUND", "订单不存在");
    }
    throw appError("ORDER_STATUS_INVALID", `订单当前状态 ${status} 不允许完成`);
  }
}
