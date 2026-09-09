import { promises as fs } from "fs";
import path from "path";
import ReactMarkdown from "react-markdown";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/** 隐私政策 SEO：canonical 指向自身路径，hreflang 区分中英版本（PRD 11） */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return {
    alternates: {
      canonical: locale === "zh" ? "/zh/privacy/" : "/en/privacy/",
      languages: {
        "zh-CN": "/zh/privacy/",
        "en-US": "/en/privacy/",
      },
    },
  };
}

/** 隐私政策：内容由 content/legal/privacy.{locale}.md 驱动 */
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal");

  const lang = locale === "zh" ? "zh" : "en";
  const file = path.join(process.cwd(), "content/legal", `privacy.${lang}.md`);
  const content = await fs.readFile(file, "utf-8");

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-28 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("privacyTitle")}
      </h1>
      <div className="md-content mt-8">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
      <Button asChild variant="outline" className="mt-10">
        <Link href="/">{t("backHome")}</Link>
      </Button>
    </div>
  );
}
