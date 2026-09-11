import Image from "next/image";
import { useLocale } from "next-intl";

import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/site";

interface LogoProps {
  className?: string;
  /** 是否展示品牌文字 */
  showText?: boolean;
  /** 深色背景下的 logo（白底图） */
  variant?: "default" | "white" | "horizontal";
}

/** 品牌 Logo：图标 + 文字，用于导航与页脚；horizontal 使用带文字的横向图。
 *  图片路径与品牌文字均来自 siteConfig（按当前语言取中/英品牌名）——
 *  更换品牌时改配置或替换 public/ 同名文件即可。 */
export function Logo({
  className,
  showText = true,
  variant = "default",
}: LogoProps) {
  const locale = useLocale();
  const brand = siteConfig.brandName(locale);

  if (variant === "horizontal") {
    // 有定制 logo（admin 上传）：图标 + 品牌文字组合；未定制时用内置横向图
    if (siteConfig.logo.custom) {
      return (
        <span className={cn("inline-flex items-center gap-2.5", className)}>
          <Image
            src={siteConfig.logo.custom}
            alt={brand}
            width={32}
            height={32}
            priority
            className="h-8 w-8 shrink-0 object-contain"
          />
          <span className="whitespace-nowrap text-lg font-semibold tracking-tight">
            {brand}
          </span>
        </span>
      );
    }
    return (
      <span className={cn("inline-flex items-center", className)}>
        <Image
          src={siteConfig.logo.horizontal}
          alt={brand}
          width={83}
          height={32}
          priority
          className="h-8 w-auto shrink-0 object-contain"
        />
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src={variant === "white" ? siteConfig.logo.white : siteConfig.logo.icon}
        alt={brand}
        width={32}
        height={32}
        priority
        className="h-8 w-8 shrink-0 object-contain"
      />
      {showText ? (
        <span className="whitespace-nowrap text-lg font-semibold tracking-tight">
          {brand}
        </span>
      ) : null}
    </span>
  );
}
