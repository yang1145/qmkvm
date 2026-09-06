import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, users as usersTable } from "@pinhaoji/db";

type User = typeof usersTable.$inferSelect;
import {
  smsSendSchema,
  smsLoginSchema,
  emailRegisterSchema,
  passwordLoginSchema,
  forgotPasswordSchema,
  resetPasswordBySmsSchema,
  resetPasswordByTokenSchema,
  changePasswordSchema,
  bindPhoneSchema,
} from "@pinhaoji/contracts";
import {
  issueSmsCode,
  verifySmsCode,
  registerOrLoginBySms,
  registerByEmail,
  authenticatePassword,
  requestPasswordReset,
  resetPasswordBySms,
  resetPasswordByToken,
  changePassword,
  bindPhone,
  createPortalSession,
  revokePortalSession,
} from "@pinhaoji/auth";
import { sendSms, sendEmail } from "@pinhaoji/notifications";
import { getClientIp } from "../../middleware/request-id.js";
import { rateLimit, setPortalCookie, clearPortalCookie, requireAuth, getPortalToken } from "../../middleware/auth.js";
import { env } from "../../env.js";

function userPayload(u: User) {
  return {
    id: u.id,
    phone: u.phone,
    email: u.email,
    name: u.name,
    creditBalance: Number(u.creditBalance ?? 0),
    createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
  };
}

async function login(c: any, userId: number) {
  const db = getDb();
  const { token, expiresAt } = await createPortalSession(db, userId, {
    ip: getClientIp(c),
    ua: c.req.header("user-agent")?.slice(0, 250),
  });
  const maxAge = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  setPortalCookie(c, token, maxAge);
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, userId));
  return token;
}

export const portalAuthRoutes = new Hono();

/** 发送短信验证码 */
portalAuthRoutes.post("/sms/send", rateLimit("auth:sms", 5, 60), async (c) => {
  const body = smsSendSchema.parse(await c.req.json());
  await issueSmsCode(getDb(), {
    phone: body.phone,
    purpose: body.purpose,
    ip: getClientIp(c),
    send: async (phone, text) => { await sendSms(phone, text); },
  });
  return c.json({ ok: true });
});

/** 手机号 + 验证码：注册登录合一 */
portalAuthRoutes.post("/sms/login", rateLimit("auth:login", 10, 15 * 60), async (c) => {
  const body = smsLoginSchema.parse(await c.req.json());
  const db = getDb();
  const ok = await verifySmsCode(db, { phone: body.phone, purpose: "login", code: body.code });
  if (!ok) return c.json({ code: "AUTH_SMS_CODE_INVALID", message: "验证码错误或已过期", requestId: c.get("requestId") }, 401);
  const user = await registerOrLoginBySms(db, {
    phone: body.phone,
    name: body.name ?? null,
    ip: getClientIp(c),
  });
  await login(c, user.id);
  return c.json({ user: userPayload(user) });
});

/** 邮箱注册 */
portalAuthRoutes.post("/register", rateLimit("auth:register", 10, 15 * 60), async (c) => {
  const body = emailRegisterSchema.parse(await c.req.json());
  const user = await registerByEmail(getDb(), {
    email: body.email,
    password: body.password,
    name: body.name ?? null,
    ip: getClientIp(c),
  });
  await login(c, user.id);
  return c.json({ user: userPayload(user) });
});

/** 密码登录（邮箱或手机号） */
portalAuthRoutes.post("/login", rateLimit("auth:login", 10, 15 * 60), async (c) => {
  const body = passwordLoginSchema.parse(await c.req.json());
  const user = await authenticatePassword(getDb(), body.login, body.password);
  await login(c, user.id);
  return c.json({ user: userPayload(user) });
});

portalAuthRoutes.post("/logout", async (c) => {
  const token = getPortalToken(c);
  if (token) await revokePortalSession(getDb(), token);
  clearPortalCookie(c);
  return c.json({ ok: true });
});

/** 忘记密码：发送重置短信/邮件 */
portalAuthRoutes.post("/forgot-password", rateLimit("auth:forgot", 5, 15 * 60), async (c) => {
  const body = forgotPasswordSchema.parse(await c.req.json());
  await requestPasswordReset(getDb(), {
    phone: body.phone,
    email: body.email,
    sendSms: async (phone, text) => { await sendSms(phone, text); },
    sendEmail: async (to, subject, html) => { await sendEmail(to, subject, html); },
  });
  // 不暴露账号是否存在
  return c.json({ ok: true });
});

/** 手机验证码重置密码 */
portalAuthRoutes.post("/reset-password/sms", rateLimit("auth:reset", 10, 15 * 60), async (c) => {
  const body = resetPasswordBySmsSchema.parse(await c.req.json());
  await resetPasswordBySms(getDb(), body);
  return c.json({ ok: true });
});

/** 邮箱令牌重置密码 */
portalAuthRoutes.post("/reset-password/token", rateLimit("auth:reset", 10, 15 * 60), async (c) => {
  const body = resetPasswordByTokenSchema.parse(await c.req.json());
  await resetPasswordByToken(getDb(), body);
  return c.json({ ok: true });
});

// —— 以下需登录 ——
portalAuthRoutes.use("/change-password", requireAuth());
portalAuthRoutes.use("/bind-phone", requireAuth());

portalAuthRoutes.post("/change-password", async (c) => {
  const body = changePasswordSchema.parse(await c.req.json());
  const token = getPortalToken(c) ?? "";
  await changePassword(getDb(), c.get("user").id, body.currentPassword, body.newPassword, {
    keepToken: token,
  });
  return c.json({ ok: true });
});

portalAuthRoutes.post("/bind-phone", async (c) => {
  const body = bindPhoneSchema.parse(await c.req.json());
  const token = getPortalToken(c) ?? "";
  await bindPhone(getDb(), c.get("user").id, body, { keepToken: token });
  return c.json({ ok: true });
});

export { userPayload };
