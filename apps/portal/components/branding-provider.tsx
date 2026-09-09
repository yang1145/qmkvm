"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_BRANDING, type Branding } from "@qmkvm/contracts";

const BrandingContext = createContext<Branding | null>(null);

/** 品牌信息下发：root layout（server）拉取后经 Context 供客户端组件（页脚等）消费 */
export function BrandingProvider({ value, children }: { value: Branding; children: ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext) ?? { ...DEFAULT_BRANDING };
}
