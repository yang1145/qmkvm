/**
 * 通用 HTTP API 供应模块（http-api）：把开通/暂停/恢复/终止/变更套餐映射为对
 * 外部系统 HTTP 接口的调用，全部由模块配置驱动。
 *
 * 配置结构（service.moduleConfig 与商品 moduleConfig 合并，service 优先）：
 * {
 *   "baseUrl": "https://api.example.com",
 *   "apiKey": "可选，存在时携带 Authorization: Bearer <apiKey>",
 *   "hmacSecret": "可选，存在时携带 X-Sign / X-Timestamp 请求头",
 *   "timeoutMs": 120000,
 *   "actions": {
 *     "provision":      { "method": "POST", "path": "/servers", "bodyTemplate": "{...}" },
 *     "suspend":        { ... }, "unsuspend": { ... }, "terminate": { ... },
 *     "change_package": { ... }   // 亦接受 "changePackage"
 *   }
 * }
 *
 * bodyTemplate / path 支持 {{service.id}}、{{service.config.xxx}}、{{config.xxx}}、
 * {{target.xxx}}（change_package）占位；对象值序列化为 JSON，缺失替换为空串。
 *
 * 成功判定：HTTP 2xx 且响应 JSON 的 ok !== false（SPEC §2.5）。
 * X-Sign = hex(hmac-sha256(secret, method + path + body))；X-Timestamp = Unix 秒。
 * 超时经 AbortController 实现，默认 120s（timeoutMs 可覆盖）。
 */
import { createHmac } from "node:crypto";
import type { ServiceRow } from "@pinhaoji/core";
import { STANDARD_MODULE_ACTIONS } from "../types.js";
import type {
  ChangePackageTarget,
  ModuleCtx,
  ModuleConfig,
  ModuleResult,
  ProvisionModule,
  TestConnectionResult,
} from "../types.js";
import { resolveModuleConfig } from "../config.js";

const DEFAULT_TIMEOUT_MS = 120_000;

interface HttpActionConfig {
  method?: string;
  path: string;
  bodyTemplate?: string;
}

interface HttpApiConfig {
  baseUrl: string;
  apiKey?: string;
  hmacSecret?: string;
  timeoutMs?: number;
  actions?: Record<string, HttpActionConfig>;
}

/** 解析并校验模块配置 */
function parseConfig(config: ModuleConfig): HttpApiConfig {
  const cfg = config as unknown as HttpApiConfig;
  if (!cfg.baseUrl || typeof cfg.baseUrl !== "string") {
    throw new Error("http-api 模块缺少 baseUrl 配置");
  }
  if (!cfg.actions || typeof cfg.actions !== "object") {
    throw new Error("http-api 模块缺少 actions 配置");
  }
  return cfg;
}

/** 占位符渲染：{{a.b.c}} 按 context 逐级取值；缺失替换为 ""（记 debug 日志） */
export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
  logger?: ModuleCtx["logger"],
): string {
  return template.replace(/\{\{\s*([\w$][\w$.]*)\s*\}\}/g, (_match, path: string) => {
    const value = lookupPath(context, path);
    if (value === undefined || value === null) {
      logger?.debug({ path }, "模板占位符取值为空，已替换为空串");
      return "";
    }
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  });
}

