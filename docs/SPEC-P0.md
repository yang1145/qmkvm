# P0 实现规格（SPEC-P0）

> 本文档是拼好机云业务系统 P0（M1 MVP）实现的**唯一共享契约**。所有子任务在编码前必读。
> 仓库根：`D:\Documents\GitHub\pinhaoji-web`（Windows / Git Bash / pnpm 11 / Node 22）。
> PRD 见 `PRD-billing.md`；数据库 Schema 见 `packages/db/src/schema/`；共享类型见 `packages/contracts/src/`。

## 0. 硬性约定

- **语言**：TypeScript 严格模式（`noUncheckedIndexedAccess` 已开启，数组/对象索引访问需判空）。
- **模块**：ESM（`"type": "module"`）。**相对导入必须带 `.js` 后缀**（如 `import { x } from "./x.js"`）。包间导入用 `@pinhaoji/<pkg>`。
- **运行时**：API/Worker 均为 Node 长驻进程（非 Edge）。开发用 `tsx`。
- **金额**：全链路整数分（`number`，DB 为 BIGINT）。**禁止 float 计算金额**；百分比折扣用整数运算（`Math.round(base * percent / 100)`）。
- **时间**：DB 用 `datetime`（UTC，`timezone: "Z"`）；API 传输 ISO 8601 字符串；`next_due_date` 为 `date`（"YYYY-MM-DD" 字符串）。
- **错误**：业务错误统一抛 `AppError`（packages/core/errors.ts），携带 `ErrorCode`（packages/contracts/errors.ts）；API 层捕获转 HTTP。
- **校验**：所有外部输入（HTTP body/query）用 contracts 中的 zod Schema 校验。
- **异步**：单实例内优先单事务（`db.transaction`）；跨进程动作通过队列事件。
- **不修改他人范围**：每个子任务只允许改动指定文件；发现需要改其他包时，在自己的包内用依赖注入/接口解耦，并在最终报告中列出建议。
- **完成标准**：`pnpm --filter <pkg> typecheck` 通过；core 的 `pnpm --filter @pinhaoji/core test` 通过。不引入 SPEC 之外的运行时依赖（devDep 除外）；如必须新增，先在报告中说明理由。

## 1. 包依赖关系与职责

```text
contracts(纯类型+zod) ← db(drizzle) ← core(领域逻辑) ← payments / provisioning / auth / notifications
api = hono 应用，组合以上包；worker = BullMQ 消费者 + 定时任务
```

| 包 | 职责 | 依赖 |
| --- | --- | --- |
| @pinhaoji/contracts | zod DTO、ErrorCode、权限点、枚举 | zod |
| @pinhaoji/db | schema、client、redis 单例、迁移 | drizzle-orm, mysql2, ioredis |
| @pinhaoji/logger | pino 封装（脱敏） | pino |
| @pinhaoji/core | 金额/报价/优惠/账单/余额/订单/服务生命周期/升级折算/事件与队列抽象 | db, contracts, logger |
| @pinhaoji/auth | 密码、会话、短信验证码、RBAC 会话、限流 | db, contracts, logger |
| @pinhaoji/notifications | 模板渲染 + 邮件/短信/站内信发送 | db, contracts, logger, nodemailer |
| @pinhaoji/payments | 支付网关抽象 + 支付宝/微信/mock + 回调处理管线 | db, core, contracts, alipay-sdk |
| @pinhaoji/provisioning | 供应模块 SDK + manual/http-api/demo + 任务执行器 | db, core, contracts |
| @pinhaoji/api | HTTP API（Hono） | 全部 |
| @pinhaoji/worker | 队列消费者 + 定时任务 | core, provisioning, payments, notifications, bullmq |

**前端形态**：
- `apps/portal`：Next.js 客户门户（自研，视觉对齐官网）。
- `apps/admin`：**Ant Design Pro（umi max 脚手架）管理后台**——使用现成布局、ProTable/ProForm、access 权限框架，不手写基础 UI。对接 §4 的 admin API。

**Redis 单例**：`packages/db/src/redis.ts` 导出 `getRedis(): Redis | null`（无 `REDIS_URL` 时返回 null，调用方走内存降级）。core 的队列与 auth 的限流都经此获取 Redis。需在 `packages/db/package.json` 增加 `ioredis` 依赖。

## 2. 包接口契约（必须按此签名实现）

### 2.1 @pinhaoji/core

