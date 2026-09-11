/**
 * 站点级配置（PRD 9.2：CTA 与外部链接通过配置管理）
 * 未配置的入口不得渲染为可点击死链 —— 对应组件需按 undefined 判断隐藏。
 *
 * 品牌三级回落：branding.json（构建前 scripts/fetch-branding.mjs 从业务系统
 * 拉取烘焙，admin「站点信息」维护）> NEXT_PUBLIC_* 环境变量 > 内置缺省。
 * 文案（messages/*.json）一律使用 {brand} 占位符，由 siteConfig 注入；
 * 更换品牌只需在 admin 设置并重新构建，或设置 NEXT_PUBLIC_BRAND_NAME* 环境变量。
 *
 * 域名不硬编码：通过 NEXT_PUBLIC_SITE_URL 注入（缺省 https://example.com）。
 */
import brandingJson from "../branding.json";

interface BrandingFile {
  siteName: string | null;
  siteNameEn: string | null;
  logoFile: string | null;
  copyright: string | null;
  contactEmail: string | null;
  portalUrl: string | null;
}

// branding.json 由 scripts/fetch-branding.mjs 在 build/dev/typecheck 前无条件写出
const branding = brandingJson as BrandingFile;

const brandName =
  branding.siteName ?? trimEnv(process.env.NEXT_PUBLIC_BRAND_NAME) ?? "启明智联";
const brandNameEn =
  branding.siteNameEn ?? trimEnv(process.env.NEXT_PUBLIC_BRAND_NAME_EN) ?? "QmKvm";

/** 剥掉环境值两端多余引号/空白（deploy-prod.sh 生成的 .env 对值加了引号） */
function trimEnv(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s.replace(/^[\s"'`]+|[\s"'`]+$/g, "");
}

export const siteConfig = {
  /** 中文品牌名（branding.json > env：NEXT_PUBLIC_BRAND_NAME） */
  name: brandName,
  /** 英文/拉丁品牌名（env：NEXT_PUBLIC_BRAND_NAME_EN），用于标题模板、OG 等 */
  nameEn: brandNameEn,
  /** 按语言取品牌名 */
  brandName(locale: string): string {
    return locale === "zh" ? brandName : brandNameEn;
  },
  domain: trimEnv(process.env.NEXT_PUBLIC_SITE_URL) ?? "https://example.com",
  /** Logo 资源：custom 为 admin 上传的定制 logo（branding.json，构建期烘焙）；
   *  icon/favicon/OG/footer 跟随定制（回落内置）；white/horizontal 为内置深浅变体 */
  logo: {
    custom: branding.logoFile,
    icon: branding.logoFile ?? "/logo.png",
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
    email: branding.contactEmail ?? "sales@example.com",
  },
  /** 版权行定制文本（null = 用 messages 的 footer.copyright 缺省）；占位符 {year}/{brand} */
  copyright: branding.copyright as string | null,
} as const;

/**
 * Portal（用户控制台）地址：branding.json（admin 站点信息）优先，
 * 其次 NEXT_PUBLIC_PORTAL_URL / PORTAL_URL 环境变量。
 * 未配置时不渲染控制台入口（PRD 9.2：未配置的入口不得渲染为可点击死链）。
 */
export function getPortalUrl(): string | undefined {
  return (
    branding.portalUrl ??
    trimEnv(process.env.NEXT_PUBLIC_PORTAL_URL) ??
    trimEnv(process.env.PORTAL_URL) ??
    undefined
  );
}
