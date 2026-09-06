import { Hono } from "hono";
import { getDb } from "@pinhaoji/db";
import { handleGatewayCallback } from "@pinhaoji/payments";
import { logger } from "@pinhaoji/logger";

/**
 * 网关异步回调：
 * - 无 Origin 校验（由签名验证），无会话；
 * - 必须读取原始 body（c.req.text()）供验签；
 * - 应答各自网关要求的 ack 格式。
 */
export const webhookRoutes = new Hono();

webhookRoutes.post("/alipay", async (c) => {
  const db = getDb();
  const rawBody = await c.req.text();
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const headers = Object.fromEntries(Object.entries(c.req.header()));
  try {
    const res = await handleGatewayCallback(db, "alipay", { headers, rawBody, query });
    if (res.status === 200) return c.text("success");
    return c.text("fail", res.status as 401);
  } catch (err) {
    logger.error(`[webhook:alipay] ${String(err)}`);
    return c.text("fail", 500);
  }
});

webhookRoutes.post("/wechat", async (c) => {
  const db = getDb();
  const rawBody = await c.req.text();
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const headers = Object.fromEntries(Object.entries(c.req.header()));
  try {
    const res = await handleGatewayCallback(db, "wechat", { headers, rawBody, query });
    if (res.status === 200) return c.json({ code: "SUCCESS", message: "成功" });
    return c.json({ code: "FAIL", message: "验签或处理失败" }, res.status as 401);
  } catch (err) {
    logger.error(`[webhook:wechat] ${String(err)}`);
    return c.json({ code: "FAIL", message: "处理异常" }, 500);
  }
});
