import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";

type User = typeof schema.users.$inferSelect;
import { pageQuerySchema, ticketCreateSchema, ticketReplySchema } from "@qmkvm/contracts";
import { appError } from "@qmkvm/core";
import { requireAuth } from "../../middleware/auth.js";

export const portalTicketRoutes = new Hono();
portalTicketRoutes.use("*", requireAuth());

const PUBLIC_REPLY_FIELDS = {
  id: schema.ticketReplies.id,
  authorType: schema.ticketReplies.authorType,
  contentHtml: schema.ticketReplies.contentHtml,
  createdAt: schema.ticketReplies.createdAt,
};

portalTicketRoutes.get("/departments", async (c) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.ticketDepartments)
    .where(eq(schema.ticketDepartments.hidden, false))
    .orderBy(schema.ticketDepartments.sortOrder);
  return c.json({ items: rows.map((d) => ({ id: d.id, name: d.name })) });
});

portalTicketRoutes.get("/tickets", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const where = eq(schema.tickets.userId, user.id);
  const rows = await db
    .select()
    .from(schema.tickets)
    .where(where)
    .orderBy(desc(schema.tickets.lastReplyAt), desc(schema.tickets.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const all = await db.select({ id: schema.tickets.id }).from(schema.tickets).where(where);
  const deptIds = [...new Set(rows.map((r) => r.departmentId))];
  const depts = deptIds.length
    ? await db.select().from(schema.ticketDepartments).where(inArray(schema.ticketDepartments.id, deptIds))
    : [];
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  return c.json({
    items: rows.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      departmentId: t.departmentId,
      departmentName: deptName.get(t.departmentId) ?? null,
      serviceId: t.serviceId,
      lastReplyAt: t.lastReplyAt?.toISOString?.() ?? null,
      lastReplyBy: t.lastReplyBy,
      createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    })),
    total: all.length,
    page: q.page,
    pageSize: q.pageSize,
  });
});

portalTicketRoutes.post("/tickets", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const body = ticketCreateSchema.parse(await c.req.json());

  const deptRows = await db
    .select()
    .from(schema.ticketDepartments)
    .where(eq(schema.ticketDepartments.id, body.departmentId))
    .limit(1);
  if (!deptRows[0]) throw appError("NOT_FOUND", "工单部门不存在");

  if (body.serviceId) {
    const svc = await db
      .select({ id: schema.services.id })
      .from(schema.services)
      .where(and(eq(schema.services.id, body.serviceId), eq(schema.services.userId, user.id)))
      .limit(1);
    if (!svc[0]) throw appError("SVC_NOT_FOUND", "关联的服务不存在");
  }

  const inserted = await db
    .insert(schema.tickets)
    .values({
      userId: user.id,
      departmentId: body.departmentId,
      serviceId: body.serviceId ?? null,
      subject: body.subject,
      status: "open",
      priority: body.priority,
      lastReplyAt: new Date(),
      lastReplyBy: "customer",
    });
  const ticketId = inserted[0].insertId;
  await db.insert(schema.ticketReplies).values({
    ticketId,
    authorUserId: user.id,
    authorType: "customer",
    contentHtml: body.contentHtml,
  });

  // 通知部门邮箱（如配置）
  if (deptRows[0].emailTo) {
    const { sendNotification } = await import("@qmkvm/notifications");
    await sendNotification(db, {
      channel: "email",
      event: "ticket.created_admin",
      target: deptRows[0].emailTo,
      vars: { user: { name: user.name ?? user.email ?? `#${user.id}` }, ticket: { subject: body.subject } },
    });
  }

  return c.json({ ok: true, id: ticketId });
});

async function loadOwnTicket(userId: number, id: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tickets)
    .where(and(eq(schema.tickets.id, id), eq(schema.tickets.userId, userId)))
    .limit(1);
  const t = rows[0];
  if (!t) throw appError("TICKET_NOT_FOUND", "工单不存在");
  return t;
}

portalTicketRoutes.get("/tickets/:id", async (c) => {
  const user = c.get("user") as User;
  const t = await loadOwnTicket(user.id, z.coerce.number().int().positive().parse(c.req.param("id")));
  const db = getDb();
  const replies = await db
    .select(PUBLIC_REPLY_FIELDS)
    .from(schema.ticketReplies)
    .where(and(eq(schema.ticketReplies.ticketId, t.id), eq(schema.ticketReplies.internalNote, false)))
    .orderBy(schema.ticketReplies.id);
  return c.json({
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    departmentId: t.departmentId,
    serviceId: t.serviceId,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    replies: replies.map((r) => ({
      id: r.id,
      authorType: r.authorType,
      authorName: r.authorType === "customer" ? "我" : "客服",
      contentHtml: r.contentHtml,
      internalNote: false,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
  });
});

portalTicketRoutes.post("/tickets/:id/reply", async (c) => {
  const user = c.get("user") as User;
  const ticketId = z.coerce.number().int().positive().parse(c.req.param("id"));
  const t = await loadOwnTicket(user.id, ticketId);
  if (t.status === "closed") throw appError("TICKET_CLOSED", "工单已关闭，如需继续请重新提交");
  const body = ticketReplySchema.parse(await c.req.json());
  const db = getDb();
  await db.insert(schema.ticketReplies).values({
    ticketId: t.id,
    authorUserId: user.id,
    authorType: "customer",
    contentHtml: body.contentHtml,
  });
  await db
    .update(schema.tickets)
    .set({ status: "customer_reply", lastReplyAt: new Date(), lastReplyBy: "customer" })
    .where(eq(schema.tickets.id, t.id));
  return c.json({ ok: true });
});

portalTicketRoutes.post("/tickets/:id/close", async (c) => {
  const user = c.get("user") as User;
  const t = await loadOwnTicket(user.id, z.coerce.number().int().positive().parse(c.req.param("id")));
  const db = getDb();
  await db
    .update(schema.tickets)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(schema.tickets.id, t.id));
  return c.json({ ok: true });
});

/** 附件上传（≤5MB，白名单类型，存 UPLOAD_DIR） */
portalTicketRoutes.post("/tickets/:id/attachments", async (c) => {
  const user = c.get("user") as User;
  const t = await loadOwnTicket(user.id, z.coerce.number().int().positive().parse(c.req.param("id")));
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File)) throw appError("TICKET_ATTACHMENT_INVALID", "缺少文件");
  const ALLOWED = ["image/png", "image/jpeg", "application/pdf", "application/zip", "text/plain"];
  if (!ALLOWED.includes(file.type)) throw appError("TICKET_ATTACHMENT_INVALID", "不支持的文件类型");
  if (file.size > 5 * 1024 * 1024) throw appError("TICKET_ATTACHMENT_INVALID", "文件不能超过 5MB");

  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
  const dir = path.join(uploadDir, `tickets/${t.id}`);
  await mkdir(dir, { recursive: true });
  const safeName = `${Date.now()}-${file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")}`.slice(0, 200);
  const stored = path.join(dir, safeName);
  await writeFile(stored, Buffer.from(await file.arrayBuffer()));
  const db = getDb();
  await db.insert(schema.attachments).values({
    ticketId: t.id,
    filename: file.name.slice(0, 250),
    storedPath: stored,
    mime: file.type,
    size: file.size,
    createdByType: "customer",
    createdByUserId: user.id,
  });
  return c.json({ ok: true });
});
