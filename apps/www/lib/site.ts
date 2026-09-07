/**
 * 站点级配置（PRD 9.2：CTA 与外部链接通过配置管理）
 * 未配置的入口不得渲染为可点击死链 —— 对应组件需按 undefined 判断隐藏。
 *
 * 域名不硬编码：通过 NEXT_PUBLIC_SITE_URL 注入（缺省 https://example.com）。
 */
export const siteConfig = {
  name: "启明智联",
  nameEn: "QmKvm",
  domain: (process.env.NEXT_PUBLIC_SITE_URL as string | undefined) ?? "https://example.com",
  /** 1200×630 分享图（Open Graph） */
  ogImage:
    "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=minimal%20light%20blue%20cloud%20computing%20brand%20banner%2C%20soft%20network%20grid%20and%20nodes%2C%20clean%2C%20high%20key%2C%20no%20text&image_size=landscape_16_9",
  /** 主 CTA 目标：首版无自助注册流程，统一指向联系表单 */
  cta: {
    start: "#contact",
    contact: "#contact",
  },
  links: {
    // 控制台/门户地址：由部署环境变量注入（NEXT_PUBLIC_PORTAL_URL），
    // 未配置时不渲染入口（PRD 9.2：未配置的入口不得渲染为可点击死链）
    console: (process.env.NEXT_PUBLIC_PORTAL_URL as string | undefined) ?? undefined,
    docs: undefined as string | undefined,
    status: undefined as string | undefined,
  },
  contact: {
    email: "sales@example.com", // TODO: 待业务方确认（示例占位，部署时替换）
  },
} as const;
