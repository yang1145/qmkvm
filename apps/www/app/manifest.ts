import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

// 静态导出要求元数据路由显式声明为构建期静态生成
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: "高性价比、高可用、高稳定的全球云基础设施",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    icons: [
      { src: siteConfig.logo.icon, sizes: "1360x1360", type: "image/png" },
    ],
  };
}