```ts
// money.ts（已预写，勿改接口）
formatCny(cents: number): string            // "¥39.00"
applyPercent(base: number, percent: number): number  // 四舍五入到分
minAmount1(a: number, b: number): number    // 取小

// errors.ts（已预写，勿改接口）
class AppError extends Error { code: ErrorCode; status: number; details?: Record<string, unknown> }
appError(code: ErrorCode, message?: string, details?): AppError   // 内置 code→HTTP status 映射

// date-utils.ts（lifecycle 实现）
addCycle(dateStr: "YYYY-MM-DD", cycle: BillingCycle, from?: "YYYY-MM-DD"): string
  // 从 from（默认 dateStr）加 N 个自然月；月末 clamp（1/31 + 1月 = 2/28）；onetime 返回原值
daysBetween(a: string, b: string): number    // b - a 的天数

// billing/price.ts
quoteProduct(db, { productId, cycle, selections: CartOptionSelection[], qty }):
  Promise<{ unitFirst, unitRenewal, setupFee, amount, optionsSummary: string[] }>
  // 校验商品 active/库存；选项属于该商品；required 组必填；quantity 型按 quantity 折算
  // 金额规则：unitFirst = firstPrice + Σ(priceDelta×qty数量型)，setupFee = setupFee + Σ setupDelta

// billing/promo.ts
validatePromo(db, code, { userId, subtotal, productIds, groupIds, isFirstOrder }):
  Promise<{ promo: Promotion; discount: number }>   // 失败抛 AppError(PROMO_*)
recordPromoUsage(tx, { promotionId, userId, orderId, discountAmount }): Promise<void>

// billing/invoice.ts
generateInvoiceNo(db): Promise<string>       // PHJ-YYYYMM-XXXXXX（随机 6 位大写字母数字，查重）
createInvoiceWithItems(tx, { userId, type, orderId?, items: {description, qty, unitPrice}[], discount?, dueAt? }):
  Promise<Invoice>                           // 状态 unpaid
markInvoicePaid(tx, invoiceId, { gatewayCode?, gatewayTxnId?, balanceUsed?, paymentIntentId? }):
  Promise<Invoice>                           // 幂等：已 paid 直接返回；写 paidAt
voidInvoice(db, invoiceId, adminId, reason): Promise<Invoice>  // 仅 unpaid 可作废

// billing/credit.ts
creditUser(tx, userId, { type, amount(>0), refType?, refId?, remark?, adminId? }): Promise<{ balanceAfter }>
debitUser(tx, userId, 同上 amount(>0)): Promise<{ balanceAfter }>
  // 实现：UPDATE users SET credit_balance = credit_balance ± amount WHERE id=? AND (credit_balance >= amount 出账时)
  // affected=0 → 抛 BILL_INSUFFICIENT_BALANCE；随后插入 creditLedger（amount 带符号、balanceAfter 回读）
payInvoiceWithBalance(db, userId, invoiceId): Promise<{ invoice, balanceAfter }>
  // 事务：锁 invoice( unpaid ) → debitUser(剩余应付) → markInvoicePaid(balanceUsed=total) → 事件
adjustCredit(db, adminId, { userId, amount(带符号), remark }): 审计 + creditUser/debitUser(type=adjustment)

// billing/order-service.ts
createOrderFromCart(db, user, { quote, promoCode?, useBalance, note? }):
  Promise<CheckoutResult>                    // 见 contracts checkoutResultSchema
  // 事务内：重新报价(不信任 quote) → 锁定库存(UPDATE stock_used=stock_used+qty WHERE stock_total IS NULL OR stock_used+qty<=stock_total，affected=0→OUT_OF_STOCK) → promo 校验与 usage → 建 order(pending)+orderItems+invoice → useBalance 且余额≥payable 时 payInvoiceWithBalance → 否则返回 payable
  // 注意：余额组合支付 P0 简化为「全额余额」或「全额在线」，不做混合
cancelOrder(db, userId, orderId): Promise<void>   // 仅 pending；释放库存
markOrderPaid(tx, orderId): Promise<void>         // pending→paid；为 new 型每个 item 建 service(pending)+provision_task(provision)；renewal 型 item → applyRenewalPayment；upgrade 型 → 建 change_package 任务
completeOrder(tx, orderId): Promise<void>         // paid→completed（全部服务 active 后由 worker 调用）

// lifecycle/renewal.ts
generateDueRenewalInvoices(db, now): Promise<{ scanned, generated }>
  // active 服务 next_due_date 在 [now, now+leadDays] 内 且无未付 renewal 账单 → createInvoiceWithItems(type=renewal) + 站内信/邮件
applyRenewalPayment(tx, serviceId, cycle): Promise<void>  // next_due_date = addCycle(max(today, next_due_date), cycle)；suspended_overdue → active（并建 unsuspend 任务）
payRenewalInvoice(db, userId, invoiceId, cycle?): 复用 payInvoiceWithBalance + applyRenewalPayment

// lifecycle/overdue.ts
enqueueDueReminders(db, now): Promise<{sent}>     // T-14/7/3/1：active 且即将到期 → 通知（站内信+短信+邮件模板）
suspendOverdueServices(db, now, graceDays=3): Promise<{suspended}>   // next_due_date < today-graceDays 的 active → 调度 suspend 任务
terminateOverdueServices(db, now, terminateDays=15): Promise<{terminated}>  // suspended_overdue 超过终止阈值 → terminate 任务（先发最终提醒）
closeStalePaymentIntents(db, now, minutes=30): Promise<{closed}>    // created/paying 且 expires_at < now → expired，释放库存（仅含 pending 订单）

// upgrade/prorata.ts（P0 基础版）
quoteUpgrade(db, service, targetProductId, now):
  Promise<{ creditFromOld, newFirstAmount, payable, preview }>
  // creditFromOld = floor(renewalAmount × 剩余天数 / 周期总天数)；newFirstAmount = 目标商品同周期 firstPrice+setupFee
  // payable = max(0, newFirstAmount - creditFromOld)
createUpgradeOrder(db, user, serviceId, targetProductId): Promise<CheckoutResult 类似>
  // 建单后 markOrderPaid(upgrade) → change_package 任务（供应模块 changePackage）；成功后 core 回调更新 service 的 productId/renewalAmount/nextDueDate 不变，差价 creditFromOld 若 > payable 且 newFirstAmount < creditFromOld → 余额入账 upgrade_refund

// lifecycle/service-actions.ts
createServiceFromOrderItem(tx, { order, item, product }): Promise<Service>
  // name = `${product.name} #${seq}`；status=pending；cycle/firstAmount/renewalAmount 取自 item.meta
  // nextDueDate = 服务创建日（开通成功时由 runner 重算 addCycle(today, cycle)）
