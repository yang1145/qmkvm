#!/usr/bin/env bash
# 本地构建 → 经 SSH 隧道 push 到 VPS 私有 registry（增量传输，复用 Docker layer cache）
#
# 适用：VPS 上 docker build 依赖下载持续超时（npm/pnpm 网络不可达），但宿主机网络
#       （ssh/scp/git）正常的场景。构建放本地，发布走 registry，VPS 只做增量 pull。
#
# 原理：
#   - VPS 上 registry 容器只绑 127.0.0.1:5000，公网不可达 → 无需认证、无需 HTTPS
#   - 本地经 SSH 隧道把 localhost:5000 映射到 VPS 回环；Docker 对 localhost 豁免 TLS 校验
#     → 无需 docker login、无需配置 insecure-registries
#   - 首次 push 全量（总量 2-4GB，单流 SSH 传输）；之后仅传变更层（通常数百 MB）
#   - VPS 端 compose pull 从 127.0.0.1:5000 拉取（回环，瞬时；已有层自动复用）
#
# 用法（本地 Git Bash / WSL，需可 ssh 登录 VPS）：
#   scp root@<VPS_IP>:/www/qmkvm/.env ./.env    # 首次：取 VPS 的 .env（含构建期变量）
#   REGISTRY_HOST=root@<VPS_IP> bash scripts/publish-images.sh
set -euo pipefail

C_G="\033[32m"; C_Y="\033[33m"; C_R="\033[31m"; C_0="\033[0m"
say()  { echo -e "${C_G}[发布]${C_0} $*"; }
warn() { echo -e "${C_Y}[注意]${C_0} $*"; }
die()  { echo -e "${C_R}[失败]${C_0} $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker/docker-compose.prod.yml"
IMAGES=(gateway api worker portal www admin)
cd "$ROOT"

[ -n "${REGISTRY_HOST:-}" ] || die "用法: REGISTRY_HOST=<user@vps-ip> bash scripts/publish-images.sh"
command -v docker >/dev/null 2>&1 || die "本地未安装 Docker"
command -v ssh  >/dev/null 2>&1 || die "本地缺少 ssh 客户端"
[ -f .env ] || die "缺少 .env（本地构建需要其中的构建期变量），请先从 VPS 复制：
  scp ${REGISTRY_HOST}:/www/qmkvm/.env ./.env"
[ -f "$COMPOSE" ] || die "未找到 $COMPOSE"

# ---------- 1) VPS 确保 registry 容器在跑（只绑 127.0.0.1，不暴露公网） ----------
say "检查 ${REGISTRY_HOST} 上 registry 容器..."
ssh "$REGISTRY_HOST" '
  if ! docker ps -q -f name=^registry$ >/dev/null 2>&1; then
    echo "[发布] VPS 未发现 registry 容器，自动启动（127.0.0.1:5000）..."
    docker run -d --name registry --restart unless-stopped \
      -p 127.0.0.1:5000:5000 -v registry-data:/var/lib/registry registry:2
  fi
' || die "无法连接或操作 $REGISTRY_HOST（请确认可 ssh 登录且已安装 Docker）"

# ---------- 2) 构建期品牌变量（生产值，来自 VPS 生产 .env，不写入本地任何文件） ----------
_prod_branding_url="${BRANDING_API_URL:-}"
if [ -z "$_prod_branding_url" ]; then
  say "从 VPS 生产 .env 读取 BRANDING_API_URL..."
  _prod_branding_url="$(ssh "$REGISTRY_HOST" "grep -hE '^BRANDING_API_URL=' /www/qmkvm/.env ~/qmkvm/.env 2>/dev/null | head -n1 | cut -d= -f2-" || true)"
fi
if [ -n "$_prod_branding_url" ]; then
  export BRANDING_API_URL="$_prod_branding_url"
  say "BRANDING_API_URL=$_prod_branding_url"
  # 内容指纹：API 响应变化 → 指纹变化 → www 构建层缓存失效；内容没变则正常复用缓存
  _hash="$(curl -fsS --max-time 10 "$_prod_branding_url" | sha256sum | cut -d' ' -f1 || true)"
  if [ -n "$_hash" ]; then
    export BRANDING_HASH="$_hash"
    say "BRANDING_HASH=$_hash"
  else
    warn "无法计算品牌内容指纹（API 不可达？），www 可能以缓存中的旧品牌构建"
  fi
else
  warn "未获取到 BRANDING_API_URL（本地未 export 且 VPS .env 无此键），www 将以缺省品牌构建"
fi

# ---------- 3) 本地构建 ----------
say "本地构建全部服务镜像（docker compose build）..."
docker compose -f "$COMPOSE" --env-file .env build

# ---------- 4) SSH 隧道：本地 5000 → VPS 127.0.0.1:5000 ----------
say "建立 SSH 隧道 localhost:5000 → ${REGISTRY_HOST}:5000 ..."
ssh -N -L 5000:127.0.0.1:5000 "$REGISTRY_HOST" &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT
for _i in $(seq 1 15); do
  (echo >/dev/tcp/127.0.0.1/5000) 2>/dev/null && break
  sleep 1
done
(echo >/dev/tcp/127.0.0.1/5000) 2>/dev/null || die "SSH 隧道未就绪（请检查 ssh 登录与 VPS registry 状态）"

# ---------- 5) tag + push（首次全量，之后增量） ----------
for img in "${IMAGES[@]}"; do
  say "push qmkvm-$img:prod → registry ..."
  docker tag "qmkvm-$img:prod" "localhost:5000/qmkvm-$img:prod"
  docker push "localhost:5000/qmkvm-$img:prod"
done

say "全部镜像已发布完成。"
cat <<TIP

在 VPS 上执行部署：
  cd /www/qmkvm && git pull
  docker compose -f docker/docker-compose.prod.yml --env-file .env pull
  docker compose -f docker/docker-compose.prod.yml --env-file .env up -d

说明：
  - 首次部署请先跑 scripts/deploy-prod.sh（生成 .env 时会检测 registry 容器并自动
    选择拉取模式，跳过构建）；随后执行上面的 pull + up -d 完成启动。
  - 升级发布（已有 .env）：执行完本脚本后，在 VPS 重复 pull + up -d 即可，
    并执行迁移：docker compose -f docker/docker-compose.prod.yml --env-file .env \
      exec -T api pnpm --filter @qmkvm/db migrate
TIP
warn "SSH 隧道已关闭；推送过程未修改 VPS 上任何运行中容器，请按提示在 VPS 完成 pull + up"
