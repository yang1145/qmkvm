import { z } from "zod";

/** —— 共享枚举（与 DB schema 保持一致；contracts 不依赖 db，前端可安全引用）—— */

export const billingCycleEnum = z.enum([
  "onetime",
  "monthly",
  "quarterly",
  "semiannually",
  "annually",
  "biennially",
  "triennially",
]);
export type BillingCycle = z.infer<typeof billingCycleEnum>;

export const CYCLE_MONTHS: Record<Exclude<BillingCycle, "onetime">, number> = {
  monthly: 1,
  quarterly: 3,
  semiannually: 6,
  annually: 12,
  biennially: 24,
  triennially: 36,
};

export const orderStatusEnum = z.enum([
  "pending",
  "paid",
  "processing",
  "completed",
  "cancelled",
  "failed",
]);
export const orderTypeEnum = z.enum(["new", "renewal", "upgrade", "recharge", "manual"]);

export const invoiceStatusEnum = z.enum([
  "unpaid",
  "paid",
  "void",
  "refunded",
  "partially_refunded",
]);
export const invoiceTypeEnum = z.enum(["order", "renewal", "upgrade", "recharge", "manual"]);

export const serviceStatusEnum = z.enum([
  "pending",
  "active",
  "suspended_overdue",
  "suspended_manual",
  "terminated",
  "cancelled",
]);

export const provisionActionEnum = z.enum([
  "provision",
  "suspend",
  "unsuspend",
  "terminate",
  "change_package",
  "sync",
  "renew",
]);
export const provisionStatusEnum = z.enum([
  "queued",
  "processing",
  "succeeded",
  "failed",
  "dead",
  "skipped",
]);

export const ticketStatusEnum = z.enum([
  "open",
  "answered",
  "customer_reply",
  "in_progress",
  "resolved",
  "closed",
]);
export const ticketPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);

export const paymentGatewayEnum = z.enum(["alipay", "wechat", "balance", "mock"]);
export type PaymentGatewayCode = z.infer<typeof paymentGatewayEnum>;

export const creditTypeEnum = z.enum([
  "recharge",
  "payment",
  "refund",
  "adjustment",
  "upgrade_refund",
  "promo_bonus",
]);

/** —— 通用工具 Schema —— */

/** 金额：整数分，非负 */
export const moneySchema = z.number().int().min(0);
/** 带符号金额（账本流水） */
export const signedMoneySchema = z.number().int();

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
}

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

/** 统一错误响应体（见 PRD-billing 9.接口规范） */
export const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/** —— 站点品牌定制（settings key='site'，经 GET /api/v1/public/settings 分发）—— */

/** 品牌缺省值：portal（运行时）/ www（构建期）消费端统一回落用 */
export const DEFAULT_BRANDING = {
  siteName: "启明智联",
  siteNameEn: "QmKvm",
  logo: null,
  copyright: null,
  contactEmail: null,
  portalUrl: null,
  announcement: null,
} as const;

/** 品牌字段结构：null = 未定制，消费端用 DEFAULT_BRANDING 兜底 */
export const brandingSchema = z.object({
  siteName: z.string(),
  siteNameEn: z.string(),
  logo: z.string().nullable(),
  copyright: z.string().nullable(),
  contactEmail: z.string().nullable(),
  portalUrl: z.string().nullable(),
  announcement: z.string().nullable(),
});
export type Branding = z.infer<typeof brandingSchema>;

/** copyright 文本占位符替换：{year} → 当前年，{brand} → 站点名 */
export function renderCopyright(
  text: string | null | undefined,
  brand: string,
  year: number = new Date().getFullYear(),
): string {
  const fallback = `© ${year} ${brand}`;
  if (!text || !text.trim()) return fallback;
  return text.replaceAll("{year}", String(year)).replaceAll("{brand}", brand);
}
