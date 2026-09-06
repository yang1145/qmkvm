import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { ArrowRight, Check } from "lucide-react";

import { siteConfig } from "@/lib/site";
import { SectionHeading } from "@/components/section-heading";

interface ProductItem {
  name: string;
  desc: string;
  points: string[];
}

/** 产品图标素材：云服务器 / 裸金属 / 对象存储 */
const PRODUCT_ICONS = [
  "/icon-cloud-server.webp",
  "/icon-baremetal.webp",
  "/icon-object-storage.webp",
] as const;

/** 核心产品能力：无框卡片、三项分立居中展示（PRD 7.4） */
export async function Products() {
  const t = await getTranslations("products");
  const items = t.raw("items") as ProductItem[];

  return (
    <section id="products" className="scroll-mt-20 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />

        <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
          {items.map((item, index) => (
            <article
              key={item.name}
              className="flex flex-col items-center text-center"
            >
              <Image
                src={PRODUCT_ICONS[index]}
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
