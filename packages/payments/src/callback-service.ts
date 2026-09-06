/**
 * 回调处理管线（SPEC-P0 §2.4）：
 *
 * handleGatewayCallback：验签失败 → gatewayEvents(received,error) → 401；
 *   验签成功 → INSERT gateway_events（唯一键冲突 → 重复事件 → 仍返回网关 ack）
 *   → enqueueJob("payment.process_event", { eventId: 网关事件行 id }) → 立即返回 ack。
 *
 * processPaymentEvent：幂等结算（event 短路 → 解析 PI{id} → 意图状态/金额校验 →
 *   事务：transactions(success，唯一键兜底) → markInvoicePaid → markOrderPaid → intent=success）。
 *
 * queryAndSettleStaleIntents：掉单补偿——paying 未过期意图主动查网关，
 *   构造 reconcile 事件走 processPaymentEvent 同一结算路径。
 *
 * createRefund：事务锁原交易 → refunds(pending) → 网关退款 → succeeded +
 *   gatewayRefundId → invoice 部分退款状态聚合 → emit refund.completed 通知。
 */

import { and, eq, gt, inArray } from "drizzle-orm";
import { schema, type Db } from "@pinhaoji/db/client";
import type { Json } from "@pinhaoji/db/schema";
import {
  appError,
  creditUser,
  emitEvent,
  enqueueJob,
  markInvoicePaid,
  markOrderPaid,
  registerJobHandler,
} from "@pinhaoji/core";
import { logger } from "@pinhaoji/logger";
import { getGateway } from "./registry.js";
import type { PaymentGateway } from "./types.js";

const log = logger.child({ module: "payments:callback" });

const { gatewayEvents, paymentIntents, transactions, invoices, invoiceItems, refunds } = schema;

/** 支付事件处理 job 名（worker 侧注册 / inline 降级执行） */
export const PROCESS_EVENT_JOB = "payment.process_event";

/** outTradeNo 约定：`PI${paymentIntentId}` */
export function buildOutTradeNo(intentId: number): string {
  return `PI${intentId}`;
}

/** 解析 outTradeNo → paymentIntentId；不符合约定返回 undefined */
export function parseOutTradeNo(outTradeNo: string): number | undefined {
  const match = /^PI(\d+)$/.exec(outTradeNo);
  if (!match?.[1]) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** 网关同步应答（ack）：支付宝纯文本 "success"，微信 JSON {"code":"SUCCESS"}，其余默认 "success" */
export function gatewayAckBody(code: string): string {
  return code === "wechat" ? '{"code":"SUCCESS"}' : "success";
}

/** 验签失败应答：微信 {"code":"FAIL"}，其余纯文本 */
export function gatewayNackBody(code: string): string {
  return code === "wechat" ? '{"code":"FAIL","message":"verification failed"}' : "failure";
}

/** mysql 唯一键冲突（幂等兜底判定）；drizzle 会把驱动错误包在 cause 链里，需穿透 */
function isDuplicateKeyError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const e = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
    current = e.cause;
  }
  return false;
}

function toInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

export interface CallbackRequest {
  headers: Record<string, string>;
  rawBody: string;
  query: Record<string, string>;
}

export interface CallbackResponse {
  status: 200 | 401 | 404;
  body: string;
}

