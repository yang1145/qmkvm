# QmKvm 开发者指南（后续开发对接文档）

> 面向接手本项目的开发者/智能体。读完本文档即可在正确的位置写代码、遵守既定约定。
> 配套文档：[部署指南](deployment.md) · [集群部署手册](../docker/README-cluster.md) · [架构演进方案](architecture-evolution.md) · [实现规格 SPEC-P0](SPEC-P0.md) · [产品需求 PRD-billing](../PRD-billing.md)

---

## 1. 仓库结构与技术栈速览

```
pnpm workspaces + Turborepo · TypeScript 严格模式 · Node.js ≥ 20

apps/
  www        官网（Next.js 16 App Router，中/英，SSG 静态导出 apps/www/out，
             nginx / pages 平台直接托管，无 Node 运行时；NEXT_PUBLIC_* 构建期烘焙）
  portal     客户门户（Next.js 16，端口 3001）—— Next.js 破坏性变更见 AGENTS.md 顶部提示
  admin      管理后台（Ant Design Pro / umi max，端口 8000，静态产物）
  api        Hono REST API（端口 4000，唯一后端服务）
  worker     BullMQ 消费者 + 11 定时任务（--group 分组，无端口）
packages/
  contracts  zod 契约（DTO/错误码/权限点，前后端共享，TS 源码包）
  db         Drizzle schema + 连接层（主库 getDb / 只读 getDbRO）+ 迁移（drizzle-kit）
  core       领域逻辑：计费/生命周期/升级折算 + 队列路由 + 领域事件 + OCR
  auth       argon2id 密码、Cookie 会话、RBAC 会话装配、限流（Redis INCR）
  payments   支付宝/微信官方 SDK + 网关注册器 + 回调幂等结算
  provisioning  供应模块（manual/demo/http-api/PVE）+ runner 原子认领
  notifications  站内信/邮件(Nodemailer)/短信(阿里云)，模板 {{变量}} 渲染
  storage    存储抽象：local 本地盘（缺省）/ S3 兼容（@aws-sdk/client-s3）
  logger     pino 结构化日志（敏感字段脱敏）
  config     共享 tsconfig
```

**依赖方向**（禁止反向）：`apps/* → packages/*`；`packages/*` 之间单向：contracts ← db ← core/auth/payments/provisioning/notifications/storage ← apps。`packages/storage` 是唯一零内部依赖的包。

## 2. 开发环境搭建

```bash
pnpm install
cp .env.example .env        # 最少填 DATABASE_URL；REDIS_URL 可选（无 Redis 自动降级）
pnpm db:migrate             # 执行 drizzle 迁移（packages/db/drizzle/*.sql）
pnpm db:seed                # 管理员 admin/admin12345、示例商品、通知模板（幂等）
pnpm dev:api                # API :4000（tsx watch）
pnpm dev:portal             # 门户 :3001
pnpm dev:admin              # 后台 :8000（先 pnpm --filter @qmkvm/admin exec max setup）
pnpm dev:www                # 官网 :3000（dev 模式根路径 / 是 404——语言协商页只存在于构建产物，请直接访问 /zh 或 /en）
pnpm dev:worker             # worker（需 Redis；缺省 --group tx）
```

**无 Redis 降级**（开发友好，生产不依赖）：限流走进程内存 Map；`enqueueJob` 内联执行（setImmediate 调本进程注册的 handler）。因此 API 进程也注册了全部 handler（`apps/api/src/wiring.ts`），无 Redis 也能跑通全链路。

**Windows 注意**：PowerShell 执行策略禁 .ps1 时用 `pnpm.cmd`；pnpm 沙箱装依赖超时可加 `--prefer-offline`。

## 3. 统一约定（新代码必须遵守）

### 3.1 API 契约（@qmkvm/contracts）

- 所有请求/响应用 zod schema 定义在 `packages/contracts/src/{admin,auth,common,dto}.ts`；路由 handler 用 `.parse()` 校验，前后端共享类型
- 错误统一错误体 `{code, message, requestId, details?}`；新增错误码登记在 `contracts/src/errors.ts` + `core/src/errors.ts`（HTTP 映射）
- 分页约定：`?page=&pageSize=` → 响应 `{items, total, page, pageSize}`
- 权限点：`contracts/src/permissions.ts`（23 项）；新路由必须挂 `requireAdmin("权限点")`，新增权限点同步 `admin/src/access.ts` 与角色种子

### 3.2 金额与时间

- 金额一律整数分（int），展示层 ÷100；禁止浮点
- 时间基准 UTC：cron 表达式、账单号 `KVM-YYYYMM-` 前缀的月份、日统计窗口全部 UTC（`date-utils.ts` 提供 windowStart）

