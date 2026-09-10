/**
 * 管理后台 API client
 * 统一走相对路径 /api/v1/admin/**（开发经代理到 http://localhost:4000，Cookie 同源自动携带）
 */
import { request } from '@umijs/max';
import type {
  AdminMe,
  AuditLogItem,
  CustomerDetail,
  CustomerListItem,
  DashboardDto,
  DepartmentItem,
  FapiaoRequestListItem,
  FapiaoTitleSnapshot,
  IdentityDetail,
  IdentityListItem,
  InvoiceListItem,
  KbArticleDetail,
  KbArticleListItem,
  KbCategoryItem,
  OrderListItem,
  Paginated,
  ProductGroupItem,
  ProductListItem,
  PromotionItem,
  ProvisionModuleFailureItem,
  ProvisionModuleItem,
  ProvisionModuleProductItem,
  ProvisionModuleTestResult,
  ProvisionTaskItem,
  RefundItem,
  RoleItem,
  ServiceListItem,
  SettingsMap,
  SmsSignatureResult,
  SystemStatusDto,
  TemplateItem,
  TicketDetail,
  TicketListItem,
  TransactionItem,
  ZjmfAssignResult,
  ZjmfSupplierItem,
  ZjmfSupplierSaveData,
  ZjmfUpstreamHostItem,
  ZjmfUpstreamProductItem,
  ZjmfUpstreamStatusInfo,
} from './types';

/** API 基址：构建期注入 ADMIN_API_URL（统一方案，跨域直连，不用反代）；
 * 留空仅限本地 dev（走 umi 本地 proxy） */
const API_ORIGIN = (process.env.ADMIN_API_URL || '')
  // 构建期注入值可能带多余引号/空白（.env 为兼容 compose 解析对值加了引号），统一剥掉两端
  .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
const BASE = `${API_ORIGIN}/api/v1/admin`;

/** 分页参数（ProTable params: current/pageSize → page/pageSize） */
export function pageParams(params: Record<string, unknown>) {
  return {
    page: params.current ?? 1,
    pageSize: params.pageSize ?? 20,
  };
}

// ============ 认证 ============

export async function adminLogin(data: {
  username: string;
  password: string;
  captchaId: string;
  captchaCode: string;
}) {
  return request<AdminMe>(`${BASE}/auth/login`, {
    method: 'POST',
    data,
  });
}

export async function adminLogout() {
  return request<{ ok: boolean }>(`${BASE}/auth/logout`, { method: 'POST' });
}

export async function getAdminMe() {
  return request<AdminMe>(`${BASE}/auth/me`, { method: 'GET' });
}

// ============ 仪表盘 ============

export async function getDashboard() {
  return request<DashboardDto>(`${BASE}/dashboard`);
}

// ============ 客户 ============

export async function getCustomers(params: Record<string, unknown>) {
  return request<Paginated<CustomerListItem>>(`${BASE}/customers`, { params });
}

export async function getCustomerDetail(id: number) {
  return request<CustomerDetail>(`${BASE}/customers/${id}`);
}

export async function setCustomerStatus(id: number, status: 'active' | 'disabled') {
  return request<{ ok: boolean }>(`${BASE}/customers/${id}/status`, {
    method: 'POST',
    data: { status },
  });
}

export async function adjustCustomerCredit(data: {
  userId: number;
  amount: number;
  remark: string;
}) {
  return request<{ ok: boolean }>(`${BASE}/customers/credit`, {
    method: 'POST',
    data,
  });
}

// ============ 订单 ============

export async function getOrders(params: Record<string, unknown>) {
  return request<Paginated<OrderListItem>>(`${BASE}/orders`, { params });
}

export async function markOrderPaid(id: number) {
  return request<{ ok: boolean }>(`${BASE}/orders/${id}/mark-paid`, { method: 'POST' });
}

export async function cancelOrder(id: number) {
  return request<{ ok: boolean }>(`${BASE}/orders/${id}/cancel`, { method: 'POST' });
}

// ============ 服务 ============

export async function getServices(params: Record<string, unknown>) {
  return request<Paginated<ServiceListItem>>(`${BASE}/services`, { params });
}

