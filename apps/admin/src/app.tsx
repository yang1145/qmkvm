import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { history } from '@umijs/max';
import React from 'react';

import { ErrorBoundary, Footer, HeaderAvatar } from '@/components';
import { getAdminMe } from '@/services/admin';
import type { AdminMe } from '@/services/types';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';

const loginPath = '/user/login';

/**
 * @see https://umijs.org/docs/api/runtime-config#getinitialstate
 */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: AdminMe;
  fetchUserInfo?: () => Promise<AdminMe | undefined>;
}> {
  const fetchUserInfo = async () => {
    try {
      const me = await getAdminMe();
      return me;
    } catch (_error) {
      const { pathname, search, hash } = history.location;
      if (!pathname.startsWith(loginPath)) {
        history.replace(`${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`);
      }
      return undefined;
    }
  };

  const { location } = history;
  if (!location.pathname.startsWith(loginPath)) {
    const currentUser = await fetchUserInfo();
    return {
      fetchUserInfo,
      currentUser,
      settings: defaultSettings as Partial<LayoutSettings>,
    };
  }
  return {
    fetchUserInfo,
    settings: defaultSettings as Partial<LayoutSettings>,
  };
}

// ProLayout 运行时配置 https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({ initialState }) => {
  return {
    waterMarkProps: {
      content: initialState?.currentUser?.admin?.username,
    },
    avatarProps: {
      title: initialState?.currentUser?.admin?.name || initialState?.currentUser?.admin?.username || '-',
      render: (_props, avatarChildren) => <HeaderAvatar>{avatarChildren}</HeaderAvatar>,
    },
    footerRender: () => <Footer />,
    onPageChange: () => {
      const { location } = history;
      // 未登录时重定向到登录页（getInitialState 已带 redirect）
      if (!initialState?.currentUser && location.pathname !== loginPath) {
        history.replace(
          `${loginPath}?redirect=${encodeURIComponent(location.pathname + location.search)}`,
        );
      }
    },
    menuHeaderRender: undefined,
    unAccessible: (
      <div style={{ padding: 48, textAlign: 'center' }}>
        无权限访问该页面，请联系管理员分配权限。
      </div>
    ),
    ...initialState?.settings,
  };
};

/**
 * @name request 配置
 * 后端统一错误体 { code, message, requestId } 在 requestErrorConfig 中处理
 */
export const request: RequestConfig = {
  ...errorConfig,
};

export function rootContainer(container: React.ReactNode) {
  return <ErrorBoundary>{container}</ErrorBoundary>;
}