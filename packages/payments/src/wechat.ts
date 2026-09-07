/**
 * 微信支付网关（官方 APIv3 客户端 wechatpay-axios-plugin，wechatpay-apiv3 生态维护）。
 *
 * - createPayment：Native 下单（/v3/pay/transactions/native，返回 code_url 二维码）；
 * - query：/v3/pay/transactions/out-trade-no/{no}；trade_state=SUCCESS 视为已支付；
 * - 关单：/v3/pay/transactions/out-trade-no/{no}/close（供后续关单流程使用）；
 * - refund：/v3/refund/domestic/refunds（transaction_id 原单号 + out_refund_no）；
 * - verifyCallback：Wechatpay-* 请求头 + 平台证书/微信支付公钥（Wechatpay-Serial 匹配）
 *   验签（Rsa.verify），resource 用 apiv3Key AES-256-GCM 解密（Aes.AesGcm.decrypt）；
 *   eventId = `${transaction_id}:${trade_state}`。
 *
 * 平台密钥说明：微信支付 2024 起新商户默认只发「微信支付公钥」（publicKeyId/publicKey），
 * 存量商户用平台证书（platformCerts）。两者二选一，回调验签按 Wechatpay-Serial 头匹配。
 */

import { createHash, createPublicKey, createPrivateKey, type KeyObject } from "node:crypto";
import { Aes, Formatter, Rsa, Wechatpay } from "wechatpay-axios-plugin";
import { AppError, appError } from "@qmkvm/core";
import { logger } from "@qmkvm/logger";
import type {
  CallbackVerifyResult,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
  QueryResult,
  RefundInput,
  RefundResult,
  WechatGatewayConfig,
} from "./types.js";

const log = logger.child({ module: "payments:wechat" });

/** 微信支付 Native 下单应答 */
interface NativePayResponse {
  code_url?: string;
}

/** 查单/回调 resource（支付单）字段 */
interface WechatTransaction {
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  trade_type?: string;
  mchid?: string;
  amount?: { total?: number; payer_total?: number; currency?: string };
  [key: string]: unknown;
}

/** 退款应答字段 */
interface WechatRefund {
  refund_id?: string;
  out_refund_no?: string;
  status?: string;
  [key: string]: unknown;
}

/** 回调通知外层结构 */
interface WechatNotification {
  id?: string;
  event_type?: string;
  summary?: string;
  resource?: {
    original_type?: string;
    algorithm?: string;
    ciphertext?: string;
    associated_data?: string;
    nonce?: string;
  };
  [key: string]: unknown;
}

/** 视为交易关闭/失败的 trade_state */
const CLOSED_TRADE_STATES = new Set(["CLOSED", "REVOKED", "PAYERROR"]);

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** 补全 PEM 头尾（兼容只存 base64 裸体的配置） */
function normalizePem(key: string, type: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const trimmed = key.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed;
  const body = trimmed.replace(/\s+/g, "");
  return `-----BEGIN ${type}-----\n${body}\n-----END ${type}-----`;
}

function toPrivateKey(pem: string): KeyObject {
  return createPrivateKey(normalizePem(pem, "PRIVATE KEY"));
}

function toPublicKey(pem: string): KeyObject {
  return createPublicKey(normalizePem(pem, "PUBLIC KEY"));
}

/** 从 axios 错误中提取微信应答体（{code, message}） */
function wechatErrorText(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { data?: unknown }; message?: string };
    const data = e.response?.data;
    if (typeof data === "object" && data !== null) {
      const d = data as { code?: unknown; message?: unknown };
      return `${String(d.code ?? "UNKNOWN")}: ${String(d.message ?? "")}`;
    }
    return e.message ?? String(err);
  }
  return String(err);
}

