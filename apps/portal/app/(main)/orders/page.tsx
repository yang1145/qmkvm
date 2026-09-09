"use client";

import * as React from "react";
import Link from "next/link";
import { orderDto, paginated } from "@qmkvm/contracts";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatCny, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { OrderStatusBadge, orderTypeLabel } from "@/components/status-badge";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 10;

export default function OrdersPage() {
  const [page, setPage] = React.useState(1);
  const state = useApiData(
    () =>
      api.get("/orders", {
        query: { page, pageSize: PAGE_SIZE },
        parse: paginated(orderDto),
      }),
    [page],
  );

  const total = state.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (state.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="我的订单" description="新购、续费与升级订单记录" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="我的订单" description="新购、续费与升级订单记录" />
        <ErrorState message={state.error} onRetry={state.reload} />
      </div>
    );
  }

  const orders = state.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="我的订单"
        description="新购、续费与升级订单记录"
        actions={
          <Button asChild variant="outline">
            <Link href="/invoices">我的账单</Link>
          </Button>
        }
      />

      {orders.length === 0 ? (
        <EmptyState
          title="暂无订单"
          description="下单后可在这里跟踪订单状态"
          action={
            <Button asChild>
              <Link href="/products">去选购</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {orders.map((order) => (
              <Card key={order.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">订单 #{order.id}</span>
                    <OrderStatusBadge status={order.status} />
                    <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                      {orderTypeLabel(order.type)}
                    </span>
                    {order.promoCode ? (
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                        优惠码 {order.promoCode}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground">
                      下单 {formatDateTime(order.createdAt)}
                      {order.paidAt ? ` · 支付 ${formatDateTime(order.paidAt)}` : ""}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {order.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-4 text-sm">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {item.description} × {item.qty}
                          {item.serviceId ? (
                            <Link
                              href={`/services/detail?id=${item.serviceId}`}
                              className="ml-2 text-xs text-primary hover:underline"
                            >
                              查看服务
                            </Link>
                          ) : null}
                        </span>
                        <span className="shrink-0 tabular-nums">{formatCny(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 border-t pt-3 text-sm">
                    <span className="text-muted-foreground">
                      小计 <span className="tabular-nums">{formatCny(order.subtotal)}</span>
                    </span>
                    {order.discount > 0 ? (
                      <span className="text-muted-foreground">
                        优惠 <span className="tabular-nums">-{formatCny(order.discount)}</span>
                      </span>
                    ) : null}
                    {order.balanceUsed > 0 ? (
                      <span className="text-muted-foreground">
                        余额抵扣 <span className="tabular-nums">{formatCny(order.balanceUsed)}</span>
                      </span>
                    ) : null}
                    <span className="font-semibold">
                      合计 <span className="tabular-nums">{formatCny(order.total)}</span>
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
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
