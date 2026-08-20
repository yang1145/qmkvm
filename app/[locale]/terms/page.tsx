import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal");

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-28 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("termsTitle")}
      </h1>
      <p className="mt-8 rounded-lg border border-dashed border-border bg-card/60 p-8 text-sm leading-relaxed text-muted-foreground">
        {t("placeholder")}
      </p>
      <Button asChild variant="outline" className="mt-8">
        <Link href="/">{t("backHome")}</Link>
      </Button>
    </div>
  );
}
