import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { siteConfig } from "@/lib/site";
import { Logo } from "@/components/logo";
import { Separator } from "@/components/ui/separator";

interface FooterItem {
  label: string;
  href?: string;
  external?: boolean;
}

/** 页脚：产品 / 资源 / 公司 / 法律链接分组 + 品牌与版权信息（PRD 7.12） */
export async function Footer() {
  const t = await getTranslations("footer");
  const year = new Date().getFullYear();

  const products = t.raw("products") as string[];
  const resources = t.raw("resources") as string[];
  const company = t.raw("company") as string[];
  const legal = t.raw("legal") as string[];

  const contactItem = resources[2] ?? "联系我们";

  const groups: { title: string; items: FooterItem[] }[] = [
    {
      title: t("productTitle"),
      // 产品详情页尚未上线，暂渲染为纯文本，避免死链（PRD 9.2）
      items: products.map((label) => ({ label })),
    },
    {
      title: t("resourceTitle"),
      items: resources.map((label, i) =>
        i === 2
          ? { label, href: `mailto:${siteConfig.contact.email}`, external: true }
          : { label }
      ),
    },
    {
      title: t("companyTitle"),
      items: company.map((label) => ({ label })),
    },
  ];

  return (
    <footer className="border-t border-border/70 bg-card/60">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <Link href="/" aria-label={siteConfig.name}>
              <Logo />
            </Link>
            <p className="mt-4 text-sm text-muted-foreground">{t("slogan")}</p>
          </div>

          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <ul className="mt-4 space-y-3">
                {group.items.map((item) => (
                  <li key={item.label}>
                    {item.href ? (
                      <a
                        href={item.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {item.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="text-sm font-semibold">{t("legalTitle")}</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link
                  href={t("privacyHref")}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {legal[0]}
                </Link>
              </li>
              <li>
                <Link
                  href={t("termsHref")}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {legal[1]}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{t("copyright", { year })}</p>
          <span>
            {contactItem} ·{" "}
            <a
              href={`mailto:${siteConfig.contact.email}`}
              className="transition-colors hover:text-foreground"
            >
              {siteConfig.contact.email}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
