import { getTranslations } from "next-intl/server";
import { ArrowRight, Check } from "lucide-react";

import { siteConfig } from "@/lib/site";
import { SectionHeading } from "@/components/section-heading";

interface ProductItem {
  name: string;
  desc: string;
  points: string[];
}

/** 核心产品能力：最多 4 项，避免产品目录（PRD 7.4） */
export async function Products() {
  const t = await getTranslations("products");
  const items = t.raw("items") as ProductItem[];

  return (
    <section id="products" className="scroll-mt-20 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {items.map((item) => (
            <article
              key={item.name}
              className="group flex flex-col rounded-lg border border-border bg-card p-6 transition-shadow hover:shadow-md"
            >
              <h3 className="text-lg font-semibold">{item.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.desc}
              </p>
              <ul className="mt-4 flex-1 space-y-2">
                {item.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2 text-sm text-foreground/90"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {point}
                  </li>
                ))}
              </ul>
              <a
                href={siteConfig.cta.contact}
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                {t("more")}
                <ArrowRight className="h-4 w-4" />
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
