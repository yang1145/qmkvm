/**
 * 启明智联业务管理系统 API 类型定义
 *
 * TODO: 类型来源于 packages/contracts（@qmkvm/contracts）。
 * 因 contracts 以 TS 源码形式导出（exports 指向 src/*.ts），umi 构建链
 * 默认不编译 node_modules 内 TS 源码，为避免构建问题此处复制所需类型，
 * 字段与 contracts 保持一致，后续可切换为直接 import。
 */
import type {
  BillingCycle,
  InvoiceStatus,
  OrderStatus,
  ProvisionAction,
  ProvisionStatus,
  ServiceStatus,
  TicketPriority,
  TicketStatus,
} from './enums';

// ============ 通用 ============

/** 分页请求参数 */
export type PageQuery = {
  page?: number;
  pageSize?: number;
};

/** 统一分页响应 */
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** 统一错误响应体 */
export type ErrorResponse = {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
};

// ============ 认证 ============

export type AdminInfo = {
  id: number;
  username: string;
  name: string | null;
  roleId: number | null;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
};

/** GET /auth/me 响应 */
export type AdminMe = {
  admin: AdminInfo;
  permissions: string[];
  isSuper: boolean;
};

export type LoginParams = {
  username: string;
  password: string;
};

// ============ 仪表盘 ============

export type DashboardDto = {
  today: { newUsers: number; orders: number; gmv: number; paymentSuccessRate: number };
  month: { newUsers: number; orders: number; gmv: number };
  pending: {
    unpaidInvoices: number;
    overdueServices: number;
    openTickets: number;
    provisionTasks: number;
    deadTasks: number;
  };
};

// ============ 客户 ============

/** 客户列表项（脱敏） */
export type CustomerListItem = {
  id: number;
  phone: string | null;
  email: string | null;
  name: string | null;
  creditBalance: number;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
};

/** GET /customers/:id 响应（含关联汇总） */
export type CustomerDetail = CustomerListItem & {
  services: ServiceListItem[];
  orders: OrderListItem[];
  invoices: InvoiceListItem[];
  ledger: CreditLedgerItem[];
};

// ============ 订单 ============

export type OrderItem = {
  id: number;
  description: string;
  qty: number;
  amount: number;
  serviceId: number | null;
};

export type OrderListItem = {
  id: number;
  /** 客户标识（列表展示用） */
  userId: number;
  userName?: string | null;
  type: 'new' | 'renewal' | 'upgrade' | 'recharge' | 'manual';
  status: OrderStatus;
  subtotal: number;
  discount: number;
  total: number;
  balanceUsed: number;
  promoCode: string | null;
  paidAt: string | null;
  createdAt: string;
  items: OrderItem[];
};

// ============ 账单 ============

