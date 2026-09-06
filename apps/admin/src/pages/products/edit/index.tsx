/**
 * 商品编辑页：基本信息 + 周期定价 + 可配置选项组编辑器
 * 路由 /products/:id/edit，id=0 表示新建
 */
import { history, useParams } from '@umijs/max';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Card, Checkbox, Divider, Input, InputNumber, Modal, Select, Space, Spin, Tag } from 'antd';
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
  updateConfigGroup,
  updateConfigOption,
  updateProduct,
} from '@/services/admin';
import type { ConfigGroup, ConfigOption, ProductGroupItem, ProductPricing } from '@/services/types';
import { yuanToFen } from '@/utils/format';
import { BILLING_CYCLE, BILLING_CYCLE_LABEL } from '@/services/enums';

const GROUP_TYPES = [
  { value: 'select', label: '下拉选择' },
  { value: 'radio', label: '单选' },
  { value: 'checkbox', label: '多选' },
  { value: 'quantity', label: '数量' },
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
    moduleCode: 'manual',
    groupId: undefined as number | undefined,
    stockEnabled: false,
    stockTotal: 0,
    status: 'active' as 'active' | 'inactive',
    hidden: false,
    sortOrder: 0,
  });
  const [pricing, setPricing] = useState<PricingDraft[]>([]);
  const [configGroups, setConfigGroups] = useState<ConfigGroup[]>([]);

  useEffect(() => {
    getProductGroups().then(setGroups).catch(() => {});
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
          moduleCode: p.moduleCode,
          groupId: p.groupId,
          stockEnabled: p.stockTotal !== null,
          stockTotal: p.stockTotal ?? 0,
          status: p.status,
          hidden: p.hidden,
          sortOrder: p.sortOrder,
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
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [idNum, isNew]);

  const doSaveBase = async () => {
    if (!base.name.trim() || !base.slug.trim()) {
      message.warning('商品名称与 slug 不能为空');
      return;
    }
    if (!base.groupId) {
      message.warning('请选择商品分组');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: base.name.trim(),
        slug: base.slug.trim(),
        tagline: base.tagline || null,
        moduleCode: base.moduleCode,
        groupId: base.groupId,
        stockTotal: base.stockEnabled ? base.stockTotal : null,
        status: base.status,
        hidden: base.hidden,
        sortOrder: base.sortOrder,
        pricing: pricing.map((c) => ({
          cycle: c.cycle,
          firstPrice: yuanToFen(c.firstPriceYuan),
          renewalPrice: yuanToFen(c.renewalPriceYuan),
          setupFee: yuanToFen(c.setupFeeYuan),
        })),
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

  // ============ 配置组操作 ============

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
            <Input
              style={{ width: '70%' }}
              value={base.moduleCode}
              disabled={readOnly}
              onChange={(e) => setBase({ ...base, moduleCode: e.target.value })}
              placeholder="如 manual / vps"
            />
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
          <Button size="small" disabled={readOnly || isNew} onClick={addConfigGroup}>
            添加配置组
          </Button>
        }
      >
        {isNew && <div style={{ color: '#999' }}>请先保存商品后再编辑配置组。</div>}
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
    </PageContainer>
  );
};

export default ProductEdit;