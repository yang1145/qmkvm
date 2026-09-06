/**
 * 拼好机管理后台路由（全中文菜单）
 * access 字段对应 src/access.ts 的 canXxx 权限点
 */
export default [
  {
    path: '/user',
    layout: false,
    routes: [
      { name: '登录', path: '/user/login', component: './user/login' },
    ],
  },
  { path: '/', redirect: '/dashboard' },
  {
    path: '/dashboard',
    name: '仪表盘',
    icon: 'DashboardOutlined',
    access: 'dashboard',
    component: './dashboard',
  },
  {
    path: '/customers',
    name: '客户管理',
    icon: 'TeamOutlined',
    access: 'canCustomersRead',
    routes: [
      { path: '/customers', name: '客户列表', component: './customers' },
      { path: '/customers/:id', name: '客户详情', hideInMenu: true, component: './customers/detail' },
    ],
  },
  {
    path: '/orders',
    name: '订单管理',
    icon: 'ShoppingCartOutlined',
    access: 'canOrdersRead',
    component: './orders',
  },
  {
    path: '/services',
    name: '服务管理',
    icon: 'CloudServerOutlined',
    access: 'canServicesRead',
    component: './services',
  },
  {
    path: '/tasks',
    name: '供应任务',
    icon: 'DeploymentUnitOutlined',
    access: 'canTasksManage',
    component: './tasks',
  },
  {
    path: '/billing',
    name: '账务中心',
    icon: 'AccountBookOutlined',
    access: 'canBillingRead',
    routes: [
      { path: '/billing/invoices', name: '账单管理', component: './invoices', access: 'canInvoicesRead' },
      { path: '/billing/fapiao', name: '发票管理', component: './fapiao', access: 'canInvoicesRead' },
      { path: '/billing/transactions', name: '交易流水', component: './transactions', access: 'canTransactionsRead' },
      { path: '/billing/refunds', name: '退款管理', component: './refunds', access: 'canTransactionsRead' },
    ],
  },
  {
    path: '/reports',
    name: '数据中心',
    icon: 'FundOutlined',
    access: 'canReportsRead',
    component: './reports',
  },
  {
    path: '/products',
    name: '商品管理',
    icon: 'AppstoreOutlined',
    access: 'canProductsRead',
    routes: [
      { path: '/products/groups', name: '商品分组', component: './products/groups' },
      { path: '/products/provision-modules', name: '供应模块', component: './provision-modules' },
      { path: '/products', name: '商品列表', component: './products' },
      { path: '/products/:id/edit', name: '商品编辑', hideInMenu: true, component: './products/edit' },
    ],
  },
  {
    path: '/promotions',
    name: '优惠码管理',
    icon: 'TagsOutlined',
    access: 'canPromotionsManage',
    component: './promotions',
  },
  {
    path: '/tickets',
    name: '工单支持',
    icon: 'CustomerServiceOutlined',
    access: 'canTicketsRead',
    routes: [
      { path: '/tickets', name: '工单列表', component: './tickets' },
      { path: '/tickets/:id', name: '工单会话', hideInMenu: true, component: './tickets/detail' },
      { path: '/tickets/departments', name: '部门管理', component: './departments', access: 'canTicketsManage' },
      { path: '/tickets/templates', name: '通知模板', component: './templates', access: 'canTemplatesManage' },
      { path: '/tickets/kb', name: '知识库', component: './kb', access: 'canKbManage' },
    ],
  },
  {
    path: '/system',
    name: '系统管理',
    icon: 'SettingOutlined',
    routes: [
      { path: '/system/admins', name: '管理员', component: './admins', access: 'canAdminsManage' },
      { path: '/system/roles', name: '角色管理', component: './roles', access: 'canAdminsManage' },
      { path: '/system/audit-logs', name: '审计日志', component: './audit-logs', access: 'canAuditRead' },
      { path: '/system/scheduled-tasks', name: '计划任务', component: './scheduled-tasks', access: 'canTasksManage' },
      { path: '/system/settings', name: '系统设置', component: './settings', access: 'canSettingsManage' },
      { path: '/system/settings/payment', name: '支付设置', component: './settings/payment', access: 'canSettingsManage' },
      { path: '/system/settings/email', name: '邮件设置', component: './settings/email', access: 'canSettingsManage' },
    ],
  },
  { path: '*', layout: false, component: './exception/404' },
];