/**
 * 系统设置：计费参数 / 站点信息 / 支付网关
 * PUT /settings body { values: { key: value } }
 */
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { App, Alert, Button, Card, Divider, Input, InputNumber, Spin, Switch } from 'antd';
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

type GatewayConfig = { enabled: boolean; appId: string; privateKey: string; publicKey: string };

const GATEWAYS: { code: string; name: string; fields: string[] }[] = [
  { code: 'alipay', name: '支付宝', fields: ['appId', 'privateKey', 'publicKey'] },
  { code: 'wechat', name: '微信支付', fields: ['appId', 'privateKey', 'publicKey'] },
];

const SettingsPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [gateways, setGateways] = useState<Record<string, GatewayConfig>>({
    alipay: { enabled: false, appId: '', privateKey: '', publicKey: '' },
    wechat: { enabled: false, appId: '', privateKey: '', publicKey: '' },
  });

  useEffect(() => {
    getSettings()
      .then((map) => {
        setSettings(map ?? {});
        setGateways((prev) => {
          const next = { ...prev };
          for (const g of GATEWAYS) {
            const enabled = map?.[`payment.${g.code}.enabled`];
            next[g.code] = {
              enabled: enabled === true || enabled === 'true',
              appId: (map?.[`payment.${g.code}.app_id`] as string) ?? '',
              privateKey: (map?.[`payment.${g.code}.private_key`] as string) ?? '',
              publicKey: (map?.[`payment.${g.code}.public_key`] as string) ?? '',
            };
          }
          return next;
        });
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
      for (const g of GATEWAYS) {
        const cfg = gateways[g.code];
        values[`payment.${g.code}.enabled`] = cfg.enabled;
        if (cfg.appId) values[`payment.${g.code}.app_id`] = cfg.appId;
        if (cfg.privateKey) values[`payment.${g.code}.private_key`] = cfg.privateKey;
        if (cfg.publicKey) values[`payment.${g.code}.public_key`] = cfg.publicKey;
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

  const updateGateway = (code: string, patch: Partial<GatewayConfig>) =>
    setGateways((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));

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

      <ProCard title="支付网关">
        <Alert
          type="info"
          showIcon
          message="保存后写入系统 settings，密钥等敏感值将加密存储，再次加载时不会回显明文（留空表示不修改）。"
          style={{ marginBottom: 16 }}
        />
        {GATEWAYS.map((g, gi) => {
          const cfg = gateways[g.code];
          return (
            <div key={g.code}>
              {gi > 0 && <Divider />}
              <Card
                size="small"
                title={
                  <span>
                    {g.name}
                    <Switch
                      size="small"
                      style={{ marginLeft: 12 }}
                      checked={cfg.enabled}
                      onChange={(v) => updateGateway(g.code, { enabled: v })}
                    />
                    <span style={{ marginLeft: 6, fontSize: 12, color: '#999' }}>{cfg.enabled ? '已开启' : '已关闭'}</span>
                  </span>
                }
              >
                <div style={{ display: 'grid', gap: 10 }}>
                  <div>
                    App ID：
                    <Input
                      style={{ width: 420 }}
                      value={cfg.appId}
                      onChange={(e) => updateGateway(g.code, { appId: e.target.value })}
                      placeholder={`${g.name} 应用 ID`}
                    />
                  </div>
                  <div>
                    应用私钥：
                    <Input.TextArea
                      rows={2}
                      value={cfg.privateKey}
                      onChange={(e) => updateGateway(g.code, { privateKey: e.target.value })}
                      placeholder="留空表示不修改"
                    />
                  </div>
                  <div>
                    平台公钥：
                    <Input.TextArea
                      rows={2}
                      value={cfg.publicKey}
                      onChange={(e) => updateGateway(g.code, { publicKey: e.target.value })}
                      placeholder="留空表示不修改"
                    />
                  </div>
                </div>
              </Card>
            </div>
          );
        })}
      </ProCard>
    </PageContainer>
  );
};

export default SettingsPage;