"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  addToCartSchema,
  productGroupDto,
} from "@pinhaoji/contracts";
import { z } from "zod";
import { Minus, Plus, ShoppingCart } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApiData } from "@/hooks/use-api";
import { formatCny, cycleLabel } from "@/lib/format";
import type { ConfigGroup, Product } from "@/lib/schemas";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

interface OptionSelection {
  groupId: number;
  optionIds: number[];
  quantity?: number;
}

export default function ProductConfiguratorPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const catalogState = useApiData(
    () => api.get("/catalog", { parse: z.array(productGroupDto), silent: true }),
    [],
  );

  const product = React.useMemo<Product | null>(() => {
    for (const group of catalogState.data ?? []) {
      const found = group.products.find((p) => p.slug === slug);
      if (found) return found;
    }
    return null;
  }, [catalogState.data, slug]);

  const [cycle, setCycle] = React.useState<string>("");
  const /** groupId → 选中 optionId（select/radio/quantity 基准选项） */ singleSelections = React.useRef<
    Map<number, number>
  >(new Map());
  const /** groupId → 选中 optionId 集合（checkbox） */ multiSelections = React.useRef<
    Map<number, Set<number>>
  >(new Map());
  const /** groupId → quantity（quantity 型） */ quantities = React.useRef<Map<number, number>>(
      new Map(),
    );
  const [qty, setQty] = React.useState(1);
  const [buying, setBuying] = React.useState(false);
  const [renderTick, forceRender] = React.useReducer((n: number) => n + 1, 0);

  // 数据就绪后初始化默认选项
  React.useEffect(() => {
    if (!product) return;
    setCycle((prev) => {
      if (prev && product.pricing.some((p) => p.cycle === prev)) return prev;
      const monthly = product.pricing.find((p) => p.cycle === "monthly");
      return (monthly ?? product.pricing[0])?.cycle ?? "";
    });
    for (const group of product.configGroups) {
      const defaults = group.options.filter((o) => o.isDefault);
      if (group.type === "checkbox") {
        if (!multiSelections.current.has(group.id)) {
          multiSelections.current.set(group.id, new Set(defaults.map((o) => o.id)));
        }
      } else {
        if (!singleSelections.current.has(group.id)) {
          const first = defaults[0] ?? group.options[0];
          if (first) singleSelections.current.set(group.id, first.id);
        }
        if (group.type === "quantity" && !quantities.current.has(group.id)) {
          quantities.current.set(group.id, 1);
        }
      }
    }
  }, [product]);

  const pricing = product?.pricing.find((p) => p.cycle === cycle) ?? null;

  const optionLines = React.useMemo<string[]>(() => {
    if (!product) return [];
    const lines: string[] = [];
    for (const group of product.configGroups) {
      if (group.type === "checkbox") {
        const set = multiSelections.current.get(group.id);
        const chosen = group.options.filter((o) => set?.has(o.id));
        if (chosen.length > 0) lines.push(`${group.name}：${chosen.map((o) => o.label).join("、")}`);
      } else if (group.type === "quantity") {
        const optionId = singleSelections.current.get(group.id);
        const option = group.options.find((o) => o.id === optionId);
        if (option) {
          lines.push(`${group.name}：${option.label} × ${quantities.current.get(group.id) ?? 1}`);
        }
      } else {
        const optionId = singleSelections.current.get(group.id);
        const option = group.options.find((o) => o.id === optionId);
        if (option) lines.push(`${group.name}：${option.label}`);
      }
    }
    return lines;
    // refs 为稳定引用；selections 变化时通过 forceRender 触发重渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, renderTick]);

  const estimate = React.useMemo(() => {
    if (!pricing) return null;
    let first = pricing.firstPrice;
    let setup = pricing.setupFee;
    if (product) {
      for (const group of product.configGroups) {
        if (group.type === "checkbox") {
          const set = multiSelections.current.get(group.id);
          for (const option of group.options) {
            if (set?.has(option.id)) {
              first += option.priceDelta;
              setup += option.setupDelta;
            }
          }
        } else if (group.type === "quantity") {
          const optionId = singleSelections.current.get(group.id);
          const option = group.options.find((o) => o.id === optionId);
          if (option) {
            const n = quantities.current.get(group.id) ?? 1;
            first += option.priceDelta * n;
            setup += option.setupDelta * n;
          }
        } else {
          const optionId = singleSelections.current.get(group.id);
          const option = group.options.find((o) => o.id === optionId);
          if (option) {
            first += option.priceDelta;
            setup += option.setupDelta;
          }
        }
      }
    }
    return { first, setup, total: (first + setup) * qty };
    // refs 为稳定引用；selections 变化时通过 forceRender 触发重渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing, product, qty, renderTick]);

  const buildSelections = (): OptionSelection[] => {
    if (!product) return [];
    const selections: OptionSelection[] = [];
    for (const group of product.configGroups) {
      if (group.type === "checkbox") {
        const set = multiSelections.current.get(group.id);
        const ids = [...(set ?? [])];
        if (ids.length > 0) selections.push({ groupId: group.id, optionIds: ids });
      } else if (group.type === "quantity") {
        const optionId = singleSelections.current.get(group.id);
        if (optionId !== undefined) {
          selections.push({
            groupId: group.id,
            optionIds: [optionId],
            quantity: quantities.current.get(group.id) ?? 1,
          });
        }
      } else {
        const optionId = singleSelections.current.get(group.id);
        if (optionId !== undefined) selections.push({ groupId: group.id, optionIds: [optionId] });
      }
    }
    return selections;
  };

  const validateRequired = (): string | null => {
    if (!product) return "商品不存在";
    if (!cycle) return "请选择计费周期";
    for (const group of product.configGroups) {
      if (!group.required) continue;
      if (group.type === "checkbox") {
        const set = multiSelections.current.get(group.id);
        if (!set || set.size === 0) return `请选择「${group.name}」`;
      } else if (!singleSelections.current.has(group.id)) {
        return `请选择「${group.name}」`;
      }
    }
    return null;
  };

  const handleBuy = async () => {
    const problem = validateRequired();
    if (problem || !product) {
      toast({ title: problem ?? "商品不存在", variant: "error" });
      return;
    }
    // 登录守卫
    if (!user) {
      const next = encodeURIComponent(`/products/${slug}`);
      router.push(`/login?next=${next}`);
      return;
    }
    const payload = addToCartSchema.safeParse({
      productId: product.id,
      cycle,
      options: buildSelections(),
      qty,
    });
    if (!payload.success) {
      toast({ title: payload.error.issues[0]?.message ?? "参数错误", variant: "error" });
      return;
    }
    setBuying(true);
    try {
      await api.post("/cart/items", payload.data);
      toast({ title: "已加入购物车", variant: "success" });
      router.push("/cart");
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setBuying(false);
    }
  };

  if (catalogState.loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (catalogState.error) {
    return <ErrorState message={catalogState.error} onRetry={catalogState.reload} />;
  }

  if (!product) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">商品不存在或已下架</p>
        <Link href="/products" className="mt-2 inline-block text-sm text-primary hover:underline">
          返回商品中心
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        <Link href="/products" className="hover:text-foreground">
          商品中心
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{product.name}</span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        {/* 左侧：配置区 */}
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{product.name}</h1>
              {!product.inStock ? (
                <Badge variant="muted">暂时缺货</Badge>
              ) : product.stockTotal !== null && product.stockTotal - product.stockUsed <= 5 ? (
                <Badge variant="warning">仅剩 {product.stockTotal - product.stockUsed} 件</Badge>
              ) : null}
            </div>
            {product.tagline ? (
              <p className="mt-1.5 text-sm text-muted-foreground">{product.tagline}</p>
            ) : null}
          </div>

          {/* 计费周期 */}
          <section>
            <h2 className="mb-2.5 text-sm font-semibold">计费周期</h2>
            <div className="flex flex-wrap gap-2">
              {product.pricing.map((p) => (
                <button
                  key={p.cycle}
                  type="button"
                  onClick={() => {
                    setCycle(p.cycle);
                    forceRender();
                  }}
                  className={cn(
                    "rounded-lg border px-4 py-2.5 text-left transition-colors",
                    cycle === p.cycle
                      ? "border-primary bg-accent ring-1 ring-primary"
                      : "bg-card hover:bg-accent/50",
                  )}
                >
                  <div className="text-sm font-medium">{cycleLabel(p.cycle)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {formatCny(p.firstPrice)}
                    {p.cycle !== "onetime" ? ` / 续费 ${formatCny(p.renewalPrice)}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* 选项组 */}
          {product.configGroups.map((group) => (
            <ConfigGroupSection
              key={group.id}
              group={group}
              singleSelections={singleSelections}
              multiSelections={multiSelections}
              quantities={quantities}
              onChange={forceRender}
            />
          ))}
        </div>

        {/* 右侧：价格摘要 */}
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>购买信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">商品</span>
                <span>{product.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">周期</span>
                <span>{pricing ? cycleLabel(pricing.cycle) : "-"}</span>
              </div>
              {optionLines.map((line) => (
                <div key={line} className="flex justify-between gap-4 text-xs">
                  <span className="shrink-0 text-muted-foreground">配置</span>
                  <span className="text-right">{line}</span>
                </div>
              ))}
              {pricing ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      单价（{pricing ? cycleLabel(pricing.cycle) : ""}）
                    </span>
                    <span className="tabular-nums">{formatCny(estimate?.first ?? 0)}</span>
                  </div>
                  {estimate && estimate.setup > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">初装费</span>
                      <span className="tabular-nums">{formatCny(estimate.setup)}</span>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            {/* 购买数量 */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">数量</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={qty <= 1}
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="减少数量"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={qty}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setQty(Number.isNaN(n) ? 1 : Math.min(10, Math.max(1, n)));
                  }}
                  className="h-8 w-14 text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={qty >= 10}
                  onClick={() => setQty((q) => Math.min(10, q + 1))}
                  aria-label="增加数量"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex items-baseline justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">合计（约）</span>
              <span className="text-xl font-semibold text-primary tabular-nums">
                {formatCny(estimate?.total ?? 0)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              实际金额以购物车服务端报价为准；未登录将先跳转登录。
            </p>

            <Button
              className="w-full"
              size="lg"
              disabled={!product.inStock || buying || !pricing}
              onClick={() => void handleBuy()}
            >
              <ShoppingCart />
              {buying ? "加入中…" : "立即购买"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ConfigGroupSection({
  group,
  singleSelections,
  multiSelections,
  quantities,
  onChange,
}: {
  group: ConfigGroup;
  singleSelections: React.RefObject<Map<number, number>>;
  multiSelections: React.RefObject<Map<number, Set<number>>>;
  quantities: React.RefObject<Map<number, number>>;
  onChange: () => void;
}) {
  return (
    <section>
      <h2 className="mb-2.5 text-sm font-semibold">
        {group.name}
        {group.required ? <span className="ml-1 text-destructive">*</span> : null}
      </h2>
      <GroupControl
        group={group}
        singleSelections={singleSelections}
        multiSelections={multiSelections}
        quantities={quantities}
        onChange={onChange}
      />
    </section>
  );
}

function GroupControl({
  group,
  singleSelections,
  multiSelections,
  quantities,
  onChange,
}: {
  group: ConfigGroup;
  singleSelections: React.RefObject<Map<number, number>>;
  multiSelections: React.RefObject<Map<number, Set<number>>>;
  quantities: React.RefObject<Map<number, number>>;
  onChange: () => void;
}) {
  // select 型：下拉框
  if (group.type === "select") {
    const selected = singleSelections.current.get(group.id);
    return (
      <Select
        value={selected !== undefined ? String(selected) : undefined}
        onValueChange={(v) => {
          singleSelections.current.set(group.id, Number(v));
          onChange();
        }}
      >
        <SelectTrigger className="max-w-xs">
          <SelectValue placeholder={`请选择${group.name}`} />
        </SelectTrigger>
        <SelectContent>
          {group.options.map((option) => (
            <SelectItem key={option.id} value={String(option.id)}>
              {option.label}
              {option.priceDelta > 0 ? `（+${formatCny(option.priceDelta)}）` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // radio 型：药丸按钮
  if (group.type === "radio") {
    const selected = singleSelections.current.get(group.id);
    return (
      <div className="flex flex-wrap gap-2">
        {group.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              singleSelections.current.set(group.id, option.id);
              onChange();
            }}
            className={cn(
              "rounded-lg border px-3.5 py-2 text-sm transition-colors",
              selected === option.id
                ? "border-primary bg-accent font-medium ring-1 ring-primary"
                : "bg-card hover:bg-accent/50",
            )}
          >
            {option.label}
            {option.priceDelta > 0 ? (
              <span className="ml-1 text-xs text-muted-foreground">+{formatCny(option.priceDelta)}</span>
            ) : null}
          </button>
        ))}
      </div>
    );
  }

  // checkbox 型：可多选药丸
  if (group.type === "checkbox") {
    const set = multiSelections.current.get(group.id) ?? new Set<number>();
    return (
      <div className="flex flex-wrap gap-2">
        {group.options.map((option) => {
          const checked = set.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                const next = new Set(set);
                if (checked) next.delete(option.id);
                else next.add(option.id);
                multiSelections.current.set(group.id, next);
                onChange();
              }}
              className={cn(
                "rounded-lg border px-3.5 py-2 text-sm transition-colors",
                checked
                  ? "border-primary bg-accent font-medium ring-1 ring-primary"
                  : "bg-card hover:bg-accent/50",
              )}
            >
              {option.label}
              {option.priceDelta > 0 ? (
                <span className="ml-1 text-xs text-muted-foreground">+{formatCny(option.priceDelta)}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  // quantity 型：选项 + 数量
  const selected = singleSelections.current.get(group.id);
  const quantity = quantities.current.get(group.id) ?? 1;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap gap-2">
        {group.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              singleSelections.current.set(group.id, option.id);
              onChange();
            }}
            className={cn(
              "rounded-lg border px-3.5 py-2 text-sm transition-colors",
              selected === option.id
                ? "border-primary bg-accent font-medium ring-1 ring-primary"
                : "bg-card hover:bg-accent/50",
            )}
          >
            {option.label}
            {option.priceDelta > 0 ? (
              <span className="ml-1 text-xs text-muted-foreground">+{formatCny(option.priceDelta)}/个</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={quantity <= 1}
          onClick={() => {
            quantities.current.set(group.id, Math.max(1, quantity - 1));
            onChange();
          }}
          aria-label="减少数量"
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Input
          type="number"
          min={1}
          max={999}
          value={quantity}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            quantities.current.set(group.id, Number.isNaN(n) ? 1 : Math.min(999, Math.max(1, n)));
            onChange();
          }}
          className="h-8 w-16 text-center"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={quantity >= 999}
          onClick={() => {
            quantities.current.set(group.id, Math.min(999, quantity + 1));
            onChange();
          }}
          aria-label="增加数量"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
