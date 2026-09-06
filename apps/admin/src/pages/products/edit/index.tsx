/**
 * 商品编辑页：基本信息 + 周期定价 + 可配置选项组编辑器
 * 路由 /products/:id/edit，id=0 表示新建
 */
import { history, useParams } from '@umijs/max';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, App, Button, Card, Checkbox, Divider, Input, InputNumber, Modal, Select, Space, Spin, Switch, Tag } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import {
  createConfigGroup,
  createConfigOption,
  createProduct,
  deleteConfigGroup,
  deleteConfigOption,
  getProduct,
  getProductGroups,
  getProvisionModules,
  testProvisionModule,
  updateConfigGroup,
  updateConfigOption,
  updateProduct,
} from '@/services/admin';
import type {
  ConfigGroup,
  ConfigOption,
  ProductGroupItem,
  ProductPricing,
  ProvisionModuleItem,
} from '@/services/types';
import { yuanToFen } from '@/utils/format';
import { BILLING_CYCLE, BILLING_CYCLE_LABEL } from '@/services/enums';

const GROUP_TYPES = [
  { value: 'select', label: '下拉选择' },
  { value: 'radio', label: '单选' },
  { value: 'checkbox', label: '多选' },
  { value: 'quantity', label: '数量' },
];

// ============ 弹性套餐向导 ============

type TierDraft = { label: string; value: string; deltaYuan: number; isDefault: boolean };
type WizardGroup = {
  key: string;
  include: boolean;
  name: string;
  type: 'radio' | 'quantity';
  required: boolean;
  /** radio 档位 */
  tiers: TierDraft[];
  /** quantity 每单位加价（元/周期） */
  unitPriceYuan: number;
  /** quantity 默认数量 */
  defaultQty: number;
};

const defaultWizardGroups = (): WizardGroup[] => [
  {
    key: 'cpu', include: true, name: 'CPU', type: 'radio', required: true, unitPriceYuan: 0, defaultQty: 1,
    tiers: [
      { label: '2 核', value: '2c', deltaYuan: 0, isDefault: true },
      { label: '4 核', value: '4c', deltaYuan: 40, isDefault: false },
      { label: '8 核', value: '8c', deltaYuan: 120, isDefault: false },
      { label: '16 核', value: '16c', deltaYuan: 280, isDefault: false },
    ],
  },
  {
    key: 'ram', include: true, name: '内存', type: 'radio', required: true, unitPriceYuan: 0, defaultQty: 1,
    tiers: [
      { label: '4GB', value: '4g', deltaYuan: 0, isDefault: true },
      { label: '8GB', value: '8g', deltaYuan: 60, isDefault: false },
      { label: '16GB', value: '16g', deltaYuan: 180, isDefault: false },
      { label: '32GB', value: '32g', deltaYuan: 420, isDefault: false },
    ],
  },
  {
    key: 'disk', include: true, name: '系统盘', type: 'radio', required: true, unitPriceYuan: 0, defaultQty: 1,
    tiers: [
      { label: '40GB SSD', value: '40g', deltaYuan: 0, isDefault: true },
      { label: '80GB SSD', value: '80g', deltaYuan: 60, isDefault: false },
      { label: '160GB SSD', value: '160g', deltaYuan: 180, isDefault: false },
    ],
  },
  {
    key: 'bandwidth', include: true, name: '公网带宽（Mbps）', type: 'quantity', required: true,
    tiers: [], unitPriceYuan: 15, defaultQty: 3,
  },
  {
    key: 'datadisk', include: true, name: '数据盘（10GB）', type: 'quantity', required: true,
    tiers: [], unitPriceYuan: 10, defaultQty: 0,
  },
  {
    key: 'ip', include: true, name: '公网 IP（个）', type: 'quantity', required: true,
    tiers: [], unitPriceYuan: 20, defaultQty: 1,
  },
  {
    key: 'region', include: true, name: '地域', type: 'radio', required: true, unitPriceYuan: 0, defaultQty: 1,
    tiers: [
      { label: '华东-上海', value: 'cn-shanghai', deltaYuan: 0, isDefault: true },
      { label: '华北-北京', value: 'cn-beijing', deltaYuan: 0, isDefault: false },
    ],
  },
  {
    key: 'os', include: true, name: '操作系统', type: 'radio', required: true, unitPriceYuan: 0, defaultQty: 1,
    tiers: [
      { label: 'Ubuntu 22.04', value: 'ubuntu22.04', deltaYuan: 0, isDefault: true },
      { label: 'Debian 12', value: 'debian12', deltaYuan: 0, isDefault: false },
      { label: 'CentOS Stream 9', value: 'centos9', deltaYuan: 0, isDefault: false },
      { label: 'Windows Server 2022', value: 'win2022', deltaYuan: 80, isDefault: false },
    ],
  },
];

