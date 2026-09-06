/** 工单部门管理（SPEC §4：GET|POST /departments、PUT /departments/:id）。 */
import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";
import { idParamSchema } from "@pinhaoji/contracts";
import { appError } from "@pinhaoji/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

export const adminDepartmentRoutes = new Hono();

const { ticketDepartments } = schema;

const upsertSchema = z.object({
  name: z.string().min(1).max(100),
  emailTo: z.string().email().max(255).nullable().optional(),
  sortOrder: z.number().int().default(0),
  hidden: z.boolean().default(false),
});

adminDepartmentRoutes.get("/departments", requireAdmin("tickets.read"), async (c) => {
  const db = getDb();
  const rows = await db.select().from(ticketDepartments).orderBy(asc(ticketDepartments.sortOrder), asc(ticketDepartments.id));
  return c.json({
    items: rows.map((d) => ({
      id: d.id,
      name: d.name,
      emailTo: d.emailTo,
      sortOrder: d.sortOrder,
      hidden: d.hidden,
      createdAt: iso(d.createdAt),
    })),
    total: rows.length,
    page: 1,
    pageSize: rows.length,
  });
});

adminDepartmentRoutes.post("/departments", requireAdmin("tickets.manage"), async (c) => {
  const body = upsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const inserted = await db.insert(ticketDepartments).values({
    name: body.name,
    emailTo: body.emailTo ?? null,
    sortOrder: body.sortOrder,
    hidden: body.hidden,
  });
  const id = inserted[0].insertId;
  await writeAdminAudit(c, admin, {
    action: "department.create",
    targetType: "ticket_department",
    targetId: id,
    after: { name: body.name },
  });
  return c.json({ id });
});

adminDepartmentRoutes.put("/departments/:id", requireAdmin("tickets.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = upsertSchema.partial().parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(ticketDepartments).where(eq(ticketDepartments.id, id)).limit(1);
  const dept = rows[0];
  if (!dept) throw appError("NOT_FOUND", "工单部门不存在");
  await db
    .update(ticketDepartments)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.emailTo !== undefined ? { emailTo: body.emailTo } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
    })
    .where(eq(ticketDepartments.id, id));
  await writeAdminAudit(c, admin, {
    action: "department.update",
    targetType: "ticket_department",
    targetId: id,
    before: { name: dept.name, emailTo: dept.emailTo, hidden: dept.hidden },
    after: body,
  });
  return c.json({ ok: true });
});
