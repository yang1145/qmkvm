#!/bin/sh
# Keepalived VIP 持有探测（备库机器执行）：当前节点是否为"可写的那个主库"。
# 通过（exit 0）→ Keepalived 保持/获得 VIP；失败（exit 1）→ 释放 VIP。
# 条件 = mysqld 可连 && read_only=0 —— 只有真正的当前主库才持有 VIP，
# 这是脑裂防护的核心：被手动置只读或降级为备的节点自动让出入口。
# 用法：vrrp_script 里 track_script 调用，interval 2s，fall 3，raise 2。
set -u
ROOT_PASS="${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD 未设置}"

# 1) 进程/端口可达
mysqladmin -h 127.0.0.1 -uroot -p"$ROOT_PASS" ping >/dev/null 2>&1 || exit 1

# 2) 本机是可写主库（read_only=0）
RO=$(mysql -h 127.0.0.1 -uroot -p"$ROOT_PASS" -NNe "SELECT @@global.read_only" 2>/dev/null)
[ "$RO" = "0" ] || exit 1

exit 0