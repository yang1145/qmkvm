import { z } from "zod";
import { errorResponseSchema } from "@qmkvm/contracts";

/** 后端 API 基准地址（同源反向代理或独立域名均可） */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const API_PREFIX = "/api/v1";

/** 统一业务错误：携带契约错误码与 requestId，方便排查 */
export class ApiError extends Error {
  code: string;
  status: number;
  requestId: string;

  constructor(
    message: string,
    options: { code: string; status: number; requestId: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions<T = unknown> {
  /** 追加到 URL 的查询参数（自动跳过 null/undefined/""） */
  query?: Record<string, QueryValue>;
  /** 成功响应的 zod 校验 schema（契约 DTO），泛型 T 由 schema 推断 */
  parse?: z.ZodType<T>;
  /** 静默模式：不弹错误 Toast（用于轮询/后台刷新） */
  silent?: boolean;
  /** 覆盖 AbortSignal */
  signal?: AbortSignal;
}

/** 全局错误 Toast 钩子（由 ToastProvider 注册，避免 api 层依赖 React） */
let errorHandler: ((message: string) => void) | null = null;

export function setApiErrorHandler(fn: (message: string) => void) {
  errorHandler = fn;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(API_BASE_URL + API_PREFIX + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
  options: RequestOptions<T> = {},
): Promise<T> {
  const { query, parse, silent, signal } = options;

  const isFormData = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      credentials: "include",
      headers:
        body !== undefined && !isFormData
          ? { "Content-Type": "application/json" }
          : undefined,
      body: body !== undefined ? (isFormData ? body : JSON.stringify(body)) : undefined,
      signal,
      cache: "no-store",
    });
  } catch {
    if (!silent) errorHandler?.("网络连接失败，请检查网络后重试");
    throw new ApiError("网络连接失败，请检查网络后重试", {
      code: "NETWORK_ERROR",
      status: 0,
      requestId: "",
    });
  }

  if (!res.ok) {
    let code = "INTERNAL";
    let message = `请求失败（HTTP ${res.status}）`;
    let requestId = "";
    try {
      const data = errorResponseSchema.parse(await res.json());
      code = data.code;
      message = data.message;
      requestId = data.requestId;
    } catch {
      // 错误体不符合契约（网关错误/404 HTML 等），保留 HTTP 兜底文案
    }
    if (!silent) errorHandler?.(message);
    // 会话失效：广播给 AuthProvider 清空登录态
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("kvm:unauthorized"));
    }
    throw new ApiError(message, { code, status: res.status, requestId });
  }

  if (res.status === 204) return undefined as T;

  const json: unknown = await res.json().catch(() => undefined);
  if (parse) {
    try {
      return parse.parse(json) as T;
    } catch {
      if (!silent) errorHandler?.("响应数据格式异常，请稍后重试");
      throw new ApiError("响应数据格式异常", {
        code: "VALIDATION_FAILED",
        status: res.status,
        requestId: "",
      });
    }
  }
  return json as T;
}

export const api = {
  get<T>(path: string, options?: RequestOptions<T>): Promise<T> {
    return request<T>(path, "GET", undefined, options);
  },
  post<T>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T> {
    return request<T>(path, "POST", body, options);
  },
  patch<T>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T> {
    return request<T>(path, "PATCH", body, options);
  },
  put<T>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T> {
    return request<T>(path, "PUT", body, options);
  },
  del<T>(path: string, options?: RequestOptions<T>): Promise<T> {
    return request<T>(path, "DELETE", undefined, options);
  },
};