export type InvoiceItem = {
  id: number;
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type InvoiceListItem = {
  id: number;
  userId?: number;
  userName?: string | null;
  invoiceNo: string;
  type: 'order' | 'renewal' | 'upgrade' | 'recharge' | 'manual';
  status: InvoiceStatus;
  subtotal: number;
  discount: number;
  total: number;
  balanceUsed: number;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  orderId: number | null;
  items: InvoiceItem[];
};

// ============ 服务 ============

export type ServiceListItem = {
  id: number;
  userId?: number;
  userName?: string | null;
  name: string;
  productId: number;
  productName: string;
  status: ServiceStatus;
  cycle: BillingCycle;
  renewalAmount: number;
  nextDueDate: string | null;
  config: Record<string, unknown> | null;
  deliverInfo: Record<string, unknown> | null;
  createdAt: string;
};

// ============ 供应任务 ============

export type ProvisionTaskItem = {
  id: number;
  serviceId: number;
  action: ProvisionAction;
  status: ProvisionStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  executedAt: string | null;
};

// ============ 余额流水 / 交易 / 退款 ============

export type CreditLedgerItem = {
  id: number;
  userId?: number;
  type: 'recharge' | 'payment' | 'refund' | 'adjustment' | 'upgrade_refund' | 'promo_bonus';
  amount: number;
  balanceAfter: number;
  refType: string | null;
  refId: number | null;
  remark: string | null;
  adminId: number | null;
  createdAt: string;
};

export type TransactionItem = {
  id: number;
  userId?: number;
  invoiceId: number | null;
  gatewayCode: string;
  gatewayTxnId: string;
  type: 'payment' | 'refund';
  amount: number;
  fee: number;
  currency: string;
  status: 'pending' | 'success' | 'failed' | 'refunded';
  createdAt: string;
};

export type RefundItem = {
  id: number;
  transactionId: number;
  invoiceId: number | null;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed';
  reason: string | null;
  gatewayRefundId: string | null;
  adminId: number | null;
  createdAt: string;
};

// ============ 商品 ============

export type ProductPricing = {
  cycle: BillingCycle;
  firstPrice: number;
  renewalPrice: number;
  setupFee: number;
};

export type ConfigOption = {
  id: number;
  label: string;
  value: string;
  priceDelta: number;
  setupDelta: number;
  isDefault: boolean;
};

export type ConfigGroup = {
  id: number;
  name: string;
  type: 'select' | 'radio' | 'checkbox' | 'quantity';
  required: boolean;
  options: ConfigOption[];
};

export type ProductListItem = {
  id: number;
  groupId: number;
  groupName?: string | null;
  name: string;
  slug: string;
  tagline: string | null;
  moduleCode: string;
  /** 供应模块配置 JSON（商品详情返回，连接测试用） */
  moduleConfig?: Record<string, unknown> | null;
  descriptionHtml?: string | null;
  /** 购买需实名 */
  requiresIdentity?: boolean;
  /** 允许升级 */
  allowUpgrade?: boolean;
  /** 允许降级 */
  allowDowngrade?: boolean;
  stockTotal: number | null;
  stockUsed: number;
  inStock: boolean;
  status: 'active' | 'inactive';
  hidden: boolean;
  sortOrder: number;
  pricing: ProductPricing[];
  configGroups: ConfigGroup[];
};

export type ProductGroupItem = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  products: ProductListItem[];
};

// ============ 供应模块 ============

/** GET /provision-modules 列表项 */
export type ProvisionModuleItem = {
  code: string;
  name: string;
  description: string | null;
  actions: string[];
  /** 使用该模块的商品数（含下架） */
  productCount: number;
};

/** GET /provision-modules/:code/products 分页项 */
export type ProvisionModuleProductItem = {
  id: number;
  name: string;
  slug: string;
  status: 'active' | 'inactive';
  /** moduleConfig 摘要（baseUrl / 顶层键，不含敏感值） */
  moduleConfigSummary: string | null;
};

/** GET /provision-modules/:code/failures 列表项 */
export type ProvisionModuleFailureItem = {
  taskId: number;
  serviceName: string;
  action: ProvisionAction;
  status: 'failed' | 'dead';
  error: string | null;
  createdAt: string;
};

/** POST /provision-modules/test 响应 */
export type ProvisionModuleTestResult = {
  ok: boolean;
  message: string | null;
};

// ============ 优惠码 ============

export type PromotionItem = {
  id: number;
  code: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  scope: 'all' | 'products' | 'groups';
  scopeIds: number[];
  minAmount: number;
  maxUses: number | null;
  usedCount?: number;
  perUserLimit: number;
  newCustomerOnly: boolean;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
};

// ============ 工单 ============

export type TicketListItem = {
  id: number;
  userId?: number;
  userName?: string | null;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  departmentId: number;
  departmentName: string | null;
  serviceId: number | null;
  lastReplyAt: string | null;
  lastReplyBy: 'customer' | 'staff' | null;
  createdAt: string;
};

export type TicketReplyItem = {
  id: number;
  authorType: 'customer' | 'staff' | 'system';
  authorName: string;
  contentHtml: string;
  internalNote: boolean;
  createdAt: string;
};

export type TicketDetail = TicketListItem & {
  replies: TicketReplyItem[];
};

// ============ 部门 / 模板 ============

