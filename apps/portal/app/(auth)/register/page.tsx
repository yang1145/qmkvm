"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { emailRegisterSchema } from "@pinhaoji/contracts";

import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form";

export default function RegisterPage() {
  const router = useRouter();
  const { success } = useToast();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>({});
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (confirm !== password) nextErrors.confirm = "两次输入的密码不一致";
    const parsed = emailRegisterSchema.safeParse({
      email: email.trim(),
      password,
      name: name.trim() ? name.trim() : undefined,
    });
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
    setSubmitting(true);
    try {
      await api.post("/auth/register", parsed.data);
      success("注册成功", "请使用邮箱或手机验证码登录");
      router.push(`/login?next=${encodeURIComponent("/")}`);
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">注册账号</h1>
        <p className="mt-1 text-sm text-muted-foreground">使用邮箱注册拼好机客户中心</p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Field label="邮箱" htmlFor="reg-email" error={errors.email}>
          <Input
            id="reg-email"
            type="email"
            placeholder="name@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="称呼（可选）" htmlFor="reg-name" error={errors.name}>
          <Input
            id="reg-name"
            placeholder="您的姓名或公司名"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="密码"
          htmlFor="reg-password"
          error={errors.password}
          hint="至少 8 位，且同时包含字母与数字"
        >
          <Input
            id="reg-password"
            type="password"
            placeholder="设置登录密码"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="确认密码" htmlFor="reg-confirm" error={errors.confirm}>
          <Input
            id="reg-confirm"
            type="password"
            placeholder="再次输入密码"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "注册中…" : "注册"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        已有账号？{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          直接登录
        </Link>
      </p>
    </div>
  );
}
