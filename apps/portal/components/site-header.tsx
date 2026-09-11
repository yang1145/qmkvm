"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Package,
  Server,
  Settings,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  Wallet,
  X,
} from "lucide-react";

import { useBranding } from "@/components/branding-provider";
import { useAuth } from "@/lib/auth-context";
import { formatCny } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_ITEMS = [
  { href: "/", label: "工作台", icon: LayoutDashboard, exact: true },
  { href: "/products", label: "商品", icon: Package, exact: false },
  { href: "/services", label: "服务", icon: Server, exact: false },
  { href: "/invoices", label: "账单", icon: FileText, exact: false },
  { href: "/tickets", label: "工单", icon: LifeBuoy, exact: false },
  { href: "/kb", label: "帮助中心", icon: BookOpen, exact: false },
] as const;

function isActive(pathname: string, href: string, exact: boolean) {
  if (exact) return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function SiteHeader() {
  const { user, unreadCount, logout } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // 路由变化时关闭移动端抽屉
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="mr-2 flex items-center gap-2 font-semibold">
          {branding.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logo}
              alt={branding.siteName}
              className="h-7 w-7 rounded-md object-contain"
            />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
              {branding.siteName.slice(0, 1) || "启"}
            </span>
          )}
          <span className="hidden sm:inline">{branding.siteName}</span>
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
            {branding.siteNameEn}
          </span>
        </Link>

        {/* 桌面导航 */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive(pathname, item.href, item.exact)
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {/* 余额 */}
          {user ? (
            <Link
              href="/credits"
              className="mr-1 hidden items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm transition-colors hover:bg-accent sm:flex"
              title="余额与充值"
            >
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{formatCny(user.creditBalance)}</span>
            </Link>
          ) : null}

          {/* 购物车 */}
          <Link
            href="/cart"
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="购物车"
          >
            <ShoppingCart className="h-[18px] w-[18px]" />
          </Link>

          {/* 通知（未读角标） */}
          <Link
            href="/notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="通知"
          >
            <Bell className="h-[18px] w-[18px]" />
            {unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>

          {/* 用户菜单 */}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="ml-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {(user.name || user.email || user.phone || "用").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden max-w-24 truncate sm:inline">
                    {user.name || user.email || user.phone}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {user.name || user.email || user.phone || "用户"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/account")}>
                  <UserRound />
                  账户资料
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/account/security")}>
                  <Settings />
                  安全设置
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/account/identity")}>
                  <ShieldCheck />
                  实名认证
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/orders")}>
                  <ClipboardList />
                  我的订单
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void handleLogout()} className="text-destructive">
                  <LogOut className="text-destructive" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {/* 移动端菜单按钮 */}
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* 移动端抽屉 */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-l bg-card p-4 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">{branding.siteName}</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                aria-label="关闭菜单"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive(pathname, item.href, item.exact)
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="my-3 h-px bg-border" />
            <nav className="flex flex-col gap-1">
              <MobileLink href="/orders" icon={ClipboardList} label="我的订单" />
              <MobileLink href="/credits" icon={Wallet} label="余额充值" />
              <MobileLink href="/account" icon={UserRound} label="账户资料" />
              <MobileLink href="/account/security" icon={Settings} label="安全设置" />
              <MobileLink href="/account/identity" icon={ShieldCheck} label="实名认证" />
            </nav>
            <div className="mt-auto">
              <Button variant="outline" className="w-full" onClick={() => void handleLogout()}>
                <LogOut />
                退出登录
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function MobileLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60"
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
