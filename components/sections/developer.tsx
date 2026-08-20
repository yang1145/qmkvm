import { getTranslations } from "next-intl/server";

import { SectionHeading } from "@/components/section-heading";

interface StepItem {
  title: string;
  desc: string;
}

/** 开发者体验：控制台工作流，不展示不可用伪代码接口（PRD 7.8） */
export async function Developer() {
  const t = await getTranslations("developer");
  const steps = t.raw("steps") as StepItem[];

  return (
    <section className="py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />

        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-6">
          {steps.map((step, index) => (
            <li key={step.title} className="relative">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <h3 className="text-lg font-semibold">{step.title}</h3>
              </div>
              <p className="mt-3 pl-12 text-sm leading-relaxed text-muted-foreground">
                {step.desc}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
