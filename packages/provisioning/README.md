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

---

## ZJMF 模块（zjmf，魔方财务代理商对接）

以代理商账号对接 [魔方财务](https://www.zjmf.com/)（ZJMF / cube_finance）上游。本地系统独占账务与
生命周期（商品/定价/订单/账单/续费/逾期全部在核心），模块只把资源动作翻译成上游 API：

| 动作 | 上游调用 | 说明 |
| --- | --- | --- |
| provision | cart/clear → cart/add_to_shop → cart/settle → apply_credit → invoices/{id} 轮询 → host/header | 结算成功即写 `deliverInfo.upInvoiceId`，重试先对账再决定是否重新购买（杜绝重复开通） |
| renew | GET host/renewpage → POST host/renew（防御性 apply_credit） | 核心续费结算（手动/余额自动）自动创建 renew 任务；未实现 renew 的模块由 runner 标记 skipped |
| suspend / unsuspend | POST provision/default func=off/on | **会员级 API 无主机暂停端点**，欠费管控以断电实现（result.message 明示） |
| terminate | POST host/cancel（Immediate） | 提交上游取消请求，上游处理前主机仍存在 |
| changePackage | POST upgrade/upgrade_product_post | 要求目标商品同为 zjmf 模块且同一供应商；上游差价从代理账户余额扣 |

### 供应商配置（后台「商品管理 → 魔方财务」页维护）

供应商凭据存 settings 键 `provisioning.zjmf.suppliers`（密码 AES-256-GCM 加密，格式与支付网关一致），
商品 moduleConfig 只存非敏感映射：

```json
{ "supplierCode": "main", "upProductId": 42 }
```

推荐流程（全部在后台 UI 完成，无需手写 JSON）：

1. **维护供应商**：`商品管理 → 魔方财务 → 供应商`：新增代理账号（密码加密落库、不回显），可测试连接、查上游余额。
2. **同步上游商品**：`魔方财务 → 上游商品`：拉取上游商品列表 + 代理价/周期价，落库
   `zjmf_upstream_products`（上游离线也能选商品；同步幂等可重复执行）。
3. **创建映射商品**：商品编辑页选供应模块 `zjmf` → 页面出现「魔方财务上游映射」选择器
   （选供应商 → 选上游商品），保存即完成 moduleConfig 映射；向客户收取的价格在「周期定价」独立配置。
4. （可选）**主机指派**：`魔方财务 → 主机指派`：绑定上游已开通机器给客户（纯本地绑定，
   到期日取上游，本地按期生成续费账单并同步上游），或按上游商品 0 元代开（走正常开通任务）。
   已指派/已映射的上游机器与商品在列表中标注。
5. **服务上游状态**：服务列表对 zjmf 服务提供「上游」按钮——实时拉取 `host/product`/`host/header`
   展示上游状态/到期日/IP（只读，不改本地状态）。

> 兼容：moduleConfig 也接受内联 `supplier` 对象（与 pve.auth 同模式），但不推荐——
> 凭据散落在商品表且无法在供应商页统一轮换。

### moduleConfig 字段表

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `supplier` | object | 方式 B 必填 | — | `baseUrl`（https 强制）/ `username` / `password` / `apiTimeoutSec`（默认 30）/ `allowSelfSigned`（默认 false） |
| `supplierCode` | string | 方式 A 必填 | — | 设置表 `provisioning.zjmf.suppliers` 中的供应商 code |
| `upProductId` | number | 是 | — | 上游商品 ID |
| `upCycles` | object | 否 | 自动别名匹配 | 本地周期 → 上游 billingcycle 键，如 `{"monthly":"monthly"}`；`onetime` 必须显式映射 |
| `upConfigOption` | object | 否 | 自动探测默认值 | 上游配置项 `optionId → 子项ID/数量`；缺省时开通前经 `cart/get_product_config` 探测 |
| `pollTimes` | number | 否 | 4 | 开通后轮询上游主机 ID 次数（每次间隔 2s） |

### 生命周期要点（与核心的分工）

- **到期日本地说了算**：核心续费结算推进本地 `next_due_date` 并创建 renew 任务 → 模块调上游
  `host/renew` 对齐上游到期日。上游余额不足续费失败 → 任务退避重试 → 死信 → 人工工作台 + 告警，
  本地账务不受影响。上游 `host/autorenew` 必须保持关闭，否则与本地生命周期抢控制权。
- **供应商互斥锁**：魔方购物车是上游账号级共享资源（`cart/settle` 结算整辆购物车），provision /
  renew / changePackage 全部在 Redis 锁（无 Redis 降级进程内链）内串行执行。
- **幂等开通**：`deliverInfo.upHostId` 已存在 → 幂等重放；仅有 `upInvoiceId` → 对账（查账单支付
  状态 + 主机 ID，必要时补 apply_credit），不重复购买。
- **状态同步**（规划中）：每日 sync 任务拉 `host/product`/`host/header` 校对上游到期日与状态，
  只告警不改本地状态——本地是账务事实源。

### 安全约定

- TLS 默认严格校验（`allowSelfSigned` 显式开启才放宽，undici Agent）；`baseUrl` 强制 https，
  内网 http 需供应商级 `allowInsecureUrl=true` 显式放行。
- JWT 仅进程内存缓存（2h），不落盘；PHP 版的文件缓存与 `verify_ssl=false` 硬编码为已知缺陷，勿移植。
- 上游响应（含 `host/header` 明文密码）写入任务结果前一律过 `redactZjmf` 脱敏；供应商密码后台只写
  不读。上游返回价格仅作成本记录（字符串精确换算分），从不参与本地收款计算。
- 建议为上游单独开代理商账号：设置余额额度、开启 IP 白名单；管理端 API 凭据（如使用）按高危凭据管理。

### deliverInfo

```json
{
  "upHostId": 1201, "upInvoiceId": 908, "upProductId": 42, "upCycle": "monthly",
  "upProductName": "轻量云 2C2G", "upUsername": "serxxxxxxxxxxx", "upPassword": "初始密码",
  "upExpireAt": "2026-10-07"
}
```

后续所有动作依赖 `upHostId` 定位上游主机；`upExpireAt` 用于状态同步校对。

### 联调提示

端点/字段因上游版本存在差异（MNBT 版 PRD Q1/Q3）：周期键（`monthly`/`月付`/大小写）、
`cart/settle` 是否返回主机 ID、`add_to_shop` 是否返回购物车位置等均已做防御式处理与探测重试；
联调异常时先看任务 `result.raw`（已脱敏）中的上游原始返回。