### 3.3 队列与异步（packages/core/src/queue.ts）

- 入队：`enqueueJob(jobName, data, {delayMs?, jobId?, attempts?})`——**不要直接 new Queue**
- 路由：`QUEUE_ROUTING` 表（job 名 → 队列）；新异步任务先在表里登记，再在 worker handlers + API wiring 两处注册 handler（无 Redis inline 降级靠它）
- 队列名：`kvm`(tx) / `kvm-notify` / `kvm-supply` / `kvm-ocr`（BullMQ 禁止冒号）；`QUEUE_ROUTING=split` 环境变量启用分流，缺省单队列
- 领域事件：`emitEvent(db, name, payload)`（EVENT_NAMES 常量）；payload 带数值 `userId` 自动走通知分发
- handler 注册：worker 侧 `apps/worker/src/handlers/{tx,notify,supply,ocr}.ts` 按域归档；**每组文件头注明职责与凭据边界**（PVE 凭据只在 supply 组进程的环境变量里）
- OCR 识别：只允许调 `core/src/ocr/index.ts` 的 `ocrIdCardFront`（GB11643 校验内置）；同步重 CPU 调用禁止出现在 API 请求路径（用 `ocr.verify` 队列任务，或注明预填类交互豁免理由）

### 3.4 数据库（packages/db）

- 写路径用 `getDb()`，**可容忍主从延迟的纯读路径**（报表/导出/审计/dashboard）用 `getDbRO()`（`DATABASE_URL_RO`，未配置自动回落主库）；强一致读与读后写一律 `getDb()`
- 迁移：`pnpm --filter @qmkvm/db generate` 自动生成，或手写 SQL（对齐 0005/0006 风格）+ 三件套（`drizzle/000N_xxx.sql` + `meta/000N_snapshot.json` 复制上一版改 id/prevId/列定义 + `meta/_journal.json` 追加 idx）；迁移只增不改
- 枚举扩展（如 `ocr_status`）：手写 `ALTER ... MODIFY`，同步 schema ts、snapshot、journal 三处

### 3.5 存储抽象（packages/storage）

- 一切用户上传走 `getStorage().put(key, data, contentType)`；**禁止**在路由里直接 `fs.writeFile`
- key 规范：`identity/<userId>/...`、`tickets/<ticketId>/...`；读侧兼容历史绝对路径（local 模式）
- S3 模式读取：admin 端点 302 → presigned GET URL；不要把文件字节流经 API 转发

### 3.6 前端

- admin：AntD Pro 页面放 `apps/admin/src/pages/<域>/`，请求函数进 `services/admin.ts`，类型进 `services/types.ts`；React19 注意 `useRef` 必须带初值；ProTable 分页用 `tableRequestAdapter`
- portal：Next.js App Router，`"use client"` 组件走 `lib/api.ts` 的 `api.get/post`（zod parse 契约）；登录守卫依赖 `GET /portal/auth/me`
- 两端 UI 文案全中文；错误 Toast 由 api 层统一弹（`silent: true` 跳过）

## 4. 常见开发任务指南

### 新增一个后台管理页面

1. `apps/api/src/routes/admin/<域>.ts` 新建 Hono 路由（zod 校验 + requireAdmin 权限点）
2. `apps/api/src/routes/admin/index.ts` 挂载；DTO 若共享给前端，加进 contracts
3. `apps/admin/src/services/{admin.ts,types.ts}` 加请求与类型；`config/routes.ts` 加路由（access 权限点）；`src/pages/<域>/index.tsx` 写页面（ProTable + Descriptions/Drawer 模式，参考 identities 页）
4. 若页面有写操作：`writeAdminAudit()` 落审计；危险操作 danger + Popconfirm

### 新增一个异步任务

1. `packages/core/src/queue.ts` 的 `QUEUE_ROUTING` 登记路由（默认建议 tx；通知类 notify；重 CPU 类 ocr；供应类 supply）
2. worker `handlers/<组>.ts` 注册 handler；API `wiring.ts` 注册同名 handler（inline 降级用）——两处逻辑必须一致（参考 ocr-verify 下沉到 core 的做法：逻辑写 core，两侧薄包装）
3. 定时任务（可选）：`apps/worker/src/tasks/` 加 TaskDef（name/cron/description/run），`tasks/index.ts` 登记；cron 用 UTC
4. 若新增队列名：更新 `queuesForGroup`，并在 `docker/docker-compose.cluster.yml` 同步

### 新增支付网关

`packages/payments/src/` 实现网关接口 → `registry.ts` `registerGateway()` 注册 → 后台「支付设置」录入密钥（AES-256-GCM 加密落库）→ 回调路由挂 `webhooks`。幂等依赖 `gateway_events` 唯一键，禁止绕过 callback-service。

