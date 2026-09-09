# QmKvm 集群版部署手册（docker-compose.cluster.yml）

> 对应架构演进 #6（`docs/architecture-evolution.md` 第二节目标架构图）。
> 本编排是**单机多容器模拟集群样例**：同一台机器上用显式多服务模拟多副本与分组，
> 代码、镜像与 `docker-compose.prod.yml` 完全同源，差别只在副本数与拓扑。
> 生产集群（K8s / 多机）对应关系见本文第五节。

---

## 一、架构图（容器 → 架构图节点对照）

```
                          宿主机 80 端口（TLS 终结在宿主机外层）
                                   │
                    ┌──────────────▼──────────────┐
                    │ lb (nginx:1.27)             │  ← 架构图「L7 负载均衡」
                    │ /api → api-1/2/3 轮询        │     不启用 sticky session
                    │ /portal /admin / → 三前端    │     （API 无状态）
                    └──┬───────┬───────┬──────┬───┘
              ┌────────▼─┐┌────▼─────┐┌─▼──────┐┌▼─────────┐
              │ api-1    ││ api-2    ││ api-3  ││ (×N 扩容)│  ← 「API 副本 ×N」
              └────┬─────┘└────┬─────┘└───┬────┘└──────────┘
                   │  QUEUE_ROUTING=split 入队  │
        ┌──────────▼───────────────┬──────────┴──────────┐
        │ redis (BullMQ 持久化队列) │                     │
        └──────────┬───────────────┘                     │
   ┌───────────┬───┴──────────┬───────────────┐         │
┌──▼───────┐┌──▼─────────┐┌───▼──────────┐┌───▼──────┐  │
│worker-tx ││worker-notify││worker-supply ││worker-ocr│  │
│queue.kvm+││kvm-notify   ││kvm-supply    ││kvm-ocr   │  │
│kvm-tx    ││短信/邮件     ││PVE 凭据仅此组 ││CPU 限1.5核│  │
└──────────┘└─────────────┘└──────────────┘└──────────┘  │
        四组 = 同一 worker 镜像不同 --group 启动参数        │
                                                              │
┌──────────────────────┐   ┌──────────────────────────────▼─┐
│ mysql-master（主库）  │   │ minio + minio-init（建桶一次性） │
│ mysql-standby（半同步 │   │ ← 架构图「对象存储 S3/MinIO」    │
│   备，可提主）        │   └────────────────────────────────┘
│ mysql-readonly（从库）│
│ 链式复制：主→备→从    │
└──────────────────────┘
┌──────────────────┐
│ portal / www /   │  ← 三前端（portal/www 均为静态导出 + 静态 admin）
│ admin            │     生产建议静态走 CDN，这里用容器反代代替
└──────────────────┘
```

心跳验证：四组 worker 启动后每 30s 上报 `worker_heartbeats` 表，
admin 后台 `/admin/system/status` 应看到 `tx / notify / supply / ocr` 四组均在线。

---

## 二、前置变量清单（仓库根 `.env` 需要的项）

集群版相对标准版（prod）**新增/必须确认**的变量：

