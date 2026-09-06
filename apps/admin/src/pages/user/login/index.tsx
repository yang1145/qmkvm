import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { LoginForm, ProFormText } from '@ant-design/pro-components';
import { history, Helmet, useModel } from '@umijs/max';
import { App } from 'antd';
import React, { startTransition, useState } from 'react';
import { Footer } from '@/components';
import { adminLogin } from '@/services/admin';
import Settings from '../../../../config/defaultSettings';

/** 防开放重定向：仅允许同源相对路径 */
const getSafeRedirectUrl = (redirect: string | null): string => {
  if (!redirect?.startsWith('/') || redirect.startsWith('//')) return '/';
  try {
    const parsed = new URL(redirect, window.location.origin);
    if (parsed.origin !== window.location.origin) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
};

const Login: React.FC = () => {
  const [submitting, setSubmitting] = useState(false);
  const { initialState, setInitialState } = useModel('@@initialState');
  const { message } = App.useApp();

  const handleSubmit = async (values: { username: string; password: string }) => {
    setSubmitting(true);
    try {
      await adminLogin({ username: values.username.trim(), password: values.password });
      message.success('登录成功');
      await initialState?.fetchUserInfo?.();
      startTransition(() => {
        setInitialState((s: any) => ({ ...s, currentUser: undefined }));
      });
      // 全量刷新以重建 initialState
      const urlParams = new URL(window.location.href).searchParams;
      window.location.href = getSafeRedirectUrl(urlParams.get('redirect'));
      return;
    } catch (_e) {
      // 错误提示由统一 errorHandler 处理
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'auto',
        background: '#f0f2f5',
      }}
    >
      <Helmet>
        <title>登录 - {Settings.title}</title>
      </Helmet>
      <div style={{ flex: 1, padding: '32px 0' }}>
        <LoginForm
          contentStyle={{ minWidth: 280, maxWidth: '75vw' }}
          logo={<img alt="logo" src="/logo.svg" />}
          title="拼好机管理后台"
          subTitle="云业务系统运营管理"
          initialValues={{ autoLogin: true }}
          onFinish={async (values) => {
            await handleSubmit(values as { username: string; password: string });
          }}
          submitter={{ searchConfig: { submitText: '登录' }, submitButtonProps: { loading: submitting } }}
        >
          <ProFormText
            name="username"
            fieldProps={{ size: 'large', prefix: <UserOutlined /> }}
            placeholder="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          />
          <ProFormText.Password
            name="password"
            fieldProps={{ size: 'large', prefix: <LockOutlined /> }}
            placeholder="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          />
          <div style={{ marginBottom: 8, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
            管理员账号登录，会话基于 HttpOnly Cookie
          </div>
        </LoginForm>
      </div>
      <Footer />
    </div>
  );
};

export default Login;