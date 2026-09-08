"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  cartQuoteSchema,
  updateCartItemSchema,
  type BillingCycle,
} from "@qmkvm/contracts";
import { Minus, Plus, Tag, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatCny, cycleLabel, BILLING_CYCLES } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export default function CartPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [promoInput, setPromoInput] = React.useState("");
  const [promoCode, setPromoCode] = React.useState<string | null>(null);
  const [mutating, setMutating] = React.useState(false);

  // 统一走服务端报价端点：/cart/quote 与 cartQuoteSchema 契约一致，
  // 空购物车、优惠码、余额抵扣建议均在同一响应内返回（/cart 仅返回原始行，不能用于渲染）
  const cartState = useApiData(
    () =>
      api.get("/cart/quote", {
        query: promoCode ? { promoCode } : undefined,
        parse: cartQuoteSchema,
      }),
    [promoCode],
  );

  const reload = () => cartState.reload();

  const patchItem = async (
    itemId: string,
    body: { cycle?: BillingCycle; qty?: number },
  ) => {
    const parsed = updateCartItemSchema.safeParse({ itemId, ...body });
    if (!parsed.success) return;
    setMutating(true);
    try {
      await api.patch(`/cart/items/${encodeURIComponent(itemId)}`, parsed.data);
      reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setMutating(false);
    }
  };

  const removeItem = async (itemId: string) => {
    setMutating(true);
    try {
      await api.del(`/cart/items/${encodeURIComponent(itemId)}`);
      toast({ title: "已移除该商品", variant: "success" });
      reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setMutating(false);
    }
  };

  const applyPromo = () => {
    setPromoCode(promoInput.trim() || null);
  };

  const cart = cartState.data;
  const total = cart?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="购物车"
        description="调整周期与数量，确认后去结算"
      />

      {cartState.loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : cartState.error ? (
        <ErrorState message={cartState.error} onRetry={cartState.reload} />
      ) : !cart || cart.items.length === 0 ? (
        <EmptyState
          title="购物车是空的"
          description="去商品中心挑选适合的云产品吧"
          action={
            <Button asChild>
              <Link href="/products">浏览商品</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
          {/* 商品列表 */}
          <div className="space-y-3">
            {cart.items.map((item) => (
              <Card key={item.itemId}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{item.productName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {item.optionsSummary.length > 0
                          ? item.optionsSummary.join(" · ")
                          : "默认配置"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeItem(item.itemId)}
                      disabled={mutating}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive"
                      aria-label="移除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    {/* 周期 */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {BILLING_CYCLES.filter((c) => c !== "onetime").map((c) => (
                        <button
                          key={c}
                          type="button"
                          disabled={mutating}
                          onClick={() => void patchItem(item.itemId, { cycle: c })}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-xs transition-colors",
                            item.cycle === c
                              ? "border-primary bg-accent font-medium"
                              : "bg-card hover:bg-accent/50",
                          )}
                        >
                          {cycleLabel(c)}
                        </button>
                      ))}
                    </div>

                    {/* 数量 */}
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={mutating || item.qty <= 1}
                        onClick={() => void patchItem(item.itemId, { qty: item.qty - 1 })}
                        aria-label="减少数量"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center text-sm tabular-nums">{item.qty}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={mutating || item.qty >= 10}
                        onClick={() => void patchItem(item.itemId, { qty: item.qty + 1 })}
                        aria-label="增加数量"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="ml-auto text-right">
                      <div className="font-semibold tabular-nums">{formatCny(item.amount)}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        续费 {formatCny(item.unitRenewal)}/{cycleLabel(item.cycle)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 汇总 */}
          <Card className="lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle>订单汇总</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 优惠码 */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Tag className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="优惠码"
                    className="pl-8"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyPromo();
                    }}
                  />
                </div>
                <Button variant="outline" onClick={applyPromo} disabled={mutating}>
                  应用
                </Button>
              </div>
              {cart.promoError ? (
                <p className="text-xs text-destructive">{cart.promoError}</p>
              ) : cart.promoCode ? (
                <p className="text-xs text-emerald-700">已应用优惠码 {cart.promoCode}</p>
              ) : null}

              <div className="space-y-1.5 border-t pt-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">小计</span>
                  <span className="tabular-nums">{formatCny(cart.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">优惠</span>
                  <span className="tabular-nums">-{formatCny(cart.discount)}</span>
                </div>
                <div className="flex justify-between text-base font-semibold">
                  <span>合计</span>
                  <span className="tabular-nums">{formatCny(total)}</span>
                </div>
              </div>

              {cart.balanceAvailable > 0 ? (
                <p className="text-xs text-muted-foreground">
                  可用余额 {formatCny(cart.balanceAvailable)}，结算时可勾选抵扣。
                </p>
              ) : null}

              <Button className="w-full" size="lg" onClick={() => router.push("/checkout")}>
                去结算
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
