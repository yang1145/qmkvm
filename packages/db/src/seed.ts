/**
 * 种子数据：pnpm db:seed（需 DATABASE_URL）
 * 幂等：按唯一键（slug/code/username/event）存在即跳过。
 * 默认管理员从环境变量读取，首次部署后必须修改密码。
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "./index.js";
import { hashPassword } from "./seed-argon.js";

async function main() {
  const db = getDb();
  console.log("== 开始种子数据 ==");

  // —— 角色 ——
  const roleDefs: { name: string; isSuper: boolean; permissions: string[] }[] = [
    { name: "超级管理员", isSuper: true, permissions: [] },
    { name: "财务", isSuper: false, permissions: ["customers.read", "orders.read", "invoices.read", "invoices.manage", "transactions.read", "refunds.manage", "reports.read"] },
    { name: "客服", isSuper: false, permissions: ["customers.read", "orders.read", "services.read", "tickets.read", "tickets.manage", "kb.manage"] },
    { name: "技术运维", isSuper: false, permissions: ["orders.read", "services.read", "services.manage", "tasks.manage", "products.read"] },
    { name: "只读审计", isSuper: false, permissions: ["customers.read", "orders.read", "services.read", "invoices.read", "transactions.read", "products.read", "tickets.read", "audit.read", "reports.read"] },
  ];
  for (const r of roleDefs) {
    const existing = await db.select().from(schema.adminRoles).where(eq(schema.adminRoles.name, r.name)).limit(1);
    if (existing.length === 0) {
      await db.insert(schema.adminRoles).values(r);
      console.log("  + 角色:", r.name);
    }
  }

  // —— 管理员 ——
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";
  const adminExists = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.username, adminUsername)).limit(1);
  if (adminExists.length === 0) {
    const superRole = (await db.select().from(schema.adminRoles).where(eq(schema.adminRoles.name, "超级管理员")).limit(1))[0];
    await db.insert(schema.adminUsers).values({
      username: adminUsername,
      passwordHash: await hashPassword(adminPassword),
      name: "超级管理员",
      roleId: superRole?.id,
      status: "active",
    });
    console.log(`  + 管理员: ${adminUsername}（初始密码见 SEED_ADMIN_PASSWORD，上线后必须修改）`);
  }

  // —— 工单部门 ——
  for (const [i, d] of [
    { name: "售前咨询", emailTo: null as string | null },
    { name: "技术支持", emailTo: null },
    { name: "财务与发票", emailTo: null },
    { name: "投诉建议", emailTo: null },
  ].entries()) {
    const exists = await db.select().from(schema.ticketDepartments).where(eq(schema.ticketDepartments.name, d.name)).limit(1);
    if (exists.length === 0) {
      await db.insert(schema.ticketDepartments).values({ ...d, sortOrder: i });
      console.log("  + 部门:", d.name);
    }
  }

  // —— 商品分组与商品（对齐官网 pricing.json 示例价） ——
  const groupSlug = "cloud-server";
  let groupId = (await db.select().from(schema.productGroups).where(eq(schema.productGroups.slug, groupSlug)).limit(1))[0]?.id;
  if (!groupId) {
    groupId = (await db.insert(schema.productGroups).values({ name: "云服务器", slug: groupSlug, description: "按需弹性云服务器，分钟级创建", sortOrder: 0 }).$returningId())[0]?.id;
    console.log("  + 商品分组: 云服务器");
  }
  if (groupId == null) throw new Error("group id missing");

  type PricingRow = { cycle: "monthly" | "quarterly" | "semiannually" | "annually"; firstPrice: number; renewalPrice: number };
  const productDefs: {
    slug: string; name: string; tagline: string; moduleCode: string; featured?: boolean;
    monthly: number; pricing: PricingRow[]; config?: { name: string; type: "select" | "quantity"; options: { label: string; value: string; priceDelta: number }[] }[];
  }[] = [
    {
      slug: "starter", name: "轻量型", tagline: "个人项目与轻量应用", moduleCode: "demo", monthly: 3900,
      pricing: [
        { cycle: "monthly", firstPrice: 3900, renewalPrice: 3900 },
        { cycle: "quarterly", firstPrice: 11100, renewalPrice: 11100 },
        { cycle: "annually", firstPrice: 42000, renewalPrice: 42000 },
      ],
      config: [
        { name: "地域", type: "select", options: [
          { label: "华北-北京", value: "cn-beijing", priceDelta: 0 },
          { label: "华东-上海", value: "cn-shanghai", priceDelta: 0 },
        ] },
        { name: "带宽（Mbps）", type: "quantity", options: [{ label: "带宽", value: "bandwidth", priceDelta: 200 }] },
      ],
    },
    {
      slug: "standard", name: "通用型", tagline: "生产业务与稳定在线服务", moduleCode: "demo", featured: true, monthly: 9900,
      pricing: [
        { cycle: "monthly", firstPrice: 9900, renewalPrice: 9900 },
        { cycle: "quarterly", firstPrice: 28200, renewalPrice: 28200 },
        { cycle: "annually", firstPrice: 106000, renewalPrice: 106000 },
      ],
    },
    {
      slug: "pro", name: "高性能型", tagline: "高并发与计算密集型负载", moduleCode: "demo", monthly: 25900,
      pricing: [
        { cycle: "monthly", firstPrice: 25900, renewalPrice: 25900 },
        { cycle: "quarterly", firstPrice: 73800, renewalPrice: 73800 },
        { cycle: "annually", firstPrice: 279000, renewalPrice: 279000 },
      ],
    },
    {
      slug: "demo-server", name: "演示实例（demo 模块）", tagline: "用于全链路联调测试", moduleCode: "demo", monthly: 100,
      pricing: [{ cycle: "monthly", firstPrice: 100, renewalPrice: 100 }],
    },
  ];

  for (const [i, p] of productDefs.entries()) {
    const exists = await db.select().from(schema.products).where(eq(schema.products.slug, p.slug)).limit(1);
    if (exists.length > 0) continue;
    const pid = (await db.insert(schema.products).values({
      groupId, name: p.name, slug: p.slug, tagline: p.tagline,
      moduleCode: p.moduleCode, status: "active", sortOrder: i,
      stockTotal: null, allowUpgrade: true, allowDowngrade: false,
      descriptionHtml: `<p>${p.tagline}</p>`,
    }).$returningId())[0]?.id;
    if (pid == null) continue;
    for (const pr of p.pricing) {
      await db.insert(schema.productPricing).values({ productId: pid, cycle: pr.cycle, firstPrice: pr.firstPrice, renewalPrice: pr.renewalPrice, setupFee: 0 });
    }
    for (const [gi, g] of (p.config ?? []).entries()) {
      const gid = (await db.insert(schema.configGroups).values({ productId: pid, name: g.name, type: g.type, required: true, sortOrder: gi }).$returningId())[0]?.id;
      if (gid == null) continue;
      for (const [oi, o] of g.options.entries()) {
        await db.insert(schema.configOptions).values({ groupId: gid, label: o.label, value: o.value, priceDelta: o.priceDelta, isDefault: oi === 0, sortOrder: oi });
      }
    }
    console.log("  + 商品:", p.name);
  }

  // —— 系统设置 ——
  const settingDefs: { key: string; value: Record<string, unknown> }[] = [
    { key: "billing.renewal_lead_days", value: { days: 14 } },
    { key: "billing.overdue_grace_days", value: { days: 3 } },
    { key: "billing.terminate_days", value: { days: 15 } },
    { key: "payment.intent_timeout_minutes", value: { minutes: 30 } },
    { key: "site", value: { siteName: "拼好机", announcement: "" } },
    { key: "payment.gateways", value: { alipay: { enabled: false }, wechat: { enabled: false }, mock: { enabled: true } } },
  ];
  for (const s of settingDefs) {
    const exists = await db.select().from(schema.settings).where(eq(schema.settings.key, s.key)).limit(1);
    if (exists.length === 0) {
      await db.insert(schema.settings).values({ key: s.key, value: s.value });
      console.log("  + 设置:", s.key);
    }
  }

  // —— 通知模板（zh） ——
  const T = (subject: string, body: string, sms?: string) => ({ subject, body, sms });
  const templates: Record<string, ReturnType<typeof T>> = {
    "user.registered": T("欢迎注册拼好机", "您好 {{user.name}}，欢迎注册拼好机！您现在可以选购云服务器并管理您的服务。"),
    "invoice.created": T("新账单待支付", "您有一张新账单 {{invoice.invoiceNo}}，金额 {{invoice.totalCny}}，请及时支付。", "【拼好机】您有新账单{{invoice.invoiceNo}}，金额{{invoice.totalCny}}，请及时支付。"),
    "invoice.paid": T("账单支付成功", "账单 {{invoice.invoiceNo}} 已支付成功，感谢您的支持。", "【拼好机】账单{{invoice.invoiceNo}}已支付成功。"),
    "invoice.reminder": T("账单即将到期提醒", "您的账单 {{invoice.invoiceNo}} 尚未支付，请及时处理以免影响服务。", "【拼好机】账单{{invoice.invoiceNo}}未支付，请及时处理。"),
    "invoice.overdue": T("账单逾期提醒", "您的账单 {{invoice.invoiceNo}} 已逾期，服务可能被暂停，请尽快支付。", "【拼好机】账单{{invoice.invoiceNo}}已逾期，请尽快支付。"),
    "service.activated": T("服务开通成功", "您的服务 {{service.name}} 已开通成功，感谢选择拼好机。", "【拼好机】服务{{service.name}}已开通成功。"),
    "service.suspend_warning": T("服务即将暂停提醒", "服务 {{service.name}} 即将因逾期暂停，请及时续费。", "【拼好机】服务{{service.name}}即将因逾期暂停，请及时续费。"),
    "service.suspended": T("服务已暂停", "服务 {{service.name}} 因逾期已暂停，续费后自动恢复。", "【拼好机】服务{{service.name}}已暂停，续费后恢复。"),
    "service.terminated": T("服务已终止", "服务 {{service.name}} 已逾期终止，数据可能已释放。", "【拼好机】服务{{service.name}}已逾期终止。"),
    "renewal.created": T("服务续费提醒", "服务 {{service.name}} 将于 {{service.nextDueDate}} 到期，已生成续费账单 {{invoice.invoiceNo}}，金额 {{invoice.totalCny}}。", "【拼好机】服务{{service.name}}即将到期，请及时续费。"),
    "renewal.auto_success": T("自动续费成功", "服务 {{service.name}} 已自动续费成功，扣除 {{service.amountCny}}，新到期日 {{service.nextDueDate}}。", "【拼好机】服务{{service.name}}已自动续费成功，新到期日{{service.nextDueDate}}。"),
    "renewal.auto_failed": T("自动续费失败", "服务 {{service.name}} 自动续费失败：余额不足，请充值以免服务暂停。", "【拼好机】服务{{service.name}}自动续费失败：余额不足，请充值以免服务暂停。"),
    "ticket.replied": T("工单新回复", "您的工单「{{ticket.subject}}」有新的回复，请登录门户查看。", "【拼好机】您的工单有新回复，请登录查看。"),
    "ticket.created_admin": T("新工单待处理", "客户 {{user.name}} 提交了新工单「{{ticket.subject}}」，请及时处理。"),
    "credit.recharged": T("充值到账", "您的余额充值已到账，金额 {{credit.amountCny}}。", "【拼好机】充值{{credit.amountCny}}已到账。"),
    "refund.completed": T("退款已处理", "您的退款 {{refund.amountCny}} 已原路退回，请注意查收。", "【拼好机】退款{{refund.amountCny}}已原路退回。"),
    "fapiao.status_changed": T("发票申请进度更新", "您的开票申请状态已更新为「{{fapiao.status}}」{{fapiao.fapiaoNo}}，关联账单 {{fapiao.invoiceNo}}，请登录门户查看详情。", "【拼好机】您的开票申请已更新为「{{fapiao.status}}」，请登录查看。"),
    "admin.task_failed": T("供应任务失败告警", "供应任务 #{{task.id}}（{{task.action}}）执行失败：{{task.error}}，请登录后台处理。"),
    "payment.alert": T("支付异常告警", "支付事件异常：{{payment.reason}}（事件 {{payment.eventId}}），请登录后台核查。"),
  };
  for (const [event, t] of Object.entries(templates)) {
    const channels: ("email" | "inapp" | "sms")[] = t.sms
      ? ["email", "inapp", "sms"]
      : ["email", "inapp"];
    for (const channel of channels) {
      const exists = await db
        .select()
        .from(schema.notificationTemplates)
        .where(eq(schema.notificationTemplates.channel, channel))
        .execute();
      if (exists.some((x) => x.event === event)) continue;
      await db.insert(schema.notificationTemplates).values({
        channel, event,
        subject: channel === "sms" ? null : t.subject,
        body: channel === "sms" ? (t.sms ?? t.body) : t.body,
        active: true,
      });
    }
  }
  console.log("  + 通知模板:", Object.keys(templates).length, "个事件");

  console.log("== 种子数据完成 ==");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
