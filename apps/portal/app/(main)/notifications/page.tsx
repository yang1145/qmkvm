"use client";

import * as React from "react";
import { z } from "zod";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApiData } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/format";
import { notificationDtoSchema } from "@/lib/schemas";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const { refreshUnread } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = React.useState(1);
  const [expanded, setExpanded] = React.useState<number | null>(null);

  const state = useApiData(
    () =>
      api.get("/notifications", {
        query: { page, pageSize: PAGE_SIZE },
        parse: z.object({ items: z.array(notificationDtoSchema), total: z.number() }),
      }),
    [page],
  );

  const reload = React.useCallback(() => {
    state.reload();
    void refreshUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUnread]);

  const markRead = async (ids: number[]) => {
    try {
      await api.post("/notifications/read", { ids });
      reload();
    } catch {
      // Toast 已由 api 层弹出
    }
  };

  const markAllRead = async () => {
    try {
      await api.post("/notifications/read", { all: true });
      toast({ title: "已全部标记为已读", variant: "success" });
      reload();
    } catch {
      // Toast 已由 api 层弹出
    }
  };

  const unread = (state.data?.items ?? []).filter((n) => !n.readAt).length;
  const total = state.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (state.loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="通知中心" description="账单、服务与工单的站内通知" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="通知中心" description="账单、服务与工单的站内通知" />
        <ErrorState message={state.error} onRetry={state.reload} />
      </div>
    );
  }

  const items = state.data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="通知中心"
        description="账单、服务与工单的站内通知"
        actions={
          unread > 0 ? (
            <Button variant="outline" onClick={() => void markAllRead()}>
              全部已读
            </Button>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState title="暂无通知" description="新的账单、服务与工单动态会出现在这里" />
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const isUnread = !n.readAt;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setExpanded((prev) => (prev === n.id ? null : n.id));
                  if (isUnread) void markRead([n.id]);
                }}
                className={cn(
                  "block w-full rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent/40",
                  isUnread && "border-primary/40",
                )}
              >
                <div className="flex items-start gap-3">
                  {isUnread ? (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  ) : (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-transparent" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className={cn("truncate text-sm", isUnread ? "font-semibold" : "font-medium")}>
                        {n.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDateTime(n.createdAt)}
                      </span>
                    </div>
                    {expanded === n.id ? (
                      <div className="mt-1.5 text-sm text-muted-foreground whitespace-pre-wrap">
                        {n.body}
                      </div>
                    ) : (
                      <div className="mt-0.5 truncate text-sm text-muted-foreground">{n.body}</div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
          <span>
            第 {page} / {totalPages} 页 · 共 {total} 条
          </span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
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
    </div>
  );
}
