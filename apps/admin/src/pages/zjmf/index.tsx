/**
 * 魔方财务（zjmf 供应模块）管理页：
 * - 供应商：上游代理账号 CRUD（密码加密落库、不回显）、连通测试、上游余额
 * - 上游商品：同步上游商品（落库 zjmf_upstream_products）与代理价/周期查看、本地映射状态
 * - 主机指派：绑定上游已开通机器给客户（纯绑定）/ 管理员代开（0 元走正常开通）
 */
import { PageContainer } from '@ant-design/pro-components';
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import { useAccess } from '@umijs/max';
import {
  deleteZjmfSupplier,
  getCustomers,
  getZjmfBalance,
  getZjmfHosts,
  getZjmfSuppliers,
  getZjmfUpstreamProducts,
  saveZjmfSupplier,
  syncZjmfProducts,
  testZjmfSupplier,
  zjmfAssign,
} from '@/services/admin';
import type {
  CustomerListItem,
  ZjmfSupplierItem,
  ZjmfUpstreamHostItem,
  ZjmfUpstreamProductItem,
} from '@/services/types';
import { formatCny, formatDate } from '@/utils/format';

const { Text } = Typography;

/** 供应商表单（新增/编辑共用；编辑时 password 留空 = 保留原密码） */
interface SupplierFormValues {
  name: string;
  baseUrl: string;
  username: string;
  password?: string;
  apiTimeoutSec?: number;
  allowSelfSigned?: boolean;
  allowInsecureUrl?: boolean;
}

// ============ 供应商 Tab ============

