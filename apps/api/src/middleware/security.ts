import type { MiddlewareHandler } from "hono";
import { env } from "../env.js";

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "DENY");
    await next();
  };
}

/** CSRF 防护：写操作校验 Origin（同源请求无 Origin 时放行） */
export function originCheck(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
    const path = c.req.path;
    // 网关回调由签名验证，不走 Origin 校验
    if (path.startsWith("/api/v1/webhooks/")) return next();

    const origin = c.req.header("origin");
    if (!origin) return next(); // 同源 fetch/工具调用
    if (env.corsOrigins.length === 0) return next(); // 未配置时不限制（开发）
    if (env.corsOrigins.includes(origin)) return next();
    console.error(
      JSON.stringify({ level: "warn", msg: "origin_rejected", origin, allow: env.corsOrigins }),
    );
    return c.json(
      {
        code: "PERM_DENIED",
        message: "来源不被允许",
        requestId: c.get("requestId") ?? "req_unknown",
      },
      403,
    );
  };
}

export function cors(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && (env.corsOrigins.length === 0 || env.corsOrigins.includes(origin))) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  };
}
