"use client";

import { useRef, type ElementType } from "react";
import {
  motion,
  useInView,
  type TargetAndTransition,
} from "motion/react";

import { cn } from "@/lib/utils";

type AnimationType = "fadeIn" | "blurIn" | "slideUp" | "scaleIn";

interface TextAnimateProps {
  children: string;
  className?: string;
  segmentClassName?: string;
  delay?: number;
  duration?: number;
  by?: "word" | "character";
  as?: ElementType;
  startOnView?: boolean;
  once?: boolean;
  type?: AnimationType;
}

const variants: Record<AnimationType, TargetAndTransition> = {
  fadeIn: { opacity: 1 },
  blurIn: { opacity: 1, filter: "blur(0px)" },
  slideUp: { opacity: 1, y: 0 },
  scaleIn: { opacity: 1, scale: 1 },
};

const initialStates: Record<AnimationType, TargetAndTransition> = {
  fadeIn: { opacity: 0 },
  blurIn: { opacity: 0, filter: "blur(8px)" },
  slideUp: { opacity: 0, y: 16 },
  scaleIn: { opacity: 0, scale: 0.96 },
};

/** Magic UI TextAnimate：按词/字符逐段入场 */
export function TextAnimate({
  children,
  className,
  segmentClassName,
  delay = 0,
  duration = 0.5,
  by = "word",
  as: Component = "p",
  startOnView = true,
  once = true,
  type = "fadeIn",
}: TextAnimateProps) {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once, margin: "0px 0px -10% 0px" });

  const segments =
    by === "word" ? children.trim().split(/(\s+)/) : Array.from(children);

  const variantsParam = {
    initial: initialStates[type],
    animate: variants[type],
  };
  const shouldAnimate = !startOnView || isInView;

  return (
    <Component
      ref={ref}
      className={cn("whitespace-pre-wrap break-words", className)}
    >
      {shouldAnimate
        ? segments.map((segment, i) => (
            <motion.span
              key={`${segment}-${i}`}
              className={cn(segmentClassName)}
              initial={variantsParam.initial}
              animate={variantsParam.animate}
              transition={{
                duration,
                delay: delay + i * 0.06,
                ease: "easeOut",
              }}
            >
              {segment}
            </motion.span>
          ))
        : children}
    </Component>
  );
}
