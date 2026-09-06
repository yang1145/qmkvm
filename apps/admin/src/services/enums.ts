/**
 * 业务枚举常量与展示映射
 * TODO: 来源 packages/contracts/src/common.ts（保持一致，便于 umi 构建不编译 TS 源码包）
 */

export const ORDER_STATUS = ['pending', 'paid', 'processing', 'completed', 'cancelled', 'failed'] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

export const INVOICE_STATUS = ['unpaid', 'paid', 'void', 'refunded', 'partially_refunded'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];

export const SERVICE_STATUS = ['pending', 'active', 'suspended_overdue', 'suspended_manual', 'terminated', 'cancelled'] as const;
export type ServiceStatus = (typeof SERVICE_STATUS)[number];

export const PROVISION_ACTION = ['provision', 'suspend', 'unsuspend', 'terminate', 'change_package', 'sync'] as const;
export type ProvisionAction = (typeof PROVISION_ACTION)[number];

export const PROVISION_STATUS = ['queued', 'processing', 'succeeded', 'failed', 'dead', 'skipped'] as const;
export type ProvisionStatus = (typeof PROVISION_STATUS)[number];

export const TICKET_STATUS = ['open', 'answered', 'customer_reply', 'in_progress', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUS)[number];

export const TICKET_PRIORITY = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITY)[number];

export const BILLING_CYCLE = ['onetime', 'monthly', 'quarterly', 'semiannually', 'annually', 'biennially', 'triennially'] as const;
export type BillingCycle = (typeof BILLING_CYCLE)[number];

// ============ 中文标签映射 ============

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  processing: '处理中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
};

export const ORDER_TYPE_LABEL: Record<string, string> = {
  new: '新购',
  renewal: '续费',
  upgrade: '升级',
  recharge: '充值',
  manual: '人工',
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: '未支付',
  paid: '已支付',
  void: '已作废',
  refunded: '已退款',
  partially_refunded: '部分退款',
};

export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = {
  pending: '待开通',
  active: '运行中',
  suspended_overdue: '逾期暂停',
  suspended_manual: '手动暂停',
  terminated: '已终止',
  cancelled: '已取消',
};

export const PROVISION_ACTION_LABEL: Record<ProvisionAction, string> = {
  provision: '开通',
  suspend: '暂停',
  unsuspend: '恢复',
  terminate: '终止',
  change_package: '变更套餐',
  sync: '同步',
};

export const PROVISION_STATUS_LABEL: Record<ProvisionStatus, string> = {
  queued: '排队中',
  processing: '执行中',
  succeeded: '成功',
  failed: '失败',
  dead: '死信',
  skipped: '已跳过',
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: '待处理',
  answered: '已回复',
  customer_reply: '客户回复',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
};

export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
  onetime: '一次性',
  monthly: '月付',
  quarterly: '季付',
  semiannually: '半年付',
  annually: '年付',
  biennially: '两年付',
  triennially: '三年付',
};

export const LEDGER_TYPE_LABEL: Record<string, string> = {
  recharge: '充值',
  payment: '支付',
  refund: '退款',
  adjustment: '调整',
  upgrade_refund: '升级退款',
  promo_bonus: '优惠赠送',
};

export const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  payment: '支付',
  refund: '退款',
};

export const TRANSACTION_STATUS_LABEL: Record<string, string> = {
  pending: '处理中',
  success: '成功',
  failed: '失败',
  refunded: '已退款',
};

export const REFUND_STATUS_LABEL: Record<string, string> = {
  pending: '处理中',
  succeeded: '成功',
  failed: '失败',
};

export const USER_STATUS_LABEL: Record<'active' | 'disabled', string> = {
  active: '正常',
  disabled: '已禁用',
};

export const CHANNEL_LABEL: Record<string, string> = {
  email: '邮件',
  sms: '短信',
  inapp: '站内信',
};

export const ACTOR_TYPE_LABEL: Record<string, string> = {
  admin: '管理员',
  user: '客户',
  system: '系统',
};

export const PRODUCT_STATUS_LABEL: Record<'active' | 'inactive', string> = {
  active: '上架',
  inactive: '下架',
};