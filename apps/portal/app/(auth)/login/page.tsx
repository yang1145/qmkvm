"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authResultSchema, passwordLoginSchema, phoneSchema, smsLoginSchema } from "@pinhaoji/contracts";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useInitialQueryParam } from "@/hooks/use-api";
import { useSmsCode } from "@/hooks/use-sms-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/form";

function safeNext(raw: string): string {
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const nextParam = useInitialQueryParam("next");
  const next = safeNext(nextParam);

  // —— 验证码登录 ——
  const sms = useSmsCode("login");
  const [smsPhone, setSmsPhone] = React.useState("");
  const [smsCode, setSmsCode] = React.useState("");
  const [smsErrors, setSmsErrors] = React.useState<{ phone?: string; code?: string }>({});
  const [smsSubmitting, setSmsSubmitting] = React.useState(false);

  // —— 密码登录 ——
  const [loginName, setLoginName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pwErrors, setPwErrors] = React.useState<{ login?: string; password?: string }>({});
  const [pwSubmitting, setPwSubmitting] = React.useState(false);

  const handleSendCode = async () => {
    const parsed = phoneSchema.safeParse(smsPhone.trim());
    if (!parsed.success) {
      setSmsErrors({ phone: parsed.error.issues[0]?.message ?? "手机号格式不正确" });
      return;
    }
    setSmsErrors({});
    await sms.send(parsed.data);
  };

  const handleSmsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = smsLoginSchema.safeParse({ phone: smsPhone.trim(), code: smsCode.trim() });
    if (!parsed.success) {
      const fieldErrors: typeof smsErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "phone") fieldErrors.phone = issue.message;
        if (key === "code") fieldErrors.code = "请输入 6 位验证码";
      }
      setSmsErrors(fieldErrors);
      return;
    }
    setSmsSubmitting(true);
    try {
      const res = await api.post("/auth/sms/login", parsed.data, { parse: authResultSchema });
      setUser(res.user);
      router.replace(next);
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSmsSubmitting(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = passwordLoginSchema.safeParse({
      login: loginName.trim(),
      password,
    });
    if (!parsed.success) {
      const fieldErrors: typeof pwErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "login") fieldErrors.login = "请输入手机号或邮箱";
        if (key === "password") fieldErrors.password = "请输入密码";
      }
      setPwErrors(fieldErrors);
      return;
    }
    setPwSubmitting(true);
    try {
      const res = await api.post("/auth/login", parsed.data, { parse: authResultSchema });
      setUser(res.user);
      router.replace(next);
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setPwSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">登录客户中心</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理您的云服务、账单与工单</p>
      </div>

      <Tabs defaultValue="sms">
        <TabsList className="w-full">
          <TabsTrigger value="sms" className="flex-1">手机验证码</TabsTrigger>
          <TabsTrigger value="password" className="flex-1">账号密码</TabsTrigger>
        </TabsList>

        <TabsContent value="sms">
          <form className="space-y-4" onSubmit={handleSmsLogin} noValidate>
            <Field label="手机号" htmlFor="sms-phone" error={smsErrors.phone}>
              <Input
                id="sms-phone"
                type="tel"
                inputMode="numeric"
                placeholder="请输入手机号"
                autoComplete="tel"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
              />
            </Field>
            <Field label="验证码" htmlFor="sms-code" error={smsErrors.code}>
              <div className="flex gap-2">
                <Input
                  id="sms-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  autoComplete="one-time-code"
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ""))}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-28 shrink-0"
                  disabled={sms.countdown > 0 || sms.sending}
                  onClick={() => void handleSendCode()}
                >
                  {sms.countdown > 0 ? `${sms.countdown}s 后重发` : sms.sending ? "发送中…" : "发送验证码"}
                </Button>
              </div>
            </Field>
            <Button type="submit" className="w-full" disabled={smsSubmitting}>
              {smsSubmitting ? "登录中…" : "登录"}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="password">
          <form className="space-y-4" onSubmit={handlePasswordLogin} noValidate>
            <Field label="手机号 / 邮箱" htmlFor="pw-login" error={pwErrors.login}>
              <Input
                id="pw-login"
                placeholder="请输入手机号或邮箱"
                autoComplete="username"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
              />
            </Field>
            <Field label="密码" htmlFor="pw-password" error={pwErrors.password}>
              <Input
                id="pw-password"
                type="password"
                placeholder="请输入密码"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={pwSubmitting}>
              {pwSubmitting ? "登录中…" : "登录"}
            </Button>
            <div className="text-right">
              <Link href="/forgot" className="text-sm text-primary hover:underline">
                忘记密码？
              </Link>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      <p className="text-center text-sm text-muted-foreground">
        还没有账号？{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          立即注册
        </Link>
      </p>
    </div>
  );
}
