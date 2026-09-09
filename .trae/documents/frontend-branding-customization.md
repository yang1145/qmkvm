# 前端品牌定制化开发方案（admin 设置 → portal 运行时生效 / www 构建期生效）

## Context

用户需求：在 admin 后台设置 logo、站点标题、版权信息等通用品牌信息，展示于 www 官网与 portal 客户门户。www 是纯静态导出（无 Node 运行时），物理上无法运行时读库，故采用分层策略：

* **portal（SPA 静态导出，2026-09-09 起）**：客户端拉取公开 API，admin 保存后刷新即生效；
  元信息为通用格式（"客户中心"）、不内置缺省 favicon，portal 无需因品牌变更重建

* **www（SSG）**：构建前脚本从公开 API 拉取烘焙进产物（`branding.json`），改品牌后需重新构建部署 www（静态站固有属性，非本方案缺陷）

* 字段克制（用户明确「只做必要」）：复用现有 `settings` 表 `key='site'` 行，不建新表

**顺带修复现存不一致**：admin 设置页现写平铺 key `site.siteName` 独立行，而通知模块（`packages/notifications/src/send.ts:66`）与公开端点读的是 `key='site'` JSON 行——admin 改站点名实际不生效。本次统一到 `key='site'` 行。

## 字段定义（settings key='site'，全部可空，消费端回落内置缺省）

```json
{
  "siteName": "启明智联",
  "siteNameEn": "QmKvm",
  "logo": "data:image/png;base64,...（可空，≤300KB）",
  "copyright": "© {year} {brand}（可空，占位符由消费端替换）",
  "contactEmail": "sales@example.com（可空）",
  "portalUrl": "https://...（可空）",
  "announcement": "（已有字段，保留）"
}
```

## 实施步骤

### 1. api（后端，先行）

**修改** **`apps/api/src/routes/admin/settings.ts`**

* 新增 `GET|PUT /settings/site` 子路由（完全参照同文件 smtp 子路由模式）

* 复用文件底部 `readSettingValue` / `upsertSetting` / `writeAdminAudit`（审计 action：`settings.site.update`，权限复用 `settings.manage`，无需新增权限点）

* zod schema：`siteName`/`siteNameEn`/`copyright`(≤200)/`contactEmail`/`portalUrl`(url 或空)/`announcement` 全 optional；`logo` 为 `z.string().startsWith("data:image/").max(400_000)`

* PUT 逻辑：读旧 `site` 行 → 浅合并写回（未提交字段保留），与 smtp 子路由一致

**修改** **`apps/api/src/routes/public.ts`**

* `GET /public/settings`（现有公开端点，portal 已在用）扩展返回品牌字段：复用现有 `getSetting("site")`（30s 进程缓存），逐字段透传 + 缺省回落；现有输出（siteName/announcement/paymentMethods/priceExample）不变，向后兼容

* 确认 api body 大小限制 ≥ 400KB（logo data URL 场景）

### 2. admin（设置界面）

**修改** **`apps/admin/src/pages/settings/index.tsx`**

* 「站点信息」卡改调新子路由，删除平铺 `SITE_KEYS`（`site.siteName` 独立行废弃，旧数据行留库不读，不写迁移）

* 字段：站点名称、英文名、版权文本（提示支持 `{year}`/`{brand}` 占位）、联系邮箱、portal 地址、logo 上传

* logo 上传：AntD Upload `beforeUpload` 返回 false + FileReader 转 data URL，限 png/jpg/jpeg ≤200KB（存库前），预览 + 清空按钮

* 保存后提示：www 侧需重新构建部署后生效

**修改** **`apps/admin/src/services/{admin.ts,types.ts}`**

* 新增 `getSiteSettings` / `putSiteSettings` 请求函数与类型（参照现有 `getSettings`/`putSettings`）

### 3. portal（运行时消费）

**新建** **`apps/portal/lib/branding.ts`**

* server-only：fetch `${API}/public/settings`，**Next 16 必须** `fetch(url, { cache: "force-cache", next: { revalidate: 60 } })`（本版 fetch 默认不缓存，单写 revalidate 无效）