/** 记录验签失败的事件（审计/防重放观测；同内容去重，插入失败仅告警） */
async function recordUnverifiedEvent(
  db: Db,
  code: string,
  req: CallbackRequest,
  eventId: string,
  type: string,
  payload: Record<string, unknown>,
  reason: string,
): Promise<void> {
  try {
    await db.insert(gatewayEvents).values({
      gatewayCode: code,
      eventId: eventId.slice(0, 128),
      type: type.slice(0, 50),
      payload: {
        ...payload,
        rawBody: req.rawBody.slice(0, 2000),
      } as Json,
      status: "received",
      error: reason.slice(0, 500),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) return; // 同一非法内容重复出现，保留首条
    log.error({ code, err }, "记录验签失败事件异常");
  }
}

/**
 * 网关异步回调入口（API 层 /webhooks/alipay、/webhooks/wechat 调用）。
 * 同步完成验签 + 落库 + 入队，立即返回网关要求的 ack。
 */
export async function handleGatewayCallback(
  db: Db,
  code: string,
  req: CallbackRequest,
): Promise<CallbackResponse> {
  const gateway = await getGateway(db, code);
  if (!gateway) {
    log.warn({ code }, "收到回调但网关未配置或不存在");
    return { status: 404, body: gatewayNackBody(code) };
  }

  let verify;
  try {
    verify = gateway.verifyCallback(req.headers, req.rawBody, req.query);
  } catch (err) {
    log.warn({ code, err }, "网关回调验签异常");
    const { createHash } = await import("node:crypto");
    await recordUnverifiedEvent(
      db,
      code,
      req,
      `bad:${createHash("sha256").update(`${code}:${req.rawBody}`).digest("hex")}`,
      "unverified",
      {},
      `验签异常：${err instanceof Error ? err.message : String(err)}`,
    );
    return { status: 401, body: gatewayNackBody(code) };
  }

  if (!verify.ok) {
    log.warn({ code, eventId: verify.eventId }, "网关回调验签失败");
    await recordUnverifiedEvent(
      db,
      code,
      req,
      verify.eventId || "bad:unknown",
      verify.type || "unverified",
      verify.payload,
      "验签失败",
    );
    return { status: 401, body: gatewayNackBody(code) };
  }

  // INSERT gateway_events：唯一键 (gateway_code, event_id) 保证事件不重复消费
  let eventRowId: number;
  try {
    const inserted = await db
      .insert(gatewayEvents)
      .values({
        gatewayCode: code,
        eventId: verify.eventId.slice(0, 128),
        type: verify.type.slice(0, 50),
        payload: verify.payload as Json,
        status: "received",
      });
    eventRowId = inserted[0]!.insertId;
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // 重复回调：已处理过的事件标记 duplicate；仍在 received/failed 的保持原状等待处理
    const existing = await db
      .select()
      .from(gatewayEvents)
      .where(and(eq(gatewayEvents.gatewayCode, code), eq(gatewayEvents.eventId, verify.eventId)))
      .limit(1);
    const row = existing[0];
    if (row && row.status === "processed") {
      await db.update(gatewayEvents).set({ status: "duplicate" }).where(eq(gatewayEvents.id, row.id));
    }
    log.info({ code, eventId: verify.eventId }, "重复网关回调，直接返回 ack");
    return { status: 200, body: gatewayAckBody(code) };
  }

  // 入队异步结算；立即 ack（网关重试机制 + reconcile 兜底）
  await enqueueJob(PROCESS_EVENT_JOB, { eventId: eventRowId });
  return { status: 200, body: gatewayAckBody(code) };
}

/**
 * 处理网关支付事件（worker/inline 调用）。全路径幂等：
 * - 事件 processed/duplicate 短路；transactions 唯一键 (gateway_code, gateway_txn_id) 兜底；
 * - markInvoicePaid / markOrderPaid 幂等。
 */
export async function processPaymentEvent(db: Db, eventId: number): Promise<void> {
  const rows = await db.select().from(gatewayEvents).where(eq(gatewayEvents.id, eventId)).limit(1);
  const event = rows[0];
  if (!event) {
    log.warn({ eventId }, "gateway_event 不存在，跳过");
    return;
  }
  if (event.status === "processed" || event.status === "duplicate") {
    return; // 幂等短路
  }

  const failEvent = async (message: string): Promise<void> => {
    await db
      .update(gatewayEvents)
      .set({ status: "failed", error: message.slice(0, 500), processedAt: new Date() })
      .where(eq(gatewayEvents.id, event.id));
    log.error({ eventId: event.id, gatewayCode: event.gatewayCode, message }, "支付事件处理失败");
  };

  const markProcessed = async (): Promise<void> => {
    await db
      .update(gatewayEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(gatewayEvents.id, event.id));
  };

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const outTradeNo = typeof payload.outTradeNo === "string" ? payload.outTradeNo : undefined;
  const gatewayTxnId = typeof payload.gatewayTxnId === "string" ? payload.gatewayTxnId : undefined;
  const amountFen = toInt(payload.amountFen);
  const paid = payload.paid === true;
  const closed = payload.closed === true;

  if (!outTradeNo) {
    await failEvent("回调缺少 outTradeNo");
    return;
  }
  const intentId = parseOutTradeNo(outTradeNo);
  if (intentId === undefined) {
    await failEvent(`outTradeNo 不符合 PI{id} 约定：${outTradeNo}`);
    return;
  }
  if (!gatewayTxnId) {
    await failEvent("回调缺少 gatewayTxnId");
    return;
  }

  const intentRows = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, intentId))
    .limit(1);
  const intent = intentRows[0];
  if (!intent) {
    await failEvent(`支付意图不存在：${intentId}`);
    return;
  }

  // 意图已成功 → 幂等
  if (intent.status === "success") {
    await markProcessed();
    return;
  }
  if (intent.status !== "created" && intent.status !== "paying") {
    await failEvent(`支付意图状态为 ${intent.status}，不处理支付回调（需人工核实）`);
    return;
  }

  // 金额校验：不符 → 事件 failed + 告警，不标记支付
  if (amountFen === undefined || amountFen !== intent.amount) {
    await failEvent(`回调金额 ${amountFen ?? "缺失"} 与支付意图金额 ${intent.amount} 不符`);
    await emitEvent(db, "payment.alert", {
      kind: "amount_mismatch",
      intentId,
      outTradeNo,
      expectedAmount: intent.amount,
      receivedAmount: amountFen ?? null,
      gatewayCode: event.gatewayCode,
      gatewayTxnId,
      eventId: event.id,
    });
    return;
  }

  // 网关侧交易关闭 → 意图置 failed（账单仍 unpaid，可重新发起支付）
  if (!paid && closed) {
    await db
      .update(paymentIntents)
      .set({ status: "failed" })
      .where(and(eq(paymentIntents.id, intent.id), inArray(paymentIntents.status, ["created", "paying"])));
    await markProcessed();
    return;
  }

  // 中间状态（如已下单未支付的通知）：仅记录事件
  if (!paid) {
    await markProcessed();
    return;
  }

  // —— 支付成功：结算事务 ——
  try {
    await db.transaction(async (tx) => {
      // 唯一键 (gateway_code, gateway_txn_id) 兜底：并发/重复结算在此处冲突回滚
      await tx.insert(transactions).values({
        userId: intent.userId,
        invoiceId: intent.invoiceId,
        paymentIntentId: intent.id,
        gatewayCode: event.gatewayCode,
        gatewayTxnId,
        type: "payment",
        amount: amountFen,
        status: "success",
        raw: payload as Json,
      });

      const invoice = await markInvoicePaid(tx, intent.invoiceId, {
        gatewayCode: event.gatewayCode,
        gatewayTxnId,
        paymentIntentId: intent.id,
      });

      if (invoice.orderId != null) {
        await markOrderPaid(tx, invoice.orderId);
      }

      // 充值账单：入账余额（双式账本），并通知到账
      if (invoice.type === "recharge") {
        await creditUser(tx, invoice.userId, {
          type: "recharge",
          amount: invoice.total,
          refType: "invoice",
          refId: invoice.id,
          remark: "余额充值",
        });
        await emitEvent(tx, "credit.recharged", {
          userId: invoice.userId,
          amount: invoice.total,
        });
      }

      await tx
        .update(paymentIntents)
        .set({ status: "success", paidAt: new Date() })
        .where(eq(paymentIntents.id, intent.id));

      await markProcessed();

      // 兜底：无订单的续费账单（cron 自动生成）——顺延到期日/恢复暂停服务。
      // 幂等安全：日期运算基于 max(today, next_due_date)，重复调用不叠加。
      if (invoice.type === "renewal" && invoice.orderId == null) {
        try {
          const items = await tx
            .select({ meta: invoiceItems.meta })
            .from(invoiceItems)
            .where(eq(invoiceItems.invoiceId, invoice.id));
          let serviceId: number | undefined;
          let cycle: string | undefined;
          for (const it of items) {
            const meta = it.meta as { serviceId?: unknown; cycle?: unknown } | null;
            if (typeof meta?.serviceId === "number") {
              serviceId = meta.serviceId;
              cycle = typeof meta.cycle === "string" ? meta.cycle : undefined;
              break;
            }
          }
          if (serviceId !== undefined) {
            const { applyRenewalPayment } = await import("@pinhaoji/core");
            await applyRenewalPayment(db, serviceId, (cycle ?? "monthly") as never);
            log.info({ invoiceId: invoice.id, serviceId }, "续费账单已顺延服务到期日");
          } else {
            log.warn({ invoiceId: invoice.id }, "续费账单缺少 serviceId，无法顺延到期日");
          }
        } catch (renewErr) {
          // 结算已成功，顺延失败仅告警（下次续费时 max(today,due) 语义可自愈）
          log.error({ invoiceId: invoice.id, err: renewErr }, "续费顺延失败");
        }
      }
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // 重复结算：另一事务已写入 transactions → 幂等成功
      log.info({ eventId: event.id, intentId }, "交易流水已存在，按幂等处理");
      await markProcessed();
      return;
    }
    await failEvent(`结算失败：${err instanceof Error ? err.message : String(err)}`);
    throw err; // 交由队列按 attempts 重试（事件 failed 状态允许重入）
  }
}

