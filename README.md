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
| `apps/worker` | BullMQ Worker：支付回调结算、供应任务执行、10 个定时任务（续费/提醒/逾期/掉单补偿/清理/健康上报） | — |

核心能力：

- **自动化交付**：供应模块机制（`manual` / `demo` / `http-api` 配置化 / **Proxmox VE**），支付成功自动开通，支持连接测试、失败追踪、退避重试、手动干预
- **弹性套餐**：商品可配置选项组（CPU/内存/硬盘/带宽/IP/地域/系统），按档位加价或按数量计价，门户实时联动报价
- **计费正确性**：金额全链路整数分、支付回调验签+双唯一键幂等、余额双式账本、日终掉单补偿
- **生命周期自动化**：续费账单生成、到期提醒（T-14/7/3/1）、余额自动续费、逾期暂停（D+3）、终止（D+15），全程可追溯
- **国内合规配套**：实名认证审核流、增值税发票申请流程、短信签名复用站点名、通知模板可视化编辑与测试发送
- **安全**：RBAC 权限点矩阵（23 项）、写操作审计、敏感配置 AES-256-GCM 加密、图形验证码、速率限制、CSRF 防护

## 技术栈

| 层 | 选型 |
| --- | --- |
| 语言 / 运行时 | TypeScript（严格模式）· Node.js ≥ 20 |
| Monorepo | pnpm workspaces + Turborepo |
| API | Hono + @hono/node-server + zod（@qmkvm/contracts 前后端共享契约） |
| 数据库 | MySQL 8（utf8mb4）+ Drizzle ORM + drizzle-kit 迁移 |
| 缓存 / 队列 | Redis 7 + BullMQ（单队列 `kvm`，指数退避，无 Redis 自动降级内存/内联） |
| 前端 | Next.js 16（App Router，portal/www）· React 19 · Tailwind CSS v4 · Ant Design Pro / umi max（admin）· recharts |
| 认证 | argon2id 密码哈希 · HttpOnly Cookie 会话（服务端 Session）· 图形验证码 · RBAC |
| 支付 | 支付宝官方 `alipay-sdk` · 微信支付 APIv3 官方 `wechatpay-axios-plugin` · 网关注册器（`registerGateway` 可扩展） |
| 供应 | Proxmox VE API（undici）· 配置化 HTTP 模块 · 任务原子领取/退避重试 |
| 通知 | Nodemailer（SMTP 可视化配置）· 阿里云短信 · 站内信，模板 `{{变量}}` 渲染 + 测试发送 |
| 质量与运维 | Vitest（计费引擎单测）· ESLint · pino 结构化日志（敏感字段脱敏）· Docker Compose |

## 目录结构

```text
apps/          www 官网 · portal 门户 · admin 后台 · api 服务 · worker 定时任务
packages/      contracts 契约 · db 数据层 · core 领域逻辑 · auth 认证 · payments 支付
               provisioning 供应 · notifications 通知 · logger 日志 · config 共享配置
docker/        Dockerfile（node/next/admin）· nginx 配置 · 开发与生产 compose
docs/          PRD-billing（产品需求）· SPEC-P0（实现规格）
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
pnpm dev:worker           # 定时任务（需 Redis）
```

无 Redis 时 API 自动降级：限流走进程内存、队列任务内联执行，开发无需 Redis 也能跑通全链路。

## 部署方案

### 架构

```text
                    ┌────────────── 宿主机 Nginx / Caddy（TLS 终结）──────────────┐
                    │  www 域名      portal 域名     admin 域名      api 域名      │
                    └──────┬──────────────┬──────────────┬──────────────┬─────────┘
                           ▼              ▼              ▼              ▼
                     www:3000       portal:3001    admin(nginx)     api:4000 ──► worker
                           └──────────────┴──────┬───────┴──────────────┘
                                           MySQL 8 · Redis 7（volume 持久化）
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
pm2 start "pnpm --filter @qmkvm/portal start" --name kvm-portal
pm2 start "pnpm --filter @qmkvm/www start"    --name kvm-www
# admin 为纯静态产物（apps/admin/dist），由 Nginx 直接托管
```

### 反向代理与 TLS

宿主机 Nginx 四个 server 块（www / portal / admin / api）分别反代到 `127.0.0.1:3000/3001/8000/4000`，统一 301 到 HTTPS，`proxy_set_header X-Forwarded-For` 传递客户端 IP（限流依赖此头）。TLS 证书用 certbot 或云厂商免费证书，生产 `COOKIE_DOMAIN=.你的域名` 使 portal/api 跨子域共享会话。

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
pnpm build / typecheck / test      # 全量构建、类型检查、计费引擎单测
pnpm db:generate / migrate / seed / reset   # Schema 迁移与种子（reset 清库慎用）
pnpm --filter @qmkvm/worker task -- <任务名>   # 手动执行定时任务（如 renewal.invoices）
pnpm dev:www / dev:portal / dev:admin / dev:api / dev:worker
```

## 文档

- [PRD-billing.md](PRD-billing.md) —— 产品需求（里程碑、功能规格 F1~F14、审批项）
- [docs/SPEC-P0.md](docs/SPEC-P0.md) —— 实现规格（包接口契约、API 端点清单、环境变量）
- [packages/provisioning/README.md](packages/provisioning/README.md) —— 供应模块接入（含 PVE 配置示例）
