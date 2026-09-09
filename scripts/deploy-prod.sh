#!/usr/bin/env bash
# 启明智联 prod 路线一键部署：干净 Linux VPS → 交互引导收集配置 → 自动安装部署
#
# 用法（root）：
#   git clone https://github.com/yang1145/qmkvm.git && cd qmkvm
#   bash scripts/deploy-prod.sh
#   重新配置/升级：再次运行即可（已有 .env 会预填旧值，回车沿用）
#
# 流程：环境自检（Docker 安装）→ 交互收集（域名/邮箱/品牌/密码，其余自动生成）
#       → 写 .env(600) → compose build+up → 迁移与种子 → 冒烟 → 部署摘要
# 前提：DNS 已将 www/portal/admin/api 四个子域 A 记录指向本机（未生效不阻断，
#       gateway 会后台重试签发证书）；最低配置 2C/4G；80/443 未被占用
set -euo pipefail

# ---------- 输出辅助 ----------
C_G="\033[32m"; C_Y="\033[33m"; C_R="\033[31m"; C_B="\033[1;36m"; C_0="\033[0m"
say()  { echo -e "${C_G}[部署]${C_0} $*"; }
warn() { echo -e "${C_Y}[注意]${C_0} $*"; }
die()  { echo -e "${C_R}[失败]${C_0} $*" >&2; exit 1; }
hr()   { echo -e "${C_B}--------------------------------------------------------------${C_0}"; }

# ---------- 0) 前置检查 ----------
[ "$(uname -s)" = "Linux" ] || die "仅支持 Linux 服务器"
[ "$(id -u)" = "0" ] || die "请用 root 运行：sudo -i 后重试，或 sudo bash scripts/deploy-prod.sh"

# 仓库根 = 脚本所在目录的上一级
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker/docker-compose.prod.yml"
[ -f "$ROOT/$COMPOSE" ] || die "未找到 $COMPOSE，请在仓库目录内运行"
cd "$ROOT"

echo -e "${C_B}"
cat <<'BANNER'
  ┌─────────────────────────────────────────────┐
  │     启明智联 · 生产环境一键部署（prod）        │
  │   api + worker + mysql + redis + www/portal/  │
  │        admin + gateway（自动 HTTPS）          │
  └─────────────────────────────────────────────┘
BANNER
echo -e "${C_0}"

# ---------- 1) Docker 安装 ----------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  say "Docker 已安装：$(docker --version)"
else
  say "未检测到 Docker，开始安装（官方脚本，约 1-2 分钟）..."
  command -v curl >/dev/null 2>&1 || {
    if command -v apt-get >/dev/null 2>&1; then apt-get update -qq && apt-get install -y -qq curl >/dev/null
    else die "缺少 curl 且非 apt 系统，请手动安装 Docker 后重试"; fi
  }
  curl -fsSL https://get.docker.com | sh
  command -v docker >/dev/null 2>&1 || die "Docker 安装失败，请手动安装后重试"
  say "Docker 安装完成：$(docker --version)"
fi

# ---------- 2) 配置收集 ----------
ask() { # ask 变量名 提示 默认值
  local __v; read -r -p "$2 [$3]: " __v; echo "${__v:-$3}"
}
ask_secret() { # ask_secret 变量名 提示（换行走 stderr，避免混入命令替换捕获值）
  local __v; read -r -s -p "$2（回车=自动生成）: " __v; echo >&2; echo "$__v"
}
gen() { openssl rand "$1" 2>/dev/null || head -c 64 /dev/urandom | base64; }

hr; say "开始收集配置（回车接受默认值）"; hr

# 已有 .env → 读旧值作默认
if [ -f .env ]; then
  warn "检测到已有 .env，将预填旧值（回车沿用）"
  . ./.env
  _old_domain="${DOMAIN_BASE:-}"; _old_email="${ACME_EMAIL:-}"
  _old_brand="${NEXT_PUBLIC_BRAND_NAME:-}"; _old_brand_en="${NEXT_PUBLIC_BRAND_NAME_EN:-}"
