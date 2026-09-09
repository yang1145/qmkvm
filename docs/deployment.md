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
| 前置：数据库 | 全部方式 | MySQL 8 自建或云 RDS（单库起步，主备高可用见 §六.2） | §五 |
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
# 1) 构建（api/worker 共用 Dockerfile.node；portal 用 Dockerfile.next，
#    www 用 Dockerfile.www（SSG 静态导出），admin 用 Dockerfile.admin）
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

**品牌定制（logo / 站点名 / 版权 / 联系邮箱）**：入口在 admin「系统设置 → 站点信息」
（存 settings 表 key='site'，公开端点 `GET /api/v1/public/settings` 分发）。

- portal：运行时拉取（60s 缓存），admin 保存后自动生效
- www：静态导出无运行时，构建时经 `BRANDING_API_URL` 拉取烘焙（compose 的 www build args 已接线，
  在 `.env` 配 `BRANDING_API_URL=http://api:4000/api/v1/public/settings` 即可）；**改品牌后需重建 www 镜像**
- 未配置/拉取失败时构建自动降级为 `NEXT_PUBLIC_*` 环境变量与内置缺省，官网可独立构建

**API 多副本（标准版即可横向扩）**：API 无状态，`deploy: { replicas: N }` 或多起几个服务即可；前置负载均衡透传 `X-Forwarded-For`（限流依赖真实 IP）、健康检查 `/healthz`、**不用 sticky session**。多副本前必须 `STORAGE_PROVIDER=s3`（本地盘模式下副本间文件不可见）。

---

## 三、方式 B：集群版（微服务化形态）

18 服务：Nginx LB（轮询 API×3，无 sticky，XFF 透传）+ 四组 worker（`--group tx|notify|supply|ocr`，同一镜像不同启动参数）+ MinIO 建桶 + MySQL 三节点主备样例（主/半同步备/只读从，链式复制）+ Redis + 三前端。

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
pm2 save
# admin 为纯静态产物（apps/admin/dist）；www 为 SSG 静态导出（apps/www/out），
# 二者均由 Nginx 直接托管（www 参考 docker/nginx-www.conf：404 回退 + 静态资源长缓存）
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

### 6.2 数据库主备高可用（主 + 半同步备 + 只读从）

三节点形态：**写路径高可用（备库可提升）+ 读扩展（从库扛报表流量）**，读写分离是它的自然产物。
应用代码零改动——`DATABASE_URL` 指向"固定写入口"，`DATABASE_URL_RO` 指向从库，
`getDbRO()` 未配置时回落主库的既有逻辑保持单机零配置兼容。

```
                          ┌─ DATABASE_URL（写，固定入口 = VIP）──▶ mysql-master    半同步主
  api ×N / worker ×N ─────┤                                       mysql-standby  半同步备（不承载读，随时可提主）
                          └─ DATABASE_URL_RO（读）──────────────▶ mysql-readonly 异步从（报表/导出/审计/dashboard）
                                  复制链：master ─(半同步)─▶ standby ─(异步，log_replica_updates)─▶ readonly
```

**角色纪律（脑裂防护的根基）：** 备/从常置 `read_only` + `super_read_only`；
VIP 只被"mysqld 存活且 `read_only=0`"的节点持有；任何时刻**至多一个节点可写**。

**连接串约定：**

| 变量 | 指向 | 说明 |
|---|---|---|
| `DATABASE_URL` | VIP / 数据库代理 / 云 RDS 端点 | 故障转移发生在入口之下，切换时本值不变、应用不重启 |
| `DATABASE_URL_RO` | mysql-readonly | 报表/导出/审计/dashboard 10 处读路径；从库故障时可临时撤掉回落主库 |
| `DATABASE_URL_STANDBY` | mysql-standby | 可选，`system.replica_health` 复制健康告警探测用 |

#### 搭建步骤（自建生产）

**① my.cnf 基线**（参考 `docker/mysql/replication/*.cnf`；MySQL 8.0.26+/8.4 命名，8.0 旧名见括号）：

