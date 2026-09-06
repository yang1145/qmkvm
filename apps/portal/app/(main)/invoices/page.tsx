"use client";

import * as React from "react";
import Link from "next/link";
import { invoiceDto, paginated } from "@pinhaoji/contracts";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatCny, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { InvoiceStatusBadge, orderTypeLabel } from "@/components/status-badge";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 100;

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "unpaid", label: "待支付" },
  { value: "paid", label: "已支付" },
  { value: "refunded", label: "退款" },
  { value: "void", label: "已作废" },
] as const;

export default function InvoicesPage() {
  const [tab, setTab] = React.useState<string>("all");
  const state = useApiData(
    () =>
      api.get("/invoices", {
        query: { page: 1, pageSize: PAGE_SIZE },
        parse: paginated(invoiceDto),
      }),
    [],
  );

  const invoices = React.useMemo(() => {
    const items = state.data?.items ?? [];
    if (tab === "all") return items;
    if (tab === "refunded") {
      return items.filter((i) => i.status === "refunded" || i.status === "partially_refunded");
    }
    return items.filter((i) => i.status === tab);
  }, [state.data, tab]);

  const unpaidCount = (state.data?.items ?? []).filter((i) => i.status === "unpaid").length;

  if (state.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="我的账单" description="账单查询与在线支付" />
        <Skeleton className="h-16 w-96" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="我的账单" description="账单查询与在线支付" />
        <ErrorState message={state.error} onRetry={state.reload} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="我的账单"
        description="账单查询与在线支付"
        actions={
          <Button asChild variant="outline">
            <Link href="/credits">余额充值</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {t.value === "unpaid" && unpaidCount > 0 ? (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">
                    {unpaidCount}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="暂无相关账单"
          description="账单由订单、续费与充值产生"
          action={
            <Button asChild variant="outline">
              <Link href="/orders">查看订单</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>账单编号</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {invoice.invoiceNo}
                    </Link>
                  </TableCell>
                  <TableCell>{orderTypeLabel(invoice.type)}</TableCell>
                  <TableCell className="font-medium tabular-nums">{formatCny(invoice.total)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(invoice.createdAt)}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {invoice.status === "unpaid" ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/pay/${invoice.id}`}>去支付</Link>
                      </Button>
                    ) : (
                      <Link href={`/invoices/${invoice.id}`} className="text-sm text-primary hover:underline">
                        详情
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
