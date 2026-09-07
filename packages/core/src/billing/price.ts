/**
 * 报价与选项校验：纯计算（validateAndPriceSelections / computeLineAmount / hasStock）
 * 与 DB 装配薄层（quoteProduct）分离，便于单测覆盖纯函数。
 *
 * 金额规则（全整数分）：
 *   unitFirst   = firstPrice   + Σ priceDelta（quantity 型按数量乘）
 *   unitRenewal = renewalPrice + Σ priceDelta（同上，priceDelta 为每周期加价）
 *   setupFee    = setupFee     + Σ setupDelta（一次性加价，不乘数量）
 *   amount      = unitFirst × qty + setupFee
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema } from "@qmkvm/db/client";
import type { Json } from "@qmkvm/db/schema";
import { billingCycleEnum, type BillingCycle } from "@qmkvm/contracts";
import { appError } from "../errors.js";
import type { DbLike } from "../lifecycle/service-actions.js";

const { products, productPricing, configGroups, configOptions } = schema;

export type ConfigGroupType = "select" | "radio" | "checkbox" | "quantity";

/** 配置组（结构与 db.configGroups 兼容，便于纯函数测试） */
export interface ConfigGroupLike {
  id: number;
  name: string;
  type: ConfigGroupType;
  required: boolean;
}

/** 配置选项（结构与 db.configOptions 兼容） */
export interface ConfigOptionLike {
  id: number;
  groupId: number;
  label: string;
  value: string;
  priceDelta: number;
  setupDelta: number;
}

/** 购物车选项选择（与 contracts cartOptionSelection 结构一致，core 不直接依赖 zod 类型） */
export interface OptionSelection {
  groupId: number;
  /** checkbox/quantity 用 optionIds；select/radio 用单个 */
  optionIds: number[];
  /** quantity 型数量（1..999） */
  quantity?: number;
}

export interface NormalizedSelection {
  groupId: number;
  groupName: string;
  type: ConfigGroupType;
  /** quantity 型的数量，其余恒为 1 */
  quantity: number;
  options: ConfigOptionLike[];
}

export interface SelectionPricing {
  cycle: BillingCycle;
  /** 加到单价（首购/续费同额）的增量合计，quantity 型已乘数量 */
  priceDeltaSum: number;
  /** 加到开通费的增量合计 */
  setupDeltaSum: number;
  optionsSummary: string[];
  /** 归一化后的选择（用于配置快照） */
  selections: NormalizedSelection[];
}

/** quantity 型与购买数量上限（与 contracts cartOptionSelection 一致） */
export const QUANTITY_MAX = 999;

function invalidSelection(message: string): never {
  throw appError("CATALOG_OPTIONS_INVALID", message);
}

/**
 * 选项校验与价格计算（纯函数，不依赖 db）：
 * - select/radio 单选（多选/零选报错）；checkbox 多选累加；quantity 按 quantity 乘 priceDelta；
 * - 选项必须属于对应商品组；required 组缺失/空选择抛 CATALOG_OPTIONS_INVALID；
 * - 未覆盖到的 selection 组视为非法（防止夹带）。
 */
export function validateAndPriceSelections(
  groups: readonly ConfigGroupLike[],
  options: readonly ConfigOptionLike[],
  cycle: BillingCycle,
  selections: readonly OptionSelection[],
): SelectionPricing {
  if (!(billingCycleEnum.options as readonly string[]).includes(cycle)) {
    throw appError("VALIDATION_FAILED", `非法计费周期：${String(cycle)}`);
  }

  const optionsByGroup = new Map<number, ConfigOptionLike[]>();
  for (const opt of options) {
    const list = optionsByGroup.get(opt.groupId);
    if (list) list.push(opt);
    else optionsByGroup.set(opt.groupId, [opt]);
  }

  const selectionByGroup = new Map<number, OptionSelection>();
  for (const sel of selections) {
    if (selectionByGroup.has(sel.groupId)) {
      invalidSelection(`配置项组重复选择（groupId=${sel.groupId}）`);
    }
    selectionByGroup.set(sel.groupId, sel);
  }

  let priceDeltaSum = 0;
  let setupDeltaSum = 0;
  const optionsSummary: string[] = [];
  const normalized: NormalizedSelection[] = [];

  for (const group of groups) {
    const sel = selectionByGroup.get(group.id);
    selectionByGroup.delete(group.id);

    if (!sel || sel.optionIds.length === 0) {
      if (group.required) invalidSelection(`缺少必选配置项：${group.name}`);
      continue;
    }

    const groupOptions = optionsByGroup.get(group.id) ?? [];
    const byId = new Map(groupOptions.map((o) => [o.id, o]));
    // 去重（保持选择顺序）并校验归属
    const picked: ConfigOptionLike[] = [];
    const seen = new Set<number>();
    for (const id of sel.optionIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const opt = byId.get(id);
      if (!opt) {
        invalidSelection(`配置选项不属于该商品（groupId=${group.id}, optionId=${id}）`);
      }
      picked.push(opt);
    }

    if ((group.type === "select" || group.type === "radio") && picked.length !== 1) {
      invalidSelection(`配置项「${group.name}」只能单选`);
    }

    let quantity = 1;
    if (group.type === "quantity") {
      if (picked.length !== 1) invalidSelection(`配置项「${group.name}」为数量型，只能选择一个选项`);
      quantity = sel.quantity ?? 1;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > QUANTITY_MAX) {
        invalidSelection(`配置项「${group.name}」数量须为 1-${QUANTITY_MAX} 的整数`);
      }
    }

    for (const opt of picked) {
      priceDeltaSum += opt.priceDelta * quantity;
      setupDeltaSum += opt.setupDelta;
    }

    const labels = picked.map((o) => o.label).join("、");
    optionsSummary.push(quantity > 1 ? `${group.name}：${labels} × ${quantity}` : `${group.name}：${labels}`);
    normalized.push({
      groupId: group.id,
      groupName: group.name,
      type: group.type,
      quantity,
      options: picked,
    });
  }

  if (selectionByGroup.size > 0) {
    invalidSelection("包含该商品未提供的配置项");
  }

  return { cycle, priceDeltaSum, setupDeltaSum, optionsSummary, selections: normalized };
}

