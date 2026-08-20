/**
 * 站点级配置（PRD 9.2：CTA 与外部链接通过配置管理）
 * 未配置的入口不得渲染为可点击死链 —— 对应组件需按 undefined 判断隐藏。
 */
export const siteConfig = {
  name: "拼好机",
  nameEn: "Pinhaoji Cloud",
  domain: "https://pinhaoji1.cn",
  /** 1200×630 分享图（Open Graph） */
  ogImage:
    "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=minimal%20light%20blue%20cloud%20computing%20brand%20banner%2C%20soft%20network%20grid%20and%20nodes%2C%20clean%2C%20high%20key%2C%20no%20text&image_size=landscape_16_9",
  /** 主 CTA 目标：首版无自助注册流程，统一指向联系表单 */
  cta: {
    start: "#contact",
    contact: "#contact",
  },
  links: {
    console: undefined as string | undefined,
    docs: undefined as string | undefined,
    status: undefined as string | undefined,
  },
  contact: {
    email: "sales@pinhaoji1.cn", // TODO: 待业务方确认
  },
} as const;