export function createWechatGateway(config: Partial<WechatGatewayConfig> = {}): PaymentGateway {
  const mchid = config.mchid?.trim() || undefined;
  const appid = config.appid?.trim() || undefined;
  const serial = config.serial?.trim() || undefined;
  const privateKeyPem = config.privateKey?.trim() || undefined;
  const apiv3Key = config.apiv3Key?.trim() || undefined;

  // 平台验签密钥表：{serial → 公钥 PEM}（平台证书 + 微信支付公钥可并存）
  const platformPems = new Map<string, string>();
  const platformKeys = new Map<string, KeyObject>();
  for (const [pemSerial, pem] of Object.entries(config.platformCerts ?? {})) {
    if (typeof pem === "string" && pem.trim()) {
      platformPems.set(pemSerial, pem.trim());
      platformKeys.set(pemSerial, toPublicKey(pem));
    }
  }
  if (config.publicKeyId?.trim() && config.publicKey?.trim()) {
    const id = config.publicKeyId.trim();
    platformPems.set(id, config.publicKey.trim());
    platformKeys.set(id, toPublicKey(config.publicKey));
  }

  const configured =
    mchid !== undefined &&
    appid !== undefined &&
    serial !== undefined &&
    privateKeyPem !== undefined &&
    apiv3Key !== undefined &&
    platformKeys.size > 0;

  const client = configured
    ? new Wechatpay({
        mchid: mchid as string,
        serial: serial as string,
        privateKey: privateKeyPem as string,
        certs: Object.fromEntries(platformKeys),
      })
    : null;

  function requireClient(): Wechatpay {
    if (!client) {
      throw appError(
        "PAY_GATEWAY_UNAVAILABLE",
        "微信支付网关未配置（mchid/appid/serial/privateKey/apiv3Key 及平台证书或公钥）",
      );
    }
    return client;
  }

  /** 按 Wechatpay-Serial 头取验签公钥；仅配置一把密钥时兼容回退 */
  function pickPlatformKey(headerSerial: string): KeyObject | undefined {
    const exact = platformKeys.get(headerSerial);
    if (exact) return exact;
    if (platformKeys.size === 1) {
      const [onlySerial, key] = [...platformKeys.entries()][0] as [string, KeyObject];
      log.warn(
        { headerSerial, configuredSerial: onlySerial },
        "微信回调 Wechatpay-Serial 与配置不完全匹配，回退使用唯一已配置密钥验签",
      );
      return key;
    }
    return undefined;
  }

  return {
    code: "wechat",
    isConfigured: () => client !== null,

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      const wx = requireClient();
      if (!Number.isInteger(input.amountFen) || input.amountFen <= 0) {
        throw appError("VALIDATION_FAILED", `微信支付金额非法：${input.amountFen}`);
      }
      try {
        const res = await wx.client.request<NativePayResponse>("/v3/pay/transactions/native", "POST", {
          appid,
          mchid,
          description: input.subject,
          out_trade_no: input.outTradeNo,
          notify_url: input.notifyUrl,
          amount: { total: input.amountFen, currency: "CNY" },
        });
        const codeUrl = res.data?.code_url;
        if (!codeUrl) {
          throw appError("PAY_GATEWAY_ERROR", "微信 Native 下单未返回 code_url");
        }
        return { qrCode: codeUrl, raw: { ...(res.data as Record<string, unknown>) } };
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw appError("PAY_GATEWAY_ERROR", `微信 Native 下单失败：${wechatErrorText(err)}`);
      }
    },

    async query(outTradeNo: string): Promise<QueryResult> {
      const wx = requireClient();
      try {
        const res = await wx.client.request<WechatTransaction>(
          `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(mchid ?? "")}`,
          "GET",
        );
        const data = res.data;
        const paid = data.trade_state === "SUCCESS";
        return {
          paid,
          gatewayTxnId: data.transaction_id,
          amountFen: typeof data.amount?.total === "number" ? data.amount.total : undefined,
          raw: { ...data },
        };
      } catch (err) {
        // 404（ORDER_NOT_EXIST 等）→ 视为未支付，等待用户支付或意图过期
        const status =
          typeof err === "object" && err !== null
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;
        if (status === 404) {
          return { paid: false, raw: { status } };
        }
        throw appError("PAY_GATEWAY_ERROR", `微信查单失败：${wechatErrorText(err)}`);
      }
    },

    /** 关单（user 主动取消或意图过期时由调用方触发） */
    async close(outTradeNo: string): Promise<void> {
      const wx = requireClient();
      try {
        await wx.client.request(
          `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`,
          "POST",
          { mchid },
        );
      } catch (err) {
        throw appError("PAY_GATEWAY_ERROR", `微信关单失败：${wechatErrorText(err)}`);
      }
    },

    async refund(input: RefundInput): Promise<RefundResult> {
      const wx = requireClient();
      try {
        const res = await wx.client.request<WechatRefund>("/v3/refund/domestic/refunds", "POST", {
          transaction_id: input.gatewayTxnId,
          out_refund_no: input.outRefundNo,
          reason: input.reason,
          amount: {
            refund: input.amountFen,
            total: input.totalFen ?? input.amountFen,
            currency: "CNY",
          },
        });
        const status = res.data.status;
        // SUCCESS 终态；PROCESSING 异步受理中，最终以回调为准，这里按受理成功处理
        if (status === "SUCCESS" || status === "PROCESSING") {
          return { ok: true, gatewayRefundId: res.data.refund_id };
        }
        return { ok: false, error: `退款状态 ${status ?? "UNKNOWN"}` };
      } catch (err) {
        return { ok: false, error: wechatErrorText(err) };
      }
    },

    verifyCallback(
      headers: Record<string, string>,
      rawBody: string,
      _query: Record<string, string>,
    ): CallbackVerifyResult {
      const lowerHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;

      const signature = lowerHeaders["wechatpay-signature"] ?? "";
      const timestamp = lowerHeaders["wechatpay-timestamp"] ?? "";
      const nonce = lowerHeaders["wechatpay-nonce"] ?? "";
      const serial = lowerHeaders["wechatpay-serial"] ?? "";

      const badResult = (reason: string): CallbackVerifyResult => ({
        ok: false,
        eventId: `bad:${sha256hex(rawBody)}`,
        type: "unverified",
        payload: { reason },
      });

      if (!signature || !timestamp || !nonce || !serial) {
        return badResult("缺少 Wechatpay-* 验签请求头");
      }
      const platformKey = pickPlatformKey(serial);
      if (!platformKey) {
        return badResult(`未找到序列号 ${serial} 对应的平台证书/公钥`);
      }

      // 验签：timestamp\nnonce\nbody\n
      const message = Formatter.response(timestamp, nonce, rawBody);
      let verified = false;
      try {
        verified = Rsa.verify(message, signature, platformKey);
      } catch {
        verified = false;
      }
      if (!verified) {
        return badResult("回调验签失败");
      }

      // 解密 resource（AES-256-GCM，apiv3Key）
      let notification: WechatNotification;
      try {
        notification = JSON.parse(rawBody) as WechatNotification;
      } catch {
        return badResult("回调 body 不是合法 JSON");
      }
      const resource = notification.resource;
      let decrypted: WechatTransaction;
      try {
        if (!resource?.ciphertext || !resource.nonce || !apiv3Key) {
          return badResult("回调缺少 resource 密文或 apiv3Key 未配置");
        }
        const plaintext = Aes.AesGcm.decrypt(
          resource.ciphertext,
          apiv3Key,
          resource.nonce,
          resource.associated_data ?? "",
        );
        decrypted = JSON.parse(plaintext) as WechatTransaction;
      } catch (err) {
        return badResult(`resource 解密失败：${err instanceof Error ? err.message : String(err)}`);
      }

      // 商户归属校验
      if (mchid && decrypted.mchid && decrypted.mchid !== mchid) {
        return badResult("回调 resource.mchid 与配置不一致");
      }

      const eventType = notification.event_type ?? "UNKNOWN";
      const outTradeNo = decrypted.out_trade_no;
      const gatewayTxnId = decrypted.transaction_id;
      const tradeState = decrypted.trade_state;
      const amountFen = typeof decrypted.amount?.total === "number" ? decrypted.amount.total : undefined;
      const paid = eventType === "TRANSACTION.SUCCESS" && tradeState === "SUCCESS";
      const closed = eventType === "TRANSACTION.SUCCESS" && tradeState !== undefined && CLOSED_TRADE_STATES.has(tradeState);

      const payload: Record<string, unknown> = {
        ...decrypted,
        eventType,
        outTradeNo,
        gatewayTxnId,
        amountFen,
        tradeState,
        paid,
        closed,
      };

      return {
        ok: true,
        eventId:
          gatewayTxnId && tradeState
            ? `${gatewayTxnId}:${tradeState}`.slice(0, 128)
            : `evt:${notification.id ?? sha256hex(rawBody)}`.slice(0, 128),
        type: paid
          ? "payment.success"
          : closed
            ? "payment.closed"
            : eventType.startsWith("REFUND.")
              ? "refund.notification"
              : "payment.update",
        payload,
        outTradeNo,
        gatewayTxnId,
        amountFen,
      };
    },
  };
}
