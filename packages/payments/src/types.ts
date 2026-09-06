/**
 * 支付网关抽象类型（SPEC-P0 §2.4）。
 *
 * 新增网关：实现 PaymentGateway 接口后调用 registry 的 registerGateway 注册即可，
 * 无需修改任何既有网关代码；接入说明见 packages/payments/README.md。
 */

/** 内置网关 code；第三方扩展可用任意唯一字符串 code（保留内置字面量以获得提示） */
export const BUILTIN_GATEWAY_CODES = ["alipay", "wechat", "mock"] as const;
export type BuiltInGatewayCode = (typeof BUILTIN_GATEWAY_CODES)[number];
export type PaymentGatewayCode = BuiltInGatewayCode | (string & {});

export interface CreatePaymentInput {
  /** 商户订单号；本系统约定为 `PI${paymentIntentId}` */
  outTradeNo: string;
  /** 支付金额（整数分） */
  amountFen: number;
  /** 订单标题（建议使用账单号） */
  subject: string;
  /** 支付完成后的前台跳转地址 */
  returnUrl: string;
  /** 异步通知地址 */
  notifyUrl: string;
  /** 支付宝专用：当面付扫码（precreate，默认）或电脑网站支付（page） */
  method?: "precreate" | "page";
}

export interface CreatePaymentResult {
  /** 跳转支付地址（如支付宝 page.pay） */
  payUrl?: string;
  /** 二维码内容（支付宝 precreate qr_code / 微信 Native code_url） */
  qrCode?: string;
  /** 预支付标识（如微信 JSAPI prepay_id，P0 预留） */
  prepayId?: string;
  raw?: Record<string, unknown>;
}

export interface QueryResult {
  paid: boolean;
  gatewayTxnId?: string;
  amountFen?: number;
  raw?: Record<string, unknown>;
}

export interface RefundInput {
  /** 原支付交易在网关侧的单号 */
  gatewayTxnId: string;
  /** 商户退款单号（本系统约定为 `R${refundId}`） */
  outRefundNo: string;
  /** 本次退款金额（整数分） */
  amountFen: number;
  reason?: string;
  /** 原支付订单总额（微信 APIv3 退款必填；缺省按本次退款金额处理） */
  totalFen?: number;
}

export interface RefundResult {
  ok: boolean;
  gatewayRefundId?: string;
  error?: string;
}

export interface CallbackVerifyResult {
  ok: boolean;
  /** 网关事件唯一标识（用于 gateway_events 幂等去重，≤128 字符） */
  eventId: string;
  /** 事件类型（如 payment.success / payment.closed / refund.notification） */
  type: string;
  /**
   * 事件载荷。统一约定字段（processPaymentEvent 依赖）：
   * - outTradeNo / gatewayTxnId / amountFen：与顶层字段一致
   * - paid?: boolean —— 本事件是否代表支付成功
   * - closed?: boolean —— 网关侧交易已关闭/失败（意图置 failed）
   */
  payload: Record<string, unknown>;
  outTradeNo?: string;
  gatewayTxnId?: string;
  amountFen?: number;
}

export interface PaymentGateway {
  code: PaymentGatewayCode;
  /** 配置是否完整（createGateways 只装配 isConfigured 的网关） */
  isConfigured(): boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  query(outTradeNo: string): Promise<QueryResult>;
  /** 关单（可选）：网关侧关闭未支付订单（如微信 closeorder） */
  close?(outTradeNo: string): Promise<void>;
  refund(input: RefundInput): Promise<RefundResult>;
  /** 同步验签与解析：失败 ok=false（不得抛出验证失败以外的异常，抛出按验签失败处理） */
  verifyCallback(
    headers: Record<string, string>,
    rawBody: string,
    query: Record<string, string>,
  ): CallbackVerifyResult;
}

// —— settings `payment.gateways` 各网关配置结构（敏感字段以 {"__enc":true,"v":"<aes>"} 加密存储） ——

export interface AlipayGatewayConfig {
  appId: string;
  /** 应用私钥（PKCS1/PKCS8 均可，SDK 自动识别） */
  privateKey: string;
  /** 支付宝公钥（普通公钥模式，验签必填） */
  alipayPublicKey: string;
  /** 网关地址，默认官方网关 */
  gateway?: string;
  signType?: "RSA2" | "RSA";
  keyType?: "PKCS1" | "PKCS8";
  /** createPayment 默认方式：precreate（当面付扫码）| page（电脑网站支付） */
  payMethod?: "precreate" | "page";
  /** 网关超时（毫秒） */
  timeout?: number;
}

export interface WechatGatewayConfig {
  mchid: string;
  appid: string;
  /** 商户 API 证书序列号 */
  serial: string;
  /** 商户 API 私钥（PEM） */
  privateKey: string;
  /** APIv3 密钥（回调 resource 解密用） */
  apiv3Key: string;
  /** 平台证书 {证书序列号: 公钥 PEM}（平台证书模式；与 publicKey 模式二选一） */
  platformCerts?: Record<string, string>;
  /** 微信支付公钥 ID（PUB_KEY_ID_...，公钥模式） */
  publicKeyId?: string;
  /** 微信支付公钥 PEM（公钥模式） */
  publicKey?: string;
}

export interface MockGatewayConfig {
  /** 覆盖 mock 支付页地址（默认取环境变量 PORTAL_URL） */
  portalUrl?: string;
}
