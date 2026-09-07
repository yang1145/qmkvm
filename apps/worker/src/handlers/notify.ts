/**
 * notify 组 handler：站内/短信/邮件通知。
 *
 * 职责：notify.user —— 按事件名渲染模板并多通道发送（notifications 包）。
 * 订阅队列：kvm-notify（分组模式）/ kvm（单队列模式兜底）。
 * 凭据边界：短信/邮件通道凭据由 notifications 包按 db 配置读取，
 * 本文件不直接触达任何凭据调用点。
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@qmkvm/db";
import { registerJobHandler } from "@qmkvm/core";
import { notifyUserAllChannels } from "@qmkvm/notifications";
import { logger } from "@qmkvm/logger";

const log = logger.child({ module: "worker:notify" });
type Db = ReturnType<typeof getDb>;

/** notify 组注册：站内/短信/邮件通知 */
export function registerNotifyHandlers(db: Db): void {
  registerJobHandler(
    "notify.user",
    async (data: { userId?: number | string; event?: string; vars?: Record<string, unknown> }) => {
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, Number(data?.userId)))
        .limit(1);
      const user = rows[0];
      if (!user) {
        log.warn({ userId: data?.userId, event: data?.event }, "通知目标用户不存在，跳过");
        return;
      }
      await notifyUserAllChannels(db, {
        user,
        event: String(data?.event ?? ""),
        vars: data?.vars ?? {},
      });
    },
  );
}