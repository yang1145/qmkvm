"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { authResultSchema, type AuthResult } from "@pinhaoji/contracts";

import { api } from "@/lib/api";
import { notificationListSchema } from "@/lib/schemas";

interface AuthContextValue {
  user: AuthResult["user"] | null;
  /** 初始会话探测是否完成 */
  loading: boolean;
  unreadCount: number;
  refresh: () => Promise<AuthResult["user"] | null>;
  setUser: (user: AuthResult["user"] | null) => void;
  logout: () => Promise<void>;
  refreshUnread: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}

/**
 * 页面级登录守卫：会话探测完成后未登录 → 跳转 /login?next=
 * 返回 loading 为 true 时调用方应渲染占位骨架。
 */
export function useRequireAuth() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const search = typeof window === "undefined" ? "" : window.location.search;

  React.useEffect(() => {
    if (!loading && !user) {
      const next = encodeURIComponent(pathname + search);
      router.replace(`/login?next=${next}`);
    }
  }, [loading, user, router, pathname, search]);

  return { user, loading };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthResult["user"] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [unreadCount, setUnreadCount] = React.useState(0);

  const refresh = React.useCallback(async () => {
    try {
      const res = await api.get("/auth/me", { parse: authResultSchema, silent: true });
      setUser(res.user);
      return res.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUnread = React.useCallback(async () => {
    try {
      const res = await api.get("/notifications", {
        query: { page: 1, pageSize: 100 },
        parse: notificationListSchema,
        silent: true,
      });
      setUnreadCount(res.items.filter((n) => !n.readAt).length);
    } catch {
      // 未登录或接口暂不可用：静默
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // 登录后拉取未读数 + 低频轮询
  React.useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    void refreshUnread();
    const timer = window.setInterval(() => void refreshUnread(), 60_000);
    return () => window.clearInterval(timer);
  }, [user, refreshUnread]);

  // 会话失效（401）时清空登录态
  React.useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("phj:unauthorized", onUnauthorized);
    return () => window.removeEventListener("phj:unauthorized", onUnauthorized);
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await api.post("/auth/logout", undefined, { silent: true });
    } catch {
      // 忽略登出接口异常，本地强制清理
    }
    setUser(null);
    setUnreadCount(0);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, unreadCount, refresh, setUser, logout, refreshUnread }}
    >
      {children}
    </AuthContext.Provider>
  );
}
