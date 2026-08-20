import { getTranslations } from "next-intl/server";

import { Spotlight } from "@/components/aceternity/spotlight";
import { DotPattern } from "@/components/magicui/dot-pattern";

interface Capability {
  name: string;
  desc: string;
}

/** 基础设施与覆盖：深色技术展示区，区域列表标注“即将上线”（PRD 7.6） */
export async function Infrastructure() {
  const t = await getTranslations("infra");
  const regions = t.raw("regions") as string[];
  const capabilities = t.raw("capabilities") as Capability[];

  return (
    <section
      id="infrastructure"
      className="relative scroll-mt-20 overflow-hidden bg-[hsl(224_45%_7%)] py-20 text-white lg:py-28"
    >
      <Spotlight className="-top-48 left-0 h-[80%] w-[60%] opacity-80" />
      <DotPattern
        className="opacity-[0.1] text-white [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,#000,transparent)]"
      />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/65">
            {t("subtitle")}
          </p>
        </div>

        {/* 区域列表（规划方向，标注即将上线） */}
        <ul className="mt-12 flex flex-wrap justify-center gap-3">
          {regions.map((region) => (
            <li
              key={region}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/85"
            >
              {region}
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white/60">
                {t("regionNote")}
              </span>
            </li>
          ))}
        </ul>

        {/* 基础设施能力 */}
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {capabilities.map((capability) => (
            <div
              key={capability.name}
              className="rounded-lg border border-white/10 bg-white/[0.04] p-6"
            >
              <h3 className="text-base font-semibold">{capability.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                {capability.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
