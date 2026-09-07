/** 工单管理：列表（状态/部门筛选）、详情（含内部备注）、客服回复、状态变更。 */
import { Hono } from "hono";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import {
  idParamSchema,
  pageQuerySchema,
  ticketPriorityEnum,
  ticketStatusEnum,
} from "@qmkvm/contracts";
import { appError, emitEvent, EVENT_NAMES } from "@qmkvm/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact, writeAdminAudit } from "./helpers.js";

export const adminTicketRoutes = new Hono();

const { tickets, ticketReplies, ticketDepartments, users, adminUsers, services } = schema;

const listQuery = z.object({
  ...pageQuerySchema.shape,
  status: ticketStatusEnum.optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  priority: ticketPriorityEnum.optional(),
  userId: z.coerce.number().int().positive().optional(),
  q: z.string().max(100).optional(),
});

adminTicketRoutes.get("/tickets", requireAdmin("tickets.read"), async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = and(
    q.status ? eq(tickets.status, q.status) : undefined,
    q.departmentId ? eq(tickets.departmentId, q.departmentId) : undefined,
    q.priority ? eq(tickets.priority, q.priority) : undefined,
    q.userId ? eq(tickets.userId, q.userId) : undefined,
    q.q ? like(tickets.subject, `%${q.q}%`) : undefined,
  );

  const rows = await db
    .select({ ticket: tickets, departmentName: ticketDepartments.name, user: users })
    .from(tickets)
    .leftJoin(ticketDepartments, eq(ticketDepartments.id, tickets.departmentId))
    .leftJoin(users, eq(users.id, tickets.userId))
    .where(where)
    .orderBy(desc(tickets.lastReplyAt), desc(tickets.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(tickets).where(where);

  return c.json({
    items: rows.map((r) => ({
      id: r.ticket.id,
      subject: r.ticket.subject,
      userId: r.ticket.userId,
      user: r.user ? { name: r.user.name, ...maskedContact(r.user) } : null,
      status: r.ticket.status,
      priority: r.ticket.priority,
      departmentId: r.ticket.departmentId,
      departmentName: r.departmentName,
      serviceId: r.ticket.serviceId,
      lastReplyAt: iso(r.ticket.lastReplyAt),
      lastReplyBy: r.ticket.lastReplyBy,
      createdAt: iso(r.ticket.createdAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** 工单详情：全部回复（含 internalNote=true 的内部备注） */
adminTicketRoutes.get("/tickets/:id", requireAdmin("tickets.read"), async (c) => {
  const db = getDb();
  const id = idParamSchema.parse(c.req.param()).id;
  const rows = await db
    .select({ ticket: tickets, departmentName: ticketDepartments.name, user: users })
    .from(tickets)
    .leftJoin(ticketDepartments, eq(ticketDepartments.id, tickets.departmentId))
    .leftJoin(users, eq(users.id, tickets.userId))
    .where(eq(tickets.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw appError("TICKET_NOT_FOUND", "工单不存在");

  const replies = await db
    .select()
    .from(ticketReplies)
    .where(eq(ticketReplies.ticketId, id))
    .orderBy(asc(ticketReplies.id));
  const staffIds = [
    ...new Set(replies.map((r) => r.authorAdminId).filter((v): v is number => v != null)),
  ];
  const staffRows = staffIds.length
    ? await db.select({ id: adminUsers.id, name: adminUsers.name, username: adminUsers.username }).from(adminUsers).where(inArray(adminUsers.id, staffIds))
    : [];
  const staffName = new Map(staffRows.map((s) => [s.id, s.name ?? s.username]));
  const serviceName = row.ticket.serviceId
    ? (await db.select({ name: services.name }).from(services).where(eq(services.id, row.ticket.serviceId)).limit(1))[0]?.name ?? null
    : null;

  return c.json({
    id: row.ticket.id,
    subject: row.ticket.subject,
    userId: row.ticket.userId,
    user: row.user
      ? { id: row.user.id, name: row.user.name, ...maskedContact(row.user) }
      : null,
    status: row.ticket.status,
    priority: row.ticket.priority,
    departmentId: row.ticket.departmentId,
    departmentName: row.departmentName,
    serviceId: row.ticket.serviceId,
    serviceName,
    lastReplyAt: iso(row.ticket.lastReplyAt),
    lastReplyBy: row.ticket.lastReplyBy,
    closedAt: iso(row.ticket.closedAt),
    createdAt: iso(row.ticket.createdAt),
    replies: replies.map((r) => ({
      id: r.id,
      authorType: r.authorType,
      authorName:
        r.authorType === "staff"
          ? (r.authorAdminId != null ? staffName.get(r.authorAdminId) ?? "客服" : "客服")
          : (row.user?.name ?? `客户 #${row.ticket.userId}`),
      authorAdminId: r.authorAdminId,
      contentHtml: r.contentHtml,
      internalNote: r.internalNote,
      createdAt: iso(r.createdAt),
    })),
  });
});

/** 客服回复：公开回复置 answered 并通知客户；internalNote=true 仅内部备注（不改状态） */
adminTicketRoutes.post("/tickets/:id/reply", requireAdmin("tickets.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z
    .object({
      contentHtml: z.string().min(1).max(20000),
      internalNote: z.boolean().default(false),
    })
    .parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();

  const rows = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  const ticket = rows[0];
  if (!ticket) throw appError("TICKET_NOT_FOUND", "工单不存在");
  if (ticket.status === "closed") throw appError("TICKET_CLOSED", "工单已关闭，请先恢复状态再回复");

  const now = new Date();
  const inserted = await db
    .insert(ticketReplies)
    .values({
      ticketId: id,
      authorAdminId: admin.adminId,
      authorType: "staff",
      contentHtml: body.contentHtml,
      internalNote: body.internalNote,
    });
  const replyId = inserted[0].insertId;

  if (!body.internalNote) {
    await db
      .update(tickets)
      .set({ status: "answered", lastReplyAt: now, lastReplyBy: "staff" })
      .where(eq(tickets.id, id));
    // 通知客户（站内信/短信/邮件；无模板时静默跳过）
    await emitEvent(db, EVENT_NAMES.ticketReplied, {
      userId: ticket.userId,
      ticketId: ticket.id,
      ticket: { id: ticket.id, subject: ticket.subject },
      replyBy: "staff",
    });
  } else {
    await db.update(tickets).set({ lastReplyAt: now }).where(eq(tickets.id, id));
  }

  await writeAdminAudit(c, admin, {
    action: "ticket.reply",
    targetType: "ticket",
    targetId: id,
    after: { replyId, internalNote: body.internalNote, status: body.internalNote ? ticket.status : "answered" },
  });
  return c.json({ ok: true, replyId, status: body.internalNote ? ticket.status : "answered" });
});

/** 工单状态变更（关闭时写 closedAt，其余状态清除） */
adminTicketRoutes.post("/tickets/:id/status", requireAdmin("tickets.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z.object({ status: ticketStatusEnum }).parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();

  const rows = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  const ticket = rows[0];
  if (!ticket) throw appError("TICKET_NOT_FOUND", "工单不存在");

  await db
    .update(tickets)
    .set({
      status: body.status,
      ...(body.status === "closed" ? { closedAt: new Date() } : { closedAt: null }),
    })
    .where(eq(tickets.id, id));
  await writeAdminAudit(c, admin, {
    action: "ticket.status",
    targetType: "ticket",
    targetId: id,
    before: { status: ticket.status },
    after: { status: body.status },
  });
  return c.json({ ok: true, status: body.status });
});
