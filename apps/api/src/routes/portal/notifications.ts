import { Hono } from "hono";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";

type User = typeof schema.users.$inferSelect;
import { pageQuerySchema } from "@pinhaoji/contracts";
import { requireAuth } from "../../middleware/auth.js";

export const portalNotificationRoutes = new Hono();
portalNotificationRoutes.use("*", requireAuth());

portalNotificationRoutes.get("/notifications", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const where = eq(schema.userNotifications.userId, user.id);
  const rows = await db
    .select()
    .from(schema.userNotifications)
    .where(where)
    .orderBy(desc(schema.userNotifications.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const unread = await db
    .select({ id: schema.userNotifications.id })
    .from(schema.userNotifications)
    .where(and(where, isNull(schema.userNotifications.readAt)));
  return c.json({
    items: rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      link: n.link,
      read: n.readAt != null,
      createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
    })),
    unreadCount: unread.length,
    total: rows.length,
    page: q.page,
    pageSize: q.pageSize,
  });
});

portalNotificationRoutes.post("/notifications/read", async (c) => {
  const user = c.get("user") as User;
  const db = getDb();
  const body = z
    .object({ ids: z.array(z.number().int().positive()).optional(), all: z.boolean().optional() })
    .parse(await c.req.json().catch(() => ({})));
  const base = eq(schema.userNotifications.userId, user.id);
  if (body.ids && body.ids.length > 0) {
    await db
      .update(schema.userNotifications)
      .set({ readAt: new Date() })
      .where(and(base, inArray(schema.userNotifications.id, body.ids)));
  } else {
    await db
      .update(schema.userNotifications)
      .set({ readAt: new Date() })
      .where(and(base, isNull(schema.userNotifications.readAt)));
  }
  return c.json({ ok: true });
});
