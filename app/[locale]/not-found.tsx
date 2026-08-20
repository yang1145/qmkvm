"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const t = useTranslations("notfound");

  return (
    <section className="flex min-h-[70dvh] items-center justify-center px-4">
      <div className="text-center">
        <p className="text-6xl font-bold tracking-tight text-primary">
          {t("code")}
        </p>
        <h1 className="mt-4 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("desc")}</p>
        <Button asChild className="mt-8">
          <Link href="/">{t("backHome")}</Link>
        </Button>
      </div>
    </section>
  );
}
