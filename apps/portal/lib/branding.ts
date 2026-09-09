/**
 * 品牌信息（构建期）：静态导出时 root layout / generateMetadata 在构建期执行，
 * 拉取公开品牌端点（settings key='site'）烘焙进产物；
 * API 不可达或响应不合契约时回落 DEFAULT_BRANDING，不阻断构建。
 * 运行时品牌由 components/branding-provider.tsx 客户端拉取。
 */
import { API_BASE_URL } from "./api";
import { brandingSchema, DEFAULT_BRANDING, type Branding } from "@qmkvm/contracts";

const BRANDING_URL = `${API_BASE_URL}/api/v1/public/settings`;

export async function getBranding(): Promise<Branding> {
  try {
    const res = await fetch(BRANDING_URL, { cache: "force-cache" });
    if (!res.ok) return { ...DEFAULT_BRANDING };
    return brandingSchema.parse((await res.json()) as unknown);
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}
