import { enqueueJob, ocrVerifyHandler, registerJobHandler } from "@qmkvm/core";
import { processPaymentEvent, registerPaymentJobHandlers } from "@qmkvm/payments";
import { getDb, schema } from "@qmkvm/db";
import { eq } from "drizzle-orm";
import { notifyUserAllChannels } from "@qmkvm/notifications";
import { logger } from "@qmkvm/logger";

/**
 * 队列任务处理器注册：API 进程（inline 降级模式）与 Worker 进程共用。
 * API 启动时注册后，无 Redis 环境下 enqueueJob 直接在本进程内联执行，
 * 保证开发环境不依赖 Redis 即可跑通全链路。
 */
export function registerJobHandlers() {
  const db = getDb();

  // 支付回调事件处理（payments 包内注册）
  registerPaymentJobHandlers(db);

  registerJobHandler("payment.process_event", async (data: { eventId: number | string }) => {
    const d = getDb();
    await processPaymentEvent(d, Number(data.eventId));
  });

  registerJobHandler("provision.task", async (data: { taskId: number }) => {
    const { runProvisionTask } = await import("@qmkvm/provisioning");
    const d = getDb();
    await runProvisionTask(d, data.taskId);
  });

  registerJobHandler("provision.retry", async (data: { taskId: number }) => {
    const { runProvisionTask } = await import("@qmkvm/provisioning");
    const d = getDb();
    await runProvisionTask(d, data.taskId);
  });

  registerJobHandler("notify.user", async (data: { userId: number; event: string; vars: Record<string, unknown> }) => {
    const d = getDb();
    const rows = await d.select().from(schema.users).where(eq(schema.users.id, data.userId)).limit(1);
    const user = rows[0];
    if (!user) return;
    await notifyUserAllChannels(d, {
      user: { id: user.id, email: user.email, phone: user.phone, name: user.name },
      event: data.event,
      vars: data.vars,
    });
  });

  // 无目标用户的领域事件：P0 记录日志（告警类后续接 IM webhook）
  registerJobHandler("domain.event", async (data: { event: string; payload?: Record<string, unknown> }) => {
    logger.warn({ event: data.event, payload: data.payload }, "[domain.event] 无目标用户事件（P0 仅记录）");
  });

  // OCR 异步识别（inline 降级模式下在 API 进程内联执行；Redis 模式由 ocr 组 worker 消费）
  // 识别 + 回写实现在 core（ocr/verify.ts），与 worker 侧共用同一份逻辑
  registerJobHandler("ocr.verify", async (data: { profileId: number | string; submittedIdNumber?: string | null }) => {
    await ocrVerifyHandler(getDb(), data);
  });

  logger.info("[wiring] job handlers registered");
}

export { enqueueJob };
