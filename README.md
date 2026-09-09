# 启明智联业务管理系统

类 WHMCS 的云服务售卖与运营平台，为「启明智联 / QmKvm」提供从**在线销售到自动化交付**的完整闭环。

客户在门户选购弹性云服务器 → 支付宝/微信/余额支付 → 系统自动在 Proxmox VE 集群开通虚拟机并回填交付信息 → 到期自动提醒、逾期自动暂停、终止全自动执行 → 全程账单、发票、工单、通知、报表配套。

## 项目介绍

系统由五个应用与九个共享包组成：

| 应用 | 说明 | 端口（默认） |
| --- | --- | --- |
| `apps/www` | 品牌官网（Landing Page，中/英） | 3000 |
| `apps/portal` | 客户门户：注册登录、商品选购、购物车结算、收银台、服务管理、账单发票、工单、通知 | 3001 |
| `apps/admin` | 管理后台（Ant Design Pro）：客户/订单/服务/账务/发票/商品/供应模块/优惠码/工单/知识库/报表/审计/设置中心/计划任务 | 8000 |
| `apps/api` | Hono REST API：portal / admin / webhooks / public 四区，统一鉴权、限流、审计 | 4000 |
| `apps/worker` | BullMQ Worker（按任务域分组 `--group tx\|notify\|supply\|ocr`）：支付回调结算、供应任务执行、OCR 异步识别、11 个定时任务（续费/提醒/逾期/掉单补偿/清理/健康上报/复制健康探测） | — |

核心能力：

- **自动化交付**：供应模块机制（`manual` / `demo` / `http-api` 配置化 / **Proxmox VE** / **魔方财务代理商对接**），支付成功自动开通，续费自动同步远端（renew 任务），支持连接测试、失败追踪、退避重试、手动干预
- **弹性套餐**：商品可配置选项组（CPU/内存/硬盘/带宽/IP/地域/系统），按档位加价或按数量计价，门户实时联动报价
- **计费正确性**：金额全链路整数分、支付回调验签+双唯一键幂等、余额双式账本、日终掉单补偿
- **生命周期自动化**：续费账单生成、到期提醒（T-14/7/3/1）、余额自动续费、逾期暂停（D+3）、终止（D+15），全程可追溯
- **国内合规配套**：实名认证审核流（含身份证正面照上传 + OCR 异步识别核对）、增值税发票申请流程、短信签名复用站点名、通知模板可视化编辑与测试发送
- **安全**：RBAC 权限点矩阵（23 项）、写操作审计、敏感配置 AES-256-GCM 加密、图形验证码、速率限制、CSRF 防护
- **微服务化部署形态**：API 无状态多副本、worker 按任务域分组独立伸缩（交易/通知/供应/OCR，同一镜像不同启动参数）、用户资产对象存储（S3 兼容，本地盘缺省）、`GET /admin/system/status` 运行状态监控（API/DB/Redis 探活 + worker 心跳 + 队列积压）

## 技术栈

| 层 | 选型 |
| --- | --- |
| 语言 / 运行时 | TypeScript（严格模式）· Node.js ≥ 20 |
| Monorepo | pnpm workspaces + Turborepo |
| API | Hono + @hono/node-server + zod（@qmkvm/contracts 前后端共享契约） |
| 数据库 | MySQL 8（utf8mb4）+ Drizzle ORM + drizzle-kit 迁移 |
| 缓存 / 队列 | Redis 7 + BullMQ（按任务域分组：交易/通知/供应/OCR 四队列，`QUEUE_ROUTING=split` 启用，缺省单队列 `kvm`；指数退避，无 Redis 自动降级内存/内联） |
| 前端 | Next.js 16（App Router，portal/www）· React 19 · Tailwind CSS v4 · Ant Design Pro / umi max（admin）· recharts |
| 认证 | argon2id 密码哈希 · HttpOnly Cookie 会话（服务端 Session）· 图形验证码 · RBAC |
| 支付 | 支付宝官方 `alipay-sdk` · 微信支付 APIv3 官方 `wechatpay-axios-plugin` · 网关注册器（`registerGateway` 可扩展） |
| 供应 | Proxmox VE API（undici）· 配置化 HTTP 模块 · 任务原子领取/退避重试 |
| 存储 | 抽象层 `@qmkvm/storage`（put/get/delete/presign）· 本地盘（缺省）/ S3 兼容对象存储（MinIO/阿里 OSS/腾讯 COS，`@aws-sdk/client-s3`）双实现 |
| OCR | 身份证正面照识别（node-tesseract-ocr，`chi_sim+eng`）· GB11643 校验码验证 · 异步队列回写，tesseract 缺失自动降级不阻断 |
| 通知 | Nodemailer（SMTP 可视化配置）· 阿里云短信 · 站内信，模板 `{{变量}}` 渲染 + 测试发送 |
| 质量与运维 | Vitest（计费引擎单测）· ESLint · pino 结构化日志（敏感字段脱敏）· Docker Compose |

