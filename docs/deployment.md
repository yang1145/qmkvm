# QmKvm 部署指南

> 覆盖从单机最小部署到微服务化集群的多种方式。所有方式共享同一套镜像/构建产物，差异只在副本数与配置。
> 单机部署完全兼容缺省配置，不需要为"将来上集群"预做任何事。
> 配套：[集群版手册](../docker/README-cluster.md)（本文集群方式 B 的展开）· [开发者指南](development.md)

---

## 0. 部署方式选择

| 方式 | 适用规模 | 特点 | 参考章节 |
|---|---|---|---|
| A. Docker Compose（标准版） | ≤ 1 万客户，峰值 < 500 QPS | 单机一键起，最简运维 | §二 |
| B. Docker Compose（集群版） | 1~10 万客户，需要独立伸缩 | LB + API×3 + 四组 worker + MinIO | §三 / README-cluster.md |
| C. 源码 + PM2 | 无 Docker 环境 / 定制构建 | 手工依赖管理 | §四 |
| 前置：数据库 | 全部方式 | MySQL 8 自建或云 RDS（主从见 §六） | §五 |
| 前置：对象存储 | 集群版必选 | S3 兼容（MinIO/OSS/COS） | §六.3 |

---

## 一、准备（所有方式共用）

### 1.1 环境要求

- Node.js ≥ 20（源码方式）；Docker Engine ≥ 24（compose 方式）
- MySQL 8.x（`utf8mb4`）；Redis 7.x（**必须 `--maxmemory-policy noeviction`**，BullMQ 依赖）
- 反向代理（Nginx/Caddy）+ TLS 证书；一个或多个域名（如 `www.example.com` / `portal.example.com` / `admin.example.com` / `api.example.com`）

### 1.2 配置文件

```bash
cp .env.example .env    # 然后按下表修改
```

**必改项**：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | MySQL 连接串（生产建议独立账号，最小权限） |
| `APP_KEY` | `openssl rand -base64 32` 生成；加密支付密钥/证件号，**丢失即数据不可解**，轮换需重录网关配置 |
| `REDIS_URL` | 生产必配（限流/验证码/队列的分布式后端） |
| `CORS_ORIGINS` | 收敛为真实前端域名列表（逗号分隔） |
| `COOKIE_DOMAIN` | `.example.com` 形式——portal 与 api 跨子域共享会话**必设**，否则出现"登录成功即掉线" |
| `NODE_ENV=production` / `DEV_MOCK_PAYMENTS=false` | mock 网关必须关闭 |
| `SEED_ADMIN_PASSWORD` | 初始管理员密码（首登后修改） |

**按需项**：短信（`ALIYUN_SMS_*`）、邮件（`SMTP_*`）、告警（`ALERT_WEBHOOK_URL`）、对象存储（`STORAGE_*`，见 §六.3）、只读副本（`DATABASE_URL_RO`，见 §六.2）。

完整变量说明见 `.env.example` 注释与[开发者指南 §6](development.md)。

### 1.3 数据库初始化

迁移只增不改、可重复执行；种子幂等。

```bash
pnpm db:migrate          # 或 compose 方式：docker compose exec api pnpm --filter @qmkvm/db migrate
pnpm db:seed             # 管理员/角色/示例商品/通知模板
```

---

## 二、方式 A：Docker Compose 标准版（推荐起步）

```bash
# 1) 构建（api/worker 共用 Dockerfile.node；portal/www/admin 各自镜像）
docker compose -f docker/docker-compose.prod.yml build

# 2) 起依赖并初始化
docker compose -f docker/docker-compose.prod.yml up -d mysql redis
docker compose -f docker/docker-compose.prod.yml exec api pnpm --filter @qmkvm/db migrate
docker compose -f docker/docker-compose.prod.yml exec api pnpm --filter @qmkvm/db seed

# 3) 全量启动
docker compose -f docker/docker-compose.prod.yml up -d

# 4) 验证
curl http://127.0.0.1:4000/healthz
```

服务端口仅绑定 `127.0.0.1`，公网经宿主机反代（`docker/deploy/` 有 Nginx 示例）。管理后台建议加 IP 白名单或 VPN。

