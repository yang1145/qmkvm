/**
 * 供应任务执行器（SPEC-P0 §2.5 runner）：
 *
 * - runProvisionTask：原子领取（条件 UPDATE 防并发/重复投递）→ 按 service.moduleCode
 *   取模块执行动作 → 按 SPEC 推进服务状态与任务结果；失败按 attempts/maxAttempts
 *   判定 failed（等待退避重试）或 dead（最终失败 + provision.task_failed 事件）。
 * - retryTask / skipTask：后台人工重试 / 跳过任务。
 * - processQueuedTasks：cron 兜底扫描 —— 崩溃恢复（processing 滞留）、queued 滞留
 *   （>5min 投递丢失）、failed 退避重投；直接调用 runProvisionTask 执行并统计结果。
 *
 * 注意：模块调用含外部 IO，不在事务内；模块成功后的服务/任务更新顺序执行。
 */
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@pinhaoji/db/client";
import type { Json } from "@pinhaoji/db/schema";
import { billingCycleEnum, type BillingCycle } from "@pinhaoji/contracts";
import { appError } from "@pinhaoji/core";
import { enqueueJob, emitEvent, EVENT_NAMES } from "@pinhaoji/core";
import { completeOrder, updateServiceStatus } from "@pinhaoji/core";
import { addCycle, todayStr } from "@pinhaoji/core/date-utils";
import { logger } from "@pinhaoji/logger";
import { getModule } from "./registry.js";
import type {
  ChangePackageTarget,
  ModuleCtx,
  ModuleResult,
} from "./types.js";

const { provisionTasks, services, products, productPricing, configOptions, orders, auditLogs } = schema;

const log = logger.child({ module: "provisioning:runner" });

/** queued 滞留阈值（投递丢失判定）：5 分钟 */
export const STALE_QUEUED_MS = 5 * 60_000;
/** processing 滞留阈值（进程崩溃判定）：30 分钟 */
export const STALE_PROCESSING_MS = 30 * 60_000;
/** failed 重试退避基数：30s，按 attempts 指数递增，上限 30 分钟 */
export const RETRY_BACKOFF_BASE_MS = 30_000;
export const RETRY_BACKOFF_MAX_MS = 30 * 60_000;

/** failed 任务的下次重试退避：base × 2^(attempts-1)，封顶 RETRY_BACKOFF_MAX_MS */
export function retryBackoffMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts, 8) - 1);
  return Math.min(RETRY_BACKOFF_BASE_MS * 2 ** exponent, RETRY_BACKOFF_MAX_MS);
}

/** 任务行类型 */
export type ProvisionTaskRow = typeof provisionTasks.$inferSelect;

// —— runProvisionTask ——

/**
 * 执行单个供应任务。任务不存在/已被并发领取时静默返回（幂等）；
 * 可预期失败（模块 ok:false / 业务异常）记入任务并按需重试，不向上抛出，
 * 以免触发 BullMQ 层面重试导致 attempts 失控（重试节奏由 processQueuedTasks 掌控）。
 */
export async function runProvisionTask(db: Db, taskId: number): Promise<void> {
  // 1) 原子领取：仅 queued/failed 可领取，attempts+1（重复投递安全）
  const claim = await db
    .update(provisionTasks)
    .set({ status: "processing", attempts: sql`${provisionTasks.attempts} + 1` })
    .where(and(eq(provisionTasks.id, taskId), inArray(provisionTasks.status, ["queued", "failed"])));
  if (claim[0].affectedRows === 0) {
    log.debug({ taskId }, "任务不可领取（不存在或已处理），跳过");
    return;
  }

  const taskRows = await db.select().from(provisionTasks).where(eq(provisionTasks.id, taskId)).limit(1);
  const task = taskRows[0];
  if (!task) return; // 服务删除时任务级联删除

  const serviceRows = await db.select().from(services).where(eq(services.id, task.serviceId)).limit(1);
  const service = serviceRows[0];
  if (!service) {
    await markFailure(db, task, "服务不存在（可能已被删除）");
    return;
  }

  // 2) 取模块（模块内部按 service.moduleConfig + 商品 moduleConfig 合并读取配置）
  const module = getModule(service.moduleCode);
  if (!module) {
    await markFailure(db, task, `未注册的供应模块：${service.moduleCode}`);
    return;
  }

  const ctx: ModuleCtx = { db, logger: log };
  log.info({ taskId: task.id, serviceId: service.id, action: task.action, module: module.code }, "开始执行供应任务");

  try {
    const result = await dispatchAction(ctx, module.code, task, service, module);
    if (result.ok) {
      // manual 结果：任务成功即可，服务状态由后台人工操作推进
      if (result.manual) {
        log.info({ taskId: task.id }, "模块返回 manual，服务状态等待后台人工推进");
      } else {
        await applySuccess(db, task, service, result);
      }
      await markSucceeded(db, task, result);
    } else {
      await markFailure(db, task, result.message ?? "模块返回失败");
    }
  } catch (err) {
    // 领取后的意外异常（DB 更新失败等）：记入任务进入正常重试轨道
    await markFailure(db, task, err instanceof Error ? err.message : String(err));
  }
}

