# @pinhaoji/payments

支付域包：网关抽象（mock / 支付宝 / 微信）+ 回调处理管线 + 掉单补偿 + 退款。
遵循 `docs/SPEC-P0.md` §2.4；金额一律整数分；相对导入带 `.js` 后缀。

## 目录结构

```text
src/
  types.ts            # PaymentGateway 接口与各网关配置类型（扩展网关从这读契约）
  settings-crypto.ts  # settings 敏感字段 AES-256-GCM 解密（{"__enc":true,"v":"<iv:tag:ct>"}）
  registry.ts         # registerGateway（外部注册）+ createGateways/getGateway（按 settings 装配）
  mock.ts             # mock 网关（恒可用，开发/测试）
  alipay.ts           # 支付宝网关（官方 alipay-sdk ^4.14）
  wechat.ts           # 微信支付网关（官方 wechatpay-axios-plugin，APIv3）
  callback-service.ts # 回调管线：handleGatewayCallback / processPaymentEvent /
                      #   queryAndSettleStaleIntents / createRefund / registerPaymentJobHandlers
  index.ts            # 桶导出
```

## 快速上手（宿主进程，如 apps/api、apps/worker）

```ts
import { getDb } from "@pinhaoji/db/client";
import {
  createGateways,           // 按 settings 装配全部网关
  getGateway,               // 按需取单个网关
  registerGateway,          // 注册外部网关实例
  handleGatewayCallback,    // webhook 路由处理
  processPaymentEvent,
  registerPaymentJobHandlers,
  queryAndSettleStaleIntents,
  createRefund,
} from "@pinhaoji/payments";

const db = getDb();

// 进程启动时注册 job 处理器（无 Redis 时 inline 降级立即执行）
registerPaymentJobHandlers(db);

// webhook 路由（Hono 示例）
app.post("/api/v1/webhooks/alipay", async (c) => {
  const res = await handleGatewayCallback(db, "alipay", {
    headers: Object.fromEntries(c.req.raw.headers),
    rawBody: await c.req.text(),
    query: c.req.query(),
  });
  return c.text(res.body, res.status);
});
```

## 可扩展性（硬性要求）

新增网关不改任何既有代码：

1. 新文件实现 `PaymentGateway` 接口（契约见 `src/types.ts`，含回调 payload 约定）；
2. 宿主启动时 `registerGateway(myGateway)` 注册实例（显式注册优先，可覆盖同 code 内置网关）；
3. 若需走 settings 配置，在 settings `payment.gateways` 增加同 code 键值即可被
   `createGateways` 透传（内置白名单外的 code 需自行注册实例）。

```ts
// examples/stripe.ts
import type { PaymentGateway } from "@pinhaoji/payments";

export function createStripeGateway(config: { apiKey: string }): PaymentGateway {
  return {
    code: "stripe",
    isConfigured: () => Boolean(config.apiKey),
    async createPayment(input) { /* ... */ return { payUrl: "..." }; },
    async query(outTradeNo) { return { paid: false }; },
    async refund(input) { return { ok: true, gatewayRefundId: "re_..." }; },
    verifyCallback(headers, rawBody, query) {
      return { ok: true, eventId: "...", type: "payment.success", payload: { /* 含 paid:true */ } };
    },
  };
}

registerGateway(createStripeGateway({ apiKey: process.env.STRIPE_KEY! }));
```

## 网关配置（settings 表 `payment.gateways`）

值为 JSON，key = 网关 code。敏感字段以 `{"__enc":true,"v":"<aes>"}` 加密存储
（AES-256-GCM，APP_KEY 派生，格式与 @pinhaoji/auth 一致；加密用
`encryptSettingValue()`，后台设置读取侧负责加密落库）。缺失 `__enc` 包裹的字符串按明文处理。

