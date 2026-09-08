/**
 * 魔方财务（ZJMF / cube_finance）上游 API 客户端。
 *
 * 认证：POST {base}/zjmf_api_login（username/password）→ JWT → `Authorization: Bearer {jwt}`；
 * 业务响应 status=401/405 时强制重登并重试一次（对照 PHP 版 CubeFinanceClient）。
 *
 * 与 PHP 版的安全差异（移植时修正，勿回退）：
 * - TLS 默认严格校验证书（PHP 版 CURLOPT_SSL_VERIFYPEER=false 硬编码），仅允许
 *   allowSelfSigned 显式关闭（undici Agent connect.rejectUnauthorized，同 pve 模块惯例）；
 * - JWT 仅进程内存缓存（按 baseUrl|username 隔离），不落盘（PHP 版写 runtime/cache 文件）；
 * - raw 响应写日志/任务结果前必须过 redactZjmf（剔除 jwt/password/authorization 等字段）。
 */
import { Agent, fetch as undiciFetch } from "undici";

/** 单次请求超时（php 版默认 30s；只读探测可传短超时） */
const DEFAULT_TIMEOUT_MS = 30_000;
/** JWT 内存缓存有效期：与 v10 上游一致 2h，提前 5 分钟刷新 */
const JWT_TTL_MS = 115 * 60_000;

/** 上游业务响应通用形状：{status, msg, data}；status 200 常规成功 / 1001 购买或支付已完成。
 *  flat 保留响应根层全部字段（登录响应的 jwt 平铺在根层而非 data 内）。 */
export interface ZjmfResponse<T = Record<string, unknown>> {
  status: number;
  msg?: string;
  data?: T;
  flat?: T;
}

/** 供应商连接配置（moduleConfig.supplier 内联，或设置表按 supplierCode 解析后的结果） */
export interface ZjmfSupplierConfig {
  /** 上游站点根地址，如 https://upstream.example.com */
  baseUrl: string;
  /** API 账号（代理商客户用户名） */
  username: string;
  /** API 密码（客户 API 密码） */
  password: string;
  /** 请求超时秒数，默认 30 */
  apiTimeoutSec?: number;
  /** 自签证书时忽略 TLS 校验（默认 false，生产建议保持 false 并配受信证书） */
  allowSelfSigned?: boolean;
}

/** JWT 进程内存缓存：按 baseUrl|username 隔离，支持多上游并存（同 pve ticketCache 惯例） */
const jwtCache = new Map<string, { jwt: string; expiresAt: number }>();

export class ZjmfApiError extends Error {
  /** 上游业务 status（非 HTTP 状态码）；网络/HTTP 层错误为 undefined */
  readonly upStatus?: number;
  /** 脱敏后的上游响应（写入任务结果用） */
  readonly response?: Record<string, unknown>;

  constructor(message: string, upStatus?: number, response?: Record<string, unknown>) {
    super(message);
    this.name = "ZjmfApiError";
    this.upStatus = upStatus;
    this.response = response;
  }
}

export function isZjmfOk(res: ZjmfResponse): boolean {
  return res.status === 200 || res.status === 1001;
}

/**
 * 深度脱敏：将 jwt/password/authorization/secret/cookie 类字段替换为 "***"。
 * 上游 host/header、登录响应均含明文凭据，任何落库/日志前必须调用。
 */
export function redactZjmf(value: unknown, depth = 0): unknown {
  const SENSITIVE = /^(jwt|password|passwd|pwd|authorization|auth|secret|cookie)$/i;
  if (depth > 4 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactZjmf(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) && typeof v === "string" ? "***" : redactZjmf(v, depth + 1);
  }
  return out;
}

export class ZjmfClient {
  readonly supplier: ZjmfSupplierConfig;
  private readonly agent: Agent;
  private readonly cacheKey: string;

  constructor(supplier: ZjmfSupplierConfig) {
    this.supplier = { ...supplier, baseUrl: supplier.baseUrl.replace(/\/+$/, "") };
    this.agent = new Agent({
      connect: { rejectUnauthorized: supplier.allowSelfSigned !== true },
    });
    this.cacheKey = `${this.supplier.baseUrl}|${this.supplier.username}`;
  }

