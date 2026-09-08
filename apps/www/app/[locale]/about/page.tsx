import { getTranslations, setRequestLocale } from "next-intl/server";
import Image from "next/image";
import { Globe, Headset, ReceiptText, ShieldCheck } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { siteConfig } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Principle {
  name: string;
  desc: string;
}

interface ArchitectureLayer {
  name: string;
  desc: string;
}

/** 服务原则图标：成本透明 / 可靠优先 / 全球网络 / 持续支持 */
const PRINCIPLE_ICONS = [ReceiptText, ShieldCheck, Globe, Headset] as const;

/** 关于我们 SEO：canonical 指向自身路径，hreflang 区分中英版本（PRD 11） */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return {
    alternates: {
      canonical: locale === "zh" ? "/about" : "/en/about",
      languages: {
        "zh-CN": "/about",
        "en-US": "/en/about",
      },
    },
  };
}

/** 关于我们：品牌介绍、出发点与服务原则（落地页品牌信任页） */
export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");
  const brand = siteConfig.brandName(locale);
  const principles = t.raw("principles") as Principle[];
  const layers = t.raw("architectureLayers") as ArchitectureLayer[];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-28 sm:px-6">
      {/* 页头 */}
      <div className="max-w-3xl">
        <Badge variant="soft">{t("badge")}</Badge>
        <h1 className="mt-5 text-4xl font-bold leading-[1.15] tracking-tight sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {t("intro", { brand })}
        </p>
      </div>

      {/* 品牌故事 */}
      <div className="mt-20 max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("storyTitle")}
        </h2>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {t("story", { brand })}
        </p>
      </div>

      {/* 平台架构：左侧文字 + 右侧小图 */}
      <div className="mt-20 grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("architectureTitle")}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            {t("architectureDesc", { brand })}
          </p>
          <ul className="mt-8 space-y-5">
            {layers.map((layer, index) => (
              <li key={layer.name} className="flex items-start gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-base font-semibold">{layer.name}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {layer.desc}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Image
            src="/about-architecture.webp"
            alt={t("architectureTitle")}
            width={2744}
            height={1829}
            className="h-auto w-full object-contain"
          />
        </div>
      </div>

      {/* 服务原则 */}
      <div className="mt-20">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("principlesTitle")}
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {principles.map((principle, index) => {
            const Icon = PRINCIPLE_ICONS[index];
            return (
              <div
                key={principle.name}
                className="rounded-lg border border-border bg-card p-6"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mt-5 text-base font-semibold">
                  {principle.name}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {principle.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-20 rounded-lg border border-border bg-card px-6 py-14 text-center sm:px-16">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("ctaTitle")}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          {t("ctaDesc")}
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/contact">{t("ctaPrimary")}</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/contact">{t("ctaSecondary")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