createProvisionTask(db, { serviceId, orderId?, action, payload?, createdById? }): Promise<ProvisionTask>
updateServiceStatus(db, serviceId, status, extra?): 审计封装

// events.ts
EVENT_NAMES = { orderPaid: "order.paid", invoicePaid: "invoice.paid", serviceProvisionRequested: "service.provision_requested", serviceActivated: "service.activated", serviceSuspended: "service.suspended", serviceTerminated: "service.terminated", provisionTaskFailed: "provision.task_failed", ticketReplied: "ticket.replied" } as const
emitEvent(db, name, payload): Promise<void>   // 写队列入队（notify/provision 消费）

// queue.ts
type JobHandler = (data: any) => Promise<void>
registerJobHandler(job: string, handler: JobHandler): void
enqueueJob(job: string, data: unknown, opts?: { delayMs?: number; jobId?: string; attempts?: number }): Promise<void>
  // REDIS_URL 存在 → BullMQ add 到队列 `phj`（attempts 默认 5，指数退避）
  // 否则 → inline 降级：setImmediate 执行 registerJobHandler 注册的 handler，异常仅记日志
processEnvelopedJob(...)                      // worker 侧统一分发到 registerJobHandler 的 handler
```

**core 测试（Vitest，`packages/core/tests/`）**：money、addCycle（月末/闰年/跨年）、daysBetween、quoteProduct 选项计价（mock db 或抽纯函数 validateSelection）、promo 折扣边界（percent/fixed/minAmount/不叠加）、prorata 折算、creditLedger 借贷平衡（纯函数部分）。DB 相关逻辑抽成「纯计算 + IO 薄层」以便测试。目标：纯函数覆盖 ≥ 90%。

### 2.2 @pinhaoji/auth

```ts
// password.ts
hashPassword(pw): Promise<string>            // @node-rs/argon2 argon2id 默认参数
verifyPassword(hash, pw): Promise<boolean>

// crypto.ts
randomToken(bytes=32): string                // base64url
sha256hex(s): string
aesEncrypt(plaintext): string                // APP_KEY 前 32 字节 base64 解码为 key，AES-256-GCM，输出 iv.tag.ct 的 base64
aesDecrypt(payload): string
maskPhone(p): string  maskEmail(e): string   // 138****1234 / a***@b.com

// session.ts
createPortalSession(db, userId, { ip, ua }): Promise<{ token, expiresAt }>
  // token=randomToken；sessions.id=sha256hex(token)；TTL 30 天滑动
resolvePortalSession(db, token): Promise<User | null>   // 校验过期/revoked；lastSeen 更新（每小时节流）
revokePortalSession(db, token) / revokeAllPortalSessions(db, userId)

// admin-auth.ts
adminLogin(db, username, password, { ip, ua }): Promise<{ admin, token, expiresAt, permissions: PermissionKey[], isSuper }>
resolveAdminSession(db, token): Promise<{ admin, permissions, isSuper } | null>
revokeAdminSession(db, token)

