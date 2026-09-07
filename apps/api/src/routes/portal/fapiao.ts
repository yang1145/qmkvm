/**
 * 门户发票路由：抬头管理（增删改/设默认，税号脱敏）+ 开票申请（已支付账单，防重复）。
 * 挂载于 portal 桶根路径（/fapiao/**），整体需登录。
 */
import { Hono } from "hono";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";

type User = typeof schema.users.$inferSelect;
import {
  fapiaoRequestCreateSchema,
  fapiaoTitleCreateSchema,
  fapiaoTitleUpdateSchema,
  pageQuerySchema,
} from "@qmkvm/contracts";
import { appError } from "@qmkvm/core";
import { requireAuth } from "../../middleware/auth.js";

export const portalFapiaoRoutes = new Hono();
portalFapiaoRoutes.use("*", requireAuth());

const { invoiceTitles, fapiaoRequests, invoices } = schema;

/** 纳税人识别号脱敏：保留前 4 后 4，中间打码（短号全打码只留前 2） */
function maskTaxNo(taxNo: string | null): string | null {
  if (!taxNo) return null;
  if (taxNo.length <= 8) return taxNo.slice(0, 2) + "*".repeat(Math.max(1, taxNo.length - 2));
  return taxNo.slice(0, 4) + "*".repeat(taxNo.length - 8) + taxNo.slice(-4);
}

function titlePayload(t: typeof invoiceTitles.$inferSelect) {
  return {
    id: t.id,
    type: t.type,
    name: t.name,
    taxNo: maskTaxNo(t.taxNo),
    email: t.email,
    bankName: t.bankName,
    bankAccount: t.bankAccount,
    companyAddress: t.companyAddress,
    companyPhone: t.companyPhone,
    isDefault: t.isDefault,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
  };
}

/** titleId → 归属当前用户的抬头；不存在抛 404 */
async function getOwnedTitle(db: ReturnType<typeof getDb>, userId: number, titleId: number) {
  const rows = await db
    .select()
    .from(invoiceTitles)
    .where(and(eq(invoiceTitles.id, titleId), eq(invoiceTitles.userId, userId)))
    .limit(1);
  const title = rows[0];
  if (!title) throw appError("NOT_FOUND", "抬头不存在");
  return title;
}

/** 设为默认抬头：清除该用户其余默认（可传入 tx 复用） */
async function applyDefault(
  db: ReturnType<typeof getDb>,
  userId: number,
  titleId: number | null,
) {
  if (titleId == null) return;
  await db
    .update(invoiceTitles)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(invoiceTitles.userId, userId), ne(invoiceTitles.id, titleId), eq(invoiceTitles.isDefault, true)));
  await db
    .update(invoiceTitles)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(invoiceTitles.id, titleId));
}

/** —— 抬头管理 —— */

portalFapiaoRoutes.get("/fapiao/titles", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const rows = await db
    .select()
    .from(invoiceTitles)
    .where(eq(invoiceTitles.userId, user.id))
    .orderBy(desc(invoiceTitles.isDefault), desc(invoiceTitles.id));
  return c.json({ items: rows.map(titlePayload) });
});

portalFapiaoRoutes.post("/fapiao/titles", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const body = fapiaoTitleCreateSchema.parse(await c.req.json());
  if (body.type === "enterprise" && !body.taxNo) {
    throw appError("VALIDATION_FAILED", "企业抬头必须填写纳税人识别号");
  }
  const inserted = await db
    .insert(invoiceTitles)
    .values({
      userId: user.id,
      type: body.type,
      name: body.name,
      taxNo: body.taxNo ?? null,
      email: body.email ?? null,
      bankName: body.bankName ?? null,
      bankAccount: body.bankAccount ?? null,
      companyAddress: body.companyAddress ?? null,
      companyPhone: body.companyPhone ?? null,
      isDefault: false,
    });
  const id = inserted[0].insertId;
  if (body.isDefault) await applyDefault(db, user.id, id);
  const rows = await db.select().from(invoiceTitles).where(eq(invoiceTitles.id, id)).limit(1);
  return c.json(titlePayload(rows[0]!), 201);
});

portalFapiaoRoutes.put("/fapiao/titles/:id", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const body = fapiaoTitleUpdateSchema.parse(await c.req.json());
  const existing = await getOwnedTitle(db, user.id, id);

  const nextType = body.type ?? existing.type;
  // taxNo 传回脱敏值视为未修改；enterprise 缺失税号则沿用原值
  const taxNo =
    body.taxNo === undefined
      ? existing.taxNo
      : body.taxNo === maskTaxNo(existing.taxNo)
        ? existing.taxNo
        : body.taxNo;
  if (nextType === "enterprise" && !taxNo) {
    throw appError("VALIDATION_FAILED", "企业抬头必须填写纳税人识别号");
  }

  await db
    .update(invoiceTitles)
    .set({
      type: nextType,
      name: body.name ?? existing.name,
      taxNo: taxNo ?? null,
      email: body.email ?? existing.email,
      bankName: body.bankName ?? existing.bankName,
      bankAccount: body.bankAccount ?? existing.bankAccount,
      companyAddress: body.companyAddress ?? existing.companyAddress,
      companyPhone: body.companyPhone ?? existing.companyPhone,
      updatedAt: new Date(),
    })
    .where(eq(invoiceTitles.id, id));
  if (body.isDefault) await applyDefault(db, user.id, id);

  const rows = await db.select().from(invoiceTitles).where(eq(invoiceTitles.id, id)).limit(1);
  return c.json(titlePayload(rows[0]!));
});

