/**
 * 权限定义：把 PERMISSIONS 权限点展开为 canXxx 布尔
 * isSuper=true 时全部通过
 * TODO: 权限点清单来源 packages/contracts/src/permissions.ts
 */
import type { AdminMe } from '@/services/types';

/** 权限点 → access key 映射（canXxx） */
export const PERMISSION_ACCESS_MAP: Record<string, string> = {
  'customers.read': 'canCustomersRead',
  'customers.manage': 'canCustomersManage',
  'customers.credit': 'canCustomersCredit',
  'orders.read': 'canOrdersRead',
  'orders.manage': 'canOrdersManage',
  'services.read': 'canServicesRead',
  'services.manage': 'canServicesManage',
  'tasks.manage': 'canTasksManage',
  'invoices.read': 'canInvoicesRead',
  'invoices.manage': 'canInvoicesManage',
  'transactions.read': 'canTransactionsRead',
  'refunds.manage': 'canRefundsManage',
  'products.read': 'canProductsRead',
  'products.manage': 'canProductsManage',
  'promotions.manage': 'canPromotionsManage',
  'tickets.read': 'canTicketsRead',
  'tickets.manage': 'canTicketsManage',
  'kb.manage': 'canKbManage',
  'settings.manage': 'canSettingsManage',
  'admins.manage': 'canAdminsManage',
  'audit.read': 'canAuditRead',
  'templates.manage': 'canTemplatesManage',
  'reports.read': 'canReportsRead',
};

/** 全部权限点 key（顺序与 contracts PERMISSIONS 一致） */
export const ALL_PERMISSION_KEYS = Object.keys(PERMISSION_ACCESS_MAP);

export default function access(initialState: { currentUser?: AdminMe } | undefined) {
  const { currentUser } = initialState ?? {};
  const permissions = currentUser?.permissions ?? [];
  const isSuper = currentUser?.isSuper ?? false;

  const accessMap: Record<string, boolean> = {};
  for (const key of ALL_PERMISSION_KEYS) {
    accessMap[PERMISSION_ACCESS_MAP[key]] = isSuper || permissions.includes(key);
  }
  // 账务中心分组入口：任一账务权限即可见
  accessMap.canBillingRead =
    accessMap.canInvoicesRead || accessMap.canTransactionsRead || accessMap.canRefundsManage;
  // 仪表盘：登录即可见
  accessMap.dashboard = !!currentUser;
  // 退款列表读取（发起退款用 refunds.manage）
  accessMap.canRefundsRead = accessMap.canTransactionsRead || accessMap.canRefundsManage;

  return accessMap;
}