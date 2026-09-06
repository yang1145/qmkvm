"use client";

import * as React from "react";
import Link from "next/link";
import { z } from "zod";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

const kbCategoryDto = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  articleCount: z.number(),
});

const kbArticleListItemDto = z.object({
  id: z.number(),
  categoryId: z.number(),
  categoryName: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  visibility: z.enum(["public", "login"]),
  views: z.number(),
  updatedAt: z.string(),
});

type KbCategory = z.infer<typeof kbCategoryDto>;
type KbArticleListItem = z.infer<typeof kbArticleListItemDto>;

export default function KbListPage() {
  const { user } = useAuth();
  const [categoryId, setCategoryId] = React.useState<number | null>(null);
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);

  const categoriesState = useApiData(
    () => api.get<{ items: KbCategory[] }>("/kb/categories", { parse: z.object({ items: z.array(kbCategoryDto) }) }),
    [],
  );
  const articlesState = useApiData(
    () =>
      api.get<{ items: KbArticleListItem[]; total: number }>("/kb/articles", {
        query: { categoryId: categoryId ?? undefined, q: query, page, pageSize: PAGE_SIZE },
        parse: z.object({ items: z.array(kbArticleListItemDto), total: z.number() }),
      }),
    [categoryId, query, page],
  );

  const categories = categoriesState.data?.items ?? [];
  const articles = articlesState.data?.items ?? [];
  const total = articlesState.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const doSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQuery(search.trim());
  };

  return (
    <div className="space-y-6">
      <PageHeader title="帮助中心" description="常见问题与使用文档" />

      <form onSubmit={doSearch} className="flex max-w-xl gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索文章标题或内容…"
          aria-label="搜索知识库"
        />
        <Button type="submit">搜索</Button>
      </form>

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        {/* 分类侧栏 */}
        <aside className="space-y-1">
          <button
            type="button"
            onClick={() => {
              setCategoryId(null);
              setPage(1);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
              categoryId === null
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            <span>全部文章</span>
            <span className="text-xs">
              {categories.reduce((n, c) => n + c.articleCount, 0)}
            </span>
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCategoryId(c.id);
                setPage(1);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                categoryId === c.id
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <span>{c.name}</span>
              <span className="text-xs">{c.articleCount}</span>
            </button>
          ))}
        </aside>

        {/* 文章列表 */}
        <div className="space-y-3">
          {categoriesState.loading || articlesState.loading ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : articlesState.error ? (
            <ErrorState message={articlesState.error} onRetry={articlesState.reload} />
          ) : articles.length === 0 ? (
            <EmptyState
              title="暂无相关文章"
              description={query ? `未找到与「${query}」相关的文章，换个关键词试试` : "该分类下还没有已发布的文章"}
            />
          ) : (
            <>
              {articles.map((a) => (
                <Link
                  key={a.id}
                  href={`/kb/${a.slug}`}
                  className="block rounded-lg border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-medium text-foreground">
                      {a.title}
                      {a.visibility === "login" && !user ? (
                        <span className="ml-2 align-middle text-xs font-normal text-amber-600">
                          🔒 登录可见
                        </span>
                      ) : null}
                    </h2>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(a.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {a.categoryName ?? "未分类"} · {a.views} 次浏览
                  </div>
                </Link>
              ))}

              {totalPages > 1 ? (
                <div className="flex items-center justify-between pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    第 {page} / {totalPages} 页
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    下一页
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
