"use client";

import * as React from "react";
import Link from "next/link";
import { paginated, serviceDto } from "@qmkvm/contracts";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatCny, cycleLabel, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { ServiceStatusBadge } from "@/components/status-badge";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 10;

export default function ServicesPage() {
  const [page, setPage] = React.useState(1);

  const state = useApiData(
    () =>
      api.get("/services", {
        query: { page, pageSize: PAGE_SIZE },
        parse: paginated(serviceDto),
      }),
    [page],
  );

  const total = state.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (state.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="我的服务" description="运行中的云服务与生命周期管理" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="我的服务" description="运行中的云服务与生命周期管理" />
        <ErrorState message={state.error} onRetry={state.reload} />
      </div>
    );
  }

  const services = state.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="我的服务"
        description="运行中的云服务与生命周期管理"
        actions={
          <Button asChild variant="outline">
            <Link href="/products">购买新服务</Link>
          </Button>
        }
      />

      {services.length === 0 ? (
        <EmptyState
          title="还没有服务"
          description="购买商品后将在这里展示您的服务"
          action={
            <Button asChild>
              <Link href="/products">立即选购</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="rounded-lg border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>服务</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>周期</TableHead>
                  <TableHead>续费金额</TableHead>
                  <TableHead>到期日</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell>
                      <Link
                        href={`/services/${service.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {service.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{service.productName}</div>
                    </TableCell>
                    <TableCell>
                      <ServiceStatusBadge status={service.status} />
                    </TableCell>
                    <TableCell>{cycleLabel(service.cycle)}</TableCell>
                    <TableCell className="tabular-nums">{formatCny(service.renewalAmount)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(service.nextDueDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/services/${service.id}`}
                        className="text-sm text-primary hover:underline"
                      >
                        管理
                      </Link>
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
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
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
