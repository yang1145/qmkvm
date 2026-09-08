#!/bin/sh
# 一次性挂复制任务（compose 服务 mysql-replica-init 显式 entrypoint 执行，幂等可重跑）：
#   备库 mysql-standby ──半同步──▶ mysql-master
#   从库 mysql-readonly ──异步──▶ mysql-standby（链式：主→备→从）
# 仅 compose 集群样例的"空库直启复制"用：主库也是全新空库，无需灌初始数据。
# 生产对既有库搭从必须先 mysqldump --single-transaction --source-data=2 灌数据，
# 步骤与切换 runbook 见 docs/deployment.md §6.2。
set -u

ROOT_PASS="${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD 未设置}"
REPL_USER="${REPL_USER:-repl}"
REPL_PASSWORD="${MYSQL_REPL_PASSWORD:?MYSQL_REPL_PASSWORD 未设置}"

# configure <副本主机> <复制源主机> <半同步:1|0>
configure() {
  replica="$1"; source="$2"; semi="$3"
  echo "[replica-init] 等待副本 $replica 就绪…"
  i=0
  until mysqladmin --get-server-public-key -h "$replica" -uroot -p"$ROOT_PASS" ping >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
      echo "[replica-init] 等待 $replica 超时（5 分钟）" >&2
      return 1
    fi
    sleep 5
  done

  if [ "$semi" = "1" ]; then
    echo "[replica-init] $replica 安装半同步 replica 插件…"
    MYSQL_PWD="$ROOT_PASS" mysql --get-server-public-key -h "$replica" -uroot \
      -e "INSTALL SONAME 'semisync_replica.so'" 2>/dev/null || true
    MYSQL_PWD="$ROOT_PASS" mysql --get-server-public-key -h "$replica" -uroot \
      -e "SET GLOBAL rpl_semi_sync_replica_enabled = 1" 2>/dev/null || true
  fi

  echo "[replica-init] $replica 挂复制源 $source（GTID 自动定位）…"
  MYSQL_PWD="$ROOT_PASS" mysql --get-server-public-key -h "$replica" -uroot <<SQL
STOP REPLICA;
RESET REPLICA ALL;
CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='$source',
  SOURCE_USER='$REPL_USER',
  SOURCE_PASSWORD='$REPL_PASSWORD',
  SOURCE_AUTO_POSITION=1,
  GET_SOURCE_PUBLIC_KEY=1;
START REPLICA;
SQL

  echo "[replica-init] $replica 复制状态："
  # 输出列名 8.0.22+/8.4 与旧版并存（Replica_* / Slave_*），两种都匹配
  MYSQL_PWD="$ROOT_PASS" mysql --get-server-public-key -h "$replica" -uroot \
    -e "SHOW REPLICA STATUS\G" | grep -E "(Replica|Slave)_(IO|SQL)_Running:|Seconds_Behind" || true
  echo "[replica-init] $replica 完成"
}

configure mysql-standby mysql-master 1 || exit 1
configure mysql-readonly mysql-standby 0 || exit 1
echo "[replica-init] 全部副本复制已配置（异常时查 SHOW REPLICA STATUS 全文）"