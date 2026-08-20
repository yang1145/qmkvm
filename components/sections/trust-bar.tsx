import { getTranslations } from "next-intl/server";

interface TrustItem {
  label: string;
  note: string;
}

/** 信任与事实条：可核验事实或“待核验”占位，不展示虚构数字（PRD 7.3） */
export async function TrustBar() {
  const t = await getTranslations("trust");
  const items = t.raw("items") as TrustItem[];

  return (
    <section
      aria-label={t("title")}
      className="border-y border-border/60 bg-card/50"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-border/60 px-4 sm:grid-cols-2 sm:divide-y-0 sm:px-6 lg:grid-cols-4 lg:divide-x">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-1 py-6 lg:px-6 lg:first:pl-0 lg:last:pr-0">
            <span className="text-base font-semibold">{item.label}</span>
            <span className="text-sm text-muted-foreground">{item.note}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
