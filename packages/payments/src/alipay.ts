/**
 * 支付宝网关（官方 alipay-sdk ^4.14.0）。
 *
 * - createPayment：当面付 precreate（返回二维码）与电脑网站支付 page.pay（返回跳转
 *   URL）两种方式，由 settings 配置 payMethod 或入参 method 选择；
 * - query：alipay.trade.query；TRADE_SUCCESS/TRADE_FINISHED 视为已支付；
 * - refund：alipay.trade.refund（out_request_no = 商户退款单号，支持部分退款）；
 * - verifyCallback：异步通知用 SDK checkNotifySignV2/checkNotifySign 验签，
 *   仅验签通过且业务字段齐全才 ok；eventId = `${trade_no}:${trade_status}:${gmt_payment}`。
 */

import { createHash } from "node:crypto";
import { AlipaySdk, type AlipaySdkCommonResult } from "alipay-sdk";
import { appError } from "@pinhaoji/core";
import type {
  AlipayGatewayConfig,
  CallbackVerifyResult,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
  QueryResult,
  RefundInput,
  RefundResult,
} from "./types.js";

/** 分 → 元（两位小数字符串，支付宝金额单位） */
function fenToYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** 元字符串 → 分（四舍五入到分，避免 float 误差） */
function yuanToFen(yuan: string): number | undefined {
  const n = Number(yuan);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** 解析 application/x-www-form-urlencoded 文本为键值对（保留 URL 编码原样，不解码） */
function parseRawForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body) return out;
  for (const pair of body.split("&")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const key = pair.slice(0, idx);
    // 兼容 alipay xxx_response 的 JSON 格式值（含 '='），取首个 '=' 之后全部
    out[key] = pair.slice(idx + 1);
  }
  return out;
}

function requireSdk(sdk: AlipaySdk | null): AlipaySdk {
  if (!sdk) {
    throw appError("PAY_GATEWAY_UNAVAILABLE", "支付宝网关未配置（appId/privateKey/alipayPublicKey）");
  }
  return sdk;
}

/** 校验支付宝应答 code=10000，否则抛网关错误 */
function assertAlipayOk(res: AlipaySdkCommonResult, api: string): void {
  if (res.code !== "10000") {
    throw appError("PAY_GATEWAY_ERROR", `支付宝 ${api} 失败：${res.subCode ?? res.code} ${res.subMsg ?? res.msg}`, {
      code: res.code,
      subCode: res.subCode,
      subMsg: res.subMsg,
    });
  }
}

/** 支付成功的交易状态 */
export function isPaidTradeStatus(status: string | undefined): boolean {
  return status === "TRADE_SUCCESS" || status === "TRADE_FINISHED";
}

