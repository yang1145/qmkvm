/** 管理后台认证：登录（写审计）/ 登出 / 当前会话。 */
import { Hono } from "hono";
import { adminLoginSchema } from "@pinhaoji/contracts";
import { appError } from "@pinhaoji/core";
import { adminLogin, resolveAdminSession, revokeAdminSession } from "@pinhaoji/auth";
import { getDb } from "@pinhaoji/db";
import {
  rateLimit,
  requireAdmin,
  setAdminCookie,
  clearAdminCookie,
  getAdminToken,
} from "../../middleware/auth.js";
import { getClientIp } from "../../middleware/request-id.js";
import { iso, writeAdminAudit } from "./helpers.js";

/** adminDto 形状的安全视图 */
export function adminPayload(admin: {
  id: number;
  username: string;
  name: string | null;
  roleId: number | null;
  status: string;
  lastLoginAt: Date | null;
}) {
  return {
    id: admin.id,
    username: admin.username,
    name: admin.name,
    roleId: admin.roleId,
    status: admin.status as "active" | "disabled",
    lastLoginAt: iso(admin.lastLoginAt),
  };
}

export const adminAuthRoutes = new Hono();

/** 登录（限流 10 次/15 分钟/IP）：成功写审计 admin.login，失败由 core 写 admin.login_failed */
adminAuthRoutes.post("/login", rateLimit("admin:login", 10, 15 * 60), async (c) => {
  const body = adminLoginSchema.parse(await c.req.json());
  const db = getDb();
  const result = await adminLogin(db, body.username, body.password, {
    ip: getClientIp(c),
    ua: c.req.header("user-agent")?.slice(0, 250),
  });
  const maxAge = Math.max(60, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000));
  setAdminCookie(c, result.token, maxAge);
  await writeAdminAudit(
    c,
    { adminId: result.admin.id, adminName: result.admin.name },
    {
      action: "admin.login",
      targetType: "admin_user",
      targetId: result.admin.id,
      after: { username: result.admin.username },
    },
  );
  return c.json({
    admin: adminPayload(result.admin),
    permissions: result.permissions,
    isSuper: result.isSuper,
  });
});

/** 登出：吊销会话并清除 Cookie（会话已过期时静默成功） */
adminAuthRoutes.post("/logout", async (c) => {
  const token = getAdminToken(c);
  if (token) {
    const db = getDb();
    const session = await resolveAdminSession(db, token);
    await revokeAdminSession(db, token);
    if (session) {
      await writeAdminAudit(c, { adminId: session.admin.id, adminName: session.admin.name }, {
        action: "admin.logout",
        targetType: "admin_user",
        targetId: session.admin.id,
      });
    }
  }
  clearAdminCookie(c);
  return c.json({ ok: true });
});

/** 当前登录管理员 + 权限点 */
adminAuthRoutes.get("/me", requireAdmin(), async (c) => {
  const token = getAdminToken(c) ?? "";
  const session = await resolveAdminSession(getDb(), token);
  if (!session) throw appError("AUTH_SESSION_EXPIRED", "登录已过期，请重新登录");
  return c.json({
    admin: adminPayload(session.admin),
    permissions: session.permissions,
    isSuper: session.isSuper,
  });
});
