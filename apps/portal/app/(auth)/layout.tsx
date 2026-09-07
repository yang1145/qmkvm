import type { ReactNode } from "react";
import Link from "next/link";

/** 认证页布局：居中卡片 + 品牌标识 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground">
          启
        </span>
        <span className="text-lg font-semibold">启明智联</span>
        <span className="text-sm text-muted-foreground">QmKvm</span>
      </Link>
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm sm:p-8">
        {children}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} 启明智联 QmKvm · 业务管理系统
      </p>
    </div>
  );
}
