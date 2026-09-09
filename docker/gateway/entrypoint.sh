#!/bin/sh
# gateway 入口脚本：公网 HTTPS 托管（域名分流 + ACME HTTP-01 免费证书自动签发/续期）
#
# 域名来源（.env / compose environment，留空的域名不生成 server 块）：
#   GATEWAY_WWW_DOMAIN / GATEWAY_PORTAL_DOMAIN / GATEWAY_ADMIN_DOMAIN / GATEWAY_API_DOMAIN
#   ACME_EMAIL —— 证书注册邮箱（Let's Encrypt）
#
# 行为：
#   1. 按域名动态生成 nginx 配置：80 端口承载 ACME 验证 + 301 跳 HTTPS；443 按域名分流
#   2. 首次启动先用自签占位证书保证 443 可起，后台 acme.sh 签发 Let's Encrypt 证书
#      （失败自动重试，适配 DNS 尚未生效的场景），签成后覆盖并 reload
#   3. busybox crond 每日检查续期（acme.sh --cron），续期后自动 reload
#
# 持久卷：/etc/nginx/ssl（当前证书）、/var/lib/acme（acme.sh 账号与证书状态）
set -eu

SSL_DIR=/etc/nginx/ssl
WEBROOT=/var/www/acme
ACME_HOME=/var/lib/acme
ACME=/opt/acme.sh/acme.sh
CONF=/etc/nginx/conf.d/gateway.conf

log() { echo "[gateway] $*"; }

# ---- 1) 收集 域名→上游 映射（留空跳过）----
entries=""
add() { [ -n "${2:-}" ] && entries="$entries
$1 $2"; }
add www    "${GATEWAY_WWW_DOMAIN:-}"
add portal "${GATEWAY_PORTAL_DOMAIN:-}"
add admin  "${GATEWAY_ADMIN_DOMAIN:-}"
add api    "${GATEWAY_API_DOMAIN:-}"
[ -n "${ACME_EMAIL:-}" ] || { log "错误：未设置 ACME_EMAIL"; exit 1; }
[ -n "$entries" ] || { log "错误：未设置任何 GATEWAY_*_DOMAIN"; exit 1; }

mkdir -p "$SSL_DIR" "$WEBROOT" "$ACME_HOME"

# ---- 2) 生成 nginx 配置 ----
# 上游映射：前端容器内 nginx 监听 80，api 为 Node 直出 4000
first_domain=""
name_list=""    # nginx server_name 用（空格分隔）
acme_flags=""   # acme.sh 用（-d 前缀）
while IFS=' ' read -r name domain; do
  [ -n "$name" ] || continue
  [ -n "$first_domain" ] || first_domain="$domain"
  name_list="$name_list $domain"
  acme_flags="$acme_flags -d $domain"
done <<EOF
$entries
EOF

{
  echo "# 由 /entrypoint.sh 生成，请勿手改（改域名改 .env 后重建容器）"
  echo "server {"
  echo "  listen 80 default_server;"
  echo "  server_name$name_list;"
  echo "  location /.well-known/acme-challenge/ { root $WEBROOT; default_type text/plain; }"
  echo "  location / { return 301 https://\$host\$request_uri; }"
  echo "}"
} > "$CONF"

while IFS=' ' read -r name domain; do
  [ -n "$name" ] || continue
  case "$name" in
    www)    upstream="www:80" ;;
    portal) upstream="portal:80" ;;
    admin)  upstream="admin:80" ;;
    api)    upstream="api:4000" ;;
    *)      log "跳过未知服务 $name"; continue ;;
  esac
  {
    echo "server {"
    echo "  listen 443 ssl;"
    echo "  http2 on;"
    echo "  server_name $domain;"
    echo "  ssl_certificate $SSL_DIR/fullchain.pem;"
    echo "  ssl_certificate_key $SSL_DIR/privkey.pem;"
    echo "  location / {"
    echo "    proxy_pass http://$upstream;"
    echo "    proxy_http_version 1.1;"
    echo "    proxy_set_header Host \$host;"
    echo "    proxy_set_header X-Real-IP \$remote_addr;"
    echo "    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"  # 限流依赖真实 IP
    echo "    proxy_set_header X-Forwarded-Proto \$scheme;"
    echo "    client_max_body_size 10m;"
    echo "  }"
    echo "}"
  } >> "$CONF"
  log "已托管 $domain -> $upstream"
done <<EOF
$entries
EOF

# ---- 3) 占位自签证书：保证 443 立即可起（ACME 验证走 80，不受影响）----
if [ ! -s "$SSL_DIR/fullchain.pem" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "$SSL_DIR/privkey.pem" -out "$SSL_DIR/fullchain.pem" \
    -subj "/CN=$first_domain" 2>/dev/null
  log "已生成自签占位证书（签发成功后自动替换）"
fi

# ---- 4) 每日续期（busybox crond）----
echo "0 3 * * * $ACME --cron --home $ACME_HOME >> /var/log/acme-cron.log 2>&1" > /etc/crontabs/root
crond -b -l 8

# ---- 5) 后台签发/恢复证书：DNS 未生效时每 60s 重试，最多 60 次 ----
(
  issue_ok=1
  if ! $ACME --home $ACME_HOME --list 2>/dev/null | grep -q "$first_domain"; then
    log "开始向 Let's Encrypt 签发证书：$first_domain ..."
    try=0
    until $ACME --issue --home $ACME_HOME --server letsencrypt \
        -m "$ACME_EMAIL" -w "$WEBROOT" $acme_flags; do
      try=$((try + 1))
      [ "$try" -ge 60 ] && { log "签发重试超限（约 1 小时），退出后台签发；稍后重启容器可再试"; exit 1; }
      log "签发失败（第 $try 次，常见原因：DNS 未生效 / 80 端口不可达），60s 后重试..."
      sleep 60
    done
    issue_ok=0
  fi
  if [ "$issue_ok" -eq 0 ]; then
    $ACME --install-cert --home $ACME_HOME -d "$first_domain" \
      --fullchain-file "$SSL_DIR/fullchain.pem" \
      --key-file "$SSL_DIR/privkey.pem" \
      --reloadcmd "nginx -s reload" \
      && log "证书已安装并生效"
  fi
) &

log "gateway 就绪（80/443），exec nginx"
exec "$@"
