import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

// 构建前置脚本：从业务系统公开端点拉取品牌定制（settings key='site'，经
// GET /api/v1/public/settings 分发），写入 branding.json 供 next build / tsc /
// write-root-index.mjs 静态消费。任何失败（未配置 / 超时 / 非 200 / 响应异常）
// 都降级为 env 与内置缺省，绝不中断构建（静态官网必须可独立于业务系统构建）。
// logo 为 data URL 时解码落盘 public/branding/logo.<ext>（不覆写 public/ 原始资源）。
//
// 配置：BRANDING_API_URL —— 完整 URL，如 https://api.example.com/api/v1/public/settings。

const outDir = path.resolve(import.meta.dirname, "..");
const publicBrandingDir = path.join(outDir, "public", "branding");

const EMPTY = {
  siteName: null,
  siteNameEn: null,
  logoFile: null,
  copyright: null,
  contactEmail: null,
  portalUrl: null,
};

function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function fetchBranding() {
  const url = process.env.BRANDING_API_URL;
  if (!url) {
    console.warn("[fetch-branding] BRANDING_API_URL 未配置，使用 env / 内置缺省品牌");
    return { ...EMPTY };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      siteName: str(data.siteName),
      siteNameEn: str(data.siteNameEn),
      logoFile: null, // 由 logo 解码步骤填充
      copyright: str(data.copyright),
      contactEmail: str(data.contactEmail),
      portalUrl: str(data.portalUrl),
      logoData: str(data.logo), // 中间值，落盘后删除
    };
  } catch (err) {
    console.warn(`[fetch-branding] 拉取失败（${err?.message ?? err}），降级为 env / 内置缺省品牌`);
    return { ...EMPTY };
  }
}

const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** data URL logo 解码落盘 public/branding/logo.<ext>；失败返回 null（沿用内置 logo） */
async function writeLogo(logoData) {
  const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(logoData ?? "");
  if (!m) return null;
  const ext = EXT_BY_MIME[m[1]];
  try {
    await mkdir(publicBrandingDir, { recursive: true });
    // 清理旧文件：只保留当前扩展名，避免多格式残留
    for (const name of await readdir(publicBrandingDir)) {
      if (name.startsWith("logo.")) await unlink(path.join(publicBrandingDir, name));
    }
    await writeFile(path.join(publicBrandingDir, `logo.${ext}`), Buffer.from(m[2], "base64"));
    return `/branding/logo.${ext}`;
  } catch (err) {
    console.warn(`[fetch-branding] logo 落盘失败（${err?.message ?? err}），沿用内置 logo`);
    return null;
  }
}

const branding = await fetchBranding();
if (branding.logoData) {
  branding.logoFile = await writeLogo(branding.logoData);
}
delete branding.logoData;

await writeFile(
  path.join(outDir, "branding.json"),
  JSON.stringify(branding, null, 2) + "\n",
  "utf8",
);
console.log(
  `[fetch-branding] branding.json written (siteName=${branding.siteName ?? "-"}, logoFile=${branding.logoFile ?? "-"})`,
);
