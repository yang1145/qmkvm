import { z } from "zod";
import {
  billingCycleEnum,
  invoiceStatusEnum,
  invoiceTypeEnum,
  moneySchema,
  orderStatusEnum,
  orderTypeEnum,
  provisionActionEnum,
  provisionStatusEnum,
  serviceStatusEnum,
  ticketPriorityEnum,
  ticketStatusEnum,
} from "./common.js";

/** —— 商品目录 DTO —— */

export const productPricingDto = z.object({
  cycle: billingCycleEnum,
  firstPrice: moneySchema,
  renewalPrice: moneySchema,
  setupFee: moneySchema,
});

export const configOptionDto = z.object({
  id: z.number(),
  label: z.string(),
  value: z.string(),
  priceDelta: moneySchema,
  setupDelta: moneySchema,
  isDefault: z.boolean(),
});

export const configGroupDto = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(["select", "radio", "checkbox", "quantity"]),
  required: z.boolean(),
  options: z.array(configOptionDto),
});

export const productDto = z.object({
  id: z.number(),
  groupId: z.number(),
  name: z.string(),
  slug: z.string(),
  tagline: z.string().nullable(),
  moduleCode: z.string(),
  stockTotal: z.number().nullable(),
  stockUsed: z.number(),
  inStock: z.boolean(),
  pricing: z.array(productPricingDto),
  configGroups: z.array(configGroupDto),
});

export const productGroupDto = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  products: z.array(productDto),
});

/** —— 购物车 / 结算 DTO —— */

export const cartOptionSelection = z.object({
  groupId: z.number(),
  /** checkbox/quantity 用 optionIds；select/radio 用单个 */
  optionIds: z.array(z.number().int().positive()).default([]),
  /** quantity 型数量（1..999） */
  quantity: z.number().int().min(1).max(999).optional(),
});

export const addToCartSchema = z.object({
  productId: z.number().int().positive(),
  cycle: billingCycleEnum,
  options: z.array(cartOptionSelection).default([]),
  qty: z.number().int().min(1).max(10).default(1),
});

export const updateCartItemSchema = z.object({
  itemId: z.string().min(1).max(64),
  cycle: billingCycleEnum.optional(),
  options: z.array(cartOptionSelection).optional(),
  qty: z.number().int().min(1).max(10).optional(),
});

/** 服务端实时报价（不信任前端价格） */
export const cartQuoteSchema = z.object({
  subtotal: moneySchema,
  discount: moneySchema,
  total: moneySchema,
  currency: z.string().length(3),
  promoCode: z.string().nullable(),
  promoError: z.string().nullable(),
  items: z.array(
    z.object({
      itemId: z.string(),
      productId: z.number(),
      productName: z.string(),
      cycle: billingCycleEnum,
      qty: z.number(),
      unitFirst: moneySchema,
      unitRenewal: moneySchema,
      setupFee: moneySchema,
      amount: moneySchema,
      optionsSummary: z.array(z.string()),
    }),
  ),
  /** 余额可用额与建议抵扣 */
  balanceAvailable: moneySchema,
  balanceSuggested: moneySchema,
});

export const checkoutSchema = z.object({
  promoCode: z.string().max(50).optional(),
  useBalance: z.boolean().default(true),
  note: z.string().max(500).optional(),
});

export const checkoutResultSchema = z.object({
  orderId: z.number(),
  invoiceId: z.number(),
  invoiceNo: z.string(),
  total: moneySchema,
  balanceUsed: moneySchema,
  payable: moneySchema,
  /** payable=0 时已直接支付完成 */
  paid: z.boolean(),
  /** payable>0 时返回可选支付方式与默认收银台跳转 */
  payUrl: z.string().nullable(),
});

/** —— 订单 / 账单 DTO —— */

export const orderDto = z.object({
  id: z.number(),
  type: orderTypeEnum,
  status: orderStatusEnum,
  subtotal: moneySchema,
  discount: moneySchema,
  total: moneySchema,
  balanceUsed: moneySchema,
  promoCode: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(
    z.object({
      id: z.number(),
      description: z.string(),
      qty: z.number(),
      amount: moneySchema,
      serviceId: z.number().nullable(),
    }),
  ),
});

export const invoiceDto = z.object({
  id: z.number(),
  invoiceNo: z.string(),
  type: invoiceTypeEnum,
  status: invoiceStatusEnum,
  subtotal: moneySchema,
  discount: moneySchema,
  total: moneySchema,
  balanceUsed: moneySchema,
  dueAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  orderId: z.number().nullable(),
  items: z.array(
    z.object({
      id: z.number(),
      description: z.string(),
      qty: z.number(),
      unitPrice: moneySchema,
      amount: moneySchema,
    }),
  ),
});

/** —— 服务 DTO —— */

