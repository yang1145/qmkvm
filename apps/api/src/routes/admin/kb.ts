/**
 * 知识库管理（kb.manage）：分类 CRUD（删除预检 409）、文章 CRUD（写审计）。
 * contentHtml 直接存 HTML（后台可信内容，门户渲染不做二次净化）。
 */
import { Hono } from "hono";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import { idParamSchema, pageQuerySchema } from "@qmkvm/contracts";
import { appError } from "@qmkvm/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

export const adminKbRoutes = new Hono();

const { kbArticles, kbCategories } = schema;

/** slug 缺省时按名称生成（中文 → 拼音不可用，走时间戳兜底） */
function normalizeSlug(name: string, slug?: string): string {
  const base = (slug ?? name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base.slice(0, 100) : `kb-${Date.now().toString(36)}`;
}

async function loadCategory(id: number) {
  const rows = await getDb().select().from(kbCategories).where(eq(kbCategories.id, id)).limit(1);
  const cat = rows[0];
  if (!cat) throw appError("NOT_FOUND", "知识库分类不存在");
  return cat;
}

async function loadArticle(id: number) {
  const rows = await getDb().select().from(kbArticles).where(eq(kbArticles.id, id)).limit(1);
  const a = rows[0];
  if (!a) throw appError("NOT_FOUND", "知识库文章不存在");
  return a;
}

// ============ 分类 ============

const categoryUpsert = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(),
  sortOrder: z.number().int().default(0),
});

adminKbRoutes.get("/kb/categories", requireAdmin("kb.manage"), async (c) => {
  const db = getDb();
  const rows = await db
    .select({
      id: kbCategories.id,
      name: kbCategories.name,
      slug: kbCategories.slug,
      sortOrder: kbCategories.sortOrder,
      articleCount: sql<number>`count(${kbArticles.id})`,
      createdAt: kbCategories.createdAt,
    })
    .from(kbCategories)
    .leftJoin(kbArticles, eq(kbArticles.categoryId, kbCategories.id))
    .groupBy(kbCategories.id)
    .orderBy(asc(kbCategories.sortOrder), asc(kbCategories.id));
  return c.json({
    items: rows.map((r) => ({
      ...r,
      articleCount: Number(r.articleCount),
      createdAt: iso(r.createdAt),
    })),
    total: rows.length,
    page: 1,
    pageSize: rows.length,
  });
});

adminKbRoutes.post("/kb/categories", requireAdmin("kb.manage"), async (c) => {
  const body = categoryUpsert.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  const slug = normalizeSlug(body.name, body.slug);
  const dup = await db.select({ id: kbCategories.id }).from(kbCategories).where(eq(kbCategories.slug, slug)).limit(1);
  if (dup[0]) throw appError("CONFLICT", `分类 slug 已存在：${slug}`);
  const inserted = await db.insert(kbCategories).values({
    name: body.name,
    slug,
    sortOrder: body.sortOrder,
  });
  const id = inserted[0].insertId;
  await writeAdminAudit(c, admin, {
    action: "kb.category.create",
    targetType: "kb_category",
    targetId: id,
    after: { name: body.name, slug, sortOrder: body.sortOrder },
  });
  return c.json({ id });
});

adminKbRoutes.put("/kb/categories/:id", requireAdmin("kb.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = categoryUpsert.partial().parse(await c.req.json());
  const admin = c.get("admin");
  const cat = await loadCategory(id);
  const db = getDb();

  let slug = cat.slug;
  if (body.slug !== undefined || body.name !== undefined) {
    slug = normalizeSlug(body.name ?? cat.name, body.slug);
    if (slug !== cat.slug) {
      const dup = await db.select({ id: kbCategories.id }).from(kbCategories).where(eq(kbCategories.slug, slug)).limit(1);
      if (dup[0]) throw appError("CONFLICT", `分类 slug 已存在：${slug}`);
    }
  }

  await db
    .update(kbCategories)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      slug,
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    })
    .where(eq(kbCategories.id, id));
  await writeAdminAudit(c, admin, {
    action: "kb.category.update",
    targetType: "kb_category",
    targetId: id,
    before: { name: cat.name, slug: cat.slug, sortOrder: cat.sortOrder },
    after: body,
  });
  return c.json({ ok: true });
});

adminKbRoutes.delete("/kb/categories/:id", requireAdmin("kb.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const admin = c.get("admin");
  const cat = await loadCategory(id);
  const db = getDb();
  const used = await db.select({ id: kbArticles.id }).from(kbArticles).where(eq(kbArticles.categoryId, id)).limit(1);
  if (used[0]) throw appError("CONFLICT", "该分类下存在文章，请先删除或移动文章");
  await db.delete(kbCategories).where(eq(kbCategories.id, id));
  await writeAdminAudit(c, admin, {
    action: "kb.category.delete",
    targetType: "kb_category",
    targetId: id,
    before: { name: cat.name, slug: cat.slug },
  });
  return c.json({ ok: true });
});

// ============ 文章 ============

