"use client";

import * as React from "react";
import Link from "next/link";
import {
  invoiceDto,
  paginated,
  serviceDto,
} from "@pinhaoji/contracts";
import {
  CreditCard,
  LifeBuoy,
  Package,
  Server,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApiData } from "@/hooks/use-api";
import { formatCny, formatDate } from "@/lib/format";
import { settingsSchema } from "@/lib/schemas";
import { PageHeader } from "@/components/page-header";
import { InvoiceStatusBadge, orderTypeLabel } from "@/components/status-badge";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const QUICK_LINKS = [
  { href: "/products", label: "购买商品", icon: Package, desc: "浏览云产品" },
  { href: "/services", label: "我的服务", icon: Server, desc: "管理运行中的服务" },
  { href: "/invoices", label: "我的账单", icon: CreditCard, desc: "查账与支付" },
  { href: "/credits", label: "余额充值", icon: Wallet, desc: "充值与流水" },
  { href: "/tickets/new", label: "提交工单", icon: LifeBuoy, desc: "获取技术支持" },
  { href: "/account/identity", label: "实名认证", icon: ShieldCheck, desc: "个人/企业认证" },
];

export default function DashboardPage() {
  const { user } = useAuth();

  const settingsState = useApiData(
    () => api.get("/settings", { parse: settingsSchema, silent: true }),
    [],
  );

  const invoicesState = useApiData(
    () =>
      api.get("/invoices", {
        query: { page: 1, pageSize: 5 },
        parse: paginated(invoiceDto),
        silent: true,
      }),
    [],
  );

  const servicesState = useApiData(
    () =>
      api.get("/services", {
        query: { page: 1, pageSize: 100 },
        parse: paginated(serviceDto),
        silent: true,
      }),
    [],
  );

  const unpaidCount = React.useMemo(() => {
    if (!invoicesState.data) return null;
    return invoicesState.data.items.filter((i) => i.status === "unpaid").length;
  }, [invoicesState.data]);

  const expiringCount = React.useMemo(() => {
    if (!servicesState.data) return null;
    const today = new Date();
    const in14 = new Date(today.getTime() + 14 * 86_400_000);
    return servicesState.data.items.filter((s) => {
      if (s.status !== "active" || !s.nextDueDate) return false;
      const due = new Date(s.nextDueDate + "T23:59:59");
      return due >= today && due <= in14;
    }).length;
  }, [servicesState.data]);

  const announcement = settingsState.data?.announcement ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`您好，${user?.name || user?.email || user?.phone || "用户"}`}
        description="欢迎回到拼好机客户中心"
      />

      {announcement ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="mr-2 font-medium">公告</span>
          {announcement}
        </div>
      ) : null}

      {/* 概览卡片 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet className="h-4 w-4" />
              账户余额
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {user ? formatCny(user.creditBalance) : "-"}
            </div>
            <Link href="/credits" className="mt-1 inline-block text-sm text-primary hover:underline">
              去充值
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CreditCard className="h-4 w-4" />
              待付账单
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {unpaidCount === null ? "-" : unpaidCount}
            </div>
            <Link href="/invoices" className="mt-1 inline-block text-sm text-primary hover:underline">
              查看账单
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Server className="h-4 w-4" />
              14 天内到期服务
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {expiringCount === null ? "-" : expiringCount}
            </div>
            <Link href="/services" className="mt-1 inline-block text-sm text-primary hover:underline">
              管理服务
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* 快捷入口 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">快捷入口</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex flex-col items-center gap-1.5 rounded-lg border bg-card px-3 py-4 text-center shadow-sm transition-colors hover:bg-accent"
            >
              <item.icon className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.desc}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 最近账单 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">最近账单</h2>
          <Link href="/invoices" className="text-sm text-primary hover:underline">
            全部账单
          </Link>
        </div>
        {invoicesState.loading ? (
          <Skeleton className="h-40" />
        ) : invoicesState.error ? (
          <ErrorState message={invoicesState.error} onRetry={invoicesState.reload} />
        ) : (invoicesState.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="暂无账单" description="购买商品后将在这里生成账单" />
        ) : (
          <div className="rounded-lg border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账单号</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoicesState.data?.items.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {inv.invoiceNo}
                      </Link>
                    </TableCell>
                    <TableCell>{orderTypeLabel(inv.type)}</TableCell>
                    <TableCell className="tabular-nums">{formatCny(inv.total)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(inv.createdAt)}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={inv.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
