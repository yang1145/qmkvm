import type { MiddlewareHandler } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

export function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const rid = `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    c.set("requestId", rid);
    c.header("X-Request-Id", rid);
    await next();
  };
}

/** 客户端 IP：优先代理头；本机直连时退化为 unknown（限流按 unknown 聚合，开发可接受） */
export function getClientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}