// sms-code.ts
issueSmsCode(db, { phone, purpose, ip, send: (phone, text) => Promise<void> }): Promise<{ ok: true }>
  // 限流：同号 1 条/分钟、5 条/天；同 IP 20 条/小时（经 core 限流工具或本地实现）
  // code=6位数字，sha256 存 smsCodes，TTL 5 分钟；发短信（注入 sender，避免依赖 notifications 包）
verifySmsCode(db, { phone, purpose, code }): Promise<boolean>  // attempts<5；成功标记 used

// account-service.ts（门户账户用例）
registerOrLoginBySms(db, { phone, name?, ip }): Promise<User>       // 存在即登录，不存在创建（createdIp）
registerByEmail(db, { email, password, name?, ip }): Promise<User>  // 邮箱查重 AUTH_EMAIL_EXISTS
authenticatePassword(db, login, password): Promise<User>            // login=手机号或邮箱；失败 AUTH_INVALID_CREDENTIALS
requestPasswordReset(db, { phone?, email?, sendSms?, sendEmail? }): Promise<void>  // 生成一次性 token（15 分钟）
resetPasswordBySms(db, { phone, code, password }) / resetPasswordByToken(db, { token, password })
changePassword(db, userId, current, next) / bindPhone(db, userId, { phone, code, password? })
// 以上改密成功后 revokeAllPortalSessions（保留当前 session 由 api 层处理：传入 keepToken?）

// rate-limit.ts
checkRateLimit(key: string, { limit, windowSec }): Promise<{ ok, retryAfterSec? }>
  // Redis INCR+EXPIRE（getRedis()）；无 Redis → 进程内 Map 滑动窗口
enforceRateLimit(key, opts): Promise<void>  // 超限抛 AppError(RATE_LIMITED, 含 retryAfter)
```

### 2.3 @pinhaoji/notifications

```ts
// providers/email.ts
sendEmail(to, subject, html): Promise<{ ok, provider: "smtp"|"mock", messageId?, error? }>
  // SMTP_* 环境变量齐全 → nodemailer；否则 mock（log.info 记录"邮件(mock)"，返回 ok=true）

// providers/sms.ts
sendSms(phone, text): Promise<{ ok, provider: "aliyun"|"mock", messageId?, error? }>
  // SMS_PROVIDER=aliyun 且 ALIYUN_SMS_* 齐全 → 官方 @alicloud/dysmsapi20170525 + @alicloud/openapi-client
  // 否则 mock（log 记录，ok=true）。P0 短信正文直接文本（模板变量渲染后）。

// send.ts
renderTemplate(body: string, vars: Record<string, string|number>): string   // {{user.name}} 占位替换，缺失替换为 ""
sendNotification(db, { userId?, channel: "email"|"sms"|"inapp", event, target?, vars, title? }): Promise<void>
  // 查 notificationTemplates(channel,event,active) ；无模板→log 跳过
  // email: subject=renderTemplate(subject) html=renderTemplate(body)；目标默认 user.email
  // inapp: 插入 userNotifications（title=rendered subject 或 title，body=rendered body）
  // 每次写 notificationLogs（含失败）；发送失败仅记日志不抛（通知不阻断主流程）
notifyUserAllChannels(db, { user, event, vars }): Promise<void>
  // 对 email/sms/inapp 三通道各调 sendNotification（目标取 user.email/phone）
```

**种子模板事件清单**（seed 用，zh 文案）：
`user.registered`, `invoice.created`, `invoice.paid`, `invoice.reminder`, `invoice.overdue`, `service.activated`, `service.suspend_warning`, `service.suspended`, `service.terminated`, `renewal.created`, `ticket.replied`, `ticket.created_admin`, `credit.recharged`, `refund.completed`, `admin.task_failed`

### 2.4 @pinhaoji/payments

```ts
// types.ts
interface CreatePaymentInput { outTradeNo: string; amountFen: number; subject: string; returnUrl: string; notifyUrl: string; }
interface CreatePaymentResult { payUrl?: string; qrCode?: string; prepayId?: string; raw?: Record<string, unknown> }
interface QueryResult { paid: boolean; gatewayTxnId?: string; amountFen?: number; raw?: Record<string, unknown> }
interface RefundInput { gatewayTxnId: string; outRefundNo: string; amountFen: number; reason?: string }
interface RefundResult { ok: boolean; gatewayRefundId?: string; error?: string }
interface CallbackVerifyResult {
  ok: boolean; eventId: string; type: string; payload: Record<string, unknown>;
  outTradeNo?: string; gatewayTxnId?: string; amountFen?: number;
}
interface PaymentGateway {
  code: "alipay" | "wechat" | "mock";
  isConfigured(): boolean;
  createPayment(input): Promise<CreatePaymentResult>;
  query(outTradeNo): Promise<QueryResult>;
  refund(input): Promise<RefundResult>;
  verifyCallback(headers: Record<string,string>, rawBody: string, query: Record<string,string>): CallbackVerifyResult;
}
createGateways(db): Promise<Record<PaymentGatewayCode, PaymentGateway | undefined>>
  // 读 settings 表 `payment.gateways`（JSON；敏感字段 {"__enc":true,"v":"<aes>"} 用 core crypto 解密）
  // mock 网关始终注册；alipay/wechat 配置缺失时 undefined

