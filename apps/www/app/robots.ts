import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

// 静态导出要求元数据路由显式声明为构建期静态生成
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // 静态导出无内置 API 路由，此条仅防御历史收录
        disallow: ["/api/"],
      },
    ],
    sitemap: `${siteConfig.domain}/sitemap.xml`,
  };
}
