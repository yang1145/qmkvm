/**
 * 后台 RBAC 权限点。adminRoles.permissions 存此处的 key 数组；
 * isSuper 角色跳过检查。格式：域.动作。
 */
export const PERMISSIONS = {
  /** 客户 */
  "customers.read": "查看客户",
  "customers.manage": "客户管理与实名审核",
  "customers.credit": "余额调整（发起）",
  /** 订单与服务 */
  "orders.read": "查看订单",
  "orders.manage": "订单管理",
  "services.read": "查看服务",
  "services.manage": "服务操作（开通/暂停/恢复/终止）",
  "tasks.manage": "供应任务处理",
  /** 账务 */
  "invoices.read": "查看账单",
  "invoices.manage": "账单管理（手工开单/作废）",
  "transactions.read": "查看交易流水",
  "refunds.manage": "退款操作",
  /** 商品 */
  "products.read": "查看商品",
  "products.manage": "商品/选项/定价管理",
  "promotions.manage": "优惠码管理",
  /** 支持 */
  "tickets.read": "查看工单",
  "tickets.manage": "工单处理",
  "kb.manage": "知识库管理",
  /** 系统 */
  "settings.manage": "系统设置",
  "admins.manage": "管理员与角色管理",
  "audit.read": "审计日志查看",
  "templates.manage": "通知模板管理",
  "reports.read": "报表查看",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

/** 角色模板（种子数据用，可在后台继续细化） */
export const ROLE_TEMPLATES: Record<string, { name: string; isSuper?: boolean; permissions: PermissionKey[] }> = {
  super: { name: "超级管理员", isSuper: true, permissions: [] },
  finance: {
    name: "财务",
    permissions: [
      "customers.read",
      "orders.read",
      "invoices.read",
      "invoices.manage",
      "transactions.read",
      "refunds.manage",
      "reports.read",
    ],
  },
  support: {
    name: "客服",
    permissions: ["customers.read", "orders.read", "services.read", "tickets.read", "tickets.manage", "kb.manage"],
  },
  tech: {
    name: "技术运维",
    permissions: ["orders.read", "services.read", "services.manage", "tasks.manage", "products.read"],
  },
  readonly: {
    name: "只读审计",
    permissions: [
      "customers.read",
      "orders.read",
      "services.read",
      "invoices.read",
      "transactions.read",
      "products.read",
      "tickets.read",
      "audit.read",
      "reports.read",
    ],
  },
};