// mock.ts：isConfigured()=true；createPayment 返回 payUrl=`{PORTAL_URL}/pay/mock?no={outTradeNo}`；query 读 data 内联（见下）
//   mock 的「支付成功」由 API 的 dev 端点触发：enqueueJob("payment.callback", {...})，verifyCallback 校验 payload 结构。
// alipay.ts：**官方 alipay-sdk**（^4.14.0，支付宝官方维护）。enable 当面付 precreate（qrCode）+ page.pay（payUrl）。异步通知 verifyCallback 用 sdk checkNotificationSign；eventId=gateway_txn_id+trade_status。
// wechat.ts：**官方 wechatpay-axios-plugin**（微信支付 APIv3 官方组织 wechatpay-apiv3 维护，npm 安装）
//   —— Native 下单（qrCode）、关单、查单、退款、回调验签与 resource 解密均用该 SDK；
//   若该包在安装/类型上确不可用，才允许降级为 node:crypto 自实现 v3 客户端并留 TODO 注明原因。
// 可扩展性（硬性要求）：
//   1) registry.ts 除 createGateways(db) 外必须导出 registerGateway(gateway: PaymentGateway): void
//      —— 新增网关 = 新文件实现 PaymentGateway 接口 + registerGateway 注册，不修改任何既有网关代码；
//   2) 网关配置全部来自 settings 表 `payment.gateways`（key=网关 code），业务代码不感知具体通道；
//   3) 新通道接入文档写入 packages/payments/README.md（接口、ack 格式、回调幂等约定）。

// callback-service.ts
handleGatewayCallback(db, code, { headers, rawBody, query }): Promise<{ status: 200|401|404, body: string }>
  // 1) verifyCallback 失败 → 记 gatewayEvents(status=received,error) 返回 401
  // 2) INSERT gateway_events (唯一键冲突 → duplicate，直接返回 ack 200)
  // 3) enqueueJob("payment.process_event", { eventId })；立即返回网关要求的 ack（支付宝 "success"，微信 {"code":"SUCCESS"}）
processPaymentEvent(db, eventId): Promise<void>   // worker/inline 调用
  // 读 event → outTradeNo=PI{intentId} → 意图存在且状态 created/paying
  // 金额校验：amountFen !== intent.amount → event=failed + log.error + 站内告警（不标记支付）
  // 事务：插入 transactions(success)（唯一键兜底幂等）→ markInvoicePaid → markOrderPaid → intent=success
  // 全部幂等：重复处理安全（唯一键 + markInvoicePaid 幂等）
queryAndSettleStaleIntents(db, now): Promise<{settled}>   // 掉单补偿：paying 状态未过期 intent 主动查网关
createRefund(db, adminId, { transactionId, amount, reason }): Promise<Refund>
  // 财务权限；调用网关 refund；成功 → refunds=succeeded + transactions 关联状态 + invoice 部分退款标记 + 通知
```

### 2.5 @pinhaoji/provisioning

```ts
// types.ts
interface ModuleCtx { db: Db; logger: Logger }
interface ModuleResult { ok: boolean; manual?: boolean; deliverInfo?: Record<string, unknown>; message?: string; raw?: Record<string, unknown> }
interface ProvisionModule {
  code: string; name: string;
  testConnection(config): Promise<{ ok: boolean; message?: string }>;
  provision(ctx, service): Promise<ModuleResult>;
  suspend(ctx, service): Promise<ModuleResult>;
  unsuspend(ctx, service): Promise<ModuleResult>;
  terminate(ctx, service): Promise<ModuleResult>;
  changePackage(ctx, service, target: { productId: number; cycle: BillingCycle; config: Record<string, unknown> }): Promise<ModuleResult>;
}
getModule(code: string): ProvisionModule | undefined   // registry：manual/http-api/demo

