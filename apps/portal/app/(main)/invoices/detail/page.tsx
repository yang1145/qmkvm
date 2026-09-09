"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { fapiaoRequestDto, fapiaoTitleDto, invoiceDto, paginated } from "@qmkvm/contracts";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatCny, formatDateTime } from "@/lib/format";
import { InvoiceStatusBadge, orderTypeLabel } from "@/components/status-badge";
import { ErrorState } from "@/components/empty-state";
import { Field } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

/** 静态导出：账单 id 走查询参数（/invoices/detail?id=），useSearchParams 需 Suspense 边界 */
export default function InvoiceDetailPage() {
  return (
    <React.Suspense
      fallback={
        <div className="mx-auto max-w-2xl space-y-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-72" />
        </div>
      }
    >
      <InvoiceDetailContent />
    </React.Suspense>
  );
}

function InvoiceDetailContent() {
  const id = useSearchParams().get("id") ?? "";
  const { toast } = useToast();

  const state = useApiData(
    () => api.get(`/invoices/${encodeURIComponent(id)}`, { parse: invoiceDto }),
    [id],
  );
  const invoice = state.data;

  // —— 开票：该账单的开票申请（用于入口展示与防重复） ——
  const fapiaoState = useApiData(
    () =>
      api.get("/fapiao/requests", {
        query: { invoiceId: id, page: 1, pageSize: 1 },
        parse: paginated(fapiaoRequestDto),
      }),
    [id],
  );
  const activeFapiao = (fapiaoState.data?.items ?? []).find(
    (r) => r.status === "pending" || r.status === "issued",
  );

  // —— 申请开票对话框 ——
  const [applyOpen, setApplyOpen] = React.useState(false);
  const [titles, setTitles] = React.useState<z.infer<typeof fapiaoTitleDto>[]>([]);
  const [titleId, setTitleId] = React.useState<number | null>(null);
  const [fapiaoType, setFapiaoType] = React.useState<"electronic" | "special">("electronic");
  const [remark, setRemark] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const openApply = async () => {
    setApplyOpen(true);
    try {
      const res = await api.get("/fapiao/titles", {
        parse: z.object({ items: z.array(fapiaoTitleDto) }),
      });
      setTitles(res.items);
      const def = res.items.find((t) => t.isDefault) ?? res.items[0];
      setTitleId(def?.id ?? null);
    } catch {
      // Toast 已由 api 层弹出
    }
  };

  const submitApply = async () => {
    if (!titleId) {
      toast({ title: "请先在发票中心添加抬头", variant: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/fapiao/requests", {
        invoiceId: invoice?.id,
        titleId,
        type: fapiaoType,
        remark: remark.trim() || undefined,
      });
      toast({ title: "开票申请已提交", description: "审核通过并开出后将通知您" });
      setApplyOpen(false);
      setRemark("");
      fapiaoState.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSubmitting(false);
    }
  };

  const canApply = invoice?.status === "paid" && !activeFapiao;

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

      {invoice.status === "paid" ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              {activeFapiao ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">开票申请：</span>
                  <Badge variant={activeFapiao.status === "issued" ? "success" : "info"}>
                    {activeFapiao.status === "issued" ? "已开票" : "审核中"}
                  </Badge>
                  {activeFapiao.fapiaoNo ? (
                    <span className="text-muted-foreground">发票号 {activeFapiao.fapiaoNo}</span>
                  ) : null}
                </div>
              ) : (
                <span className="text-muted-foreground">该账单已支付，可申请开具发票</span>
              )}
            </div>
            {canApply ? (
              <Button onClick={openApply}>申请开票</Button>
            ) : (
              <Button asChild variant="outline">
                <Link href="/fapiao">查看开票记录</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      {invoice.status === "unpaid" ? (
        <div className="flex justify-end">
          <Button asChild size="lg">
            <Link href={`/pay?id=${invoice.id}`}>立即支付 {formatCny(Math.max(0, invoice.total - invoice.balanceUsed))}</Link>
          </Button>
        </div>
      ) : null}

      {/* 申请开票对话框 */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>申请开票</DialogTitle>
            <DialogDescription>
              账单 {invoice.invoiceNo} · 金额 {formatCny(invoice.total)}，发票将在审核通过后开具并通知您。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {titles.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                暂无发票抬头，
                <Link href="/fapiao" className="text-primary hover:underline">
                  去发票中心添加
                </Link>
              </div>
            ) : (
              <>
                <Field label="发票抬头">
                  <Select
                    value={titleId != null ? String(titleId) : undefined}
                    onValueChange={(v) => setTitleId(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择抬头" />
                    </SelectTrigger>
                    <SelectContent>
                      {titles.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}（{t.type === "enterprise" ? "企业" : "个人"}
                          {t.taxNo ? ` · ${t.taxNo}` : ""}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="发票类型">
                  <Select
                    value={fapiaoType}
                    onValueChange={(v) => setFapiaoType(v as "electronic" | "special")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="electronic">增值税电子普票</SelectItem>
                      <SelectItem value="special">增值税专用发票（需企业抬头）</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="备注（选填）">
                  <Textarea
                    rows={2}
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    maxLength={255}
                  />
                </Field>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)}>
              取消
            </Button>
            <Button onClick={submitApply} disabled={submitting || titles.length === 0}>
              提交申请
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