else
  _old_domain=""; _old_email=""; _old_brand=""; _old_brand_en=""
fi

DOMAIN_BASE="$(ask DOMAIN_BASE "主域名（如 example.com，将使用 www./portal./admin./api. 四个子域）" "${_old_domain:-}")"
[ -n "$DOMAIN_BASE" ] || die "主域名不能为空"
case "$DOMAIN_BASE" in http*|*/*|*\ *) die "主域名只填域名本身，如 example.com" ;; esac

ACME_EMAIL="$(ask ACME_EMAIL "证书注册邮箱（Let's Encrypt，用于到期提醒）" "${_old_email:-}")"
[ -n "$ACME_EMAIL" ] || die "证书邮箱不能为空"

NEXT_PUBLIC_BRAND_NAME="$(ask BRAND_NAME "品牌名（中文，官网展示；可回车跳过、后续在 admin 配置）" "${_old_brand:-}")"
NEXT_PUBLIC_BRAND_NAME_EN="$(ask BRAND_NAME_EN "品牌名（英文，可回车跳过）" "${_old_brand_en:-}")"

say "检测 DNS 解析（未生效不阻断，gateway 会自动重试签发证书）..."
_dns_ok=1
for _s in www portal admin api; do
  if getent hosts "$_s.$DOMAIN_BASE" >/dev/null 2>&1; then
    say "  $_s.$DOMAIN_BASE → $(getent hosts "$_s.$DOMAIN_BASE" | awk '{print $1}' | head -1)"
  else
    _dns_ok=0; warn "  $_s.$DOMAIN_BASE 尚未解析，请到域名商后台添加 A 记录指向本机公网 IP"
  fi
done
[ "$_dns_ok" = "1" ] || { echo -e "${C_Y}本机公网 IP（对照用）：$(curl -fs4 https://ifconfig.me 2>/dev/null || echo 未知)${C_0}"; read -r -p "已了解，继续安装？[Y/n]: " _go; [ "${_go:-Y}" = "Y" ] || [ "${_go:-Y}" = "y" ] || die "已中止"; }

# 密钥与密码（自动生成；管理员密码允许自定义）
APP_KEY="$(gen -base64 32)"
MYSQL_ROOT_PASSWORD="$(gen -hex 16)"
SEED_ADMIN_PASSWORD="$(ask_secret SEED_ADMIN_PASSWORD "管理后台初始密码")"
[ -n "$SEED_ADMIN_PASSWORD" ] || SEED_ADMIN_PASSWORD="$(gen -hex 12)"

SEED_ADMIN_USERNAME="$(ask ADMIN_USERNAME "管理后台用户名" "${SEED_ADMIN_USERNAME:-admin}")"

# 可选：通知配置
echo; read -r -p "是否现在配置短信/邮件通知？（可回车跳过，后台/后续 .env 再配）[y/N]: " _notif
if [ "${_notif:-n}" = "y" ] || [ "${_notif:-n}" = "Y" ]; then
  read -r -p "阿里云短信 AccessKeyId: " ALIYUN_SMS_ACCESS_KEY_ID
  read -r -p "阿里云短信 AccessKeySecret: " ALIYUN_SMS_ACCESS_KEY_SECRET
  read -r -p "短信签名: " ALIYUN_SMS_SIGN_NAME
  read -r -p "短信模板 Code: " ALIYUN_SMS_TEMPLATE_CODE
  [ -n "$ALIYUN_SMS_ACCESS_KEY_ID" ] && SMS_PROVIDER=aliyun || SMS_PROVIDER=mock
  read -r -p "SMTP 主机（如 smtp.qq.com，可回车跳过邮件）: " SMTP_HOST
  if [ -n "${SMTP_HOST:-}" ]; then
    SMTP_PORT="$(ask SMTP_PORT "SMTP 端口" 587)"
    read -r -p "SMTP 用户: " SMTP_USER
    read -r -s -p "SMTP 密码: " SMTP_PASS; echo
    read -r -p "发件人（如 启明智联 <noreply@example.com>）: " SMTP_FROM
  fi
else
  SMS_PROVIDER=mock
fi

# ---------- 3) 确认 ----------
hr; say "配置确认"; hr
echo "  主域名          : $DOMAIN_BASE（www / portal / admin / api 四个子域）"
echo "  证书邮箱        : $ACME_EMAIL"
echo "  品牌名          : ${NEXT_PUBLIC_BRAND_NAME:-（未设置，走缺省/后台配置）}"
echo "  管理后台        : https://admin.$DOMAIN_BASE （$SEED_ADMIN_USERNAME / $SEED_ADMIN_PASSWORD）"
echo "  数据库密码      : $MYSQL_ROOT_PASSWORD（自动生成）"
echo "  APP_KEY         : 已生成（32B base64）"
echo "  短信            : ${SMS_PROVIDER:-mock}"
[ -n "${SMTP_HOST:-}" ] && echo "  邮件            : $SMTP_HOST" || echo "  邮件            : 未配置"
hr
read -r -p "确认以上信息并开始部署？[Y/n]: " _go
[ "${_go:-Y}" = "Y" ] || [ "${_go:-Y}" = "y" ] || die "已中止"

# ---------- 4) 写 .env ----------
umask 077
cat > .env <<ENV
# 由 scripts/deploy-prod.sh 生成于 $(date '+%F %T')
# ===== 基础 =====
NODE_ENV=production
LOG_LEVEL=info

DATABASE_URL=mysql://root:${MYSQL_ROOT_PASSWORD}@mysql:3306/qmkvm
REDIS_URL=redis://redis:6379
APP_KEY=${APP_KEY}

# ===== API =====
API_PORT=4000
CORS_ORIGINS=https://www.${DOMAIN_BASE},https://portal.${DOMAIN_BASE},https://admin.${DOMAIN_BASE},https://api.${DOMAIN_BASE}
COOKIE_DOMAIN=.${DOMAIN_BASE}
API_PUBLIC_URL=https://api.${DOMAIN_BASE}

# ===== 管理后台（构建期直连，不用反代）=====
ADMIN_API_URL=https://api.${DOMAIN_BASE}

# ===== 公网 HTTPS 入口（gateway 自动签发/续期证书）=====
DOMAIN_BASE=${DOMAIN_BASE}
ACME_EMAIL=${ACME_EMAIL}

# ===== 前端地址 =====
WWW_URL=https://www.${DOMAIN_BASE}
PORTAL_URL=https://portal.${DOMAIN_BASE}
ADMIN_URL=https://admin.${DOMAIN_BASE}
NEXT_PUBLIC_SITE_URL=https://www.${DOMAIN_BASE}
NEXT_PUBLIC_PORTAL_URL=https://portal.${DOMAIN_BASE}
NEXT_PUBLIC_BRAND_NAME=${NEXT_PUBLIC_BRAND_NAME}
NEXT_PUBLIC_BRAND_NAME_EN=${NEXT_PUBLIC_BRAND_NAME_EN}
BRANDING_API_URL=http://api:4000/api/v1/public/settings

DEV_MOCK_PAYMENTS=false

# ===== 通知 =====
SMS_PROVIDER=${SMS_PROVIDER:-mock}
ALIYUN_SMS_ACCESS_KEY_ID=${ALIYUN_SMS_ACCESS_KEY_ID:-}
ALIYUN_SMS_ACCESS_KEY_SECRET=${ALIYUN_SMS_ACCESS_KEY_SECRET:-}
ALIYUN_SMS_SIGN_NAME=${ALIYUN_SMS_SIGN_NAME:-}
ALIYUN_SMS_TEMPLATE_CODE=${ALIYUN_SMS_TEMPLATE_CODE:-}

SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT:-587}
SMTP_USER=${SMTP_USER:-}
SMTP_PASS=${SMTP_PASS:-}
SMTP_FROM=${SMTP_FROM:-}

ALERT_WEBHOOK_URL=${ALERT_WEBHOOK_URL:-}

# ===== 附件 / 存储 =====
UPLOAD_DIR=./uploads
STORAGE_PROVIDER=local

# ===== 种子 =====
SEED_ADMIN_USERNAME=${SEED_ADMIN_USERNAME}
SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}

# compose 用
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
ENV
chmod 600 .env
say ".env 已生成（权限 600）：$ROOT/.env"

# ---------- 5) 构建与启动 ----------
say "构建并启动全部服务（首次构建约 5-15 分钟，取决于网络）..."
docker compose -f "$COMPOSE" up -d --build

say "等待 MySQL 就绪..."
_mc=0
until [ "$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose -f "$COMPOSE" ps -q mysql)" 2>/dev/null)" = "healthy" ]; do
  _mc=$((_mc + 5)); [ "$_mc" -ge 180 ] && die "MySQL 120s 未就绪，查看日志：docker compose -f $COMPOSE logs mysql"
  sleep 5
done
say "MySQL 就绪，执行数据库迁移与种子..."
docker compose -f "$COMPOSE" exec -T api pnpm --filter @qmkvm/db migrate
docker compose -f "$COMPOSE" exec -T api pnpm --filter @qmkvm/db seed
say "数据库初始化完成"

# ---------- 6) 冒烟 ----------
hr; say "冒烟检查"; hr
_smoke_ok=1
curl -fsS http://127.0.0.1:4000/healthz >/dev/null 2>&1 \
  && say "API  : http://127.0.0.1:4000/healthz ✓" || { _smoke_ok=0; warn "API healthz 未通过：docker compose -f $COMPOSE logs api"; }
for _p in 3000 3001 8000; do
  curl -kfsS "http://127.0.0.1:$_p/" >/dev/null 2>&1 \
    && say "前端 : 127.0.0.1:$_p ✓" || { _smoke_ok=0; warn "127.0.0.1:$_p 无响应：docker compose -f $COMPOSE ps"; }
done
if [ "$_dns_ok" = "1" ] && curl -fsS "https://api.$DOMAIN_BASE/healthz" >/dev/null 2>&1; then
  say "公网 : https://api.$DOMAIN_BASE/healthz ✓（证书已生效）"
else
  warn "公网 HTTPS 暂未生效（DNS 未解析或证书还在签发）。观察签发进度：docker compose -f $COMPOSE logs -f gateway"
fi

# ---------- 7) 部署摘要 ----------
hr; echo -e "${C_G}  部署完成！${C_0}"; hr
cat <<SUMMARY
  站点入口（证书签发完成前浏览器提示不安全属预期，签成自动恢复）：
    官网      : https://www.$DOMAIN_BASE
    客户中心  : https://portal.$DOMAIN_BASE
    管理后台  : https://admin.$DOMAIN_BASE   （$SEED_ADMIN_USERNAME / $SEED_ADMIN_PASSWORD）
    API       : https://api.$DOMAIN_BASE/healthz

  常用命令：
    查看服务状态 : docker compose -f $COMPOSE ps
    查看日志     : docker compose -f $COMPOSE logs -f api gateway
    重启         : docker compose -f $COMPOSE restart api worker

  后续事项：
    1. 支付网关：管理后台「系统设置」录入商户参数（回调已指向 $API_PUBLIC_URL）
    2. 短信/邮件：如未配置，编辑 .env 后 docker compose -f $COMPOSE up -d api worker
    3. 品牌定制：管理后台「站点信息」上传 logo/改站点名 → portal/admin 刷新即生效；
       www 需重建：docker compose -f $COMPOSE build www && docker compose -f $COMPOSE up -d www
    4. 官网「联系销售」表单需 NEXT_PUBLIC_CONTACT_API_URL（见 .env.example 说明）
    5. 建议：admin 域名加 IP 白名单；.env 含全部密钥，请妥善备份
SUMMARY
hr
[ "$_smoke_ok" = "1" ] || warn "部分冒烟未通过，请按上方提示查看日志后重试"