// modules/manual.ts：所有动作返回 { ok: true, manual: true }（任务标记 succeeded，服务状态由后台人工操作推进）
// modules/demo.ts：provision → { ok: true, deliverInfo: { ip: "10.0.0.<rand>", rootPassword: "<rand>" } }；suspend/unsuspend/terminate → ok；changePackage → ok
// modules/http-api.ts：config = { baseUrl, apiKey?, hmacSecret?, timeoutMs?, actions: { [action]: { method, path, bodyTemplate } } }
//   bodyTemplate 支持 {{service.field}} 与 {{config.xxx}} 占位；响应要求 JSON { ok: true }（2xx 且 ok!==false）
//   hmacSecret 存在时请求头 X-Sign = hex(hmac-sha256(secret, method+path+body))、X-Timestamp

// runner.ts
runProvisionTask(db, taskId): Promise<void>
  // 原子领取：UPDATE status=processing, attempts=attempts+1 WHERE id=? AND status IN ('queued','failed')
  // 按 service.moduleCode 取模块执行对应 action
  // ok：task=succeeded(executedAt,result)；action 分支：
  //   provision → service active + next_due_date=addCycle(today,cycle) + deliverInfo + emit service.activated
  //   suspend → suspended_overdue/manual + emit；unsuspend → active + next_due_date 补 addCycle(today,cycle) + emit
  //   terminate → terminated + terminatedAt + emit；change_package → 应用 target 配置 + renewalAmount 重算
  // !ok：attempts>=maxAttempts → task=dead + emit provision.task_failed + 告警；否则 task=failed（等待退避重试）
retryTask(db, taskId) / skipTask(db, taskId, reason) / manuallyCompleteProvision(db, adminId, serviceId, { deliverInfo, activate: true })
  // manual 模块配套：后台「标记已开通」→ service active + next_due_date + deliverInfo
