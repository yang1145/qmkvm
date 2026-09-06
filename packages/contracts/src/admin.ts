import { z } from "zod";

/** 管理后台 DTO（admin 路由使用） */

export const adminLoginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(72),
});

export const adminDto = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string().nullable(),
  roleId: z.number().nullable(),
  status: z.enum(["active", "disabled"]),
  lastLoginAt: z.string().nullable(),
});

export const roleDto = z.object({
  id: z.number(),
  name: z.string(),
  permissions: z.array(z.string()),
  isSuper: z.boolean(),
});

export const adminCreateSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(72),
  name: z.string().max(100).optional(),
  roleId: z.number().int().positive(),
});

export const roleUpsertSchema = z.object({
  name: z.string().min(1).max(50),
  permissions: z.array(z.string()),
  isSuper: z.boolean().default(false),
});

/** 商品 upsert（含周期定价与选项整体提交） */
export const productUpsertSchema = z.object({
  groupId: z.number().int().positive(),
  name: z.string().min(1).max(150),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  tagline: z.string().max(255).nullable().optional(),
  descriptionHtml: z.string().max(50000).nullable().optional(),
  moduleCode: z.string().min(1).max(50).default("manual"),
  moduleConfig: z.record(z.string(), z.unknown()).optional(),
  stockTotal: z.number().int().min(0).nullable().optional(),
  hidden: z.boolean().default(false),
  requiresIdentity: z.boolean().default(false),
  allowUpgrade: z.boolean().default(true),
  allowDowngrade: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  status: z.enum(["active", "inactive"]).default("inactive"),
  pricing: z
    .array(
      z.object({
        cycle: z.enum([
          "onetime",
          "monthly",
          "quarterly",
          "semiannually",
          "annually",
          "biennially",
          "triennially",
        ]),
        firstPrice: z.number().int().min(0),
        renewalPrice: z.number().int().min(0),
        setupFee: z.number().int().min(0).default(0),
      }),
    )
    .min(1),
});

export const promoUpsertSchema = z.object({
  code: z.string().min(2).max(50).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(100),
  type: z.enum(["percent", "fixed"]),
  value: z.number().int().min(1),
  scope: z.enum(["all", "products", "groups"]).default("all"),
  scopeIds: z.array(z.number().int()).default([]),
  minAmount: z.number().int().min(0).default(0),
  maxUses: z.number().int().min(1).nullable().default(null),
  perUserLimit: z.number().int().min(1).default(1),
  newCustomerOnly: z.boolean().default(false),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
  active: z.boolean().default(true),
});

export const invoiceCreateSchema = z.object({
  userId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(255),
        qty: z.number().int().min(1).default(1),
        unitPrice: z.number().int().min(0),
      }),
    )
    .min(1),
  note: z.string().max(500).optional(),
});

export const creditAdjustSchema = z.object({
  userId: z.number().int().positive(),
  amount: z.number().int(), // 带符号，分为单位
  remark: z.string().min(1).max(255),
});

export const refundCreateSchema = z.object({
  transactionId: z.number().int().positive(),
  amount: z.number().int().min(1),
  reason: z.string().min(1).max(255),
});

export const serviceActionSchema = z.object({
  action: z.enum(["provision", "suspend", "unsuspend", "terminate", "sync"]),
  reason: z.string().max(255).optional(),
});

export const settingsUpsertSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export const dashboardDto = z.object({
  today: z.object({
    newUsers: z.number(),
    orders: z.number(),
    gmv: z.number(),
    paymentSuccessRate: z.number(),
  }),
  month: z.object({
    newUsers: z.number(),
    orders: z.number(),
    gmv: z.number(),
  }),
  pending: z.object({
    unpaidInvoices: z.number(),
    overdueServices: z.number(),
    openTickets: z.number(),
    provisionTasks: z.number(),
    deadTasks: z.number(),
  }),
});
