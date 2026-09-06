"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { invoiceDto } from "@pinhaoji/contracts";
import QRCode from "qrcode";
import { CheckCircle2, ExternalLink, Wallet } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApiData, useInitialQueryParam } from "@/hooks/use-api";
import { formatCny, formatDateTime } from "@/lib/format";
import { payResultSchema, settingsSchema } from "@/lib/schemas";
import { InvoiceStatusBadge, orderTypeLabel } from "@/components/status-badge";
import { ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const METHOD_LABELS: Record<string, { label: string; desc: string }> = {
  alipay: { label: "支付宝", desc: "跳转支付宝完成付款" },
  wechat: { label: "微信支付", desc: "扫码或跳转微信支付" },
  mock: { label: "模拟支付（测试）", desc: "开发环境模拟网关回调" },
};

export default function PayPage() {
  const params = useParams<{ invoiceId: string }>();
  const invoiceId = typeof params.invoiceId === "string" ? params.invoiceId : "";
  const paidQuery = useInitialQueryParam("paid");
  const { user, refresh } = useAuth();
  const { toast } = useToast();

  const invoiceState = useApiData(
    () => api.get(`/invoices/${encodeURIComponent(invoiceId)}`, { parse: invoiceDto }),
    [invoiceId],
  );
  const settingsState = useApiData(
    () => api.get("/settings", { parse: settingsSchema, silent: true }),
    [],
  );

  const [paying, setPaying] = React.useState(false);
  const [polling, setPolling] = React.useState(false);
  const [manualPaid, setManualPaid] = React.useState(paidQuery === "1");
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [mockPayUrl, setMockPayUrl] = React.useState<string | null>(null);

  const invoice = invoiceState.data;
  const isPaid = manualPaid || invoice?.status === "paid";

  // 轮询账单状态直到支付完成
  React.useEffect(() => {
    if (!polling || !invoiceId) return;
    const timer = window.setInterval(async () => {
      try {
        const inv = await api.get(`/invoices/${encodeURIComponent(invoiceId)}`, {
          parse: invoiceDto,
          silent: true,
        });
        if (inv.status === "paid") {
          setPolling(false);
          setManualPaid(true);
          invoiceState.reload();
          void refresh();
        }
      } catch {
        // 轮询失败静默重试
      }
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, invoiceId]);

  const handlePay = async (method: string) => {
    if (!invoice || paying) return;
    setPaying(true);
    try {
      const result =
        method === "balance"
          ? await api.post(
              `/invoices/${invoice.id}/pay`,
              { useBalance: true },
              { parse: payResultSchema },
            )
          : await api.post(
              `/invoices/${invoice.id}/pay`,
              { gateway: method },
              { parse: payResultSchema },
            );

      if (result.paid) {
        setManualPaid(true);
        invoiceState.reload();
        void refresh();
        return;
      }
      if (result.qrCode) {
        const url = await QRCode.toDataURL(result.qrCode, { width: 220, margin: 1 });
        setQrDataUrl(url);
        setPolling(true);
      } else if (result.payUrl) {
        if (method === "mock") {
          // 开发辅助：直接触发 mock 网关成功回调（生产无该端点，静默失败），随后轮询
          void api.post(`/dev/mock-pay/${invoice.invoiceNo}`, undefined, { silent: true }).catch(
            () => undefined,
          );
          setMockPayUrl(result.payUrl);
          setPolling(true);
          toast({ title: "模拟支付已发起", description: "等待回调确认（约 3 秒轮询）" });
        } else {
          window.location.href = result.payUrl;
        }
      } else {
        toast({ title: "支付发起失败", description: "网关未返回支付信息，请稍后重试", variant: "error" });
      }
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setPaying(false);
    }
  };

  if (invoiceState.loading) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (invoiceState.error || !invoice) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <ErrorState message={invoiceState.error ?? "账单不存在"} onRetry={invoiceState.reload} />
      </div>
    );
  }

  // —— 支付成功 ——
  if (isPaid) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <div className="text-lg font-semibold">支付成功</div>
            <div className="text-sm text-muted-foreground">
              账单 {invoice.invoiceNo} · {formatCny(invoice.total)}
            </div>
            <div className="text-xs text-muted-foreground">
              支付时间：{formatDateTime(invoice.paidAt)} · 服务开通正在处理
            </div>
            <div className="mt-4 flex gap-2">
              <Button asChild variant="outline">
                <Link href="/services">查看我的服务</Link>
              </Button>
              <Button asChild>
                <Link href="/">返回工作台</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const methods = settingsState.data?.paymentMethods ?? [];
  const balance = user?.creditBalance ?? 0;
  const canBalancePay = balance >= invoice.total && invoice.total > 0;

  return (
    <div className="mx-auto max-w-lg space-y-5 py-8">
      <div>
        <h1 className="text-xl font-semibold">收银台</h1>
        <p className="mt-1 text-sm text-muted-foreground">选择支付方式完成付款</p>
      </div>

      {/* 账单信息 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">待付账单</span>
            <InvoiceStatusBadge status={invoice.status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">账单编号</span>
            <Link href={`/invoices/${invoice.id}`} className="text-primary hover:underline">
              {invoice.invoiceNo}
            </Link>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">类型</span>
            <span>{orderTypeLabel(invoice.type)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">创建时间</span>
            <span>{formatDateTime(invoice.createdAt)}</span>
          </div>
          {invoice.dueAt ? (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">支付期限</span>
              <span>{formatDateTime(invoice.dueAt)}</span>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">应付金额</span>
            <span className="text-2xl font-semibold text-primary tabular-nums">
              {formatCny(Math.max(0, invoice.total - invoice.balanceUsed))}
            </span>
          </div>
          {invoice.balanceUsed > 0 ? (
            <p className="text-right text-xs text-muted-foreground">
              已含余额抵扣 {formatCny(invoice.balanceUsed)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* 支付方式 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">支付方式</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {canBalancePay ? (
            <PayMethodButton
              label="余额支付"
              desc={`当前余额 ${formatCny(balance)}`}
              icon={<Wallet className="h-4 w-4 text-primary" />}
              disabled={paying}
              onClick={() => void handlePay("balance")}
            />
          ) : null}

          {methods.length === 0 && !canBalancePay ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              暂无可用支付方式，请联系管理员或稍后重试。
            </p>
          ) : null}

          {methods.map((method) => (
            <PayMethodButton
              key={method}
              label={METHOD_LABELS[method]?.label ?? method}
              desc={METHOD_LABELS[method]?.desc ?? ""}
              disabled={paying}
              onClick={() => void handlePay(method)}
            />
          ))}

          {paying ? <p className="text-center text-xs text-muted-foreground">正在发起支付…</p> : null}
        </CardContent>
      </Card>

      {/* 扫码支付 */}
      {qrDataUrl ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="支付二维码" className="h-56 w-56 rounded-lg border p-2" />
            <div className="text-sm text-muted-foreground">请使用手机扫码完成支付</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
              支付完成后本页将自动跳转…
            </div>
          </CardContent>
        </Card>
      ) : null}

      {mockPayUrl ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-5 text-center">
            <div className="text-sm">模拟支付发起成功，等待回调…</div>
            <a
              href={mockPayUrl}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              打开模拟支付页
            </a>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
              支付完成后本页将自动跳转…
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PayMethodButton({
  label,
  desc,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  desc?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border bg-card p-3.5 text-left shadow-sm transition-colors hover:border-primary/60 hover:bg-accent/40",
        "disabled:pointer-events-none disabled:opacity-60",
      )}
    >
      {icon ?? <span className="flex h-4 w-4 items-center justify-center text-primary">·</span>}
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {desc ? <span className="block text-xs text-muted-foreground">{desc}</span> : null}
      </span>
      <span className="text-xs text-primary">支付</span>
    </button>
  );
}
