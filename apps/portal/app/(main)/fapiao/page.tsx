"use client";

import * as React from "react";
import Link from "next/link";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { z } from "zod";
import {
  fapiaoRequestDto,
  fapiaoTitleDto,
  paginated,
} from "@qmkvm/contracts";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatCny, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/empty-state";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Field } from "@/components/form";

const FAPIAO_STATUS_META: Record<string, { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }> = {
  pending: { label: "待审核", variant: "warning" },
  approved: { label: "已审批", variant: "info" },
  issued: { label: "已开票", variant: "success" },
  rejected: { label: "已驳回", variant: "danger" },
};

const FAPIAO_TYPE_LABEL: Record<string, string> = {
  electronic: "电子普票",
  special: "增值税专票",
};

const TITLE_TYPE_LABEL: Record<string, string> = {
  personal: "个人",
  enterprise: "企业",
};

function FapiaoStatusBadge({ status }: { status: string }) {
  const meta = FAPIAO_STATUS_META[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** 表单态抬头（编辑时 taxNo 可能是脱敏值，后端识别为未修改） */
interface TitleForm {
  id: number | null;
  type: "personal" | "enterprise";
  name: string;
  taxNo: string;
  email: string;
  bankName: string;
  bankAccount: string;
  companyAddress: string;
  companyPhone: string;
  isDefault: boolean;
}

const EMPTY_TITLE_FORM: TitleForm = {
  id: null,
  type: "personal",
  name: "",
  taxNo: "",
  email: "",
  bankName: "",
  bankAccount: "",
  companyAddress: "",
  companyPhone: "",
  isDefault: false,
};

export default function FapiaoPage() {
  const { toast } = useToast();
  const [page, setPage] = React.useState(1);
  const PAGE_SIZE = 10;

  const records = useApiData(
    () =>
      api.get("/fapiao/requests", {
        query: { page, pageSize: PAGE_SIZE },
        parse: paginated(fapiaoRequestDto),
      }),
    [page],
  );
  const titles = useApiData(
    () =>
      api.get("/fapiao/titles", {
        parse: z.object({ items: z.array(fapiaoTitleDto) }),
      }),
    [],
  );

  // —— 抬头表单对话框 ——
  const [titleFormOpen, setTitleFormOpen] = React.useState(false);
  const [titleForm, setTitleForm] = React.useState<TitleForm>(EMPTY_TITLE_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  // —— 删除确认 ——
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: number; name: string } | null>(null);

  const openCreate = () => {
    setTitleForm(EMPTY_TITLE_FORM);
    setTitleFormOpen(true);
  };

  const openEdit = (t: z.infer<typeof fapiaoTitleDto>) => {
    setTitleForm({
      id: t.id,
      type: t.type,
      name: t.name,
      taxNo: t.taxNo ?? "",
      email: t.email ?? "",
      bankName: t.bankName ?? "",
      bankAccount: t.bankAccount ?? "",
      companyAddress: t.companyAddress ?? "",
      companyPhone: t.companyPhone ?? "",
      isDefault: t.isDefault,
    });
    setTitleFormOpen(true);
  };

  const submitTitle = async () => {
    if (!titleForm.name.trim()) {
      toast({ title: "请填写抬头名称", variant: "error" });
      return;
    }
    if (titleForm.type === "enterprise" && !titleForm.taxNo.trim()) {
      toast({ title: "企业抬头需填写纳税人识别号", variant: "error" });
      return;
    }
    setSubmitting(true);
    const body = {
      type: titleForm.type,
      name: titleForm.name.trim(),
      taxNo: titleForm.taxNo.trim() || undefined,
      email: titleForm.email.trim() || undefined,
      bankName: titleForm.bankName.trim() || undefined,
      bankAccount: titleForm.bankAccount.trim() || undefined,
      companyAddress: titleForm.companyAddress.trim() || undefined,
      companyPhone: titleForm.companyPhone.trim() || undefined,
      isDefault: titleForm.isDefault,
    };
    try {
      if (titleForm.id) {
        await api.put(`/fapiao/titles/${titleForm.id}`, body);
        toast({ title: "抬头已更新" });
      } else {
        await api.post("/fapiao/titles", body);
        toast({ title: "抬头已创建" });
      }
      setTitleFormOpen(false);
      titles.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await api.del(`/fapiao/titles/${deleteTarget.id}`);
      toast({ title: "抬头已删除" });
      setDeleteTarget(null);
      titles.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSubmitting(false);
    }
  };

  const setDefault = async (id: number) => {
    try {
      await api.put(`/fapiao/titles/${id}/default`);
      toast({ title: "已设为默认抬头" });
      titles.reload();
    } catch {
      // Toast 已由 api 层弹出
    }
  };

  const titleItems = titles.data?.items ?? [];
  const recordItems = records.data?.items ?? [];
  const totalPages = records.data ? Math.max(1, Math.ceil(records.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader title="发票中心" description="开票记录与发票抬头管理" />

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">开票记录</TabsTrigger>
          <TabsTrigger value="titles">抬头管理</TabsTrigger>
        </TabsList>

        {/* —— 开票记录 —— */}
        <TabsContent value="records" className="mt-4 space-y-4">
          {records.loading ? (
            <Skeleton className="h-64" />
          ) : records.error ? (
            <ErrorState message={records.error} onRetry={records.reload} />
          ) : recordItems.length === 0 ? (
            <EmptyState
              title="暂无开票记录"
              description="已支付的账单可在账单详情页申请开票"
              action={
                <Button asChild variant="outline">
                  <Link href="/invoices">查看账单</Link>
                </Button>
              }
            />
          ) : (
            <div className="rounded-lg border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>申请时间</TableHead>
                    <TableHead>账单</TableHead>
                    <TableHead>抬头</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>发票号</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recordItems.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                      <TableCell>
                        <Link href={`/invoices/detail?id=${r.invoiceId}`} className="text-primary hover:underline">
                          {r.invoiceNo ?? `#${r.invoiceId}`}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.title?.name ?? "-"}</div>
                        {r.title?.taxNo ? (
                          <div className="text-xs text-muted-foreground">{r.title.taxNo}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{FAPIAO_TYPE_LABEL[r.type] ?? r.type}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCny(r.amount)}</TableCell>
                      <TableCell>
                        <FapiaoStatusBadge status={r.status} />
                        {r.status === "rejected" && r.rejectReason ? (
                          <div className="mt-1 max-w-48 text-xs text-muted-foreground">
                            原因：{r.rejectReason}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {r.fapiaoNo ? (
                          <div>
                            <div className="font-medium">{r.fapiaoNo}</div>
                            {r.fapiaoUrl ? (
                              <a
                                href={r.fapiaoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-primary hover:underline"
                              >
                                查看发票
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {totalPages > 1 ? (
                <div className="flex items-center justify-end gap-2 border-t px-4 py-3 text-sm">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </Button>
                  <span className="text-muted-foreground">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </TabsContent>

        {/* —— 抬头管理 —— */}
        <TabsContent value="titles" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增抬头
            </Button>
          </div>

          {titles.loading ? (
            <Skeleton className="h-40" />
          ) : titles.error ? (
            <ErrorState message={titles.error} onRetry={titles.reload} />
          ) : titleItems.length === 0 ? (
            <EmptyState title="暂无发票抬头" description="添加抬头后即可在申请开票时选用" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {titleItems.map((t) => (
                <Card key={t.id}>
                  <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      {t.name}
                      <Badge variant="secondary">{TITLE_TYPE_LABEL[t.type] ?? t.type}</Badge>
                      {t.isDefault ? <Badge variant="soft">默认</Badge> : null}
                    </CardTitle>
                    <div className="flex items-center gap-1">
                      {!t.isDefault ? (
                        <Button variant="ghost" size="sm" onClick={() => setDefault(t.id)}>
                          <Star className="h-3.5 w-3.5" />
                          设默认
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget({ id: t.id, name: t.name })}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-muted-foreground">
                    {t.taxNo ? <div>税号：{t.taxNo}</div> : null}
                    {t.email ? <div>邮箱：{t.email}</div> : null}
                    {t.bankName ? <div>开户行：{t.bankName}</div> : null}
                    {t.bankAccount ? <div>账号：{t.bankAccount}</div> : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 抬头新增/编辑对话框 */}
      <Dialog open={titleFormOpen} onOpenChange={setTitleFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{titleForm.id ? "编辑抬头" : "新增抬头"}</DialogTitle>
            <DialogDescription>
              {titleForm.type === "enterprise"
                ? "企业抬头需填写纳税人识别号，专票信息选填。"
                : "个人抬头仅需姓名与接收邮箱。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="抬头类型">
              <Select
                value={titleForm.type}
                onValueChange={(v) => setTitleForm({ ...titleForm, type: v as TitleForm["type"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">个人</SelectItem>
                  <SelectItem value="enterprise">企业</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={titleForm.type === "enterprise" ? "企业名称" : "姓名"}>
              <Input
                value={titleForm.name}
                onChange={(e) => setTitleForm({ ...titleForm, name: e.target.value })}
                maxLength={200}
              />
            </Field>
            {titleForm.type === "enterprise" ? (
              <Field label="纳税人识别号">
                <Input
                  value={titleForm.taxNo}
                  onChange={(e) => setTitleForm({ ...titleForm, taxNo: e.target.value })}
                  maxLength={50}
                  placeholder="统一社会信用代码"
                />
              </Field>
            ) : null}
            <Field label="接收邮箱">
              <Input
                type="email"
                value={titleForm.email}
                onChange={(e) => setTitleForm({ ...titleForm, email: e.target.value })}
                maxLength={255}
              />
            </Field>
            {titleForm.type === "enterprise" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="开户银行（选填）">
                    <Input
                      value={titleForm.bankName}
                      onChange={(e) => setTitleForm({ ...titleForm, bankName: e.target.value })}
                      maxLength={200}
                    />
                  </Field>
                  <Field label="银行账号（选填）">
                    <Input
                      value={titleForm.bankAccount}
                      onChange={(e) => setTitleForm({ ...titleForm, bankAccount: e.target.value })}
                      maxLength={64}
                    />
                  </Field>
                </div>
                <Field label="企业地址（选填）">
                  <Input
                    value={titleForm.companyAddress}
                    onChange={(e) => setTitleForm({ ...titleForm, companyAddress: e.target.value })}
                    maxLength={300}
                  />
                </Field>
                <Field label="企业电话（选填）">
                  <Input
                    value={titleForm.companyPhone}
                    onChange={(e) => setTitleForm({ ...titleForm, companyPhone: e.target.value })}
                    maxLength={30}
                  />
                </Field>
              </>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={titleForm.isDefault}
                onChange={(e) => setTitleForm({ ...titleForm, isDefault: e.target.checked })}
              />
              设为默认抬头
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTitleFormOpen(false)}>
              取消
            </Button>
            <Button onClick={submitTitle} disabled={submitting}>
              {titleForm.id ? "保存修改" : "创建抬头"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除抬头</DialogTitle>
            <DialogDescription>
              确定删除「{deleteTarget?.name}」？已被开票申请引用的抬头无法删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={doDelete} disabled={submitting}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
