/**
 * 管理后台路由桶：
 * - /auth 免鉴权（登录/登出/me 自行处理会话）；
 * - 其余统一 use(requireAdmin()) 要求管理员登录，各业务路由再按 SPEC §4 权限映射
 *   以 requireAdmin("<perm>") 细粒度校验（isSuper 全通过）。
 */
import { Hono } from "hono";
import { requireAdmin } from "../../middleware/auth.js";
import { adminAuthRoutes } from "./auth.js";
import { adminDashboardRoutes } from "./dashboard.js";
import { adminSystemStatusRoutes } from "./system-status.js";
import { adminCustomerRoutes } from "./customers.js";
import { adminOrderRoutes } from "./orders.js";
import { adminServiceRoutes } from "./services.js";
import { adminTaskRoutes } from "./tasks.js";
import { adminInvoiceRoutes } from "./invoices.js";
import { adminFapiaoRoutes } from "./fapiao.js";
import { adminTransactionRoutes } from "./transactions.js";
import { adminRefundRoutes } from "./refunds.js";
import { adminProductRoutes } from "./products.js";
import { adminPromotionRoutes } from "./promotions.js";
import { adminTicketRoutes } from "./tickets.js";
import { adminDepartmentRoutes } from "./departments.js";
import { adminKbRoutes } from "./kb.js";
import { adminTemplateRoutes } from "./templates.js";
import { adminAuditLogRoutes } from "./audit-logs.js";
import { adminSettingRoutes } from "./settings.js";
import { adminAdminRoutes } from "./admins.js";
import { adminReportRoutes } from "./reports.js";
import { adminExportRoutes } from "./export.js";
import { adminScheduledTaskRoutes } from "./scheduled-tasks.js";
import { adminProvisionModuleRoutes } from "./provision-modules.js";
import { adminIdentityRoutes } from "./identities.js";
import { adminZjmfSupplierRoutes } from "./zjmf-suppliers.js";

export const adminRoutes = new Hono();

// 认证路由（免登录态）
adminRoutes.route("/auth", adminAuthRoutes);

// 业务路由：先整体要求登录，子路由内逐端点校验权限点
adminRoutes.use("*", requireAdmin());

adminRoutes.route("/", adminDashboardRoutes);
adminRoutes.route("/", adminSystemStatusRoutes);
adminRoutes.route("/", adminCustomerRoutes);
adminRoutes.route("/", adminOrderRoutes);
adminRoutes.route("/", adminServiceRoutes);
adminRoutes.route("/", adminTaskRoutes);
adminRoutes.route("/", adminInvoiceRoutes);
adminRoutes.route("/", adminFapiaoRoutes);
adminRoutes.route("/", adminTransactionRoutes);
adminRoutes.route("/", adminRefundRoutes);
adminRoutes.route("/", adminProductRoutes);
adminRoutes.route("/", adminPromotionRoutes);
adminRoutes.route("/", adminTicketRoutes);
adminRoutes.route("/", adminDepartmentRoutes);
adminRoutes.route("/", adminKbRoutes);
adminRoutes.route("/", adminTemplateRoutes);
adminRoutes.route("/", adminAuditLogRoutes);
adminRoutes.route("/", adminSettingRoutes);
adminRoutes.route("/", adminAdminRoutes);
adminRoutes.route("/", adminReportRoutes);
adminRoutes.route("/", adminExportRoutes);
adminRoutes.route("/", adminScheduledTaskRoutes);
adminRoutes.route("/", adminProvisionModuleRoutes);
adminRoutes.route("/", adminIdentityRoutes);
adminRoutes.route("/", adminZjmfSupplierRoutes);