function SuppliersTab({
  suppliers,
  loading,
  reload,
  onChanged,
}: {
  suppliers: ZjmfSupplierItem[];
  loading: boolean;
  reload: () => void;
  /** 供应商变化后通知兄弟 Tab 刷新下拉 */
  onChanged: () => void;
}) {
  const { message, modal } = App.useApp();
  const access = useAccess() as { canProductsManage?: boolean; canProductsRead?: boolean };
  const [form] = Form.useForm<SupplierFormValues>();
  const [editing, setEditing] = useState<ZjmfSupplierItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ apiTimeoutSec: 30, allowSelfSigned: false, allowInsecureUrl: false });
    setModalOpen(true);
  };

  const openEdit = (item: ZjmfSupplierItem) => {
    setEditing(item);
    form.resetFields();
    form.setFieldsValue({
      name: item.name,
      baseUrl: item.baseUrl,
      username: item.username,
      apiTimeoutSec: item.apiTimeoutSec,
      allowSelfSigned: item.allowSelfSigned,
      allowInsecureUrl: item.allowInsecureUrl,
    });
    setModalOpen(true);
  };

  const doSave = async () => {
    const values = await form.validateFields();
    if (!editing && !values.password) {
      message.error('新供应商必须设置密码');
      return;
    }
    setSaving(true);
    try {
      const code = editing?.code ?? (values.username.toLowerCase().replace(/[^a-z0-9_-]/g, '') || `s${Date.now()}`);
      await saveZjmfSupplier(code, {
        ...values,
        password: values.password || undefined,
      });
      message.success(editing ? '供应商已更新' : '供应商已创建');
      setModalOpen(false);
      reload();
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const doTest = async (item: ZjmfSupplierItem) => {
    message.loading({ content: `正在连接 ${item.name}…`, key: `test-${item.code}`, duration: 0 });
    try {
      const res = await testZjmfSupplier({ code: item.code });
      if (res.ok) message.success({ content: res.message ?? '连接成功', key: `test-${item.code}` });
      else message.error({ content: res.message ?? '连接失败', key: `test-${item.code}` });
    } catch {
      message.error({ content: '连接测试失败', key: `test-${item.code}` });
    }
  };

  const doBalance = async (item: ZjmfSupplierItem) => {
    message.loading({ content: '查询上游余额…', key: `bal-${item.code}`, duration: 0 });
    try {
      const res = await getZjmfBalance(item.code);
      message.success({ content: '查询完成', key: `bal-${item.code}` });
      Modal.info({
        title: `上游余额（${item.name}）`,
        content: `${res.credit} ${res.currency || ''}${
          res.creditCents != null ? `（≈ ${formatCny(res.creditCents)}）` : ''
        }`,
      });
    } catch {
      message.error({ content: '余额查询失败（上游不可达）', key: `bal-${item.code}` });
    }
  };

  const columns = [
    { title: 'Code', dataIndex: 'code', width: 120 },
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '上游地址', dataIndex: 'baseUrl', ellipsis: true },
    { title: 'API 账号', dataIndex: 'username', width: 160 },
    {
      title: '密码',
      dataIndex: 'hasPassword',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="green">已设置</Tag> : <Tag color="red">未设置</Tag>),
    },
    { title: '超时', dataIndex: 'apiTimeoutSec', width: 70, render: (v: number) => `${v}s` },
    {
      title: '操作',
      width: 300,
      render: (_: unknown, record: ZjmfSupplierItem) => (
        <Space size={4} wrap>
          {access.canProductsManage && (
            <a onClick={() => openEdit(record)}>编辑</a>
          )}
          <a onClick={() => doTest(record)}>测试连接</a>
          <a onClick={() => doBalance(record)}>余额</a>
          {access.canProductsManage && (
            <Popconfirm
              title={`确认删除供应商「${record.name}」？已映射商品将无法开通`}
              onConfirm={async () => {
                await deleteZjmfSupplier(record.code);
                message.success('已删除');
                reload();
                onChanged();
              }}
            >
              <a style={{ color: '#ff4d4f' }}>删除</a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" disabled={!access.canProductsManage} onClick={openCreate}>
          新增供应商
        </Button>
        <Text type="secondary" style={{ marginLeft: 12 }}>
          供应商 = 魔方财务上游站点的代理商 API 账号；密码加密存储、不回显。商品在商品编辑页选择供应商与上游商品完成映射。
        </Text>
      </div>
      <Table rowKey="code" loading={loading} columns={columns} dataSource={suppliers} pagination={false} />
      <Modal
        title={editing ? `编辑供应商：${editing.name}` : '新增供应商'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={doSave}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={50} placeholder="如：主上游" />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="上游地址"
            rules={[
              { required: true, message: '请输入上游地址' },
              { pattern: /^https?:\/\//i, message: '需以 http(s):// 开头' },
            ]}
            extra="必须 https；内网 http 需勾选下方明文放行"
          >
            <Input placeholder="https://upstream.example.com" />
          </Form.Item>
          <Form.Item name="username" label="API 账号" rules={[{ required: true, message: '请输入代理商 API 账号' }]}>
            <Input disabled={!!editing} placeholder="代理商客户用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="API 密码"
            rules={editing ? [] : [{ required: true, message: '请输入 API 密码' }]}
            extra={editing ? '留空表示保留原密码' : undefined}
          >
            <Input.Password placeholder={editing ? '留空保留原密码' : 'API 密码'} />
          </Form.Item>
          <Form.Item name="apiTimeoutSec" label="请求超时（秒）">
            <InputNumber min={1} max={120} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="allowSelfSigned" label="忽略自签证书" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="allowInsecureUrl" label="允许明文 http（仅内网联调）" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

// ============ 上游商品 Tab ============

function UpstreamProductsTab({ suppliers }: { suppliers: ZjmfSupplierItem[] }) {
  const { message, modal } = App.useApp();
  const access = useAccess() as { canProductsManage?: boolean };
  const [code, setCode] = useState<string>();
  const [items, setItems] = useState<ZjmfUpstreamProductItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async (supplierCode?: string) => {
    if (!supplierCode) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const res = await getZjmfUpstreamProducts(supplierCode);
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(code);
  }, [code, load]);

  const doSync = async () => {
    if (!code) return;
    setSyncing(true);
    message.loading({ content: '正在同步上游商品（商品多时较慢）…', key: 'zjmf-sync', duration: 0 });
    try {
      const res = await syncZjmfProducts(code);
      message.success({
        content: `同步完成：更新 ${res.updated} 个${res.failed ? `，失败 ${res.failed} 个` : ''}${
          res.detailsSkipped ? `，${res.detailsSkipped} 个仅取列表价` : ''
        }${res.skippedOverLimit ? `，${res.skippedOverLimit} 个超单次上限（再次同步续传）` : ''}`,
        key: 'zjmf-sync',
      });
      await load(code);
    } catch {
      message.error({ content: '同步失败（上游不可达或凭据错误）', key: 'zjmf-sync' });
    } finally {
      setSyncing(false);
    }
  };

  const columns = [
    { title: '上游 ID', dataIndex: 'upProductId', width: 90 },
    { title: '商品名', dataIndex: 'name', ellipsis: true },
    {
      title: '代理价',
      dataIndex: 'agentPriceCents',
      width: 110,
      render: (v: number) => formatCny(v),
    },
    {
      title: '周期价格',
      dataIndex: 'cycles',
      render: (_: unknown, record: ZjmfUpstreamProductItem) => (
        <Space size={4} wrap>
          {(record.cycles ?? []).map((c) => (
            <Tag key={c.upCycle}>
              {c.name || c.cycle} {formatCny(c.agentPriceCents)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '本地映射',
      dataIndex: 'mappedProduct',
      width: 200,
      render: (_: unknown, record: ZjmfUpstreamProductItem) =>
        record.mappedProduct ? (
          <Tag color="green">#{record.mappedProduct.id} {record.mappedProduct.name}</Tag>
        ) : (
          <Tag color="orange">未映射（去商品列表创建）</Tag>
        ),
    },
    { title: '同步时间', dataIndex: 'syncedAt', width: 110, render: (v: string) => formatDate(v) },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 240 }}
          placeholder="选择供应商"
          value={code}
          onChange={(v) => setCode(v)}
          options={suppliers.map((s) => ({ value: s.code, label: `${s.name}（${s.code}）` }))}
        />
        <Button type="primary" disabled={!code || !access.canProductsManage} loading={syncing} onClick={doSync}>
          同步上游商品
        </Button>
        <Button disabled={!code} onClick={() => void load(code)}>
          刷新
        </Button>
      </Space>
      <Table rowKey="upProductId" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 20 }} />
      <Text type="secondary">
        同步仅落库上游商品与代理价供映射选择；向客户收取的价格始终由商品编辑页的「周期定价」决定。
      </Text>
    </>
  );
}

// ============ 主机指派 Tab ============

const HOST_STATUS_TAG: Record<string, { color: string; text: string }> = {
  active: { color: 'green', text: '运行中' },
  pending: { color: 'blue', text: '待开通' },
  suspend: { color: 'orange', text: '已暂停' },
  terminated: { color: 'red', text: '已终止' },
  unknown: { color: 'default', text: '未知' },
};

/** 用户选择器：关键字搜索 → 下拉选择 */
function UserSelect({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  const [keyword, setKeyword] = useState('');
  const [options, setOptions] = useState<CustomerListItem[]>([]);
  const [searching, setSearching] = useState(false);

  const doSearch = async () => {
    setSearching(true);
    try {
      const res = await getCustomers({ page: 1, pageSize: 10, keyword: keyword || undefined });
      setOptions(res.items);
    } finally {
      setSearching(false);
    }
  };

  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        placeholder="手机号 / 邮箱 / ID"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onPressEnter={doSearch}
      />
      <Button onClick={doSearch} loading={searching}>
        搜索
      </Button>
      <Select
        style={{ minWidth: 220 }}
        placeholder="选择客户"
        value={value}
        onChange={onChange}
        showSearch
        optionFilterProp="label"
        options={options.map((u) => ({
          value: u.id,
          label: `#${u.id} ${u.email ?? u.phone ?? ''}`,
        }))}
      />
    </Space.Compact>
  );
}

function AssignTab({ suppliers }: { suppliers: ZjmfSupplierItem[] }) {
  const { message, modal } = App.useApp();
  const access = useAccess() as { canServicesManage?: boolean };
  const [mode, setMode] = useState<'bind' | 'open'>('bind');
  const [code, setCode] = useState<string>();
  const [hosts, setHosts] = useState<ZjmfUpstreamHostItem[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [bindProductId, setBindProductId] = useState<number>();
  const [bindUserId, setBindUserId] = useState<number>();
  const [products, setProducts] = useState<ZjmfUpstreamProductItem[]>([]);
  const [openUpProductId, setOpenUpProductId] = useState<number>();
  const [openUserId, setOpenUserId] = useState<number>();
  const [submitting, setSubmitting] = useState(false);

  /** 切换供应商后加载已同步商品（代开用） */
  useEffect(() => {
    if (!code) {
      setProducts([]);
      return;
    }
    getZjmfUpstreamProducts(code)
      .then((res) => setProducts(res.items))
      .catch(() => setProducts([]));
  }, [code]);

  const loadHosts = async () => {
    if (!code) return;
    setHostsLoading(true);
    try {
      const res = await getZjmfHosts(code);
      setHosts(res.items);
    } finally {
      setHostsLoading(false);
    }
  };

  /** bind：先选一个本地映射商品（指定挂靠定价），再选用户 */
  const doBindOne = (host: ZjmfUpstreamHostItem) => {
    if (!bindProductId || !bindUserId) {
      message.warning('请先选择挂靠商品与目标客户');
      return;
    }
    modal.confirm({
      title: `指派上游主机 #${host.upHostId}`,
      content: `将把该机器本地绑定给客户 #${bindUserId}（不调上游，纯绑定），挂靠商品「#${bindProductId}」定价生成续费账单。确认？`,
      onOk: async () => {
        setSubmitting(true);
        try {
          const res = await zjmfAssign({ mode: 'bind', code: code!, upHostId: host.upHostId, userId: bindUserId, productId: bindProductId });
          message.success(res.message);
          await loadHosts();
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const doOpen = () => {
    if (!openUpProductId || !openUserId) {
      message.warning('请选择上游商品与目标客户');
      return;
    }
    modal.confirm({
      title: '管理员代开',
      content: '将按 0 元为客户创建服务并执行正常开通任务（上游以代理账户余额支付）。确认？',
      onOk: async () => {
        setSubmitting(true);
        try {
          const res = await zjmfAssign({ mode: 'open', code: code!, upProductId: openUpProductId, userId: openUserId });
          message.success(res.message);
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const hostColumns = [
    { title: '上游 ID', dataIndex: 'upHostId', width: 90 },
    { title: '标识', dataIndex: 'name', ellipsis: true },
    { title: '产品', dataIndex: 'productName', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => <Tag color={HOST_STATUS_TAG[v]?.color}>{HOST_STATUS_TAG[v]?.text ?? v}</Tag>,
    },
    { title: 'IP', dataIndex: 'ip', width: 130 },
    { title: '到期', dataIndex: 'expireAt', width: 110, render: (v?: string) => (v ? formatDate(v) : '-') },
    {
      title: '绑定状态',
      dataIndex: 'assigned',
      width: 100,
      render: (v: boolean) => (v ? <Tag color="blue">已指派</Tag> : <Tag color="green">未指派</Tag>),
    },
    {
      title: '操作',
      width: 100,
      render: (_: unknown, record: ZjmfUpstreamHostItem) =>
        record.assigned ? '-' : access.canServicesManage ? (
          <a onClick={() => doBindOne(record)}>指派</a>
        ) : (
          <span style={{ color: '#999' }}>无权限</span>
        ),
    },
  ];

  const mappedProducts = products.filter((p) => p.mappedProduct);

  return (
    <>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space wrap>
          <Select
            style={{ width: 240 }}
            placeholder="选择供应商"
            value={code}
            onChange={(v) => {
              setCode(v);
              setHosts([]);
            }}
            options={suppliers.map((s) => ({ value: s.code, label: `${s.name}（${s.code}）` }))}
          />
          <Select
            style={{ width: 180 }}
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: 'bind', label: '绑定已开通机器' },
              { value: 'open', label: '管理员代开（0 元）' },
            ]}
          />
        </Space>

        {mode === 'bind' ? (
          <>
            <Space wrap>
              <Button onClick={loadHosts} loading={hostsLoading} disabled={!code}>
                加载已开通主机
              </Button>
              <Text type="secondary">指派为本地绑定操作，不会在上游重复开通；到期日取上游，本地按期生成续费账单并同步上游。</Text>
            </Space>
            <Space wrap style={{ marginBottom: 4 }}>
              <Text>挂靠商品：</Text>
              <Select
                style={{ width: 260 }}
                placeholder="选择本地 zjmf 商品（定价依据）"
                value={bindProductId}
                onChange={setBindProductId}
                options={products
                  .filter((p) => p.mappedProduct)
                  .map((p) => ({ value: p.mappedProduct!.id, label: `#${p.mappedProduct!.id} ${p.mappedProduct!.name}` }))}
              />
              <Text>目标客户：</Text>
              <UserSelect value={bindUserId} onChange={setBindUserId} />
            </Space>
            <Table
              rowKey="upHostId"
              loading={hostsLoading}
              columns={hostColumns}
              dataSource={hosts}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Text>上游商品（需已同步且有本地映射）：</Text>
              <Select
                style={{ width: 320 }}
                placeholder="选择上游商品"
                value={openUpProductId}
                onChange={setOpenUpProductId}
                options={mappedProducts.map((p) => ({
                  value: p.upProductId,
                  label: `#${p.upProductId} ${p.name} → 本地#${p.mappedProduct!.id}（${formatCny(p.agentPriceCents)}）`,
                }))}
              />
            </Space>
            <Space wrap>
              <Text>目标客户：</Text>
              <UserSelect value={openUserId} onChange={setOpenUserId} />
              <Button type="primary" loading={submitting} disabled={!access.canServicesManage} onClick={doOpen}>
                提交代开
              </Button>
            </Space>
            <Text type="secondary">
              代开 = 0 元创建服务 + 正常供应任务；开通时上游以代理商账户余额支付，请保证上游余额充足。没有本地映射的上游商品请先在商品列表创建。
            </Text>
          </Space>
        )}
      </Space>
    </>
  );
}

// ============ 页面容器 ============

export default function ZjmfPage() {
  const [suppliers, setSuppliers] = useState<ZjmfSupplierItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getZjmfSuppliers();
      setSuppliers(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <PageContainer title="魔方财务" subTitle="上游供应商 / 商品同步 / 主机指派">
      <Tabs
        items={[
          {
            key: 'suppliers',
            label: '供应商',
            children: <SuppliersTab suppliers={suppliers} loading={loading} reload={reload} onChanged={() => void reload()} />,
          },
          { key: 'products', label: '上游商品', children: <UpstreamProductsTab suppliers={suppliers} /> },
          { key: 'assign', label: '主机指派', children: <AssignTab suppliers={suppliers} /> },
        ]}
      />
    </PageContainer>
  );
}
