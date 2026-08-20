import { getTranslations } from "next-intl/server";

import { SectionHeading } from "@/components/section-heading";

interface DiffItem {
  name: string;
  desc: string;
  metric: string;
  metricValue: string;
}

/** 平台差异化：3 个可证明差异点，指标优先（PRD 7.5） */
export async function Differentiation() {
  const t = await getTranslations("diff");
  const items = t.raw("items") as DiffItem[];

  return (
    <section className="py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.name}
              className="flex flex-col rounded-lg border border-border bg-card p-6"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {item.metric}
              </p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight text-primary">
                {item.metricValue}
              </p>
              <h3 className="mt-5 text-lg font-semibold">{item.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.desc}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
