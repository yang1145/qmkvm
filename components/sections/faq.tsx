import { getTranslations } from "next-intl/server";

import { SectionHeading } from "@/components/section-heading";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface FaqItem {
  q: string;
  a: string;
}

/** FAQ：5-7 问，覆盖试用/计费/迁移/支持/数据/SLA（PRD 7.10） */
export async function Faq() {
  const t = await getTranslations("faq");
  const items = t.raw("items") as FaqItem[];

  return (
    <section className="py-20 lg:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading title={t("title")} />

        <Accordion type="single" collapsible className="mt-10">
          {items.map((item, index) => (
            <AccordionItem key={item.q} value={`item-${index}`}>
              <AccordionTrigger className="text-base font-medium">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="leading-relaxed">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
