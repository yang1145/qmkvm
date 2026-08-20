import { defineRouting } from "next-intl/routing";

/** 国际化路由配置：zh 为默认语言，URL 不加前缀；en 使用 /en 前缀（PRD 9.3） */
export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
