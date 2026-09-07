/**
 * Proxmox VE 供应模块（pve，PRD-billing F8）：
 * 通过 PVE REST API（/api2/json）克隆模板开通 qemu 虚拟机 / lxc 容器，
 * 按弹性套餐快照（service.config）设定核数/内存/磁盘/带宽，并回填交付信息。
 *
 * moduleConfig（商品级 JSON，service.moduleConfig 可覆盖）：
 * {
 *   "host": "https://1.2.3.4:8006",
 *   "allowSelfSigned": true,                  // 默认 true：自签证书时忽略 TLS 校验
 *   "auth": { "type": "token", "user": "root@pam", "tokenId": "xxx", "secret": "xxx" }
 *         | { "type": "ticket", "username": "root@pam", "password": "xxx" },
 *   "vmType": "qemu",                          // qemu | lxc，默认 qemu
 *   "node": "pve1",                            // 缺省自动选 /nodes 第一个 online 节点
 *   "templateVmId": 9000,                      // 克隆模板（qemu 模板 VM 或 lxc 模板 CT）
 *   "storage": "local-lvm",                    // clone target（可选）
 *   "diskDevice": "scsi0",                     // resize 用，qemu 默认 scsi0，lxc 固定 rootfs
 *   "bridge": "vmbr0",
 *   "suspendMode": "suspend",                  // suspend | stop，默认 suspend
 *   "taskTimeoutSec": 300,                     // 异步任务轮询总超时
 *   "sshKey": "ssh-rsa AAAA..."                // 可选，qemu cloud-init sshkeys
 * }
 *
 * service.config 弹性套餐选项值约定（与弹性套餐向导一致）：
 *   cpu: "2c" → 2 核；ram: "8g" → 8192MiB；disk: "80g" → 80GB；
 *   bandwidth：quantity 型（value=bandwidth，quantity=Mbps）；
 *   ip：quantity 型（value=ip，quantity=个数，P0 仅支持 1 个公网 IP，多余忽略并记录 message）。
 *   解析同时兼容 group/label 名称启发式（CPU/核、内存/ram、盘/disk、带宽、IP）与扁平键。
 *
 * 认证二选一：token（推荐，需单独 ACL）；ticket（root@pam 密码，缓存于模块内存
 * 约 90 分钟，遇 401 自动重登一次重试）。
 *
 * HTTP 客户端：undici（Node 内置 fetch 同源实现）——用 Agent dispatcher 实现
 * 「忽略自签证书」，无需手写 node:https 的响应流/重定向处理，且天然支持连接复用。
 * 写操作经 PVE 异步任务（UPID）执行：每 2s 轮询 tasks/{upid}/status，
 * 直到 stopped 且 exitstatus OK，总超时 taskTimeoutSec（默认 300s）。
 *
 * 开通流程：nextid → clone → config(cores/memory/net0/ipconfig0) → resize(只增不减)
 * → start → 等待 running → 尽力获取 IP（agent network-get-interfaces / lxc interfaces，
 * 最长 30s，失败不阻塞交付）。clone 成功后的失败均携带 vmid 便于人工清理。
 */
import { Agent, fetch as undiciFetch } from "undici";
import type { ServiceRow } from "@qmkvm/core";
import { STANDARD_MODULE_ACTIONS } from "../types.js";
import type {
  ChangePackageTarget,
  ModuleConfig,
  ModuleCtx,
  ModuleResult,
  ProvisionModule,
  TestConnectionResult,
} from "../types.js";
import { resolveModuleConfig } from "../config.js";

/** 单次 HTTP 请求超时（异步任务轮询总超时另计 taskTimeoutSec） */
const HTTP_TIMEOUT_MS = 30_000;
/** 异步任务轮询间隔 */
const TASK_POLL_INTERVAL_MS = 2_000;
/** 启动后等待 running 的超时 */
const RUNNING_TIMEOUT_MS = 60_000;
/** 尽力获取 IP 的最长等待 */
const IP_WAIT_MS = 30_000;
/** ticket 内存缓存有效期（PVE ticket 生命周期 2h，提前 30min 刷新） */
const TICKET_TTL_MS = 90 * 60_000;

// ============ 配置解析 ============

export interface PveTokenAuth {
  type: "token";
  /** API Token 的用户，如 "root@pam" */
  user: string;
  tokenId: string;
  secret: string;
}

export interface PveTicketAuth {
  type: "ticket";
  username: string;
  password: string;
}

export type PveAuth = PveTokenAuth | PveTicketAuth;

