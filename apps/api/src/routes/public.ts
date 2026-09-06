import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@pinhaoji/db";
import { z } from "zod";
import { formatCny } from "@pinhaoji/core";

/**
 * 公开接口：无需登录（目录用于门户商品页，也供官网后续集成）。
 */
export const publicRoutes = new Hono();

publicRoutes.get("/catalog", async (c) => {
  const db = getDb();
  const groups = await db
    .select()
    .from(schema.productGroups)
    .where(eq(schema.productGroups.hidden, false))
    .orderBy(schema.productGroups.sortOrder, schema.productGroups.id);
  const products = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.status, "active"), eq(schema.products.hidden, false)))
    .orderBy(schema.products.sortOrder, schema.products.id);
  const allPricing = await db.select().from(schema.productPricing);
  const allGroups = await db.select().from(schema.configGroups).orderBy(schema.configGroups.sortOrder);
  const allOptions = await db.select().from(schema.configOptions).orderBy(schema.configOptions.sortOrder);

  const result = groups
    .map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      description: g.description,
      products: products
        .filter((p) => p.groupId === g.id)
        .map((p) => ({
          id: p.id,
          groupId: p.groupId,
          name: p.name,
          slug: p.slug,
          tagline: p.tagline,
          moduleCode: p.moduleCode,
          stockTotal: p.stockTotal,
          stockUsed: p.stockUsed,
          inStock: p.stockTotal == null || p.stockUsed < p.stockTotal,
          pricing: allPricing
            .filter((x) => x.productId === p.id)
            .map((x) => ({
              cycle: x.cycle,
              firstPrice: x.firstPrice,
              renewalPrice: x.renewalPrice,
              setupFee: x.setupFee,
            })),
          configGroups: allGroups
            .filter((cg) => cg.productId === p.id)
            .map((cg) => ({
              id: cg.id,
              name: cg.name,
              type: cg.type,
              required: cg.required,
              options: allOptions
                .filter((o) => o.groupId === cg.id)
                .map((o) => ({
                  id: o.id,
                  label: o.label,
                  value: o.value,
                  priceDelta: o.priceDelta,
                  setupDelta: o.setupDelta,
                  isDefault: o.isDefault,
                })),
            })),
        })),
    }))
    .filter((g) => g.products.length > 0);

  return c.json(result);
});

const settingsCache = new Map<string, { value: unknown; at: number }>();
const SETTINGS_TTL_MS = 30_000;

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const hit = settingsCache.get(key);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value as T;
  const db = getDb();
  const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  settingsCache.set(key, { value: row.value, at: Date.now() });
  return row.value as T;
}

publicRoutes.get("/settings", async (c) => {
  const site = await getSetting<Record<string, unknown>>("site");
  const gateways = await getSetting<Record<string, unknown>>("payment.gateways");
  return c.json({
    siteName: (site?.["siteName"] as string) ?? "拼好机",
    announcement: (site?.["announcement"] as string) ?? null,
    paymentMethods: gateways
      ? Object.entries(gateways)
          .filter(([, v]) => (v as { enabled?: boolean })?.enabled)
          .map(([k]) => k)
      : ["alipay", "wechat"],
    priceExample: formatCny(3900),
  });
});

export const publicSettingsQuerySchema = z.object({});
