/**
 * 邮件设置：SMTP 配置（settings 表 key=smtp，密码加密存储）+ 发送测试邮件 + 通知模板入口
 * GET/PUT /settings/smtp、POST /settings/smtp/test
 */
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { history } from '@umijs/max';
import { App, Alert, Button, Input, InputNumber, Space, Spin, Switch, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import { getSmtpSettings, putSmtpSettings, testSmtp } from '@/services/admin';
import type { SmtpSettings } from '@/services/admin';

const MASK = '******';

const SMTP_FIELDS: { key: string; label: string; sensitive?: boolean; placeholder?: string }[] = [
  { key: 'host', label: 'SMTP 服务器', placeholder: '如 smtp.exmail.qq.com' },
  { key: 'user', label: 'SMTP 用户名', placeholder: '登录账号（中继模式可留空）' },
  { key: 'pass', label: 'SMTP 密码 / 授权码', sensitive: true },
  { key: 'from', label: '发件人地址', placeholder: '如 no-reply@example.com' },
];

const EmailSettingsPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [smtp, setSmtp] = useState<SmtpSettings>({});

  useEffect(() => {
    getSmtpSettings()
      .then((res) => setSmtp(res?.value ?? {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (patch: SmtpSettings) => setSmtp((prev) => ({ ...prev, ...patch }));

  const doSave = async () => {
    setSaving(true);
    try {
      await putSmtpSettings(smtp);
      message.success('邮件设置已保存（密码已加密存储）');
    } finally {
      setSaving(false);
    }
  };

  const doTest = async () => {
    if (!testTo.trim() || !testTo.includes('@')) {
      message.warning('请输入有效的目标邮箱');
      return;
    }
    setTesting(true);
    try {
      const res = await testSmtp(testTo.trim());
      if (res.ok) {
        message.success(
          res.provider === 'mock'
            ? '测试完成（当前未配置真实 SMTP，走 mock 发送）'
            : '测试邮件已发送，请查收',
        );
      } else {
        message.error(`发送失败：${res.error ?? '未知错误'}`);
      }
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      extra={
        <Button type="primary" loading={saving} onClick={doSave}>
          保存邮件设置
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        message="SMTP 密码加密存储，加载时不回显明文；密码框保持掩码 ****** 表示不修改。未配置时系统回退到 SMTP_* 环境变量，两者都缺省则邮件走 mock。"
        style={{ marginBottom: 16 }}
      />
      <ProCard title="SMTP 服务器" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          {SMTP_FIELDS.map((f) => {
            const value = (smtp as Record<string, unknown>)[f.key];
            const strValue = value === null || value === undefined ? '' : String(value);
            const common = {
              style: { width: 420 },
              value: strValue,
              placeholder: f.sensitive ? `${MASK}（保持不变）` : f.placeholder ?? '',
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                set({ [f.key]: e.target.value } as SmtpSettings),
            };
            return (
              <div key={f.key}>
                {f.label}：
                {f.sensitive ? (
                  <Input.Password {...common} visibilityToggle={false} autoComplete="new-password" />
                ) : (
                  <Input {...common} />
                )}
              </div>
            );
          })}
          <div>
            端口：
            <InputNumber
              min={1}
              max={65535}
              precision={0}
              style={{ width: 120 }}
              value={typeof smtp.port === 'number' ? smtp.port : undefined}
              onChange={(v) => set({ port: v ?? undefined })}
            />
            <span style={{ marginLeft: 16 }}>
              SSL/TLS（465 端口通常开启）：
              <Switch
                style={{ marginLeft: 8 }}
                checked={smtp.secure === true}
                onChange={(v) => set({ secure: v })}
              />
            </span>
          </div>
        </div>
      </ProCard>

      <ProCard title="发送测试邮件">
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space>
            <Input
              style={{ width: 320 }}
              value={testTo}
              placeholder="接收测试邮件的邮箱地址"
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button loading={testing} onClick={doTest}>
              发送测试邮件
            </Button>
          </Space>
          <Typography.Text type="secondary">
            使用上方已保存的 SMTP 配置真实发送一封测试邮件；未保存前请先点击「保存邮件设置」。
          </Typography.Text>
          <Space>
            <Typography.Text type="secondary">邮件内容模板（channel=email）在此维护：</Typography.Text>
            <a onClick={() => history.push('/tickets/templates')}>前往通知模板</a>
          </Space>
        </Space>
      </ProCard>
    </PageContainer>
  );
};

export default EmailSettingsPage;