/** 按任务 action 调用模块对应方法 */
async function dispatchAction(
  ctx: ModuleCtx,
  moduleCode: string,
  task: ProvisionTaskRow,
  service: typeof services.$inferSelect,
  module: import("./types.js").ProvisionModule,
): Promise<ModuleResult> {
  switch (task.action) {
    case "provision":
      return module.provision(ctx, service);
    case "suspend":
      return module.suspend(ctx, service);
    case "unsuspend":
      return module.unsuspend(ctx, service);
    case "terminate":
      return module.terminate(ctx, service);
    case "change_package": {
      const target = resolveChangeTarget(task.payload, service);
      return module.changePackage(ctx, service, target);
    }
    case "sync":
      // P0 无 sync 生产方；占位为成功 no-op，模块可不实现
      log.info({ taskId: task.id, module: moduleCode }, "sync 动作 P0 为 no-op，直接标记完成");
      return { ok: true, message: "sync 动作当前为 no-op（P0）" };
    default: {
      const exhaustive: never = task.action;
      return { ok: false, message: `未知的任务动作：${String(exhaustive)}` };
    }
  }
}

// —— 成功分支（严格按 SPEC 推进服务状态） ——

async function applySuccess(
  db: Db,
  task: ProvisionTaskRow,
  service: typeof services.$inferSelect,
  result: ModuleResult,
): Promise<void> {
  const today = todayStr();
  switch (task.action) {
    case "provision": {
      const nextDue = service.cycle === "onetime" ? null : addCycle(today, service.cycle);
      const deliverInfo = mergeDeliverInfo(service.deliverInfo, result.deliverInfo);
      await updateServiceStatus(db, service.id, "active", {
        nextDueDate: nextDue,
        ...(deliverInfo !== undefined ? { deliverInfo } : {}),
      });
      await emitEvent(db, EVENT_NAMES.serviceActivated, {
        userId: service.userId,
        serviceId: service.id,
        serviceName: service.name,
      });
      await maybeCompleteOrder(db, task.orderId ?? service.orderId ?? null);
      break;
    }
    case "suspend": {
      // 欠费暂停 → suspended_overdue；人工/其他原因 → suspended_manual
      const reason = readPayloadString(task.payload, "reason");
      const status = reason === "manual" ? "suspended_manual" : "suspended_overdue";
      await updateServiceStatus(db, service.id, status, { suspendedAt: new Date() });
      await emitEvent(db, EVENT_NAMES.serviceSuspended, {
        userId: service.userId,
        serviceId: service.id,
        serviceName: service.name,
        reason: reason ?? status,
      });
      break;
    }
    case "unsuspend": {
      // 恢复并补期：next_due_date = addCycle(today, cycle)（onetime 保持原值）
      const nextDue = service.cycle === "onetime" ? service.nextDueDate : addCycle(today, service.cycle);
      await updateServiceStatus(db, service.id, "active", {
        ...(nextDue !== null ? { nextDueDate: nextDue } : {}),
      });
      await emitEvent(db, EVENT_NAMES.serviceActivated, {
        userId: service.userId,
        serviceId: service.id,
        serviceName: service.name,
      });
      break;
    }
    case "terminate": {
      await updateServiceStatus(db, service.id, "terminated", { terminatedAt: new Date() });
      await emitEvent(db, EVENT_NAMES.serviceTerminated, {
        userId: service.userId,
        serviceId: service.id,
        serviceName: service.name,
      });
      break;
    }
    case "change_package": {
      const target = resolveChangeTarget(task.payload, service);
      await applyChangePackage(db, task, service, target, task.payload);
      break;
    }
    case "sync":
      break; // no-op
    default: {
      const exhaustive: never = task.action;
      void exhaustive;
    }
  }
}