| 变量 | 必填 | 说明 |
|---|---|---|
| `MINIO_ROOT_USER` | 是 | MinIO 管理用户，同时也是 `STORAGE_S3_ACCESS_KEY` 的值 |
| `MINIO_ROOT_PASSWORD` | 是 | MinIO 管理密码，**同时填入 `STORAGE_S3_SECRET`**（两者一致，api 用后者连桶；读取走 presigned GET，桶保持私有，minio-init 不设匿名策略） |
| `STORAGE_PROVIDER` | 是 | 固定 `s3`（compose 已覆盖注入，但 .env 请同步改为 `s3` 保持一致） |
| `STORAGE_S3_ENDPOINT` | 是 | `http://minio:9000`（compose 已覆盖注入；生产换成云厂商端点） |
| `STORAGE_S3_BUCKET` | 是 | 桶名，`minio-init` 启动时自动创建 |
| `STORAGE_S3_ACCESS_KEY` / `STORAGE_S3_SECRET` | 是 | 与 MINIO_ROOT_USER / MINIO_ROOT_PASSWORD 保持一致 |
| `STORAGE_S3_REGION` | 否 | MinIO 填 `us-east-1` 或留空；云厂商按实际填 |
| `STORAGE_S3_BUCKET_PREFIX` | 否 | 多环境共用桶时的 key 前缀（如 `prod/`） |
| `PVE_*` | 仅供应功能需要 | **凭据隔离域：只应作用于 worker-supply 组**。注意 env_file 是全量注入，api 与其余 worker 进程同样看得到该变量（见第五节差异表第 4 条）；不需要供应功能时不要在 .env 配置 PVE_* |
| `CORS_ORIGINS` | 是 | 前端来源白名单。经 lb 同源访问可沿用现有值；跨子域部署时补齐 `https://www.example.com,https://portal.example.com,https://admin.example.com` |
| `COOKIE_DOMAIN` | 否 | 跨子域共享会话 Cookie 时设为 `.example.com`；同源单域名留空 |
| `DATABASE_URL` | 是 | 写入口。样例填 `mysql://user:pass@mysql-master:3306/qmkvm`（生产填 Keepalived VIP / 数据库代理 / 云 RDS 端点，切换时不变，见 deployment.md §7.2） |
| `MYSQL_REPL_PASSWORD` | 是 | MySQL 复制账号密码（主库建号与 mysql-replica-init 挂复制共用） |
| `DATABASE_URL_RO` | 否 | 指向 `mysql-readonly` 后报表/导出/审计/dashboard 走从库；不配置则读路径回落主库（单机零配置兼容） |
| `DATABASE_URL_STANDBY` | 否 | 指向 `mysql-standby`，worker 的 `system.replica_health` 复制健康告警探测备库；未配置只探测从库 |
| `REPLICA_LAG_ALERT_SECONDS` | 否 | 复制延迟告警阈值（秒，缺省 60） |
| `MYSQL_ROOT_PASSWORD`、`DATABASE_URL`、`REDIS_URL`、`APP_KEY` 等 | 是 | 与标准版一致，见 `.env.example` |

---

## 三、一键启动 / 扩缩

```bash
# 启动全部（首次会构建 api/worker/portal/www/admin 镜像，耗时较长）
docker compose -f docker/docker-compose.cluster.yml --env-file .env up -d

# 查看状态（等 30~60s 后全部应 healthy / running / exited(0, minio-init)）
docker compose -f docker/docker-compose.cluster.yml ps

# 经 lb 验证 API 池（curl 多次，nginx 默认轮询到 api-1/2/3）
curl -s http://localhost/healthz

# 验证 worker 分组心跳（连主库查看）
docker compose -f docker/docker-compose.cluster.yml exec mysql-master \
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" qmkvm \
  -e "SELECT \`group\`, host, last_seen_at FROM worker_heartbeats ORDER BY last_seen_at DESC;"

# 验证三节点复制（mysql-replica-init 完成后 exited(0)；备/从线程均 Yes、延迟 ≈0）
docker compose -f docker/docker-compose.cluster.yml exec mysql-standby \
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SHOW REPLICA STATUS\G" | grep -E "Running:|Seconds_Behind"

# 停止（-v 连卷一起删，MinIO 上传数据会清空；不加 -v 保留卷数据）
docker compose -f docker/docker-compose.cluster.yml down -v
```

**扩缩说明（单机局限与生产对应）：**

- `--scale` 对 `api-N` / `worker-*` **不生效**：它们是显式服务（`deploy.replicas`
  在无 Swarm 的单机 docker compose 下无效），扩 API 副本 = 在 compose 里追加
  `api-4` 服务 + lb upstream 加一行 `server api-4:4000;`。
- worker 组扩容同理：复制 `worker-notify` 服务改名（换 container_name）即可多副本；
  **worker-tx 至少保留 1 个副本**（repeatable 定时任务调度器只由 tx 组注册）。
- 真正的"一行扩容"是生产 K8s 的 `kubectl scale deployment api --replicas=N`
  （或 HPA 自动扩缩），见第五节映射表。

---

## 四、与标准版（docker-compose.prod.yml）的差异、何时切集群版

| 维度 | prod 标准版 | cluster 集群版 |
|---|---|---|
| API | 1 副本（宿主机 127.0.0.1:4000） | 3 副本，经 lb 轮询，不对宿主机暴露 |
| worker | 1 个（缺省 tx 组，单队列 kvm） | 四组独立服务（`--group` 分流，`QUEUE_ROUTING=split`） |
| 对象存储 | `.env` 自由配置（缺省本地盘） | 强制 S3（MinIO）+ 自动建桶 |
| 入口 | 各端口分别暴露到 127.0.0.1 | 统一 lb:80（TLS 留宿主机外层） |
| MySQL | 单库 | 三节点主备样例：`mysql-master`（半同步主）+ `mysql-standby`（备，可提主）+ `mysql-readonly`（从，只读读流量），链式复制 主→备→从，`mysql-replica-init` 自动挂复制；生产三台独立机 + VIP，见 deployment.md §7.2 |