export async function serviceAction(
  id: number,
  data: { action: 'provision' | 'suspend' | 'unsuspend' | 'terminate' | 'sync' | 'renew'; reason?: string },
) {
  return request<{ ok: boolean }>(`${BASE}/services/${id}/action`, { method: 'POST', data });
}

export async function manualCompleteService(id: number, deliverInfo: Record<string, unknown>) {
  return request<{ ok: boolean }>(`${BASE}/services/${id}/manual-complete`, {
    method: 'POST',
    data: { deliverInfo },
  });
}

export async function renameService(id: number, name: string) {
  return request<{ ok: boolean }>(`${BASE}/services/${id}`, { method: 'PATCH', data: { name } });
}

// ============ 供应任务 ============

export async function getTasks(params: Record<string, unknown>) {
  return request<Paginated<ProvisionTaskItem>>(`${BASE}/tasks`, { params });
}

export async function retryTask(id: number) {
  return request<{ ok: boolean }>(`${BASE}/tasks/${id}/retry`, { method: 'POST' });
}

export async function skipTask(id: number) {
  return request<{ ok: boolean }>(`${BASE}/tasks/${id}/skip`, { method: 'POST' });
}

// ============ 账单 ============

export async function getInvoices(params: Record<string, unknown>) {
  return request<Paginated<InvoiceListItem>>(`${BASE}/invoices`, { params });
}

export async function createInvoice(data: {
  userId: number;
  items: { description: string; qty: number; unitPrice: number }[];
  note?: string;
}) {
  return request<InvoiceListItem>(`${BASE}/invoices`, { method: 'POST', data });
}

export async function voidInvoice(id: number, reason: string) {
  return request<{ ok: boolean }>(`${BASE}/invoices/${id}/void`, { method: 'POST', data: { reason } });
}

// ============ 发票（开票申请） ============

export async function getFapiaoRequests(params: Record<string, unknown>) {
  return request<Paginated<FapiaoRequestListItem>>(`${BASE}/fapiao`, { params });
}

export async function getFapiaoRequest(id: number) {
  return request<FapiaoRequestListItem & { title: FapiaoTitleSnapshot | null }>(`${BASE}/fapiao/${id}`);
}

export async function approveFapiaoRequest(id: number) {
  return request<{ ok: boolean }>(`${BASE}/fapiao/${id}/approve`, { method: 'POST' });
}

export async function rejectFapiaoRequest(id: number, reason: string) {
  return request<{ ok: boolean }>(`${BASE}/fapiao/${id}/reject`, { method: 'POST', data: { reason } });
}

export async function issueFapiaoRequest(id: number, data: { fapiaoNo: string; fapiaoUrl?: string }) {
  return request<{ ok: boolean }>(`${BASE}/fapiao/${id}/issue`, { method: 'POST', data });
}

/** 导出发票 CSV（带 Cookie 下载为 Blob） */
export async function exportFapiaoCsv(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${BASE}/fapiao/export${query}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`导出失败（HTTP ${res.status}）`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] ?? 'fapiao.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ============ 实名审核 ============

export async function getIdentities(params: Record<string, unknown>) {
  return request<Paginated<IdentityListItem>>(`${BASE}/identities`, { params });
}

export async function getIdentity(id: number) {
  return request<IdentityDetail>(`${BASE}/identities/${id}`);
}

export async function reviewIdentity(id: number, action: 'approve' | 'reject', reason?: string) {
  return request<{ ok: boolean; status: string }>(`${BASE}/identities/${id}/review`, {
    method: 'POST',
    data: { action, reason },
  });
}

// ============ 交易 / 退款 ============

export async function getTransactions(params: Record<string, unknown>) {
  return request<Paginated<TransactionItem>>(`${BASE}/transactions`, { params });
}

export async function getRefunds(params: Record<string, unknown>) {
  return request<Paginated<RefundItem>>(`${BASE}/refunds`, { params });
}

export async function createRefund(data: { transactionId: number; amount: number; reason: string }) {
  return request<RefundItem>(`${BASE}/refunds`, { method: 'POST', data });
}

// ============ 商品 ============

export async function getProductGroups() {
  const res = await request<{ items: ProductGroupItem[] }>(`${BASE}/product-groups`);
  return res.items ?? [];
}

