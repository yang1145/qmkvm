import { getTranslations } from "next-intl/server";
import { Check } from "lucide-react";

import { SectionHeading } from "@/components/section-heading";

interface SolutionItem {
  name: string;
  desc: string;
  points: string[];
}

/** 解决方案 / 使用场景：3 个高价值场景（PRD 7.7） */
export async function Solutions() {
  const t = await getTranslations("solutions");
  const items = t.raw("items") as SolutionItem[];

  return (
    <section id="solutions" className="scroll-mt-20 bg-card/40 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.name}
              className="flex flex-col rounded-lg border border-border bg-card p-6 transition-shadow hover:shadow-md"
            >
              <h3 className="text-lg font-semibold">{item.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.desc}
              </p>
              <ul className="mt-5 flex-1 space-y-2">
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
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
