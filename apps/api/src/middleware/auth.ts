import type { MiddlewareHandler } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { schema } from "@pinhaoji/db";
import type { PermissionKey } from "@pinhaoji/contracts";
import {
  resolvePortalSession,
  resolveAdminSession,
  enforceRateLimit,
} from "@pinhaoji/auth";
import { appError } from "@pinhaoji/core";
import { getDb } from "@pinhaoji/db";
import { COOKIE_ADMIN, COOKIE_PORTAL, env } from "../env.js";
import { getClientIp } from "./request-id.js";

export type PortalUser = typeof schema.users.$inferSelect;

export type AdminContext = {
  adminId: number;
  adminName: string | null;
  username: string;
  permissions: PermissionKey[];
  isSuper: boolean;
};

declare module "hono" {
  interface ContextVariableMap {
    user: PortalUser;
    admin: AdminContext;
  }
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: env.isProd,
    path: "/",
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
  };
}

export function setPortalCookie(c: { set: (k: string, v: string, o?: object) => void }, token: string, maxAgeSec: number) {
  setCookie(c as never, COOKIE_PORTAL, token, { ...sessionCookieOptions(), maxAge: maxAgeSec });
}
export function clearPortalCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c as never, COOKIE_PORTAL, { path: "/", ...(env.cookieDomain ? { domain: env.cookieDomain } : {}) });
}
export function setAdminCookie(c: { set: (k: string, v: string, o?: object) => void }, token: string, maxAgeSec: number) {
  setCookie(c as never, COOKIE_ADMIN, token, { ...sessionCookieOptions(), maxAge: maxAgeSec });
}
export function clearAdminCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c as never, COOKIE_ADMIN, { path: "/", ...(env.cookieDomain ? { domain: env.cookieDomain } : {}) });
}

export function getPortalToken(c: { req: { raw: Request } }): string | null {
  return getCookie(c as never, COOKIE_PORTAL) ?? null;
}
export function getAdminToken(c: { req: { raw: Request } }): string | null {
  return getCookie(c as never, COOKIE_ADMIN) ?? null;
}

/** 门户会话鉴权：user 挂到 c.var.user */
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const token = getPortalToken(c);
    if (!token) throw appError("AUTH_REQUIRED", "请先登录");
    const user = await resolvePortalSession(getDb(), token);
    if (!user) throw appError("AUTH_SESSION_EXPIRED", "登录已过期，请重新登录");
    if (user.status === "disabled") throw appError("AUTH_DISABLED", "账户已被禁用");
    c.set("user", user);
    await next();
  };
}

/** 后台鉴权：perm 缺省只要求登录；指定权限点时校验（isSuper 跳过） */
export function requireAdmin(perm?: PermissionKey): MiddlewareHandler {
  return async (c, next) => {
    const token = getAdminToken(c);
    if (!token) throw appError("AUTH_REQUIRED", "请先登录管理后台");
    const session = await resolveAdminSession(getDb(), token);
    if (!session) throw appError("AUTH_SESSION_EXPIRED", "登录已过期，请重新登录");
    if (session.admin.status === "disabled") throw appError("AUTH_DISABLED", "账户已被禁用");
    const ctx: AdminContext = {
      adminId: session.admin.id,
      adminName: session.admin.name,
      username: session.admin.username,
      permissions: session.permissions,
      isSuper: session.isSuper,
    };
    c.set("admin", ctx);
    if (perm && !ctx.isSuper && !ctx.permissions.includes(perm)) {
      throw appError("PERM_DENIED", "没有执行该操作的权限");
    }
    await next();
  };
}

/** 路由组限流：name 为业务标识，与 IP 组合作为限流 key */
export function rateLimit(name: string, limit: number, windowSec: number): MiddlewareHandler {
  return async (c, next) => {
    const ip = getClientIp(c);
    await enforceRateLimit(`${name}:${ip}`, { limit, windowSec });
    await next();
  };
}
