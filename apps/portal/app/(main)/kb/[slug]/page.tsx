"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { z } from "zod";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const kbArticleDetailDto = z.object({
  id: z.number(),
  categoryId: z.number(),
  categoryName: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  contentHtml: z.string(),
  visibility: z.enum(["public", "login"]),
  views: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type KbArticleDetail = z.infer<typeof kbArticleDetailDto>;

export default function KbArticlePage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const { user, loading: authLoading } = useAuth();
  const [article, setArticle] = React.useState<KbArticleDetail | null>(null);
  const [needLogin, setNeedLogin] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (authLoading || !slug) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setNeedLogin(false);
    api
      .get("/kb/articles/" + encodeURIComponent(slug), { parse: kbArticleDetailDto, silent: true })
      .then((d) => {
        if (alive) setArticle(d);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.code === "AUTH_REQUIRED") {
          setNeedLogin(true);
        } else if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("加载失败，请稍后重试");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, authLoading, user]);

  if (loading || authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (needLogin) {
    const next = typeof window === "undefined" ? "" : encodeURIComponent(window.location.pathname);
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-lg border border-dashed bg-card px-6 py-12 text-center">
        <div className="text-3xl">🔒</div>
        <h1 className="text-lg font-semibold">本文需登录后查看</h1>
        <p className="text-sm text-muted-foreground">
          该内容仅对已登录用户可见，请先登录后继续阅读。
        </p>
        <Button asChild>
          <Link href={`/login?next=${next}`}>前往登录</Link>
        </Button>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-lg border border-dashed bg-card px-6 py-12 text-center">
        <h1 className="text-lg font-semibold">文章不存在或未发布</h1>
        <Button asChild variant="outline">
          <Link href="/kb">返回帮助中心</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/kb" className="text-sm text-muted-foreground hover:text-foreground">
        ← 返回帮助中心
      </Link>
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{article.title}</h1>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {article.categoryName ? (
                <Link
                  href="/kb"
                  className="rounded-full bg-muted px-2 py-0.5 hover:text-foreground"
                >
                  {article.categoryName}
                </Link>
              ) : null}
              <span>{article.views} 次浏览</span>
              <span>更新于 {formatDateTime(article.updatedAt)}</span>
              {article.visibility === "login" ? (
                <span className="text-amber-600">🔒 登录可见</span>
              ) : null}
            </div>
          </div>
          <div className="h-px bg-border" />
          {/* contentHtml 由后台可信内容保障（kb.manage 权限编辑） */}
          <div
            className="space-y-3 text-sm leading-relaxed [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_p]:my-2 [&_li]:ml-5 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: article.contentHtml }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