export interface PveModuleConfig {
  host: string;
  allowSelfSigned: boolean;
  auth: PveAuth;
  vmType: "qemu" | "lxc";
  node?: string;
  templateVmId: number;
  storage?: string;
  diskDevice?: string;
  bridge: string;
  suspendMode: "suspend" | "stop";
  taskTimeoutSec: number;
  sshKey?: string;
}

/** 解析并校验 PVE 模块配置（非法时抛错） */
export function parsePveConfig(config: ModuleConfig): PveModuleConfig {
  const cfg = config as unknown as Partial<PveModuleConfig>;
  if (!cfg || typeof cfg !== "object") {
    throw new Error("pve 模块缺少配置");
  }
  if (typeof cfg.host !== "string" || !/^https?:\/\//i.test(cfg.host)) {
    throw new Error("pve 模块配置缺少合法的 host（形如 https://1.2.3.4:8006）");
  }
  const auth = cfg.auth as PveAuth | undefined;
  if (!auth || typeof auth !== "object") {
    throw new Error("pve 模块配置缺少 auth（token 或 ticket）");
  }
  if (auth.type === "token") {
    if (!auth.user || !auth.tokenId || !auth.secret) {
      throw new Error("pve 模块 token 认证需配置 user / tokenId / secret");
    }
  } else if (auth.type === "ticket") {
    if (!auth.username || !auth.password) {
      throw new Error("pve 模块 ticket 认证需配置 username / password");
    }
  } else {
    throw new Error("pve 模块 auth.type 仅支持 token / ticket");
  }
  if (typeof cfg.templateVmId !== "number" || !Number.isInteger(cfg.templateVmId) || cfg.templateVmId <= 0) {
    throw new Error("pve 模块配置缺少 templateVmId（模板 VM/CT 的 vmid）");
  }
  return {
    host: cfg.host.replace(/\/+$/, ""),
    allowSelfSigned: cfg.allowSelfSigned !== false,
    auth,
    vmType: cfg.vmType === "lxc" ? "lxc" : "qemu",
    node: typeof cfg.node === "string" && cfg.node ? cfg.node : undefined,
    templateVmId: cfg.templateVmId,
    storage: typeof cfg.storage === "string" && cfg.storage ? cfg.storage : undefined,
    diskDevice: typeof cfg.diskDevice === "string" && cfg.diskDevice ? cfg.diskDevice : undefined,
    bridge: typeof cfg.bridge === "string" && cfg.bridge ? cfg.bridge : "vmbr0",
    suspendMode: cfg.suspendMode === "stop" ? "stop" : "suspend",
    taskTimeoutSec:
      typeof cfg.taskTimeoutSec === "number" && cfg.taskTimeoutSec > 0 ? cfg.taskTimeoutSec : 300,
    ...(typeof cfg.sshKey === "string" && cfg.sshKey ? { sshKey: cfg.sshKey } : {}),
  };
}

// ============ 弹性套餐快照解析 ============

export interface ParsedResources {
  /** 核数（未提供为 null） */
  cores: number | null;
  /** 内存 MiB（未提供为 null） */
  memoryMiB: number | null;
  /** 系统盘 GB（未提供为 null） */
  diskGB: number | null;
  /** 带宽 Mbps（0 = 不限速） */
  bandwidthMbps: number;
  /** 公网 IP 数（P0 仅支持 1，多余忽略） */
  ipCount: number;
  /** 解析过程中的提示（并入 result.message） */
  notes: string[];
}

function leadingInt(value: string): number | null {
  const m = /^\s*(\d+)/.exec(value);
  return m ? Number.parseInt(m[1] ?? "", 10) : null;
}