```jsonc
{
  "alipay": {
    "appId": "2021xxxxxx",
    "privateKey": "<应用私钥，加密存储>",        // PKCS1/PKCS8 均可
    "alipayPublicKey": "<支付宝公钥，加密存储>",  // 普通公钥模式，异步通知验签必填
    "gateway": "https://openapi.alipay.com/gateway.do", // 可选
    "payMethod": "precreate"                    // 可选：precreate(默认,当面付扫码) | page(电脑网站)
  },
  "wechat": {
    "mchid": "1900xxxxxx",
    "appid": "wx????" ,
    "serial": "<商户API证书序列号>",
    "privateKey": "<apiclient_key.pem 内容，加密存储>",
    "apiv3Key": "<APIv3 密钥，加密存储>",
    // 平台验签密钥二选一（回调验签 + API 应答验签共用）：
    "platformCerts": { "<平台证书序列号>": "<平台证书公钥 PEM，加密存储>" }, // 平台证书模式
    "publicKeyId": "PUB_KEY_ID_xxxx",          // 或 微信支付公钥模式（2024 起新商户）
    "publicKey": "<微信支付公钥 PEM，加密存储>"
  },
  "mock": { "portalUrl": "http://localhost:3001" } // 可省略，默认取 PORTAL_URL
}
```

装配规则（`createGateways(db)`）：

- 内置网关按 settings key 装配；alipay/wechat 配置缺失或不完整 → 该 code 为 `undefined`；
  配置项含 `"enabled": false` 时跳过装配（mock 不受此开关影响，恒可用）；
- `mock` 恒可用（无配置也注册）；
- `registerGateway` 注册的外部实例最后覆盖（显式注册优先）；
- 网关实例不含连接/会话状态，settings 变更后重新调用 `createGateways` 即可刷新。

## PaymentGateway 接口契约

| 成员 | 说明 |
| --- | --- |
| `code` | 网关唯一标识（内置：`alipay` / `wechat` / `mock`） |
| `isConfigured()` | 配置是否完整；`createGateways` 只装配完整配置的网关 |
| `createPayment(input)` | 返回 `{ payUrl? }`（跳转）或 `{ qrCode? }`（二维码）；`input.outTradeNo` 约定为 `PI${paymentIntentId}`；`subject` 建议用账单号 |
| `query(outTradeNo)` | 主动查单（掉单补偿用），返回 `{ paid, gatewayTxnId?, amountFen? }` |
| `close?(outTradeNo)` | 可选关单（微信已实现） |
| `refund(input)` | 原路退款；`input.totalFen` 为原单总额（微信 APIv3 必填）；受理成功即返回 `ok:true`（终态以网关回调/查单为准） |
| `verifyCallback(headers, rawBody, query)` | **同步**验签 + 解析。失败 `ok:false`（不得抛异常，抛出按验签失败处理）；成功返回事件标识与业务字段 |

### 回调 payload 约定（processPaymentEvent 依赖）

`verifyCallback` 成功时 payload 必须携带：

- `outTradeNo` / `gatewayTxnId` / `amountFen`（整数分）——同时提升到结果顶层字段；
- `paid: boolean` —— 本事件代表支付成功（支付宝 `TRADE_SUCCESS/TRADE_FINISHED`、
  微信 `TRANSACTION.SUCCESS` 且 `trade_state=SUCCESS`）；
- `closed: boolean`（可选）—— 网关侧交易已关闭/失败（意图置 `failed`，可重新发起支付）；
- 其余字段（如 `tradeStatus` / `tradeState`）原样透传，仅审计用。

### 回调事件 ID（幂等键）

`gateway_events` 表唯一键 `(gateway_code, event_id)`：

- 支付宝：`${trade_no}:${trade_status}:${gmt_payment}`
- 微信：`${transaction_id}:${trade_state}`
- mock：`${gatewayTxnId}`（dev 端点重放同一回调天然去重）

同一事件重放 → INSERT 唯一键冲突 → 仍返回网关 ack（已 processed 的事件行标记 `duplicate`）。

## 回调处理流程（`handleGatewayCallback`）

1. 取网关（未配置/未知 code → `404`）；
2. `verifyCallback` 失败 → 记 `gateway_events(status=received, error)` → `401`；
3. 成功 → INSERT `gateway_events(status=received)`；唯一键冲突 → 重复回调 → 直接 ack；
4. `enqueueJob("payment.process_event", { eventId: <gateway_events.id> })`；
5. 立即返回 ack：支付宝纯文本 `success`；微信 `{"code":"SUCCESS"}`
   （失败分别返回 `failure` / `{"code":"FAIL",...}`）。

