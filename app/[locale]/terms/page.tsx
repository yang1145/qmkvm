import { promises as fs } from "fs";
import path from "path";
import ReactMarkdown from "react-markdown";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/** 服务条款 SEO：canonical 指向自身路径，hreflang 区分中英版本（PRD 11） */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return {
    alternates: {
      canonical: locale === "zh" ? "/terms" : "/en/terms",
      languages: {
        "zh-CN": "/terms",
        "en-US": "/en/terms",
      },
    },
  };
}

/** 服务条款：内容由 content/legal/terms.{locale}.md 驱动 */
export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal");

  const lang = locale === "zh" ? "zh" : "en";
  const file = path.join(process.cwd(), "content/legal", `terms.${lang}.md`);
  const content = await fs.readFile(file, "utf-8");

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-28 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("termsTitle")}
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