/** 单行金额：unitFirst × qty + setupFee（非负防御） */
export function computeLineAmount(unitFirst: number, setupFee: number, qty: number): number {
  return Math.max(0, unitFirst * qty + setupFee);
}

/** 库存校验：stockTotal 为 null 表示不限量 */
export function hasStock(stockTotal: number | null, stockUsed: number, qty: number): boolean {
  if (stockTotal === null) return true;
  return stockUsed + qty <= stockTotal;
}

export interface QuoteProductInput {
  productId: number;
  cycle: BillingCycle;
  selections: readonly OptionSelection[];
  qty: number;
}

export interface ProductQuote {
  productId: number;
  groupId: number;
  productName: string;
  cycle: BillingCycle;
  qty: number;
  unitFirst: number;
  unitRenewal: number;
  setupFee: number;
  amount: number;
  optionsSummary: string[];
  /** 配置快照（写入 orderItem.meta.config，开通后落在 services.config） */
  config: Json;
  moduleCode: string;
  moduleConfig: Json | null;
  requiresIdentity: boolean;
}

/**
 * 商品报价（DB 装配薄层）：校验商品 active/库存/周期价格，
 * 装配配置组与选项后委托纯函数 validateAndPriceSelections 计价。
 */
export async function quoteProduct(db: DbLike, input: QuoteProductInput): Promise<ProductQuote> {
  const { productId, cycle } = input;
  const { qty } = input;
  if (!Number.isInteger(qty) || qty < 1 || qty > QUANTITY_MAX) {
    throw appError("VALIDATION_FAILED", `购买数量须为 1-${QUANTITY_MAX} 的整数`);
  }

  const productRows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  const product = productRows[0];
  if (!product) {
    throw appError("CATALOG_NOT_FOUND", "商品不存在");
  }
  if (product.status !== "active" || product.hidden) {
    throw appError("CATALOG_INACTIVE", "商品不可购买");
  }
  if (!hasStock(product.stockTotal, product.stockUsed, qty)) {
    throw appError("CATALOG_OUT_OF_STOCK", `商品「${product.name}」库存不足`);
  }

  const pricingRows = await db
    .select()
    .from(productPricing)
    .where(and(eq(productPricing.productId, productId), eq(productPricing.cycle, cycle)))
    .limit(1);
  const pricing = pricingRows[0];
  if (!pricing) {
    throw appError("CATALOG_NOT_FOUND", "该商品不支持所选计费周期");
  }

  const groupRows = await db
    .select()
    .from(configGroups)
    .where(eq(configGroups.productId, productId))
    .orderBy(asc(configGroups.sortOrder), asc(configGroups.id));
  const optionRows =
    groupRows.length > 0
      ? await db
          .select()
          .from(configOptions)
          .where(inArray(configOptions.groupId, groupRows.map((g) => g.id)))
          .orderBy(asc(configOptions.sortOrder), asc(configOptions.id))
      : [];

  const priced = validateAndPriceSelections(groupRows, optionRows, cycle, input.selections);

  const unitFirst = Math.max(0, pricing.firstPrice + priced.priceDeltaSum);
  const unitRenewal = Math.max(0, pricing.renewalPrice + priced.priceDeltaSum);
  const setupFee = Math.max(0, pricing.setupFee + priced.setupDeltaSum);
  const amount = computeLineAmount(unitFirst, setupFee, qty);

  return {
    productId,
    groupId: product.groupId,
    productName: product.name,
    cycle,
    qty,
    unitFirst,
    unitRenewal,
    setupFee,
    amount,
    optionsSummary: priced.optionsSummary,
    config: {
      cycle,
      options: priced.selections.map((s) => ({
        groupId: s.groupId,
        group: s.groupName,
        type: s.type,
        quantity: s.quantity,
        options: s.options.map((o) => ({ id: o.id, label: o.label, value: o.value })),
      })),
    },
    moduleCode: product.moduleCode,
    moduleConfig: product.moduleConfig,
    requiresIdentity: product.requiresIdentity,
  };
}
