"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { phoneSchema, resetPasswordBySmsSchema } from "@pinhaoji/contracts";

import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useSmsCode } from "@/hooks/use-sms-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form";

export default function ForgotPage() {
  const router = useRouter();
  const { success } = useToast();
  const sms = useSmsCode("reset");
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>({});
  const [submitting, setSubmitting] = React.useState(false);

  const handleSendCode = async () => {
    const parsed = phoneSchema.safeParse(phone.trim());
    if (!parsed.success) {
      setErrors((prev) => ({ ...prev, phone: parsed.error.issues[0]?.message ?? "手机号格式不正确" }));
      return;
    }
    setErrors((prev) => ({ ...prev, phone: undefined }));
    await sms.send(parsed.data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = resetPasswordBySmsSchema.safeParse({
      phone: phone.trim(),
      code: code.trim(),
      password,
    });
    const nextErrors: Record<string, string> = {};
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
      await api.post("/auth/reset-password/sms", parsed.data);
      success("密码已重置", "请使用新密码登录");
      router.push("/login");
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">找回密码</h1>
        <p className="mt-1 text-sm text-muted-foreground">通过手机验证码重置登录密码</p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Field label="手机号" htmlFor="fp-phone" error={errors.phone}>
          <Input
            id="fp-phone"
            type="tel"
            inputMode="numeric"
            placeholder="请输入注册手机号"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="验证码" htmlFor="fp-code" error={errors.code}>
          <div className="flex gap-2">
            <Input
              id="fp-code"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
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
        <Field
          label="新密码"
          htmlFor="fp-password"
          error={errors.password}
          hint="至少 8 位，且同时包含字母与数字"
        >
          <Input
            id="fp-password"
            type="password"
            placeholder="设置新密码"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "提交中…" : "重置密码"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        想起密码了？{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          返回登录
        </Link>
      </p>
    </div>
  );
}
