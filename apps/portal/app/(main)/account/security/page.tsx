"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { changePasswordSchema } from "@qmkvm/contracts";
import { z } from "zod";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApiData } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/format";
import { accountSessionDtoSchema } from "@/lib/schemas";
import { PageHeader } from "@/components/page-header";
import { Field } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

export default function AccountSecurityPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const { toast, success } = useToast();

  const sessionsState = useApiData(
    () => api.get("/account/sessions", { parse: z.array(accountSessionDtoSchema), silent: true }),
    [],
  );

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>({});
  const [changing, setChanging] = React.useState(false);

  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [revokingAll, setRevokingAll] = React.useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Partial<Record<string, string>> = {};
    if (!currentPassword) nextErrors.currentPassword = "请输入当前密码";
    if (newPassword !== confirm) nextErrors.confirm = "两次输入的新密码不一致";
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !nextErrors[key]) nextErrors[key] = issue.message;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setChanging(true);
    try {
      await api.post("/auth/change-password", parsed.data);
      success("密码已修改", "其他设备会话已全部失效");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      sessionsState.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setChanging(false);
    }
  };

  const revoke = async (sessionId: string) => {
    setRevoking(sessionId);
    try {
      await api.del(`/account/sessions/${encodeURIComponent(sessionId)}`);
      toast({ title: "会话已撤销", variant: "success" });
      sessionsState.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setRevoking(null);
    }
  };

  const revokeAll = async () => {
    setRevokingAll(true);
    try {
      await api.del("/account/sessions");
      success("已退出其他设备", "当前登录保持不变");
      sessionsState.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setRevokingAll(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="安全设置" description="修改密码与会话管理" />

      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleChangePassword} noValidate>
            <Field label="当前密码" htmlFor="sec-current" error={errors.currentPassword}>
              <Input
                id="sec-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
            <Field
              label="新密码"
              htmlFor="sec-new"
              error={errors.newPassword}
              hint="至少 8 位，且同时包含字母与数字"
            >
              <Input
                id="sec-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <Field label="确认新密码" htmlFor="sec-confirm" error={errors.confirm}>
              <Input
                id="sec-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={changing}>
                {changing ? "提交中…" : "修改密码"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>登录会话</CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={revokingAll || (sessionsState.data?.length ?? 0) === 0}
            onClick={() => void revokeAll()}
          >
            退出其他设备
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {sessionsState.loading ? (
            <Skeleton className="h-24" />
          ) : (sessionsState.data?.length ?? 0) === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无其他会话记录</p>
          ) : (
            (sessionsState.data ?? []).map((session) => (
              <div
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {session.ip || "未知 IP"}
                    {session.current ? (
                      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                        当前设备
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground" title={session.ua ?? undefined}>
                    {session.ua ?? "未知设备"}
                    {session.lastSeenAt ? ` · 最近活跃 ${formatDateTime(session.lastSeenAt)}` : ""}
                  </div>
                </div>
                {!session.current ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoking === session.id}
                    onClick={() => void revoke(session.id)}
                  >
                    {revoking === session.id ? "撤销中…" : "撤销"}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => void handleLogout()}>
                    退出登录
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
