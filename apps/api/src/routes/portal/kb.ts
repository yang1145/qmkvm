/**
 * 门户知识库（公开读，无需登录）：
 * - GET /kb/categories  分类列表（含各分类已发布文章数）
 * - GET /kb/articles    已发布文章分页列表（categoryId/q 过滤）
 * - GET /kb/articles/:slug  文章详情（visibility=login 未登录 → 401；成功 views+1）
 */
import { Hono } from "hono";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import { pageQuerySchema } from "@qmkvm/contracts";
import { appError } from "@qmkvm/core";
import { resolvePortalSession } from "@qmkvm/auth";
import { getPortalToken, type PortalUser } from "../../middleware/auth.js";

export const portalKbRoutes = new Hono();

const { kbArticles, kbCategories } = schema;

/** 可选会话：拿到用户则说明已登录（login 可见性判断用），否则 null */
async function optionalUser(c: { req: { raw: Request } }): Promise<PortalUser | null> {
  const token = getPortalToken(c);
  if (!token) return null;
  return resolvePortalSession(getDb(), token);
}

portalKbRoutes.get("/categories", async (c) => {
  const db = getDb();
  const rows = await db
    .select({
      id: kbCategories.id,
      name: kbCategories.name,
      slug: kbCategories.slug,
      sortOrder: kbCategories.sortOrder,
      articleCount: sql<number>`count(${kbArticles.id})`,
    })
    .from(kbCategories)
    .leftJoin(
      kbArticles,
      and(eq(kbArticles.categoryId, kbCategories.id), eq(kbArticles.published, true)),
    )
    .groupBy(kbCategories.id)
    .orderBy(asc(kbCategories.sortOrder), asc(kbCategories.id));
  return c.json({
    items: rows.map((r) => ({ ...r, articleCount: Number(r.articleCount) })),
  });
});

const listQuery = z.object({
  ...pageQuerySchema.shape,
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().max(100).optional(),
});

portalKbRoutes.get("/articles", async (c) => {
  const db = getDb();
  const q = listQuery.parse(c.req.query());
  const where = and(
    eq(kbArticles.published, true),
    q.categoryId ? eq(kbArticles.categoryId, q.categoryId) : undefined,
    q.q
      ? or(
          like(kbArticles.title, `%${q.q}%`),
          like(kbArticles.contentHtml, `%${q.q}%`),
        )
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
      updatedAt: kbArticles.updatedAt,
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
      id: r.id,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      title: r.title,
      slug: r.slug,
      visibility: r.visibility,
      views: r.views,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

portalKbRoutes.get("/articles/:slug", async (c) => {
  const db = getDb();
  const slug = z.string().min(1).max(200).parse(c.req.param("slug"));
  const rows = await db
    .select()
    .from(kbArticles)
    .where(and(eq(kbArticles.slug, slug), eq(kbArticles.published, true)))
    .limit(1);
  const article = rows[0];
  if (!article) throw appError("NOT_FOUND", "文章不存在或未发布");

  if (article.visibility === "login") {
    const user = await optionalUser(c);
    if (!user) throw appError("AUTH_REQUIRED", "本文需登录后查看");
  }

  await db
    .update(kbArticles)
    .set({ views: sql`${kbArticles.views} + 1` })
    .where(eq(kbArticles.id, article.id));

  const cat = (
    await db
      .select({ name: kbCategories.name, slug: kbCategories.slug })
      .from(kbCategories)
      .where(eq(kbCategories.id, article.categoryId))
      .limit(1)
  )[0];

  return c.json({
    id: article.id,
    categoryId: article.categoryId,
    categoryName: cat?.name ?? null,
    categorySlug: cat?.slug ?? null,
    title: article.title,
    slug: article.slug,
    contentHtml: article.contentHtml,
    visibility: article.visibility,
    views: article.views + 1,
    published: article.published,
    updatedAt: article.updatedAt instanceof Date ? article.updatedAt.toISOString() : String(article.updatedAt),
    createdAt: article.createdAt instanceof Date ? article.createdAt.toISOString() : String(article.createdAt),
  });
});