processQueuedTasks(db, limit=50): Promise<{processed, succeeded, failed}>   // cron 兜底扫描
```

## 3. 队列与定时任务

**队列名**：统一 `phj`（BullMQ），job 类型区分：`payment.process_event`、`provision.task`（data={taskId}）、`notify.user`（data={userId, event, vars}）、`provision.retry`（delay 退避）。

**Worker 定时任务**（BullMQ repeatable cron + `job_runs` 记录；无 Redis 时 `pnpm --filter worker task <name>` 可手动执行）：

| 任务名 | cron | 调用 |
| --- | --- | --- |
| renewal.invoices | 0 3 * * * | core.generateDueRenewalInvoices |
| service.reminders | 0 9 * * * | core.enqueueDueReminders |
| service.suspend_overdue | 0 4 * * * | core.suspendOverdueServices + provisioning 建任务 |
| service.terminate_overdue | 30 4 * * * | core.terminateOverdueServices |
| payment.close_stale | * * * * * | core.closeStalePaymentIntents |
| payment.reconcile | 15 * * * * | payments.queryAndSettleStaleIntents |
| provision.retry_scan | */10 * * * * | core.processQueuedTasks（failed 退避重投 + 兜底） |
| system.cleanup | 30 2 * * 0 | 清理过期 sessions/sms_codes/password_reset_tokens（>90 天日志除外） |
| system.job_health | 0 7 * * * | 汇总昨日 job_runs → 告警（钉钉/飞书 webhook 环境变量 ALERT_WEBHOOK_URL） |

每个任务包装 `runTask(name, fn)`：记录 startedAt/finishedAt/job_runs(status/result/error)；失败不中断进程。`apps/worker/src/run-task.ts`：`tsx src/run-task.ts <taskName>` 直接执行（无 Redis 也能跑）。

## 4. API 端点清单

前缀 `/api/v1`。认证：门户 `phj_session` Cookie；后台 `phj_admin` Cookie；webhooks/public 无 Cookie。**写操作统一校验 `Origin` 头**（CORS_ORIGINS 内）防 CSRF。错误体 = `errorResponseSchema`；成功直接返回资源 JSON；列表用 `paginated()`。

### public（限流：IP 60/min）
- `GET /catalog` → productGroupDto[]（active 且 !hidden，含 pricing+configGroups+options）
- `GET /settings` → { siteName, announcement, paymentMethods: string[] }

### webhooks
- `POST /webhooks/alipay`、`POST /webhooks/wechat` → handleGatewayCallback（应答各自网关 ack 格式）

### portal/auth（限流：登录 10/15min/IP+账号，验证码 5/min/IP）
- `POST /auth/sms/send` smsSendSchema
- `POST /auth/sms/login` smsLoginSchema → authResultSchema（Session Cookie）
- `POST /auth/register` emailRegisterSchema；`POST /auth/login` passwordLoginSchema
- `POST /auth/logout`；`GET /auth/me` → authResultSchema
- `POST /auth/forgot-password`；`POST /auth/reset-password/sms`；`POST /auth/reset-password/token`
- `POST /auth/change-password`；`POST /auth/bind-phone`

### portal/account（需登录）
- `GET|PUT /account/profile`；`GET /account/sessions`；`DELETE /account/sessions/:id`；`DELETE /account/sessions` (全部，保留当前)
- `GET /account/identity`；`POST /account/identity`（type/realName/idNumber 或 companyName/creditCode → AES 加密落库，status=pending；后台审核）

### portal/business（需登录）
- `GET /cart` → cartQuoteSchema（购物车存 DB `sessions` 之外单独表？否 —— P0 存 **服务端 JSON**：新表 `carts(user_id PK, items json)`。**由 API agent 在 packages/db/src/schema/orders.ts 追加该表并重新生成迁移**）
- `POST /cart/items` addToCartSchema；`PATCH /cart/items/:itemId` updateCartItemSchema；`DELETE /cart/items/:itemId`
- `GET /cart/quote?promoCode=` → cartQuoteSchema
- `POST /checkout` checkoutSchema → checkoutResultSchema
- `GET /orders`、`GET /orders/:id` → orderDto（paginated）
- `GET /invoices`、`GET /invoices/:id` → invoiceDto
- `POST /invoices/:id/pay` { gateway?: "alipay"|"wechat", useBalance?: bool } → { paid, payUrl?, qrCode?, intentId? }
  （useBalance=true → payInvoiceWithBalance；金额 0 直接标记已付）
- `GET /credits` → { balance, ledger: paginated(creditLedger) }
- `POST /credits/recharge` { amount(分, ≥100, ≤10000000) } → 充值 invoice+intent → { payUrl?, intentId }
- `GET /services`、`GET /services/:id` → serviceDto
- `POST /services/:id/renew` { cycle } → { invoiceId, amount }
- `POST /services/:id/upgrade` { targetProductId } → upgradeQuoteSchema（confirm=false）；confirm=true → 建单
- `POST /services/:id/cancel` { when: "now"|"period_end" }（now→管理员复核终止任务；period_end→标记到期取消）
- `GET /departments`；`GET /tickets`、`POST /tickets` ticketCreateSchema、`GET /tickets/:id`、`POST /tickets/:id/reply`、`POST /tickets/:id/close`
- `POST /tickets/:id/attachments` multipart（≤5MB，白名单 png/jpg/jpeg/pdf/zip/txt）
- `GET /notifications`；`POST /notifications/read` { ids?: number[], all?: bool }
- 开发辅助（仅 NODE_ENV!=production 且 DEV_MOCK_PAYMENTS=true）：`POST /dev/mock-pay/:invoiceNo` → 触发 mock 网关成功回调

### admin（需管理员 + 权限点）
- `POST /auth/login`；`POST /auth/logout`；`GET /auth/me` → { admin, permissions, isSuper }
- `GET /dashboard` → dashboardDto
- `GET /customers` (q/页面) paginated(脱敏)；`GET /customers/:id`（含 services/orders/invoices/ledger 汇总）；`POST /customers/:id/status` { status }；`POST /customers/:id/credit` creditAdjustSchema（权限 customers.credit）
- `GET /orders`；`POST /orders/:id/mark-paid`（人工确认收款→markInvoicePaid+markOrderPaid，权限 invoices.manage）；`POST /orders/:id/cancel`
- `GET /services`；`POST /services/:id/action` serviceActionSchema（权限 services.manage，建 provision 任务）；`POST /services/:id/manual-complete` { deliverInfo }；`PATCH /services/:id` { name? }
- `GET /tasks` (status/action 筛选)；`POST /tasks/:id/retry`；`POST /tasks/:id/skip`（权限 tasks.manage）
- `GET /invoices`；`POST /invoices` invoiceCreateSchema（手工开单）；`POST /invoices/:id/void` { reason }
- `GET /transactions`；`GET /refunds`；`POST /refunds` refundCreateSchema（权限 refunds.manage）
- `GET|POST /product-groups`、`PUT|DELETE /product-groups/:id`；`GET|POST /products`、`GET|PUT|DELETE /products/:id`（productUpsertSchema 整体保存 pricing；configGroups/options 独立端点 `POST /products/:id/config-groups`、`PUT|DELETE /config-groups/:id`、`POST /config-groups/:id/options`、`PUT|DELETE /config-options/:id`）
- `GET|POST /promotions`、`PUT|DELETE /promotions/:id`（promoUpsertSchema）
- `GET /tickets`（status/department 筛选）；`GET /tickets/:id`（含 internal notes）；`POST /tickets/:id/reply` { contentHtml, internalNote? }；`POST /tickets/:id/status` { status }
- `GET|POST /departments`、`PUT /departments/:id`
- `GET|POST /templates`、`PUT /templates/:id`（notificationTemplates；body 支持 {{vars}}）
- `GET /audit-logs`（action/actor/date 筛选，权限 audit.read）
- `GET|PUT /settings`（权限 settings.manage；PUT settingsUpsertSchema；敏感值 AES 加密存储、读取脱敏）
- `GET|POST /admins`、`PUT /admins/:id`；`GET|POST /roles`、`PUT /roles/:id`（权限 admins.manage）
- `POST /reconcile/run`（手动触发掉单补偿）

**权限映射**：读类端点用对应 `*.read`；写类用 `*.manage`；余额 `customers.credit`；退款 `refunds.manage`；isSuper 全通过。

### admin 前端（Ant Design Pro）对接约定

- 脚手架：`apps/admin` 使用 Ant Design Pro（umi max）。删除默认 mock 数据与演示页，保留框架布局。
- `config/proxy.ts`：开发代理 `/api` → `http://localhost:4000`（免去 CORS）；或直接 `request` 设 baseURL=http://localhost:4000 + `credentials: 'include'`（二选一，代理优先）。
- 登录：`POST /api/v1/admin/auth/login`（adminLoginSchema）→ `app.tsx` 的 `login` 流程；`getInitialState` 调 `GET /api/v1/admin/auth/me` 拿 `{ admin, permissions, isSuper }`，映射为 Pro `currentUser`（name=admin.name/username）。
- 权限：`access.ts` 把 contracts 的 PermissionKey 展开成 `canXxx` 布尔（isSuper 全 true），菜单/按钮用 `access` 插件控制；菜单在 `config/routes.ts` 按本 SPEC §4 admin 端点清单组织。
- 请求约定：`src/requestErrorConfig.ts` 处理 errorResponseSchema（{code,message,requestId}）——`PERM_DENIED`→403 提示、`AUTH_SESSION_EXPIRED`→跳登录、其余 antd message 提示。
- 页面：§4 admin 清单全覆盖，列表页一律 ProTable（服务端分页 `params.page/pageSize`，响应 `{items,total}` 需适配），表单一律 ProForm/ModalForm/DrawerForm；危险操作（作废、终止、退款、余额调整）用 ModalForm 二次确认。
- 不引入额外 UI 库；中文 locale（zh-CN）。