/** change_package 成功：应用目标套餐 + 重算续费金额 + 审计 */
async function applyChangePackage(
  db: Db,
  task: ProvisionTaskRow,
  service: typeof services.$inferSelect,
  target: ChangePackageTarget,
  payload: unknown,
): Promise<void> {
  // 续费金额：payload 显式给 targetRenewalPrice（升级订单 meta）优先，否则按目标商品重算
  const explicitRenewal = readPayloadNumber(payload, "targetRenewalPrice");
  const renewalAmount =
    explicitRenewal !== undefined
      ? Math.max(0, explicitRenewal)
      : await recalcRenewalAmount(db, target.productId, target.cycle, target.config);

  const targetRows = await db.select().from(products).where(eq(products.id, target.productId)).limit(1);
  const targetProduct = targetRows[0];

  await db
    .update(services)
    .set({
      productId: target.productId,
      cycle: target.cycle,
      config: (target.config ?? service.config ?? {}) as Json,
      renewalAmount,
      // 套餐变更同步刷新模块与配置快照（与 createServiceFromOrderItem 行为一致）
      ...(targetProduct ? { moduleCode: targetProduct.moduleCode, moduleConfig: targetProduct.moduleConfig } : {}),
    })
    .where(eq(services.id, service.id));

  await db.insert(auditLogs).values({
    actorType: "system",
    actorId: null,
    actorName: "provisioning",
    action: "service.package_changed",
    targetType: "service",
    targetId: String(service.id),
    before: {
      productId: service.productId,
      cycle: service.cycle,
      renewalAmount: service.renewalAmount,
    } as Json,
    after: {
      productId: target.productId,
      cycle: target.cycle,
      renewalAmount,
      config: target.config ?? null,
    } as Json,
  });
}

/** 目标订单全部服务 active 后将 paid 订单推进为 completed（SPEC：由 worker 侧调用） */
async function maybeCompleteOrder(db: Db, orderId: number | null): Promise<void> {
  if (orderId == null) return;
  const orderRows = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (orderRows[0]?.status !== "paid") return;
  const serviceRows = await db
    .select({ status: services.status })
    .from(services)
    .where(eq(services.orderId, orderId));
  if (serviceRows.length === 0 || !serviceRows.every((s) => s.status === "active")) return;
  await db.transaction(async (tx) => {
    await completeOrder(tx, orderId);
  });
  log.info({ orderId }, "订单全部服务已开通，推进为 completed");
}

// —— 任务结果落库 ——

async function markSucceeded(db: Db, task: ProvisionTaskRow, result: ModuleResult): Promise<void> {
  await db
    .update(provisionTasks)
    .set({
      status: "succeeded",
      result: result as unknown as Json,
      lastError: null,
      executedAt: new Date(),
    })
    .where(eq(provisionTasks.id, task.id));
  log.info({ taskId: task.id, action: task.action }, "供应任务执行成功");
}

/** 失败落库：attempts 耗尽 → dead + provision.task_failed 事件；否则 failed 等待退避重试 */
async function markFailure(db: Db, task: ProvisionTaskRow, message: string): Promise<void> {
  const dead = task.attempts >= task.maxAttempts;
  await db
    .update(provisionTasks)
    .set({
      status: dead ? "dead" : "failed",
      lastError: message.slice(0, 2000),
      executedAt: new Date(),
    })
    .where(eq(provisionTasks.id, task.id));

  if (dead) {
    log.error({ taskId: task.id, action: task.action, attempts: task.attempts, err: message }, "供应任务最终失败（dead）");
    await emitEvent(db, EVENT_NAMES.provisionTaskFailed, {
      taskId: task.id,
      serviceId: task.serviceId,
      action: task.action,
      error: message.slice(0, 500),
    });
  } else {
    log.warn({ taskId: task.id, action: task.action, attempts: task.attempts, err: message }, "供应任务执行失败，等待退避重试");
  }
}

