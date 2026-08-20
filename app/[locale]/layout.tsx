import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { routing, type Locale } from "@/i18n/routing";
import { siteConfig } from "@/lib/site";
import { Header } from "@/components/sections/header";
import { Footer } from "@/components/sections/footer";
import "@/app/globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    metadataBase: new URL(siteConfig.domain),
    title: {
      default: t("title"),
      template: `%s · ${siteConfig.nameEn}`,
    },
    description: t("description"),
    applicationName: siteConfig.nameEn,
    icons: {
      icon: "/logo.png",
      apple: "/logo.png",
    },
    openGraph: {
      type: "website",
      url: locale === "zh" ? "/" : "/en",
      siteName: siteConfig.nameEn,
      title: t("title"),
      description: t("description"),
      images: [{ url: siteConfig.ogImage, width: 1200, height: 630 }],
      locale: locale === "zh" ? "zh_CN" : "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: [siteConfig.ogImage],
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        <NextIntlClientProvider messages={messages}>
          <Header />
          <main>{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