/** 按 "a.b.c" 点分路径取嵌套值 */
function lookupPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** 拼接 URL：path 为完整 URL 时直接使用，否则与 baseUrl 拼接 */
function buildUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** 单动作 HTTP 调用 */
async function callAction(
  ctx: ModuleCtx,
  config: HttpApiConfig,
  actionKey: string,
  service: ServiceRow,
  target?: ChangePackageTarget,
): Promise<ModuleResult> {
  const actionCfg = config.actions?.[actionKey];
  if (!actionCfg || typeof actionCfg.path !== "string") {
    return { ok: false, message: `http-api 模块未配置动作「${actionKey}」` };
  }

  const method = (actionCfg.method ?? "POST").toUpperCase();
  // 模板上下文：service（含 config 快照）、config（模块配置）、target（变更套餐目标）
  const context: Record<string, unknown> = {
    service: service as unknown as Record<string, unknown>,
    config: config as unknown as Record<string, unknown>,
    ...(target ? { target } : {}),
  };
  const path = renderTemplate(actionCfg.path, context, ctx.logger);
  const body = renderTemplate(
    actionCfg.bodyTemplate ?? JSON.stringify({ action: actionKey, serviceId: service.id }),
    context,
    ctx.logger,
  );
  const url = buildUrl(config.baseUrl, path);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  if (config.hmacSecret) {
    headers["X-Sign"] = createHmac("sha256", config.hmacSecret)
      .update(`${method}${path}${body}`)
      .digest("hex");
    headers["X-Timestamp"] = String(Math.floor(Date.now() / 1000));
  }

  const timeoutMs =
    typeof config.timeoutMs === "number" && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    ctx.logger.info({ action: actionKey, method, url }, "http-api 模块发起请求");
    response = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: controller.signal,
    });
  } catch (err) {
    const message = controller.signal.aborted
      ? `http-api 请求超时（${timeoutMs}ms）：${url}`
      : `http-api 请求失败：${err instanceof Error ? err.message : String(err)}`;
    ctx.logger.warn({ action: actionKey, url, err }, message);
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return {
      ok: false,
      message: `http-api 响应非 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`,
    };
  }

  const json = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  if (!response.ok) {
    return {
      ok: false,
      message: String(json.message ?? `http-api 响应 HTTP ${response.status}`),
      raw: json,
    };
  }
  // SPEC：2xx 且 JSON ok !== false 即成功
  if (json.ok === false) {
    return { ok: false, message: String(json.message ?? "远端返回 ok=false"), raw: json };
  }

  const deliverInfo =
    json.deliverInfo && typeof json.deliverInfo === "object"
      ? (json.deliverInfo as Record<string, unknown>)
      : undefined;
  return {
    ok: true,
    message:
      typeof json.message === "string" ? json.message : `http-api 动作成功（HTTP ${response.status}）`,
    ...(deliverInfo ? { deliverInfo } : {}),
    raw: json,
  };
}

/** change_package 动作键兼容两种写法（DB 枚举 change_package / 方法名 changePackage） */
function pickChangePackageKey(config: HttpApiConfig): string {
  return config.actions?.change_package ? "change_package" : "changePackage";
}

export const httpApiModule: ProvisionModule = {
  code: "http-api",
  name: "HTTP API 通用模块",
  description: "把供应动作映射为对外部系统 HTTP 接口的调用，动作由商品 moduleConfig.actions 驱动",
  supportedActions: [...STANDARD_MODULE_ACTIONS],

  async testConnection(config: ModuleConfig | null): Promise<TestConnectionResult> {
    let cfg: HttpApiConfig;
    try {
      cfg = parseConfig(config ?? {});
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(buildUrl(cfg.baseUrl, ""), {
        method: "GET",
        signal: controller.signal,
      });
      return { ok: true, message: `连接成功（HTTP ${response.status}）` };
    } catch (err) {
      return {
        ok: false,
        message: `连接失败：${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  },

  async provision(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult> {
    return callAction(ctx, parseConfig(await resolveModuleConfig(ctx.db, service)), "provision", service);
  },

  async suspend(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult> {
    return callAction(ctx, parseConfig(await resolveModuleConfig(ctx.db, service)), "suspend", service);
  },

  async unsuspend(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult> {
    return callAction(ctx, parseConfig(await resolveModuleConfig(ctx.db, service)), "unsuspend", service);
  },

  async terminate(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult> {
    return callAction(ctx, parseConfig(await resolveModuleConfig(ctx.db, service)), "terminate", service);
  },

  async changePackage(
    ctx: ModuleCtx,
    service: ServiceRow,
    target: ChangePackageTarget,
  ): Promise<ModuleResult> {
    const config = parseConfig(await resolveModuleConfig(ctx.db, service));
    return callAction(ctx, config, pickChangePackageKey(config), service, target);
  },
};
