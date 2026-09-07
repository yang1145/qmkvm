"use client";

import * as React from "react";
import { updateProfileSchema, userProfileSchema } from "@qmkvm/contracts";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApiData } from "@/hooks/use-api";
import { formatCny, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Field } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

export default function AccountProfilePage() {
  const { user, setUser } = useAuth();
  const { success } = useToast();

  const profileState = useApiData(
    () => api.get("/account/profile", { parse: userProfileSchema }),
    [],
  );
  const profile = profileState.data ?? user;

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = React.useState(false);
  const initialized = React.useRef(false);

  React.useEffect(() => {
    if (profile && !initialized.current) {
      initialized.current = true;
      setName(profile.name ?? "");
      setEmail(profile.email ?? "");
    }
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = updateProfileSchema.safeParse({
      name: name.trim() ? name.trim() : undefined,
      email: email.trim() ? email.trim() : undefined,
    });
    if (!parsed.success) {
      const nextErrors: Partial<Record<string, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string") nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await api.put("/account/profile", parsed.data);
      success("资料已更新");
      const refreshed = await api.get("/account/profile", { parse: userProfileSchema, silent: true });
      setUser(refreshed);
      setName(refreshed.name ?? "");
      setEmail(refreshed.email ?? "");
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSaving(false);
    }
  };

  if (profileState.loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="账户资料" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (profileState.error && !profile) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="账户资料" />
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {profileState.error}（账户页可正常浏览，保存时依赖接口）
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="账户资料" description="维护您的个人信息" />

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSave} noValidate>
            <Field label="称呼" htmlFor="acc-name" error={errors.name}>
              <Input
                id="acc-name"
                placeholder="您的姓名或公司简称"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="邮箱" htmlFor="acc-email" error={errors.email} hint="用于接收账单与通知邮件">
              <Input
                id="acc-email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? "保存中…" : "保存修改"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>账号信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">手机号</span>
            <span>{profile?.phone ?? "未绑定"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">账户余额</span>
            <span className="tabular-nums">{profile ? formatCny(profile.creditBalance) : "-"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">注册时间</span>
            <span>{profile ? formatDateTime(profile.createdAt) : "-"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