/** 分类单个选项值（value 形如 "2c"/"8g"/"80g"/"bandwidth"/"ip"） */
function classifyOption(
  hint: string,
  value: string,
  quantity: number,
  isQuantityType: boolean,
  res: ParsedResources,
): void {
  if (isQuantityType) {
    if (/^bandwidth$/i.test(value) || /带宽|bandwidth/i.test(hint)) {
      res.bandwidthMbps = quantity;
      return;
    }
    if (/^ip$/i.test(value) || /公网\s*ip|\bip\b/i.test(hint)) {
      res.ipCount = quantity;
      return;
    }
    if (/^datadisk$/i.test(value) || /数据盘|datadisk/i.test(hint)) {
      res.notes.push(`已忽略数据盘配置（P0 暂不支持独立数据盘）：${quantity} 组`);
      return;
    }
    return;
  }
  let m = /^(\d+)\s*c$/i.exec(value);
  if (m) {
    res.cores = Number.parseInt(m[1] ?? "", 10);
    return;
  }
  m = /^(\d+)\s*gb?$/i.exec(value);
  if (m) {
    const n = Number.parseInt(m[1] ?? "", 10);
    if (/内存|ram|memory/i.test(hint)) res.memoryMiB = n * 1024;
    else if (/盘|disk|ssd|hdd/i.test(hint)) res.diskGB = n;
    else res.notes.push(`选项值「${value}」无法按组名识别为内存或磁盘（组：${hint || "无"}），已忽略`);
    return;
  }
  if (/^\d+$/.test(value)) {
    const n = Number.parseInt(value, 10);
    if (/cpu|核/i.test(hint)) res.cores = n;
    else if (/内存|ram|memory/i.test(hint)) res.memoryMiB = n * 1024;
    else if (/盘|disk|ssd|hdd/i.test(hint)) res.diskGB = n;
    else if (/带宽|bandwidth/i.test(hint)) res.bandwidthMbps = n;
    return;
  }
}

/**
 * 解析服务配置快照（services.config / change_package target.config）为资源需求。
 * 兼容两种形状：quoteProduct 快照（{options: [{group, type, quantity, options: [{label, value}]}]}）
 * 与扁平键（{cpu: "2c", ram: "8g", disk: "80g", bandwidth: 500, ip: 1}）。
 */
export function parseServiceResources(config: unknown): ParsedResources {
  const res: ParsedResources = {
    cores: null,
    memoryMiB: null,
    diskGB: null,
    bandwidthMbps: 0,
    ipCount: 1,
    notes: [],
  };
  if (config == null || typeof config !== "object") return res;

  const flat = config as Record<string, unknown>;
  const toNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") return leadingInt(v);
    return null;
  };
  const cpu = typeof flat.cpu === "string" || typeof flat.cpu === "number" ? toNum(flat.cpu) : null;
  if (cpu != null) res.cores = cpu;
  const ram = typeof flat.ram === "string" || typeof flat.ram === "number" ? toNum(flat.ram) : null;
  if (ram != null) res.memoryMiB = ram * 1024;
  const disk = typeof flat.disk === "string" || typeof flat.disk === "number" ? toNum(flat.disk) : null;
  if (disk != null) res.diskGB = disk;
  const bw = toNum(flat.bandwidth);
  if (bw != null) res.bandwidthMbps = bw;
  const ip = toNum(flat.ip);
  if (ip != null) res.ipCount = ip;

  const options = (config as { options?: unknown }).options;
  if (Array.isArray(options)) {
    for (const selection of options) {
      const sel = selection as { group?: unknown; type?: unknown; quantity?: unknown; options?: unknown };
      const groupName = typeof sel.group === "string" ? sel.group : "";
      const qty =
        typeof sel.quantity === "number" && Number.isFinite(sel.quantity) && sel.quantity > 0
          ? sel.quantity
          : 1;
      const isQuantity = sel.type === "quantity";
      if (!Array.isArray(sel.options)) continue;
      for (const opt of sel.options) {
        const o = opt as { label?: unknown; value?: unknown };
        const label = typeof o.label === "string" ? o.label : "";
        const value = typeof o.value === "string" ? o.value : String(o.value ?? "");
        classifyOption(`${groupName} ${label}`.trim(), value, qty, isQuantity, res);
      }
    }
  }

  if (res.ipCount > 1) {
    res.notes.push(`P0 仅支持 1 个公网 IP，已忽略多余的 ${res.ipCount - 1} 个`);
    res.ipCount = 1;
  }
  return res;
}

// ============ PVE HTTP 客户端 ============

interface TaskStatus {
  status?: string;
  exitstatus?: string;
  exitcode?: string | number;
}

interface QemuIface {
  name?: string;
  "ip-addresses"?: Array<{ "ip-address"?: string; "ip-address-type"?: string }>;
}

interface LxcIface {
  name?: string;
  inet?: string;
}

/** ticket 内存缓存（模块实例级；按 host+用户隔离，支持多 PVE 集群并存） */
const ticketCache = new Map<string, { ticket: string; csrf: string; expiresAt: number }>();

export class PveClient {
  readonly cfg: PveModuleConfig;
  private readonly agent: Agent;

  constructor(cfg: PveModuleConfig) {
    this.cfg = cfg;
    // allowSelfSigned（默认 true）→ 忽略自签证书；用 undici Agent 作为 fetch dispatcher，
    // 相比手写 node:https 可复用 fetch API 与连接池（选型理由见文件头注释）。
    this.agent = new Agent({ connect: { rejectUnauthorized: !cfg.allowSelfSigned } });
  }

