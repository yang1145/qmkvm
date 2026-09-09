"use client";

import Link from "next/link";
import { renderCopyright } from "@qmkvm/contracts";

import { useBranding } from "@/components/branding-provider";

export function SiteFooter() {
  const b = useBranding();
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <div>
          {renderCopyright(b.copyright, `${b.siteName} ${b.siteNameEn}`.trim())} · 业务管理系统
        </div>
        <div className="flex items-center gap-4">
          <Link href="/notifications" className="transition-colors hover:text-foreground">
            通知
          </Link>
          <Link href="/tickets" className="transition-colors hover:text-foreground">
            工单支持
          </Link>
          <Link href="/account" className="transition-colors hover:text-foreground">
            账户
          </Link>
        </div>
      </div>
    </footer>
  );
}
