/**
 * zjmf 上游查询与同步工具（供应商管理页 / 商品映射 / 主机指派 / 上游状态查看共用）。
 *
 * - syncSupplierProducts：拉上游商品列表（含代理价与各周期价）upsert 到
 *   zjmf_upstream_products 同步表（落库同款：上游离线也能选商品）。
 *   本地售价与此无关——始终由商品定价（product_pricing）决定。
 * - fetchUpstreamHosts：上游账户已开通主机列表（主机指派用）。
 * - fetchUpstreamBalance：上游账户余额（GET index → data.client.credit；
 *   user_info 的 credit 是信用卡信息而非余额，勿用）。
 * - fetchServiceUpstreamStatus：按服务查上游主机状态/到期/账号（状态查看弹窗）。
 *
 * 上游响应解析均为防御式（字段名因上游版本而异，联调结论见 MNBT 插件 PRD Q1/Q3）。
 */
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db/client";
import type { ServiceRow } from "@qmkvm/core";
import { ZjmfClient } from "./client.js";
import { isZjmfOk } from "./client.js";
import { findSupplierSetting, supplierSettingToConfig } from "./config.js";
import { toLocalCycle, ZJMF_CYCLES } from "./cycles.js";
import type { RenewableCycle } from "./cycles.js";
import { parseMoneyToCents } from "./money.js";

const { zjmfUpstreamProducts } = schema;

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

/** 从响应对象取首个非空价格字段（元），转分；无价格返回 0 */
function pickPriceCents(item: Rec): number {
  for (const k of ["price", "renew_price", "renewal_price", "setup_fee", "total", "amount"]) {
    const cents = parseMoneyToCents(item[k]);
    if (cents != null && cents > 0) return cents;
  }
  return 0;
}

/** 周期键归一化：匹配内置周期（monthly → Monthly 风格的本地键），不认识则原样返回 */
function normalizeCycleKey(key: string): string {
  const lower = key.toLowerCase();
  for (const local of Object.keys(ZJMF_CYCLES)) {
    if (lower === local) return local;
  }
  return toLocalCycle(key) ?? key;
}

/**
 * 从上游商品列表行提取各周期价格（分），兼容三种结构：
 * a. 完整周期：cycle/pricing 为数组或映射
 * b. 并行数组：billingcycle[] + billingcycle_price[]（+ billingcycle_zh[]）
 * c. 单周期：billingcycle + price + billingcycle_zh
 */
export function parseUpstreamCycles(item: Rec): Map<string, { upCycle: string; name: string; cents: number }> {
  const out = new Map<string, { upCycle: string; name: string; cents: number }>();
  const add = (rawKey: string, cents: number, name: string) => {
    if (!rawKey || cents <= 0) return;
    const local = normalizeCycleKey(rawKey);
    if (!out.has(local)) out.set(local, { upCycle: rawKey, name: name || ZJMF_CYCLES[local as RenewableCycle]?.name || local, cents });
  };

  const raw = item.cycle ?? item.pricing;
  let cycles: unknown = raw;
  if (typeof raw === "string") {
    try {
      cycles = JSON.parse(raw);
    } catch {
      cycles = null;
    }
  }
  if (Array.isArray(cycles)) {
    for (const entry of cycles) {
      const e = asRec(entry);
      add(String(e.billingcycle ?? e.cycle ?? ""), pickPriceCents(e), String(e.name ?? e.billingcycle_zh ?? ""));
    }
  } else if (cycles && typeof cycles === "object") {
    for (const [k, v] of Object.entries(asRec(cycles))) {
      const e = asRec(v);
      add(k, e && Object.keys(e).length > 0 ? pickPriceCents(e) : parseMoneyToCents(v) ?? 0, String(e.name ?? e.billingcycle_zh ?? ""));
    }
  }
  if (out.size === 0 && Array.isArray(item.billingcycle) && Array.isArray(item.billingcycle_price)) {
    const names = Array.isArray(item.billingcycle_zh) ? item.billingcycle_zh : [];
    item.billingcycle.forEach((k, i) => {
      const cents = parseMoneyToCents((item.billingcycle_price as unknown[])[i]);
      add(String(k ?? ""), cents ?? 0, String(names[i] ?? ""));
    });
  }
  if (out.size === 0 && typeof item.billingcycle === "string" && item.billingcycle !== "") {
    add(item.billingcycle, pickPriceCents(item), String(item.billingcycle_zh ?? ""));
  }
  return out;
}

