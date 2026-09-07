"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  paginated,
  serviceDto,
  ticketCreateSchema,
  ticketPriorityEnum,
} from "@qmkvm/contracts";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { departmentDtoSchema } from "@/lib/schemas";
import { PageHeader } from "@/components/page-header";
import { Field } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

const PRIORITY_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "urgent", label: "紧急" },
] as const;

/** 纯文本 → 简单 HTML（转义 + 换行），供 contentHtml 字段传输 */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
}

export default function NewTicketPage() {
  const router = useRouter();
  const { toast } = useToast();

  const departmentsState = useApiData(
    () => api.get("/departments", { parse: z.array(departmentDtoSchema), silent: true }),
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

  const [departmentId, setDepartmentId] = React.useState("");
  const [serviceId, setServiceId] = React.useState("none");
  const [priority, setPriority] = React.useState<string>("medium");
  const [subject, setSubject] = React.useState("");
  const [content, setContent] = React.useState("");
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>({});
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Partial<Record<string, string>> = {};
    if (!departmentId) nextErrors.departmentId = "请选择受理部门";
    if (!subject.trim()) nextErrors.subject = "请填写问题主题";
    if (!content.trim()) nextErrors.contentHtml = "请填写问题描述";
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    const parsed = ticketCreateSchema.safeParse({
      departmentId: Number(departmentId),
      serviceId: serviceId !== "none" ? Number(serviceId) : undefined,
      subject: subject.trim(),
      priority: priority as z.infer<typeof ticketPriorityEnum>,
      contentHtml: textToHtml(content.trim()),
    });
    if (!parsed.success) {
      toast({ title: parsed.error.issues[0]?.message ?? "表单校验失败", variant: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<{ id: number }>("/tickets", parsed.data);
      toast({ title: "工单已提交", variant: "success" });
      router.push(`/tickets/${created.id}`);
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="新建工单" description="请描述您遇到的问题，我们会尽快处理" />

      <Card>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <Field label="受理部门" htmlFor="tk-dept" error={errors.departmentId}>
              <Select
                value={departmentId || undefined}
                onValueChange={(v) => {
                  setDepartmentId(v);
                  setErrors((prev) => ({ ...prev, departmentId: undefined }));
                }}
              >
                <SelectTrigger id="tk-dept">
                  <SelectValue placeholder="选择问题类型对应的部门" />
                </SelectTrigger>
                <SelectContent>
                  {(departmentsState.data ?? []).map((dept) => (
                    <SelectItem key={dept.id} value={String(dept.id)}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="关联服务（可选）" htmlFor="tk-service">
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger id="tk-service">
                  <SelectValue placeholder="选择相关服务" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联服务</SelectItem>
                  {(servicesState.data?.items ?? []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}（{s.productName}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="优先级" htmlFor="tk-priority">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="tk-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="主题" htmlFor="tk-subject" error={errors.subject}>
              <Input
                id="tk-subject"
                placeholder="一句话描述问题"
                maxLength={200}
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setErrors((prev) => ({ ...prev, subject: undefined }));
                }}
              />
            </Field>

            <Field
              label="问题描述"
              htmlFor="tk-content"
              error={errors.contentHtml}
              hint="可包含报错信息、发生时间、期望结果等"
            >
              <Textarea
                id="tk-content"
                className="min-h-36"
                maxLength={20000}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setErrors((prev) => ({ ...prev, contentHtml: undefined }));
                }}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                取消
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "提交中…" : "提交工单"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
