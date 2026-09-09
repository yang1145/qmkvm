/**
 * 系统设置：计费参数 / 站点信息（品牌定制）
 * （支付网关、SMTP 邮件设置已拆分至独立页面：/system/settings/payment、/system/settings/email）
 * 计费参数：PUT /settings body { values: { key: value } }
 * 站点信息：GET|PUT /settings/site（settings key='site'；logo 为 data URL。
 *           保存后 portal 运行时 ≤60s 自动生效；官网 www 为静态导出，需重新构建部署）
 */
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { history } from '@umijs/max';
import { App, Button, Input, InputNumber, Space, Spin, Upload } from 'antd';
import React, { useEffect, useState } from 'react';
import {
  getSettings,
  putSettings,
  getSiteSettings,
  putSiteSettings,
  type SiteSettings,
} from '@/services/admin';

const BILLING_KEYS = [
  { key: 'billing.renewal_lead_days', label: '续费提醒提前天数', kind: 'number' },
  { key: 'billing.overdue_grace_days', label: '逾期宽限天数', kind: 'number' },
  { key: 'billing.terminate_days', label: '逾期终止天数', kind: 'number' },
  { key: 'payment.intent_timeout_minutes', label: '支付订单超时（分钟）', kind: 'number' },
] as const;

const MAX_LOGO_BYTES = 200 * 1024;

const SettingsPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [site, setSite] = useState<SiteSettings>({});
  const [siteSaving, setSiteSaving] = useState(false);

  useEffect(() => {
    // 计费参数走通用 GET /settings（key → value 映射）；品牌定制走 GET /settings/site
    Promise.all([getSettings(), getSiteSettings()])
      .then(([res, siteRes]) => {
        const map: Record<string, unknown> = {};
        for (const item of (res as { items?: { key: string; value: unknown }[] }).items ?? []) {
          map[item.key] = item.value;
        }
        setSettings(map);
        setSite(siteRes.value ?? {});
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
      await putSettings(values);
      message.success('计费参数已保存');
    } finally {
      setSaving(false);
    }
  };

  const sval = (k: keyof SiteSettings) => {
    const v = site[k];
    return v === null || v === undefined ? '' : String(v);
  };
  const setField = (k: keyof SiteSettings, v: string) =>
    setSite((s) => ({ ...s, [k]: v }));

  /** 保存品牌信息：站点名留空则不提交（保留旧值），其余字段留空 = 显式清空（null） */
  const saveSite = async () => {
    setSiteSaving(true);
    try {
      const name = sval('siteName').trim();
      const value: SiteSettings = {
        siteNameEn: sval('siteNameEn').trim() || null,
        copyright: sval('copyright').trim() || null,
        contactEmail: sval('contactEmail').trim() || null,
        portalUrl: sval('portalUrl').trim() || null,
        announcement: sval('announcement').trim() || null,
        logo: site.logo ?? null,
      };
      if (name) value.siteName = name;
      await putSiteSettings(value);
      message.success('站点信息已保存：门户将自动生效，官网需重新构建部署后生效');
    } finally {
      setSiteSaving(false);
    }
  };

  /** 本地读取图片转 data URL（不经过后端上传），校验类型与大小后写入 state */
  const handleLogo = (file: File) => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      message.error('Logo 仅支持 PNG / JPG 格式');
      return false;
    }
    if (file.size > MAX_LOGO_BYTES) {
      message.error('Logo 图片不能超过 200KB');
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => setSite((s) => ({ ...s, logo: reader.result as string }));
    reader.readAsDataURL(file);
    return false; // 阻止 antd 自动上传
  };

  if (loading) {
    return (
      <PageContainer>
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <ProCard
        title="站点信息（品牌定制）"
        style={{ marginBottom: 16 }}
        extra={
          <Button type="primary" loading={siteSaving} onClick={saveSite}>
            保存站点信息
          </Button>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          <div>
            站点名称：
            <Input
              style={{ width: 240 }}
              placeholder="留空保留当前值"
              value={sval('siteName')}
              onChange={(e) => setField('siteName', e.target.value)}
            />
          </div>
          <div>
            英文名称：
            <Input
              style={{ width: 240 }}
              placeholder="如 QmKvm"
              value={sval('siteNameEn')}
              onChange={(e) => setField('siteNameEn', e.target.value)}
            />
          </div>
          <div>
            联系邮箱：
            <Input
              style={{ width: 240 }}
              placeholder="展示于官网页脚"
              value={sval('contactEmail')}
              onChange={(e) => setField('contactEmail', e.target.value)}
            />
          </div>
          <div>
            门户地址：
            <Input
              style={{ width: 240 }}
              placeholder="https://...（官网「控制台」入口）"
              value={sval('portalUrl')}
              onChange={(e) => setField('portalUrl', e.target.value)}
            />
          </div>
          <div>
            Logo：
            <Space style={{ marginLeft: 4 }}>
              <Upload accept="image/png,image/jpeg" showUploadList={false} beforeUpload={handleLogo}>
                <Button>上传（PNG/JPG ≤200KB）</Button>
              </Upload>
              {site.logo ? (
                <>
                  <img src={site.logo} alt="logo 预览" style={{ height: 32, maxWidth: 160, objectFit: 'contain' }} />
                  <Button onClick={() => setSite((s) => ({ ...s, logo: null }))}>清除</Button>
                </>
              ) : null}
            </Space>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <div>
            版权信息：
            <Input
              style={{ width: 480 }}
              placeholder="留空显示默认 © {year} {brand}；支持 {year}/{brand} 占位符"
              value={sval('copyright')}
              onChange={(e) => setField('copyright', e.target.value)}
            />
          </div>
          <div>
            站点公告：
            <Input.TextArea
              rows={3}
              style={{ marginTop: 4 }}
              placeholder="展示于门户首页顶部"
              value={sval('announcement')}
              onChange={(e) => setField('announcement', e.target.value)}
            />
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
          保存至系统 settings（key=site）：门户 portal 运行时读取（≤60s 生效）；官网 www 为静态导出，
          需配置 BRANDING_API_URL 重新构建部署后生效。
        </div>
      </ProCard>

      <ProCard
        title="计费参数"
        style={{ marginBottom: 16 }}
        extra={
          <Button type="primary" loading={saving} onClick={doSave}>
            保存计费参数
          </Button>
        }
      >
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