| 参数 | 主 | 备 | 从 | 说明 |
|---|---|---|---|---|
| `server_id` | 1 | 2 | 3 | 唯一 |
| `binlog_format=ROW`、`gtid_mode=ON`、`enforce_gtid_consistency=ON` | ✅ | ✅ | ✅ | GTID 自动定位的前提 |
| `log_replica_updates=ON`（旧名 log_slave_updates） | — | ✅ | — | 链式复制：从库挂备库；备库提主后继续带从 |
| `relay_log_recovery=ON`、`binlog_expire_logs_seconds≥259200` | ✅ | ✅ | ✅ | 断连追传缓冲 |
| `loose-rpl_semi_sync_source_enabled=1`、`_timeout=5000`、`_wait_for_replica_count=1`（旧名 rpl_semi_sync_master_*） | ✅ | — | — | 备库失联 5s 自动降级异步，写路径不被备库故障拖死 |
| `loose-rpl_semi_sync_replica_enabled=1`（旧名 rpl_semi_sync_slave_enabled） | — | ✅ | — | 备库作为半同步 ack 方 |
| `read_only=ON` + `super_read_only=ON` | — | ✅ | ✅ | 提主/维护时按 runbook 显式解除 |
| `innodb_flush_log_at_trx_commit=1` + `sync_binlog=1` | ✅ | ✅ | ✅ | 资金库双 1，防误改 |

**② 半同步插件与复制账号**（主库）：

```sql
INSTALL SONAME 'semisync_source.so';   -- 8.0 旧名 semisync_master.so
INSTALL SONAME 'semisync_replica.so';  -- 备库用；备库上执行同款
CREATE USER 'repl'@'192.168.%' IDENTIFIED BY '<强密码>';
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'repl'@'192.168.%';
```

**③ 灌初始数据并挂复制**（链式：备挂主、从挂备）：

```bash
# 主库导出（--source-data=2 记录 GTID 位点；主库短暂 FLUSH TABLES WITH READ LOCK）
mysqldump --single-transaction --source-data=2 -A -uroot -p > dump.sql
# 分别灌入备库、从库后，各自执行（SOURCE_HOST 分别填主库/备库 IP）：
CHANGE REPLICATION SOURCE TO SOURCE_HOST='<上游IP>', SOURCE_USER='repl',
  SOURCE_PASSWORD='<密码>', SOURCE_AUTO_POSITION=1, GET_SOURCE_PUBLIC_KEY=1;
START REPLICA;
```

**④ 写入口（Keepalived VIP）**：主备两台装 Keepalived（主 priority 150 / 备 100，`nopreempt`），
探测脚本用 `docker/mysql/replication/check_master.sh`——**只有 mysqld 存活且 `read_only=0`
的节点才持有 VIP**。云上不支持 VRRP 时改用 MySQL Router/ProxySQL 或云 RDS 高可用版，
`DATABASE_URL` 指向其固定端点，其余步骤不变。

**⑤ 验证**：

```sql
-- 从库/备库各执行：IO/SQL 线程均 Yes，Seconds_Behind_Source ≈ 0
SHOW REPLICA STATUS\G
-- 主库：Rpl_semi_sync_source_clients ≥ 1，status=yes 且随写入增长
SHOW STATUS LIKE 'Rpl_semi_sync_source%';
```

#### 计划内切换 runbook（主备轮换，应用零重启）

1. **预检**：从库 `Seconds_Behind_Source=0`；主库无长事务（`information_schema.innodb_trx`）
2. **旧主停写**：`SET GLOBAL read_only=1`（VIP 探测随即失配，自动让出入口）
3. **备库追平**：确认 GTID 差值=0（`SHOW REPLICA STATUS` 的 Retrieved/Executed 对比）
4. **提升**：备库 `STOP REPLICA; RESET REPLICA ALL;` → `SET GLOBAL super_read_only=0; SET GLOBAL read_only=0;`
5. VIP 漂移至新主（Keepalived 按探测条件自动接管）；**从库不动**（链式复制指向不变，GTID 自动续传）
6. 旧主作为新备挂新主（`CHANGE REPLICATION SOURCE TO ... SOURCE_AUTO_POSITION=1; START REPLICA;`）
7. 冒烟验证：`/admin/system/status` db.ok、一笔测试交易、报表仍走从库