### 安全中间件（api agent 实现，apps/api/src/middleware/）
- `requestId`：每请求生成 `req_xxx`，挂 c.set + 响应头 X-Request-Id，贯穿日志。
- `errorHandler`：AppError→对应 status+错误体；zod 校验错误→VALIDATION_FAILED(400, details 含 issues)；未知→500 INTERNAL（不泄栈）。
- `rateLimit`：基于 auth/rate-limit；按路由组配置。
- `requireAuth` / `requireAdmin(perm?)`：读 Cookie→resolveSession→c.set("user")；失败 401。
- `originCheck`：POST/PUT/PATCH/DELETE 校验 Origin ∈ CORS_ORIGINS（同源部署时放行无 Origin）。
- `securityHeaders`：X-Content-Type-Options、Referrer-Policy、X-Frame-Options、CSP（API 简单版）。

## 5. 环境变量（.env.example 汇总）

```text
DATABASE_URL=mysql://user:pass@host:3306/pinhaoji
REDIS_URL=redis://host:6379/0        # 可选；缺省用内存降级（限流）与 inline 队列
APP_KEY=<base64 32 字节，AES 主密钥>
API_PORT=4000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:8000
COOKIE_DOMAIN=                       # 生产 .pinhaoji1.cn
PORTAL_URL=http://localhost:3001
ADMIN_URL=http://localhost:8000
WWW_URL=http://localhost:3000
DEV_MOCK_PAYMENTS=true
SMS_PROVIDER=mock                    # mock | aliyun
ALIYUN_SMS_ACCESS_KEY_ID= / SECRET= / SIGN_NAME= / TEMPLATE_CODE=
SMTP_HOST= / SMTP_PORT=587 / SMTP_USER= / SMTP_PASS= / SMTP_FROM=
ALERT_WEBHOOK_URL=                   # 钉钉/飞书机器人
LOG_LEVEL=info
UPLOAD_DIR=./uploads
```

支付网关配置存 settings 表 `payment.gateways`（后台可视化配置优先于环境变量）：`{ alipay: { appId, privateKey, alipayPublicKey, gateway? }, wechat: { mchid, appid, serial, privateKey, apiv3Key } }`，敏感字段 AES 加密。

## 6. Git 与交付

- 每个子任务完成后运行 `pnpm --filter <pkg> typecheck`（core 还要 `test`）确认零错误再汇报。
- 汇报格式：改动文件清单 + 关键实现决策 + 遗留问题/建议。不自行 git commit（由主控统一提交）。
- 注释与用户可见文案用中文；标识符用英文。
