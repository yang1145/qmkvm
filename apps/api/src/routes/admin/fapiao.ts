/**
 * 后台发票管理：开票申请列表、审批/驳回/回填发票号、CSV 导出。
 * 权限：读 invoices.read、写 invoices.manage；全部写操作记审计并通知客户。
 */
import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";

import {
  fapiaoStatusEnum,
  idParamSchema,
  pageQuerySchema,
} from "@qmkvm/contracts";
import { appError, centsToYuan, emitEvent } from "@qmkvm/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact, writeAdminAudit } from "./helpers.js";

export const adminFapiaoRoutes = new Hono();

const { fapiaoRequests, invoiceTitles, invoices, users } = schema;

const listQuery = z.object({
  ...pageQuerySchema.shape,
  status: fapiaoStatusEnum.optional(),
  userId: z.coerce.number().int().positive().optional(),
});

const FAPIAO_STATUS_LABEL: Record<string, string> = {
  pending: "待审核",
  approved: "已审批",
  issued: "已开票",
  rejected: "已驳回",
};
const FAPIAO_TYPE_LABEL: Record<string, string> = {
  electronic: "电子普票",
  special: "增值税专票",
};

async function loadRequest(db: ReturnType<typeof getDb>, id: number) {
  const rows = await db.select().from(fapiaoRequests).where(eq(fapiaoRequests.id, id)).limit(1);
  const req = rows[0];
  if (!req) throw appError("NOT_FOUND", `开票申请不存在（#${id}）`);
  return req;
}

/** 状态变化通知客户（模板 fapiao.status_changed） */
async function notifyStatusChanged(
  db: ReturnType<typeof getDb>,
  payload: {
    userId: number;
    status: string;
    fapiaoNo: string | null;
    rejectReason: string | null;
    invoiceNo: string | null;
    titleName: string | null;
    amountCny: string;
  },
) {
  await emitEvent(db, "fapiao.status_changed", {
    userId: payload.userId,
    fapiao: {
      status: payload.status,
      fapiaoNo: payload.fapiaoNo,
      rejectReason: payload.rejectReason,
      invoiceNo: payload.invoiceNo,
      titleName: payload.titleName,
      amountCny: payload.amountCny,
    },
  });
}