export function createAlipayGateway(config: Partial<AlipayGatewayConfig> = {}): PaymentGateway {
  const appId = config.appId?.trim() || undefined;
  const privateKey = config.privateKey?.trim() || undefined;
  const alipayPublicKey = config.alipayPublicKey?.trim() || undefined;
  const defaultPayMethod = config.payMethod ?? "precreate";

  const sdk =
    appId && privateKey && alipayPublicKey
      ? new AlipaySdk({
          appId,
          privateKey,
          alipayPublicKey,
          gateway: config.gateway,
          signType: config.signType ?? "RSA2",
          keyType: config.keyType,
          timeout: config.timeout,
        })
      : null;

  return {
    code: "alipay",
    isConfigured: () => sdk !== null,

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      const client = requireSdk(sdk);
      if (!Number.isInteger(input.amountFen) || input.amountFen <= 0) {
        throw appError("VALIDATION_FAILED", `支付宝支付金额非法：${input.amountFen}`);
      }
      const bizContent: Record<string, unknown> = {
        out_trade_no: input.outTradeNo,
        total_amount: fenToYuan(input.amountFen),
        subject: input.subject,
      };

      const method = input.method ?? defaultPayMethod;
      if (method === "page") {
        // 电脑网站支付：返回跳转 URL（GET 链接形式）
        const payUrl = client.pageExecute("alipay.trade.page.pay", "GET", {
          notifyUrl: input.notifyUrl,
          returnUrl: input.returnUrl,
          bizContent: { ...bizContent, product_code: "FAST_INSTANT_TRADE_PAY" },
        });
        return { payUrl, raw: { method: "page" } };
      }

      // 当面付预下单：返回二维码
      const res = await client.exec(
        "alipay.trade.precreate",
        { notifyUrl: input.notifyUrl, bizContent },
        { validateSign: true },
      );
      assertAlipayOk(res, "alipay.trade.precreate");
      const qrCode = typeof res.qrCode === "string" ? res.qrCode : undefined;
      if (!qrCode) {
        throw appError("PAY_GATEWAY_ERROR", "支付宝预下单未返回二维码（qr_code）");
      }
      return { qrCode, raw: { ...res } };
    },

    async query(outTradeNo: string): Promise<QueryResult> {
      const client = requireSdk(sdk);
      const res = await client.exec("alipay.trade.query", {
        bizContent: { out_trade_no: outTradeNo },
      });
      if (res.code !== "10000") {
        // 交易不存在等 → 视为未支付（掉单补偿会持续轮询到意图过期为止）
        return { paid: false, raw: { code: res.code, subCode: res.subCode, subMsg: res.subMsg } };
      }
      const tradeStatus = typeof res.tradeStatus === "string" ? res.tradeStatus : undefined;
      const paid = isPaidTradeStatus(tradeStatus);
      return {
        paid,
        gatewayTxnId: typeof res.tradeNo === "string" ? res.tradeNo : undefined,
        amountFen: typeof res.totalAmount === "string" ? yuanToFen(res.totalAmount) : undefined,
        raw: { ...res },
      };
    },

    async refund(input: RefundInput): Promise<RefundResult> {
      const client = requireSdk(sdk);
      try {
        const res = await client.exec(
          "alipay.trade.refund",
          {
            bizContent: {
              trade_no: input.gatewayTxnId,
              out_request_no: input.outRefundNo,
              refund_amount: fenToYuan(input.amountFen),
              refund_reason: input.reason,
            },
          },
          { validateSign: true },
        );
        // fund_change=Y 表示本次请求产生了真实退款
        if (res.code === "10000" && res.fundChange === "Y") {
          return { ok: true, gatewayRefundId: typeof res.tradeNo === "string" ? res.tradeNo : undefined };
        }
        if (res.code === "10000") {
          // fund_change=N：同 out_request_no 已退款成功（重试幂等），视为成功
          return { ok: true, gatewayRefundId: typeof res.tradeNo === "string" ? res.tradeNo : undefined };
        }
        return { ok: false, error: `${res.subCode ?? res.code}: ${res.subMsg ?? res.msg}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    verifyCallback(
      _headers: Record<string, string>,
      rawBody: string,
      query: Record<string, string>,
    ): CallbackVerifyResult {
      const rawParams: Record<string, string> = { ...parseRawForm(rawBody), ...query };
      // URLSearchParams 按表单规则解码（'+' → 空格）
      const decodedParams: Record<string, string> = {
        ...Object.fromEntries(new URLSearchParams(rawBody)),
        ...query,
      };

      let verified = false;
      try {
        // 验签双重尝试：解码后验（checkNotifySignV2，值不再 decode）+ 原始值验（checkNotifySign，内部 decode）
        verified =
          sdk !== null &&
          (sdk.checkNotifySignV2(decodedParams) || sdk.checkNotifySign(rawParams));
      } catch {
        verified = false;
      }

      const outTradeNo = decodedParams["out_trade_no"] || undefined;
      const gatewayTxnId = decodedParams["trade_no"] || undefined;
      const tradeStatus = decodedParams["trade_status"] || undefined;
      const gmtPayment = decodedParams["gmt_payment"] || undefined;
      const totalAmount = decodedParams["total_amount"];
      const amountFen = totalAmount !== undefined ? yuanToFen(totalAmount) : undefined;
      const paid = isPaidTradeStatus(tradeStatus);
      const closed = tradeStatus === "TRADE_CLOSED";

      // app_id 归属校验：通知中的应用必须与本网关配置一致
      if (verified && appId && decodedParams["app_id"] && decodedParams["app_id"] !== appId) {
        verified = false;
      }

      const payload: Record<string, unknown> = {
        ...decodedParams,
        outTradeNo,
        gatewayTxnId,
        amountFen,
        tradeStatus,
        paid,
        closed,
      };

      return {
        ok: verified,
        eventId:
          gatewayTxnId && tradeStatus
            ? `${gatewayTxnId}:${tradeStatus}:${gmtPayment ?? ""}`.slice(0, 128)
            : `bad:${sha256hex(rawBody)}`,
        type: paid ? "payment.success" : closed ? "payment.closed" : "payment.update",
        payload,
        outTradeNo,
        gatewayTxnId,
        amountFen,
      };
    },
  };
}