/**
 * 掉单补偿：paying 状态且未过期的支付意图主动查网关，
 * 已支付则构造 reconcile 事件走 processPaymentEvent 同一结算路径。
 */
export async function queryAndSettleStaleIntents(
  db: Db,
  now: Date = new Date(),
): Promise<{ settled: number }> {
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.status, "paying"), gt(paymentIntents.expiresAt, now)));

  let settled = 0;
  for (const intent of rows) {
    const gateway: PaymentGateway | undefined = await getGateway(db, intent.gatewayCode);
    if (!gateway) {
      log.warn({ intentId: intent.id, code: intent.gatewayCode }, "补偿查询时网关未配置，跳过");
      continue;
    }
    const outTradeNo = buildOutTradeNo(intent.id);
    let result;
    try {
      result = await gateway.query(outTradeNo);
    } catch (err) {
      log.warn({ intentId: intent.id, err }, "补偿查询网关失败，跳过");
      continue;
    }
    if (!result.paid || !result.gatewayTxnId) continue;

    if (result.amountFen !== undefined && result.amountFen !== intent.amount) {
      log.error(
        { intentId: intent.id, expected: intent.amount, received: result.amountFen },
        "补偿查询金额与意图不符，不自动结算",
      );
      await emitEvent(db, "payment.alert", {
        kind: "amount_mismatch",
        source: "reconcile",
        intentId: intent.id,
        outTradeNo,
        expectedAmount: intent.amount,
        receivedAmount: result.amountFen,
        gatewayCode: intent.gatewayCode,
        gatewayTxnId: result.gatewayTxnId,
      });
      continue;
    }

    // 构造事件（唯一键防重复补偿）→ 复用 processPaymentEvent 结算
    const reconcileEventId = `reconcile:${intent.id}:${result.gatewayTxnId}`.slice(0, 128);
    try {
      const inserted = await db
        .insert(gatewayEvents)
        .values({
          gatewayCode: intent.gatewayCode,
          eventId: reconcileEventId,
          type: "payment.success",
          payload: {
            outTradeNo,
            gatewayTxnId: result.gatewayTxnId,
            amountFen: result.amountFen ?? intent.amount,
            paid: true,
            closed: false,
            source: "reconcile",
          } as Json,
          status: "received",
        });
      const eventRowId = inserted[0]!.insertId;
      await processPaymentEvent(db, eventRowId);
      const settledRows = await db
        .select({ status: paymentIntents.status })
        .from(paymentIntents)
        .where(eq(paymentIntents.id, intent.id))
        .limit(1);
      if (settledRows[0]?.status === "success") {
        settled += 1;
      }
    } catch (err) {
      if (isDuplicateKeyError(err)) continue; // 该意图已被补偿过
      throw err;
    }
  }
  return { settled };
}

