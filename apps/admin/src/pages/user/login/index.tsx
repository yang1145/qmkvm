import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { LoginForm, ProFormText } from '@ant-design/pro-components';
import { history, Helmet, useModel } from '@umijs/max';
import { App } from 'antd';
import React, { startTransition, useCallback, useEffect, useState } from 'react';
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

// 构建期注入 ADMIN_API_URL（统一方案，跨域直连，不用反代）；留空仅限本地 dev（umi proxy）
const API_ORIGIN = process.env.ADMIN_API_URL || '';
const CAPTCHA_PATH = `${API_ORIGIN}/api/v1/admin/auth/captcha`;

const Login: React.FC = () => {
  const [submitting, setSubmitting] = useState(false);
  const [captcha, setCaptcha] = useState<{ captchaId: string; svg: string } | null>(null);
  const { initialState, setInitialState } = useModel('@@initialState');
  const { message } = App.useApp();

  /** 获取图形验证码（JSON 返回 svg，data URI 渲染；ts 防缓存） */
  const refreshCaptcha = useCallback(async () => {
    try {
      const res = await fetch(`${CAPTCHA_PATH}?ts=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { captchaId: string; svg: string };
      setCaptcha(data);
    } catch {
      // 验证码加载失败静默（提交时后端会拦截）
    }
  }, []);

  useEffect(() => {
    refreshCaptcha();
  }, [refreshCaptcha]);

  const handleSubmit = async (values: {
    username: string;
    password: string;
    captchaCode: string;
  }) => {
    if (!captcha?.captchaId) {
      message.warning('验证码未加载，请点击图片刷新');
      refreshCaptcha();
      return;
    }
    setSubmitting(true);
    try {
      await adminLogin({
        username: values.username.trim(),
        password: values.password,
        captchaId: captcha.captchaId,
        captchaCode: values.captchaCode,
      });
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
      // 错误提示由统一 errorHandler 处理；验证码一次性消费，失败后刷新
      setCaptcha(null);
      refreshCaptcha();
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
          title="启明智联业务管理系统"
          subTitle="云业务系统运营管理"
          initialValues={{ autoLogin: true }}
          onFinish={async (values) => {
            await handleSubmit(values as { username: string; password: string; captchaCode: string });
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <ProFormText
                name="captchaCode"
                fieldProps={{
                  size: 'large',
                  prefix: <SafetyCertificateOutlined />,
                  maxLength: 4,
                  autoComplete: 'off',
                }}
                placeholder="验证码（不区分大小写）"
                rules={[{ required: true, message: '请输入图形验证码' }]}
              />
            </div>
            <img
              alt="点击刷新验证码"
              title="点击刷新"
              src={
                captcha
                  ? `data:image/svg+xml;utf8,${encodeURIComponent(captcha.svg)}`
                  : `${CAPTCHA_PATH}?ts=${Date.now()}`
              }
              onClick={() => refreshCaptcha()}
              style={{
                height: 40,
                width: 130,
                cursor: 'pointer',
                borderRadius: 4,
                border: '1px solid #d9d9d9',
                marginBottom: 24,
              }}
            />
          </div>
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
