/**
 * 服务生命周期 · 基础动作：建服务、建供应任务、状态变更（含审计）、后台手工标记开通。
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@pinhaoji/db/client";
import type { Json } from "@pinhaoji/db/schema";
import { billingCycleEnum, type BillingCycle } from "@pinhaoji/contracts";
import { appError } from "../errors.js";
import { addCycle, todayStr } from "../date-utils.js";

const { services, provisionTasks, auditLogs, orders, orderItems, products } = schema;

/** 事务对象类型（由 Db.transaction 回调参数反推，保持与 db 包解耦） */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** 可执行查询的对象：连接池 db 或事务 tx */
export type DbLike = Db | Tx;

export type ServiceRow = typeof services.$inferSelect;
export type ProvisionTaskRow = typeof provisionTasks.$inferSelect;
export type ServiceStatus = ServiceRow["status"];
type ProvisionAction = typeof provisionTasks.$inferInsert.action;

/** 供应任务入队（queue.ts 由并行同事实现，动态导入解耦，缺省时仅记日志不影响主流程） */
async function enqueueJobSafe(job: string, data: unknown, opts?: { delayMs?: number; jobId?: string; attempts?: number }): Promise<void> {
  const { enqueueJob } = await import("../queue.js");
  await enqueueJob(job, data, opts);
}

/** —— 设置读取 —— */

/** 读取数值型设置（settings.value 为 JSON：数字、数字字符串或 { v: number } 均可），缺省/非法回退 fallback */
export async function readSettingNumber(db: DbLike, key: string, fallback: number): Promise<number> {
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);
  const raw = rows[0]?.value as unknown;
  return parseSettingNumber(raw) ?? fallback;
}

function parseSettingNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof raw === "object" && raw !== null && "v" in (raw as Record<string, unknown>)) {
    return parseSettingNumber((raw as Record<string, unknown>).v);
  }
  return undefined;
}

/** —— 建服务 —— */

export interface CreateServiceFromOrderItemInput {
  order: typeof orders.$inferSelect;
  item: typeof orderItems.$inferSelect;
  product: typeof products.$inferSelect;
}

/**
 * 由订单项创建服务实例（markOrderPaid 的 new 型 item 调用）。
 * cycle/firstAmount/renewalAmount/config 取自 item.meta（下单时快照）；
 * status=pending、next_due_date=null，开通成功时由任务执行器/手工开通再写入到期日。
 */
export async function createServiceFromOrderItem(
  tx: Tx,
  input: CreateServiceFromOrderItemInput,
): Promise<ServiceRow> {
  const { order, item, product } = input;
  const meta = (item.meta ?? {}) as {
    cycle?: unknown;
    firstAmount?: unknown;
    renewalAmount?: unknown;
    config?: unknown;
  };

  if (!(billingCycleEnum.options as readonly string[]).includes(String(meta.cycle))) {
    throw appError("VALIDATION_FAILED", `订单项缺少有效计费周期（orderItem #${item.id}）`);
  }
  const cycle = meta.cycle as BillingCycle;
  const firstAmount = typeof meta.firstAmount === "number" ? meta.firstAmount : item.amount;
  const renewalAmount = typeof meta.renewalAmount === "number" ? meta.renewalAmount : 0;
  const config = (meta.config ?? {}) as Json;

  // 名称序号：同一用户同一商品下自增（"商品名 #N"）
  const seqRows = await tx
    .select({ count: sql<number>`count(*)` })
    .from(services)
    .where(and(eq(services.userId, order.userId), eq(services.productId, product.id)));
  const seq = Number(seqRows[0]?.count ?? 0) + 1;

  const inserted = await tx
    .insert(services)
    .values({
      userId: order.userId,
      productId: product.id,
      orderId: order.id,
      name: `${product.name} #${seq}`,
      status: "pending",
      cycle,
      firstAmount,
      renewalAmount,
      config,
      moduleCode: product.moduleCode,
      moduleConfig: product.moduleConfig,
      nextDueDate: null,
    });
  const serviceId = inserted[0].insertId;

  const rows = await tx.select().from(services).where(eq(services.id, serviceId)).limit(1);
  const service = rows[0];
  if (!service) {
    throw appError("SVC_NOT_FOUND", `服务创建失败（orderItem #${item.id}）`);
  }
  return service;
}

/** —— 供应任务 —— */

export interface CreateProvisionTaskInput {
  serviceId: number;
  orderId?: number;
  action: ProvisionAction;
  payload?: Json;
  createdById?: number;
}

