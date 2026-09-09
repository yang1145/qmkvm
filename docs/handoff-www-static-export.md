# 交接：www 官网改纯前端静态导出（SSG，免配置部署 nginx / pages 平台）

> 本文档由上一会话编写，供下一个 agent 继续工作。日期：2026-09-09。
> 代码已全部落盘且全仓构建绿，**未 commit**。有一个脚本改动改完未重跑构建（见待办 1）。

## 需求回顾

- `apps/www` 从 Next.js SSR 服务改为**构建后纯前端静态导出（SSG，`output: 'export'`）**，产物 `apps/www/out/`。
- **免配置部署**：同一份产物既要 nginx 直接托管，也要能扔到任意 pages 平台（EdgeOne Pages / Cloudflare Pages / Netlify / GitHub Pages...）。因此一切依赖托管层能力的环节（服务端语言协商、重定向规则）都必须内化到产物里。
- 本次**明确不做后端功能**：联系销售表单的接收端不实现，只把提交目标抽成环境变量。

## 方案要点（已定，勿推翻）

1. **URL 结构**：`localePrefix` 从 `as-needed`（zh 无前缀）改为 `always` → 中文 `/zh/*`、英文 `/en/*`，双物理路径。
2. **根路径 `/`**：由构建后脚本写入 `out/index.html`——内联 JS 按 `navigator.language` 跳 `/zh/` 或 `/en/`，`<noscript>` 双链接兜底，`noindex` + hreflang 标记。这是各静态平台唯一通用的语言协商机制。
3. **middleware 移除**：`proxy.ts`（Next 16 的 middleware）已删除，静态导出不支持。
4. **表单**：提交目标 `NEXT_PUBLIC_CONTACT_API_URL`（构建期烘焙），未配置时前端直接提示失败（不渲染死链的既有原则）。
5. **404**：不用根布局重构（`app/layout.tsx` 上提 + `app/not-found.tsx`，评估为高风险区），改由 post-build 脚本把 `out/404.html` 覆写为品牌化中文 404 页（手写 HTML + 内联样式，文案同 `messages/zh.json` 的 notfound 段）。根级 `404.html` 是全静态平台自动识别的公约数。

## 已完成

1. **`apps/www/next.config.ts`**：`output: "export"`、`trailingSlash: true`（目录式 index.html，兼容性最好）、`images.unoptimized: true`。
2. **`apps/www/i18n/routing.ts`**：`localePrefix: "always"`；删除 `apps/www/proxy.ts`、`app/api/contact/route.ts`、`app/[locale]/[...rest]/page.tsx`（catch-all 静态导出不支持）。
3. **元数据路由硬性要求**：`app/manifest.ts`、`app/robots.ts`、`app/sitemap.ts` 必须加 `export const dynamic = "force-static"`，否则 Next 16.3.4 静态导出直接报错（本次踩过）。
4. **5 个页面**（page/about/contact/privacy/terms）的 canonical/hreflang 全部加 `/zh/` 前缀，首页 `x-default` 指根路径；`sitemap.ts` 同步（协商页不进 sitemap，列 6 个实体页）。
5. **`components/sections/header.tsx`**：`homePath` 改为 `"/"`——next-intl 的 `Link` 自带 locale 前缀，之前写 `/${locale}/` 会产出 `/zh/zh/#products` 双前缀（踩过并已修）。
6. **`components/sections/contact-form.tsx`**：`fetch` 目标改 `process.env.NEXT_PUBLIC_CONTACT_API_URL`。
7. **`apps/www/scripts/write-root-index.mjs`（新建）**：post-build 补丁脚本，写三个文件——`out/index.html`（语言协商页）、`out/404.html`、`out/404/index.html`（品牌中文 404，两处一致）。挂在 `package.json` 的 `build` 命令后；`start` 脚本已删（无 Node 运行时）。
8. **部署链路**：
   - 新建 `docker/Dockerfile.www`：node:22-alpine 构建 + `nginx:1.27-alpine` 托管 `out/`；`NEXT_PUBLIC_*` 以 ARG 形式构建期烘焙。
   - 新建 `docker/nginx-www.conf`：`try_files =404`、`error_page 404 /404.html`、`_next/static` 一年 immutable、图片 30d、`/healthz`。裸机 nginx 也可直接抄这份 conf。
   - `docker-compose.prod.yml`：www 服务换新镜像，端口 `127.0.0.1:3000:80`。
   - `docker-compose.cluster.yml`：www 服务换新镜像；**lb 内嵌 nginx 的 `www_pool` 从 `www:3000` 改为 `www:80`**（易漏）。
   - `Dockerfile.next` 注释收敛为 portal 专用。
