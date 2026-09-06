import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <div>© {new Date().getFullYear()} 拼好机 Pinhaoji Cloud · 云业务系统</div>
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
