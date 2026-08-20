import Image from "next/image";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** 是否展示品牌文字 */
  showText?: boolean;
  /** 深色背景下的 logo（白底图） */
  variant?: "default" | "white";
}

/** 品牌 Logo：图标 + 文字，用于导航与页脚 */
export function Logo({
  className,
  showText = true,
  variant = "default",
}: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src={variant === "white" ? "/logo-white.png" : "/logo.png"}
        alt="拼好机"
        width={32}
        height={32}
        priority
        className="h-8 w-8 shrink-0 object-contain"
      />
      {showText ? (
        <span className="whitespace-nowrap text-lg font-semibold tracking-tight">
          拼好机
        </span>
      ) : null}
    </span>
  );
}