  /** 当前 JWT（内存缓存命中则免登录） */
  private cachedJwt(): string | null {
    const cached = jwtCache.get(this.cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.jwt;
    jwtCache.delete(this.cacheKey);
    return null;
  }

  /** 登录获取 JWT（写缓存）；force 强制重登。
   *  注意：上游登录响应是平铺结构 {jwt, status, msg}（jwt 与 status 同级，不在 data 里）。 */
  async login(force = false): Promise<string> {
    if (!force) {
      const cached = this.cachedJwt();
      if (cached) return cached;
    }
    if (!this.supplier.username || !this.supplier.password) {
      throw new ZjmfApiError("魔方上游缺少 username/password，无法登录");
    }
    const res = await this.raw<{ jwt?: string; status?: number; msg?: string }>(
      "POST",
      "zjmf_api_login",
      { username: this.supplier.username, password: this.supplier.password },
      { skipAuth: true },
    );
    const raw = res.flat ?? (res.data as { jwt?: string } | undefined);
    const jwt = (raw as { jwt?: string } | undefined)?.jwt;
    if (res.status !== 200 || !jwt) {
      throw new ZjmfApiError(`魔方上游登录失败：${res.msg ?? "未知错误"}`, res.status);
    }
    jwtCache.set(this.cacheKey, { jwt, expiresAt: Date.now() + JWT_TTL_MS });
    return jwt;
  }

  /**
   * 业务请求：自动附带 Bearer；响应 status=401/405 时强制重登重试一次。
   * 返回脱敏前的完整业务响应（调用方落库/记日志前自行 redactZjmf）。
   */
  async request<T = Record<string, unknown>>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
    opts: { timeoutMs?: number; retriedAuth?: boolean } = {},
  ): Promise<ZjmfResponse<T>> {
    await this.login();
    const res = await this.raw<T>(method, path, params, {}, opts.timeoutMs);
    if ((res.status === 401 || res.status === 405) && !opts.retriedAuth) {
      await this.login(true);
      return this.raw<T>(method, path, params, {}, opts.timeoutMs);
    }
    return res;
  }

  async get<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    timeoutMs?: number,
  ): Promise<ZjmfResponse<T>> {
    return this.request<T>("GET", path, params, { timeoutMs });
  }

  async post<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    timeoutMs?: number,
  ): Promise<ZjmfResponse<T>> {
    return this.request<T>("POST", path, params, { timeoutMs });
  }

  /** 连通性测试：强制重登 + 拉商品列表（admin 连接测试与商品同步共用） */
  async testConnection(): Promise<{ ok: boolean; message?: string; productCount?: number }> {
    try {
      await this.login(true);
      const list = await this.get<{ list?: unknown[]; currency_code?: string }>("api/product/list");
      if (list.status !== 200) {
        return { ok: false, message: `上游返回异常：${list.msg ?? `status=${list.status}`}` };
      }
      return { ok: true, productCount: Array.isArray(list.data?.list) ? list.data.list.length : 0 };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 底层 HTTP：GET 走查询串，POST 走表单体（上游为 form 解析，非 JSON body）。
   * HTTP 非 2xx 或响应非 JSON 抛 ZjmfApiError（错误信息截断，不整包落日志）。
   */
  private async raw<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    opts: { skipAuth?: boolean },
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<ZjmfResponse<T>> {
    const url = new URL(`${this.supplier.baseUrl}/${path.replace(/^\/+/, "")}`);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "QmKvm-ZJMF/1.0",
    };
    let body: string | undefined;
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) form.set(k, String(v));
      }
      body = form.toString();
    } else {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    if (!opts.skipAuth) {
      headers.Authorization = `Bearer ${await this.login()}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs) * 1000);
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    let text: string;
    try {
      response = await undiciFetch(url, {
        method,
        headers,
        body,
        dispatcher: this.agent,
        signal: controller.signal,
      });
      text = await response.text().catch(() => "");
    } catch (err) {
      const message = controller.signal.aborted
        ? `魔方上游请求超时（${timeoutMs}s）：${method} ${path}`
        : `魔方上游请求失败：${method} ${path}：${err instanceof Error ? err.message : String(err)}`;
      throw new ZjmfApiError(message);
    } finally {
      clearTimeout(timer);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ZjmfApiError(
        `魔方上游 HTTP ${response.status}：${method} ${path}：${text.slice(0, 200)}`,
        response.status,
      );
    }
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new ZjmfApiError(`魔方上游响应非 JSON：${method} ${path}：${text.slice(0, 200)}`);
    }
    const rec = (json ?? {}) as Record<string, unknown>;
    return {
      status: typeof rec.status === "number" ? rec.status : 0,
      msg: typeof rec.msg === "string" ? rec.msg : undefined,
      data: rec.data as T | undefined,
      // 部分上游（如登录响应）把业务字段平铺在响应根层（jwt 与 status 同级）
      flat: rec as unknown as T,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep };
