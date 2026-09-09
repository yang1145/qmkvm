import type { ReactNode } from "react";
import Link from "next/link";
import { renderCopyright } from "@qmkvm/contracts";

import { getBranding } from "@/lib/branding";

/** 认证页布局：居中卡片 + 品牌标识（品牌信息走 admin 站点信息设置，未配置回落内置） */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const b = await getBranding();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        {b.logo ? (
          <img src={b.logo} alt={b.siteName} className="h-9 w-9 rounded-lg object-contain" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground">
            {b.siteName.slice(0, 1)}
          </span>
        )}
        <span className="text-lg font-semibold">{b.siteName}</span>
        {b.siteNameEn ? <span className="text-sm text-muted-foreground">{b.siteNameEn}</span> : null}
      </Link>
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm sm:p-8">
        {children}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        {renderCopyright(b.copyright, `${b.siteName} ${b.siteNameEn}`.trim())} · 业务管理系统
      </p>
    </div>
  );
}