* zod 解析 + 网络失败一律回落内置缺省对象（与 www 缺省同源，常量放 `packages/contracts` 导出共享）

**修改** **`apps/portal/app/layout.tsx`**

* 删除静态 `metadata` 对象（Next 16 禁止与 generateMetadata 并存），改 `export async function generateMetadata()`：title.default/template、icons（logo 配置时用 data URL 作 icon href，验证点）

* root layout 拉一次 branding，经 React Context（BrandingProvider，client 组件）下发

**修改** **`apps/portal/app/(auth)/layout.tsx`**

* 品牌区：logo 配置时 `<img src={dataURL}>`，否则保持「启」文字方块；站点名/英文名/版权行接 branding

**修改** **`apps/portal/components/layout/site-footer.tsx`**

* 版权行接 branding，做 `{year}`/`{brand}` 占位替换

**修改** **`apps/portal/lib/schemas.ts`**

* 客户端 zod 契约补品牌 optional 字段（现有 siteName/announcement 不动）

### 4. www（构建期消费）

**新建** **`apps/www/scripts/fetch-branding.mjs`**

* 读 env `BRANDING_API_URL`（指向 `/api/v1/public/settings`）；未配置 → 警告并写缺省 JSON

* 请求 `AbortSignal.timeout(5000)` + 全量 try/catch，**任何失败都降级写缺省、永不中断构建**（静态站必须可独立构建）

* **无条件写出** **`apps/www/branding.json`**（build 与 typecheck 均静态依赖它）

* logo 为 data URL 时解码写 `apps/www/public/branding/logo.<ext>`（**不覆写 public/logo.png**，避免污染工作区），写前清理旧文件；json 记录 `logoFile: "/branding/logo.png"`

**修改** **`apps/www/lib/site.ts`**

* 三级回落：`branding.json`（顶层 import，tsconfig 已开 resolveJsonModule）> env（NEXT\_PUBLIC\_\*）> 内置缺省

* `siteConfig` 对外 API（name/nameEn/brandName(locale)/logo.icon 等）不变，**组件零改动**；`logo.icon` 取 `branding.logoFile ?? "/logo.png"`

**修改** **`apps/www/scripts/write-root-index.mjs`**

* 品牌名/favicon 改读 branding.json（> env > 缺省），与产物协商页/404 页衔接

**修改** **`apps/www/package.json`**

* `build`: `node scripts/fetch-branding.mjs && next build && node scripts/write-root-index.mjs`；`typecheck` 前同样挂 fetch-branding

**根** **`.gitignore`**：加 `apps/www/branding.json`、`apps/www/public/branding/`

### 5. 文档

* `README.md` / `docs/deployment.md` / `docs/development.md` §6 环境变量表：补 `BRANDING_API_URL`；注明「改品牌：portal ≤60s 自动生效，www 需重新构建部署」

## 已知取舍（不「修复」）

* logo 单图上传，www 的白色/横版变体（logo-white/horizontal.png）不跟随，继续用内置资源

* logo 以 data URL 存 settings（≤300KB），不走 storage 上传系统——免公开资源端点/presigned 过期/跨域问题，对 www 构建期拉取最简

* ogImage 分享图不定制；www 营销文案（hero 等）不进定制字段

* 缓存链：api getSetting 30s + portal revalidate 60s，最终一致

## 验证（你写我测：AI 构建自检，用户浏览器实测）

```bash
pnpm build          # 全仓（有/无 BRANDING_API_URL 各跑一次 www 构建，验证降级）
pnpm typecheck      # 23 任务
```

用户冒烟清单：

1. admin 系统设置页：上传 logo、填品牌/版权/邮箱 → 保存
2. `curl http://localhost:4000/api/v1/public/settings` 返回品牌字段
3. portal 刷新即生效：favicon/logo/登录页品牌区/页脚版权（浏览器标签标题为通用格式，不含品牌名）
4. www 配 `BRANDING_API_URL` 重新构建 + `npx serve apps/www/out`：logo、页脚版权占位替换、404 页 favicon、协商页标题
5. 通知模板 `{{site.name}}` 渲染为 admin 设置的站点名（顺带修复的验证）

