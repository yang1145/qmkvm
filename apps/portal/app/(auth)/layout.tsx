import type { ReactNode } from "react";
import Link from "next/link";

/** 认证页布局：居中卡片 + 品牌标识 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground">
          拼
        </span>
        <span className="text-lg font-semibold">拼好机</span>
        <span className="text-sm text-muted-foreground">Pinhaoji Cloud</span>
      </Link>
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm sm:p-8">
        {children}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} 拼好机 Pinhaoji Cloud · 云业务系统
      </p>
    </div>
  );
}
