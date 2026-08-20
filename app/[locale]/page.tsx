import { setRequestLocale } from "next-intl/server";

import { siteConfig } from "@/lib/site";
import { Hero } from "@/components/sections/hero";
import { TrustBar } from "@/components/sections/trust-bar";
import { Products } from "@/components/sections/products";
import { Differentiation } from "@/components/sections/differentiation";
import { Infrastructure } from "@/components/sections/infrastructure";
import { Solutions } from "@/components/sections/solutions";
import { Developer } from "@/components/sections/developer";
import { Faq } from "@/components/sections/faq";
import { Contact } from "@/components/sections/contact";
import { FinalCta } from "@/components/sections/final-cta";

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
      <Products />
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