export interface CreateRefundInput {
  transactionId: number;
  /** 退款金额（整数分，>0） */
  amount: number;
  reason?: string;
}

/**
 * 创建退款（API 层校验 refunds.manage 权限后调用）：
 * 事务锁原交易并建 refunds(pending) → 网关退款 → succeeded + gatewayRefundId →
 * invoice 部分退款状态聚合 → emit refund.completed 通知。
 */
export async function createRefund(
  db: Db,
  adminId: number,
  input: CreateRefundInput,
): Promise<typeof refunds.$inferSelect> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw appError("VALIDATION_FAILED", `退款金额非法：${input.amount}`);
  }

  // 1) 事务：锁定原交易 + 可退额度校验 + 建 pending 退款单
  const pendingRefundId = await db.transaction(async (tx) => {
    const txnRows = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, input.transactionId))
      .for("update")
      .limit(1);
    const txn = txnRows[0];
    if (!txn) {
      throw appError("NOT_FOUND", `交易不存在：${input.transactionId}`);
    }
    if (txn.type !== "payment" || txn.status !== "success") {
      throw appError("CONFLICT", `交易状态 ${txn.status} 不允许退款`);
    }

    const existing = await tx
      .select({ amount: refunds.amount, status: refunds.status })
      .from(refunds)
      .where(eq(refunds.transactionId, txn.id));
    const occupied = existing
      .filter((r) => r.status !== "failed")
      .reduce((sum, r) => sum + r.amount, 0);
    if (occupied + input.amount > txn.amount) {
      throw appError(
        "VALIDATION_FAILED",
        `超出可退金额：原额 ${txn.amount}，已占用 ${occupied}，本次 ${input.amount}`,
      );
    }

    const inserted = await tx
      .insert(refunds)
      .values({
        transactionId: txn.id,
        invoiceId: txn.invoiceId,
        amount: input.amount,
        status: "pending",
        reason: input.reason?.slice(0, 255) ?? null,
        adminId,
      });
    return inserted[0]!.insertId;
  });

  // 2) 调用网关退款（事务外，避免长事务挂起连接）
  const txnRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, input.transactionId))
    .limit(1);
  const txn = txnRows[0]!;
  const gateway = await getGateway(db, txn.gatewayCode);
  let refundResult;
  if (!gateway) {
    refundResult = { ok: false, error: `网关 ${txn.gatewayCode} 未配置` };
  } else {
    try {
      refundResult = await gateway.refund({
        gatewayTxnId: txn.gatewayTxnId,
        outRefundNo: `R${pendingRefundId}`,
        amountFen: input.amount,
        totalFen: txn.amount,
        reason: input.reason,
      });
    } catch (err) {
      refundResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!refundResult.ok) {
    await db.update(refunds).set({ status: "failed" }).where(eq(refunds.id, pendingRefundId));
    log.error({ refundId: pendingRefundId, error: refundResult.error }, "网关退款失败");
    throw appError("PAY_GATEWAY_ERROR", `网关退款失败：${refundResult.error ?? "未知错误"}`);
  }

  // 3) 成功：refunds=succeeded + transactions 状态 + invoice 退款聚合 + 通知
  return db.transaction(async (tx) => {
    await tx
      .update(refunds)
      .set({ status: "succeeded", gatewayRefundId: refundResult.gatewayRefundId ?? null })
      .where(eq(refunds.id, pendingRefundId));

    const allRefunds = await tx
      .select({ amount: refunds.amount, status: refunds.status })
      .from(refunds)
      .where(eq(refunds.transactionId, txn.id));
    const succeededTotal = allRefunds
      .filter((r) => r.status === "succeeded")
      .reduce((sum, r) => sum + r.amount, 0);
    if (succeededTotal >= txn.amount) {
      await tx
        .update(transactions)
        .set({ status: "refunded" })
        .where(and(eq(transactions.id, txn.id), eq(transactions.status, "success")));
    }

    if (txn.invoiceId != null) {
      const invRows = await tx.select().from(invoices).where(eq(invoices.id, txn.invoiceId)).limit(1);
      const invoice = invRows[0];
      if (invoice && (invoice.status === "paid" || invoice.status === "partially_refunded")) {
        const invoiceRefunds = await tx
          .select({ amount: refunds.amount })
          .from(refunds)
          .where(and(eq(refunds.invoiceId, invoice.id), eq(refunds.status, "succeeded")));
        const refundedOnInvoice = invoiceRefunds.reduce((sum, r) => sum + r.amount, 0);
        const nextStatus = refundedOnInvoice >= invoice.total ? "refunded" : "partially_refunded";
        await tx
          .update(invoices)
          .set({ status: nextStatus })
          .where(and(eq(invoices.id, invoice.id), inArray(invoices.status, ["paid", "partially_refunded"])));
      }
    }

    await emitEvent(tx, "refund.completed", {
      userId: txn.userId,
      refundId: pendingRefundId,
      invoiceId: txn.invoiceId,
      amount: input.amount,
      reason: input.reason ?? "",
    });

    const updated = await tx.select().from(refunds).where(eq(refunds.id, pendingRefundId)).limit(1);
    const row = updated[0];
    if (!row) {
      throw appError("INTERNAL", "退款单回读失败");
    }
    return row;
  });
}

/**
 * 注册支付域 job 处理器（api/worker 进程启动时调用）：
 * - "payment.process_event" → processPaymentEvent（inline 降级模式下回调立即结算）。
 */
export function registerPaymentJobHandlers(db: Db): void {
  registerJobHandler(PROCESS_EVENT_JOB, async (data: unknown) => {
    const eventId = (data as { eventId?: unknown } | null)?.eventId;
    if (typeof eventId !== "number" || !Number.isInteger(eventId)) {
      throw appError("VALIDATION_FAILED", `payment.process_event 数据缺少 eventId：${JSON.stringify(data)}`);
    }
    await processPaymentEvent(db, eventId);
  });
}
