"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface ShimmerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
}

/** Magic UI ShimmerButton：带轻柔扫光的主 CTA 按钮 */
export function ShimmerButton({
  shimmerColor = "rgba(255,255,255,0.45)",
  shimmerSize = "0.05em",
  borderRadius = "0.5rem",
  shimmerDuration = "2.6s",
  background = "var(--color-primary)",
  className,
  children,
  ...props
}: ShimmerButtonProps) {
  return (
    <button
      style={
        {
          "--spread": "90deg",
          "--shimmer-color": shimmerColor,
          "--radius": borderRadius,
          "--speed": shimmerDuration,
          "--cut": shimmerSize,
          "--bg": background,
        } as React.CSSProperties
      }
      className={cn(
        "group relative z-0 inline-flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap border border-white/20 px-6 py-3 text-sm font-medium text-primary-foreground [background:var(--bg)] [border-radius:var(--radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 z-10 overflow-hidden [mask-image:linear-gradient(#fff,#fff)] [border-radius:calc(var(--radius)*0.9)]"
      >
        <div
          className="absolute left-0 aspect-square w-[200%] translate-x-[-100%] animate-shimmer [background:conic-gradient(from_calc(var(--spread)*-1),transparent_0,var(--shimmer-color)_var(--spread),transparent_calc(var(--spread)*2))]"
          style={{ inset: "calc(var(--cut)*-1)" }}
        />
      </div>
      <span className="relative z-20 inline-flex items-center gap-2">
        {children}
      </span>
    </button>
  );
}
