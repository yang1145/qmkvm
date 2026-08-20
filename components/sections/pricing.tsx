import { getLocale, getTranslations } from "next-intl/server";
import { Check } from "lucide-react";

import pricingData from "@/content/pricing.json";
import { siteConfig } from "@/lib/site";
import { SectionHeading } from "@/components/section-heading";

interface LocalizedText {
  zh: string;
  en: string;
}

interface PricingPlan {
  id: string;
  featured: boolean;
  /** 购买跳转链接：留空回退到联系销售锚点，避免死链（PRD 9.2） */
  buyUrl?: string;
  name: LocalizedText;
  tagline: LocalizedText;
  price: LocalizedText;
  specs: { zh: string[]; en: string[] };
  features: { zh: string[]; en: string[] };
}

/** 云服务器定价：套餐数据由 content/pricing.json 驱动（PRD 9.2 CTA 配置管理） */
export async function Pricing() {
  const locale = await getLocale();
  const t = await getTranslations("pricing");
  const plans = (pricingData as { plans: PricingPlan[] }).plans;
  const lang = locale === "zh" ? "zh" : "en";

  return (
    <section id="pricing" className="scroll-mt-20 bg-card/40 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className={
                plan.featured
                  ? "relative flex flex-col rounded-lg border border-primary bg-card p-6 shadow-md"
                  : "relative flex flex-col rounded-lg border border-border bg-card p-6"
              }
            >
              {plan.featured ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  {t("popular")}
                </span>
              ) : null}

              <h3 className="text-lg font-semibold">{plan.name[lang]}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {plan.tagline[lang]}
              </p>
              <p className="mt-5 text-2xl font-semibold tracking-tight text-primary">
                {plan.price[lang]}
              </p>

              <ul className="mt-5 space-y-2 border-t border-border/70 pt-5">
                {plan.specs[lang].map((spec) => (
                  <li
                    key={spec}
                    className="flex items-start gap-2 text-sm text-foreground/90"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {spec}
                  </li>
                ))}
              </ul>

              <ul className="mt-4 flex-1 space-y-2">
                {plan.features[lang].map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href={plan.buyUrl || siteConfig.cta.contact}
                {...(plan.buyUrl?.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className={
                  plan.featured
                    ? "mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    : "mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
                }
              >
                {t("cta")}
              </a>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          {t("note")}
        </p>
      </div>
    </section>
  );
}