const articleUpsert = z.object({
  categoryId: z.number().int().positive().optional(),
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).optional(),
  contentHtml: z.string().min(1).max(200000),
  visibility: z.enum(["public", "login"]).default("public"),
  published: z.boolean().default(false),
});

const articleListQuery = z.object({
  ...pageQuerySchema.shape,
  categoryId: z.coerce.number().int().positive().optional(),
  published: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  q: z.string().max(100).optional(),
});

adminKbRoutes.get("/kb/articles", requireAdmin("kb.manage"), async (c) => {
  const db = getDb();
  const q = articleListQuery.parse(c.req.query());
  const where = and(
    q.categoryId ? eq(kbArticles.categoryId, q.categoryId) : undefined,
    q.published !== undefined ? eq(kbArticles.published, q.published) : undefined,
    q.q
      ? or(like(kbArticles.title, `%${q.q}%`), like(kbArticles.contentHtml, `%${q.q}%`))
      : undefined,
  );
  const rows = await db
    .select({
      id: kbArticles.id,
      categoryId: kbArticles.categoryId,
      categoryName: kbCategories.name,
      title: kbArticles.title,
      slug: kbArticles.slug,
      visibility: kbArticles.visibility,
      views: kbArticles.views,
      published: kbArticles.published,
      updatedAt: kbArticles.updatedAt,
      createdAt: kbArticles.createdAt,
    })
    .from(kbArticles)
    .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
    .where(where)
    .orderBy(desc(kbArticles.updatedAt), desc(kbArticles.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(kbArticles).where(where);

  return c.json({
    items: rows.map((r) => ({
      ...r,
      updatedAt: iso(r.updatedAt),
      createdAt: iso(r.createdAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

adminKbRoutes.post("/kb/articles", requireAdmin("kb.manage"), async (c) => {
  const body = articleUpsert.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();
  if (!body.categoryId) throw appError("VALIDATION_FAILED", "请选择文章分类");
  await loadCategory(body.categoryId);

  const slug = normalizeSlug(body.title, body.slug);
  const dup = await db.select({ id: kbArticles.id }).from(kbArticles).where(eq(kbArticles.slug, slug)).limit(1);
  if (dup[0]) throw appError("CONFLICT", `文章 slug 已存在：${slug}`);

  const inserted = await db
    .insert(kbArticles)
    .values({
      categoryId: body.categoryId,
      title: body.title,
      slug,
      contentHtml: body.contentHtml,
      visibility: body.visibility,
      published: body.published,
    });
  const id = inserted[0].insertId;
  await writeAdminAudit(c, admin, {
    action: "kb.article.create",
    targetType: "kb_article",
    targetId: id,
    after: { title: body.title, slug, published: body.published, visibility: body.visibility },
  });
  return c.json({ id });
});

adminKbRoutes.get("/kb/articles/:id", requireAdmin("kb.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const a = await loadArticle(id);
  const cat = await loadCategory(a.categoryId);
  return c.json({
    id: a.id,
    categoryId: a.categoryId,
    categoryName: cat.name,
    title: a.title,
    slug: a.slug,
    contentHtml: a.contentHtml,
    visibility: a.visibility,
    views: a.views,
    published: a.published,
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
  });
});

adminKbRoutes.put("/kb/articles/:id", requireAdmin("kb.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = articleUpsert.partial().parse(await c.req.json());
  const admin = c.get("admin");
  const a = await loadArticle(id);
  const db = getDb();

  let slug = a.slug;
  if (body.slug !== undefined || body.title !== undefined) {
    slug = normalizeSlug(body.title ?? a.title, body.slug);
    if (slug !== a.slug) {
      const dup = await db.select({ id: kbArticles.id }).from(kbArticles).where(eq(kbArticles.slug, slug)).limit(1);
      if (dup[0]) throw appError("CONFLICT", `文章 slug 已存在：${slug}`);
    }
  }
  if (body.categoryId !== undefined && body.categoryId !== a.categoryId) {
    await loadCategory(body.categoryId);
  }

  await db
    .update(kbArticles)
    .set({
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      slug,
      ...(body.contentHtml !== undefined ? { contentHtml: body.contentHtml } : {}),
      ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      ...(body.published !== undefined ? { published: body.published } : {}),
      updatedAt: new Date(),
    })
    .where(eq(kbArticles.id, id));
  await writeAdminAudit(c, admin, {
    action: "kb.article.update",
    targetType: "kb_article",
    targetId: id,
    before: { title: a.title, published: a.published, visibility: a.visibility, categoryId: a.categoryId },
    after: body,
  });
  return c.json({ ok: true });
});

adminKbRoutes.delete("/kb/articles/:id", requireAdmin("kb.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const admin = c.get("admin");
  const a = await loadArticle(id);
  const db = getDb();
  await db.delete(kbArticles).where(eq(kbArticles.id, id));
  await writeAdminAudit(c, admin, {
    action: "kb.article.delete",
    targetType: "kb_article",
    targetId: id,
    before: { title: a.title, slug: a.slug, published: a.published },
  });
  return c.json({ ok: true });
});
