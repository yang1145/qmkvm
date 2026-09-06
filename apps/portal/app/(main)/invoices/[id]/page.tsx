"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { invoiceDto } from "@pinhaoji/contracts";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatCny, formatDateTime } from "@/lib/format";
import { InvoiceStatusBadge, orderTypeLabel } from "@/components/status-badge";
import { ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";

  const state = useApiData(
    () => api.get(`/invoices/${encodeURIComponent(id)}`, { parse: invoiceDto }),
    [id],
  );
  const invoice = state.data;

  if (state.loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (state.error || !invoice) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <ErrorState message={state.error ?? "账单不存在"} onRetry={state.reload} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">账单详情</h1>
        <InvoiceStatusBadge status={invoice.status} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span>{invoice.invoiceNo}</span>
            <span className="text-lg text-primary tabular-nums">{formatCny(invoice.total)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">类型</span>
            <span>{orderTypeLabel(invoice.type)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">创建时间</span>
            <span>{formatDateTime(invoice.createdAt)}</span>
          </div>
          {invoice.dueAt ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">支付期限</span>
              <span>{formatDateTime(invoice.dueAt)}</span>
            </div>
          ) : null}
          {invoice.paidAt ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">支付时间</span>
              <span>{formatDateTime(invoice.paidAt)}</span>
            </div>
          ) : null}
          {invoice.orderId ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">关联订单</span>
              <Link href={`/orders`} className="text-primary hover:underline">
                订单 #{invoice.orderId}
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">账单明细</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>项目</TableHead>
                <TableHead>数量</TableHead>
                <TableHead>单价</TableHead>
                <TableHead className="text-right">小计</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.qty}</TableCell>
                  <TableCell className="tabular-nums">{formatCny(item.unitPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCny(item.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 space-y-1 border-t pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">小计</span>
              <span className="tabular-nums">{formatCny(invoice.subtotal)}</span>
            </div>
            {invoice.discount > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">优惠</span>
                <span className="tabular-nums">-{formatCny(invoice.discount)}</span>
              </div>
            ) : null}
            {invoice.balanceUsed > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">余额抵扣</span>
                <span className="tabular-nums">-{formatCny(invoice.balanceUsed)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-base font-semibold">
              <span>合计</span>
              <span className="tabular-nums">{formatCny(invoice.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {invoice.status === "unpaid" ? (
        <div className="flex justify-end">
          <Button asChild size="lg">
            <Link href={`/pay/${invoice.id}`}>立即支付 {formatCny(Math.max(0, invoice.total - invoice.balanceUsed))}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
