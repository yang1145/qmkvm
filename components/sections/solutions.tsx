import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { Check } from "lucide-react";

import { SectionHeading } from "@/components/section-heading";

interface SolutionItem {
  name: string;
  desc: string;
  points: string[];
}

/** 场景图标素材：智能建站 / 多媒体服务 / 归档备份 */
const SOLUTION_ICONS = [
  "/icon-website.webp",
  "/icon-media.webp",
  "/icon-backup.webp",
] as const;

/** 解决方案 / 使用场景：3 个高价值场景（PRD 7.7） */
export async function Solutions() {
  const t = await getTranslations("solutions");
  const items = t.raw("items") as SolutionItem[];

  return (
    <section id="solutions" className="scroll-mt-20 bg-card/40 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />

        <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
          {items.map((item, index) => (
            <article
              key={item.name}
              className="flex flex-col items-center text-center"
            >
              <Image
                src={SOLUTION_ICONS[index]}
                alt=""
                width={128}
                height={128}
                className="h-32 w-32"
              />
              <h3 className="mt-8 text-lg font-semibold">{item.name}</h3>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                {item.desc}
              </p>
              <ul className="mt-5 flex-1 space-y-2">
                {item.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-center justify-center gap-2 text-sm text-foreground/90"
                  >
                    <Check className="h-4 w-4 shrink-0 text-primary" />
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
