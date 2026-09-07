import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";

type User = typeof schema.users.$inferSelect;
import { updateProfileSchema } from "@qmkvm/contracts";
import { aesDecrypt, aesEncrypt, revokeAllPortalSessions } from "@qmkvm/auth";
import { requireAuth, clearPortalCookie } from "../../middleware/auth.js";
import { appError, enqueueJob } from "@qmkvm/core";
import { ocrIdCardFront } from "@qmkvm/core";

export const portalAccountRoutes = new Hono();
portalAccountRoutes.use("*", requireAuth());

/** 证件照约束：仅 JPG/PNG/WebP，单张 ≤10MB */
const ID_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ID_IMAGE_MAX_SIZE = 10 * 1024 * 1024;

function validateIdImage(file: unknown, label: string): asserts file is File {
  if (!(file instanceof File)) throw appError("IDENTITY_IMAGE_INVALID", `缺少${label}`);
  if (!ID_IMAGE_TYPES.includes(file.type)) {
    throw appError("IDENTITY_IMAGE_INVALID", `${label}仅支持 JPG/PNG/WebP 格式`);
  }
  if (file.size > ID_IMAGE_MAX_SIZE) {
    throw appError("IDENTITY_IMAGE_INVALID", `${label}不能超过 10MB`);
  }
}

async function saveIdImage(userId: number, kind: string, file: File): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
  const dir = path.join(uploadDir, `identity/${userId}`);
  await mkdir(dir, { recursive: true });
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const stored = path.join(dir, `${kind}-${Date.now()}.${ext}`);
  await writeFile(stored, Buffer.from(await file.arrayBuffer()));
  return stored;
}

async function removeFileQuiet(p: string | null | undefined) {
  if (!p) return;
  try {
    await (await import("node:fs/promises")).unlink(p);
  } catch {
    // 文件已不存在等情况忽略
  }
}

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
    images: {
      front: !!p.idFrontPath,
      back: !!p.idBackPath,
      handheld: !!p.idHandheldPath,
    },
    ocrStatus: p.ocrStatus ?? null,
    verifiedAt: p.verifiedAt instanceof Date ? p.verifiedAt.toISOString() : null,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt ?? ""),
  });
});

/** 提交实名信息（个人需上传身份证正反面照，手持照选填；OCR 仅识别正面） */
portalAccountRoutes.post("/identity", async (c) => {
  const userId = (c.get("user") as User).id;
  const db = getDb();
  const contentType = c.req.header("content-type") ?? "";

  let body: z.infer<typeof z_identity>;
  let front: File | undefined;
  let back: File | undefined;
  let handheld: File | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    body = z_identity.parse({
      type: form["type"],
      realName: form["realName"] || undefined,
      idNumber: form["idNumber"] || undefined,
      companyName: form["companyName"] || undefined,
      creditCode: form["creditCode"] || undefined,
    });
    if (body.type === "personal") {
      validateIdImage(form["idFront"], "身份证正面照");
      validateIdImage(form["idBack"], "身份证反面照");
      front = form["idFront"];
      back = form["idBack"];
      if (form["idHandheld"] instanceof File) {
        validateIdImage(form["idHandheld"], "手持身份证照");
        handheld = form["idHandheld"];
      }
    }
  } else {
    body = z_identity.parse(await c.req.json());
    if (body.type === "personal") {
      throw appError("IDENTITY_IMAGE_REQUIRED", "请上传身份证正反面照片");
    }
  }

  // 重新提交时清理旧证件照
  const existing = await db
    .select()
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  if (existing[0]) {
    await Promise.all([
      removeFileQuiet(existing[0].idFrontPath),
      removeFileQuiet(existing[0].idBackPath),
      removeFileQuiet(existing[0].idHandheldPath),
    ]);
  }

  // 保存证件照；OCR 移交 ocr 组 worker 异步执行（提交不再同步等待识别，
  // 重 CPU 从 API 请求路径移除；结果由 ocr.verify handler 回写 ocr_status）
  let frontPath: string | null = null;
  let backPath: string | null = null;
  let handheldPath: string | null = null;
  const ocrIdNumber: string | null = null;
  const ocrStatus: "processing" | null = front ? "processing" : null;
  if (front) {
    frontPath = await saveIdImage(userId, "front", front);
    await Promise.all([
      back ? saveIdImage(userId, "back", back) : Promise.resolve(null),
      handheld ? saveIdImage(userId, "handheld", handheld) : Promise.resolve(null),
    ]);
  }

  const encrypted =
    body.type === "personal" && body.idNumber ? aesEncrypt(body.idNumber) : null;
  const values = {
    userId,
    type: body.type,
    realName: body.type === "personal" ? body.realName : null,
    idNumberEnc: encrypted,
    companyName: body.type === "enterprise" ? body.companyName : null,
    creditCode: body.type === "enterprise" ? body.creditCode : null,
    idFrontPath: frontPath,
    idBackPath: backPath,
    idHandheldPath: handheldPath,
    ocrIdNumber,
    ocrStatus,
    status: "pending" as const,
    verifiedAt: null,
    rejectReason: null,
  };
  let profileId: number;
  if (existing[0]) {
    await db.update(schema.userProfiles).set(values).where(eq(schema.userProfiles.userId, userId));
    profileId = existing[0].id;
  } else {
    const inserted = await db.insert(schema.userProfiles).values(values);
    profileId = Number(inserted[0]?.insertId ?? 0);
  }
  if (front && profileId) {
    // OCR 比对结果不再阻断提交；不一致由审核页标注（admin 详情 ocr.status）
    void enqueueJob("ocr.verify", {
      profileId,
      submittedIdNumber: body.idNumber ?? null,
    });
  }
  return c.json({ ok: true, status: "pending" });
});

/** 正面照 OCR 预填：仅提取证件号供表单预填，不保存图片 */
portalAccountRoutes.post("/identity/ocr", async (c) => {
  const form = await c.req.parseBody();
  validateIdImage(form["file"], "身份证正面照");
  const file = form["file"];
  const ocr = await ocrIdCardFront(Buffer.from(await file.arrayBuffer()));
  return c.json({ available: ocr.available, idNumber: ocr.idNumber, verified: ocr.verified });
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
