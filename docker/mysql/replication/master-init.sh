#!/bin/sh
# 主库首次初始化（/docker-entrypoint-initdb.d/ 首次建库时自动执行）：
# 1) 半同步插件；2) 复制账号（最小权限，来源网段生产应收敛到备/从主机 IP）。
# 注意：本脚本会被 docker-entrypoint 以 source 方式执行（挂载文件不保证可执行位），
# 因此不使用 set -u / exit，避免中断 entrypoint。
# 幂等：插件/账号已存在时报错被 IGNORE，不阻断初始化。
MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" mysql -uroot <<'SQL' || true
INSTALL SONAME 'semisync_source.so';
INSTALL SONAME 'semisync_replica.so';
SQL

MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" mysql -uroot -e "CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY '${MYSQL_REPL_PASSWORD}'; GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'repl'@'%'; FLUSH PRIVILEGES;" || true
echo "[master-init] 半同步插件与复制账号就绪"