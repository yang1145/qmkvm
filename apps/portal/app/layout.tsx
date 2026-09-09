import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/components/ui/toast";
import { BrandingProvider } from "@/components/branding-provider";
import { getBranding } from "@/lib/branding";
import "./globals.css";

/** 品牌定制：站点名/favicon 走 admin 站点信息设置（≤60s 缓存，未配置回落内置品牌） */
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return {
    title: {
      default: `${b.siteName} · 客户中心`,
      template: `%s · ${b.siteName}`,
    },
    description: `${b.siteName} ${b.siteNameEn} 客户门户：购买、管理您的云服务。`,
    icons: b.logo
      ? { icon: b.logo, apple: b.logo }
      : { icon: "/favicon.ico", apple: "/logo.png" },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const branding = await getBranding();
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh">
        <ToastProvider>
          <AuthProvider>
            <BrandingProvider value={branding}>{children}</BrandingProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
