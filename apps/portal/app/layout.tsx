import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/components/ui/toast";
import { BrandingProvider } from "@/components/branding-provider";
import "./globals.css";

/**
 * 元信息用通用格式、不内置品牌名与缺省图标：品牌（站点名/logo/favicon）
 * 全部由 BrandingProvider 客户端拉取 admin「站点信息」运行时生效，
 * admin 更新后无需重新构建。
 */
export const metadata: Metadata = {
  title: {
    default: "客户中心",
    template: "%s · 客户中心",
  },
  description: "客户门户：购买、管理您的云服务。",
};

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
