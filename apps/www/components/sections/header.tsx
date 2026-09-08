"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/site";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

/** 导航顺序与首页区块顺序保持一致（产品 → 定价 → 基础设施 → 解决方案 → 关于） */
const navItems: { key: string; href: string; page?: boolean }[] = [
  { key: "products", href: "#products" },
  { key: "pricing", href: "#pricing" },
  { key: "infrastructure", href: "#infrastructure" },
  { key: "solutions", href: "#solutions" },
  { key: "about", href: "/about", page: true },
];

interface HeaderProps {
  /** Portal（用户控制台）地址：由服务端布局注入；配置后主 CTA 变为「进入控制台」 */
  portalUrl?: string;
}

/** 悬浮吸顶导航：Logo + 锚点导航（非首页时跳首页对应区块）+ CTA + 语言切换 */
export function Header({ portalUrl }: HeaderProps) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  /** 锚点导航在非首页页面上没有对应区块，统一指向首页路径 + hash */
  const homePath = locale === "zh" ? "/" : "/en";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const otherLocale = locale === "zh" ? "en" : "zh";

  const primaryCta = portalUrl ? (
    <Button asChild size="sm">
      <a href={portalUrl} target="_blank" rel="noreferrer">
        {t("ctaConsole")}
      </a>
    </Button>
  ) : (
    <Button asChild size="sm">
      <a href={siteConfig.cta.start}>{t("ctaPrimary")}</a>
    </Button>
  );

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <div className="mx-auto max-w-6xl">
        {/* 悬浮胶囊：常驻半透明毛玻璃，滚动后加深并投影，与页面背景形成悬浮层次 */}
        <div
          className={cn(
            "flex h-16 items-center justify-between gap-4 rounded-xl border px-4 transition-all duration-200 sm:px-5",
            scrolled || open
              ? "border-border/70 bg-background/85 shadow-lg shadow-foreground/5 backdrop-blur-md"
              : "border-transparent bg-background/60 backdrop-blur-md"
          )}
        >
          <Link
            href="/"
            aria-label={siteConfig.brandName(locale)}
            onClick={() => setOpen(false)}
          >
            <Logo variant="horizontal" />
          </Link>

          <nav
            aria-label="主导航"
            className="hidden items-center gap-7 text-sm font-medium text-muted-foreground lg:flex"
          >
            {navItems.map((item) =>
              item.page ? (
                <Link
                  key={item.key}
                  href={item.href}
                  className="transition-colors hover:text-foreground"
                >
                  {t(item.key)}
                </Link>
              ) : (
                <Link
                  key={item.key}
                  href={`${homePath}${item.href}`}
                  className="transition-colors hover:text-foreground"
                >
                  {t(item.key)}
                </Link>
              )
            )}
          </nav>

          <div className="hidden items-center gap-2.5 lg:flex">
            <Button asChild variant="ghost" size="sm">
              <a href={siteConfig.cta.contact}>{t("ctaSecondary")}</a>
            </Button>
            {primaryCta}
            <span
              aria-hidden
              className="mx-1 h-4 w-px bg-border"
            />
            <Link
              href={pathname}
              locale={otherLocale}
              aria-label={t("langSwitchTitle")}
              title={t("langSwitchTitle")}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("langSwitch")}
            </Link>
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-foreground lg:hidden"
            aria-expanded={open}
            aria-label={open ? "关闭菜单" : "打开菜单"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* 移动端菜单：悬浮胶囊下方的下拉卡片 */}
        {open ? (
          <div className="mt-2 rounded-xl border border-border/70 bg-background/95 shadow-lg shadow-foreground/5 backdrop-blur-md lg:hidden">
            <nav
              aria-label="移动端导航"
              className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 sm:px-6"
            >
              {navItems.map((item) =>
                item.page ? (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    {t(item.key)}
                  </Link>
                ) : (
                  <Link
                    key={item.key}
                    href={`${homePath}${item.href}`}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    {t(item.key)}
                  </Link>
                )
              )}
              <div className="mt-3 flex items-center gap-2.5 border-t border-border/70 pt-4">
                <Button asChild variant="outline" className="flex-1">
                  <a href={siteConfig.cta.contact} onClick={() => setOpen(false)}>
                    {t("ctaSecondary")}
                  </a>
                </Button>
                {portalUrl ? (
                  <Button asChild className="flex-1">
                    <a
                      href={portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setOpen(false)}
                    >
                      {t("ctaConsole")}
                    </a>
                  </Button>
                ) : (
                  <Button asChild className="flex-1">
                    <a href={siteConfig.cta.start} onClick={() => setOpen(false)}>
                      {t("ctaPrimary")}
                    </a>
                  </Button>
                )}
              </div>
              <div className="px-3 pt-3">
                <Link
                  href={pathname}
                  locale={otherLocale}
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium text-muted-foreground"
                >
                  {t("langSwitch")}
                </Link>
              </div>
            </nav>
          </div>
        ) : null}
      </div>
    </header>
  );
}