export async function createProductGroup(data: Partial<ProductGroupItem>) {
  return request<ProductGroupItem>(`${BASE}/product-groups`, { method: 'POST', data });
}

export async function updateProductGroup(id: number, data: Partial<ProductGroupItem>) {
  return request<ProductGroupItem>(`${BASE}/product-groups/${id}`, { method: 'PUT', data });
}

export async function deleteProductGroup(id: number) {
  return request<{ ok: boolean }>(`${BASE}/product-groups/${id}`, { method: 'DELETE' });
}

export async function getProducts(params: Record<string, unknown>) {
  return request<Paginated<ProductListItem>>(`${BASE}/products`, { params });
}

export async function getProduct(id: number) {
  return request<ProductListItem>(`${BASE}/products/${id}`);
}

export async function createProduct(data: Record<string, unknown>) {
  return request<ProductListItem>(`${BASE}/products`, { method: 'POST', data });
}

export async function updateProduct(id: number, data: Record<string, unknown>) {
  return request<ProductListItem>(`${BASE}/products/${id}`, { method: 'PUT', data });
}

export async function deleteProduct(id: number) {
  return request<{ ok: boolean }>(`${BASE}/products/${id}`, { method: 'DELETE' });
}

export async function createConfigGroup(productId: number, data: { name: string; type: string; required: boolean }) {
  return request<{ id: number }>(`${BASE}/products/${productId}/config-groups`, { method: 'POST', data });
}

export async function updateConfigGroup(id: number, data: { name?: string; type?: string; required?: boolean }) {
  return request<{ ok: boolean }>(`${BASE}/config-groups/${id}`, { method: 'PUT', data });
}

export async function deleteConfigGroup(id: number) {
  return request<{ ok: boolean }>(`${BASE}/config-groups/${id}`, { method: 'DELETE' });
}

export async function createConfigOption(groupId: number, data: Record<string, unknown>) {
  return request<{ id: number }>(`${BASE}/config-groups/${groupId}/options`, { method: 'POST', data });
}

export async function updateConfigOption(id: number, data: Record<string, unknown>) {
  return request<{ ok: boolean }>(`${BASE}/config-options/${id}`, { method: 'PUT', data });
}

export async function deleteConfigOption(id: number) {
  return request<{ ok: boolean }>(`${BASE}/config-options/${id}`, { method: 'DELETE' });
}

// ============ 供应模块 ============

export async function getProvisionModules() {
  const res = await request<{ items: ProvisionModuleItem[] }>(`${BASE}/provision-modules`);
  return res.items ?? [];
}

export async function getProvisionModuleProducts(code: string, params: Record<string, unknown>) {
  return request<Paginated<ProvisionModuleProductItem>>(
    `${BASE}/provision-modules/${encodeURIComponent(code)}/products`,
    { params },
  );
}

export async function getProvisionModuleFailures(code: string) {
  const res = await request<{ items: ProvisionModuleFailureItem[] }>(
    `${BASE}/provision-modules/${encodeURIComponent(code)}/failures`,
  );
  return res.items ?? [];
}

export async function testProvisionModule(code: string, config: Record<string, unknown> | null) {
  return request<ProvisionModuleTestResult>(`${BASE}/provision-modules/test`, {
    method: 'POST',
    data: { code, config },
  });
}

// ============ 优惠码 ============

export async function getPromotions(params: Record<string, unknown>) {
  return request<Paginated<PromotionItem>>(`${BASE}/promotions`, { params });
}

export async function createPromotion(data: Record<string, unknown>) {
  return request<PromotionItem>(`${BASE}/promotions`, { method: 'POST', data });
}

export async function updatePromotion(id: number, data: Record<string, unknown>) {
  return request<PromotionItem>(`${BASE}/promotions/${id}`, { method: 'PUT', data });
}

export async function deletePromotion(id: number) {
  return request<{ ok: boolean }>(`${BASE}/promotions/${id}`, { method: 'DELETE' });
}

// ============ 工单 ============

export async function getTickets(params: Record<string, unknown>) {
  return request<Paginated<TicketListItem>>(`${BASE}/tickets`, { params });
}

