import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

// 静态导出要求元数据路由显式声明为构建期静态生成
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.domain;
  const now = new Date();

  return [
    // 根路径 / 是语言协商页（跳转），不进 sitemap；直接列出两语言实体页
    { url: `${base}/zh/`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/en/`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/zh/privacy/`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/en/privacy/`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/zh/terms/`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/en/terms/`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
