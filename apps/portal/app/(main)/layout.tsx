"use client";

import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useRequireAuth } from "@/lib/auth-context";

/** 主界面布局：登录守卫 + 顶导航 + 内容容器 + Footer */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {loading || !user ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : (
          children
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
