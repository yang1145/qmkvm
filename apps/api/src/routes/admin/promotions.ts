/** 优惠码管理 CRUD（promotions.manage）。 */
import { Hono } from "hono";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";
import { idParamSchema, pageQuerySchema, promoUpsertSchema } from "@pinhaoji/contracts";
import { appError } from "@pinhaoji/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

export const adminPromotionRoutes = new Hono();

const { promotions, promotionUsages } = schema;

function promoPayload(p: typeof promotions.$inferSelect) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    type: p.type,
    value: p.value,
    scope: p.scope,
    scopeIds: p.scopeIds ?? [],
    minAmount: p.minAmount,
    maxUses: p.maxUses,
    perUserLimit: p.perUserLimit,
    newCustomerOnly: p.newCustomerOnly,
    startsAt: iso(p.startsAt),
    endsAt: iso(p.endsAt),
    active: p.active,
    createdAt: iso(p.createdAt),
  };
}

/** promoUpsertSchema → 落库值（datetime 字符串转 Date） */
function promoValues(body: z.infer<typeof promoUpsertSchema>) {
  return {
    code: body.code,
    name: body.name,
    type: body.type,
    value: body.value,
    scope: body.scope,
    scopeIds: body.scopeIds,
    minAmount: body.minAmount,
    maxUses: body.maxUses,
    perUserLimit: body.perUserLimit,
    newCustomerOnly: body.newCustomerOnly,
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    active: body.active,
  };
}

adminPromotionRoutes.get("/promotions", requireAdmin("promotions.manage"), async (c) => {
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const active = c.req.query("active");
  const where = active === "true" || active === "false" ? eq(promotions.active, active === "true") : undefined;
  const rows = await db
    .select()
    .from(promotions)
    .where(where)
    .orderBy(desc(promotions.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(promotions).where(where);
  return c.json({
    items: rows.map(promoPayload),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

adminPromotionRoutes.post("/promotions", requireAdmin("promotions.manage"), async (c) => {
  const body = promoUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  await assertCodeFree(db, body.code);
  const inserted = await db.insert(promotions).values(promoValues(body));
  const id = inserted[0].insertId;
  await writeAdminAudit(c, admin, {
    action: "promotion.create",
    targetType: "promotion",
    targetId: id,
    after: { code: body.code, type: body.type, value: body.value },
  });
  return c.json({ id });
});

adminPromotionRoutes.put("/promotions/:id", requireAdmin("promotions.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = promoUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(promotions).where(eq(promotions.id, id)).limit(1);
  const promo = rows[0];
  if (!promo) throw appError("NOT_FOUND", "优惠码不存在");
  if (body.code !== promo.code) await assertCodeFree(db, body.code, id);
  await db.update(promotions).set(promoValues(body)).where(eq(promotions.id, id));
  await writeAdminAudit(c, admin, {
    action: "promotion.update",
    targetType: "promotion",
    targetId: id,
    before: { code: promo.code, type: promo.type, value: promo.value, active: promo.active },
    after: { code: body.code, type: body.type, value: body.value, active: body.active },
  });
  return c.json({ ok: true });
});

adminPromotionRoutes.delete("/promotions/:id", requireAdmin("promotions.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(promotions).where(eq(promotions.id, id)).limit(1);
  const promo = rows[0];
  if (!promo) throw appError("NOT_FOUND", "优惠码不存在");
  const used = await db
    .select({ id: promotionUsages.id })
    .from(promotionUsages)
    .where(eq(promotionUsages.promotionId, id))
    .limit(1);
  if (used[0]) {
    // 已有核销记录：只允许停用（保留追溯）
    await db.update(promotions).set({ active: false }).where(eq(promotions.id, id));
    await writeAdminAudit(c, admin, {
      action: "promotion.disable",
      targetType: "promotion",
      targetId: id,
      before: { active: promo.active },
      after: { active: false, reason: "已有核销记录，删除降级为停用" },
    });
    return c.json({ ok: true, disabled: true });
  }
  await db.delete(promotions).where(eq(promotions.id, id));
  await writeAdminAudit(c, admin, {
    action: "promotion.delete",
    targetType: "promotion",
    targetId: id,
    before: { code: promo.code },
  });
  return c.json({ ok: true });
});

async function assertCodeFree(db: ReturnType<typeof getDb>, code: string, excludeId?: number): Promise<void> {
  const rows = await db
    .select({ id: promotions.id })
    .from(promotions)
    .where(excludeId ? and(eq(promotions.code, code), ne(promotions.id, excludeId)) : eq(promotions.code, code))
    .limit(1);
  if (rows[0]) throw appError("CONFLICT", `优惠码已存在：${code}`);
}