/** 创建供应任务并入队执行（原子领取在 runner 侧完成，重复投递安全） */
export async function createProvisionTask(
  db: DbLike,
  input: CreateProvisionTaskInput,
): Promise<ProvisionTaskRow> {
  const inserted = await db
    .insert(provisionTasks)
    .values({
      serviceId: input.serviceId,
      orderId: input.orderId ?? null,
      action: input.action,
      payload: input.payload ?? null,
      createdById: input.createdById ?? null,
    });
  const taskId = inserted[0].insertId;

  const rows = await db.select().from(provisionTasks).where(eq(provisionTasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) {
    throw appError("INTERNAL", `供应任务创建失败（service #${input.serviceId}）`);
  }
  await enqueueJobSafe("provision.task", { taskId });
  return task;
}

/** 是否已有在途（queued/processing/failed，会被重试）的同动作任务，用于定时任务去重 */
async function hasPendingTask(db: DbLike, serviceId: number, action: ProvisionAction): Promise<boolean> {
  const rows = await db
    .select({ id: provisionTasks.id })
    .from(provisionTasks)
    .where(
      and(
        eq(provisionTasks.serviceId, serviceId),
        eq(provisionTasks.action, action),
        inArray(provisionTasks.status, ["queued", "processing", "failed"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** —— 状态变更（审计封装） —— */

/** 允许随状态一并写入的字段（如暂停/终止时间、到期日、交付信息） */
export interface ServiceStatusExtra {
  nextDueDate?: string | null;
  deliverInfo?: Json;
  config?: Json;
  moduleConfig?: Json;
  suspendedAt?: Date | null;
  terminatedAt?: Date | null;
  cancelledAt?: Date | null;
}

/** 更新服务状态并写审计日志（actorType=system；管理员动作请另行写 admin 审计） */
export async function updateServiceStatus(
  db: DbLike,
  serviceId: number,
  status: ServiceStatus,
  extra?: ServiceStatusExtra,
): Promise<void> {
  const rows = await db
    .select({ status: services.status })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  const before = rows[0];
  if (!before) {
    throw appError("SVC_NOT_FOUND", `服务不存在（#${serviceId}）`);
  }
  if (before.status === status && !extra) return; // 幂等：状态未变且无附加字段

  await db
    .update(services)
    .set({ status, ...(extra ?? {}) })
    .where(eq(services.id, serviceId));

  await db.insert(auditLogs).values({
    actorType: "system",
    actorId: null,
    actorName: "system",
    action: "service.status_changed",
    targetType: "service",
    targetId: String(serviceId),
    before: { status: before.status } as Json,
    after: { status, ...(extra ?? {}) } as Json,
  });
}

/** —— 后台手工标记开通（manual 模块配套） —— */

export interface ManualCompleteInput {
  /** 交付信息（IP/密码等），与既有 deliverInfo 合并落库 */
  deliverInfo?: Json;
  /** 是否同时激活服务（默认 true；false 时仅落交付信息） */
  activate?: boolean;
}

/**
 * 后台「标记已开通」：service → active、next_due_date = addCycle(today, cycle)、
 * deliverInfo 落库、挂起未完成的 provision 任务、审计（actor=admin）并通知用户。
 */
export async function manuallyCompleteProvision(
  db: Db,
  adminId: number,
  serviceId: number,
  input: ManualCompleteInput = {},
): Promise<ServiceRow> {
  const { activate = true, deliverInfo } = input;
  const rows = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  const service = rows[0];
  if (!service) {
    throw appError("SVC_NOT_FOUND", `服务不存在（#${serviceId}）`);
  }
  if (service.status === "terminated" || service.status === "cancelled") {
    throw appError("SVC_STATUS_INVALID", `服务当前状态 ${service.status} 不允许标记开通`);
  }

  const nextDue = service.cycle === "onetime" ? null : addCycle(todayStr(), service.cycle);
  const mergedDeliverInfo: Json = {
    ...((service.deliverInfo ?? {}) as Json),
    ...(deliverInfo ?? {}),
  };
  const targetStatus: ServiceStatus = activate ? "active" : service.status;

  await db.transaction(async (tx) => {
    if (activate) {
      // 未完成的开通任务标记 skipped，避免任务执行器重复开通
      await tx
        .update(provisionTasks)
        .set({ status: "skipped" })
        .where(
          and(
            eq(provisionTasks.serviceId, serviceId),
            eq(provisionTasks.action, "provision"),
            inArray(provisionTasks.status, ["queued", "failed"]),
          ),
        );
    }
    await tx
      .update(services)
      .set({
        status: targetStatus,
        nextDueDate: activate ? nextDue : service.nextDueDate,
        deliverInfo: mergedDeliverInfo,
      })
      .where(eq(services.id, serviceId));
    await tx.insert(auditLogs).values({
      actorType: "admin",
      actorId: adminId,
      action: "service.manual_complete",
      targetType: "service",
      targetId: String(serviceId),
      before: { status: service.status, deliverInfo: (service.deliverInfo ?? null) as Json | null } as Json,
      after: {
        status: targetStatus,
        nextDueDate: activate ? nextDue : service.nextDueDate,
        deliverInfo: mergedDeliverInfo,
      } as Json,
    });
  });

  if (activate) {
    await enqueueJobSafe("notify.user", {
      userId: service.userId,
      event: "service.activated",
      vars: { serviceName: service.name, serviceId: service.id },
    });
  }

  const updated = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  const result = updated[0];
  if (!result) {
    throw appError("SVC_NOT_FOUND", `服务不存在（#${serviceId}）`);
  }
  return result;
}

export { hasPendingTask };