export const serviceDto = z.object({
  id: z.number(),
  name: z.string(),
  productId: z.number(),
  productName: z.string(),
  status: serviceStatusEnum,
  cycle: billingCycleEnum,
  renewalAmount: moneySchema,
  nextDueDate: z.string().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  deliverInfo: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

/** 续费报价 */
export const renewQuoteSchema = z.object({
  serviceId: z.number(),
  cycle: billingCycleEnum,
  amount: moneySchema,
  nextDueDateAfter: z.string(),
});

export const upgradeQuoteSchema = z.object({
  serviceId: z.number(),
  targetProductId: z.number(),
  /** 按天折算的剩余价值抵扣 */
  creditFromOld: moneySchema,
  newFirstAmount: moneySchema,
  payable: moneySchema,
  preview: z.array(z.object({ label: z.string(), from: z.string(), to: z.string() })),
});

/** —— 工单 DTO —— */

export const ticketCreateSchema = z.object({
  departmentId: z.number().int().positive(),
  serviceId: z.number().int().positive().optional(),
  subject: z.string().min(1).max(200),
  priority: ticketPriorityEnum.default("medium"),
  contentHtml: z.string().min(1).max(20000),
});

export const ticketReplySchema = z.object({
  contentHtml: z.string().min(1).max(20000),
});

export const ticketDto = z.object({
  id: z.number(),
  subject: z.string(),
  status: ticketStatusEnum,
  priority: ticketPriorityEnum,
  departmentId: z.number(),
  departmentName: z.string().nullable(),
  serviceId: z.number().nullable(),
  lastReplyAt: z.string().nullable(),
  lastReplyBy: z.enum(["customer", "staff"]).nullable(),
  createdAt: z.string(),
});

export const ticketReplyDto = z.object({
  id: z.number(),
  authorType: z.enum(["customer", "staff", "system"]),
  authorName: z.string(),
  contentHtml: z.string(),
  internalNote: z.boolean(),
  createdAt: z.string(),
});

/** —— 发票（抬头 / 开票申请） DTO —— */

export const fapiaoTypeEnum = z.enum(["electronic", "special"]);
export const fapiaoStatusEnum = z.enum(["pending", "approved", "issued", "rejected"]);
export type FapiaoType = z.infer<typeof fapiaoTypeEnum>;
export type FapiaoStatus = z.infer<typeof fapiaoStatusEnum>;

/** 抬头视图（taxNo 脱敏：中间打码） */
export const fapiaoTitleDto = z.object({
  id: z.number(),
  type: z.enum(["personal", "enterprise"]),
  name: z.string(),
  taxNo: z.string().nullable(),
  email: z.string().nullable(),
  bankName: z.string().nullable(),
  bankAccount: z.string().nullable(),
  companyAddress: z.string().nullable(),
  companyPhone: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: z.string(),
});

export const fapiaoTitleCreateSchema = z.object({
  type: z.enum(["personal", "enterprise"]),
  /** 个人姓名或企业名称 */
  name: z.string().min(1).max(200),
  /** 纳税人识别号（enterprise 必填） */
  taxNo: z.string().max(50).optional(),
  email: z.email().max(255).optional(),
  // 专票补充信息（可选）
  bankName: z.string().max(200).optional(),
  bankAccount: z.string().max(64).optional(),
  companyAddress: z.string().max(300).optional(),
  companyPhone: z.string().max(30).optional(),
  isDefault: z.boolean().optional().default(false),
});

/** 抬头更新：字段均可选；taxNo 传脱敏值视为未修改 */
export const fapiaoTitleUpdateSchema = fapiaoTitleCreateSchema.partial();

export const fapiaoTitleListDto = z.object({
  items: z.array(fapiaoTitleDto),
});

export const fapiaoRequestCreateSchema = z.object({
  invoiceId: z.number().int().positive(),
  titleId: z.number().int().positive(),
  type: fapiaoTypeEnum,
  remark: z.string().max(255).optional(),
});

/** 开票申请视图（含抬头快照与账单号） */
export const fapiaoRequestDto = z.object({
  id: z.number(),
  userId: z.number().optional(),
  invoiceId: z.number(),
  invoiceNo: z.string().nullable(),
  titleId: z.number(),
  title: z
    .object({
      type: z.enum(["personal", "enterprise"]),
      name: z.string(),
      taxNo: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
  amount: z.number(),
  type: fapiaoTypeEnum,
  status: fapiaoStatusEnum,
  remark: z.string().nullable(),
  rejectReason: z.string().nullable(),
  fapiaoNo: z.string().nullable(),
  fapiaoUrl: z.string().nullable(),
  issuedAt: z.string().nullable(),
  createdAt: z.string(),
});

/** —— 供应任务 DTO（后台） —— */

export const provisionTaskDto = z.object({
  id: z.number(),
  serviceId: z.number(),
  action: provisionActionEnum,
  status: provisionStatusEnum,
  attempts: z.number(),
  maxAttempts: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  executedAt: z.string().nullable(),
});