export type DepartmentItem = {
  id: number;
  name: string;
  emailTo: string | null;
  sortOrder: number;
  hidden: boolean;
  createdAt: string;
};

export type TemplateItem = {
  id: number;
  channel: 'email' | 'sms' | 'inapp';
  event: string;
  subject: string | null;
  body: string;
  active: boolean;
  updatedAt?: string;
};

/** POST /admin/templates/signature：批量设置短信签名结果 */
export type SmsSignatureResult = {
  updated: number;
};

// ============ 管理员 / 角色 ============

export type AdminUserItem = AdminInfo & {
  roleName?: string | null;
  createdAt?: string;
};

export type RoleItem = {
  id: number;
  name: string;
  permissions: string[];
  isSuper: boolean;
};

// ============ 审计日志 ============

export type AuditLogItem = {
  id: number;
  actorType: 'admin' | 'user' | 'system';
  actorId: number | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
};

// ============ 系统设置 ============

export type SettingsMap = Record<string, unknown>;
// ============ 发票（开票申请） ============

export type FapiaoTitleSnapshot = {
  type: 'personal' | 'enterprise';
  name: string;
  taxNo: string | null;
  email: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
};

export type FapiaoRequestListItem = {
  id: number;
  userId: number;
  user: { name: string | null; phone: string | null; email: string | null } | null;
  invoiceId: number;
  invoiceNo: string | null;
  titleId: number;
  title: FapiaoTitleSnapshot | null;
  /** 金额（分） */
  amount: number;
  type: 'electronic' | 'special';
  status: 'pending' | 'approved' | 'issued' | 'rejected';
  remark: string | null;
  rejectReason: string | null;
  fapiaoNo: string | null;
  fapiaoUrl: string | null;
  approvedById: number | null;
  issuedAt: string | null;
  createdAt: string;
};

// ============ 知识库 ============

export type KbCategoryItem = {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  articleCount: number;
  createdAt?: string;
};

export type KbArticleListItem = {
  id: number;
  categoryId: number;
  categoryName: string | null;
  title: string;
  slug: string;
  visibility: 'public' | 'login';
  views: number;
  published: boolean;
  updatedAt: string;
  createdAt: string;
};

export type KbArticleDetail = KbArticleListItem & {
  contentHtml: string;
};

// ============ 实名审核 ============

export type IdentityListItem = {
  id: number;
  userId: number;
  user: { name: string | null; phone: string | null; email: string | null } | null;
  type: 'personal' | 'enterprise';
  realName: string | null;
  companyName: string | null;
  creditCode: string | null;
  status: 'unverified' | 'pending' | 'verified' | 'rejected';
  statusLabel: string;
  rejectReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 审核详情：证件号解密返回完整值（仅审核用，禁止落日志） */
export type IdentityDetail = IdentityListItem & {
  idNumber: string | null;
  user: { name: string | null; phone: string | null; email: string | null; createdAt: string | null } | null;
  /** 证件照 URL（front/back/handheld，未上传为 null） */
  images: { front: string | null; back: string | null; handheld: string | null };
  /** 正面照 OCR 结果：valid 为 null 表示无识别号；processing=识别中 / matched=与填写一致 / unavailable=不可用或不一致 */
  ocr: {
    idNumber: string | null;
    valid: boolean | null;
    status: 'processing' | 'matched' | 'unavailable' | null;
  };
};

// ============ 系统运行状态 ============

/** GET /system/status 响应（探活逐项降级，子项失败不影响整体） */
export type SystemStatusDto = {
  api: { ok: boolean; ts: string };
  db: { ok: boolean; latencyMs: number | null };
  redis: { ok: boolean; latencyMs: number | null };
  workers: SystemStatusWorker[];
  queues: SystemStatusQueue[];
};

/** worker 心跳条目（online = lastSeenAt 距今 < 90s） */
export type SystemStatusWorker = {
  group: string;
  pid: number;
  host: string;
  version: string | null;
  queues: string[];
  lastSeenAt: string;
  online: boolean;
};

/** 队列积压计数 */
export type SystemStatusQueue = {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
};