export async function getTicketDetail(id: number) {
  return request<TicketDetail>(`${BASE}/tickets/${id}`);
}

export async function replyTicket(
  id: number,
  data: { contentHtml: string; internalNote?: boolean },
) {
  return request<{ ok: boolean }>(`${BASE}/tickets/${id}/reply`, { method: 'POST', data });
}

export async function setTicketStatus(id: number, status: string) {
  return request<{ ok: boolean }>(`${BASE}/tickets/${id}/status`, { method: 'POST', data: { status } });
}

// ============ 部门 / 模板 ============

export async function getDepartments() {
  const res = await request<{ items: DepartmentItem[] }>(`${BASE}/departments`);
  return res.items ?? [];
}

export async function createDepartment(data: Partial<DepartmentItem>) {
  return request<DepartmentItem>(`${BASE}/departments`, { method: 'POST', data });
}

export async function updateDepartment(id: number, data: Partial<DepartmentItem>) {
  return request<DepartmentItem>(`${BASE}/departments/${id}`, { method: 'PUT', data });
}

export async function getTemplates(params?: Record<string, unknown>) {
  return request<Paginated<TemplateItem>>(`${BASE}/templates`, { params });
}

export async function createTemplate(data: Record<string, unknown>) {
  return request<TemplateItem>(`${BASE}/templates`, { method: 'POST', data });
}

export async function updateTemplate(id: number, data: Record<string, unknown>) {
  return request<TemplateItem>(`${BASE}/templates/${id}`, { method: 'PUT', data });
}

export async function setSmsSignature(signature: string) {
  return request<SmsSignatureResult>(`${BASE}/templates/signature`, {
    method: 'POST',
    data: { signature },
  });
}

// ============ 管理员 / 角色 ============

export async function getAdmins(params: Record<string, unknown>) {
  return request<Paginated<AdminMe['admin'] & { roleName?: string | null; createdAt?: string }>>(`${BASE}/admins`, { params });
}

export async function createAdmin(data: { username: string; password: string; name?: string; roleId: number }) {
  return request<AdminMe['admin']>(`${BASE}/admins`, { method: 'POST', data });
}

export async function updateAdmin(id: number, data: Record<string, unknown>) {
  return request<AdminMe['admin']>(`${BASE}/admins/${id}`, { method: 'PUT', data });
}

export async function getRoles() {
  const res = await request<{ items: RoleItem[] }>(`${BASE}/roles`);
  return res.items ?? [];
}

export async function createRole(data: { name: string; permissions: string[]; isSuper?: boolean }) {
  return request<RoleItem>(`${BASE}/roles`, { method: 'POST', data });
}

export async function updateRole(id: number, data: { name: string; permissions: string[]; isSuper?: boolean }) {
  return request<RoleItem>(`${BASE}/roles/${id}`, { method: 'PUT', data });
}

// ============ 审计日志 ============

export async function getAuditLogs(params: Record<string, unknown>) {
  return request<Paginated<AuditLogItem>>(`${BASE}/audit-logs`, { params });
}

// ============ 系统设置 ============

export async function getSettings() {
  return request<SettingsMap>(`${BASE}/settings`);
}

export async function putSettings(values: SettingsMap) {
  return request<{ ok: boolean }>(`${BASE}/settings`, { method: 'PUT', data: { values } });
}

// ============ 站点品牌设置（settings/site 子路由） ============

/** 站点品牌定制（settings key='site'）；logo 为 data URL，null = 清空恢复内置缺省 */
export interface SiteSettings {
  siteName?: string;
  siteNameEn?: string | null;
  logo?: string | null;
  copyright?: string | null;
  contactEmail?: string | null;
  portalUrl?: string | null;
  announcement?: string | null;
}

export async function getSiteSettings() {
  return request<{ value: SiteSettings }>(`${BASE}/settings/site`);
}

export async function putSiteSettings(value: SiteSettings) {
  return request<{ ok: boolean }>(`${BASE}/settings/site`, { method: 'PUT', data: value });
}

// ============ 支付设置 / 邮件设置（settings 子路由） ============

