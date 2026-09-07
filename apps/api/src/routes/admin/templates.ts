/** 通知模板管理（notification_templates；channel × event 唯一；body 支持 {{vars}}）。 */
import { Hono } from "hono";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import { idParamSchema, pageQuerySchema } from "@qmkvm/contracts";
import { appError } from "@qmkvm/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

export const adminTemplateRoutes = new Hono();

const { notificationTemplates } = schema;

const upsertSchema = z.object({
  channel: z.enum(["email", "sms", "inapp"]),
  event: z.string().min(1).max(50),
  subject: z.string().max(255).nullable().optional(),
  body: z.string().min(1).max(10000),
  active: z.boolean().default(true),
});

adminTemplateRoutes.get("/templates", requireAdmin("templates.manage"), async (c) => {
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const channel = c.req.query("channel");
  const event = c.req.query("event")?.trim();
  const where = and(
    channel && ["email", "sms", "inapp"].includes(channel)
      ? eq(notificationTemplates.channel, channel as "email" | "sms" | "inapp")
      : undefined,
    event ? eq(notificationTemplates.event, event) : undefined,
  );
  const rows = await db
    .select()
    .from(notificationTemplates)
    .where(where)
    .orderBy(desc(notificationTemplates.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ id: notificationTemplates.id }).from(notificationTemplates).where(where);
  return c.json({
    items: rows.map((t) => ({
      id: t.id,
      channel: t.channel,
      event: t.event,
      subject: t.subject,
      body: t.body,
      active: t.active,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
    })),
    total: totalRows.length,
    page: q.page,
    pageSize: q.pageSize,
  });
});

adminTemplateRoutes.post("/templates", requireAdmin("templates.manage"), async (c) => {
  const body = upsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  await assertChannelEventFree(db, body.channel, body.event);
  const inserted = await db.insert(notificationTemplates).values({
    channel: body.channel,
    event: body.event,
    subject: body.subject ?? null,
    body: body.body,
    active: body.active,
  });
  const id = inserted[0].insertId;
  await writeAdminAudit(c, admin, {
    action: "template.create",
    targetType: "notification_template",
    targetId: id,
    after: { channel: body.channel, event: body.event, active: body.active },
  });
  return c.json({ id });
});

adminTemplateRoutes.put("/templates/:id", requireAdmin("templates.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = upsertSchema.partial().parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(notificationTemplates).where(eq(notificationTemplates.id, id)).limit(1);
  const tpl = rows[0];
  if (!tpl) throw appError("NOT_FOUND", "通知模板不存在");
  const nextChannel = body.channel ?? tpl.channel;
  const nextEvent = body.event ?? tpl.event;
  if (nextChannel !== tpl.channel || nextEvent !== tpl.event) {
    await assertChannelEventFree(db, nextChannel, nextEvent, id);
  }
  await db
    .update(notificationTemplates)
    .set({
      ...(body.channel !== undefined ? { channel: body.channel } : {}),
      ...(body.event !== undefined ? { event: body.event } : {}),
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    })
    .where(eq(notificationTemplates.id, id));
  await writeAdminAudit(c, admin, {
    action: "template.update",
    targetType: "notification_template",
    targetId: id,
    before: { channel: tpl.channel, event: tpl.event, active: tpl.active },
    after: body,
  });
  return c.json({ ok: true });
});

/** 批量设置短信签名：全部 sms 模板 body 以【signature】开头（原【...】签名被替换，无签名则前插） */
const signatureSchema = z.object({ signature: z.string().trim().min(1).max(20) });

adminTemplateRoutes.post("/templates/signature", requireAdmin("templates.manage"), async (c) => {
  const { signature } = signatureSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(notificationTemplates).where(eq(notificationTemplates.channel, "sms"));
  const prefix = `【${signature}】`;
  let updated = 0;
  for (const t of rows) {
    const next = /^【[^】]*】/.test(t.body) ? t.body.replace(/^【[^】]*】/, prefix) : prefix + t.body;
    if (next === t.body) continue;
    await db.update(notificationTemplates).set({ body: next }).where(eq(notificationTemplates.id, t.id));
    updated += 1;
  }
  await writeAdminAudit(c, admin, {
    action: "template.signature.batch",
    targetType: "notification_template",
    after: { signature, updated },
  });
  return c.json({ updated });
});

async function assertChannelEventFree(
  db: ReturnType<typeof getDb>,
  channel: "email" | "sms" | "inapp",
  event: string,
  excludeId?: number,
): Promise<void> {
  const rows = await db
    .select({ id: notificationTemplates.id })
    .from(notificationTemplates)
    .where(
      excludeId
        ? and(
            eq(notificationTemplates.channel, channel),
            eq(notificationTemplates.event, event),
            ne(notificationTemplates.id, excludeId),
          )
        : and(eq(notificationTemplates.channel, channel), eq(notificationTemplates.event, event)),
    )
    .limit(1);
  if (rows[0]) throw appError("CONFLICT", `模板已存在（channel=${channel}, event=${event}）`);
}
