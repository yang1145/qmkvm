import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // EdgeOne Makers 静态托管兼容：远程图使用未优化直出，本地资源默认走 next/image
    remotePatterns: [
      { protocol: "https", hostname: "trae-api-cn.mchost.guru" },
    ],
  },
};

export default withNextIntl(nextConfig);