## 目录结构

```text
apps/          www 官网 · portal 门户 · admin 后台 · api 服务 · worker 定时任务（按域分组消费）
packages/      contracts 契约 · db 数据层 · core 领域逻辑（含队列路由/OCR）· auth 认证 · payments 支付
               provisioning 供应 · notifications 通知 · storage 存储抽象（本地盘/S3）· logger 日志 · config 共享配置
docker/        Dockerfile（node/next/admin）· nginx 配置 · 开发与生产 compose
docs/          PRD-billing（产品需求）· SPEC-P0（实现规格）· architecture-evolution（架构演进与集群部署方案）
scripts/       端到端冒烟脚本
```

## 快速开始（开发）

```bash
pnpm install
cp .env.example .env      # 填 DATABASE_URL / REDIS_URL，生成 APP_KEY（见 .env.example 注释）
pnpm db:migrate           # 建表
pnpm db:seed              # 管理员 admin / admin12345、示例商品、通知模板
pnpm dev:api              # http://localhost:4000
pnpm dev:portal           # http://localhost:3001
pnpm dev:admin            # http://localhost:8000（登录需图形验证码）
pnpm dev:www              # http://localhost:3000
pnpm dev:worker           # 定时任务（需 Redis；生产按 --group 分组，见 docs/deployment.md）
```

无 Redis 时 API 自动降级：限流走进程内存、队列任务内联执行，开发无需 Redis 也能跑通全链路。

## 部署方案

### 架构

微服务化高并发形态：API 无状态多副本，任务按域分组独立伸缩（交易 / 通知 / 供应 / OCR 四个 worker 组，同一镜像不同启动参数），用户资产走对象存储。完整架构图、改造点与实施顺序见 `docs/architecture-evolution.md`。

```text
                 ┌────────── L7 负载均衡（Nginx/云 LB，健康检查 /healthz）──────────┐
                 │      www 域名        portal 域名      admin 域名     api 域名     │
                 └───────┬──────────────────┬────────────────┬──────────┬─────────┘
                         ▼                  ▼                ▼          ▼
                    www(CDN)           portal(CDN)      admin(nginx)  API 副本 ×N（无状态）
                                                                           │
                                              ┌────────────────┬───────────┤
                                              ▼                ▼           ▼
                                     MySQL 主 + 只读副本   Redis Cluster   对象存储(S3/OSS/MinIO)
                                              ▲                │           证件照/工单附件
                                              └── worker ×N ───┘
                                       交易组 | 通知组 | 供应组(PVE 凭据隔离) | OCR 组
```

### 方式 A：Docker Compose（推荐）

```bash
# 1) 准备配置
cp .env.example .env   # 修改 DATABASE_URL / REDIS_URL / APP_KEY / CORS_ORIGINS / 各域名
                       # 生产必改：DEV_MOCK_PAYMENTS=false、SEED_ADMIN_PASSWORD、MYSQL_ROOT_PASSWORD

# 2) 构建并启动（MySQL/Redis 数据落 volume）
docker compose -f docker/docker-compose.prod.yml build
docker compose -f docker/docker-compose.prod.yml up -d mysql redis
docker compose -f docker/docker-compose.prod.yml exec api pnpm --filter @qmkvm/db migrate
docker compose -f docker/docker-compose.prod.yml exec api pnpm --filter @qmkvm/db seed
docker compose -f docker/docker-compose.prod.yml up -d

# 3) 验证
curl http://127.0.0.1:4000/healthz
```

服务端口仅绑定 `127.0.0.1`，公网访问经宿主机反向代理（`docker/deploy/` 提供示例）。管理后台建议额外加 IP 白名单或 VPN。

### 方式 B：源码 + PM2

