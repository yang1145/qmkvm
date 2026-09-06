import { setRequestLocale } from "next-intl/server";

import { Contact } from "@/components/sections/contact";

/** 联系我们 SEO：canonical 指向自身路径，hreflang 区分中英版本（PRD 11） */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return {
    alternates: {
      canonical: locale === "zh" ? "/contact" : "/en/contact",
      languages: {
        "zh-CN": "/contact",
        "en-US": "/en/contact",
      },
    },
  };
}

/** 联系我们独立页：复用联系方式展示 + 销售表单 */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <Contact />;
}