**API 多副本（标准版即可横向扩）**：API 无状态，`deploy: { replicas: N }` 或多起几个服务即可；前置负载均衡透传 `X-Forwarded-For`（限流依赖真实 IP）、健康检查 `/healthz`、**不用 sticky session**。多副本前必须 `STORAGE_PROVIDER=s3`（本地盘模式下副本间文件不可见）。

---

## 三、方式 B：集群版（微服务化形态）

15 服务：Nginx LB（轮询 API×3，无 sticky，XFF 透传）+ 四组 worker（`--group tx|notify|supply|ocr`，同一镜像不同启动参数）+ MinIO 建桶 + MySQL（只读副本可选块）+ Redis + 三前端。

```bash
docker compose -f docker/docker-compose.cluster.yml build
docker compose -f docker/docker-compose.cluster.yml up -d
# 验证（四步详见 docker/README-cluster.md）
docker compose -f docker/docker-compose.cluster.yml ps
curl -s http://<lb>/healthz
```

要点与差异（详见 [docker/README-cluster.md](docker/README-cluster.md)）：

- **worker 分组**：`tx`（交易/定时任务，**至少保留 1 副本**——定时调度器只有 tx 组注册）、`notify`（短信/邮件独立节奏）、`supply`（**PVE 凭据只配给本组**）、`ocr`（重 CPU，可限核）
- **凭据边界**：`PVE_*` 环境变量只注入 supply 组；单机 compose 是近似隔离（env_file 全量注入），生产 K8s 用 Secret 只挂 supply Deployment
- **对象存储**：内置 MinIO 样例（私有桶，读取走 presigned URL）；生产可换阿里 OSS/腾讯 COS
- **扩缩**：加副本 = compose 加服务 + lb upstream 加行；生产对应 K8s `Deployment replicas`
- **何时切换**：标准版峰值 > 500 QPS，或某类任务（如 OCR）成为瓶颈需要独立伸缩时

---

## 四、方式 C：源码 + PM2

```bash
pnpm install --frozen-lockfile
pnpm build                      # 三前端产物 + 全仓类型检查
pnpm db:migrate && pnpm db:seed
pm2 start "pnpm --filter @qmkvm/api start"    --name kvm-api -i 3   # -i 3 = 3 副本 cluster 模式
pm2 start "pnpm --filter @qmkvm/worker start" --name kvm-worker-tx  # --group tx
pm2 start "pnpm --filter @qmkvm/worker start -- --group notify" --name kvm-worker-notify
pm2 start "pnpm --filter @qmkvm/worker start -- --group supply" --name kvm-worker-supply
pm2 start "pnpm --filter @qmkvm/worker start -- --group ocr"    --name kvm-worker-ocr
pm2 start "pnpm --filter @qmkvm/portal start" --name kvm-portal
pm2 start "pnpm --filter @qmkvm/www start"    --name kvm-www
pm2 save
# admin 为纯静态产物（apps/admin/dist），由 Nginx 直接托管
```

PM2 注意：`-i N` cluster 模式下 `mysql2`/`ioredis` 每进程独立连接池，连接数 = N × pool(10)，按 DB `max_connections` 反推副本上限。

---

## 五、反向代理与 TLS