  /** 获取（并缓存）ticket；force 时强制重登 */
  private async getTicket(force = false): Promise<{ ticket: string; csrf: string }> {
    const { username, password } = this.cfg.auth as Extract<PveAuth, { type: "ticket" }>;
    const key = `${this.cfg.host}::${username}`;
    const cached = ticketCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached;
    }
    const data = await this.request<{ ticket?: string; CSRFPreventionToken?: string }>(
      "POST",
      "/access/ticket",
      { username, password },
      { skipAuth: true },
    );
    if (!data?.ticket || !data.CSRFPreventionToken) {
      throw new Error("PVE 登录失败：响应缺少 ticket/CSRFPreventionToken");
    }
    const entry = { ticket: data.ticket, csrf: data.CSRFPreventionToken, expiresAt: Date.now() + TICKET_TTL_MS };
    ticketCache.set(key, entry);
    return entry;
  }

  /**
   * 统一请求：{data} 解包、超时（AbortController）、非 2xx 抛含 PVE 错误体的错误。
   * POST/PUT 参数走 urlencoded 表单体，其余走查询串。
   */
  async request<T>(
    method: string,
    path: string,
    params?: Record<string, string | number | undefined>,
    opts: { skipAuth?: boolean; retriedAuth?: boolean; timeoutMs?: number } = {},
  ): Promise<T> {
    const m = method.toUpperCase();
    const url = new URL(`${this.cfg.host}/api2/json${path}`);
    const headers: Record<string, string> = { Accept: "application/json" };
    let body: string | undefined;
    if (params && (m === "POST" || m === "PUT")) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) form.set(k, String(v));
      }
      body = form.toString();
    } else if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    if (!opts.skipAuth) {
      const auth = this.cfg.auth;
      if (auth.type === "token") {
        headers.Authorization = `PVEAPIToken=${auth.user}!${auth.tokenId}=${auth.secret}`;
      } else {
        const ticket = await this.getTicket();
        headers.Cookie = `PVEAuthCookie=${ticket.ticket}`;
        if (m !== "GET" && m !== "HEAD") headers.CSRFPreventionToken = ticket.csrf;
      }
    }

    const timeoutMs = opts.timeoutMs ?? HTTP_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(url, {
        method: m,
        headers,
        body,
        dispatcher: this.agent,
        signal: controller.signal,
      });
    } catch (err) {
      const message = controller.signal.aborted
        ? `PVE 请求超时（${timeoutMs}ms）：${m} ${path}`
        : `PVE 请求失败：${m} ${path}：${err instanceof Error ? err.message : String(err)}`;
      throw new Error(message);
    } finally {
      clearTimeout(timer);
    }

    // ticket 过期：重登一次后重试
    if (response.status === 401 && this.cfg.auth.type === "ticket" && !opts.skipAuth && !opts.retriedAuth) {
      await this.getTicket(true);
      return this.request<T>(method, path, params, { ...opts, retriedAuth: true });
    }

    const text = await response.text().catch(() => "");
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`PVE 响应非 JSON（HTTP ${response.status}）：${m} ${path}：${text.slice(0, 200)}`);
    }
    if (!response.ok) {
      const errors = (json as { errors?: unknown } | null)?.errors;
      const detail =
        typeof errors === "string"
          ? errors
          : errors != null
            ? JSON.stringify(errors)
            : text.slice(0, 200) || `HTTP ${response.status}`;
      throw new Error(`PVE API ${m} ${path} 失败（HTTP ${response.status}）：${detail}`);
    }
    return ((json as { data?: unknown } | null)?.data ?? null) as T;
  }

  /** 等待异步任务完成：每 2s 轮询，exitstatus 非 OK 抛错，总超时 taskTimeoutSec */
  async waitTask(node: string, upid: string): Promise<void> {
    const deadline = Date.now() + this.cfg.taskTimeoutSec * 1000;
    for (;;) {
      const st = await this.request<TaskStatus>(
        "GET",
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
      );
      if (st && st.status === "stopped") {
        const exit = String(st.exitstatus ?? st.exitcode ?? "").trim();
        if (exit && exit !== "OK" && !/^0(\.\d*)?$/.test(exit)) {
          throw new Error(`PVE 任务失败（exitstatus=${exit}）：upid=${upid}`);
        }
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`PVE 任务等待超时（${this.cfg.taskTimeoutSec}s）：upid=${upid}`);
      }
      await sleep(TASK_POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ 内部工具 ============

/** 从 deliverInfo 读取 vmid/node（provision 时写入）；缺失抛错 */
function readVmRef(service: ServiceRow): { vmid: number; node: string } {
  const d = (service.deliverInfo ?? {}) as Record<string, unknown>;
  const vmid = typeof d.vmid === "number" ? d.vmid : Number(d.vmid);
  const node = typeof d.node === "string" ? d.node : "";
  if (!Number.isInteger(vmid) || vmid <= 0 || !node) {
    throw new Error(
      `服务 #${service.id} 缺少交付信息（deliverInfo.vmid/node），无法定位 PVE 实例；` +
        `如为历史服务请人工在 PVE 上处理`,
    );
  }
  return { vmid, node };
}

/** 节点选择：配置指定则用之，否则取 /nodes 第一个 online 节点 */
async function pickNode(client: PveClient): Promise<string> {
  if (client.cfg.node) return client.cfg.node;
  const nodes = await client.request<Array<{ node?: string; status?: string }>>("GET", "/nodes");
  const online = (nodes ?? []).find((n) => n.node && (n.status ?? "online") === "online");
  if (!online?.node) {
    throw new Error("PVE 无可用节点（/nodes 为空或全部离线），可在 moduleConfig.node 显式指定");
  }
  return online.node;
}

/** 解析 PVE 磁盘配置值（"local-lvm:vm-100-disk-0,size=10G" / "local-lvm:8"）为 GB */
function parseDiskSizeGB(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  let m = /size=(\d+(?:\.\d+)?)([KMGT])/i.exec(value);
  if (m) {
    const n = Number.parseFloat(m[1] ?? "");
    const unit = (m[2] ?? "").toUpperCase();
    if (unit === "G") return Math.round(n);
    if (unit === "T") return Math.round(n * 1024);
    if (unit === "M") return Math.round(n / 1024);
    return Math.round(n / (1024 * 1024));
  }
  // lxc rootfs 简写："local-lvm:8" → 8GB
  m = /^[^:]+:(\d+(?:\.\d+)?)$/.exec(value);
  if (m) return Math.round(Number.parseFloat(m[1] ?? ""));
  return null;
}

const QEMU_DISK_KEY = /^(rootfs|(ide|sata|scsi|virtio)\d+)$/;
const LXC_DISK_KEY = /^(rootfs|mp\d+)$/;

/** 查询模板/实例磁盘大小（GB）：qemu 取首个磁盘设备，lxc 取 rootfs */
async function getDiskGB(client: PveClient, node: string, vmid: number): Promise<number | null> {
  const type = client.cfg.vmType;
  const conf = await client.request<Record<string, unknown> | null>(
    "GET",
    `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/config`,
  );
  if (!conf) return null;
  const keyPattern = type === "lxc" ? LXC_DISK_KEY : QEMU_DISK_KEY;
  for (const [key, value] of Object.entries(conf)) {
    if (keyPattern.test(key)) {
      const gb = parseDiskSizeGB(value);
      if (gb != null) return gb;
    }
  }
  return null;
}

/** qemu net0：virtio + bridge + rate（0 不限速时不带 rate） */
function qemuNet0(cfg: PveModuleConfig, rateMbps: number): string {
  return rateMbps > 0
    ? `virtio,bridge=${cfg.bridge},rate=${rateMbps}`
    : `virtio,bridge=${cfg.bridge}`;
}

/** lxc net0：bridge + name=eth0 + ip=dhcp + rate */
function lxcNet0(cfg: PveModuleConfig, rateMbps: number): string {
  const parts = [`bridge=${cfg.bridge}`, "name=eth0", "ip=dhcp", "firewall=0"];
  if (rateMbps > 0) parts.push(`rate=${rateMbps}`);
  return parts.join(",");
}

/** 构造 config 更新参数（cores/memory/net0；qemu 另带 cloud-init ipconfig0/sshkeys） */
function buildResourceUpdates(
  cfg: PveModuleConfig,
  res: ParsedResources,
  opts: { requireCoresMemory: boolean },
): Record<string, string | number> {
  const updates: Record<string, string | number> = {};
  if (res.cores != null) updates.cores = res.cores;
  else if (opts.requireCoresMemory) {
    throw new Error("服务配置缺少 CPU 核数（config.cpu 形如 \"2c\"），无法开通");
  }
  if (res.memoryMiB != null) updates.memory = res.memoryMiB;
  else if (opts.requireCoresMemory) {
    throw new Error("服务配置缺少内存（config.ram 形如 \"8g\"），无法开通");
  }
  updates.net0 = cfg.vmType === "lxc" ? lxcNet0(cfg, res.bandwidthMbps) : qemuNet0(cfg, res.bandwidthMbps);
  if (cfg.vmType === "qemu") {
    updates.ipconfig0 = "ip=dhcp";
    if (cfg.sshKey) updates.sshkeys = cfg.sshKey;
  }
  return updates;
}

/** 等待实例进入 running 状态 */
async function waitRunning(client: PveClient, node: string, vmid: number): Promise<void> {
  const deadline = Date.now() + RUNNING_TIMEOUT_MS;
  for (;;) {
    const st = await client.request<{ status?: string }>(
      "GET",
      `/nodes/${encodeURIComponent(node)}/${client.cfg.vmType}/${vmid}/status/current`,
    );
    if (st?.status === "running") return;
    if (Date.now() > deadline) {
      throw new Error(`实例 vmid=${vmid} 启动后 ${RUNNING_TIMEOUT_MS / 1000}s 内未进入 running（当前 ${st?.status ?? "unknown"}）`);
    }
    await sleep(1_000);
  }
}

/**
 * 尽力获取 IP（不阻塞交付，失败返回 null）：
 * qemu 走 guest-agent network-get-interfaces（需模板装 guest-agent），
 * lxc 走 /lxc/{vmid}/interfaces；取第一个非 lo 接口的 IPv4。
 */
async function fetchIpBestEffort(
  client: PveClient,
  node: string,
  vmid: number,
  logger?: ModuleCtx["logger"],
): Promise<string | null> {
  const deadline = Date.now() + IP_WAIT_MS;
  const base = `/nodes/${encodeURIComponent(node)}/${client.cfg.vmType}/${vmid}`;
  while (Date.now() <= deadline) {
    try {
      if (client.cfg.vmType === "qemu") {
        const data = await client.request<{ result?: QemuIface[] }>("GET", `${base}/agent/network-get-interfaces`);
        for (const iface of data?.result ?? []) {
          if (!iface.name || iface.name === "lo") continue;
          const ip = (iface["ip-addresses"] ?? []).find(
            (a) => a["ip-address-type"] === "ipv4" && a["ip-address"] && a["ip-address"] !== "127.0.0.1",
          );
          if (ip?.["ip-address"]) return ip["ip-address"];
        }
      } else {
        const data = await client.request<LxcIface[] | null>("GET", `${base}/interfaces`);
        for (const iface of data ?? []) {
          if (!iface.name || iface.name === "lo") continue;
          const ip = iface.inet?.split("/")[0]?.trim();
          if (ip && ip !== "127.0.0.1") return ip;
        }
      }
    } catch (err) {
      logger?.debug({ vmid, err }, "获取实例 IP 失败（尽力而为，稍后重试）");
    }
    await sleep(3_000);
  }
  return null;
}

/** 组装实例操作路径前缀 */
function vmPath(cfg: PveModuleConfig, node: string, vmid: number): string {
  return `/nodes/${encodeURIComponent(node)}/${cfg.vmType}/${vmid}`;
}

// ============ 模块定义 ============

export const pveModule: ProvisionModule = {
  code: "pve",
  name: "Proxmox VE",
  description:
    "克隆 PVE 模板开通 qemu 虚拟机 / lxc 容器，按弹性套餐配置核数/内存/磁盘/带宽，支持 token 与 ticket 认证",
  supportedActions: [...STANDARD_MODULE_ACTIONS],

  async testConnection(config: ModuleConfig | null): Promise<TestConnectionResult> {
    let cfg: PveModuleConfig;
    try {
      cfg = parsePveConfig(config ?? {});
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    try {
      const client = new PveClient(cfg);
      const version = await client.request<{ version?: string; release?: string }>("GET", "/version");
      const nodes = await client.request<Array<{ node?: string; status?: string }>>("GET", "/nodes");
      const nodeNames = (nodes ?? [])
        .filter((n) => (n.status ?? "online") === "online")
        .map((n) => n.node)
        .filter((n): n is string => Boolean(n));
      const v = version?.version ?? version?.release ?? "未知版本";
      return {
        ok: true,
        message: `PVE v${v}，${nodeNames.length} 个节点：${nodeNames.join("、") || "无"}`,
      };
    } catch (err) {
      return { ok: false, message: `连接失败：${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async provision(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult> {
    const cfg = parsePveConfig(await resolveModuleConfig(ctx.db, service));
    const client = new PveClient(cfg);
    const res = parseServiceResources(service.config);
    const node = await pickNode(client);

    // 1) 下一 vmid
    const nextIdRaw = await client.request<string | number>("GET", "/cluster/nextid");
    const newid = Number(nextIdRaw);
    if (!Number.isInteger(newid) || newid <= 0) {
      throw new Error(`PVE /cluster/nextid 返回异常：${String(nextIdRaw)}`);
    }

    // 2) 克隆模板
    ctx.logger.info({ serviceId: service.id, node, templateVmId: cfg.templateVmId, newid }, "PVE 克隆模板开始");
    const cloneUpid = await client.request<string>(
      "POST",
      `${vmPath(cfg, node, cfg.templateVmId)}/clone`,
      {
        newid,
        name: `kvm-${service.id}`,
        full: 1,
        ...(cfg.storage ? { target: cfg.storage } : {}),
      },
    );
    await client.waitTask(node, cloneUpid);

    // clone 成功后的失败均带 vmid，便于人工清理
    try {
      // 3) 配置 cores/memory/net0（qemu 另带 cloud-init ipconfig0）
      const configUpid = await client.request<string>(
        "PUT",
        `${vmPath(cfg, node, newid)}/config`,
        buildResourceUpdates(cfg, res, { requireCoresMemory: true }),
      );
      await client.waitTask(node, configUpid);

      // 4) 磁盘扩容（只增不减：小于/等于模板盘时不 resize）
      const templateDiskGB = await getDiskGB(client, node, cfg.templateVmId).catch(() => null);
      let resized = false;
      if (res.diskGB != null && res.diskGB > 0 && (templateDiskGB == null || res.diskGB > templateDiskGB)) {
        const device = cfg.diskDevice ?? (cfg.vmType === "lxc" ? "rootfs" : "scsi0");
        const resizeUpid = await client.request<string>("PUT", `${vmPath(cfg, node, newid)}/resize`, {
          disk: device,
          size: `${res.diskGB}G`,
        });
        await client.waitTask(node, resizeUpid);
        resized = true;
      }

      // 5) 启动并等待 running
      const startUpid = await client.request<string>("POST", `${vmPath(cfg, node, newid)}/status/start`);
      await client.waitTask(node, startUpid);
      await waitRunning(client, node, newid);

      // 6) 尽力获取 IP（失败不阻塞交付）
      const ip = await fetchIpBestEffort(client, node, newid, ctx.logger);

      const messages = [
        `PVE 实例开通成功（vmid=${newid}，node=${node}，${cfg.vmType}）`,
        ...res.notes,
        ...(ip ? [] : ["未能自动获取 IP（guest-agent 未就绪或未安装），可稍后在 PVE 控制台查看"]),
      ];
      return {
        ok: true,
        message: messages.join("；"),
        deliverInfo: {
          vmid: newid,
          node,
          ...(ip ? { ip } : {}),
          type: cfg.vmType,
          status: "running",
        },
        raw: {
          module: "pve",
          vmid: newid,
          node,
          templateVmId: cfg.templateVmId,
          templateDiskGB,
          resized,
          resources: {
            cores: res.cores,
            memoryMiB: res.memoryMiB,
            diskGB: res.diskGB,
            bandwidthMbps: res.bandwidthMbps,
            ipCount: res.ipCount,
          },
        },
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `PVE 开通中途失败（vmid=${newid}，node=${node}，克隆已完成，如需清理请人工删除）：${detail}`,
      );
    }
  },

  async suspend(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult> {
    const cfg = parsePveConfig(await resolveModuleConfig(ctx.db, service));
    const client = new PveClient(cfg);
    const { vmid, node } = readVmRef(service);
    const action = cfg.suspendMode === "stop" ? "stop" : "suspend";
    const upid = await client.request<string>("POST", `${vmPath(cfg, node, vmid)}/status/${action}`);
    await client.waitTask(node, upid);
    ctx.logger.info({ serviceId: service.id, vmid, node, action }, "PVE 实例已暂停");
    return {
      ok: true,
      message: `PVE 实例已${action === "stop" ? "停止" : "暂停"}（vmid=${vmid}，node=${node}）`,
      raw: { module: "pve", vmid, node, action },
    };
  },

  async unsuspend(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult> {
    const cfg = parsePveConfig(await resolveModuleConfig(ctx.db, service));
    const client = new PveClient(cfg);
    const { vmid, node } = readVmRef(service);

    const st = await client.request<{ status?: string; qmpstatus?: string }>(
      "GET",
      `${vmPath(cfg, node, vmid)}/status/current`,
    );
    // stopped → start（如 suspendMode=stop 或关机）；qemu 挂起（qmpstatus=paused）→ resume
    let action: "start" | "resume";
    if (st?.status === "stopped") {
      action = "start";
    } else if (st?.qmpstatus === "paused" || st?.status === "suspended") {
      action = "resume";
    } else {
      return {
        ok: true,
        message: `PVE 实例已在运行，无需恢复（vmid=${vmid}，status=${st?.status ?? "unknown"}）`,
        raw: { module: "pve", vmid, node, action: "none" },
      };
    }
    const upid = await client.request<string>("POST", `${vmPath(cfg, node, vmid)}/status/${action}`);
    await client.waitTask(node, upid);
    if (action === "start") await waitRunning(client, node, vmid);
    ctx.logger.info({ serviceId: service.id, vmid, node, action }, "PVE 实例已恢复");
    return {
      ok: true,
      message: `PVE 实例已恢复运行（vmid=${vmid}，node=${node}，${action}）`,
      raw: { module: "pve", vmid, node, action },
    };
  },

  async terminate(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult> {
    const cfg = parsePveConfig(await resolveModuleConfig(ctx.db, service));
    const client = new PveClient(cfg);
    const { vmid, node } = readVmRef(service);

    // 先停止（已在 stopped 则跳过），等待停止后再删除
    const st = await client.request<{ status?: string }>("GET", `${vmPath(cfg, node, vmid)}/status/current`);
    if (st?.status !== "stopped") {
      const stopUpid = await client.request<string>("POST", `${vmPath(cfg, node, vmid)}/status/stop`);
      await client.waitTask(node, stopUpid);
      // 等待状态真正变为 stopped
      const deadline = Date.now() + RUNNING_TIMEOUT_MS;
      for (;;) {
        const cur = await client.request<{ status?: string }>(
          "GET",
          `${vmPath(cfg, node, vmid)}/status/current`,
        );
        if (cur?.status === "stopped") break;
        if (Date.now() > deadline) {
          throw new Error(`PVE 实例 vmid=${vmid} 停止超时，未执行删除，请人工检查`);
        }
        await sleep(1_000);
      }
    }
    await client.request<void>(
      "DELETE",
      `${vmPath(cfg, node, vmid)}`,
      { purge: 1, "destroy-unreferenced-disks": 1 },
    );
    ctx.logger.info({ serviceId: service.id, vmid, node }, "PVE 实例已删除");
    return {
      ok: true,
      message: `vmid ${vmid} 已删除（node=${node}）`,
      raw: { module: "pve", vmid, node, deleted: true },
    };
  },

  async changePackage(
    ctx: ModuleCtx,
    service: ServiceRow,
    target: ChangePackageTarget,
  ): Promise<ModuleResult> {
    const cfg = parsePveConfig(await resolveModuleConfig(ctx.db, service));
    const client = new PveClient(cfg);
    const { vmid, node } = readVmRef(service);
    const res = parseServiceResources(target.config);

    const updates = buildResourceUpdates(cfg, res, { requireCoresMemory: false });
    const configUpid = await client.request<string>("PUT", `${vmPath(cfg, node, vmid)}/config`, updates);
    await client.waitTask(node, configUpid);

    // 磁盘只增不减
    const messages = [`PVE 实例配置已更新（vmid=${vmid}）`, ...res.notes];
    let diskNote: string | null = null;
    if (res.diskGB != null && res.diskGB > 0) {
      const currentGB = await getDiskGB(client, node, vmid).catch(() => null);
      if (currentGB == null) {
        diskNote = "无法确认当前磁盘大小，遵循只增不减原则跳过磁盘调整";
      } else if (res.diskGB < currentGB) {
        diskNote = `目标磁盘 ${res.diskGB}GB 小于当前 ${currentGB}GB，磁盘只增不减，保持不变`;
      } else if (res.diskGB > currentGB) {
        const device = cfg.diskDevice ?? (cfg.vmType === "lxc" ? "rootfs" : "scsi0");
        const resizeUpid = await client.request<string>("PUT", `${vmPath(cfg, node, vmid)}/resize`, {
          disk: device,
          size: `${res.diskGB}G`,
        });
        await client.waitTask(node, resizeUpid);
        diskNote = `磁盘已扩容至 ${res.diskGB}GB`;
      }
    }
    if (diskNote) messages.push(diskNote);

    ctx.logger.info({ serviceId: service.id, vmid, node, updates }, "PVE 实例套餐变更完成");
    return {
      ok: true,
      message: messages.join("；"),
      deliverInfo: { vmid, node, type: cfg.vmType },
      raw: { module: "pve", vmid, node, updates, diskNote },
    };
  },
};
