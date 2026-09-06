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
  InvoiceListItem,
  OrderListItem,
  Paginated,
  ProductGroupItem,
  ProductListItem,
  PromotionItem,
  ProvisionTaskItem,
  RefundItem,
  RoleItem,
  ServiceListItem,
  SettingsMap,
  TemplateItem,
  TicketDetail,
  TicketListItem,
  TransactionItem,
} from './types';

const BASE = '/api/v1/admin';

/** 分页参数（ProTable params: current/pageSize → page/pageSize） */
export function pageParams(params: Record<string, unknown>) {
  return {
    page: params.current ?? 1,
    pageSize: params.pageSize ?? 20,
  };
}

// ============ 认证 ============

export async function adminLogin(data: { username: string; password: string }) {
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
  data: { action: 'provision' | 'suspend' | 'unsuspend' | 'terminate' | 'sync'; reason?: string },
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
  return request<ProductGroupItem[]>(`${BASE}/product-groups`);
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
  return request<DepartmentItem[]>(`${BASE}/departments`);
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
  return request<RoleItem[]>(`${BASE}/roles`);
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