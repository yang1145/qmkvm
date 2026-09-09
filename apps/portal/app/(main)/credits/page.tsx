"use client";

import * as React from "react";
import { Plus, Wallet } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApiData } from "@/hooks/use-api";
import { formatCny, formatDateTime } from "@/lib/format";
import { creditOverviewSchema, rechargeResultSchema } from "@/lib/schemas";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/empty-state";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const LEDGER_PAGE_SIZE = 10;
const PRESETS = [10, 50, 100, 500];

const TYPE_LABELS: Record<string, string> = {
  recharge: "充值",
  payment: "支付",
  refund: "退款",
  adjustment: "调整",
  upgrade_refund: "升级退款",
  promo_bonus: "优惠赠送",
};

export default function CreditsPage() {
  const { refresh } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = React.useState(1);

  const state = useApiData(
    () =>
      api.get("/credits", {
        query: { page, pageSize: LEDGER_PAGE_SIZE },
        parse: creditOverviewSchema,
      }),
    [page],
  );

  // 充值对话框
  const [open, setOpen] = React.useState(false);
  const [preset, setPreset] = React.useState<number | null>(100);
  const [custom, setCustom] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const effectiveYuan = custom.trim() !== "" ? Number(custom) : preset;
  const amountFen =
    effectiveYuan !== null && Number.isFinite(effectiveYuan) && effectiveYuan > 0
      ? Math.round(effectiveYuan * 100)
      : null;

  const handleRecharge = async () => {
    if (amountFen === null || amountFen < 100) {
      toast({ title: "请输入有效金额", description: "单笔充值最低 ¥1", variant: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post("/credits/recharge", { amount: amountFen }, { parse: rechargeResultSchema });
      setOpen(false);
      setCustom("");
      if (typeof result.invoiceId === "number") {
        window.location.href = `/pay?id=${result.invoiceId}`;
        return;
      }
      if (result.payUrl) {
        window.location.href = result.payUrl;
        return;
      }
      toast({
        title: "充值订单已创建",
        description: "暂无可用支付方式，请稍后在账单中支付",
      });
      state.reload();
      void refresh();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSubmitting(false);
    }
  };

  const balance = state.data?.balance ?? null;
  // creditOverviewSchema 已平铺合并分页结构：{ balance, items, total, page, pageSize }
  const ledger = state.data;
  const totalPages = ledger ? Math.max(1, Math.ceil(ledger.total / LEDGER_PAGE_SIZE)) : 1;

  if (state.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="余额中心" description="账户余额、充值与流水" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="余额中心" description="账户余额、充值与流水" />
        <ErrorState message={state.error} onRetry={state.reload} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="余额中心" description="账户余额、充值与流水" />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Wallet className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">账户余额</div>
              <div className="text-3xl font-semibold tabular-nums">
                {balance === null ? "-" : formatCny(balance)}
              </div>
            </div>
          </div>
          <Button size="lg" onClick={() => setOpen(true)}>
            <Plus />
            充值
          </Button>
        </CardContent>
      </Card>

      {/* 流水 */}
      {!ledger || ledger.items.length === 0 ? (
        <EmptyState title="暂无流水记录" description="充值与消费将在这里记录" />
      ) : (
        <>
          <div className="rounded-lg border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead>变动</TableHead>
                  <TableHead>变动后余额</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{TYPE_LABELS[item.type] ?? item.type}</TableCell>
                    <TableCell
                      className={cn(
                        "font-medium tabular-nums",
                        item.amount > 0 ? "text-emerald-600" : item.amount < 0 ? "text-red-600" : "",
                      )}
                    >
                      {item.amount > 0 ? "+" : ""}
                      {formatCny(item.amount)}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatCny(item.balanceAfter)}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground" title={item.remark ?? undefined}>
                      {item.remark ?? "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(item.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
              <span>
                第 {page} / {totalPages} 页 · 共 {ledger.total} 条
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

      {/* 充值对话框 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>余额充值</DialogTitle>
            <DialogDescription>创建充值订单并前往收银台支付</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setPreset(amount);
                    setCustom("");
                  }}
                  className={cn(
                    "rounded-lg border py-2.5 text-center text-sm transition-colors",
                    custom.trim() === "" && preset === amount
                      ? "border-primary bg-accent font-medium ring-1 ring-primary"
                      : "bg-card hover:bg-accent/50",
                  )}
                >
                  ¥{amount}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">自定义金额（元）</span>
              <Input
                type="number"
                min={1}
                step="1"
                placeholder="例如 200"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                单笔最低 ¥1、最高 ¥100,000。{amountFen !== null ? `本次充值 ${formatCny(amountFen)}` : ""}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={amountFen === null || submitting} onClick={() => void handleRecharge()}>
              {submitting ? "创建中…" : "去支付"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
