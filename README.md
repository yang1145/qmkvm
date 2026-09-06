# 拼好机 Monorepo

品牌官网 + 云业务系统（类 WHMCS：售卖 / 计费 / 客户门户 / 管理后台 / 自动化）。

## 结构

```text
apps/
  www/       官网 Landing Page（Next.js 16，中文/英文）
  portal/    客户门户（登录、购买、支付、服务管理、工单）
  admin/     管理后台（商品、订单、账务、工单、RBAC、审计）
  api/       Hono API 服务（REST，portal/admin/webhooks/public 分区）
  worker/    BullMQ Worker + 定时任务（续费/逾期/对账/供应）
packages/
  contracts/ zod DTO、错误码、权限点（前后端共享）
  db/        Drizzle Schema + 迁移 + Redis 单例
  core/      领域逻辑：计费、订单、账单、余额、生命周期、升级折算
  auth/      密码/会话/短信验证码/RBAC/限流
  payments/  支付网关抽象（支付宝/微信 v3/mock）+ 回调幂等管线
  provisioning/ 供应模块（manual / http-api / demo）+ 任务执行器
  notifications/ 邮件/短信/站内信模板发送
  logger/    pino 结构化日志（敏感字段脱敏）
  config/    共享 tsconfig
docs/SPEC-P0.md  P0 实现规格（共享契约）
PRD.md           官网 PRD
PRD-billing.md   云业务系统 PRD
```

## 快速开始

```bash
# 0) 依赖
pnpm install

# 1) 环境变量
cp .env.example .env   # 修改 DATABASE_URL / APP_KEY（生成命令见 .env.example 内注释）

# 2) 数据库（使用 docker 或远程 MySQL）
docker compose -f docker/docker-compose.yml up -d   # 可选：本地 MySQL+Redis

# 3) 迁移 + 种子
pnpm db:migrate
pnpm db:seed        # 默认管理员 admin / admin12345（上线必改）

# 4) 启动（各终端）
pnpm dev:api        # http://localhost:4000
pnpm dev:portal     # http://localhost:3001
pnpm dev:admin      # http://localhost:3002
pnpm dev:worker     # 定时任务（需 Redis；无 Redis 时 API 内联执行队列）
pnpm dev:www        # http://localhost:3000 官网
```

无 Redis 时：API 的队列降级为进程内联执行（注册于 `apps/api/src/wiring.ts`），限流降级为进程内存；`pnpm --filter @pinhaoji/worker task <任务名>` 可手动触发定时任务联调。

## 常用命令

```bash
pnpm build         # 全量构建（turbo）
pnpm typecheck     # 全量类型检查
pnpm test          # 单元测试（core 计费引擎等）
pnpm db:generate   # schema 变更后生成迁移
pnpm db:migrate    # 执行迁移
pnpm db:seed       # 幂等种子数据
```

## 部署要点

- 全链路金额为整数分；支付回调验签 + `gateway_events` 幂等 + 事务结算。
- 敏感配置（支付网关密钥、证件号）AES-256-GCM 加密存储（`APP_KEY`）。
- 生产：`DEV_MOCK_PAYMENTS=false`，`COOKIE_DOMAIN=.pinhaoji1.cn`，管理后台建议独立子域 + IP 白名单。
- **Redis 必须使用 `noeviction` 淘汰策略**（BullMQ 队列/调度 key 被逐出会丢任务）；远程实例若是 volatile-lru 需先调整。
- 备份：MySQL 每日全量 + binlog；恢复演练见 PRD-billing §15。