/** 支付网关配置：敏感字段（privateKey/apiv3Key）读取时为 "******" 掩码，原样回传表示不修改 */
export async function getPaymentSettings() {
  return request<{ value: Record<string, unknown> }>(`${BASE}/settings/payment`);
}

export async function putPaymentSettings(gateways: Record<string, unknown>) {
  return request<{ ok: boolean }>(`${BASE}/settings/payment`, { method: 'PUT', data: { gateways } });
}

export interface SmtpSettings {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string | null;
  /** 读取时为 "******" 掩码，原样回传表示不修改 */
  pass?: string | null;
  from?: string;
}

export async function getSmtpSettings() {
  return request<{ value: SmtpSettings }>(`${BASE}/settings/smtp`);
}

export async function putSmtpSettings(value: SmtpSettings) {
  return request<{ ok: boolean }>(`${BASE}/settings/smtp`, { method: 'PUT', data: value });
}

export type TestEmailResult = { ok: boolean; provider: 'smtp' | 'mock'; error?: string };

export async function testSmtp(to: string) {
  return request<TestEmailResult>(`${BASE}/settings/smtp/test`, { method: 'POST', data: { to } });
}

export type TestTemplateResult = TestEmailResult & { subject?: string; body?: string };

/** 按 email 模板渲染示例变量后发送测试邮件 */
export async function testNotificationTemplate(templateId: number, to: string) {
  return request<TestTemplateResult>(`${BASE}/settings/templates/test`, {
    method: 'POST',
    data: { templateId, to },
  });
}

// ============ 知识库 ============

export async function getKbCategories() {
  return request<Paginated<KbCategoryItem>>(`${BASE}/kb/categories`);
}

export async function createKbCategory(data: { name: string; slug?: string; sortOrder?: number }) {
  return request<{ id: number }>(`${BASE}/kb/categories`, { method: 'POST', data });
}

export async function updateKbCategory(id: number, data: { name?: string; slug?: string; sortOrder?: number }) {
  return request<{ ok: boolean }>(`${BASE}/kb/categories/${id}`, { method: 'PUT', data });
}

export async function deleteKbCategory(id: number) {
  return request<{ ok: boolean }>(`${BASE}/kb/categories/${id}`, { method: 'DELETE' });
}

export async function getKbArticles(params: Record<string, unknown>) {
  return request<Paginated<KbArticleListItem>>(`${BASE}/kb/articles`, { params });
}

export async function getKbArticle(id: number) {
  return request<KbArticleDetail>(`${BASE}/kb/articles/${id}`);
}

export async function createKbArticle(data: Record<string, unknown>) {
  return request<{ id: number }>(`${BASE}/kb/articles`, { method: 'POST', data });
}

export async function updateKbArticle(id: number, data: Record<string, unknown>) {
  return request<{ ok: boolean }>(`${BASE}/kb/articles/${id}`, { method: 'PUT', data });
}

export async function deleteKbArticle(id: number) {
  return request<{ ok: boolean }>(`${BASE}/kb/articles/${id}`, { method: 'DELETE' });
}

// ============ 报表与数据导出（F12） ============

export type RevenuePoint = { date: string; gmv: string; orders: number };
export type ProductStat = { productId: number | null; name: string; count: number; revenue: string };
export type RetentionPoint = { date: string; newServices: number; renewals: number };
export type UserGrowthPoint = { date: string; count: number };

export type ReportRange = { from?: string; to?: string };

function rangeParams(range?: ReportRange): Record<string, string> {
  const params: Record<string, string> = {};
  if (range?.from) params.from = range.from;
  if (range?.to) params.to = range.to;
  return params;
}

export async function getRevenueReport(range?: ReportRange) {
  return request<{ items: RevenuePoint[]; from: string; to: string }>(`${BASE}/reports/revenue`, {
    params: rangeParams(range),
  });
}

export async function getProductReport(range?: ReportRange) {
  return request<{ items: ProductStat[]; from: string; to: string }>(`${BASE}/reports/products`, {
    params: rangeParams(range),
  });
}

export async function getRetentionReport(range?: ReportRange) {
  return request<{ items: RetentionPoint[]; from: string; to: string }>(`${BASE}/reports/retention`, {
    params: rangeParams(range),
  });
}

