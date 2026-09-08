/**
 * 运维告警（钉钉/飞书机器人 webhook）：text 消息，飞书同格式兼容。
 * 未配置 ALERT_WEBHOOK_URL 时静默返回 false（调用方自行记日志）。
 */
import { logger } from "@qmkvm/logger";
import { workerEnv } from "./env.js";

const log = logger.child({ module: "worker:alert" });

export async function postAlert(content: string): Promise<boolean> {
  const url = workerEnv.alertWebhookUrl;
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content } }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "告警 webhook 响应异常");
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err }, "告警 webhook 发送失败");
    return false;
  } finally {
    clearTimeout(timer);
  }
}