type PricingDraft = { cycle: string; firstPriceYuan: number; renewalPriceYuan: number; setupFeeYuan: number };

const ProductEdit: React.FC = () => {
  const params = useParams<{ id: string }>();
  const idNum = Number(params.id) || 0;
  const isNew = idNum === 0;
  const access = useAccess();
  const { message } = App.useApp();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState<ProductGroupItem[]>([]);
  const [base, setBase] = useState({
    name: '',
    slug: '',
    tagline: '',
    descriptionHtml: '',
    moduleCode: 'manual',
    groupId: undefined as number | undefined,
    stockEnabled: false,
    stockTotal: 0,
    status: 'active' as 'active' | 'inactive',
    hidden: false,
    sortOrder: 0,
    requiresIdentity: false,
    allowUpgrade: true,
    allowDowngrade: false,
  });
  const [pricing, setPricing] = useState<PricingDraft[]>([]);
  const [configGroups, setConfigGroups] = useState<ConfigGroup[]>([]);
  const [modules, setModules] = useState<ProvisionModuleItem[]>([]);
  /** 供应模块配置 JSON（详情接口返回，用于「测试连接」） */
  const [moduleConfig, setModuleConfig] = useState<Record<string, unknown> | null>(null);
  /** 供应模块配置 JSON 文本（http-api / pve 模块显示编辑框，随「保存」提交） */
  const [moduleConfigText, setModuleConfigText] = useState('{}');
  const [testingConn, setTestingConn] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardGroups, setWizardGroups] = useState<WizardGroup[]>(defaultWizardGroups);
  const [wizardSaving, setWizardSaving] = useState(false);

  useEffect(() => {
    getProductGroups().then(setGroups).catch(() => {});
    getProvisionModules().then(setModules).catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    getProduct(idNum)
      .then((p) => {
        setBase({
          name: p.name,
          slug: p.slug,
          tagline: p.tagline ?? '',
          descriptionHtml: p.descriptionHtml ?? '',
          moduleCode: p.moduleCode,
          groupId: p.groupId,
          stockEnabled: p.stockTotal !== null,
          stockTotal: p.stockTotal ?? 0,
          status: p.status,
          hidden: p.hidden,
          sortOrder: p.sortOrder,
          requiresIdentity: p.requiresIdentity ?? false,
          allowUpgrade: p.allowUpgrade ?? true,
          allowDowngrade: p.allowDowngrade ?? false,
        });
        setPricing(
          (p.pricing ?? []).map((c: ProductPricing) => ({
            cycle: c.cycle,
            firstPriceYuan: c.firstPrice / 100,
            renewalPriceYuan: c.renewalPrice / 100,
            setupFeeYuan: c.setupFee / 100,
          })),
        );
        setConfigGroups(p.configGroups ?? []);
        setModuleConfig(p.moduleConfig ?? null);
        setModuleConfigText(JSON.stringify(p.moduleConfig ?? {}, null, 2));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [idNum, isNew]);

  /** 当前模块是否显示 moduleConfig JSON 编辑框（仅 http-api / pve 需要商品级 JSON 配置） */
  const showModuleConfig = base.moduleCode === 'http-api' || base.moduleCode === 'pve';

  /** 解析 moduleConfig 编辑框内容为对象；非法返回 null 并提示 */
  const parseModuleConfigText = (): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(moduleConfigText);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        message.warning('供应模块配置必须为 JSON 对象');
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      message.warning('供应模块配置不是合法 JSON，请检查后重试');
      return null;
    }
  };

  const doSaveBase = async () => {
    if (!base.name.trim() || !base.slug.trim()) {
      message.warning('商品名称与 slug 不能为空');
      return;
    }
    if (!base.groupId) {
      message.warning('请选择商品分组');
      return;
    }
    // moduleConfig 随基本信息一并提交（仅 http-api / pve 模块显示编辑框时）
    let moduleConfigValue: Record<string, unknown> | undefined;
    if (showModuleConfig) {
      const parsed = parseModuleConfigText();
      if (parsed === null) return;
      moduleConfigValue = parsed;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: base.name.trim(),
        slug: base.slug.trim(),
        tagline: base.tagline || null,
        descriptionHtml: base.descriptionHtml || null,
        moduleCode: base.moduleCode,
        groupId: base.groupId,
        stockTotal: base.stockEnabled ? base.stockTotal : null,
        status: base.status,
        hidden: base.hidden,
        sortOrder: base.sortOrder,
        requiresIdentity: base.requiresIdentity,
        allowUpgrade: base.allowUpgrade,
        allowDowngrade: base.allowDowngrade,
        pricing: pricing.map((c) => ({
          cycle: c.cycle,
          firstPrice: yuanToFen(c.firstPriceYuan),
          renewalPrice: yuanToFen(c.renewalPriceYuan),
          setupFee: yuanToFen(c.setupFeeYuan),
        })),
        ...(moduleConfigValue !== undefined ? { moduleConfig: moduleConfigValue } : {}),
      };
      if (isNew) {
        const created = await createProduct(payload);
        message.success('商品已创建');
        history.replace(`/products/${created.id}/edit`);
      } else {
        await updateProduct(idNum, payload);
        message.success('商品已保存');
      }
    } finally {
      setSaving(false);
    }
  };

  // ============ 弹性套餐向导 ============

  const patchWizard = (key: string, patch: Partial<WizardGroup>) =>
    setWizardGroups((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  const generateElastic = async () => {
    const included = wizardGroups.filter((g) => g.include);
    if (included.length === 0) {
      message.warning('请至少选择一个配置组');
      return;
    }
    for (const g of included) {
      if (g.type === 'radio' && g.tiers.filter((t) => t.label.trim() && t.value.trim()).length === 0) {
        message.warning(`「${g.name}」至少需要一个有效档位（名称与值）`);
        return;
      }
      if (g.type === 'radio' && !g.tiers.some((t) => t.isDefault && t.label.trim())) {
        message.warning(`「${g.name}」请设置一个默认档位`);
        return;
      }
    }
    const existingNames = new Set(configGroups.map((g) => g.name));
    const duplicated = included.filter((g) => existingNames.has(g.name));
    if (duplicated.length > 0) {
      message.warning(`配置组已存在，请先删除重复项：${duplicated.map((g) => g.name).join('、')}`);
      return;
    }

    setWizardSaving(true);
    try {
      let order = configGroups.length;
      let optionCount = 0;
      for (const g of included) {
        const created = await createConfigGroup(idNum, { name: g.name, type: g.type, required: g.required });
        const gid = created.id;
        if (g.type === 'radio') {
          const tiers = g.tiers.filter((t) => t.label.trim() && t.value.trim());
          for (const [i, t] of tiers.entries()) {
            await createConfigOption(gid, {
              label: t.label.trim(),
              value: t.value.trim(),
              priceDelta: yuanToFen(t.deltaYuan),
              setupDelta: 0,
              isDefault: t.isDefault,
              sortOrder: i,
            });
            optionCount++;
          }
        } else {
          await createConfigOption(gid, {
            label: g.name,
            value: g.key,
            priceDelta: yuanToFen(g.unitPriceYuan),
            setupDelta: 0,
            isDefault: true,
            sortOrder: 0,
          });
          optionCount++;
        }
        order++;
        void order;
      }
      const list = await getProduct(idNum);
      setConfigGroups(list.configGroups ?? []);
      message.success(`已生成 ${included.length} 个配置组、${optionCount} 个选项（价格档位可继续手动微调）`);
      setWizardOpen(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '生成失败');
    } finally {
      setWizardSaving(false);
    }
  };

  // ============ 配置组操作 ============

  /** 用表单当前的 moduleCode + moduleConfig 调模块连接测试接口（编辑框内容未保存也可测试） */
  const doTestConnection = async () => {
    const code = base.moduleCode.trim();
    if (!code) {
      message.warning('请先填写供应模块 code');
      return;
    }
    // http-api / pve：优先使用编辑框当前内容；其他模块用详情返回的配置
    let config: Record<string, unknown> | null = moduleConfig;
    if (showModuleConfig) {
      const parsed = parseModuleConfigText();
      if (parsed === null) return;
      config = parsed;
    }
    setTestingConn(true);
    try {
      const res = await testProvisionModule(code, config);
      if (res.ok) {
        message.success(res.message ?? '连接成功');
      } else {
        message.error(res.message ?? '连接失败');
      }
    } catch {
      // 请求失败（如无权限）由统一 errorHandler 提示
    } finally {
      setTestingConn(false);
    }
  };

  const addConfigGroup = async () => {
    if (isNew) {
      message.warning('请先保存商品后再添加配置组');
      return;
    }
    const name = window.prompt('配置组名称');
    if (!name?.trim()) return;
    const created = await createConfigGroup(idNum, { name: name.trim(), type: 'select', required: false });
    const list = await getProduct(idNum);
    setConfigGroups(list.configGroups ?? []);
    void created;
  };

  const saveConfigGroup = async (g: ConfigGroup) => {
    await updateConfigGroup(g.id, { name: g.name, type: g.type, required: g.required });
    message.success('配置组已更新');
  };

  const removeConfigGroup = (g: ConfigGroup) => {
    Modal.confirm({
      title: '删除配置组',
      content: `确认删除配置组「${g.name}」及其全部选项？`,
      okType: 'danger',
      onOk: async () => {
        await deleteConfigGroup(g.id);
        setConfigGroups((prev) => prev.filter((x) => x.id !== g.id));
        message.success('配置组已删除');
      },
    });
  };

  const addOption = async (g: ConfigGroup) => {
    const label = window.prompt('选项名称');
    if (!label?.trim()) return;
    const value = window.prompt('选项值（英文）') ?? '';
    if (!value.trim()) return;
    await createConfigOption(g.id, {
      label: label.trim(),
      value: value.trim(),
      priceDelta: 0,
      setupDelta: 0,
      isDefault: false,
      sortOrder: (g.options ?? []).length,
    });
    const list = await getProduct(idNum);
    setConfigGroups(list.configGroups ?? []);
  };

  const updateOption = async (g: ConfigGroup, opt: ConfigOption, patch: Partial<ConfigOption>) => {
    await updateConfigOption(opt.id, { ...opt, ...patch });
    const list = await getProduct(idNum);
    setConfigGroups(list.configGroups ?? []);
  };

  const removeOption = (opt: ConfigOption) => {
    Modal.confirm({
      title: '删除选项',
      content: `确认删除选项「${opt.label}」？`,
      okType: 'danger',
      onOk: async () => {
        await deleteConfigOption(opt.id);
        setConfigGroups((prev) =>
          prev.map((g) => ({ ...g, options: (g.options ?? []).filter((o) => o.id !== opt.id) })),
        );
        message.success('选项已删除');
      },
    });
  };

  const moveOption = async (g: ConfigGroup, index: number, dir: -1 | 1) => {
    const options = [...(g.options ?? [])];
    const target = index + dir;
    if (target < 0 || target >= options.length) return;
    [options[index], options[target]] = [options[target], options[index]];
    // 乐观更新 UI，然后按顺序提交 sortOrder
    setConfigGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, options } : x)));
    try {
      await Promise.all(
        options.map((opt, i) => updateConfigOption(opt.id, { ...opt, sortOrder: i })),
      );
    } catch {
      message.error('排序保存失败');
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </PageContainer>
    );
  }

  const readOnly = !access.canProductsManage;

  return (
    <PageContainer
      title={isNew ? '新建商品' : `编辑商品 #${idNum}`}
      onBack={() => history.push('/products')}
    >
      <ProCard title="基本信息" extra={<Button type="primary" loading={saving} disabled={readOnly} onClick={doSaveBase}>保存</Button>}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            商品名称：
            <Input
              style={{ width: '70%' }}
              value={base.name}
              disabled={readOnly}
              onChange={(e) => setBase({ ...base, name: e.target.value })}
            />
          </div>
          <div>
            slug：
            <Input
              style={{ width: '70%' }}
              value={base.slug}
              disabled={readOnly}
              onChange={(e) => setBase({ ...base, slug: e.target.value })}
            />
          </div>
          <div>
            标语：
            <Input
              style={{ width: '70%' }}
              value={base.tagline}
              disabled={readOnly}
              onChange={(e) => setBase({ ...base, tagline: e.target.value })}
            />
          </div>
          <div>
            分组：
            <Select
              style={{ width: '70%' }}
              value={base.groupId}
              disabled={readOnly}
              onChange={(v) => setBase({ ...base, groupId: v })}
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
              placeholder="选择分组"
            />
          </div>
          <div>
            供应模块：
            <Select
              style={{ width: '50%' }}
              value={modules.some((m) => m.code === base.moduleCode) ? base.moduleCode : undefined}
              disabled={readOnly}
              onChange={(v) => setBase({ ...base, moduleCode: v })}
              placeholder="选择供应模块"
              optionFilterProp="label"
              options={modules.map((m) => ({
                value: m.code,
                label: `${m.name}（${m.code}）`,
                title: m.description ?? m.code,
              }))}
            />
            {!modules.some((m) => m.code === base.moduleCode) && (
              <Tag color="orange" style={{ marginLeft: 8 }}>
                未知模块：{base.moduleCode}
              </Tag>
            )}
            <Button
              size="small"
              style={{ marginLeft: 8 }}
              loading={testingConn}
              disabled={readOnly}
              onClick={() => void doTestConnection()}
            >
              测试连接
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Checkbox
              checked={base.requiresIdentity}
              disabled={readOnly}
              onChange={(e) => setBase({ ...base, requiresIdentity: e.target.checked })}
            >
              购买需实名
            </Checkbox>
            <Checkbox
              checked={base.allowUpgrade}
              disabled={readOnly}
              onChange={(e) => setBase({ ...base, allowUpgrade: e.target.checked })}
            >
              允许升级
            </Checkbox>
            <Checkbox
              checked={base.allowDowngrade}
              disabled={readOnly}
              onChange={(e) => setBase({ ...base, allowDowngrade: e.target.checked })}
            >
              允许降级
            </Checkbox>
          </div>
          <div>
            排序：
            <InputNumber
              style={{ width: '70%' }}
              value={base.sortOrder}
              disabled={readOnly}
              onChange={(v) => setBase({ ...base, sortOrder: v ?? 0 })}
            />
          </div>
          <div>
            <Checkbox
              checked={base.stockEnabled}
              disabled={readOnly}
              onChange={(e) => setBase({ ...base, stockEnabled: e.target.checked })}
            >
              限制库存
            </Checkbox>
            {base.stockEnabled && (
              <InputNumber
                min={0}
                precision={0}
                style={{ width: 120, marginLeft: 8 }}
                value={base.stockTotal}
                disabled={readOnly}
                onChange={(v) => setBase({ ...base, stockTotal: v ?? 0 })}
              />
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <span>
              状态：
              <Select
                style={{ width: 110, marginLeft: 8 }}
                value={base.status}
                disabled={readOnly}
                onChange={(v) => setBase({ ...base, status: v })}
                options={[
                  { value: 'active', label: '上架' },
                  { value: 'inactive', label: '下架' },
                ]}
              />
            </span>
            <Checkbox
              checked={base.hidden}
              disabled={readOnly}
              onChange={(e) => setBase({ ...base, hidden: e.target.checked })}
            >
              隐藏
            </Checkbox>
          </div>
        </div>
      </ProCard>

      {showModuleConfig && (
        <ProCard title="供应模块配置（moduleConfig）" style={{ marginTop: 16 }}>
          <Input.TextArea
            rows={12}
            spellCheck={false}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
            value={moduleConfigText}
            disabled={readOnly}
            onChange={(e) => setModuleConfigText(e.target.value)}
            placeholder={'{\n  "host": "https://1.2.3.4:8006",\n  "auth": { ... }\n}'}
          />
          <div style={{ color: '#999', marginTop: 8 }}>
            JSON 对象，作为商品级供应模块配置（service 侧快照优先）。随上方「保存」按钮一并提交；「测试连接」使用当前编辑内容（无需先保存）。字段说明见供应模块文档（packages/provisioning/README.md）。
          </div>
        </ProCard>
      )}

      <ProCard title="商品详情" style={{ marginTop: 16 }}>
        <Input.TextArea
          rows={6}
          maxLength={50000}
          showCount
          value={base.descriptionHtml}
          disabled={readOnly}
          onChange={(e) => setBase({ ...base, descriptionHtml: e.target.value })}
          placeholder="<p>商品详细介绍（HTML），展示在门户商品页。</p>"
        />
        <div style={{ color: '#999', marginTop: 8 }}>支持 HTML 标签；随「保存」按钮一并提交。</div>
      </ProCard>

      <ProCard title="周期定价" style={{ marginTop: 16 }} extra={
        <Button
          size="small"
          disabled={readOnly}
          onClick={() =>
            setPricing([...pricing, { cycle: 'monthly', firstPriceYuan: 0, renewalPriceYuan: 0, setupFeeYuan: 0 }])
          }
        >
          添加周期
        </Button>
      }>
        {pricing.length === 0 && <div style={{ color: '#999' }}>暂无定价，点击右上角「添加周期」</div>}
        {pricing.map((c, idx) => (
          <Space key={idx} style={{ display: 'flex', marginBottom: 8 }} wrap>
            <Select
              style={{ width: 120 }}
              value={c.cycle}
              disabled={readOnly}
              onChange={(v) => {
                const next = [...pricing];
                next[idx] = { ...c, cycle: v };
                setPricing(next);
              }}
              options={BILLING_CYCLE.map((cy) => ({ value: cy, label: BILLING_CYCLE_LABEL[cy] }))}
            />
            <InputNumber
              min={0}
              precision={2}
              addonBefore="首价 ¥"
              style={{ width: 150 }}
              value={c.firstPriceYuan}
              disabled={readOnly}
              onChange={(v) => {
                const next = [...pricing];
                next[idx] = { ...c, firstPriceYuan: v ?? 0 };
                setPricing(next);
              }}
            />
            <InputNumber
              min={0}
              precision={2}
              addonBefore="续费 ¥"
              style={{ width: 150 }}
              value={c.renewalPriceYuan}
              disabled={readOnly}
              onChange={(v) => {
                const next = [...pricing];
                next[idx] = { ...c, renewalPriceYuan: v ?? 0 };
                setPricing(next);
              }}
            />
            <InputNumber
              min={0}
              precision={2}
              addonBefore="开通 ¥"
              style={{ width: 150 }}
              value={c.setupFeeYuan}
              disabled={readOnly}
              onChange={(v) => {
                const next = [...pricing];
                next[idx] = { ...c, setupFeeYuan: v ?? 0 };
                setPricing(next);
              }}
            />
            <Button danger disabled={readOnly} onClick={() => setPricing(pricing.filter((_, i) => i !== idx))}>
              删除
            </Button>
          </Space>
        ))}
        <Divider />
        <div style={{ color: '#999' }}>定价随「保存」按钮一并提交（首价/续费/开通费单位为元，提交自动转换为分）。</div>
      </ProCard>

      <ProCard
        title="可配置选项组"
        style={{ marginTop: 16 }}
        extra={
          <Space size={8}>
            <Button
              type="primary"
              disabled={readOnly || isNew}
              onClick={() => {
                setWizardGroups(defaultWizardGroups());
                setWizardOpen(true);
              }}
            >
              弹性套餐向导
            </Button>
            <Button size="small" disabled={readOnly || isNew} onClick={addConfigGroup}>
              添加配置组
            </Button>
          </Space>
        }
      >
        {isNew && <div style={{ color: '#999' }}>请先保存商品后再编辑配置组。推荐使用「弹性套餐向导」一键生成 CPU / 内存 / 硬盘 / 带宽 / IP 等弹性配置。</div>}
        {!isNew && configGroups.length === 0 && <div style={{ color: '#999' }}>暂无配置组</div>}
        {configGroups.map((g) => (
          <Card key={g.id} size="small" title={g.name} style={{ marginBottom: 12 }}
            extra={
              !readOnly && (
                <Space size={4}>
                  <Button size="small" onClick={() => addOption(g)}>加选项</Button>
                  <Button size="small" onClick={() => saveConfigGroup(g)}>保存组</Button>
                  <Button size="small" danger onClick={() => removeConfigGroup(g)}>删组</Button>
                </Space>
              )
            }
          >
            <Space style={{ marginBottom: 8 }} wrap>
              <Input
                style={{ width: 200 }}
                value={g.name}
                disabled={readOnly}
                onChange={(e) =>
                  setConfigGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))
                }
              />
              <Select
                style={{ width: 120 }}
                value={g.type}
                disabled={readOnly}
                onChange={(v) =>
                  setConfigGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, type: v } : x)))
                }
                options={GROUP_TYPES}
              />
              <span>
                必填
                <Checkbox
                  style={{ marginLeft: 4 }}
                  checked={g.required}
                  disabled={readOnly}
                  onChange={(e) =>
                    setConfigGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, required: e.target.checked } : x)))
                  }
                />
              </span>
            </Space>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {['名称', '值', '价格增量(元)', '开通增量(元)', '默认', '排序', '操作'].map((h) => (
                    <th key={h} style={{ padding: '6px 8px', border: '1px solid #f0f0f0', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(g.options ?? []).map((opt, oi) => (
                  <tr key={opt.id}>
                    <td style={{ padding: '4px 8px', border: '1px solid #f0f0f0' }}>
                      <Input
                        size="small"
                        variant="borderless"
                        value={opt.label}
                        disabled={readOnly}
                        onChange={(e) =>
                          setConfigGroups((prev) =>
                            prev.map((x) =>
                              x.id === g.id
                                ? { ...x, options: (x.options ?? []).map((o) => (o.id === opt.id ? { ...o, label: e.target.value } : o)) }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td style={{ padding: '4px 8px', border: '1px solid #f0f0f0' }}>{opt.value}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #f0f0f0' }}>
                      <InputNumber
                        size="small"
                        style={{ width: 100 }}
                        value={opt.priceDelta / 100}
                        disabled={readOnly}
                        onChange={(v) => void v}
                        onBlur={(e) => {
                          const yuan = Number.parseFloat(e.target.value);
                          void updateOption(g, opt, { priceDelta: yuanToFen(Number.isNaN(yuan) ? 0 : yuan) });
                        }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px', border: '1px solid #f0f0f0' }}>
                      <InputNumber
                        size="small"
                        style={{ width: 100 }}
                        value={opt.setupDelta / 100}
                        disabled={readOnly}
                        onBlur={(e) => {
                          const yuan = Number.parseFloat(e.target.value);
                          void updateOption(g, opt, { setupDelta: yuanToFen(Number.isNaN(yuan) ? 0 : yuan) });
                        }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px', border: '1px solid #f0f0f0', textAlign: 'center' }}>
                      <Checkbox
                        checked={opt.isDefault}
                        disabled={readOnly}
                        onChange={(e) => void updateOption(g, opt, { isDefault: e.target.checked })}
                      />
                    </td>
                    <td style={{ padding: '4px 8px', border: '1px solid #f0f0f0', width: 80, textAlign: 'center' }}>
                      <Button
                        size="small"
                        type="text"
                        icon={<UpOutlined />}
                        disabled={readOnly || oi === 0}
                        onClick={() => void moveOption(g, oi, -1)}
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<DownOutlined />}
                        disabled={readOnly || oi === (g.options ?? []).length - 1}
                        onClick={() => void moveOption(g, oi, 1)}
                      />
                    </td>
                    <td style={{ padding: '4px 8px', border: '1px solid #f0f0f0', width: 60, textAlign: 'center' }}>
                      {!readOnly && (
                        <a style={{ color: '#ff4d4f' }} onClick={() => removeOption(opt)}>删除</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(g.options ?? []).length === 0 && <Tag>暂无选项，点击「加选项」添加</Tag>}
          </Card>
        ))}
      </ProCard>

      <Modal
        title="弹性套餐向导"
        width={880}
        open={wizardOpen}
        onCancel={() => setWizardOpen(false)}
        okText={`生成 ${wizardGroups.filter((g) => g.include).length} 个配置组`}
        okButtonProps={{ loading: wizardSaving }}
        onOk={() => void generateElastic()}
      >
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message="按需勾选配置组；档位加价为每周期增量（元），叠加在周期定价基础价之上； quantity 型按数量 × 单价计费。生成后可继续手动微调。"
        />
        {wizardGroups.map((g, gi) => (
          <Card
            key={g.key}
            size="small"
            style={{ marginBottom: 12, opacity: g.include ? 1 : 0.55 }}
            title={
              <Space>
                <Switch
                  size="small"
                  checked={g.include}
                  onChange={(v) => patchWizard(g.key, { include: v })}
                />
                {g.name}
                <Tag>{g.type === 'quantity' ? '按数量' : '单选'}</Tag>
                {g.required && <Tag color="blue">必选</Tag>}
              </Space>
            }
            extra={
              !readOnly && (
                <Button
                  size="small"
                  onClick={() =>
                    patchWizard(g.key, {
                      tiers: [...g.tiers, { label: '', value: '', deltaYuan: 0, isDefault: false }],
                    })
                  }
                >
                  加档位
                </Button>
              )
            }
          >
            {g.type === 'quantity' ? (
              <Space wrap>
                <span>
                  单价（元/单位/周期）：
                  <InputNumber
                    min={0}
                    precision={2}
                    style={{ width: 110 }}
                    value={g.unitPriceYuan}
                    disabled={readOnly}
                    onChange={(v) => patchWizard(g.key, { unitPriceYuan: v ?? 0 })}
                  />
                </span>
                <span>
                  默认数量：
                  <InputNumber
                    min={0}
                    precision={0}
                    style={{ width: 90 }}
                    value={g.defaultQty}
                    disabled={readOnly}
                    onChange={(v) => patchWizard(g.key, { defaultQty: v ?? 0 })}
                  />
                </span>
              </Space>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    {['档位名称', '值', '加价（元/周期）', '默认', '操作'].map((h) => (
                      <th key={h} style={{ padding: '4px 8px', border: '1px solid #f0f0f0', textAlign: 'left' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.tiers.map((t, ti) => (
                    <tr key={ti}>
                      <td style={{ padding: '2px 6px', border: '1px solid #f0f0f0' }}>
                        <Input
                          size="small"
                          variant="borderless"
                          value={t.label}
                          placeholder="如 4 核"
                          onChange={(e) =>
                            patchWizard(g.key, {
                              tiers: g.tiers.map((x, i) => (i === ti ? { ...x, label: e.target.value } : x)),
                            })
                          }
                        />
                      </td>
                      <td style={{ padding: '2px 6px', border: '1px solid #f0f0f0' }}>
                        <Input
                          size="small"
                          variant="borderless"
                          value={t.value}
                          placeholder="如 4c"
                          onChange={(e) =>
                            patchWizard(g.key, {
                              tiers: g.tiers.map((x, i) => (i === ti ? { ...x, value: e.target.value } : x)),
                            })
                          }
                        />
                      </td>
                      <td style={{ padding: '2px 6px', border: '1px solid #f0f0f0' }}>
                        <InputNumber
                          size="small"
                          min={0}
                          precision={2}
                          style={{ width: 100 }}
                          value={t.deltaYuan}
                          onChange={(v) =>
                            patchWizard(g.key, {
                              tiers: g.tiers.map((x, i) => (i === ti ? { ...x, deltaYuan: v ?? 0 } : x)),
                            })
                          }
                        />
                      </td>
                      <td style={{ padding: '2px 6px', border: '1px solid #f0f0f0', textAlign: 'center' }}>
                        <input
                          type="radio"
                          name={`wiz_${g.key}`}
                          checked={t.isDefault}
                          onChange={() =>
                            patchWizard(g.key, {
                              tiers: g.tiers.map((x, i) => ({ ...x, isDefault: i === ti })),
                            })
                          }
                        />
                      </td>
                      <td style={{ padding: '2px 6px', border: '1px solid #f0f0f0', textAlign: 'center' }}>
                        <a style={{ color: '#ff4d4f' }} onClick={() => patchWizard(g.key, { tiers: g.tiers.filter((_, i) => i !== ti) })}>
                          删除
                        </a>
                      </td>
                    </tr>
                  ))}
                  {g.tiers.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 8, color: '#999' }}>
                        暂无档位，点击「加档位」
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {gi === wizardGroups.length - 1 && null}
          </Card>
        ))}
      </Modal>
    </PageContainer>
  );
};

export default ProductEdit;