import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { errorHandler } from "./middleware/error.js";
import { securityHeaders, originCheck, cors } from "./middleware/security.js";
import { publicRoutes } from "./routes/public.js";
import { webhookRoutes } from "./routes/webhooks/index.js";
import { portalRoutes } from "./routes/portal/index.js";
import { adminRoutes } from "./routes/admin/index.js";
import { env } from "./env.js";
import { logger } from "@pinhaoji/logger";
import { registerJobHandlers } from "./wiring.js";

const app = new Hono();

app.use("*", requestIdMiddleware());
app.use("*", securityHeaders());
app.use("*", cors());
app.use("*", originCheck());

app.onError(errorHandler);

app.get("/healthz", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.route("/api/v1/public", publicRoutes);
app.route("/api/v1/webhooks", webhookRoutes);
app.route("/api/v1/portal", portalRoutes);
app.route("/api/v1/admin", adminRoutes);

app.notFound((c) =>
  c.json(
    { code: "NOT_FOUND", message: "接口不存在", requestId: c.get("requestId") ?? "req_unknown" },
    404,
  ),
);

// 注册队列任务处理器（含无 Redis 时的 inline 降级路径）
registerJobHandlers();

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  logger.info(`[api] listening on http://localhost:${info.port} (env=${process.env.NODE_ENV ?? "development"})`);
});

const shutdown = async () => {
  logger.info("[api] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
