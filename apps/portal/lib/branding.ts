/**
 * 服务端品牌信息：SSR 期拉取公开品牌端点（settings key='site'）。
 * Next 16：fetch 默认不缓存，必须显式 cache:"force-cache" 才进持久缓存
 * （单写 next.revalidate 只设生命周期、不触发缓存）；同一次渲染内 fetch 自动去重，
 * root layout 与 generateMetadata 各调一次无额外开销。
 * 任何失败（API 不可达 / 响应不合契约）回落 DEFAULT_BRANDING，不阻断渲染。
 */
import { API_BASE_URL } from "./api";
import { brandingSchema, DEFAULT_BRANDING, type Branding } from "@qmkvm/contracts";

const BRANDING_URL = `${API_BASE_URL}/api/v1/public/settings`;

export async function getBranding(): Promise<Branding> {
  try {
    const res = await fetch(BRANDING_URL, {
      cache: "force-cache",
      next: { revalidate: 60 },
    });
    if (!res.ok) return { ...DEFAULT_BRANDING };
    return brandingSchema.parse((await res.json()) as unknown);
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}
