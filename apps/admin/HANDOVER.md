# apps/admin 交接文档（拼好机管理后台 · Ant Design Pro）

> 交接时间：2026-09-06。本文件供下一个智能体/开发者接续工作，读完即可动手，无需重读任务全史。

## 1. 任务与硬性边界

- 目标：把 `apps/admin` 建成 Ant Design Pro（umi max）管理后台，对接 Hono API 契约（`docs/SPEC-P0.md` §4），覆盖全部 P0 页面，全中文。
- 边界（违反即失败）：
  1. 只改 `apps/admin/**`；禁改 apps/api、apps/portal、apps/www、packages/**、docs/**、根配置。
  2. 包名 `@pinhaoji/admin`，只用 pnpm（根目录执行）。
  3. 不引入额外 UI 库（只用 antd + ProComponents）；不手写整体布局。
  4. 不 git commit。
- 验收标准：
  1. `pnpm --filter @pinhaoji/admin build` 成功；
  2. `pnpm --filter @pinhaoji/admin typecheck` 通过（脚本已加 `"typecheck": "tsc --noEmit"`；跑之前先 `pnpm --filter @pinhaoji/admin exec max setup` 生成 .umi 类型）；
  3. 14 组页面路由/菜单/权限点齐全；
  4. 汇报：脚手架方式 + 文件清单 + 页面清单 + 遗留问题。

## 2. 当前进度

### 已完成（代码全部写完）
- 脚手架：方式 B（clone ant-design-pro 删 .git 改包名），已清理全部演示页/mock/多余语言（仅 zh-CN）。
- 基建：`config/config.ts`、`config/routes.ts`、`config/proxy.ts`、`src/app.tsx`（getInitialState 拉 /auth/me）、`src/access.ts`（23 权限点→canXxx）、`src/requestErrorConfig.ts`、`src/services/{admin.ts,types.ts,enums.ts}`、`src/utils/{format.ts,status.tsx,table.ts}`、登录页、仪表盘、异常页（403/404/500）、`locales/zh-CN.ts`。
- 14 组业务页面 18 个文件全部写完（见 §4）。
- routes.ts 404 路由已修正：`{path:'*',component:'./exception/404'}`。

### 未完成（= 下一步，按顺序）
1. **build 基线**：`pnpm --filter @pinhaoji/admin build`（依赖已由用户手动装好）。
2. **修 build/TS 报错**（预期少量：18 个新页面是批量手写，可能仍有 strict 模式小错）。
3. **typecheck**：先 `pnpm --filter @pinhaoji/admin exec max setup`，再 `pnpm --filter @pinhaoji/admin typecheck`，修到 0 错。
4. **最终汇报**（格式见 §1 验收标准第 4 条）。

## 3. 环境坑（重要，别踩第二次）

- PowerShell 执行策略禁 .ps1：AI 终端里用 `pnpm.cmd` 而非 `pnpm`。
- 沙箱限制写 `D:\.pnpm-store` 和 D 盘根目录临时文件 → **pnpm install 在 AI 沙箱里跑不完**（三轮均失败于 link 阶段），最后由用户手动执行成功。后续 install/build 若再被沙箱拦截，直接请用户手动跑。
- lockfile 过期 → `--no-frozen-lockfile`；网络慢 → `--prefer-offline`；store → `--store-dir .pnpm-store`（仓库内）。
- `@pinhaoji/contracts` 是 TS 源码包，umi 构建不兼容 → **未直接依赖**，已把所需类型复制到 `src/services/types.ts` 和 `src/services/enums.ts`（文件头注明来源 TODO）。packages/contracts 的 package.json 若已改为可被消费则可换回 workspace 依赖（可选优化，非必需）。

## 4. 文件清单

### 基建
| 文件 | 说明 |
|---|---|
| `config/config.ts` | title「拼好机管理后台」、layout、locale 仅 zh-CN、mock 关闭、moment2dayjs |
| `config/routes.ts` | 全部路由（见 §5） |
| `config/proxy.ts` | `/api` → `http://localhost:4000` |
| `src/app.tsx` | getInitialState 拉 /auth/me、水印可关、request errorConfig、ErrorBoundary |
| `src/access.ts` | PERMISSION_ACCESS_MAP：23 权限点→canXxx；isSuper 全过 |
| `src/requestErrorConfig.ts` | 统一错误体处理：AUTH→跳登录、PERM_DENIED→提示、VALIDATION_FAILED→details.issues |
| `src/services/admin.ts` | 全部端点（BASE=`/api/v1/admin`） |
| `src/services/types.ts` / `enums.ts` | 从 contracts 复制的 DTO 类型与状态枚举（TODO 注明来源） |
| `src/utils/format.ts` | formatCny（分→元两位）、yuanToFen、formatDateTime |
| `src/utils/status.tsx` | StatusTag：绿=active/paid/succeeded，橙=待处理/提醒，红=失败/逾期/terminated/dead，灰=取消/作废 |
| `src/utils/table.ts` | tableRequestAdapter（{items,total}→{data,total,success}）、toQuery |
| `src/components/{HeaderAvatar,Footer,HeaderDropdown,ErrorBoundary}` | 布局组件 |
| `src/pages/user/login/index.tsx` | LoginForm，测试账号 admin / admin12345 |
| `src/pages/dashboard/index.tsx` | Statistic 卡片 + 待办 |
| `src/pages/exception/{403,404,500}/index.tsx` | 中文化 |

### 业务页面（18 个）
`pages/customers/{index,detail}.tsx`、`pages/orders/index.tsx`、`pages/services/index.tsx`、`pages/tasks/index.tsx`、`pages/invoices/index.tsx`、`pages/transactions/index.tsx`、`pages/refunds/index.tsx`、`pages/products/{index,groups/index,edit/index}.tsx`、`pages/promotions/index.tsx`、`pages/tickets/{index,detail}.tsx`、`pages/departments/index.tsx`、`pages/templates/index.tsx`、`pages/admins/index.tsx`、`pages/roles/index.tsx`、`pages/audit-logs/index.tsx`、`pages/settings/index.tsx`

## 5. 页面 ↔ API 对照

| 路由 | 页面 | 端点（均前缀 /api/v1/admin） |
|---|---|---|
| /dashboard | 仪表盘 | GET /dashboard |
| /customers、/customers/:id | 客户列表/详情（Tabs：资料/服务/订单/账单/余额流水） | GET /customers、GET /customers/:id、POST /customers/:id/status、POST /customers/:id/credit |
| /orders | 订单（确认收款/取消） | GET /orders、POST /orders/:id/mark-paid、POST /orders/:id/cancel |
| /services | 服务（action: provision/suspend/unsuspend/terminate/sync；人工回填；改名） | GET /services、POST /services/:id/action、POST /services/:id/manual-complete、PATCH /services/:id |
| /tasks | 供应任务（重试/跳过，lastError 列） | GET /tasks、POST /tasks/:id/retry、POST /tasks/:id/skip |
| /billing/invoices | 账单（手工开单 items[]；作废带 reason） | GET /invoices、POST /invoices、POST /invoices/:id/void |
| /billing/transactions | 交易流水（只读） | GET /transactions |
| /billing/refunds | 退款（发起退款 Modal） | GET /refunds、POST /refunds |
| /products/groups | 分组 CRUD | /product-groups |
| /products、/products/:id/edit | 商品列表/编辑（周期定价 cycle/firstPrice/renewalPrice/setupFee；配置组+选项编辑器含上下移） | GET /products、GET/PUT /products/:id、POST /products、POST /products/:id/config-groups、PUT\|DELETE /config-groups/:id、POST /config-groups/:id/options、PUT\|DELETE /config-options/:id |
| /promotions | 优惠码 CRUD（percent/fixed、scope、DatePicker showTime） | /promotions |
| /tickets、/tickets/:id | 工单列表/会话（回复 contentHtml+internalNote；状态推进） | GET /tickets、GET /tickets/:id、POST /tickets/:id/reply、POST /tickets/:id/status |
| /tickets/departments | 部门 CRUD | /departments |
| /tickets/templates | 通知模板（{{变量}} 提示、启用开关） | /templates |
| /system/admins | 管理员 CRUD | /admins |
| /system/roles | 角色管理（按域分组权限 checkbox） | /roles |
| /system/audit-logs | 审计日志（before/after JSON 折叠） | /audit-logs |
| /system/settings | 系统设置（计费/站点/支付网关） | GET/PUT /settings |

## 6. 关键契约速查

- Cookie 会话（HttpOnly），走代理同源自动带 cookie；`GET /auth/me` → `{admin,permissions,isSuper}`。
- 分页：`?page=&pageSize=` → `{items,total,page,pageSize}`；ProTable request 用 `tableRequestAdapter` 适配。
- 金额全为整数分：展示 `formatCny(÷100)`，提交 `yuanToFen(×100)`。
- 危险操作（mark-paid/cancel/void/退款/余额调整/禁用/terminate）一律 danger + Modal/Popconfirm 二次确认。
- 权限点示例：`invoices.manage`；access.ts 已展开，路由 access 字段与页面按钮均接好。

## 7. 已修复的代码模式（新代码照此写，避免重复踩坑）

1. strict 模式下用 `React.FC`/`React.ReactNode` 类型必须 `import type React from 'react'` 或合并 default import——13 个页面已修。
2. antd 无 `DatePicker.ShowTime`，用 `<DatePicker showTime />`。
3. JSX 文本里 `{{变量}}` 要写 `{'{{变量}}'}`（templates 页）。
4. `<Space split>` 死代码已删，用 `<Space size={8}>`。
5. 文件末尾重复 import 已清理（customers/detail、products/edit、tickets/detail 等）。
6. `dayjs.Dayjs` 命名空间：`import type { Dayjs } from 'dayjs'` + `as unknown as Dayjs`。

## 8. 遗留问题 / 风险

- build/typecheck 尚未跑过，18 个新页面可能有少量 strict TS 报错待修（预期是个别 unused import / 类型收窄，模式已在 §7）。
- 后端 admin 路由并行开发中，404 正常，不阻塞交付；请求路径/方法/字段已按契约写死。
- contracts 若后续改为可消费包，可把 src/services/{types,enums}.ts 换回 `@pinhaoji/contracts` 导入（需在 package.json 加依赖 + config 开 srcTranspiler）。
- pnpm install 在 AI 沙箱内跑不完，需用户手动执行（已完成）。

## 9. 下一个智能体的操作序列

```bash
# 1. build 基线（若被沙箱拦截请用户手动跑）
pnpm --filter @pinhaoji/admin build
# 2. 修报错后：
pnpm --filter @pinhaoji/admin exec max setup
pnpm --filter @pinhaoji/admin typecheck
# 3. 全绿后按 §1 验收标准第 4 条汇报
```