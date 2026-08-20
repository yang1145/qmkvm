import { setRequestLocale } from "next-intl/server";

import { siteConfig } from "@/lib/site";
import { Hero } from "@/components/sections/hero";
import { TrustBar } from "@/components/sections/trust-bar";
import { Audiences } from "@/components/sections/audiences";
import { Products } from "@/components/sections/products";
import { Pricing } from "@/components/sections/pricing";
import { Differentiation } from "@/components/sections/differentiation";
import { Infrastructure } from "@/components/sections/infrastructure";
import { Solutions } from "@/components/sections/solutions";
import { Developer } from "@/components/sections/developer";
import { Faq } from "@/components/sections/faq";
import { Contact } from "@/components/sections/contact";
import { FinalCta } from "@/components/sections/final-cta";

/** 首页 SEO：canonical 自引用，hreflang 指向中英首页（PRD 11） */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return {
    alternates: {
      canonical: locale === "zh" ? "/" : "/en",
      languages: {
        "x-default": "/",
        "zh-CN": "/",
        "en-US": "/en",
      },
    },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // 结构化数据：Organization / WebSite（PRD 11，不伪造评分或评价）
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "拼好机",
    alternateName: siteConfig.nameEn,
    url: `${siteConfig.domain}/`,
    logo: `${siteConfig.domain}/logo.png`,
    contactPoint: {
      "@type": "ContactPoint",
      email: siteConfig.contact.email,
      contactType: "sales",
    },
  };

  return (
    <>
      <Hero />
      <TrustBar />
      <Audiences />
      <Products />
      <Pricing />
      <Differentiation />
      <Infrastructure />
      <Solutions />
      <Developer />
      <Faq />
      <Contact />
      <FinalCta />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
    </>
  );
}