/** 删除抬头：被开票申请引用过则拒绝（审计追溯需要保留） */
portalFapiaoRoutes.delete("/fapiao/titles/:id", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  await getOwnedTitle(db, user.id, id);
  const refs = await db
    .select({ id: fapiaoRequests.id })
    .from(fapiaoRequests)
    .where(eq(fapiaoRequests.titleId, id))
    .limit(1);
  if (refs.length > 0) {
    throw appError("CONFLICT", "该抬头已被开票申请引用，无法删除");
  }
  await db.delete(invoiceTitles).where(eq(invoiceTitles.id, id));
  return c.json({ ok: true });
});

portalFapiaoRoutes.put("/fapiao/titles/:id/default", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  await getOwnedTitle(db, user.id, id);
  await applyDefault(db, user.id, id);
  return c.json({ ok: true });
});

/** —— 开票申请 —— */

function requestPayload(
  r: typeof fapiaoRequests.$inferSelect,
  title: Pick<typeof invoiceTitles.$inferSelect, "type" | "name" | "taxNo" | "email"> | null,
  invoiceNo: string | null,
  includeUserId = false,
) {
  return {
    id: r.id,
    ...(includeUserId ? { userId: r.userId } : {}),
    invoiceId: r.invoiceId,
    invoiceNo,
    titleId: r.titleId,
    title: title
      ? { type: title.type, name: title.name, taxNo: maskTaxNo(title.taxNo), email: title.email }
      : null,
    amount: r.amount,
    type: r.type,
    status: r.status,
    remark: r.remark,
    rejectReason: r.rejectReason,
    fapiaoNo: r.fapiaoNo,
    fapiaoUrl: r.fapiaoUrl,
    issuedAt: r.issuedAt?.toISOString?.() ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

/** 提交开票申请：账单须归属本人且已支付；同一账单存在 pending/issued 申请时 409 */
portalFapiaoRoutes.post("/fapiao/requests", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const body = fapiaoRequestCreateSchema.parse(await c.req.json());

  const invRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, body.invoiceId), eq(invoices.userId, user.id)))
    .limit(1);
  const inv = invRows[0];
  if (!inv) throw appError("BILL_INVOICE_NOT_FOUND", "账单不存在");
  if (inv.status !== "paid") {
    throw appError("BILL_INVOICE_STATUS_INVALID", "仅已支付的账单可申请开票");
  }
  const dup = await db
    .select({ id: fapiaoRequests.id })
    .from(fapiaoRequests)
    .where(
      and(
        eq(fapiaoRequests.invoiceId, inv.id),
        inArray(fapiaoRequests.status, ["pending", "issued"]),
      ),
    )
    .limit(1);
  if (dup.length > 0) {
    throw appError("CONFLICT", "该账单已存在开票申请，请勿重复提交");
  }

  const title = await getOwnedTitle(db, user.id, body.titleId);
  if (body.type === "special" && !title.taxNo) {
    throw appError("VALIDATION_FAILED", "开具增值税专用发票需选择含税号的企业抬头");
  }

  const inserted = await db
    .insert(fapiaoRequests)
    .values({
      userId: user.id,
      titleId: title.id,
      invoiceId: inv.id,
      amount: inv.total,
      type: body.type,
      status: "pending",
      remark: body.remark ?? null,
    });
  const rows = await db
    .select()
    .from(fapiaoRequests)
    .where(eq(fapiaoRequests.id, inserted[0].insertId))
    .limit(1);
  return c.json(requestPayload(rows[0]!, title, inv.invoiceNo), 201);
});

/** 申请记录分页（含抬头快照与发票号/链接） */
portalFapiaoRoutes.get("/fapiao/requests", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const status = c.req.query("status");
  const invoiceId = c.req.query("invoiceId");
  const where = and(
    eq(fapiaoRequests.userId, user.id),
    status ? eq(fapiaoRequests.status, status as never) : undefined,
    invoiceId ? eq(fapiaoRequests.invoiceId, z.coerce.number().int().positive().parse(invoiceId)) : undefined,
  );

  const rows = await db
    .select({ r: fapiaoRequests, title: invoiceTitles, invoiceNo: invoices.invoiceNo })
    .from(fapiaoRequests)
    .leftJoin(invoiceTitles, eq(invoiceTitles.id, fapiaoRequests.titleId))
    .leftJoin(invoices, eq(invoices.id, fapiaoRequests.invoiceId))
    .where(where)
    .orderBy(desc(fapiaoRequests.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ id: fapiaoRequests.id }).from(fapiaoRequests).where(where);

  return c.json({
    items: rows.map((r) => requestPayload(r.r, r.title, r.invoiceNo)),
    total: totalRows.length,
    page: q.page,
    pageSize: q.pageSize,
  });
});

portalFapiaoRoutes.get("/fapiao/requests/:id", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const rows = await db
    .select({ r: fapiaoRequests, title: invoiceTitles, invoiceNo: invoices.invoiceNo })
    .from(fapiaoRequests)
    .leftJoin(invoiceTitles, eq(invoiceTitles.id, fapiaoRequests.titleId))
    .leftJoin(invoices, eq(invoices.id, fapiaoRequests.invoiceId))
    .where(and(eq(fapiaoRequests.id, id), eq(fapiaoRequests.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw appError("NOT_FOUND", "开票申请不存在");
  return c.json(requestPayload(row.r, row.title, row.invoiceNo));
});
