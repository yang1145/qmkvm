import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 纯前端静态导出（SSG）：产物 out/，可由 nginx / 各 pages 平台直接托管
  output: "export",
  // 静态托管通用兼容：目录式 index.html（/zh/about/ → zh/about/index.html）
  trailingSlash: true,
  images: {
    // 静态导出不支持图片优化服务，全部未优化直出
    unoptimized: true,
    // 远程图未优化直出（EdgeOne Makers 静态托管兼容）
    remotePatterns: [
      { protocol: "https", hostname: "trae-api-cn.mchost.guru" },
    ],
  },
};

export default withNextIntl(nextConfig);
