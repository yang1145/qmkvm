/**
 * 站点级配置（PRD 9.2：CTA 与外部链接通过配置管理）
 * 未配置的入口不得渲染为可点击死链 —— 对应组件需按 undefined 判断隐藏。
 *
 * 品牌不硬编码：文案（messages/*.json）一律使用 {brand} 占位符，
 * 由 siteConfig 注入；更换品牌只需设置 NEXT_PUBLIC_BRAND_NAME* 环境变量，
 * 并替换 public/ 下的 logo 图片（或在下方 logo 配置中改路径）。
 *
 * 域名不硬编码：通过 NEXT_PUBLIC_SITE_URL 注入（缺省 https://example.com）。
 */

const brandName = (process.env.NEXT_PUBLIC_BRAND_NAME as string | undefined) ?? "启明智联";
const brandNameEn =
  (process.env.NEXT_PUBLIC_BRAND_NAME_EN as string | undefined) ?? "QmKvm";

export const siteConfig = {
  /** 中文品牌名（env：NEXT_PUBLIC_BRAND_NAME） */
  name: brandName,
  /** 英文/拉丁品牌名（env：NEXT_PUBLIC_BRAND_NAME_EN），用于标题模板、OG 等 */
  nameEn: brandNameEn,
  /** 按语言取品牌名 */
  brandName(locale: string): string {
    return locale === "zh" ? brandName : brandNameEn;
  },
  domain: (process.env.NEXT_PUBLIC_SITE_URL as string | undefined) ?? "https://example.com",
  /** Logo 资源：换品牌时替换 public/ 同名文件，或改这里的路径 */
  logo: {
    icon: "/logo.png",
    white: "/logo-white.png",
    horizontal: "/logo-horizontal.png",
  },
  /** 1200×630 分享图（Open Graph） */
  ogImage:
    "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=minimal%20light%20blue%20cloud%20computing%20brand%20banner%2C%20soft%20network%20grid%20and%20nodes%2C%20clean%2C%20high%20key%2C%20no%20text&image_size=landscape_16_9",
  /** 主 CTA 目标：未接入 portal 时的兜底（配置 portal 后主按钮指向控制台） */
  cta: {
    start: "#contact",
    contact: "#contact",
  },
  links: {
    docs: undefined as string | undefined,
    status: undefined as string | undefined,
  },
  contact: {
    email: "sales@example.com", // TODO: 待业务方确认（示例占位，部署时替换）
  },
} as const;

/**
 * Portal（用户控制台）地址：服务端组件在请求时读取，
 * 支持 NEXT_PUBLIC_PORTAL_URL（构建/运行时均可）与 PORTAL_URL（复用根 .env）。
 * 未配置时不渲染控制台入口（PRD 9.2：未配置的入口不得渲染为可点击死链）。
 */
export function getPortalUrl(): string | undefined {
  return (
    (process.env.NEXT_PUBLIC_PORTAL_URL as string | undefined) ??
    (process.env.PORTAL_URL as string | undefined) ??
    undefined
  );
}