9. **文档同步**：`README.md` 与 `docs/deployment.md` PM2 段（删 `kvm-www` 常驻进程，www/admin 均为静态托管）、`docs/development.md` §1 仓库结构注释、`docker/README-cluster.md` 架构图注释（SSR×2 → SSR×1 + SSG）。
10. **配套**：`.env.example` 补 `NEXT_PUBLIC_CONTACT_API_URL` 注释项；`turbo.json` build outputs 加 `out/**`。

## 已验证

- `pnpm --filter @qmkvm/www build` ✅（15 页全部 SSG）；全仓 `pnpm build` 14/14 ✅、`pnpm typecheck` 23/23 ✅、www `pnpm lint` ✅。
- `out/` 用 `npx serve` 实测：`/` `/zh/` `/en/` `/zh/about/` `/sitemap.xml` 200，未知路径 404；canonical/hreflang/站内链接前缀正确（`/zh/#pricing` 等）。
- **未验证**：Docker 镜像构建（本机无 Docker）、浏览器视觉（协商页跳转、404 视觉）。

## 待办（按优先级）

1. **重跑构建让 404 覆写落盘**：`write-root-index.mjs` 的 404 覆写是最后加的，改完还没重新 build。跑 `pnpm --filter @qmkvm/www build`，确认 `out/404.html` 是品牌中文页（不再是 Next 英文默认页）。
2. **补一行 dev 提示**：`docs/development.md` §2 dev 命令区加注——dev 模式根路径 `/` 是 404，请直接访问 `/zh` 或 `/en`（语言协商页只存在于构建产物）。
3. **Docker 实测**（需有 Docker 的机器）：`docker build -f docker/Dockerfile.www -t kvm-www .` + 两套 compose 起 www，浏览器过一遍根跳转/中英页面/404/图片。
4. **浏览器实测**（开发门槛 §5 要求）：`npx serve apps/www/out` 后看协商页跳转、品牌 404、中英切换、表单未配置环境变量时的失败提示。
5. **commit**：约 24 个文件（14 改、3 删、3 新增 + scripts/ 目录），等用户确认后提交。
6. **表单后端（本次明确不做）**：建议在 `apps/api` 加公开端点 `POST /api/v1/contact`，zod schema 从 git 历史恢复（被删的 `apps/www/app/api/contact/route.ts`），`CORS_ORIGINS` 白名单机制现成。
7. **SEO 过渡**：旧 URL `/about` → `/zh/about/`，线上需要托管层一次性 301（nginx map 或平台重定向规则），或接受收录自然迁移；PRD 9.3「zh 无前缀」的描述已过时，需同步。

## 已知取舍（不要"修复"它们）

- 404 页是脚本生成的手写 HTML，不走 React 组件体系——刻意规避根布局重构这个高风险区。
- `NEXT_PUBLIC_*`（品牌名/portal 地址/表单端点/站点域名）全部构建期烘焙，改配置必须重建镜像/重传产物。
- dev 根路径 404 是预期行为（见待办 2 的文档化）。
- GitHub Pages **项目站**（`user.github.io/repo/`）需构建时设 `basePath`；自定义域名或用户站不需要。
- 图片全部 `unoptimized` 直出（原 config 注释本就为 EdgeOne 静态托管预留了此意图）。

## 关键文件清单

- `apps/www/next.config.ts`、`apps/www/i18n/routing.ts`、`apps/www/package.json`
- `apps/www/scripts/write-root-index.mjs`（新建，核心补丁脚本）
- `apps/www/app/{sitemap,robots,manifest}.ts`、`app/[locale]/*/page.tsx`（元数据前缀）
- `apps/www/components/sections/{header,contact-form}.tsx`
- `docker/Dockerfile.www`（新建）、`docker/nginx-www.conf`（新建）
- `docker/docker-compose.prod.yml`、`docker/docker-compose.cluster.yml`（www 服务 + lb upstream）
- `.env.example`、`turbo.json`、`README.md`、`docs/{deployment,development}.md`、`docker/README-cluster.md`

## 快速验证命令

```bash
pnpm --filter @qmkvm/www build          # 产物 out/（15 页 + 协商页 + 品牌 404）
npx serve apps/www/out                  # 模拟 pages 平台；根路径应跳 /zh/ 或 /en/
pnpm typecheck                          # 23 任务
pnpm build                              # 全仓 14 任务
```