// —— 后台人工操作 ——

/** 重试任务（仅 failed/dead）：重置 attempts 后重新入队 */
export async function retryTask(db: Db, taskId: number): Promise<void> {
  const res = await db
    .update(provisionTasks)
    .set({ status: "queued", attempts: 0, lastError: null })
    .where(and(eq(provisionTasks.id, taskId), inArray(provisionTasks.status, ["failed", "dead"])));
  if (res[0].affectedRows === 0) {
    const rows = await db.select({ status: provisionTasks.status }).from(provisionTasks).where(eq(provisionTasks.id, taskId)).limit(1);
    if (!rows[0]) throw appError("NOT_FOUND", `供应任务不存在（#${taskId}）`);
    throw appError("CONFLICT", `任务当前状态 ${rows[0].status} 不可重试`);
  }
  await enqueueJob("provision.task", { taskId });
  log.info({ taskId }, "供应任务已重新入队");
}

/** 跳过任务（仅 queued/failed）：标记 skipped 并记录原因 */
export async function skipTask(db: Db, taskId: number, reason: string): Promise<void> {
  const res = await db
    .update(provisionTasks)
    .set({
      status: "skipped",
      result: { ok: false, skipped: true, reason } as unknown as Json,
      lastError: reason.slice(0, 2000),
      executedAt: new Date(),
    })
    .where(and(eq(provisionTasks.id, taskId), inArray(provisionTasks.status, ["queued", "failed"])));
  if (res[0].affectedRows === 0) {
    const rows = await db.select({ status: provisionTasks.status }).from(provisionTasks).where(eq(provisionTasks.id, taskId)).limit(1);
    if (!rows[0]) throw appError("NOT_FOUND", `供应任务不存在（#${taskId}）`);
    throw appError("CONFLICT", `任务当前状态 ${rows[0].status} 不可跳过`);
  }
  log.info({ taskId, reason }, "供应任务已跳过");
}

// —— cron 兜底扫描 ——

/**
 * 兜底扫描（provision.retry_scan，cron 每 10 分钟）：
 * 0) processing 滞留 > 30min → 崩溃恢复，重新排队；
 * 1) queued 滞留 > 5min（队列投递丢失）→ 立即执行；
 * 2) failed 且退避时间已到 → 重试执行。
 * 直接调用 runProvisionTask（原子领取保证并发安全），并统计本轮结果。
 */
export async function processQueuedTasks(
  db: Db,
  limit = 50,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const now = new Date();

  // 0) 崩溃恢复：worker 中断导致 processing 永久滞留 → 重新排队
  await db
    .update(provisionTasks)
    .set({ status: "queued" })
    .where(
      and(
        eq(provisionTasks.status, "processing"),
        lt(provisionTasks.updatedAt, new Date(now.getTime() - STALE_PROCESSING_MS)),
      ),
    );

  // 1) queued 滞留（投递丢失兜底）
  const staleQueued = await db
    .select({ id: provisionTasks.id })
    .from(provisionTasks)
    .where(
      and(
        eq(provisionTasks.status, "queued"),
        lt(provisionTasks.createdAt, new Date(now.getTime() - STALE_QUEUED_MS)),
      ),
    )
    .orderBy(asc(provisionTasks.id))
    .limit(limit);

  // 2) failed 退避重试（SQL 先按最小退避粗筛，再按各行退避精确过滤）
  const failedRows = await db
    .select({ id: provisionTasks.id, attempts: provisionTasks.attempts, updatedAt: provisionTasks.updatedAt })
    .from(provisionTasks)
    .where(
      and(
        eq(provisionTasks.status, "failed"),
        lte(provisionTasks.updatedAt, new Date(now.getTime() - RETRY_BACKOFF_BASE_MS)),
      ),
    )
    .orderBy(asc(provisionTasks.id))
    .limit(limit);
  const retryIds = failedRows
    .filter((t) => now.getTime() - t.updatedAt.getTime() >= retryBackoffMs(t.attempts))
    .map((t) => t.id);

  const ids = [...new Set([...staleQueued.map((r) => r.id), ...retryIds])].slice(0, limit);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  for (const taskId of ids) {
    await runProvisionTask(db, taskId);
    processed += 1;
    const rows = await db
      .select({ status: provisionTasks.status })
      .from(provisionTasks)
      .where(eq(provisionTasks.id, taskId))
      .limit(1);
    const status = rows[0]?.status;
    if (status === "succeeded" || status === "skipped") succeeded += 1;
    else failed += 1;
  }

  if (processed > 0) {
    log.info({ processed, succeeded, failed }, "兜底扫描完成");
  }
  return { processed, succeeded, failed };
}