```bash
pnpm install --frozen-lockfile
pnpm build                      # 三前端产物 + 全仓类型检查
pnpm db:migrate && pnpm db:seed
pm2 start "pnpm --filter @qmkvm/api start"    --name kvm-api
pm2 start "pnpm --filter @qmkvm/worker start" --name kvm-worker
# 三个前端均为纯静态产物，无 Node 常驻进程，由 Nginx 直接托管：
#   portal：apps/portal/out（SPA/静态导出，托管参考 docker/nginx-portal.conf）
#   admin：apps/admin/dist；www：apps/www/out（SSG，托管参考 docker/nginx-www.conf）
```

### 反向代理与 TLS

宿主机 Nginx 四个 server 块（www / portal / admin / api）：www/portal/admin 为静态产物（portal/www 静态导出，compose 部署时容器内已带 nginx，反代到 `127.0.0.1:3000/3001/8000` 即可；PM2 模式由宿主机 Nginx 直接 root 托管 out/ 与 dist/），api 反代到 `127.0.0.1:4000`。统一 301 到 HTTPS，`proxy_set_header X-Forwarded-For` 传递客户端 IP（限流依赖此头）。TLS 证书用 certbot 或云厂商免费证书，生产 `COOKIE_DOMAIN=.你的域名` 使 portal/api 跨子域共享会话。

### 升级发布

```bash
git pull
pnpm install --frozen-lockfile
pnpm db:migrate                 # 迁移只增不改，先于应用发布
docker compose -f docker/docker-compose.prod.yml up -d --build   # 或 pm2 reload all
```

### 备份与恢复

- MySQL：每日 `mysqldump --single-transaction` 全量 + binlog 增量，异地归档保留 ≥ 30 天
- 恢复：导入全量 + 重放 binlog 至目标时间点；Redis 仅承载队列/缓存，可清空重建
- 恢复演练每季度一次（PRD-billing §15）

### 生产安全清单

- [ ] `DEV_MOCK_PAYMENTS=false`、修改管理员初始密码
- [ ] `APP_KEY` 妥善保管（支付密钥/证件号解密依赖），轮换需重录网关配置
- [ ] Redis `--maxmemory-policy noeviction`（BullMQ 依赖）
- [ ] CORS_ORIGINS 收敛为真实域名；管理后台加 IP 白名单
- [ ] 支付宝/微信商户配置经后台「支付设置」加密录入并「连接测试」
- [ ] 上线前渗透测试（PRD-billing F14）

## 常用命令

```bash
pnpm build / typecheck / test      # 全量构建、类型检查（23 任务）、计费引擎+存储层单测
pnpm db:generate / migrate / seed / reset   # Schema 迁移与种子（reset 清库慎用）
pnpm --filter @qmkvm/worker task -- <任务名>   # 手动执行定时任务（如 renewal.invoices）
pnpm dev:www / dev:portal / dev:admin / dev:api / dev:worker
# worker 分组启动（生产形态；开发缺省 tx 组）：
pnpm --filter @qmkvm/worker start -- --group notify   # notify | supply | ocr
# 存储切换（缺省 local 本地盘，行为与历史版本一致）：
STORAGE_PROVIDER=s3 + STORAGE_S3_*                    # 见 .env.example
```

## 文档

- [PRD-billing.md](PRD-billing.md) —— 产品需求（里程碑、功能规格 F1~F14、审批项）
- [docs/development.md](docs/development.md) —— **开发者指南**：仓库结构、统一约定（契约/队列/存储/迁移）、常见开发任务操作指南、环境变量速查
- [docs/deployment.md](docs/deployment.md) —— **部署指南**：三种部署方式（Compose 标准版 / 集群版 / PM2）、主从数据库、对象存储迁移、升级回滚、备份、安全清单、FAQ
- [docs/SPEC-P0.md](docs/SPEC-P0.md) —— 实现规格（包接口契约、API 端点清单、环境变量）
- [docs/architecture-evolution.md](docs/architecture-evolution.md) —— 微服务化高并发架构：目标形态图、分阶段改造清单、集群部署与压测方案
- [docker/README-cluster.md](docker/README-cluster.md) —— 集群版部署手册（15 服务编排详解）
- [packages/provisioning/README.md](packages/provisioning/README.md) —— 供应模块接入（含 PVE 配置示例）
