import type { RequestConfig } from '@umijs/max';
import { history } from '@umijs/max';
import { App } from 'antd';

/**
 * 统一错误体处理（契约 errorResponseSchema）：
 * { code, message, requestId, details? }
 * - AUTH_SESSION_EXPIRED / AUTH_REQUIRED → 跳转登录
 * - PERM_DENIED → 提示无权限
 * - VALIDATION_FAILED → details.issues 逐条提示
 * - 其余 → message.error(message)
 */

export const AUTH_CODES = ['AUTH_SESSION_EXPIRED', 'AUTH_REQUIRED'];

/** 从错误对象提取统一错误体（axios 错误挂在 response.data） */
export function extractErrorBody(error: any): {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
} | null {
  const data = error?.response?.data ?? error?.data;
  if (data && typeof data === 'object' && typeof data.code === 'string' && typeof data.message === 'string') {
    return data;
  }
  return null;
}

/** 展示错误（优先用 antd App 上下文 message；请求拦截器中可能无上下文，回退静态 message） */
export function showError(text: string) {
  try {
    // App.useApp 仅组件内可用；此处用静态实例兜底
    const antdApp = require('antd').App as { useApp?: () => any } | undefined;
    void antdApp;
  } catch {
    /* noop */
  }
  import('antd').then(({ message }) => {
    message.error(text);
  });
}

/** 处理统一错误体，返回是否已处理（跳登录等） */
export function handleApiError(error: any): boolean {
  const body = extractErrorBody(error);
  const code = body?.code;
  const msg = body?.message ?? error?.message ?? '请求失败';

  if (code && AUTH_CODES.includes(code)) {
    const { pathname, search } = window.location;
    if (!pathname.startsWith('/user/login')) {
      history.replace(`/user/login?redirect=${encodeURIComponent(pathname + search)}`);
    }
    return true;
  }
  if (code === 'PERM_DENIED') {
    showError('无权限执行该操作');
    return true;
  }
  if (code === 'VALIDATION_FAILED') {
    const issues = (body?.details as any)?.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      const lines = issues
        .map((i: any) => {
          if (typeof i === 'string') return i;
          // 后端已将 path 拼接为字符串（"body.slug"），兼容数组形态
          const path = Array.isArray(i.path) ? i.path.join('.') : String(i.path ?? '');
          return `${path || i.field || ''}: ${i.message ?? ''}`.replace(/^:\s*/, '');
        })
        .filter(Boolean);
      showError(lines.join('；'));
    } else {
      showError(msg);
    }
    return true;
  }
  showError(msg);
  return true;
}

export const errorConfig: RequestConfig = {
  errorConfig: {
    // 错误接收及处理：后端统一错误体（{code,message,requestId}）
    errorHandler: (error: any, opts: any) => {
      if (opts?.skipErrorHandler) throw error;
      handleApiError(error);
    },
  },
  // Cookie 会话：跨域直连（独立域名部署）时必须 withCredentials 才能携带会话 Cookie；
  // 同源模式下该选项无副作用
  requestInterceptors: [
    (config: any) => {
      config.withCredentials = true;
      config.headers = { ...(config.headers ?? {}) };
      return config;
    },
  ],
  responseInterceptors: [],
};

// 供非组件上下文使用的便捷提示
export function useAppMessage() {
  return App.useApp().message;
}