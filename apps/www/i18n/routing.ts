import { defineRouting } from "next-intl/routing";

/** 国际化路由配置：静态导出无 middleware 做默认语言前缀协商，
 *  两语言 URL 均带前缀（/zh /en），根路径由 out/index.html 语言协商页分发（PRD 9.3） */
export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
