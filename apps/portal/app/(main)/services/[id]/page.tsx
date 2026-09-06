"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  serviceDto,
  productGroupDto,
  upgradeQuoteSchema,
  type BillingCycle,
} from "@pinhaoji/contracts";
import { z } from "zod";
import { ArrowLeftRight, RefreshCw, XCircle } from "lucide-react";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatCny, cycleLabel, formatDate, formatDateTime, BILLING_CYCLES } from "@/lib/format";
import { renewResultSchema } from "@/lib/schemas";
import { DeliverInfo } from "@/components/deliver-info";
import { PageHeader } from "@/components/page-header";
import { ServiceStatusBadge } from "@/components/status-badge";
import { ErrorState } from "@/components/empty-state";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type UpgradeQuote = z.infer<typeof upgradeQuoteSchema>;

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export default function ServiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { toast, success } = useToast();

  const state = useApiData(
    () => api.get(`/services/${encodeURIComponent(id)}`, { parse: serviceDto }),
    [id],
  );
  const service = state.data;

  // 升级用商品目录
  const catalogState = useApiData(
    () => api.get("/catalog", { parse: z.array(productGroupDto), silent: true }),
    [],
  );

  // —— 续费对话框 ——
  const [renewOpen, setRenewOpen] = React.useState(false);
  const [renewCycle, setRenewCycle] = React.useState<BillingCycle | "">("");
  const [renewSubmitting, setRenewSubmitting] = React.useState(false);

  // —— 升级对话框 ——
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);
  const [targetProduct, setTargetProduct] = React.useState<string>("");
  const [quote, setQuote] = React.useState<UpgradeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = React.useState(false);

  // —— 取消对话框 ——
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelWhen, setCancelWhen] = React.useState<"now" | "period_end">("period_end");
  const [cancelSubmitting, setCancelSubmitting] = React.useState(false);

  const handleRenew = async () => {
    if (!service || !renewCycle) return;
    setRenewSubmitting(true);
    try {
      const result = await api.post(
        `/services/${service.id}/renew`,
        { cycle: renewCycle },
        { parse: renewResultSchema },
      );
      setRenewOpen(false);
      router.push(`/pay/${result.invoiceId}`);
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setRenewSubmitting(false);
    }
  };

  const fetchQuote = async () => {
    if (!service || !targetProduct) return;
    setQuoteLoading(true);
    setQuote(null);
    try {
      const q = await api.post<UpgradeQuote>(
        `/services/${service.id}/upgrade`,
        { targetProductId: Number(targetProduct), confirm: false },
        { parse: upgradeQuoteSchema },
      );
      setQuote(q);
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setQuoteLoading(false);
    }
  };

  const confirmUpgrade = async () => {
    if (!service || !targetProduct) return;
    setQuoteLoading(true);
    try {
      // confirm=true 建单；响应为 checkoutResult 兼容结构，宽松解析
      const raw = await api.post<{ invoiceId?: number; paid?: boolean }>(
        `/services/${service.id}/upgrade`,
        { targetProductId: Number(targetProduct), confirm: true },
      );
      if (typeof raw?.invoiceId === "number") {
        if (raw.paid) {
          success("升级完成", "服务配置变更已提交");
          state.reload();
          setUpgradeOpen(false);
        } else {
          router.push(`/pay/${raw.invoiceId}`);
        }
        return;
      }
      toast({ title: "升级请求已提交", description: "请稍后刷新查看服务状态" });
      setUpgradeOpen(false);
      state.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!service) return;
    setCancelSubmitting(true);
    try {
      await api.post(`/services/${service.id}/cancel`, { when: cancelWhen });
      success("取消申请已提交", cancelWhen === "now" ? "等待管理员复核终止" : "到期后不再续费");
      setCancelOpen(false);
      state.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setCancelSubmitting(false);
    }
  };

  if (state.loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (state.error || !service) {
    return (
      <div className="space-y-6">
        <PageHeader title="服务详情" />
        <ErrorState message={state.error ?? "服务不存在"} onRetry={state.reload} />
      </div>
    );
  }

  const isActive = service.status === "active";
  const productOptions = (catalogState.data ?? []).flatMap((g) =>
    g.products
      .filter((p) => p.id !== service.productId)
      .map((p) => ({ id: p.id, label: `${g.name} / ${p.name}` })),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={service.name}
        description={service.productName}
        actions={
          <>
            <Button
              disabled={!isActive}
              onClick={() => {
                setRenewCycle(service.cycle);
                setRenewOpen(true);
              }}
              title={isActive ? undefined : "服务非运行中状态"}
            >
              <RefreshCw />
              续费
            </Button>
            <Button
              variant="outline"
              disabled={!isActive}
              onClick={() => {
                setQuote(null);
                setTargetProduct("");
                setUpgradeOpen(true);
              }}
              title={isActive ? undefined : "服务非运行中状态"}
            >
              <ArrowLeftRight />
              升级
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:bg-red-50"
              disabled={!isActive}
              onClick={() => setCancelOpen(true)}
              title={isActive ? undefined : "服务非运行中状态"}
            >
              <XCircle />
              取消
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <InfoRow label="状态">
              <ServiceStatusBadge status={service.status} />
            </InfoRow>
            <InfoRow label="商品">
              {service.productName}
              <span className="ml-2 text-xs text-muted-foreground">ID {service.productId}</span>
            </InfoRow>
            <InfoRow label="计费周期">{cycleLabel(service.cycle)}</InfoRow>
            <InfoRow label="续费金额">
              <span className="font-medium tabular-nums">{formatCny(service.renewalAmount)}</span>
            </InfoRow>
            <InfoRow label="到期日">
              {service.nextDueDate ? (
                <span className="tabular-nums">{formatDate(service.nextDueDate)}</span>
              ) : (
                "-"
              )}
            </InfoRow>
            <InfoRow label="创建时间">{formatDateTime(service.createdAt)}</InfoRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>交付信息</CardTitle>
          </CardHeader>
          <CardContent>
            {service.deliverInfo ? (
              <DeliverInfo data={service.deliverInfo} />
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  暂无交付信息{service.status === "pending" ? "（服务开通处理中）" : ""}
                </p>
                {service.config ? (
                  <div>
                    <div className="mt-3 mb-1.5 text-xs font-medium text-muted-foreground">配置</div>
                    <DeliverInfo data={service.config} />
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 续费对话框 */}
      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>续费 {service.name}</DialogTitle>
            <DialogDescription>
              生成续费账单并前往收银台；到期日将从当前到期时间顺延。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">续费周期</span>
            <Select value={renewCycle || undefined} onValueChange={(v) => setRenewCycle(v as BillingCycle)}>
              <SelectTrigger>
                <SelectValue placeholder="请选择周期" />
              </SelectTrigger>
              <SelectContent>
                {BILLING_CYCLES.filter((c) => c !== "onetime").map((c) => (
                  <SelectItem key={c} value={c}>
                    {cycleLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewOpen(false)}>
              取消
            </Button>
            <Button disabled={!renewCycle || renewSubmitting} onClick={() => void handleRenew()}>
              {renewSubmitting ? "生成中…" : "生成账单"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 升级对话框 */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>升级 {service.name}</DialogTitle>
            <DialogDescription>
              按剩余天数折算旧配置价值抵扣新配置首期费用，确认后生成升级账单。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">目标商品</span>
              <Select value={targetProduct || undefined} onValueChange={setTargetProduct}>
                <SelectTrigger>
                  <SelectValue placeholder="选择要升级到的商品" />
                </SelectTrigger>
                <SelectContent>
                  {productOptions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {quoteLoading ? (
              <Skeleton className="h-24" />
            ) : quote ? (
              <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">旧配置剩余价值</span>
                  <span className="tabular-nums">-{formatCny(quote.creditFromOld)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">新配置首期</span>
                  <span className="tabular-nums">{formatCny(quote.newFirstAmount)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>应付差价</span>
                  <span className="tabular-nums">{formatCny(quote.payable)}</span>
                </div>
                {quote.preview.length > 0 ? (
                  <div className="border-t pt-2 text-xs text-muted-foreground">
                    {quote.preview.map((p) => (
                      <div key={p.label}>
                        {p.label}：{p.from} → {p.to}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!targetProduct || quoteLoading}
                onClick={() => void fetchQuote()}
              >
                获取报价
              </Button>
              <Button
                disabled={!quote || quoteLoading}
                onClick={() => void confirmUpgrade()}
              >
                确认升级
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 取消对话框 */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消服务</DialogTitle>
            <DialogDescription>
              取消后服务将停止续费，请谨慎操作。该操作会提交申请，由系统/管理员复核。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(
              [
                { value: "period_end", title: "到期取消", desc: "本周期结束后不再续费，服务到期自动停止" },
                { value: "now", title: "立即取消", desc: "提交终止申请，经管理员复核后服务立即停止（余额不退）" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCancelWhen(opt.value)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors",
                  cancelWhen === opt.value
                    ? "border-primary bg-accent"
                    : "bg-card hover:bg-accent/40",
                )}
              >
                <span className="text-sm font-medium">{opt.title}</span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              再想想
            </Button>
            <Button
              variant="destructive"
              disabled={cancelSubmitting}
              onClick={() => void handleCancel()}
            >
              {cancelSubmitting ? "提交中…" : "确认取消服务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
