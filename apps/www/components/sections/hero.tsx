"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { Badge } from "@/components/ui/badge";

/** banner 图：左边留白放文字、右边为图形（PRD 7.2 首屏） */
const BANNERS = [
  "/banner-1.webp",
  "/banner-2.webp",
  "/banner-3.webp",
] as const;

const AUTO_PLAY_INTERVAL = 5000;

interface SlideText {
  badge: string;
  title: string;
  subtitle: string;
  ctaPrimary: string;
  ctaPrimaryHref: string;
  ctaSecondary: string;
  ctaSecondaryHref: string;
  points: string[];
}

/** Hero 首屏：三张 banner 自动轮播，文案与 CTA 随图切换（PRD 7.2）
 *
 * 自动轮播始终运行：减少动效（prefers-reduced-motion）时由全局 CSS
 * 把过渡压到瞬时（globals.css），内容照常切换，只是不做淡入淡出。
 * 悬停/聚焦暂停；手动切换后重新计时，避免刚点完立刻被自动切走。
 */
export function Hero() {
  const t = useTranslations("hero");
  const slides = t.raw("slides") as SlideText[];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const goTo = useCallback(
    (next: number) => {
      setIndex(((next % slides.length) + slides.length) % slides.length);
    },
    [slides.length]
  );

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % slides.length);
    }, AUTO_PLAY_INTERVAL);
    return () => clearInterval(timer);
  }, [slides.length, index, paused]);

  return (
    <section
      aria-label={t("carousel.label")}
      aria-roledescription="carousel"
      className="relative overflow-hidden border-b border-border/60"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* 轮播主体：固定高度容器，各 slide 绝对定位淡入淡出 */}
      <div className="relative h-[560px] sm:h-[620px] lg:h-[680px]">
        {slides.map((slide, i) => (
          <div
            key={i}
            aria-roledescription="slide"
            aria-hidden={i !== index}
            className={cn(
              "absolute inset-0 transition-opacity duration-700",
              i === index ? "z-10 opacity-100" : "z-0 opacity-0"
            )}
          >
            <Image
              src={BANNERS[i]}
              alt=""
              fill
              priority={i === 0}
              unoptimized
              className="object-cover object-center"
            />
            {/* 左侧文字可读性遮罩 */}
            <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/45 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-background/30" />
          </div>
        ))}

        {/* 文案层：随当前 slide 切换 */}
        {slides.map((slide, i) => (
          <div
            key={i}
            aria-hidden={i !== index}
            className={cn(
              "absolute inset-0 flex items-center transition-opacity duration-700",
              i === index ? "z-20 opacity-100" : "z-0 opacity-0 pointer-events-none"
            )}
          >
            <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
              <div className="max-w-2xl">
                <Badge variant="soft">{slide.badge}</Badge>
                <h1 className="mt-5 text-4xl font-bold leading-[1.15] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                  {slide.title}
                </h1>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                  {slide.subtitle}
                </p>

                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <a href={slide.ctaPrimaryHref}>
                    <ShimmerButton className="h-12 px-7">
                      {slide.ctaPrimary}
                      <ArrowRight className="h-4 w-4" />
                    </ShimmerButton>
                  </a>
                  <a
                    href={slide.ctaSecondaryHref}
                    className="inline-flex h-12 items-center rounded-lg border border-border bg-card/80 px-6 text-sm font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent"
                  >
                    {slide.ctaSecondary}
                  </a>
                </div>

                <ul className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-sm text-muted-foreground">
                  {slide.points.map((point) => (
                    <li key={point} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}

        {/* 指示点：固定尺寸按钮保证热区稳定（28px），内部圆点随激活变宽 */}
        <div className="absolute inset-x-0 bottom-6 z-30 flex justify-center gap-1">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={t("carousel.goToSlide", { index: i + 1 })}
              aria-current={i === index}
              onClick={() => goTo(i)}
              className="flex h-7 w-7 items-center justify-center"
            >
              <span
                className={cn(
                  "h-2 rounded-full transition-all duration-300",
                  i === index
                    ? "w-7 bg-primary"
                    : "w-2 bg-foreground/30 hover:bg-foreground/50"
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
