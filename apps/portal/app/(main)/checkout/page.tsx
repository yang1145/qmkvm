"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cartQuoteSchema, checkoutResultSchema } from "@qmkvm/contracts";
import { Wallet } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApiData } from "@/hooks/use-api";
import { formatCny, cycleLabel } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export default function CheckoutPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, refresh } = useAuth();

  // 与购物车页一致：统一走 /cart/quote（与 cartQuoteSchema 契约匹配），
  // /cart 仅返回原始购物行，缺少金额与商品名等渲染所需字段
  const cartState = useApiData(() => api.get("/cart/quote", { parse: cartQuoteSchema }), []);
  const [useBalance, setUseBalance] = React.useState(true);
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const cart = cartState.data;
  const total = cart?.total ?? 0;
  const balance = cart?.balanceAvailable ?? 0;
  const balanceUsable = useBalance && balance > 0;

  const handleSubmit = async () => {
    if (!cart || cart.items.length === 0) return;
    setSubmitting(true);
    try {
      const result = await api.post(
        "/checkout",
        {
          useBalance,
          note: note.trim() ? note.trim() : undefined,
        },
        { parse: checkoutResultSchema },
      );
      void refresh(); // 余额可能已变动
      if (result.paid || result.payable === 0) {
        toast({ title: "订单已支付", description: "服务开通处理中", variant: "success" });
        router.replace(`/pay/${result.invoiceId}?paid=1`);
      } else {
        router.replace(`/pay/${result.invoiceId}`);
      }
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSubmitting(false);
    }
  };

  if (cartState.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="确认订单" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (cartState.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="确认订单" />
        <ErrorState message={cartState.error} onRetry={cartState.reload} />
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="确认订单" />
        <EmptyState
          title="没有待结算的商品"
          action={
            <Button asChild>
              <Link href="/products">去选购</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="确认订单" description="核对商品明细后提交订单" />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {cart.items.map((item) => (
            <Card key={item.itemId}>
              <CardContent className="space-y-1.5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {item.productName} × {item.qty}
                  </div>
                  <div className="font-semibold tabular-nums">{formatCny(item.amount)}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  周期：{cycleLabel(item.cycle)} · 首期单价 {formatCny(item.unitFirst)}
                  {item.setupFee > 0 ? ` · 初装费 ${formatCny(item.setupFee)}` : ""}
                </div>
                {item.optionsSummary.length > 0 ? (
                  <div className="text-xs text-muted-foreground">
                    配置：{item.optionsSummary.join(" · ")}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>订单备注（可选）</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="如有特殊要求请填写，500 字以内"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </CardContent>
          </Card>
        </div>

        {/* 汇总 */}
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>支付信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">商品小计</span>
                <span className="tabular-nums">{formatCny(cart.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">优惠{cart.promoCode ? `（${cart.promoCode}）` : ""}</span>
                <span className="tabular-nums">-{formatCny(cart.discount)}</span>
              </div>
            </div>

            {/* 余额抵扣 */}
            <button
              type="button"
              disabled={balance <= 0}
              onClick={() => setUseBalance((v) => !v)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                balance <= 0
                  ? "cursor-not-allowed opacity-60"
                  : useBalance
                    ? "border-primary bg-accent"
                    : "bg-card hover:bg-accent/40",
              )}
            >
              <Wallet className="h-4 w-4 shrink-0 text-primary" />
              <span className="flex-1 text-sm">
                余额抵扣
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                  可用 {formatCny(balance)}
                </span>
              </span>
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
                  balanceUsable ? "border-primary bg-primary" : "border-input",
                )}
              >
                {balanceUsable ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
              </span>
            </button>

            <div className="space-y-1 border-t pt-4 text-sm">
              <div className="flex justify-between text-base font-semibold">
                <span>应付合计</span>
                <span className="tabular-nums">{formatCny(total)}</span>
              </div>
              {balanceUsable ? (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>余额抵扣后需在线支付</span>
                  <span className="tabular-nums">
                    {formatCny(Math.max(0, total - balance))}
                  </span>
                </div>
              ) : null}
              <p className="pt-1 text-xs text-muted-foreground">
                P0 版本余额为全额抵扣或全额在线支付；余额不足时请在收银台在线支付。
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "提交中…" : "提交订单"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              登录账号：{user?.email || user?.phone || user?.name || "-"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