/** 上游列表行的模块类型（魔方字段为 type） */
function itemModule(item: Rec): string {
  return String(item.type ?? item.module ?? item.module_name ?? "");
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface SyncProductsResult {
  updated: number;
  failed: number;
  /** 因数量超限未逐个拉取详情（仅列表价）的商品数 */
  detailsSkipped: number;
  /** 超过单次 100 上限未同步的商品数（再执行一次可续传） */
  skippedOverLimit?: number;
}

/**
 * 按供应商同步上游商品到 zjmf_upstream_products（upsert，幂等可重复执行）。
 * 列表行按 up_product_id 分组合并周期；代理价优先取详情（price_basis=agent），
 * 详情失败/超限回退列表价。
 *
 * 续传：上游列表接口一次返回全部商品（无分页），单轮落库上限 100 个——
 * 跳过已同步 pid，从未落库的商品继续，再执行即续传（已同步商品若上游有价变，
 * 需删除映射商品后重同步或等后续的「全量刷新」入口）。
 */
export async function syncSupplierProducts(db: Db, supplierCode: string): Promise<SyncProductsResult> {
  const setting = await findSupplierSetting(db, supplierCode);
  const client = new ZjmfClient(supplierSettingToConfig(setting));

  const list = await client.get<Rec>("api/product/list");
  if (!isZjmfOk(list)) {
    throw new Error(`拉取上游商品列表失败：${list.msg ?? `status=${list.status}`}`);
  }
  const rows = Array.isArray(asRec(list.data).list) ? (asRec(list.data).list as Rec[]) : [];
  const currency = String(asRec(list.data).currency_code ?? "");

  // 按 pid 分组（同商品可能每周期一行）
  const grouped = new Map<number, Rec[]>();
  for (const row of rows) {
    const pid = Number(row.id);
    if (Number.isInteger(pid) && pid > 0) {
      const list2 = grouped.get(pid) ?? [];
      list2.push(row);
      grouped.set(pid, list2);
    }
  }

  const today = todayStr();
  const result: SyncProductsResult = { updated: 0, failed: 0, detailsSkipped: 0 };
  let detailBudget = 30; // 详情请求预算：商品多时优先保列表价，避免同步被拖垮

  // 单轮最多落库 100 个商品：跳过已同步的（upsert 幂等，但重复同步浪费详情预算），
  // 从未落库的商品继续，实现跨轮续传（上游列表接口不分页，返回全部 257+ 行）。
  const allIds = [...grouped.keys()];
  const synced = await db
    .select({ upProductId: schema.zjmfUpstreamProducts.upProductId })
    .from(schema.zjmfUpstreamProducts)
    .where(eq(schema.zjmfUpstreamProducts.supplierCode, supplierCode));
  const syncedSet = new Set(synced.map((r) => r.upProductId));
  const freshIds = allIds.filter((id) => !syncedSet.has(id));
  const productIds = freshIds.slice(0, 100);
  result.skippedOverLimit = freshIds.length - productIds.length;

  for (const upProductId of productIds) {
    const productRows = grouped.get(upProductId)!;
    const first = productRows[0] ?? {};

    // 周期：合并所有列表行的周期条目
    const cycles = new Map<string, { cycle: string; upCycle: string; name: string; agentPriceCents: number }>();
    for (const row of productRows) {
      for (const [key, entry] of parseUpstreamCycles(row)) {
        if (!cycles.has(key)) {
          cycles.set(key, { cycle: key, upCycle: entry.upCycle, name: entry.name, agentPriceCents: entry.cents });
        }
      }
    }

    // 代理价 + 缺失周期：逐商品拉详情（price_basis=agent）
    let agentPriceCents = 0;
    if (detailBudget > 0) {
      detailBudget -= 1;
      try {
        const detail = await client.get<Rec>(`api/product/${upProductId}?price_basis=agent`, undefined, 10);
        if (isZjmfOk(detail)) {
          const prod = asRec(asRec(detail.data).product ?? detail.data);
          agentPriceCents = pickPriceCents(prod);
          for (const [key, entry] of parseUpstreamCycles(prod)) {
            if (!cycles.has(key)) {
              cycles.set(key, { cycle: key, upCycle: entry.upCycle, name: entry.name, agentPriceCents: entry.cents });
            }
          }
        }
      } catch {
        // 详情失败不致命：回退列表价
      }
    } else {
      result.detailsSkipped += 1;
    }
    if (agentPriceCents <= 0) {
      for (const row of productRows) {
        agentPriceCents = pickPriceCents(row);
        if (agentPriceCents > 0) break;
      }
    }
    if (agentPriceCents <= 0 && cycles.size > 0) {
      agentPriceCents = Math.min(...[...cycles.values()].map((c) => c.agentPriceCents).filter((c) => c > 0));
      if (!Number.isFinite(agentPriceCents)) agentPriceCents = 0;
    }

    const payload = {
      supplierCode,
      upProductId,
      name: String(first.name ?? `上游 #${upProductId}`),
      description: typeof first.description === "string" ? first.description : null,
      currency,
      agentPriceCents,
      cycles: [...cycles.values()],
      module: itemModule(first),
      serverGroup: String(first.server_group ?? first.groupname ?? ""),
      syncedAt: today,
      updatedAt: new Date(),
    };

    try {
      await db
        .insert(zjmfUpstreamProducts)
        .values(payload)
        .onDuplicateKeyUpdate({
          set: {
            name: payload.name,
            description: payload.description,
            currency: payload.currency,
            agentPriceCents: payload.agentPriceCents,
            cycles: payload.cycles,
            module: payload.module,
            serverGroup: payload.serverGroup,
            syncedAt: payload.syncedAt,
            updatedAt: payload.updatedAt,
          },
        });
      result.updated += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

// ============ 上游主机（指派/状态查看） ============

/** 上游主机行（host/list 归一化） */
export interface UpstreamHost {
  upHostId: number;
  /** 主机标识（域名/名称） */
  name: string;
  productName: string;
  /** 上游原始状态（Active/Suspended/...） */
  rawStatus: string;
  /** 归一化状态：active/pending/suspend/terminated/unknown */
  status: "active" | "pending" | "suspend" | "terminated" | "unknown";
  ip: string;
  username: string;
  cycle: string;
  expireAt?: string;
}

/** 上游状态 → 本地展示状态（移植插件 mapHostStatus） */
export function mapUpstreamHostStatus(data: Rec): UpstreamHost["status"] {
  const st = String(data.status ?? data.domainstatus ?? "").toLowerCase().trim();
  if (["active", "on", "true", "completed", "运行中"].includes(st)) return "active";
  if (["pending", "wait", "waiting", "待开通"].includes(st)) return "pending";
  if (["suspended", "suspend", "paused", "off", "已暂停"].includes(st)) return "suspend";
  if (["cancelled", "cancel", "terminated", "terminate", "fraud", "已终止"].includes(st)) return "terminated";
  // 无状态字段时用 qk 兜底（false 视为不可用）
  const qk = data.qk;
  if (qk !== undefined && qk !== null && ["false", "0", ""].includes(String(qk))) return "suspend";
  return "unknown";
}

/** 上游日期 → YYYY-MM-DD（兼容 Date 串与秒/毫秒时间戳） */
function normalizeDateStr(val: unknown): string | undefined {
  const s = String(val ?? "").trim();
  if (s === "") return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  if (/^\d+$/.test(s)) {
    let t = Number(s);
    if (t > 100_000_000_000) t = Math.floor(t / 1000);
    const d = new Date(t * 1000);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

/** 主机详情解包（兼容 host_data/host/info/list/data 键与数组外壳） */
function pickHostData(data: unknown): Rec {
  const d = asRec(data);
  for (const k of ["host_data", "host", "info", "list", "data"]) {
    const v = d[k];
    if (Array.isArray(v) && v.length > 0) return asRec(v[0]);
    if (v != null && typeof v === "object") return asRec(v);
  }
  return d;
}

function normalizeHostRow(item: Rec): UpstreamHost {
  const data = pickHostData(item);
  return {
    upHostId: Number(data.id ?? 0),
    name: String(data.domain ?? data.name ?? ""),
    productName: String(data.productname ?? data.name ?? ""),
    rawStatus: String(data.status ?? data.domainstatus ?? ""),
    status: mapUpstreamHostStatus(data),
    ip: String(data.dedicatedip ?? data.ip ?? ""),
    username: String(data.username ?? ""),
    cycle: String(data.billingcycle ?? ""),
    expireAt: normalizeDateStr(data.nextduedate ?? data.renewdate ?? data.renew_date),
  };
}

/** 拉取上游账户已开通主机列表（指派页数据源；短超时防拖垮后台） */
export async function fetchUpstreamHosts(db: Db, supplierCode: string): Promise<UpstreamHost[]> {
  const setting = await findSupplierSetting(db, supplierCode);
  const client = new ZjmfClient({ ...supplierSettingToConfig(setting), apiTimeoutSec: 8 });
  const res = await client.get<Rec>("host/list", undefined, 10);
  if (!isZjmfOk(res)) {
    throw new Error(`拉取上游主机列表失败：${res.msg ?? `status=${res.status}`}`);
  }
  const data = asRec(res.data);
  const list = Array.isArray(data.list) ? data.list : Array.isArray(data.hosts) ? data.hosts : [];
  return list.map((item) => normalizeHostRow(asRec(item))).filter((h) => h.upHostId > 0);
}

/** 查询上游账户余额（元字符串原样返回 + 分表示） */
export async function fetchUpstreamBalance(
  db: Db,
  supplierCode: string,
): Promise<{ credit: string; creditCents: number | null; currency: string }> {
  const setting = await findSupplierSetting(db, supplierCode);
  const client = new ZjmfClient({ ...supplierSettingToConfig(setting), apiTimeoutSec: 8 });

  // 优先 GET index → data.client[].credit；失败兜底 user_info（部分版本 credit 即余额）
  try {
    const home = await client.get<Rec>("index", undefined, 10);
    if (isZjmfOk(home)) {
      const clients = asRec(home.data).client;
      const candidates = Array.isArray(clients) ? clients : clients != null ? [clients] : [];
      for (const c of candidates) {
        const credit = asRec(c).credit;
        if (credit !== undefined && credit !== "") {
          return {
            credit: String(credit),
            creditCents: parseMoneyToCents(credit),
            currency: String(asRec(c).currency ?? ""),
          };
        }
      }
    }
  } catch {
    // 兜底 user_info
  }
  const info = await client.get<Rec>("user_info", undefined, 10);
  if (!isZjmfOk(info)) {
    throw new Error(`查询上游余额失败：${info.msg ?? `status=${info.status}`}`);
  }
  const data = asRec(info.data);
  const credit = data.credit ?? data.credit_balance ?? "";
  return { credit: String(credit), creditCents: parseMoneyToCents(credit), currency: String(data.currency ?? "") };
}

/** 按服务查上游主机状态/到期/账号（状态查看弹窗；短超时防拖垮后台） */
export async function fetchServiceUpstreamStatus(
  db: Db,
  service: ServiceRow,
): Promise<{ status: UpstreamHost["status"]; rawStatus: string; expireAt?: string; ip: string; username: string; productName: string }> {
  // 延迟导入避免与 index.ts 的循环依赖（index 也会用到本文件的映射函数）
  const { resolveModuleConfig } = await import("../../config.js");
  const { resolveZjmfConfig } = await import("./config.js");
  const cfg = await resolveZjmfConfig(db, await resolveModuleConfig(db, service));

  const d = (service.deliverInfo ?? {}) as Rec;
  const upHostId = Number(d.upHostId ?? 0);
  if (!Number.isInteger(upHostId) || upHostId <= 0) {
    throw new Error(`服务 #${service.id} 缺少上游主机 ID（deliverInfo.upHostId）`);
  }
  const client = new ZjmfClient({ ...cfg.supplier, apiTimeoutSec: 8 });
  for (const path of ["host/product", "host/header"] as const) {
    try {
      const res = await client.get(path, { host_id: upHostId }, 10);
      if (isZjmfOk(res)) {
        const host = pickHostData(res.data);
        return {
          status: mapUpstreamHostStatus(host),
          rawStatus: String(host.status ?? host.domainstatus ?? ""),
          expireAt: normalizeDateStr(host.nextduedate ?? host.renewdate ?? host.renew_date),
          ip: String(host.dedicatedip ?? host.ip ?? ""),
          username: String(host.username ?? ""),
          productName: String(host.productname ?? host.name ?? ""),
        };
      }
    } catch {
      // 尝试下一个端点
    }
  }
  throw new Error("上游主机查询失败（host/product 与 host/header 均不可用）");
}

/** 查本地已绑定的上游主机 ID 集合（指派页标注"已指派"） */
export async function findBoundUpHostIds(db: Db, upHostIds: number[]): Promise<Set<number>> {
  if (upHostIds.length === 0) return new Set();
  const rows = await db
    .select({ id: schema.services.id, deliverInfo: schema.services.deliverInfo })
    .from(schema.services)
    .where(inArray(schema.services.status, ["pending", "active", "suspended_overdue", "suspended_manual"]));
  const want = new Set(upHostIds);
  const bound = new Set<number>();
  for (const row of rows) {
    const upHostId = Number((row.deliverInfo as Rec | null)?.upHostId ?? 0);
    if (want.has(upHostId)) bound.add(upHostId);
  }
  return bound;
}

/** 按供应商 + 上游商品 ID 查同步商品行 */
export async function findSyncedProduct(db: Db, supplierCode: string, upProductId: number) {
  const rows = await db
    .select()
    .from(zjmfUpstreamProducts)
    .where(
      and(
        eq(zjmfUpstreamProducts.supplierCode, supplierCode),
        eq(zjmfUpstreamProducts.upProductId, upProductId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
