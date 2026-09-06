/**
 * 优惠码：规则校验（纯函数 checkPromoRules）+ DB 装配（validatePromo）+ 用量记录。
 *
 * 规则（SPEC）：
 * - percent（value=1..100）/ fixed（value=分，不超过 subtotal）；
 * - scope：all / products / groups（scopeIds 任一命中即适用）；
 * - minAmount：subtotal 达标（含等于）；
 * - maxUses：按 promotionUsages 全量计数；perUserLimit：按 (促销, 用户) 计数；
 * - newCustomerOnly：用户无 paid 及以后状态（paid/processing/completed）的订单；
 * - startsAt/endsAt 时间窗；active；单订单仅一张（promotion_usages (promotionId, orderId) 唯一键兜底）；
 * - percent value>100 拒绝（PROMO_INVALID）。
 * 优惠只作用于 subtotal，单订单一张、不叠加。
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@pinhaoji/db/client";
import { appError } from "../errors.js";
import { applyPercent } from "../money.js";
import type { DbLike } from "../lifecycle/service-actions.js";

const { promotions, promotionUsages, orders } = schema;

export type PromotionRow = typeof promotions.$inferSelect;

/** 优惠码规则字段（PromotionRow 的结构子集，便于纯函数测试） */
export interface PromoLike {
  id: number;
  code: string;
  name: string;
  type: "percent" | "fixed";
  value: number;
  scope: "all" | "products" | "groups";
  scopeIds: number[] | null;
  minAmount: number;
  maxUses: number | null;
  perUserLimit: number;
  newCustomerOnly: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
}

export interface PromoRuleContext {
  subtotal: number;
  productIds: readonly number[];
  groupIds: readonly number[];
  now: Date;
  /** 该优惠码累计使用次数 */
  totalUses: number;
  /** 该用户对该优惠码累计使用次数 */
  userUses: number;
  /** 是否首单（无 paid 及以后状态的订单） */
  isFirstOrder: boolean;
}

/**
 * 折扣计算（纯函数）：percent 用整数运算四舍五入到分；
 * fixed 面额超过 subtotal 时封顶为 subtotal（优惠不产生负数/倒贴）。
 */
export function computePromoDiscount(
  promo: Pick<PromoLike, "type" | "value">,
  subtotal: number,
): number {
  if (promo.type === "percent") {
    if (!Number.isInteger(promo.value) || promo.value < 1 || promo.value > 100) {
      throw appError("PROMO_INVALID", "百分比优惠码折扣率须为 1-100 的整数");
    }
    return Math.min(subtotal, applyPercent(subtotal, promo.value));
  }
  if (!Number.isInteger(promo.value) || promo.value <= 0) {
    throw appError("PROMO_INVALID", "固定金额优惠码面额非法");
  }
  return Math.min(promo.value, subtotal);
}

/**
 * 优惠规则校验（纯函数，DB 计数由调用方装配传入）。
 * 校验通过返回折扣金额；失败抛对应 PROMO_* 错误。
 */
export function checkPromoRules(promo: PromoLike, ctx: PromoRuleContext): number {
  if (!promo.active) {
    throw appError("PROMO_INVALID", "优惠码无效");
  }
  if (promo.startsAt && ctx.now < promo.startsAt) {
    throw appError("PROMO_EXPIRED", "优惠码尚未到生效时间");
  }
  if (promo.endsAt && ctx.now > promo.endsAt) {
    throw appError("PROMO_EXPIRED", "优惠码已过期");
  }

  if (promo.scope === "products") {
    const ids = promo.scopeIds ?? [];
    if (!ctx.productIds.some((id) => ids.includes(id))) {
      throw appError("PROMO_NOT_APPLICABLE", "优惠码不适用于所选商品");
    }
  } else if (promo.scope === "groups") {
    const ids = promo.scopeIds ?? [];
    if (!ctx.groupIds.some((id) => ids.includes(id))) {
      throw appError("PROMO_NOT_APPLICABLE", "优惠码不适用于所选商品分组");
    }
  }

  if (ctx.subtotal < promo.minAmount) {
    throw appError("PROMO_NOT_APPLICABLE", "订单金额未达到优惠码使用门槛");
  }
  if (promo.newCustomerOnly && !ctx.isFirstOrder) {
    throw appError("PROMO_NOT_APPLICABLE", "该优惠码仅限新客户使用");
  }
  if (promo.maxUses !== null && ctx.totalUses >= promo.maxUses) {
    throw appError("PROMO_LIMIT_REACHED", "优惠码可用次数已用完");
  }
  if (ctx.userUses >= promo.perUserLimit) {
    throw appError("PROMO_LIMIT_REACHED", "您已达到该优惠码的使用次数上限");
  }

  return computePromoDiscount(promo, ctx.subtotal);
}

export interface ValidatePromoInput {
  userId: number;
  subtotal: number;
  productIds: readonly number[];
  groupIds: readonly number[];
  isFirstOrder: boolean;
}

/**
 * 校验优惠码并计算折扣（失败抛 PROMO_*）。
 * newCustomerOnly 时在 DB 内复核「无 paid 及以后状态的订单」，调用方的
 * isFirstOrder 标记仅作快速短路。
 */
export async function validatePromo(
  db: DbLike,
  code: string,
  input: ValidatePromoInput,
): Promise<{ promo: PromotionRow; discount: number }> {
  const rows = await db.select().from(promotions).where(eq(promotions.code, code)).limit(1);
  const promo = rows[0];
  if (!promo) {
    throw appError("PROMO_INVALID", "优惠码不存在");
  }

  let isFirstOrder = input.isFirstOrder;
  if (promo.newCustomerOnly) {
    const hasPaid = await userHasPaidOrder(db, input.userId);
    isFirstOrder = isFirstOrder && !hasPaid;
  }

  const totalRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(promotionUsages)
    .where(eq(promotionUsages.promotionId, promo.id));
  const totalUses = Number(totalRows[0]?.count ?? 0);

  const userRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(promotionUsages)
    .where(
      and(eq(promotionUsages.promotionId, promo.id), eq(promotionUsages.userId, input.userId)),
    );
  const userUses = Number(userRows[0]?.count ?? 0);

  const discount = checkPromoRules(promo, {
    subtotal: input.subtotal,
    productIds: input.productIds,
    groupIds: input.groupIds,
    now: new Date(),
    totalUses,
    userUses,
    isFirstOrder,
  });

  return { promo, discount };
}

/** 用户是否已有 paid 及以后状态（paid/processing/completed）的订单 */
export async function userHasPaidOrder(db: DbLike, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.userId, userId), inArray(orders.status, ["paid", "processing", "completed"])))
    .limit(1);
  return rows.length > 0;
}

export interface PromoUsageInput {
  promotionId: number;
  userId: number;
  orderId: number;
  discountAmount: number;
}

/** 记录优惠码使用（(promotionId, orderId) 唯一键兜底防重复） */
export async function recordPromoUsage(tx: DbLike, input: PromoUsageInput): Promise<void> {
  await tx.insert(promotionUsages).values({
    promotionId: input.promotionId,
    userId: input.userId,
    orderId: input.orderId,
    discountAmount: input.discountAmount,
  });
}
