import Image from "next/image";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** 是否展示品牌文字 */
  showText?: boolean;
  /** 深色背景下的 logo（白底图） */
  variant?: "default" | "white" | "horizontal";
}

/** 品牌 Logo：图标 + 文字，用于导航与页脚；horizontal 使用带文字的横向图 */
export function Logo({
  className,
  showText = true,
  variant = "default",
}: LogoProps) {
  if (variant === "horizontal") {
    return (
      <span className={cn("inline-flex items-center", className)}>
        <Image
          src="/logo-horizontal.png"
          alt="启明智联"
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
        src={variant === "white" ? "/logo-white.png" : "/logo.png"}
        alt="启明智联"
        width={32}
        height={32}
        priority
        className="h-8 w-8 shrink-0 object-contain"
      />
      {showText ? (
        <span className="whitespace-nowrap text-lg font-semibold tracking-tight">
          启明智联
        </span>
      ) : null}
    </span>
  );
}
