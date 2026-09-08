/**
 * 魔方财务（ZJMF / cube_finance）供应模块 —— 代理商直通模式。
 *
 * 本地系统独占账务与生命周期（商品/定价/订单/账单/续费/逾期全部在核心），
 * 本模块只负责把"资源动作"翻译成上游 API 调用：
 *
 * - provision：清空购物车 → add_to_shop → cart/settle（checkout=1）→ apply_credit 余额抵扣
 *   → 轮询账单取主机 ID → host/header 取交付信息。结算成功即把上游 invoiceId 写入
 *   deliverInfo（崩溃重试时先对账再决定是否重新购买，杜绝重复开通）。
 * - renew：POST host/renew 续费上游主机（+ 防御性 apply_credit），回写上游新到期日。
 *   核心续费结算（手动/余额自动）会为所有非一次性服务建 renew 任务，未实现该动作的
 *   模块由 runner 标记 skipped。
 * - suspend/unsuspend：会员级 API 无主机暂停端点，用 provision/default 断电/开机实现
 *   欠费管控（result.message 中明示）；terminate 走 POST host/cancel 取消请求。
 * - changePackage：目标商品 moduleConfig 解析上游 pid，upgrade/upgrade_product_post 提交；
 *   要求目标商品与当前服务同一供应商（supplierCode 或 baseUrl+username 一致）。
 *
 * 上游写操作按供应商互斥（lock.ts）——魔方购物车是账号级共享资源，并发结算会互相污染。
 * 所有上游响应在写入任务结果/日志前经 redactZjmf 脱敏（host/header 含明文密码）。
 *
 * 端点与响应字段因上游版本存在差异，解析均为防御式（对照 MNBT zjmfmanager_reserve
 * lib/upstream.php 的联调结论；端点清单集中在 zjmf/endpoints 常量便于调整）。
 */
import { eq } from "drizzle-orm";
import { schema } from "@qmkvm/db/client";
import type { Json } from "@qmkvm/db/schema";
import type { ServiceRow } from "@qmkvm/core";
import { resolveModuleConfig } from "../../config.js";
import { STANDARD_MODULE_ACTIONS } from "../../types.js";
import type {
  ChangePackageTarget,
  ModuleCtx,
  ModuleResult,
  ProvisionModule,
  TestConnectionResult,
} from "../../types.js";
import { ZjmfClient, ZjmfApiError, isZjmfOk, redactZjmf, sleep } from "./client.js";
import type { ZjmfResponse } from "./client.js";
import { resolveZjmfConfig, parseInlineSupplier } from "./config.js";
import type { ZjmfModuleConfig } from "./config.js";

// 供应商配置工具随包出口（后台「魔方供应商」管理路由使用）
export {
  ZJMF_SUPPLIERS_SETTING_KEY,
  loadSupplierSettings,
  findSupplierSetting,
  supplierSettingToConfig,
  resolveZjmfConfig,
  parseInlineSupplier,
} from "./config.js";
export type { ZjmfSupplierSetting, ZjmfModuleConfig } from "./config.js";
export type { ZjmfSupplierConfig } from "./client.js";
export { encryptSettingValue, decryptSettingValue, isEncryptedSettingValue } from "./crypto.js";

// 上游查询与同步工具（供应商管理/商品映射/主机指派/状态查看）
export {
  syncSupplierProducts,
  fetchUpstreamHosts,
  fetchUpstreamBalance,
  fetchServiceUpstreamStatus,
  findBoundUpHostIds,
  findSyncedProduct,
  parseUpstreamCycles,
} from "./upstream.js";
export type { UpstreamHost, SyncProductsResult } from "./upstream.js";
export { toLocalCycle } from "./cycles.js";
import { resolveUpCycle } from "./cycles.js";
import type { RenewableCycle } from "./cycles.js";
import { centsToYuan, parseMoneyToCents } from "./money.js";
import { withSupplierLock } from "./lock.js";

const { products, services } = schema;

// ============ 上游响应解析辅助（防御式，字段名以实际返回为准） ============

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

