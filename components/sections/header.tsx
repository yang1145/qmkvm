"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/site";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const navItems = [
  { key: "products", href: "#products" },
  { key: "solutions", href: "#solutions" },
  { key: "infrastructure", href: "#infrastructure" },
  { key: "pricing", href: "#contact" },
] as const;

/** 顶部导航：Logo + 锚点导航 + 语言切换 + CTA，移动端抽屉菜单 */
export function Header() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

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

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-200",
        scrolled || open
          ? "border-b border-border/70 bg-background/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="拼好机" onClick={() => setOpen(false)}>
          <Logo />
        </Link>

        <nav
          aria-label="主导航"
          className="hidden items-center gap-7 text-sm font-medium text-muted-foreground lg:flex"
        >
          {navItems.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className="transition-colors hover:text-foreground"
            >
              {t(item.key)}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 lg:flex">
          <Link
            href={pathname}
            locale={otherLocale}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("langSwitch")}
          </Link>
          <Button asChild variant="ghost" size="sm">
            <a href={siteConfig.cta.contact}>{t("ctaSecondary")}</a>
          </Button>
          <Button asChild size="sm">
            <a href={siteConfig.cta.start}>{t("ctaPrimary")}</a>
          </Button>
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

      {/* 移动端菜单 */}
      {open ? (
        <div className="border-t border-border/70 bg-background/95 backdrop-blur-md lg:hidden">
          <nav
            aria-label="移动端导航"
            className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 sm:px-6"
          >
            {navItems.map((item) => (
              <a
                key={item.key}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                {t(item.key)}
              </a>
            ))}
            <div className="mt-3 flex items-center gap-2.5 border-t border-border/70 pt-4">
              <Button asChild variant="outline" className="flex-1">
                <a href={siteConfig.cta.contact} onClick={() => setOpen(false)}>
                  {t("ctaSecondary")}
                </a>
              </Button>
              <Button asChild className="flex-1">
                <a href={siteConfig.cta.start} onClick={() => setOpen(false)}>
                  {t("ctaPrimary")}
                </a>
              </Button>
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
    </header>
  );
}