// —— 工具函数 ——

/** 合并交付信息：既有 deliverInfo 为底，模块新返回覆盖 */
function mergeDeliverInfo(existing: unknown, incoming: Record<string, unknown> | undefined): Json | undefined {
  const base = (existing ?? {}) as Json;
  if (!incoming || Object.keys(incoming).length === 0) {
    return Object.keys(base).length > 0 ? base : undefined;
  }
  return { ...base, ...incoming };
}

/** payload 顶层字符串字段 */
function readPayloadString(payload: unknown, key: string): string | undefined {
  const value = (payload as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : undefined;
}

/** payload 顶层数值字段 */
function readPayloadNumber(payload: unknown, key: string): number | undefined {
  const value = (payload as Record<string, unknown> | null)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 解析 change_package 任务 payload，兼容两种形状：
 * - SPEC 形状：payload.target = { productId, cycle, config }
 * - markOrderPaid（升级订单）形状：{ targetProductId, cycle, targetRenewalPrice, creditFromOld }
 */
function resolveChangeTarget(
  payload: unknown,
  service: typeof services.$inferSelect,
): ChangePackageTarget {
  const p = (payload ?? {}) as Record<string, unknown>;
  const t = (p.target ?? {}) as Record<string, unknown>;
  const rawCycle = t.cycle ?? p.cycle;
  const cycle: BillingCycle =
    typeof rawCycle === "string" && (billingCycleEnum.options as readonly string[]).includes(rawCycle)
      ? (rawCycle as BillingCycle)
      : service.cycle;
  const productId =
    readNumber(t.productId) ?? readNumber(p.targetProductId) ?? service.productId;
  const config = (t.config ?? p.config) as Record<string, unknown> | undefined;
  return {
    productId,
    cycle,
    config: config && typeof config === "object" ? config : {},
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 按目标商品 + 周期重算续费金额：pricing.renewalPrice + Σ(option.priceDelta × quantity)。
 * config 为 quoteProduct 的配置快照形状：{ options: [{ quantity, options: [{ id }] }] }。
 * 商品缺少该周期定价时抛 CATALOG_NOT_FOUND（任务进入失败轨道）。
 */
async function recalcRenewalAmount(
  db: Db,
  productId: number,
  cycle: BillingCycle,
  config: unknown,
): Promise<number> {
  const pricingRows = await db
    .select()
    .from(productPricing)
    .where(and(eq(productPricing.productId, productId), eq(productPricing.cycle, cycle)))
    .limit(1);
  const pricing = pricingRows[0];
  if (!pricing) {
    throw appError("CATALOG_NOT_FOUND", `目标商品 #${productId} 不支持计费周期 ${cycle}`);
  }

  const quantities = new Map<number, number>();
  const options = (config as { options?: unknown } | null)?.options;
  if (Array.isArray(options)) {
    for (const selection of options) {
      const sel = selection as { quantity?: unknown; options?: unknown };
      const qty = typeof sel.quantity === "number" && sel.quantity > 0 ? sel.quantity : 1;
      if (!Array.isArray(sel.options)) continue;
      for (const option of sel.options) {
        const optionId = (option as { id?: unknown }).id;
        if (typeof optionId === "number") quantities.set(optionId, qty);
      }
    }
  }

  let delta = 0;
  if (quantities.size > 0) {
    const optionRows = await db
      .select({ id: configOptions.id, priceDelta: configOptions.priceDelta })
      .from(configOptions)
      .where(inArray(configOptions.id, [...quantities.keys()]));
    for (const row of optionRows) {
      delta += row.priceDelta * (quantities.get(row.id) ?? 1);
    }
  }
  return Math.max(0, pricing.renewalPrice + delta);
}
