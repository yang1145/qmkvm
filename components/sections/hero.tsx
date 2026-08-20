"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";

import { siteConfig } from "@/lib/site";
import { cn } from "@/lib/utils";
import { TextAnimate } from "@/components/magicui/text-animate";
import { BorderBeam } from "@/components/magicui/border-beam";
import { DotPattern } from "@/components/magicui/dot-pattern";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { Badge } from "@/components/ui/badge";

/** 首屏背景氛围图（低透明度，非产品证明） */
const HERO_BG =
  "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=very%20light%20minimal%20abstract%20cloud%20computing%20background%2C%20soft%20blue%20gradient%20with%20faint%20network%20grid%20and%20small%20glowing%20nodes%2C%20high%20key%2C%20clean%2C%20airy%2C%20no%20text&image_size=landscape_16_9";

/** Hero 首屏：品牌 + 价值主张 + 主次 CTA + 控制台预览示意（PRD 7.2） */
export function Hero() {
  const t = useTranslations("hero");
  const points = t.raw("points") as string[];

  const rows = [
    {
      label: t("visualInstance"),
      value: t("visualStatusRunning"),
      dot: "bg-emerald-500",
    },
    { label: t("visualRegion"), value: "Singapore", dot: "bg-primary" },
    { label: t("visualSpec"), value: "4C8G · 100GB", dot: "bg-primary" },
    { label: t("visualUptime"), value: "99.9%", dot: "bg-primary" },
  ];

  const scrollToContact = () => {
    document.querySelector("#contact")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="relative overflow-hidden pb-20 pt-32 lg:pb-28 lg:pt-40">
      {/* 背景：低透明度氛围图 + 渐变过渡 + 点阵 */}
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <Image
          src={HERO_BG}
          alt=""
          fill
          priority
          unoptimized
          className="object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/50 to-background" />
      </div>
      <DotPattern className="-z-10 opacity-40 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000,transparent)]" />

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <Badge variant="soft">{t("badge")}</Badge>
          <h1 className="mt-5 text-4xl font-bold leading-[1.15] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            <TextAnimate
              as="span"
              by="character"
              type="slideUp"
              duration={0.35}
              delay={0.1}
            >
              {t("title")}
            </TextAnimate>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t("subtitle")}
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ShimmerButton onClick={scrollToContact} className="h-12 px-7">
              {t("ctaPrimary")}
              <ArrowRight className="h-4 w-4" />
            </ShimmerButton>
            <a
              href={siteConfig.cta.contact}
              className="inline-flex h-12 items-center rounded-lg border border-border bg-card/80 px-6 text-sm font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent"
            >
              {t("ctaSecondary")}
            </a>
          </div>

          <ul className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-sm text-muted-foreground">
            {points.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* 控制台预览示意（PRD 7.2：真实控制台原型代替图库） */}
        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="relative overflow-hidden rounded-lg border border-border bg-card/85 shadow-xl shadow-primary/5 backdrop-blur">
            <BorderBeam size={220} duration={14} />
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[hsl(0_72%_55%)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[hsl(45_90%_55%)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="ml-3 flex-1 truncate rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground">
                {t("visualTitle")}
              </span>
            </div>
            <div className="space-y-2 p-5">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-md border border-border/60 bg-card/70 px-4 py-3"
                >
                  <span className="text-sm text-muted-foreground">
                    {row.label}
                  </span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span className={cn("h-1.5 w-1.5 rounded-full", row.dot)} />
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-border/70 px-5 py-3.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>pinhaoji1.cn</span>
                <span className="text-emerald-600">●</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
