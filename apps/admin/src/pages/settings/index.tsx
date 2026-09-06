/**
 * 系统设置：计费参数 / 站点信息
 * （支付网关、SMTP 邮件设置已拆分至独立页面：/system/settings/payment、/system/settings/email）
 * PUT /settings body { values: { key: value } }
 */
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { history } from '@umijs/max';
import { App, Button, Input, InputNumber, Space, Spin } from 'antd';
import React, { useEffect, useState } from 'react';
import { getSettings, putSettings } from '@/services/admin';

const BILLING_KEYS = [
  { key: 'billing.renewal_lead_days', label: '续费提醒提前天数', kind: 'number' },
  { key: 'billing.overdue_grace_days', label: '逾期宽限天数', kind: 'number' },
  { key: 'billing.terminate_days', label: '逾期终止天数', kind: 'number' },
  { key: 'payment.intent_timeout_minutes', label: '支付订单超时（分钟）', kind: 'number' },
] as const;

const SITE_KEYS = [
  { key: 'site.siteName', label: '站点名称', kind: 'text' },
  { key: 'site.announcement', label: '站点公告', kind: 'textarea' },
] as const;

const SettingsPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});

  useEffect(() => {
    // GET /settings 返回 { items: [{key, value}] }，转成 key → value 映射
    getSettings()
      .then((res) => {
        const map: Record<string, unknown> = {};
        for (const item of (res as { items?: { key: string; value: unknown }[] }).items ?? []) {
          map[item.key] = item.value;
        }
        setSettings(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const val = (key: string) => {
    const v = settings[key];
    if (v === null || v === undefined) return '';
    return String(v);
  };
  const num = (key: string) => {
    const v = Number(settings[key]);
    return Number.isFinite(v) ? v : undefined;
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const values: Record<string, unknown> = {};
      for (const k of BILLING_KEYS) {
        if (num(k.key) !== undefined) values[k.key] = num(k.key);
      }
      for (const k of SITE_KEYS) {
        if (val(k.key) !== '') values[k.key] = val(k.key);
      }
      await putSettings(values);
      message.success('设置已保存');
    } finally {
      setSaving(false);
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
          保存全部设置
        </Button>
      }
    >
      <ProCard title="计费参数" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {BILLING_KEYS.map((k) => (
            <div key={k.key}>
              {k.label}：
              <InputNumber
                min={0}
                precision={0}
                style={{ width: 140 }}
                value={num(k.key)}
                onChange={(v) => setSettings({ ...settings, [k.key]: v ?? null })}
                addonAfter={k.key.startsWith('payment.') ? '分钟' : '天'}
              />
              <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>key：{k.key}</div>
            </div>
          ))}
        </div>
      </ProCard>

      <ProCard title="站点信息" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            站点名称：
            <Input
              style={{ width: 320 }}
              value={val('site.siteName')}
              onChange={(e) => setSettings({ ...settings, 'site.siteName': e.target.value })}
            />
          </div>
          <div>
            站点公告：
            <Input.TextArea
              rows={3}
              style={{ marginTop: 4 }}
              value={val('site.announcement')}
              onChange={(e) => setSettings({ ...settings, 'site.announcement': e.target.value })}
            />
          </div>
        </div>
      </ProCard>

      <ProCard title="更多设置">
        <Space direction="vertical" size={8}>
          <Space>
            <Button onClick={() => history.push('/system/settings/payment')}>支付设置（支付宝 / 微信网关）</Button>
            <Button onClick={() => history.push('/system/settings/email')}>邮件设置（SMTP / 测试发送）</Button>
          </Space>
          <span style={{ fontSize: 12, color: '#999' }}>
            支付网关与 SMTP 邮件设置已拆分为独立页面，敏感值加密存储。
          </span>
        </Space>
      </ProCard>
    </PageContainer>
  );
};

export default SettingsPage;
