import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

// 静态导出产物补丁脚本：
// 1) out/index.html —— 根路径语言协商页。静态导出无 middleware/服务端重定向，
//    各静态托管平台（nginx / EdgeOne Pages / Cloudflare Pages / GitHub Pages...）
//    的服务端语言协商能力不一，唯一通用机制是自包含的内联 JS 协商：
//    按 navigator.language 跳 /zh/ 或 /en/，noscript 兜底。
// 2) out/404.html —— 品牌化中文 404 页。Next 导出的是内置英文默认页
//    （app/[locale]/not-found.tsx 属于 locale 布局，无法成为根级 404.html），
//    这里用 messages/zh.json 同款文案覆写，两处产物（404.html、404/index.html）保持一致。
//
// 品牌取值三级回落：branding.json（fetch-branding.mjs 构建前生成）> NEXT_PUBLIC_* env > 内置缺省。
// 手写 HTML 插值一律经 escapeHtml（品牌名/域名来自 admin 设置，防 HTML 注入）。

let branding = { siteName: null, siteNameEn: null, logoFile: null };
try {
  branding = JSON.parse(
    await readFile(path.resolve(import.meta.dirname, "../branding.json"), "utf8"),
  );
} catch {
  // branding.json 缺失时回退 env（正常流程 build 前已无条件生成）
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const brand = escapeHtml(
  branding.siteName ?? process.env.NEXT_PUBLIC_BRAND_NAME ?? "启明智联",
);
const brandEn = escapeHtml(
  branding.siteNameEn ?? process.env.NEXT_PUBLIC_BRAND_NAME_EN ?? "QmKvm",
);
const domain = escapeHtml(process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com");
const favicon = escapeHtml(branding.logoFile ?? "/logo.png");

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${brand} · ${brandEn}</title>
<link rel="alternate" hreflang="zh-CN" href="${domain}/zh/">
<link rel="alternate" hreflang="en-US" href="${domain}/en/">
<link rel="alternate" hreflang="x-default" href="${domain}/">
<link rel="icon" href="/logo.png">
<script>
(function () {
  var lang = (navigator.language || navigator.userLanguage || "zh").toLowerCase();
  location.replace(lang.indexOf("zh") === 0 ? "/zh/" : "/en/");
})();
</script>
</head>
<body>
<noscript>
<p><a href="/zh/">中文</a> · <a href="/en/">English</a></p>
</noscript>
</body>
</html>
`;

// 品牌色对齐 manifest theme_color；文案与 messages/zh.json 的 notfound 段一致
const notFoundHtml = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>404 · ${brand}</title>
<link rel="icon" href="${favicon}">
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;background:#fff}
main{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{text-align:center}
.code{font-size:64px;font-weight:700;color:#2563eb;letter-spacing:-.02em}
h1{font-size:22px;font-weight:600;margin:16px 0 8px}
p{color:#64748b;margin:0 0 28px}
a.btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 22px;border-radius:10px;font-size:14px}
a.btn:hover{background:#1d4ed8}
a.alt{display:inline-block;margin-left:14px;color:#64748b;font-size:14px;text-decoration:none}
a.alt:hover{color:#0f172a}
</style>
</head>
<body>
<main><div class="box">
<p class="code">404</p>
<h1>页面不存在</h1>
<p>你访问的页面可能已被移动或删除。</p>
<div><a class="btn" href="/zh/">返回首页</a><a class="alt" href="/en/">English</a></div>
</div></main>
</body>
</html>
`;

const outDir = path.resolve(import.meta.dirname, "../out");
await writeFile(path.join(outDir, "index.html"), html, "utf8");
await writeFile(path.join(outDir, "404.html"), notFoundHtml, "utf8");
// _not-found 路由在 trailingSlash 下会同时产出 404/index.html，一并覆写保持一致
await mkdir(path.join(outDir, "404"), { recursive: true });
await writeFile(path.join(outDir, "404", "index.html"), notFoundHtml, "utf8");
console.log(
  `[write-root-index] index.html (${html.length} B) + 404.html (${notFoundHtml.length} B) written`
);
