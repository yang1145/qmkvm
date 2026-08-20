import { getTranslations } from "next-intl/server";
import { Building2, Code2, Rocket } from "lucide-react";

import { SectionHeading } from "@/components/section-heading";

interface AudienceItem {
  name: string;
  desc: string;
  points: string[];
}

/** 受众图标：开发者 / 成长型团队 / 企业决策者 */
const AUDIENCE_ICONS = [Code2, Rocket, Building2] as const;

/** 服务对象：三类核心受众与关注点（PRD 4 目标用户） */
export async function Audiences() {
  const t = await getTranslations("audiences");
  const items = t.raw("items") as AudienceItem[];

  return (
    <section className="py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {items.map((item, index) => {
            const Icon = AUDIENCE_ICONS[index];
            return (
              <article
                key={item.name}
                className="flex flex-col rounded-lg border border-border bg-card p-6 transition-shadow hover:shadow-md"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mt-5 text-lg font-semibold">{item.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.desc}
                </p>
                <ul className="mt-5 space-y-2">
                  {item.points.map((point) => (
                    <li
                      key={point}
                      className="flex items-start gap-2 text-sm text-foreground/90"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