**何时该切集群版：** 峰值持续 **> 500 QPS**、或出现明确的独立伸缩诉求
（如 OCR 识别排队、通知积压、PVE 供应阻塞交易链路）。低于该阈值时标准版更省资源，
且代码路径完全兼容（`QUEUE_ROUTING` 不设置即回落单队列）。

**压测入口（占位）：** 压测脚本与报告随交付物 #7 提供（`scripts/loadtest/`，
k6 覆盖登录/下单/回调/实名四链路）。本节届时更新实测数据；在此之前容量数字
请勿对外承诺（见 architecture-evolution.md 第六节口径要求）。

---

## 五、生产对应关系表（compose → K8s / 多机）

| 本文件服务 | 单机模拟手段 | 生产形态（K8s） | 生产要点 |
|---|---|---|---|
| `lb` | nginx 容器 + 内联 conf | Ingress（nginx-ingress）或云 LB | TLS 在边缘终结；upstream 改为 Service 名（无需列副本） |
| `api-1/2/3` | 显式三服务 + 固定 container_name | `Deployment api replicas:3` | HPA 按 CPU/QPS 扩缩；`/healthz` 作 readiness/liveness probe |
| `worker-tx/notify/supply/ocr` | 四个服务 + `command` 传 `--group` | 4 个 `Deployment`，`args: ["--group","xxx"]` | 各组独立 HPA；tx 组 `replicas>=1` 常驻 |
| `worker-supply` 凭据隔离 | 手册约定（见差异说明） | PVE_* 只放进 supply 的 `Secret` + Deployment env | api 与其他组进程**读不到**该 Secret（比 compose env_file 全量注入更严格） |
| `worker-ocr` CPU 限制 | `deploy.resources.limits`（compose v2 单机生效） | `resources.limits/requests` | 建议按图片并发量压测后定额 |
| `mysql-master` / `mysql-standby` / `mysql-readonly` | 三容器链式复制（主→备→从）+ 一次性 `mysql-replica-init` | 主备：主库 StatefulSet + 半同步备 + 只读副本（或云 RDS 高可用版） | 主备常置 read_only，VIP 只随"可写节点"漂移；搭建/切换 runbook 见 deployment.md §7.2，先 `mysqldump --source-data=2` 灌初始数据再挂复制 |
| `redis` | 单实例 + AOF | Redis Cluster（3 主 3 从起）或云 Redis | BullMQ 需要 `noeviction`，集群模式注意代理/集群客户端配置 |
| `minio` + `minio-init` | 单机 MinIO + 一次性建桶 job | 云 S3 兼容存储（OSS/COS/S3）或 MinIO 分布式 4 节点 | 删掉这两个服务，`STORAGE_S3_ENDPOINT` 指向云端点即可，其余不变 |
| `portal` / `www` / `admin` | 容器内反代 | 静态产物上传对象存储 + CDN（admin 可加 WAF/IP 白名单） | 静态托管后这三个容器可整体移除 |

**多机扩展：** 把 compose 网络换成 overlay（Swarm）或直接改 K8s；本文件所有
`container_name` 固定写法在多机下改为 DNS/Service 名，其余环境变量语义不变。

---

## 六、单机验证步骤（无 K8s 环境时）

```bash
# 1) 最小验证：minio + api-1 + lb（会连带拉起 mysql 三节点/replica-init/redis/minio-init 依赖）
docker compose -f docker/docker-compose.cluster.yml --env-file .env up -d minio api-1 lb

# 2) 等 30~60s 后检查状态
docker compose -f docker/docker-compose.cluster.yml ps
#    预期：mysql-master/standby/readonly healthy，mysql-replica-init exited(0)，
#          redis healthy，minio healthy，minio-init exited(0)，api-1 healthy，lb healthy

# 3) 经 lb 打健康检查（轮询命中 api-1）
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/healthz   # 预期 200

# 4) 验证完清理（-v 清掉 minio/mysql 三节点/redis 卷）
docker compose -f docker/docker-compose.cluster.yml down -v
#    若要保留数据库数据做多次验证，去掉 -v：down（仅停容器删网络，卷保留）
```

若 MinIO 镜像因网络拉取失败：注释掉 `minio` / `minio-init` 两服务，
`.env` 改 `STORAGE_PROVIDER=local`，并给 api 服务挂共享卷
（`- uploads-data:/app/apps/api/uploads`，多副本时挂同一卷保证文件互通）。
**生产推荐 S3 兼容对象存储**——本地盘模式只是单机降级方案（多副本/多机下
本地盘无法共享，是集群形态不推荐它的根本原因）。