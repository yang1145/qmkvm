/**
 * 实名审核管理：实名信息列表、详情（证件号解密核对）、审核通过/驳回。
 * 权限：读 customers.read、审核 customers.manage；审核写审计（不含证件号明文）。
 */
import { Hono } from "hono";
import { and, desc, eq, or, like, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";

import { idParamSchema, pageQuerySchema } from "@qmkvm/contracts";
import { appError } from "@qmkvm/core";
import { aesDecrypt } from "@qmkvm/auth";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact, writeAdminAudit } from "./helpers.js";
import { isValidIdNumber } from "@qmkvm/core";
import { getStorage, storageEnv } from "@qmkvm/storage";

export const adminIdentityRoutes = new Hono();

const { userProfiles, users } = schema;

const IDENTITY_STATUS_LABEL: Record<string, string> = {
  unverified: "未认证",
  pending: "待审核",
  verified: "已认证",
  rejected: "已驳回",
};

const listQuery = z.object({
  ...pageQuerySchema.shape,
  status: z.enum(["unverified", "pending", "verified", "rejected"]).optional(),
  type: z.enum(["personal", "enterprise"]).optional(),
  q: z.string().trim().max(100).optional(),
});

/** 解密证件号（损坏密文返回 null） */
function decryptIdNumber(enc: string | null): string | null {
  if (!enc) return null;
  try {
    return aesDecrypt(enc);
  } catch {
    return null;
  }
}

