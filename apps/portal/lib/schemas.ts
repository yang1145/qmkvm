import { z } from "zod";
import {
  configGroupDto,
  creditTypeEnum,
  invoiceDto,
  moneySchema,
  orderDto,
  paginated,
  productDto,
  productGroupDto,
  serviceDto,
  signedMoneySchema,
  ticketDto,
  ticketPriorityEnum,
  ticketStatusEnum,
  userProfileSchema,
} from "@pinhaoji/contracts";

/** —— contracts zod schema 推导出的领域类型（统一从这里取用） —— */
export type Product = z.infer<typeof productDto>;
export type ProductGroup = z.infer<typeof productGroupDto>;
export type ConfigGroup = z.infer<typeof configGroupDto>;
export type Invoice = z.infer<typeof invoiceDto>;
export type Order = z.infer<typeof orderDto>;
export type Service = z.infer<typeof serviceDto>;
export type Ticket = z.infer<typeof ticketDto>;
export type UserProfile = z.infer<typeof userProfileSchema>;

/**
 * 门户专用 DTO：SPEC §4 中存在、但 contracts 暂未定义的响应结构。
 * 后端就绪后如 contracts 补齐，应迁移过去；此处保持宽松以兼容联调期。
 */

/** GET /settings */
export const settingsSchema = z.object({
  siteName: z.string(),
  announcement: z.string().nullable(),
  paymentMethods: z.array(z.string()),
});
export type Settings = z.infer<typeof settingsSchema>;

/** 站内信（GET /notifications） */
export const notificationDtoSchema = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export const notificationListSchema = paginated(notificationDtoSchema);
export type NotificationItem = z.infer<typeof notificationDtoSchema>;

/** 余额流水（GET /credits → { balance, ledger }） */
export const creditLedgerDtoSchema = z.object({
  id: z.number(),
  type: creditTypeEnum,
  amount: signedMoneySchema,
  balanceAfter: moneySchema,
  refType: z.string().nullable().catch(null),
  refId: z.union([z.string(), z.number()]).nullable().catch(null),
  remark: z.string().nullable().catch(null),
  createdAt: z.string(),
});
export const creditOverviewSchema = z.object({
  balance: moneySchema,
  ledger: paginated(creditLedgerDtoSchema),
});
export type CreditLedgerItem = z.infer<typeof creditLedgerDtoSchema>;

/** POST /invoices/:id/pay → { paid, payUrl?, qrCode?, intentId? } */
export const payResultSchema = z.object({
  paid: z.boolean(),
  payUrl: z.string().nullable().catch(null),
  qrCode: z.string().nullable().catch(null),
  intentId: z.number().nullable().catch(null),
});
export type PayResult = z.infer<typeof payResultSchema>;

/** POST /services/:id/renew → { invoiceId, amount } */
export const renewResultSchema = z.object({
  invoiceId: z.number(),
  amount: moneySchema,
});

/** POST /credits/recharge → { payUrl?, intentId, invoiceId? } */
export const rechargeResultSchema = z.object({
  payUrl: z.string().nullable().catch(null),
  intentId: z.number().nullable().catch(null),
  invoiceId: z.number().optional().catch(undefined),
});

/** GET /departments */
export const departmentDtoSchema = z.object({
  id: z.number(),
  name: z.string(),
});

/** GET /account/sessions */
export const accountSessionDtoSchema = z.object({
  id: z.string(),
  ip: z.string().nullable().catch(null),
  ua: z.string().nullable().catch(null),
  lastSeenAt: z.string().nullable().catch(null),
  createdAt: z.string().catch(""),
  current: z.boolean().optional().catch(undefined),
});
export type AccountSession = z.infer<typeof accountSessionDtoSchema>;

/** GET /account/identity */
export const identitySchema = z.object({
  type: z.enum(["personal", "enterprise"]).nullable(),
  status: z.enum(["unverified", "pending", "verified", "rejected"]).catch("unverified"),
  realName: z.string().nullable().catch(null),
  idNumber: z.string().nullable().catch(null),
  companyName: z.string().nullable().catch(null),
  creditCode: z.string().nullable().catch(null),
  rejectReason: z.string().nullable().catch(null),
  updatedAt: z.string().nullable().catch(null),
});
export type Identity = z.infer<typeof identitySchema>;

/** GET /tickets/:id（含回复列表） */
export const ticketDetailSchema = z.object({
  id: z.number(),
  subject: z.string(),
  status: ticketStatusEnum,
  priority: ticketPriorityEnum,
  departmentId: z.number(),
  departmentName: z.string().nullable().catch(null),
  serviceId: z.number().nullable().catch(null),
  lastReplyAt: z.string().nullable().catch(null),
  lastReplyBy: z.enum(["customer", "staff"]).nullable().catch(null),
  createdAt: z.string(),
  replies: z
    .array(
      z.object({
        id: z.number(),
        authorType: z.enum(["customer", "staff", "system"]),
        authorName: z.string().catch(""),
        contentHtml: z.string(),
        internalNote: z.boolean().catch(false),
        createdAt: z.string(),
      }),
    )
    .catch([]),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;