export async function getUserReport(range?: ReportRange) {
  return request<{ items: UserGrowthPoint[]; from: string; to: string }>(`${BASE}/reports/users`, {
    params: rangeParams(range),
  });
}

/** 数据导出（CSV）：走原生下载，非 XHR */
export const EXPORT_PATHS = {
  customers: `${BASE}/export/customers`,
  orders: `${BASE}/export/orders`,
  invoices: `${BASE}/export/invoices`,
  transactions: `${BASE}/export/transactions`,
} as const;

// ============ 计划任务管理（与 apps/worker/src/tasks 注册表对应） ============

/** 最近一次执行记录 */
export type ScheduledTaskLastRun = {
  status: 'success' | 'partial' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

/** 计划任务清单项 */
export type ScheduledTaskItem = {
  name: string;
  cron: string;
  description: string;
  lastRun: ScheduledTaskLastRun | null;
};

/** 计划任务执行记录（job_runs） */
export type ScheduledTaskRunItem = {
  id: number;
  status: 'success' | 'partial' | 'failed';
  result: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export async function getScheduledTasks() {
  return request<{ items: ScheduledTaskItem[] }>(`${BASE}/scheduled-tasks`);
}

export async function getScheduledTaskRuns(name: string, params: Record<string, unknown>) {
  return request<Paginated<ScheduledTaskRunItem>>(
    `${BASE}/scheduled-tasks/${encodeURIComponent(name)}/runs`,
    { params },
  );
}

export async function runScheduledTask(name: string) {
  return request<{ ok: boolean }>(
    `${BASE}/scheduled-tasks/${encodeURIComponent(name)}/run`,
    { method: 'POST' },
  );
}

// ============ 系统运行状态 ============

export async function getSystemStatus() {
  return request<SystemStatusDto>(`${BASE}/system/status`);
}

// ============ 魔方财务（zjmf 供应模块） ============

export async function getZjmfSuppliers() {
  return request<{ items: ZjmfSupplierItem[] }>(`${BASE}/zjmf/suppliers`);
}

export async function saveZjmfSupplier(code: string, data: ZjmfSupplierSaveData) {
  return request<{ ok: boolean; item: ZjmfSupplierItem }>(
    `${BASE}/zjmf/suppliers/${encodeURIComponent(code)}`,
    { method: 'PUT', data },
  );
}

export async function deleteZjmfSupplier(code: string) {
  return request<{ ok: boolean }>(`${BASE}/zjmf/suppliers/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

export async function testZjmfSupplier(body: { code?: string }) {
  return request<{ ok: boolean; message?: string }>(`${BASE}/zjmf/suppliers/test`, { method: 'POST', data: body });
}

export async function syncZjmfProducts(code: string) {
  return request<{ ok: boolean; updated: number; failed: number; detailsSkipped: number; skippedOverLimit?: number }>(
    `${BASE}/zjmf/suppliers/${encodeURIComponent(code)}/sync-products`,
    { method: 'POST' },
  );
}

export async function getZjmfUpstreamProducts(code: string) {
  return request<{ items: ZjmfUpstreamProductItem[] }>(
    `${BASE}/zjmf/suppliers/${encodeURIComponent(code)}/products`,
  );
}

export async function getZjmfHosts(code: string) {
  return request<{ items: ZjmfUpstreamHostItem[] }>(
    `${BASE}/zjmf/suppliers/${encodeURIComponent(code)}/hosts`,
  );
}

export async function getZjmfBalance(code: string) {
  return request<{ credit: string; creditCents: number | null; currency: string }>(
    `${BASE}/zjmf/suppliers/${encodeURIComponent(code)}/balance`,
  );
}

export async function getZjmfServiceUpstreamStatus(serviceId: number) {
  return request<ZjmfUpstreamStatusInfo>(`${BASE}/zjmf/services/${serviceId}/upstream-status`);
}

export async function zjmfAssign(
  body:
    | { mode: 'bind'; code: string; upHostId: number; userId: number; productId: number; name?: string }
    | { mode: 'open'; code: string; upProductId: number; userId: number; name?: string },
) {
  return request<ZjmfAssignResult>(`${BASE}/zjmf/assign`, { method: 'POST', data: body });
}