/** 列表（联表抬头与账单号） */
adminFapiaoRoutes.get("/fapiao", requireAdmin("invoices.read"), async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = and(
    q.status ? eq(fapiaoRequests.status, q.status) : undefined,
    q.userId ? eq(fapiaoRequests.userId, q.userId) : undefined,
  );

  const rows = await db
    .select({
      r: fapiaoRequests,
      title: invoiceTitles,
      invoiceNo: invoices.invoiceNo,
      user: users,
    })
    .from(fapiaoRequests)
    .leftJoin(invoiceTitles, eq(invoiceTitles.id, fapiaoRequests.titleId))
    .leftJoin(invoices, eq(invoices.id, fapiaoRequests.invoiceId))
    .leftJoin(users, eq(users.id, fapiaoRequests.userId))
    .where(where)
    .orderBy(desc(fapiaoRequests.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(fapiaoRequests).where(where);

  return c.json({
    items: rows.map(({ r, title, invoiceNo, user }) => ({
      id: r.id,
      userId: r.userId,
      user: user ? { name: user.name, ...maskedContact(user) } : null,
      invoiceId: r.invoiceId,
      invoiceNo,
      titleId: r.titleId,
      title: title
        ? { type: title.type, name: title.name, taxNo: title.taxNo, email: title.email }
        : null,
      amount: r.amount,
      type: r.type,
      status: r.status,
      remark: r.remark,
      rejectReason: r.rejectReason,
      fapiaoNo: r.fapiaoNo,
      fapiaoUrl: r.fapiaoUrl,
      approvedById: r.approvedById,
      issuedAt: iso(r.issuedAt),
      createdAt: iso(r.createdAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV 导出（BOM 兼容 Excel；列：ID/用户ID/类型/抬头/税号/金额(元)/状态/申请时间/发票号）。
 * 注意：须注册在 GET /fapiao/:id 之前，避免 "export" 被当作 id 匹配。 */
adminFapiaoRoutes.get("/fapiao/export", requireAdmin("invoices.read"), async (c) => {
  const db = getDb();
  const status = fapiaoStatusEnum.safeParse(c.req.query("status")).success
    ? (c.req.query("status") as z.infer<typeof fapiaoStatusEnum>)
    : undefined;
  const where = status ? eq(fapiaoRequests.status, status) : undefined;

  const rows = await db
    .select({ r: fapiaoRequests, title: invoiceTitles, invoiceNo: invoices.invoiceNo })
    .from(fapiaoRequests)
    .leftJoin(invoiceTitles, eq(invoiceTitles.id, fapiaoRequests.titleId))
    .leftJoin(invoices, eq(invoices.id, fapiaoRequests.invoiceId))
    .where(where)
    .orderBy(desc(fapiaoRequests.id))
    .limit(10000);

  const header = ["ID", "用户ID", "类型", "抬头", "税号", "金额(元)", "状态", "申请时间", "发票号"];
  const lines = [
    header.join(","),
    ...rows.map(({ r, title }) =>
      [
        r.id,
        r.userId,
        FAPIAO_TYPE_LABEL[r.type] ?? r.type,
        title?.name ?? "",
        title?.taxNo ?? "",
        centsToYuan(r.amount).toFixed(2),
        FAPIAO_STATUS_LABEL[r.status] ?? r.status,
        iso(r.createdAt),
        r.fapiaoNo ?? "",
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  const body = "\uFEFF" + lines.join("\r\n");
  return c.body(body, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="fapiao-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
});

/** 详情 */
adminFapiaoRoutes.get("/fapiao/:id", requireAdmin("invoices.read"), async (c) => {
  const db = getDb();
  const id = idParamSchema.parse(c.req.param()).id;
  const req = await loadRequest(db, id);
  const titleRows = await db
    .select()
    .from(invoiceTitles)
    .where(eq(invoiceTitles.id, req.titleId))
    .limit(1);
  const invRows = await db
    .select({ invoiceNo: invoices.invoiceNo })
    .from(invoices)
    .where(eq(invoices.id, req.invoiceId))
    .limit(1);
  return c.json({
    id: req.id,
    userId: req.userId,
    invoiceId: req.invoiceId,
    invoiceNo: invRows[0]?.invoiceNo ?? null,
    title: titleRows[0]
      ? {
          type: titleRows[0].type,
          name: titleRows[0].name,
          taxNo: titleRows[0].taxNo,
          email: titleRows[0].email,
          bankName: titleRows[0].bankName,
          bankAccount: titleRows[0].bankAccount,
          companyAddress: titleRows[0].companyAddress,
          companyPhone: titleRows[0].companyPhone,
        }
      : null,
    amount: req.amount,
    type: req.type,
    status: req.status,
    remark: req.remark,
    rejectReason: req.rejectReason,
    fapiaoNo: req.fapiaoNo,
    fapiaoUrl: req.fapiaoUrl,
    approvedById: req.approvedById,
    issuedAt: iso(req.issuedAt),
    createdAt: iso(req.createdAt),
  });
});

/** 审批通过：pending → approved */
adminFapiaoRoutes.post("/fapiao/:id/approve", requireAdmin("invoices.manage"), async (c) => {
  const admin = c.get("admin");
  const db = getDb();
  const id = idParamSchema.parse(c.req.param()).id;
  const before = await loadRequest(db, id);
  if (before.status !== "pending") {
    throw appError("CONFLICT", "仅待审核的申请可审批通过");
  }
  await db
    .update(fapiaoRequests)
    .set({ status: "approved", approvedById: admin.adminId, updatedAt: new Date() })
    .where(eq(fapiaoRequests.id, id));

  const invRows = await db
    .select({ invoiceNo: invoices.invoiceNo })
    .from(invoices)
    .where(eq(invoices.id, before.invoiceId))
    .limit(1);
  await notifyStatusChanged(db, {
    userId: before.userId,
    status: "approved",
    fapiaoNo: null,
    rejectReason: null,
    invoiceNo: invRows[0]?.invoiceNo ?? null,
    titleName: null,
    amountCny: centsToYuan(before.amount).toFixed(2),
  });
  await writeAdminAudit(c, admin, {
    action: "fapiao.approve",
    targetType: "fapiao_request",
    targetId: id,
    before: { status: before.status },
    after: { status: "approved", approvedById: admin.adminId },
  });
  return c.json({ ok: true, status: "approved" });
});

/** 驳回：pending/approved → rejected */
adminFapiaoRoutes.post("/fapiao/:id/reject", requireAdmin("invoices.manage"), async (c) => {
  const admin = c.get("admin");
  const db = getDb();
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z.object({ reason: z.string().min(1).max(255) }).parse(await c.req.json());
  const before = await loadRequest(db, id);
  if (before.status !== "pending" && before.status !== "approved") {
    throw appError("CONFLICT", "当前状态不可驳回");
  }
  await db
    .update(fapiaoRequests)
    .set({ status: "rejected", rejectReason: body.reason, updatedAt: new Date() })
    .where(eq(fapiaoRequests.id, id));

  const invRows = await db
    .select({ invoiceNo: invoices.invoiceNo })
    .from(invoices)
    .where(eq(invoices.id, before.invoiceId))
    .limit(1);
  await notifyStatusChanged(db, {
    userId: before.userId,
    status: "rejected",
    fapiaoNo: null,
    rejectReason: body.reason,
    invoiceNo: invRows[0]?.invoiceNo ?? null,
    titleName: null,
    amountCny: centsToYuan(before.amount).toFixed(2),
  });
  await writeAdminAudit(c, admin, {
    action: "fapiao.reject",
    targetType: "fapiao_request",
    targetId: id,
    before: { status: before.status },
    after: { status: "rejected", rejectReason: body.reason },
  });
  return c.json({ ok: true, status: "rejected" });
});

/** 回填发票号：approved → issued */
adminFapiaoRoutes.post("/fapiao/:id/issue", requireAdmin("invoices.manage"), async (c) => {
  const admin = c.get("admin");
  const db = getDb();
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z
    .object({
      fapiaoNo: z.string().min(1).max(50),
      fapiaoUrl: z.string().max(500).optional(),
    })
    .parse(await c.req.json());
  const before = await loadRequest(db, id);
  if (before.status !== "approved") {
    throw appError("CONFLICT", "仅已审批的申请可回填发票号");
  }
  const now = new Date();
  await db
    .update(fapiaoRequests)
    .set({
      status: "issued",
      fapiaoNo: body.fapiaoNo,
      fapiaoUrl: body.fapiaoUrl ?? null,
      issuedAt: now,
      updatedAt: now,
    })
    .where(eq(fapiaoRequests.id, id));

  const invRows = await db
    .select({ invoiceNo: invoices.invoiceNo })
    .from(invoices)
    .where(eq(invoices.id, before.invoiceId))
    .limit(1);
  await notifyStatusChanged(db, {
    userId: before.userId,
    status: "issued",
    fapiaoNo: body.fapiaoNo,
    rejectReason: null,
    invoiceNo: invRows[0]?.invoiceNo ?? null,
    titleName: null,
    amountCny: centsToYuan(before.amount).toFixed(2),
  });
  await writeAdminAudit(c, admin, {
    action: "fapiao.issue",
    targetType: "fapiao_request",
    targetId: id,
    before: { status: before.status, fapiaoNo: before.fapiaoNo },
    after: { status: "issued", fapiaoNo: body.fapiaoNo, fapiaoUrl: body.fapiaoUrl ?? null },
  });
  return c.json({ ok: true, status: "issued" });
});
