/**
 * 支付设置：支付宝 / 微信支付网关配置（settings 表 key=payment.gateways）
 * GET/PUT /settings/payment；敏感字段（privateKey/apiv3Key）后端加密落库，
 * 读取回传 "******" 掩码——原样回传表示不修改。
 */
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { App, Alert, Button, Card, Input, Spin, Switch } from 'antd';
import React, { useEffect, useState } from 'react';
import { getPaymentSettings, putPaymentSettings } from '@/services/admin';

const MASK = '******';

type GatewayState = Record<string, unknown>;

/** 网关字段元数据：sensitive 字段用密码输入框，掩码表示不变 */
const GATEWAYS: { code: string; name: string; fields: { key: string; label: string; sensitive?: boolean; textarea?: boolean; placeholder?: string }[] }[] = [
  {
    code: 'alipay',
    name: '支付宝',
    fields: [
      { key: 'appId', label: 'App ID' },
      { key: 'privateKey', label: '应用私钥', sensitive: true, textarea: true },
      { key: 'alipayPublicKey', label: '支付宝公钥', textarea: true },
      { key: 'gateway', label: '网关地址', placeholder: '缺省使用官方网关' },
    ],
  },
  {
    code: 'wechat',
    name: '微信支付',
    fields: [
      { key: 'mchid', label: '商户号' },
      { key: 'appid', label: 'App ID' },
      { key: 'serial', label: '证书序列号' },
      { key: 'privateKey', label: '商户私钥', sensitive: true, textarea: true },
      { key: 'apiv3Key', label: 'APIv3 密钥', sensitive: true },
      { key: 'publicKeyId', label: '公钥 ID' },
      { key: 'publicKey', label: '微信支付公钥', textarea: true },
    ],
  },
];

const emptyGateways = (): Record<string, GatewayState> => {
  const out: Record<string, GatewayState> = {};
  for (const g of GATEWAYS) out[g.code] = { enabled: false };
  return out;
};

const PaymentSettingsPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gateways, setGateways] = useState<Record<string, GatewayState>>(emptyGateways);

  useEffect(() => {
    getPaymentSettings()
      .then((res) => {
        const next = emptyGateways();
        const value = res?.value ?? {};
        for (const g of GATEWAYS) {
          const cfg = (value[g.code] ?? {}) as Record<string, unknown>;
          next[g.code] = { ...cfg, enabled: cfg.enabled === true };
        }
        setGateways(next);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (code: string, patch: GatewayState) =>
    setGateways((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));

  const doSave = async () => {
    setSaving(true);
    try {
      await putPaymentSettings(gateways);
      message.success('支付设置已保存（敏感值已加密存储）');
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
          保存支付设置
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        message="私钥 / APIv3 密钥等敏感值加密存储，加载时不回显明文；密码框留空或保持掩码 ****** 表示不修改。"
        style={{ marginBottom: 16 }}
      />
      {GATEWAYS.map((g, gi) => {
        const cfg = gateways[g.code] ?? {};
        const enabled = cfg.enabled === true;
        return (
          <ProCard
            key={g.code}
            title={
              <span>
                {g.name}
                <Switch
                  size="small"
                  style={{ marginLeft: 12 }}
                  checked={enabled}
                  onChange={(v) => update(g.code, { enabled: v })}
                />
                <span style={{ marginLeft: 6, fontSize: 12, color: '#999' }}>{enabled ? '已开启' : '已关闭'}</span>
              </span>
            }
            style={{ marginBottom: gi < GATEWAYS.length - 1 ? 16 : 0 }}
          >
            <div style={{ display: 'grid', gap: 12 }}>
              {g.fields.map((f) => {
                const value = cfg[f.key];
                const strValue = value === null || value === undefined ? '' : String(value);
                const common = {
                  style: { width: f.textarea ? 560 : 420 },
                  value: strValue,
                  placeholder: f.sensitive ? `${MASK}（保持不变）` : f.placeholder ?? '',
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    update(g.code, { [f.key]: e.target.value }),
                };
                return (
                  <div key={f.key}>
                    {f.label}：
                    {f.textarea ? (
                      <Input.TextArea rows={2} {...common} />
                    ) : f.sensitive ? (
                      <Input.Password {...common} visibilityToggle={false} autoComplete="new-password" />
                    ) : (
                      <Input {...common} />
                    )}
                    {f.sensitive && (
                      <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                        已加密存储；输入 {MASK} 或不修改即保持原值
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ProCard>
        );
      })}
      <Card size="small" style={{ marginTop: 16, background: '#fafafa' }}>
        说明：网关配置保存至系统 settings（key=payment.gateways），支付下单与回调由后端实时读取；关闭开关即停用对应渠道。
      </Card>
    </PageContainer>
  );
};

export default PaymentSettingsPage;
