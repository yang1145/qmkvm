"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { brandingSchema, DEFAULT_BRANDING, type Branding } from "@qmkvm/contracts";

import { API_BASE_URL } from "@/lib/api";

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

/**
 * 品牌信息下发：初始渲染用内置缺省，挂载后客户端拉取
 * admin「站点信息」（GET /api/v1/public/settings）并更新；任何失败静默回落缺省。
 * 品牌完全运行时生效（含 favicon），无需重新构建。
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE_URL}/api/v1/public/settings`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: unknown) => {
        if (alive) setBranding(brandingSchema.parse(json));
      })
      .catch(() => {
        // API 不可达 / 响应不合契约：保持内置缺省品牌
      });
    return () => {
      alive = false;
    };
  }, []);

  // 运行时设置 favicon（构建产物不内置图标，拉到 logo 后注入/替换）
  useEffect(() => {
    if (!branding.logo) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = branding.logo;
  }, [branding.logo]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}