四个 server 块（www / portal / admin / api）分别反代到内网端口，统一 301 HTTPS：

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # 限流依赖真实 IP，必设
    proxy_set_header Host $host;
}
```

- TLS 用 certbot 或云厂商免费证书
- **集群版 LB 层**：同样透传 XFF；**不启用 sticky session**（API 无状态是扩容前提）
- admin 域名建议额外 IP 白名单或 VPN

---

## 六、生产配套

### 6.1 升级发布

```bash
git pull
pnpm install --frozen-lockfile
pnpm db:migrate                 # 迁移先于应用发布，只在单点执行（CI 或第一台机），禁止多副本并行跑
docker compose -f <对应compose> up -d --build   # 或 pm2 reload all
```

**回滚**：应用回滚 = 切回上一镜像 tag / `git checkout` 上一 release；迁移以"只增不改"为前提，回滚应用一般无需回滚库。重大变更前 `mysqldump` 全量。

### 6.2 数据库主从（读写分离）

应用侧已支持：`DATABASE_URL_RO` 指向从库后，报表/导出/审计检索/dashboard 自动走从库；未配置回落主库。

- 搭建（生产）：主库开 binlog + GTID → 从库 `CHANGE REPLICATION SOURCE TO ...` → 灌初始数据（`mysqldump --single-transaction --source-data=2`）
- 只读账号最小权限：`SELECT` on `qmkvm.*`
- 验证：从库 `SHOW REPLICA STATUS\G`（`Seconds_Behind` 应≈0）；慢查询日志确认 reports 查询落在从库
- 延迟敏感说明：这些读路径均为可容忍延迟的展示/检索；审核操作等强一致读固定走主库，无需额外配置

### 6.3 对象存储（S3 兼容）

```env
STORAGE_PROVIDER=s3
STORAGE_S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com   # 或 MinIO: http://minio:9000
STORAGE_S3_BUCKET=qmkvm-files
STORAGE_S3_ACCESS_KEY=...
STORAGE_S3_SECRET=...
STORAGE_S3_REGION=...      # 按云商
```

- 桶保持**私有**：读取经 admin 端点 302 → 5 分钟 presigned URL（MinIO 用 `forcePathStyle`）
- **历史数据迁移**（本地盘 → S3）：`packages/storage/src/migrate-local.ts` 遍历 `UPLOAD_DIR` 上传并输出 key 映射报告——先跑报告人工确认，再按报告二次确认；读侧自动兼容旧绝对路径
- MinIO 生产建议 4 节点分布式或直接用云厂商 OSS/COS

### 6.4 备份与恢复

- MySQL：每日 `mysqldump --single-transaction` 全量 + binlog 增量，异地归档 ≥ 30 天
- 对象存储：启用版本化/跨区复制（云商能力）
- 恢复：导入全量 + 重放 binlog 至目标时间点；Redis 仅承载队列/缓存/会话，可清空重建（用户重新登录）
- 恢复演练每季度一次

### 6.5 监控与告警

- 存活：LB 健康检查 `/healthz`；**应用内监控**：admin 仪表盘"系统运行状态"卡片 + `GET /api/v1/admin/system/status`（API/DB/Redis 探活 + 四组 worker 心跳在线 + 队列积压）
- 任务失败：`system.job_health` 每日汇总 `job_runs` 失败，`ALERT_WEBHOOK_URL` 推钉钉/飞书
- 可选：Prometheus `/metrics`（预留，未实现）

### 6.6 生产安全清单

- [ ] `DEV_MOCK_PAYMENTS=false`；修改管理员初始密码
- [ ] `APP_KEY` 妥善保管并离线备份（丢失 = 支付密钥/证件号不可解密）
- [ ] Redis `--maxmemory-policy noeviction`（BullMQ 依赖持久化语义）
- [ ] `CORS_ORIGINS` 收敛为真实域名；管理后台加 IP 白名单或 VPN
- [ ] `COOKIE_DOMAIN` 正确设置（多子域部署必查项）
- [ ] `STORAGE_PROVIDER=s3`（多副本场景），桶私有、presign 短时效
- [ ] PVE 凭据只存在于 supply worker 进程环境
- [ ] 支付宝/微信商户配置经后台「支付设置」加密录入并「连接测试」
- [ ] 上线前渗透测试（PRD-billing F14）

---

## 七、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 登录成功即跳回登录页 | `COOKIE_DOMAIN` 未设/错误 | §一.1.2 表格 |
| 后台看不到用户上传的证件照 | 多副本但仍是本地盘模式 | `STORAGE_PROVIDER=s3` + §六.3 迁移脚本 |
| 队列任务大量 failed | worker 未启动或组未订阅该队列 | `/admin/system/status` 看各组在线与积压；缺省单队列模式下 tx 组兜底全部 |
| 实名一直显示"OCR 识别中" | worker-ocr 未启动（或 tesseract 未安装） | 部署 tesseract + `chi_sim` 语言包，或接受 unavailable 降级走人工审核 |
| 限流把正常用户挡了 | LB 未透传 X-Forwarded-For | §五 |
| 供应任务卡 pending | PVE 凭据未配置在 supply 组 / PVE 连接失败 | 后台「供应模块」连接测试；确认凭据只在 supply 组环境 |