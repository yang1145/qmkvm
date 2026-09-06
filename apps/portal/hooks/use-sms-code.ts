"use client";

import * as React from "react";

import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

/**
 * 发送短信验证码 + 60 秒倒计时。
 * purpose：login=注册登录合一 / reset=找回密码 / bind=换绑手机
 */
export function useSmsCode(purpose: "login" | "reset" | "bind") {
  const { toast } = useToast();
  const [countdown, setCountdown] = React.useState(0);
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const send = React.useCallback(
    async (phone: string): Promise<boolean> => {
      if (countdown > 0 || sending) return false;
      setSending(true);
      try {
        await api.post("/auth/sms/send", { phone, purpose });
        toast({ title: "验证码已发送", description: "请留意手机短信（约 1 分钟内送达）" });
        setCountdown(60);
        return true;
      } catch {
        // 错误 Toast 已由 api 层统一弹出
        return false;
      } finally {
        setSending(false);
      }
    },
    [countdown, sending, purpose, toast],
  );

  return { send, countdown, sending };
}
