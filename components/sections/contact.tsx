import { getTranslations } from "next-intl/server";
import { Clock, Headset, Languages, Mail } from "lucide-react";

import { siteConfig } from "@/lib/site";
import { ContactForm } from "@/components/sections/contact-form";

/** 联系销售区块：左侧联系方式展示，右侧表单（锚点 #contact） */
export async function Contact() {
  const t = await getTranslations("contactInfo");
  const email = siteConfig.contact.email;

  const items = [
    {
      icon: Mail,
      label: t("email"),
      value: email,
      href: `mailto:${email}`,
    },
    { icon: Clock, label: t("response"), value: t("responseValue") },
    { icon: Headset, label: t("support"), value: t("supportValue") },
    { icon: Languages, label: t("lang"), value: t("langValue") },
  ];

  return (
    <section id="contact" className="scroll-mt-20 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          {/* 左侧：联系方式展示 */}
          <div className="flex flex-col justify-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("title")}
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
              {t("desc")}
            </p>

            <ul className="mt-10 space-y-5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.label} className="flex items-start gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </span>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {item.label}
                      </p>
                      {item.href ? (
                        <a
                          href={item.href}
                          className="mt-0.5 text-base font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {item.value}
                        </a>
                      ) : (
                        <p className="mt-0.5 text-base font-medium text-foreground">
                          {item.value}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 右侧：联系表单 */}
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
