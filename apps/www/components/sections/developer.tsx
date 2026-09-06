import { getTranslations } from "next-intl/server";
import { BarChart3, Rocket, Zap } from "lucide-react";

import { SectionHeading } from "@/components/section-heading";

interface StepItem {
  title: string;
  desc: string;
}

/** 工作流步骤图标：创建资源 / 部署上线 / 监控与运维 */
const STEP_ICONS = [Zap, Rocket, BarChart3] as const;

/** 开发者体验：控制台工作流，不展示不可用伪代码接口（PRD 7.8） */
export async function Developer() {
  const t = await getTranslations("developer");
  const steps = t.raw("steps") as StepItem[];

  return (
    <section className="py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />

        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-6">
          {steps.map((step, index) => {
            const Icon = STEP_ICONS[index];
            return (
              <li key={step.title} className="relative">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {index + 1}
                    </span>
                  </span>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {step.desc}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