## 事件结算（`processPaymentEvent(db, eventId)`）

- 事件 `processed`/`duplicate` → 短路（幂等）；
- `outTradeNo` 解析为 `PI{id}` → 意图不存在/状态非 `created|paying` → 事件 `failed`（人工核实）；
- 金额不符（`amountFen !== intent.amount`）→ 事件 `failed` + `log.error` +
  `payment.alert` 领域事件告警，**不标记支付**；
- `paid=false`：`closed=true` → 意图置 `failed`；中间态 → 仅标记事件 processed；
- `paid=true` → 事务：INSERT `transactions(success)`（唯一键
  `(gateway_code, gateway_txn_id)` 兜底并发/重复）→ `markInvoicePaid` →
  `markOrderPaid`（有订单时）→ 意图 `success` → 事件 `processed`。

## 掉单补偿（`queryAndSettleStaleIntents(db, now)`）

扫描 `paying` 且未过期的支付意图 → 网关查单 → 已支付则构造
`reconcile:{intentId}:{gatewayTxnId}` 事件走 `processPaymentEvent` 同一结算路径。
worker 定时任务 `payment.reconcile`（cron `15 * * * *`）调用。

## 退款（`createRefund(db, adminId, { transactionId, amount, reason })`）

1. 事务：`SELECT ... FOR UPDATE` 锁原交易（须 `type=payment` 且 `status=success`）→
   累计可退额度校验 → INSERT `refunds(status=pending)`（退款单号约定 `R{refundId}`）；
2. 调用 `gateway.refund`（事务外）；失败 → 退款单置 `failed` 并抛 `PAY_GATEWAY_ERROR`；
3. 成功 → `refunds=succeeded + gateway_refund_id` → 全额退完时 `transactions=refunded` →
   invoice 聚合（`partially_refunded` / `refunded`）→ `emitEvent("refund.completed", ...)`。

权限点（`refunds.manage`）由 API 层校验，本包只做业务与额度校验。

## mock 网关

- `createPayment` 返回 `payUrl = {PORTAL_URL}/pay/mock?no={outTradeNo}`；
- 「支付成功」由 API dev 端点（仅非生产且 `DEV_MOCK_PAYMENTS=true`）触发：
  `handleGatewayCallback(db, "mock", { rawBody: JSON.stringify({ outTradeNo, gatewayTxnId, amountFen }) })`；
  `verifyCallback` 校验三字段齐全即通过（`paid:true`）；
- `query` 恒 `paid:false`（无真实网关状态，掉单补偿自动跳过）；`refund` 恒成功。

## 内置网关实现要点

### 支付宝（alipay-sdk ^4.14.0，官方 SDK）

- `precreate`（当面付，返回 `qr_code`）与 `page.pay`（电脑网站，返回跳转 URL）两种
  `createPayment`，settings `payMethod` 或入参 `method` 选择；
- 异步通知验签：`checkNotifySignV2`（解码值）与 `checkNotifySign`（原始值）双路尝试，
  并校验通知 `app_id` 归属；仅 `TRADE_SUCCESS/TRADE_FINISHED` 记 `paid`；
- 查单 `alipay.trade.query`、退款 `alipay.trade.refund`（响应验签开启）。

### 微信（wechatpay-axios-plugin ^0.9，wechatpay-apiv3 生态官方客户端）

- Native 下单 `/v3/pay/transactions/native`（`code_url` → qrCode）、关单、
  `/v3/pay/transactions/out-trade-no/{no}` 查单、`/v3/refund/domestic/refunds` 退款；
- 回调验签：`Wechatpay-Signature/Timestamp/Nonce/Serial` 头 + 平台证书/微信支付公钥
  （按 Serial 匹配，唯一密钥时告警回退）`Rsa.verify`；resource 用 `apiv3Key`
  `Aes.AesGcm.decrypt` 解密；仅 `trade_state=SUCCESS` 记 `paid`，
  `CLOSED/REVOKED/PAYERROR` 记 `closed`。
