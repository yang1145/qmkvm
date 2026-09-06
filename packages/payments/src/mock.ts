/**
 * mock 网关：恒可用，用于开发/测试环境。
 *
 * - createPayment 返回 `{PORTAL_URL}/pay/mock?no={outTradeNo}`（前端 mock 支付页）；
 * - 「支付成功」由 API 的 dev 端点（POST /dev/mock-pay/:invoiceNo，仅非生产且
 *   DEV_MOCK_PAYMENTS=true 时开放）触发：按下方 payload 结构调用
 *   handleGatewayCallback(db, "mock", { rawBody: JSON.stringify(payload), ... })；
 * - verifyCallback 校验 payload {outTradeNo, gatewayTxnId, amountFen} 齐全即通过；
 * - query/refund 无真实网关：query 恒未支付（掉单补偿自然跳过），refund 恒成功。
 */

import { createHash } from "node:crypto";
import { appError } from "@pinhaoji/core";
import type {
  CallbackVerifyResult,
  CreatePaymentInput,
  CreatePaymentResult,
  MockGatewayConfig,
  PaymentGateway,
  QueryResult,
  RefundInput,
  RefundResult,
} from "./types.js";

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

export function createMockGateway(config: Partial<MockGatewayConfig> = {}): PaymentGateway {
  const portalUrl = config.portalUrl ?? process.env.PORTAL_URL ?? "http://localhost:3001";

  return {
    code: "mock",
    isConfigured: () => true,

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      if (!input.outTradeNo) {
        throw appError("VALIDATION_FAILED", "mock 网关缺少 outTradeNo");
      }
      if (!Number.isInteger(input.amountFen) || input.amountFen <= 0) {
        throw appError("VALIDATION_FAILED", `mock 网关金额非法：${input.amountFen}`);
      }
      return {
        payUrl: `${portalUrl.replace(/\/$/, "")}/pay/mock?no=${encodeURIComponent(input.outTradeNo)}`,
        raw: { outTradeNo: input.outTradeNo, amountFen: input.amountFen, subject: input.subject },
      };
    },

    async query(): Promise<QueryResult> {
      // mock 无真实网关状态：支付成功仅由回调驱动，查询恒返回未支付
      return { paid: false, raw: { gateway: "mock" } };
    },

    async refund(input: RefundInput): Promise<RefundResult> {
      return { ok: true, gatewayRefundId: `mock-refund-${input.outRefundNo}` };
    },

    verifyCallback(
      _headers: Record<string, string>,
      rawBody: string,
      query: Record<string, string>,
    ): CallbackVerifyResult {
      // JSON body 优先，其次 query 参数（dev 端点可 GET 触发）
      let parsed: Record<string, unknown> = {};
      try {
        const json: unknown = JSON.parse(rawBody);
        if (typeof json === "object" && json !== null) parsed = json as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      const payload: Record<string, unknown> = { ...query, ...parsed };

      const outTradeNo = asString(payload.outTradeNo);
      const gatewayTxnId = asString(payload.gatewayTxnId);
      const amountFen = asInt(payload.amountFen);
      const ok = outTradeNo !== undefined && gatewayTxnId !== undefined && amountFen !== undefined;

      return {
        ok,
        eventId: gatewayTxnId ?? `bad:${sha256hex(rawBody || JSON.stringify(query))}`,
        type: "payment.success",
        payload: { ...payload, outTradeNo, gatewayTxnId, amountFen, paid: ok, closed: false },
        outTradeNo,
        gatewayTxnId,
        amountFen,
      };
    },
  };
}
