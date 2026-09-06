"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";

import { siteConfig } from "@/lib/site";
import { BorderBeam } from "@/components/magicui/border-beam";
import { ShimmerButton } from "@/components/magicui/shimmer-button";

/** 末尾 CTA：主“申请试用”/次“联系销售”（PRD 7.11） */
export function FinalCta() {
  const t = useTranslations("cta");

  const scrollToContact = () => {
    document.querySelector("#contact")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="pb-24 pt-4">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-lg border border-border bg-card px-6 py-16 text-center sm:px-16">
          <BorderBeam size={280} duration={16} />
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            {t("subtitle")}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <ShimmerButton onClick={scrollToContact} className="h-12 px-8">
              {t("primary")}
              <ArrowRight className="h-4 w-4" />
            </ShimmerButton>
            <a
              href={siteConfig.cta.contact}
              className="inline-flex h-12 items-center rounded-lg border border-border bg-card px-6 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
            >
              {t("secondary")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