/** 从 data 中找上游订单/账单 ID（兼容 id/order_id/orderid/invoiceid/invoice_id） */
function findId(data: unknown): number {
  const d = asRec(data);
  for (const k of ["invoiceid", "invoice_id", "orderid", "order_id", "id"]) {
    const v = d[k];
    const n = Array.isArray(v) ? Number(v[0]) : Number(v);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return 0;
}

/** 从 data 中找上游主机 ID（兼容 host_id/hostid/hid/id 与嵌套 host） */
function findHostId(data: unknown): number {
  const d = asRec(data);
  for (const k of ["host_id", "hostid", "hid", "id"]) {
    const n = Number(d[k]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  if (d.host && typeof d.host === "object") return findHostId(d.host);
  return 0;
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

/** 账单支付状态是否已支付（兼容英文/中文） */
function isPaidStatus(status: unknown): boolean {
  return ["paid", "已支付", "completed", "complete", "success", "payment"].includes(
    String(status ?? "").toLowerCase().trim(),
  );
}

/** 上游日期归一化 → "YYYY-MM-DD"（兼容 Date 串与秒/毫秒时间戳） */
function normalizeUpDate(val: unknown): string | undefined {
  const s = String(val ?? "").trim();
  if (s === "") return undefined;
  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (dateMatch) return dateMatch[1];
  if (/^\d+$/.test(s)) {
    let t = Number(s);
    if (t > 100_000_000_000) t = Math.floor(t / 1000); // 毫秒时间戳
    const d = new Date(t * 1000);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

/** 从计价响应提取金额（分）：data 顶层价格字段 → products[].signal_price 等（防御式） */
function parseUpPriceCents(data: unknown): number | null {
  const d = asRec(data);
  const PRICE_KEYS = ["signal_price", "product_price", "price_total", "price", "total", "amount", "subtotal", "renewal_price", "money"];
  for (const k of PRICE_KEYS) {
    const cents = parseMoneyToCents(d[k]);
    if (cents != null && cents > 0) return cents;
  }
  if (Array.isArray(d.products)) {
    for (const p of d.products) {
      for (const k of PRICE_KEYS) {
        const cents = parseMoneyToCents(asRec(p)[k]);
        if (cents != null && cents > 0) return cents;
      }
    }
  }
  return null;
}

/** 生成上游主机名（官方示例风格：ser + 12 位随机串） */
function randHostName(): string {
  return `ser${Math.random().toString(36).slice(2, 14).padEnd(12, "0")}`;
}

/** 生成随机初始密码（12 位字母数字，密码学随机） */
function randPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

// ============ deliverInfo 读写 ============

interface UpRef {
  upHostId: number;
  upInvoiceId: number;
}

function readUpRef(service: ServiceRow): UpRef {
  const d = asRec(service.deliverInfo);
  return {
    upHostId: Number.isInteger(Number(d.upHostId)) ? Number(d.upHostId) : 0,
    upInvoiceId: Number.isInteger(Number(d.upInvoiceId)) ? Number(d.upInvoiceId) : 0,
  };
}

/** 立即合并写入 deliverInfo（结算成功后马上落上游 invoiceId，重试对账依赖此值） */
async function persistDeliverInfo(
  ctx: ModuleCtx,
  service: ServiceRow,
  patch: Rec,
): Promise<void> {
  const merged = { ...asRec(service.deliverInfo), ...patch };
  await ctx.db
    .update(services)
    .set({ deliverInfo: merged as Json })
    .where(eq(services.id, service.id));
  (service as { deliverInfo?: unknown }).deliverInfo = merged;
}

function requireUpHostId(service: ServiceRow): number {
  const { upHostId } = readUpRef(service);
  if (!upHostId) {
    throw new ZjmfApiError(
      `服务 #${service.id} 缺少上游主机 ID（deliverInfo.upHostId），无法操作上游资源；如为历史服务请人工在上游处理`,
    );
  }
  return upHostId;
}

// ============ 上游流程 ============

/**
 * 上游账单：支付状态 + 关联主机 ID（主机创建可能异步，最多轮询 maxTries 次，间隔 2s）。
 * found=false 表示账单不存在/已作废（区分"未支付"——后者应保留引用等待重试）。
 */
async function invoicePaidAndHost(
  client: ZjmfClient,
  invoiceId: number,
  maxTries: number,
): Promise<{ found: boolean; paid: boolean; hostId: number }> {
  for (let i = 0; i < maxTries; i++) {
    const res = await client.get(`invoices/${invoiceId}`);
    if (isZjmfOk(res)) {
      const data = asRec(res.data);
      const inv = Array.isArray(data.invoices) ? asRec(data.invoices[0]) : asRec(data.invoices);
      const paid = isPaidStatus(inv.status);
      let hostId = 0;
      const items = Array.isArray(data.host) ? data.host : [];
      for (const item of items) {
        const num = asRec(item).num;
        const n = Array.isArray(num) ? Number(num.find((x) => Number(x) > 0)) : Number(num);
        if (Number.isInteger(n) && n > 0) {
          hostId = n;
          break;
        }
      }
      if (paid || hostId > 0) return { found: true, paid, hostId };
      // 账单存在但未支付：继续轮询（主机可能稍后创建）
      if (i === maxTries - 1) return { found: true, paid: false, hostId: 0 };
    } else if (i === maxTries - 1) {
      return { found: false, paid: false, hostId: 0 };
    }
    if (i < maxTries - 1) await sleep(2_000);
  }
  return { found: false, paid: false, hostId: 0 };
}

/** host/header 查询交付信息（状态字段更稳的 host/product 失败时回退） */
async function fetchHostHeader(
  client: ZjmfClient,
  upHostId: number,
): Promise<{ username: string; password: string; name: string; expireAt?: string }> {
  for (const path of ["host/product", "host/header"]) {
    try {
      const res = await client.get(path, { host_id: upHostId });
      if (isZjmfOk(res)) {
        const host = pickHostData(res.data);
        return {
          username: String(host.username ?? ""),
          password: String(host.password ?? ""),
          name: String(host.productname ?? host.name ?? ""),
          expireAt: normalizeUpDate(host.nextduedate ?? host.renew_date ?? host.renewdate),
        };
      }
    } catch {
      // 尝试下一个端点
    }
  }
  return { username: "", password: "", name: "" };
}

interface ProbedProductConfig {
  cycleKeys: string[];
  currencyId?: number;
  configOption: Record<string, string>;
}

/**
 * 探测上游商品配置（cart/get_product_config，失败回退商品详情）：
 * 可选周期键、默认货币 ID、配置项默认选择。全部防御式解析，探测不到返回空。
 */
async function probeProductConfig(
  client: ZjmfClient,
  upProductId: number,
): Promise<ProbedProductConfig> {
  const out: ProbedProductConfig = { cycleKeys: [], configOption: {} };
  let product: Rec = {};
  for (const path of [`cart/get_product_config?pid=${upProductId}`, `api/product/${upProductId}?price_basis=agent`]) {
    try {
      const res = await client.get(path);
      if (!isZjmfOk(res)) continue;
      const data = asRec(res.data);
      const cand = data.products ?? data.product;
      if (Array.isArray(cand)) product = asRec(cand[0]);
      else if (cand != null && typeof cand === "object") product = asRec(cand);
      if (out.currencyId === undefined && Number.isInteger(Number(data.default_currency))) {
        out.currencyId = Number(data.default_currency);
      }
      if (out.currencyId === undefined && Array.isArray(data.currencies) && data.currencies.length > 0) {
        const cid = Number(asRec(data.currencies[0]).id);
        if (cid > 0) out.currencyId = cid;
      }
      if (product && (Object.keys(product).length > 0 || out.currencyId !== undefined)) break;
    } catch {
      continue;
    }
  }
  if (!product || Object.keys(product).length === 0) return out;

  // 周期键：cycle/pricing 映射或数组 → billingcycle 并行数组 → 单周期字段
  const rawCycles = product.cycle ?? product.pricing;
  if (rawCycles != null && typeof rawCycles === "object") {
    const list = Array.isArray(rawCycles) ? rawCycles : Object.entries(asRec(rawCycles)).map(([k, v]) => ({ ...(asRec(v)), billingcycle: asRec(v).billingcycle ?? k }));
    for (const item of list) {
      const key = String(asRec(item).billingcycle ?? "");
      if (key !== "") out.cycleKeys.push(key);
    }
  }
  if (Array.isArray(product.billingcycle)) {
    for (const k of product.billingcycle) {
      const key = String(k ?? "");
      if (key !== "" && !out.cycleKeys.includes(key)) out.cycleKeys.push(key);
    }
  }
  if (typeof product.billingcycle === "string" && product.billingcycle !== "") {
    out.cycleKeys.push(product.billingcycle);
  }

  // 配置项默认值：checked/selected/default 标记优先，否则首个子项；数量型取 qty
  const groups = product.configoption ?? product.config_option;
  const groupList = Array.isArray(groups) ? groups : groups != null && typeof groups === "object" ? Object.entries(asRec(groups)).map(([k, v]) => ({ ...(asRec(v)), id: asRec(v).id ?? k })) : [];
  for (const group of groupList) {
    const g = asRec(group);
    const oid = Number(g.id);
    if (!Number.isInteger(oid) || oid <= 0) continue;
    const type = String(g.type ?? "").toLowerCase();
    if (["qty", "quantity", "number"].includes(type)) {
      out.configOption[String(oid)] = String(g.qty ?? g.quantity ?? g.value ?? 1);
      continue;
    }
    const subsRaw = g.option ?? g.options ?? g.values;
    const subs = Array.isArray(subsRaw) ? subsRaw : [];
    let picked: Rec | null = null;
    for (const s of subs) {
      const sub = asRec(s);
      picked = picked ?? sub;
      if (["checked", "selected", "default", "is_check", "is_default"].some((f) => Number(sub[f]) === 1)) {
        picked = sub;
        break;
      }
    }
    if (picked) {
      const val = picked.id ?? picked.suboption_id ?? picked.value;
      if (val !== undefined && val !== null && val !== "") out.configOption[String(oid)] = String(val);
    }
  }
  return out;
}

/** 失败信息是否与周期/价格相关（命中才触发周期探测重试） */
function isCyclePriceError(msg: string): boolean {
  return /未配置价格|价格错误|周期|cycle/i.test(msg);
}

/** 加购请求参数（含货币/配置项默认值兜底；configoption 以 configoption[<id>] 键展平） */
function buildAddParams(
  cfg: ZjmfModuleConfig,
  upProductId: number,
  upCycle: string,
  probed: ProbedProductConfig,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, string | number | boolean | undefined> = {
    pid: upProductId,
    billingcycle: upCycle,
    qty: 1,
    host: randHostName(),
    password: randPassword(),
  };
  if (probed.currencyId !== undefined) params.currencyid = probed.currencyId;
  for (const [oid, val] of Object.entries({ ...probed.configOption, ...cfg.upConfigOption })) {
    params[`configoption[${oid}]`] = val;
  }
  return params;
}

/** add_to_shop 未返回位置时，从购物车数据按 pid（+周期）定位刚添加项（PHP 版 cartPosition） */
async function locateCartPosition(
  client: ZjmfClient,
  upProductId: number,
  upCycle: string,
): Promise<number> {
  try {
    const res = await client.get("cart/get_shop_data");
    if (!isZjmfOk(res)) return -1;
    const items = asRec(res.data).cart_products;
    if (!Array.isArray(items)) return -1;
    let lastPid = -1;
    let lastMatch = -1;
    for (let i = 0; i < items.length; i++) {
      const p = asRec(items[i]);
      const pid = String(p.productid ?? p.pid ?? p.id ?? "");
      if (pid !== String(upProductId)) continue;
      lastPid = i;
      const cycle = String(p.billingcycle ?? "").toLowerCase();
      if (cycle === upCycle.toLowerCase() || cycle === "") lastMatch = i;
    }
    return lastMatch >= 0 ? lastMatch : lastPid;
  } catch {
    return -1;
  }
}

/** 解析模块配置 + 供应商互斥锁 ID */
async function prepared(ctx: ModuleCtx, service: ServiceRow): Promise<{
  cfg: ZjmfModuleConfig;
  lockId: string;
  client: ZjmfClient;
}> {
  const cfg = await resolveZjmfConfig(ctx.db, await resolveModuleConfig(ctx.db, service));
  const lockId = cfg.supplierCode ?? `${cfg.supplier.baseUrl}|${cfg.supplier.username}`;
  return { cfg, lockId, client: new ZjmfClient(cfg.supplier) };
}

/** 本地周期 → 上游 billingcycle（onetime 需显式映射） */
function upCycleFor(cfg: ZjmfModuleConfig, cycle: string, available?: Iterable<string>): string {
  if (cycle === "onetime") {
    const mapped = cfg.upCycles["onetime"];
    if (!mapped) {
      throw new ZjmfApiError("一次性周期服务需在 moduleConfig.upCycles 配置 onetime → 上游周期映射");
    }
    return mapped;
  }
  return resolveUpCycle(cfg.upCycles, cycle as RenewableCycle, available);
}

/**
 * 开通编排（在供应商锁内调用）：
 * 已有 upHostId → 幂等重放；已有 upInvoiceId → 先对账（避免重复购买）；否则全新购买。
 */
async function doProvision(
  ctx: ModuleCtx,
  service: ServiceRow,
  cfg: ZjmfModuleConfig,
  client: ZjmfClient,
): Promise<ModuleResult> {
  const ref = readUpRef(service);

  // 幂等重放：上游主机已存在，仅刷新交付信息
  if (ref.upHostId > 0) {
    const header = await fetchHostHeader(client, ref.upHostId);
    return {
      ok: true,
      message: "上游主机已存在（幂等重放），已刷新交付信息",
      deliverInfo: {
        upHostId: ref.upHostId,
        upProductId: cfg.upProductId,
        ...(header.username ? { upUsername: header.username } : {}),
        ...(header.password ? { upPassword: header.password } : {}),
        ...(header.expireAt ? { upExpireAt: header.expireAt } : {}),
      },
    };
  }

  const upCycle = upCycleFor(cfg, service.cycle);
  let upInvoiceId = ref.upInvoiceId;

  // 对账路径：上次运行已结算但未走完——不重新购买，接着查支付与主机
  if (upInvoiceId > 0) {
    const check = await invoicePaidAndHost(client, upInvoiceId, 1);
    if (!check.found) {
      // 账单不存在/已作废：清掉引用走全新购买
      upInvoiceId = 0;
      await persistDeliverInfo(ctx, service, { upInvoiceId: 0 });
    } else if (check.paid || check.hostId > 0) {
      return finishProvision(ctx, service, cfg, client, upInvoiceId, check.hostId, upCycle);
    } else {
      // 已结算未支付（多为代理账户余额不足）：补一次余额抵扣，仍失败则保留引用等待重试
      const credit = await client.post("apply_credit", { invoiceid: upInvoiceId, use_credit: 1, enough: 1 });
      if (isZjmfOk(credit)) {
        const again = await invoicePaidAndHost(client, upInvoiceId, 1);
        if (again.found && (again.paid || again.hostId > 0)) {
          return finishProvision(ctx, service, cfg, client, upInvoiceId, again.hostId, upCycle);
        }
      }
      return {
        ok: false,
        message: `上游账单 #${upInvoiceId} 已结算但未完成支付（代理账户余额不足？），充值后重试即可续走，不会重复购买`,
        raw: { upInvoiceId },
      };
    }
  }

  // 全新购买：清空购物车（settle 会结算整辆购物车，残留项会一起开通）
  try {
    await client.post("cart/clear");
  } catch {
    // 购物车本就为空时允许失败
  }

  // 探测商品配置（周期键/货币/配置项默认值），与显式 upCycles/upConfigOption 合并
  const probed = await probeProductConfig(client, cfg.upProductId);
  // 上游周期键解析：onetime 无别名匹配（upCycleFor 已显式处理）；其余周期优先探测到的真实键
  const resolveUp = (available?: string[]): string =>
    service.cycle === "onetime" ? upCycle : resolveUpCycle(cfg.upCycles, service.cycle as RenewableCycle, available);

  let addCycleKey = resolveUp(probed.cycleKeys);

  let added = await client.post("cart/add_to_shop", buildAddParams(cfg, cfg.upProductId, addCycleKey, probed));
  if (!isZjmfOk(added)) {
    // 常见失败："此周期未配置价格"——上游周期键与预期不符，探测真实键后重试一次
    if (isCyclePriceError(added.msg ?? "") && probed.cycleKeys.length > 0) {
      const matched = resolveUp(probed.cycleKeys);
      if (matched !== addCycleKey) {
        addCycleKey = matched;
        added = await client.post("cart/add_to_shop", buildAddParams(cfg, cfg.upProductId, addCycleKey, probed));
      }
    }
    if (!isZjmfOk(added)) {
      return { ok: false, message: `上游添加购物车失败（周期 ${addCycleKey}）：${added.msg ?? "未知错误"}`, raw: redactZjmf(added) as Rec };
    }
  }

  // 定位购物车位置（部分版本 add_to_shop 不返回位置 i）
  let position = parsePosition(added);
  if (position < 0) position = await locateCartPosition(client, cfg.upProductId, addCycleKey);
  if (position < 0) {
    return { ok: false, message: "上游加购成功但无法定位购物车位置，请联调适配（响应见 raw）", raw: redactZjmf(added) as Rec };
  }

  // 结算（checkout=1 直接结算）→ 上游账单 ID；立即落库供重试对账
  const settled = await client.post("cart/settle", { "pos[]": position, checkout: 1 });
  if (!isZjmfOk(settled)) {
    return { ok: false, message: `上游结算失败：${settled.msg ?? "未知错误"}`, raw: redactZjmf(settled) as Rec };
  }
  const invoiceId = findId(settled.data);
  const immediateHostId = findHostId(settled.data);
  if (invoiceId > 0) {
    await persistDeliverInfo(ctx, service, { upInvoiceId: invoiceId, upProductId: cfg.upProductId, upCycle: addCycleKey });
  }

  // 余额抵扣上游账单（代理账户余额不足时在此报错）
  if (invoiceId > 0 && immediateHostId <= 0) {
    const credit = await client.post("apply_credit", { invoiceid: invoiceId, use_credit: 1, enough: 1 });
    if (!isZjmfOk(credit)) {
      const { paid, hostId } = await invoicePaidAndHost(client, invoiceId, 1);
      if (!paid && hostId <= 0) {
        return {
          ok: false,
          message: `上游余额支付失败（请检查代理账户余额）：${credit.msg ?? "未知错误"}`,
          raw: redactZjmf(credit) as Rec,
        };
      }
    }
  }

  // 轮询主机 ID（主机创建可能异步）；未就绪 → 失败重试（重试走对账路径，不会重复购买）
  return finishProvision(ctx, service, cfg, client, invoiceId, immediateHostId, addCycleKey);
}

/** 主机 ID 就绪后收尾：轮询账单 → 查交付信息 → 成功结果 */
async function finishProvision(
  ctx: ModuleCtx,
  service: ServiceRow,
  cfg: ZjmfModuleConfig,
  client: ZjmfClient,
  invoiceId: number,
  knownHostId: number,
  upCycle: string,
): Promise<ModuleResult> {
  let hostId = knownHostId;
  if (hostId <= 0 && invoiceId > 0) {
    const { hostId: polled } = await invoicePaidAndHost(client, invoiceId, cfg.pollTimes);
    hostId = polled;
  }
  if (hostId <= 0) {
    if (invoiceId > 0) {
      return {
        ok: false,
        message: `上游订单已创建并支付（invoice #${invoiceId}），但主机未就绪；任务将重试对账，不会重复购买`,
      };
    }
    return { ok: false, message: "上游未返回账单与主机 ID，请联调适配（cart/settle 响应结构差异）" };
  }

  await persistDeliverInfo(ctx, service, { upHostId: hostId });
  const header = await fetchHostHeader(client, hostId);
  return {
    ok: true,
    message: "上游开通成功",
    deliverInfo: {
      upHostId: hostId,
      ...(invoiceId > 0 ? { upInvoiceId: invoiceId } : {}),
      upProductId: cfg.upProductId,
      upCycle,
      ...(header.name ? { upProductName: header.name } : {}),
      ...(header.username ? { upUsername: header.username } : {}),
      ...(header.password ? { upPassword: header.password } : {}),
      ...(header.expireAt ? { upExpireAt: header.expireAt } : {}),
    },
  };
}

/** 从加购响应取购物车位置 data.i（兼容字符串 data/嵌套，PHP 版 findPosition） */
function parsePosition(res: ZjmfResponse): number {
  const d = res.data;
  if (d == null) return -1;
  if (typeof d === "number" && Number.isInteger(d)) return d;
  const rec = asRec(d);
  for (const k of ["i", "position", "pos", "cart_i", "key"]) {
    const v = rec[k];
    const n = Array.isArray(v) ? Number(v[0]) : Number(v);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return -1;
}

// ============ 模块定义 ============

export const zjmfModule: ProvisionModule = {
  code: "zjmf",
  name: "魔方财务（代理商对接）",
  description:
    "以代理商账号对接魔方财务（ZJMF）上游：支付成功后经购物车流程直通开通，续费经 host/renew 同步上游，" +
    "欠费暂停以断电实现（会员级 API 无暂停端点）。供应商凭据可内联 moduleConfig 或引用设置表（密钥加密）。",
  supportedActions: [...STANDARD_MODULE_ACTIONS, "renew"],

  async testConnection(config): Promise<TestConnectionResult> {
    if (!config || typeof config !== "object" || !((config as Rec).supplier)) {
      return {
        ok: false,
        message:
          "连接测试需要内联 supplier 配置（baseUrl/username/password）；supplierCode 引用方式请在保存后由供应任务实际验证",
      };
    }
    try {
      const supplier = parseInlineSupplier((config as Rec).supplier);
      const client = new ZjmfClient(supplier);
      const result = await client.testConnection();
      return {
        ok: result.ok,
        message: result.ok
          ? `连接成功（上游商品 ${result.productCount ?? 0} 个）`
          : result.message ?? "连接失败",
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async provision(ctx, service): Promise<ModuleResult> {
    const { cfg, lockId, client } = await prepared(ctx, service);
    return withSupplierLock(lockId, () => doProvision(ctx, service, cfg, client));
  },

  /** 续费同步：本地续费结算后由 renew 任务调用（核心只推本地到期日，上游到期日靠这里对齐） */
  async renew(ctx, service): Promise<ModuleResult> {
    const { cfg, lockId, client } = await prepared(ctx, service);
    return withSupplierLock(lockId, async () => {
      const upHostId = requireUpHostId(service);
      const upCycle = upCycleFor(cfg, service.cycle);

      // 续费前试算（尽力而为，仅记录上游续费价供成本核对）
      let quoteCents: number | null = null;
      try {
        const page = await client.get("host/renewpage", { hostid: upHostId });
        if (isZjmfOk(page)) quoteCents = parseUpPriceCents(page.data);
      } catch {
        // 试算失败不阻断续费
      }

      const renewed = await client.post("host/renew", { hostid: upHostId, billingcycles: upCycle });
      if (!isZjmfOk(renewed)) {
        // 部分版本续费生成待付账单：带出 invoiceid 时补一次余额抵扣
        const invoiceId = findId(renewed.data);
        if (invoiceId > 0) {
          const credit = await client.post("apply_credit", { invoiceid: invoiceId, use_credit: 1, enough: 1 });
          if (isZjmfOk(credit)) {
            return finishRenew(ctx, client, upHostId, upCycle, quoteCents);
          }
        }
        return {
          ok: false,
          message: `上游续费失败（代理账户余额不足或上游拒绝）：${renewed.msg ?? "未知错误"}`,
          raw: redactZjmf(renewed) as Rec,
        };
      }
      return finishRenew(ctx, client, upHostId, upCycle, quoteCents);
    });
  },

  /** 欠费管控：会员级 API 无暂停端点，断电实现（result.message 明示语义） */
  async suspend(ctx, service): Promise<ModuleResult> {
    const { lockId, client } = await prepared(ctx, service);
    return withSupplierLock(lockId, async () => {
      const upHostId = requireUpHostId(service);
      const res = await client.post("provision/default", { id: upHostId, func: "off", is_api: 1 });
      if (!isZjmfOk(res)) {
        return { ok: false, message: `上游断电失败：${res.msg ?? "未知错误"}`, raw: redactZjmf(res) as Rec };
      }
      return { ok: true, message: "上游已断电（会员级 API 无暂停端点，欠费管控采用断电；上游账单到期规则不受影响）" };
    });
  },

  async unsuspend(ctx, service): Promise<ModuleResult> {
    const { lockId, client } = await prepared(ctx, service);
    return withSupplierLock(lockId, async () => {
      const upHostId = requireUpHostId(service);
      const res = await client.post("provision/default", { id: upHostId, func: "on", is_api: 1 });
      if (!isZjmfOk(res)) {
        return { ok: false, message: `上游开机失败：${res.msg ?? "未知错误"}`, raw: redactZjmf(res) as Rec };
      }
      return { ok: true, message: "上游已开机（续费/补缴恢复）" };
    });
  },

  /** 终止：提交上游取消请求（Immediate），上游处理前主机仍存在（状态由 sync/人工核对） */
  async terminate(ctx, service): Promise<ModuleResult> {
    const { lockId, client } = await prepared(ctx, service);
    return withSupplierLock(lockId, async () => {
      const upHostId = requireUpHostId(service);
      const res = await client.post("host/cancel", {
        id: upHostId,
        type: "Immediate",
        reason: `服务 #${service.id} 已终止（QmKvm）`,
      });
      if (!isZjmfOk(res)) {
        return { ok: false, message: `上游取消请求提交失败：${res.msg ?? "未知错误"}`, raw: redactZjmf(res) as Rec };
      }
      return { ok: true, message: "已提交上游取消请求（Immediate），上游处理完成前主机仍存在，请人工或经状态同步确认释放" };
    });
  },

  /** 升降级：目标商品须为 zjmf 模块且同一供应商；上游差价从代理账户余额扣除 */
  async changePackage(ctx, service, target): Promise<ModuleResult> {
    const { cfg, lockId, client } = await prepared(ctx, service);
    return withSupplierLock(lockId, async () => {
      const upHostId = requireUpHostId(service);

      const productRows = await ctx.db
        .select({ moduleCode: products.moduleCode, moduleConfig: products.moduleConfig })
        .from(products)
        .where(eq(products.id, target.productId))
        .limit(1);
      const product = productRows[0];
      if (!product || product.moduleCode !== "zjmf") {
        return { ok: false, message: `目标商品 #${target.productId} 不是 zjmf 模块，无法提交上游升降级` };
      }
      const targetCfg = await resolveZjmfConfig(ctx.db, (product.moduleConfig ?? {}) as Record<string, unknown>);
      const sameSupplier =
        (cfg.supplierCode !== undefined && cfg.supplierCode === targetCfg.supplierCode) ||
        (cfg.supplierCode === undefined &&
          targetCfg.supplierCode === undefined &&
          cfg.supplier.baseUrl === targetCfg.supplier.baseUrl &&
          cfg.supplier.username === targetCfg.supplier.username);
      if (!sameSupplier) {
        return { ok: false, message: "目标商品与当前服务不属于同一魔方上游，跨上游升降级需人工处理" };
      }

      const upCycle = upCycleFor(targetCfg, target.cycle);
      const submitted = await client.post("upgrade/upgrade_product_post", {
        hid: upHostId,
        newpid: targetCfg.upProductId,
        billingcycle: upCycle,
      });
      if (!isZjmfOk(submitted)) {
        return { ok: false, message: `上游升降级提交失败：${submitted.msg ?? "未知错误"}`, raw: redactZjmf(submitted) as Rec };
      }
      const upDiffCents = parseUpPriceCents(submitted.data);
      await persistDeliverInfo(ctx, service, { upProductId: targetCfg.upProductId, upCycle });
      return {
        ok: true,
        message:
          "上游升降级提交成功" +
          (upDiffCents != null ? `，上游差价 ¥${centsToYuan(upDiffCents)}（已从代理账户余额扣除，请核对本地毛利）` : ""),
        deliverInfo: { upProductId: targetCfg.upProductId, upCycle },
        raw: redactZjmf(submitted) as Rec,
      };
    });
  },
};

/** 续费收尾：回写上游新到期日 */
async function finishRenew(
  ctx: ModuleCtx,
  client: ZjmfClient,
  upHostId: number,
  upCycle: string,
  quoteCents: number | null,
): Promise<ModuleResult> {
  const header = await fetchHostHeader(client, upHostId);
  const expireText = header.expireAt ? `，上游新到期日 ${header.expireAt}` : "";
  const quoteText = quoteCents != null ? `，上游续费价 ¥${centsToYuan(quoteCents)}` : "";
  return {
    ok: true,
    message: `上游续费成功（周期 ${upCycle}）${expireText}${quoteText}`,
    deliverInfo: {
      ...(header.expireAt ? { upExpireAt: header.expireAt } : {}),
      ...(header.username ? { upUsername: header.username } : {}),
      ...(header.password ? { upPassword: header.password } : {}),
    },
    raw: { upHostId, upCycle, quoteCents: quoteCents ?? null },
  };
}