/** 列表（联表 users 展示姓名与脱敏联系方式） */
adminIdentityRoutes.get("/identities", requireAdmin("customers.read"), async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = and(
    q.status ? eq(userProfiles.status, q.status) : undefined,
    q.type ? eq(userProfiles.type, q.type) : undefined,
    q.q
      ? or(
          like(userProfiles.realName, `%${q.q}%`),
          like(userProfiles.companyName, `%${q.q}%`),
          like(users.phone, `%${q.q}%`),
        )
      : undefined,
  );

  const rows = await db
    .select({ p: userProfiles, user: users })
    .from(userProfiles)
    .leftJoin(users, eq(users.id, userProfiles.userId))
    .where(where)
    .orderBy(desc(userProfiles.updatedAt), desc(userProfiles.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(userProfiles)
    .leftJoin(users, eq(users.id, userProfiles.userId))
    .where(where);

  return c.json({
    items: rows.map(({ p, user }) => ({
      id: p.id,
      userId: p.userId,
      user: user
        ? { name: user.name, ...maskedContact(user) }
        : null,
      type: p.type,
      realName: p.realName,
      companyName: p.companyName,
      creditCode: p.creditCode,
      status: p.status,
      statusLabel: IDENTITY_STATUS_LABEL[p.status] ?? p.status,
      rejectReason: p.rejectReason,
      verifiedAt: iso(p.verifiedAt),
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** 详情（customers.manage）：证件号解密返回完整值供审核核对 */
adminIdentityRoutes.get("/identities/:id", requireAdmin("customers.manage"), async (c) => {
  const { id } = idParamSchema.parse({ id: c.req.param("id") });
  const db = getDb();
  const rows = await db
    .select({ p: userProfiles, user: users })
    .from(userProfiles)
    .leftJoin(users, eq(users.id, userProfiles.userId))
    .where(eq(userProfiles.id, id))
    .limit(1);
  const { p, user } = rows[0] ?? {};
  if (!p) throw appError("NOT_FOUND", `实名信息不存在（#${id}）`);

  return c.json({
    id: p.id,
    userId: p.userId,
    user: user
      ? { name: user.name, ...maskedContact(user), createdAt: iso(user.createdAt) }
      : null,
    type: p.type,
    realName: p.realName,
    /** 完整证件号（仅审核详情返回，禁止写入日志） */
    idNumber: decryptIdNumber(p.idNumberEnc),
    companyName: p.companyName,
    creditCode: p.creditCode,
    /** 证件照 URL（管理端 <img> 直显；kind: front/back/handheld） */
    images: {
      front: p.idFrontPath ? `/api/v1/admin/identities/${p.id}/images/front` : null,
      back: p.idBackPath ? `/api/v1/admin/identities/${p.id}/images/back` : null,
      handheld: p.idHandheldPath ? `/api/v1/admin/identities/${p.id}/images/handheld` : null,
    },
    /** 正面照 OCR 结果与人工核对状态（unavailable：OCR 不可用/识别号不可靠/与填写不一致） */
    ocr: {
      idNumber: p.ocrIdNumber,
      /** OCR 号是否为合法证件号（校验码通过） */
      valid: p.ocrIdNumber ? isValidIdNumber(p.ocrIdNumber) : null,
      status: p.ocrStatus,
    },
    status: p.status,
    statusLabel: IDENTITY_STATUS_LABEL[p.status] ?? p.status,
    rejectReason: p.rejectReason,
    verifiedAt: iso(p.verifiedAt),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  });
});

/** 证件照查看（customers.manage）：按 profileId + kind 读取存储文件，防路径穿越。
 * 本地盘模式：API 直接读文件返回（与历史行为一致，兼容 DB 中的历史绝对路径）；
 * S3 模式：302 重定向到 presigned GET URL（短暂有效期，仍带 no-store 语义头）。 */
adminIdentityRoutes.get("/identities/:id/images/:kind", requireAdmin("customers.manage"), async (c) => {
  const { id } = idParamSchema.parse({ id: c.req.param("id") });
  const kind = z.enum(["front", "back", "handheld"]).parse(c.req.param("kind"));
  const db = getDb();
  const rows = await db
    .select({ p: userProfiles })
    .from(userProfiles)
    .where(eq(userProfiles.id, id))
    .limit(1);
  const p = rows[0]?.p;
  if (!p) throw appError("NOT_FOUND", `实名信息不存在（#${id}）`);
  const storedPath =
    kind === "front" ? p.idFrontPath : kind === "back" ? p.idBackPath : p.idHandheldPath;
  if (!storedPath) throw appError("NOT_FOUND", "证件照不存在");

  const storage = getStorage();
  const path = await import("node:path");

  // S3 模式：302 → presigned URL（key 或历史绝对路径都先规范化为 key）
  if (storageEnv.provider === "s3") {
    const url = await storage.presign(storedPath, 300);
    if (url) return c.redirect(url, 302);
    throw appError("NOT_FOUND", "证件照文件已丢失");
  }

  // 本地盘模式（含历史绝对路径兼容）：直接读文件返回
  const file = await storage.get(storedPath);
  if (!file) throw appError("NOT_FOUND", "证件照文件已丢失");
  const ext = path.extname(storedPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return c.body(new Uint8Array(file.data), 200, {
    "Content-Type": mime,
    "Cache-Control": "private, no-store",
  });
});

const reviewBody = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(255).optional(),
});

/** 审核：pending → approve → verified；pending → reject → rejected（原因必填） */
adminIdentityRoutes.post("/identities/:id/review", requireAdmin("customers.manage"), async (c) => {
  const { id } = idParamSchema.parse({ id: c.req.param("id") });
  const body = reviewBody.parse(await c.req.json());
  if (body.action === "reject" && !body.reason) {
    throw appError("VALIDATION_FAILED", "驳回原因必填");
  }
  const db = getDb();
  const rows = await db.select().from(userProfiles).where(eq(userProfiles.id, id)).limit(1);
  const profile = rows[0];
  if (!profile) throw appError("NOT_FOUND", `实名信息不存在（#${id}）`);
  if (profile.status !== "pending") {
    throw appError("CONFLICT", `当前状态（${IDENTITY_STATUS_LABEL[profile.status] ?? profile.status}）不允许审核，仅待审核可操作`);
  }

  const actor = c.get("admin");
  const next =
    body.action === "approve"
      ? ({ status: "verified" as const, verifiedAt: new Date(), rejectReason: null })
      : ({ status: "rejected" as const, verifiedAt: null, rejectReason: body.reason! });

  await db
    .update(userProfiles)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(userProfiles.id, id));

  // 审计：不含证件号明文
  await writeAdminAudit(c, actor, {
    action: "identity.review",
    targetType: "user_profile",
    targetId: id,
    before: { status: profile.status },
    after: {
      action: body.action,
      status: next.status,
      ...(body.action === "reject" ? { rejectReason: body.reason } : {}),
    },
  });

  return c.json({ ok: true, status: next.status });
});
