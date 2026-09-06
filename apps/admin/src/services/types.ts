/**
 * 拼好机管理后台 API 类型定义
 *
 * TODO: 类型来源于 packages/contracts（@pinhaoji/contracts）。
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
