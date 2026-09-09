import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/components/ui/toast";
import { BrandingProvider } from "@/components/branding-provider";
import { getBranding } from "@/lib/branding";
import "./globals.css";

/**
 * 品牌定制：站点名/favicon 走 admin 站点信息设置。
 * 静态导出下此处为构建期取值（API 不可达时回落内置缺省），
 * 运行时品牌（logo/favicon/页脚）由 BrandingProvider 客户端拉取更新。
 */
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh">
        <ToastProvider>
          <AuthProvider>
            <BrandingProvider>{children}</BrandingProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