### 新增供应模块

`packages/provisioning/src/modules/` 实现 `ProvisionModule`（provision/suspend/unsuspend/terminate/changePackage/testConnection）→ `registry.ts` 注册。PVE 是参考实现（undici + token/ticket 认证 + clone→resize→start）。**禁止在模块里读 PVE 之外的进程环境凭据**——凭据经模块 config 注入。

## 5. 测试与质量门槛

| 检查 | 命令 | 基线 |
|---|---|---|
| 全仓类型检查 | `pnpm typecheck` | 23 任务全过 |
| 计费引擎单测 | `pnpm --filter @qmkvm/core test` | 76/76 |
| 存储层单测 | `pnpm --filter @qmkvm/storage test` | 11/11 |
| 冒烟脚本 | `pnpm --filter @qmkvm/worker exec tsx ../../scripts/smoke.ts` | 25 步全过 |

提交前四项必须全绿。UI 改动另需浏览器实测（登录 → 核心流程 → 中文文案）。

## 6. 环境变量速查（.env.example 为准）

| 分类 | 变量 | 必填 | 说明 |
|---|---|---|---|
| 核心 | `DATABASE_URL` | ✅ | MySQL 8 连接串 |
| 核心 | `APP_KEY` | ✅ | base64 32 字节；AES-256-GCM 加密支付密钥/证件号，轮换需重录网关配置 |
| 核心 | `REDIS_URL` | 推荐 | 无则限流/验证码降级进程内存、队列内联执行 |
| 核心 | `CORS_ORIGINS` / `COOKIE_DOMAIN` | 生产 | 前端来源白名单 / 跨子域会话共享 |
| 数据库 | `DATABASE_URL_RO` | 可选 | 只读从库；报表/导出/审计/dashboard 走从库，未配置回落主库 |
| 数据库 | `DATABASE_URL_STANDBY` | 可选 | 备库探测串（`system.replica_health` 复制告警用，需 REPLICATION CLIENT）；未配置只探测从库 |
| 数据库 | `REPLICA_LAG_ALERT_SECONDS` | 可选 | 复制延迟告警阈值（秒，缺省 60） |
| 存储 | `STORAGE_PROVIDER` | 缺省 local | `local` 本地盘（UPLOAD_DIR） / `s3` 对象存储 |
| 存储 | `STORAGE_S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET/BUCKET_PREFIX` | s3 时 | MinIO/OSS/COS 兼容，forcePathStyle |
| 队列 | `QUEUE_ROUTING` | 缺省单队列 | `split` 启用四队列分流（配合 worker --group） |
| OCR | `TESSERACT_LANG` / `TESSERACT_BIN` | 可选 | 缺省 `chi_sim+eng` / `tesseract`；缺失自动降级不阻断 |
| 通知 | `SMTP_*` / `ALIYUN_SMS_*` / `ALERT_WEBHOOK_URL` | 可选 | 邮件/短信/钉钉飞书告警 |
| 开发 | `DEV_MOCK_PAYMENTS` | 仅 dev | mock 支付网关；生产必须 false |
| 种子 | `SEED_ADMIN_USERNAME/PASSWORD` | 可选 | 初始管理员 |
| 前端 | `BRANDING_API_URL` | 可选 | www 构建期拉取品牌定制（指向 `GET /api/v1/public/settings`）；未配置降级 env/内置缺省。portal 运行时经 `NEXT_PUBLIC_API_URL` 自动拉取，无需此变量 |

## 7. 已知设计决策（不要"修复"它们）

1. **worker 每组注册全量 handler**：隔离靠队列路由 + 凭据环境变量，不靠删代码；单队列模式下主队列可能承载任何 job，全量注册是正确行为
2. **定时任务 scheduler 只由 tx 组注册**：避免 N 副本重复 upsert
3. **OCR 提交不阻断**：不一致不抛 422，改审核页标注（`ocr_status: matched/unavailable/processing`）
4. **`settingsCache` 进程内 60s**：副本间短暂不一致可接受，不为它上 Redis
5. **admin 无远程管理 worker 操作**：运维归编排层，管理后台只读展示
6. **`@qmkvm/storage` 零内部依赖**：保持可独立测试/复用

## 8. 待办与演进方向

- 压测脚本（`scripts/loadtest/`，k6 四链路）——详见 architecture-evolution.md §三 #7
- PDF 账单（P1）、2FA/TOTP（M2）、Open API / 事件 Webhook / Stripe / 子账户 / 英文界面（M3）
- 集群运行时验证清单见 architecture-evolution.md §七（需有 Docker 的机器）