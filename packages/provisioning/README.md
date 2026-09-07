# @qmkvm/provisioning

供应模块 SDK（SPEC-P0 §2.5 / PRD-billing F8）：实现 `ProvisionModule` 接口的适配器集合，
runner 按服务的 `moduleCode` 调用对应模块完成 开通 / 暂停 / 恢复 / 终止 / 变更套餐。

内置模块：

| code | 说明 |
| --- | --- |
| `manual` | 人工开通：所有动作返回 `manual: true`，任务成功、服务状态由后台人工推进 |
| `demo` | 演示：模拟开通并回填随机 IP/密码，无外部调用 |
| `http-api` | 通用 HTTP API：动作映射由商品 `moduleConfig.actions` 驱动 |
| `pve` | Proxmox VE：克隆模板开通 qemu 虚拟机 / lxc 容器（下文） |

---

## PVE 模块（pve）配置

Proxmox VE 供应模块通过 PVE REST API（`/api2/json`）交付实例：

**开通流程**：`/cluster/nextid` 取 vmid → 克隆模板（`POST .../{templateVmId}/clone`，名称 `kvm-{service.id}`）
→ 写配置（cores / memory / net0 限速；qemu 另带 cloud-init `ipconfig0: ip=dhcp` 与可选 `sshkeys`）
→ 磁盘扩容（**只增不减**，仅当目标盘大于模板盘时 `resize`）→ `start` → 等待 `running`
→ 尽力获取 IP（qemu 走 guest-agent `agent/network-get-interfaces`，lxc 走 `GET /lxc/{vmid}/interfaces`；
最长等 30s，失败不阻塞交付，写入 `deliverInfo.ip`）。

异步写操作（clone/config/resize/start/stop 等）返回 UPID，模块每 2s 轮询
`GET /nodes/{node}/tasks/{upid}/status`，直到 `stopped` 且 exitstatus OK，总超时 `taskTimeoutSec`。
clone 成功之后的失败均携带 `vmid`/`node`，便于人工清理半成品实例。

### 商品 moduleConfig 字段表

在后台商品编辑页（供应模块选择 http-api / pve 时出现 JSON 编辑框）配置：

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `host` | string | 是 | — | PVE Web 地址，形如 `https://1.2.3.4:8006` |
| `allowSelfSigned` | boolean | 否 | `true` | 自签证书时忽略 TLS 校验（生产建议配好受信证书后设 `false`） |
| `auth` | object | 是 | — | 认证配置，二选一，见下 |
| `vmType` | `"qemu"` \| `"lxc"` | 否 | `qemu` | 虚拟机或 LXC 容器（模板类型需匹配） |
| `node` | string | 否 | 自动 | 目标节点；缺省取 `GET /nodes` 第一个 online 节点 |
| `templateVmId` | number | 是 | — | 模板的 vmid（qemu 模板 VM 或 lxc 模板 CT） |
| `storage` | string | 否 | — | 克隆目标存储（clone 的 `target`），如 `local-lvm` |
| `diskDevice` | string | 否 | `scsi0` | resize 的磁盘设备名（qemu）；lxc 固定 `rootfs` |
| `bridge` | string | 否 | `vmbr0` | 网卡桥接名 |
| `suspendMode` | `"suspend"` \| `"stop"` | 否 | `suspend` | 欠费暂停方式：挂起（resume 恢复）或关机（start 恢复） |
| `taskTimeoutSec` | number | 否 | `300` | 异步任务轮询总超时（秒） |
| `sshKey` | string | 否 | — | cloud-init 公钥（仅 qemu，写入 `sshkeys`） |

**auth 二选一**：

```json
{ "type": "token", "user": "root@pam", "tokenId": "provision", "secret": "xxxx-xxxx" }
```
推荐。需在 PVE 上单独建 API Token 并授予最小 ACL（如 `/vms/{template}`、`/vms` 的
`VM.Clone,VM.Config,VM.PowerMgmt,VM.Allocate` 与 `/nodes` 读取权限）。

```json
{ "type": "ticket", "username": "root@pam", "password": "****" }
```
ticket 模式登录 `/access/ticket`，票据缓存于模块进程内存约 90 分钟，遇 401 自动重登一次。

### 配置示例（qemu 虚拟机）

```json
{
  "host": "https://203.0.113.10:8006",
  "allowSelfSigned": true,
  "auth": { "type": "token", "user": "root@pam", "tokenId": "provision", "secret": "xxxxxxxx" },
  "vmType": "qemu",
  "templateVmId": 9000,
  "storage": "local-lvm",
  "diskDevice": "scsi0",
  "bridge": "vmbr0",
  "taskTimeoutSec": 300,
  "sshKey": "ssh-ed25519 AAAA... admin@example.com"
}
```

### 配置示例（lxc 容器）

```json
{
  "host": "https://203.0.113.10:8006",
  "auth": { "type": "ticket", "username": "root@pam", "password": "****" },
  "vmType": "lxc",
  "templateVmId": 9001,
  "storage": "local-lvm",
  "bridge": "vmbr0",
  "suspendMode": "stop"
}
```

### 弹性套餐选项值约定（service.config 快照）

模块从订单配置快照（`quoteProduct` 生成的 `config.options`）解析资源需求，同时兼容扁平键
`{cpu, ram, disk, bandwidth, ip}`：

| 配置项 | 值示例 | 解析结果 |
| --- | --- | --- |
| CPU（radio） | `2c` / `4c` | 前导数字 = 核数 |
| 内存（radio） | `4g` / `8g` | 数字 × 1024 = memory（MiB） |
| 系统盘（radio） | `40g` / `80g` | 数字 = 磁盘 GB（小于模板盘不缩盘） |
| 公网带宽（quantity，value=`bandwidth`） | quantity=500 | 500 Mbps → `net0 ... rate=500`（0 不限速） |
| 公网 IP（quantity，value=`ip`） | quantity=2 | **P0 仅支持 1 个公网 IP**，多余忽略并写入 result.message |
| 数据盘（quantity，value=`datadisk`） | quantity=1 | P0 忽略并提示 |

内存/磁盘的 `g` 值按配置组名称识别（组名/选项名含「内存/ram」判内存、「盘/disk」判磁盘），
建议用弹性套餐向导的默认组名。

### suspend / unsuspend / terminate / changePackage 行为

- **suspend**：`suspendMode=suspend` → `POST status/suspend`（挂起）；`=stop` → `status/stop`。
- **unsuspend**：查 `status/current`，`stopped` → `start`；qemu 挂起（`qmpstatus=paused`）→ `resume`；已在运行则直接成功。
- **terminate**：先 `stop` 并等待 `stopped` → `DELETE /nodes/{node}/{type}/{vmid}?purge=1&destroy-unreferenced-disks=1`。
- **changePackage**：按 `target.config` 重设 cores/memory/net0 rate；磁盘只增不减（目标小于当前时在
  result.message 提示保持不变）。

### 交付信息（deliverInfo）

provision 成功后 runner 合并写入 `service.deliverInfo`：

```json
{ "vmid": 105, "node": "pve1", "ip": "192.168.1.50", "type": "qemu", "status": "running" }
```

后续 suspend/unsuspend/terminate/changePackage 依赖其中的 `vmid` 与 `node` 定位实例。

### 模板要求

- qemu 模板建议安装 cloud-init 与 qemu-guest-agent（前者用于 `ipconfig0=dhcp`/sshkeys，后者用于回填 IP）。
- lxc 模板克隆后经 `net0 ip=dhcp` 自动 DHCP。
- 模板磁盘设备名与 `diskDevice` 一致（默认 `scsi0`）时才能自动扩容。
