/**
 * 商品目录管理：分组 CRUD、商品 CRUD（整体保存周期定价）、
 * 配置组/配置选项独立端点。读 products.read，写 products.manage。
 */
import { Hono } from "hono";
import { and, asc, desc, eq, inArray, like, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";
import type { Json } from "@pinhaoji/db/schema";
import { idParamSchema, pageQuerySchema, productUpsertSchema } from "@pinhaoji/contracts";
import { appError } from "@pinhaoji/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

export const adminProductRoutes = new Hono();

const { productGroups, products, productPricing, configGroups, configOptions, services } = schema;

const groupUpsertSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug 仅允许小写字母、数字与连字符"),
  description: z.string().max(5000).nullable().optional(),
  sortOrder: z.number().int().default(0),
  hidden: z.boolean().default(false),
});

const groupPatchSchema = groupUpsertSchema.partial();

const configGroupSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["select", "radio", "checkbox", "quantity"]),
  required: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const configGroupPatchSchema = configGroupSchema.partial();

const configOptionSchema = z.object({
  label: z.string().min(1).max(100),
  value: z.string().min(1).max(100),
  priceDelta: z.number().int().min(0).default(0),
  setupDelta: z.number().int().min(0).default(0),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

const configOptionPatchSchema = configOptionSchema.partial();

// —— 商品分组 ——

adminProductRoutes.get("/product-groups", requireAdmin("products.read"), async (c) => {
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const rows = await db
    .select()
    .from(productGroups)
    .orderBy(asc(productGroups.sortOrder), asc(productGroups.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(productGroups);
  const counts = await db
    .select({ groupId: products.groupId, n: sql<number>`count(*)` })
    .from(products)
    .groupBy(products.groupId);
  const countMap = new Map(counts.map((r) => [r.groupId, Number(r.n)]));
  return c.json({
    items: rows.map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      description: g.description,
      sortOrder: g.sortOrder,
      hidden: g.hidden,
      productCount: countMap.get(g.id) ?? 0,
      createdAt: iso(g.createdAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

adminProductRoutes.post("/product-groups", requireAdmin("products.manage"), async (c) => {
  const body = groupUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  await assertSlugFree(db, body.slug);
  const inserted = await db.insert(productGroups).values({
    name: body.name,
    slug: body.slug,
    description: body.description ?? null,
    sortOrder: body.sortOrder,
    hidden: body.hidden,
  });
  const id = inserted[0].insertId;
  await writeAdminAudit(c, admin, {
    action: "product.group.create",
    targetType: "product_group",
    targetId: id,
    after: { name: body.name, slug: body.slug },
  });
  return c.json({ id });
});

adminProductRoutes.put("/product-groups/:id", requireAdmin("products.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = groupPatchSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(productGroups).where(eq(productGroups.id, id)).limit(1);
  const group = rows[0];
  if (!group) throw appError("CATALOG_NOT_FOUND", "商品分组不存在");
  if (body.slug && body.slug !== group.slug) await assertSlugFree(db, body.slug, id);
  await db
    .update(productGroups)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
    })
    .where(eq(productGroups.id, id));
  await writeAdminAudit(c, admin, {
    action: "product.group.update",
    targetType: "product_group",
    targetId: id,
    before: { name: group.name, slug: group.slug, hidden: group.hidden, sortOrder: group.sortOrder },
    after: body,
  });
  return c.json({ ok: true });
});

adminProductRoutes.delete("/product-groups/:id", requireAdmin("products.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(productGroups).where(eq(productGroups.id, id)).limit(1);
  if (!rows[0]) throw appError("CATALOG_NOT_FOUND", "商品分组不存在");
  const used = await db.select({ id: products.id }).from(products).where(eq(products.groupId, id)).limit(1);
  if (used[0]) throw appError("CONFLICT", "分组下存在商品，请先移除或删除商品");
  await db.delete(productGroups).where(eq(productGroups.id, id));
  await writeAdminAudit(c, admin, {
    action: "product.group.delete",
    targetType: "product_group",
    targetId: id,
    before: { name: rows[0].name, slug: rows[0].slug },
  });
  return c.json({ ok: true });
});

async function assertSlugFree(db: ReturnType<typeof getDb>, slug: string, excludeId?: number): Promise<void> {
  const rows = await db
    .select({ id: productGroups.id })
    .from(productGroups)
    .where(excludeId ? and(eq(productGroups.slug, slug), ne(productGroups.id, excludeId)) : eq(productGroups.slug, slug))
    .limit(1);
  if (rows[0]) throw appError("CONFLICT", `分组 slug 已存在：${slug}`);
}

// —— 商品（含周期定价整体保存） ——

/** 商品行 → 响应负载（含 pricing / configGroups+options） */
function productPayload(
  p: typeof products.$inferSelect,
  pricing: (typeof productPricing.$inferSelect)[],
  groups: (typeof configGroups.$inferSelect)[],
  options: (typeof configOptions.$inferSelect)[],
) {
  return {
    id: p.id,
    groupId: p.groupId,
    name: p.name,
    slug: p.slug,
    tagline: p.tagline,
    descriptionHtml: p.descriptionHtml,
    moduleCode: p.moduleCode,
    moduleConfig: p.moduleConfig,
    stockTotal: p.stockTotal,
    stockUsed: p.stockUsed,
    hidden: p.hidden,
    requiresIdentity: p.requiresIdentity,
    allowUpgrade: p.allowUpgrade,
    allowDowngrade: p.allowDowngrade,
    sortOrder: p.sortOrder,
    status: p.status,
    createdAt: iso(p.createdAt),
    pricing: pricing
      .filter((x) => x.productId === p.id)
      .map((x) => ({ cycle: x.cycle, firstPrice: x.firstPrice, renewalPrice: x.renewalPrice, setupFee: x.setupFee })),
    configGroups: groups
      .filter((g) => g.productId === p.id)
      .map((g) => ({
        id: g.id,
        name: g.name,
        type: g.type,
        required: g.required,
        sortOrder: g.sortOrder,
        options: options
          .filter((o) => o.groupId === g.id)
          .map((o) => ({
            id: o.id,
            label: o.label,
            value: o.value,
            priceDelta: o.priceDelta,
            setupDelta: o.setupDelta,
            isDefault: o.isDefault,
            sortOrder: o.sortOrder,
          })),
      })),
  };
}

/** 商品列表页的定价/配置批量装载 */
async function loadProductBundle(db: ReturnType<typeof getDb>, productIds: number[]) {
  const pricing = productIds.length
    ? await db.select().from(productPricing).where(inArray(productPricing.productId, productIds))
    : [];
  const groups = productIds.length
    ? await db
        .select()
        .from(configGroups)
        .where(inArray(configGroups.productId, productIds))
        .orderBy(asc(configGroups.sortOrder), asc(configGroups.id))
    : [];
  const groupIds = groups.map((g) => g.id);
  const options = groupIds.length
    ? await db
        .select()
        .from(configOptions)
        .where(inArray(configOptions.groupId, groupIds))
        .orderBy(asc(configOptions.sortOrder), asc(configOptions.id))
    : [];
  return { pricing, groups, options };
}

adminProductRoutes.get("/products", requireAdmin("products.read"), async (c) => {
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const groupId = c.req.query("groupId");
  const status = c.req.query("status");
  const search = c.req.query("q")?.trim();
  const where = and(
    groupId && /^\d+$/.test(groupId) ? eq(products.groupId, Number(groupId)) : undefined,
    status === "active" || status === "inactive" ? eq(products.status, status) : undefined,
    search ? like(products.name, `%${search}%`) : undefined,
  );

  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(asc(products.sortOrder), desc(products.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(products).where(where);
  const bundle = await loadProductBundle(db, rows.map((r) => r.id));

  return c.json({
    items: rows.map((p) => productPayload(p, bundle.pricing, bundle.groups, bundle.options)),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

adminProductRoutes.get("/products/:id", requireAdmin("products.read"), async (c) => {
  const db = getDb();
  const id = idParamSchema.parse(c.req.param()).id;
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  const product = rows[0];
  if (!product) throw appError("CATALOG_NOT_FOUND", "商品不存在");
  const bundle = await loadProductBundle(db, [id]);
  return c.json(productPayload(product, bundle.pricing, bundle.groups, bundle.options));
});

/** 新建商品（含周期定价整体写入） */
adminProductRoutes.post("/products", requireAdmin("products.manage"), async (c) => {
  const body = productUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  await assertGroupExists(db, body.groupId);
  await assertProductSlugFree(db, body.slug);

  const id = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(products)
      .values({
        groupId: body.groupId,
        name: body.name,
        slug: body.slug,
        tagline: body.tagline ?? null,
        descriptionHtml: body.descriptionHtml ?? null,
        moduleCode: body.moduleCode,
        moduleConfig: (body.moduleConfig ?? null) as Json | null,
        stockTotal: body.stockTotal ?? null,
        hidden: body.hidden,
        requiresIdentity: body.requiresIdentity,
        allowUpgrade: body.allowUpgrade,
        allowDowngrade: body.allowDowngrade,
        sortOrder: body.sortOrder,
        status: body.status,
      });
    const productId = inserted[0].insertId;
    await tx.insert(productPricing).values(
      body.pricing.map((p) => ({
        productId,
        cycle: p.cycle,
        firstPrice: p.firstPrice,
        renewalPrice: p.renewalPrice,
        setupFee: p.setupFee,
      })),
    );
    return productId;
  });

  await writeAdminAudit(c, admin, {
    action: "product.create",
    targetType: "product",
    targetId: id,
    after: { name: body.name, slug: body.slug, status: body.status, pricing: body.pricing },
  });
  return c.json({ id });
});

/** 更新商品（整体保存周期定价：删旧插新） */
adminProductRoutes.put("/products/:id", requireAdmin("products.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = productUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  const product = rows[0];
  if (!product) throw appError("CATALOG_NOT_FOUND", "商品不存在");
  await assertGroupExists(db, body.groupId);
  if (body.slug !== product.slug) await assertProductSlugFree(db, body.slug, id);

  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({
        groupId: body.groupId,
        name: body.name,
        slug: body.slug,
        tagline: body.tagline ?? null,
        descriptionHtml: body.descriptionHtml ?? null,
        moduleCode: body.moduleCode,
        moduleConfig: (body.moduleConfig ?? null) as Json | null,
        stockTotal: body.stockTotal ?? null,
        hidden: body.hidden,
        requiresIdentity: body.requiresIdentity,
        allowUpgrade: body.allowUpgrade,
        allowDowngrade: body.allowDowngrade,
        sortOrder: body.sortOrder,
        status: body.status,
      })
      .where(eq(products.id, id));
    await tx.delete(productPricing).where(eq(productPricing.productId, id));
    await tx.insert(productPricing).values(
      body.pricing.map((p) => ({
        productId: id,
        cycle: p.cycle,
        firstPrice: p.firstPrice,
        renewalPrice: p.renewalPrice,
        setupFee: p.setupFee,
      })),
    );
  });

  await writeAdminAudit(c, admin, {
    action: "product.update",
    targetType: "product",
    targetId: id,
    before: { name: product.name, slug: product.slug, status: product.status, groupId: product.groupId },
    after: { name: body.name, slug: body.slug, status: body.status, groupId: body.groupId, pricing: body.pricing },
  });
  return c.json({ ok: true });
});

adminProductRoutes.delete("/products/:id", requireAdmin("products.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  const product = rows[0];
  if (!product) throw appError("CATALOG_NOT_FOUND", "商品不存在");
  const used = await db.select({ id: services.id }).from(services).where(eq(services.productId, id)).limit(1);
  if (used[0]) throw appError("CONFLICT", "该商品下存在服务实例，不可删除（可改为下架）");
  await db.delete(products).where(eq(products.id, id)); // 定价/配置组/选项级联删除
  await writeAdminAudit(c, admin, {
    action: "product.delete",
    targetType: "product",
    targetId: id,
    before: { name: product.name, slug: product.slug, status: product.status },
  });
  return c.json({ ok: true });
});

async function assertGroupExists(db: ReturnType<typeof getDb>, groupId: number): Promise<void> {
  const rows = await db.select({ id: productGroups.id }).from(productGroups).where(eq(productGroups.id, groupId)).limit(1);
  if (!rows[0]) throw appError("CATALOG_NOT_FOUND", "商品分组不存在");
}

async function assertProductSlugFree(db: ReturnType<typeof getDb>, slug: string, excludeId?: number): Promise<void> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(excludeId ? and(eq(products.slug, slug), ne(products.id, excludeId)) : eq(products.slug, slug))
    .limit(1);
  if (rows[0]) throw appError("CONFLICT", `商品 slug 已存在：${slug}`);
}

// —— 配置组 / 配置选项 ——

/** 新建商品配置组 */
adminProductRoutes.post("/products/:id/config-groups", requireAdmin("products.manage"), async (c) => {
  const productId = idParamSchema.parse(c.req.param()).id;
  const body = configGroupSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  if (!rows[0]) throw appError("CATALOG_NOT_FOUND", "商品不存在");
  const inserted = await db
    .insert(configGroups)
    .values({ productId, name: body.name, type: body.type, required: body.required, sortOrder: body.sortOrder });
  const id = inserted[0].insertId;
  await writeAdminAudit(c, admin, {
    action: "product.config_group.create",
    targetType: "config_group",
    targetId: id,
    after: { productId, ...body },
  });
  return c.json({ id });
});

adminProductRoutes.put("/config-groups/:id", requireAdmin("products.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = configGroupPatchSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(configGroups).where(eq(configGroups.id, id)).limit(1);
  const group = rows[0];
  if (!group) throw appError("CATALOG_NOT_FOUND", "配置组不存在");
  await db
    .update(configGroups)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.required !== undefined ? { required: body.required } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    })
    .where(eq(configGroups.id, id));
  await writeAdminAudit(c, admin, {
    action: "product.config_group.update",
    targetType: "config_group",
    targetId: id,
    before: { name: group.name, type: group.type, required: group.required },
    after: body,
  });
  return c.json({ ok: true });
});

adminProductRoutes.delete("/config-groups/:id", requireAdmin("products.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(configGroups).where(eq(configGroups.id, id)).limit(1);
  if (!rows[0]) throw appError("CATALOG_NOT_FOUND", "配置组不存在");
  await db.delete(configGroups).where(eq(configGroups.id, id)); // 选项级联删除
  await writeAdminAudit(c, admin, {
    action: "product.config_group.delete",
    targetType: "config_group",
    targetId: id,
    before: { name: rows[0].name, productId: rows[0].productId },
  });
  return c.json({ ok: true });
});

/** 新建配置选项（设为默认时清除组内其余默认） */
adminProductRoutes.post("/config-groups/:id/options", requireAdmin("products.manage"), async (c) => {
  const groupId = idParamSchema.parse(c.req.param()).id;
  const body = configOptionSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(configGroups).where(eq(configGroups.id, groupId)).limit(1);
  const group = rows[0];
  if (!group) throw appError("CATALOG_NOT_FOUND", "配置组不存在");
  const inserted = await db
    .insert(configOptions)
    .values({
      groupId,
      label: body.label,
      value: body.value,
      priceDelta: body.priceDelta,
      setupDelta: body.setupDelta,
      isDefault: body.isDefault,
      sortOrder: body.sortOrder,
    });
  const id = inserted[0].insertId;
  if (body.isDefault) {
    await db
      .update(configOptions)
      .set({ isDefault: false })
      .where(and(eq(configOptions.groupId, groupId), ne(configOptions.id, id), eq(configOptions.isDefault, true)));
  }
  await writeAdminAudit(c, admin, {
    action: "product.config_option.create",
    targetType: "config_option",
    targetId: id,
    after: { groupId, ...body },
  });
  return c.json({ id });
});

adminProductRoutes.put("/config-options/:id", requireAdmin("products.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = configOptionPatchSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(configOptions).where(eq(configOptions.id, id)).limit(1);
  const option = rows[0];
  if (!option) throw appError("CATALOG_NOT_FOUND", "配置选项不存在");
  await db
    .update(configOptions)
    .set({
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.value !== undefined ? { value: body.value } : {}),
      ...(body.priceDelta !== undefined ? { priceDelta: body.priceDelta } : {}),
      ...(body.setupDelta !== undefined ? { setupDelta: body.setupDelta } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    })
    .where(eq(configOptions.id, id));
  if (body.isDefault) {
    await db
      .update(configOptions)
      .set({ isDefault: false })
      .where(and(eq(configOptions.groupId, option.groupId), ne(configOptions.id, id), eq(configOptions.isDefault, true)));
  }
  await writeAdminAudit(c, admin, {
    action: "product.config_option.update",
    targetType: "config_option",
    targetId: id,
    before: { label: option.label, value: option.value, priceDelta: option.priceDelta },
    after: body,
  });
  return c.json({ ok: true });
});

adminProductRoutes.delete("/config-options/:id", requireAdmin("products.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const admin = c.get("admin");
  const db = getDb();
  const rows = await db.select().from(configOptions).where(eq(configOptions.id, id)).limit(1);
  const option = rows[0];
  if (!option) throw appError("CATALOG_NOT_FOUND", "配置选项不存在");
  await db.delete(configOptions).where(eq(configOptions.id, id));
  await writeAdminAudit(c, admin, {
    action: "product.config_option.delete",
    targetType: "config_option",
    targetId: id,
    before: { label: option.label, value: option.value, groupId: option.groupId },
  });
  return c.json({ ok: true });
});
