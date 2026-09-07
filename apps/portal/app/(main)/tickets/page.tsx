"use client";

import * as React from "react";
import Link from "next/link";
import { paginated, ticketDto } from "@qmkvm/contracts";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/status-badge";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 10;

export default function TicketsPage() {
  const [page, setPage] = React.useState(1);
  const state = useApiData(
    () =>
      api.get("/tickets", {
        query: { page, pageSize: PAGE_SIZE },
        parse: paginated(ticketDto),
      }),
    [page],
  );

  const total = state.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (state.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="工单支持" description="提交与跟踪技术支持工单" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="工单支持" description="提交与跟踪技术支持工单" />
        <ErrorState message={state.error} onRetry={state.reload} />
      </div>
    );
  }

  const tickets = state.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="工单支持"
        description="提交与跟踪技术支持工单"
        actions={
          <Button asChild>
            <Link href="/tickets/new">新建工单</Link>
          </Button>
        }
      />

      {tickets.length === 0 ? (
        <EmptyState
          title="暂无工单"
          description="遇到问题？提交工单，我们会尽快回复"
          action={
            <Button asChild>
              <Link href="/tickets/new">提交第一个工单</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="rounded-lg border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编号</TableHead>
                  <TableHead>主题</TableHead>
                  <TableHead>部门</TableHead>
                  <TableHead>优先级</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近更新</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="tabular-nums">#{ticket.id}</TableCell>
                    <TableCell>
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {ticket.subject}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {ticket.departmentName ?? "-"}
                    </TableCell>
                    <TableCell>
                      <TicketPriorityBadge priority={ticket.priority} />
                    </TableCell>
                    <TableCell>
                      <TicketStatusBadge status={ticket.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(ticket.lastReplyAt ?? ticket.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

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
        </>
      )}
    </div>
  );
}