预期表现：切换窗口内进行中的请求短暂报错（秒级），用户重试即可；支付回调由
`gateway_events` 幂等 + BullMQ 退避重试兜底，不重不漏。

#### 紧急故障转移 runbook（主库宕机）

1. **先防脑裂**：旧主若仍可达，立即 `read_only=1` 或直接停 mysqld——宁可误杀不可双主
2. 确认备库已收全 GTID（半同步保证已 ack 的事务不丢）
3. 提升备库（同计划内切换第 4 步）；VIP 已由 Keepalived 漂移
4. 从库不动；旧主恢复后**只能作为新备加入**，禁止直接接回写路径

#### 故障矩阵

| 故障 | 写路径 | 动作 | RTO / RPO |
|---|---|---|---|
| 主库宕机 | 中断→报错（用户重试，回调幂等+worker 退避兜底） | 提升备库 | ~3-5 min / ≈0 |
| 备库宕机 | 正常（半同步 5s 超时降级异步） | 修复后重建为新备；从库临时改挂主库（一步 `CHANGE REPLICATION SOURCE`） | 即时 / 降级窗口由对账兜底 |
| 从库宕机 | 不受影响；报表/导出/dashboard 报错 | 重建从库，或临时撤 `DATABASE_URL_RO` 回落主库 | 即时 / — |
| 主+备宕机 | 中断 | 从库数据抢救或备份恢复 | 小时级 / 由备份决定 |

#### 监控与告警

- worker 内置任务 **`system.replica_health`**（每 5 分钟）：探测从库（`DATABASE_URL_RO`）
  与备库（`DATABASE_URL_STANDBY`，可选）的 IO/SQL 线程与 `Seconds_Behind_Source`，
  超过 `REPLICA_LAG_ALERT_SECONDS`（缺省 60s）或线程断开时推送 `ALERT_WEBHOOK_URL`；
  状态转变时推送一次，连续异常不重复推送
- 探测账号最小权限：`GRANT REPLICATION CLIENT ON *.* TO 'monitor'@'worker-ip'`
- 详见 §6.5 与 `apps/worker/src/tasks/replica-health.ts`

#### 备份策略（主备形态下的调整）

- 每日全量 `mysqldump --single-transaction` **改从从库取**（为主备减负）；binlog 增量仍从主库归档
- 备库不替代备份：误删/逻辑损坏会原样复制到备/从，恢复仍靠全量+binlog 重放（§6.4）

#### 集群样例与云 RDS 对应

- compose 集群样例已内置三节点（`mysql-master`/`mysql-standby`/`mysql-readonly`，链式复制，
  `mysql-replica-init` 一次性任务自动挂复制，配置见 `docker/mysql/replication/`）；
  样例为空库直启复制，生产按本节 ③ 先灌数据
- 云 RDS 高可用版：搭建/切换/VIP 全部由云托管，`DATABASE_URL` 指向 RDS 代理端点、
  `DATABASE_URL_RO` 指向只读地址即可，无需自建半同步与 Keepalived

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
- 复制健康：`system.replica_health` 每 5 分钟探测备/从库复制线程与延迟（主备形态，见 §6.2）
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
| 后台报表/审计打不开（500） | 只读从库宕机或未追平 | §6.2：重建从库，或临时撤 `DATABASE_URL_RO` 回落主库 |
| 收到"复制健康告警" | 备/从复制延迟超阈值或线程断开 | §6.2 监控小节：`SHOW REPLICA STATUS` 排错；线程断开按搭建步骤 ③ 重挂 |