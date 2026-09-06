import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";

type User = typeof schema.users.$inferSelect;
import { updateProfileSchema } from "@pinhaoji/contracts";
import { aesDecrypt, aesEncrypt, revokeAllPortalSessions } from "@pinhaoji/auth";
import { requireAuth, clearPortalCookie } from "../../middleware/auth.js";
import { appError } from "@pinhaoji/core";

export const portalAccountRoutes = new Hono();
portalAccountRoutes.use("*", requireAuth());

portalAccountRoutes.get("/profile", (c) => {
  const u = c.get("user") as User;
  return c.json({
    id: u.id,
    phone: u.phone,
    email: u.email,
    name: u.name,
    creditBalance: Number(u.creditBalance ?? 0),
    createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
  });
});

portalAccountRoutes.put("/profile", async (c) => {
  const body = updateProfileSchema.parse(await c.req.json());
  const db = getDb();
  const userId = (c.get("user") as User).id;
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch["name"] = body.name;
  if (body.email !== undefined) {
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, body.email))
      .limit(1);
    if (existing[0] && existing[0].id !== userId) {
      throw appError("AUTH_EMAIL_EXISTS", "该邮箱已被其他账户绑定");
    }
    patch["email"] = body.email;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
  }
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const u = rows[0]!;
  return c.json({
    id: u.id,
    phone: u.phone,
    email: u.email,
    name: u.name,
    creditBalance: Number(u.creditBalance ?? 0),
    createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
  });
});

/** 会话列表 */
portalAccountRoutes.get("/sessions", async (c) => {
  const userId = (c.get("user") as User).id;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
    .orderBy(desc(schema.sessions.createdAt));
  return c.json({
    items: rows.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
      expiresAt: s.expiresAt instanceof Date ? s.expiresAt.toISOString() : String(s.expiresAt),
    })),
  });
});

/** 注销单个会话 */
portalAccountRoutes.delete("/sessions/:id", async (c) => {
  const userId = (c.get("user") as User).id;
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.id, c.req.param("id")), eq(schema.sessions.userId, userId)));
  return c.json({ ok: true });
});

/** 注销全部会话（保留当前） */
portalAccountRoutes.delete("/sessions", async (c) => {
  const userId = (c.get("user") as User).id;
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  // 重新为当前 token 建一个会话：直接保留当前会话的简化做法是撤销其它全部
  // （changePassword/revokeAll 场景由 auth 包处理）；此处当前会话也会被撤销，
  // 客户端将跳转登录页，符合「退出全部设备」语义。
  clearPortalCookie(c);
  return c.json({ ok: true });
});

/** 实名信息（脱敏展示） */
portalAccountRoutes.get("/identity", async (c) => {
  const userId = (c.get("user") as User).id;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  const p = rows[0];
  if (!p) return c.json({ status: "unverified" });
  let idNumberMasked: string | null = null;
  if (p.idNumberEnc) {
    try {
      const plain = aesDecrypt(p.idNumberEnc);
      idNumberMasked = plain.length > 5 ? `${plain.slice(0, 3)}****${plain.slice(-2)}` : "****";
    } catch {
      idNumberMasked = null;
    }
  }
  const realNameMasked = p.realName ? `${p.realName[0]}**` : null;
  return c.json({
    status: p.status,
    type: p.type,
    realName: realNameMasked,
    idNumberMasked,
    companyName: p.companyName,
    creditCode: p.creditCode ? `${p.creditCode.slice(0, 6)}****${p.creditCode.slice(-4)}` : null,
    rejectReason: p.rejectReason,
    verifiedAt: p.verifiedAt instanceof Date ? p.verifiedAt.toISOString() : null,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt ?? ""),
  });
});

/** 提交实名信息 */
portalAccountRoutes.post("/identity", async (c) => {
  const body = z_identity.parse(await c.req.json());
  const userId = (c.get("user") as User).id;
  const db = getDb();
  const encrypted =
    body.type === "personal" && body.idNumber ? aesEncrypt(body.idNumber) : null;
  const values = {
    userId,
    type: body.type,
    realName: body.type === "personal" ? body.realName : null,
    idNumberEnc: encrypted,
    companyName: body.type === "enterprise" ? body.companyName : null,
    creditCode: body.type === "enterprise" ? body.creditCode : null,
    status: "pending" as const,
    verifiedAt: null,
    rejectReason: null,
  };
  const existing = await db
    .select({ id: schema.userProfiles.id })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  if (existing[0]) {
    await db.update(schema.userProfiles).set(values).where(eq(schema.userProfiles.userId, userId));
  } else {
    await db.insert(schema.userProfiles).values(values);
  }
  return c.json({ ok: true, status: "pending" });
});

const z_identity = z.object({
  type: z.enum(["personal", "enterprise"]),
  realName: z.string().min(2).max(100).optional(),
  idNumber: z.string().min(6).max(30).optional(),
  companyName: z.string().min(2).max(200).optional(),
  creditCode: z
    .string()
    .regex(/^[0-9A-HJ-NPQRTUWXY]{18}$/, "统一社会信用代码格式不正确")
    .optional(),
});
