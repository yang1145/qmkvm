/**
 * 账单管理：列表 + 手工开单 + 作废
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Input, InputNumber, Modal, Space, Typography } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import { createInvoice, getInvoices, voidInvoice, EXPORT_PATHS } from '@/services/admin';
import { DownloadOutlined } from '@ant-design/icons';
import type { InvoiceListItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { cny, formatDateTime, yuanToFen } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { INVOICE_STATUS_LABEL } from '@/services/enums';

type DraftItem = { description: string; qty: number; unitPriceYuan: number };

const InvoiceList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message, modal } = App.useApp();
  // 记录最近一次表格查询参数，供导出 CSV 复用筛选条件
  const lastParams = useRef<Record<string, unknown>>({});

  const doExportCsv = () => {
    const p = lastParams.current;
    const qs = new URLSearchParams();
    if (p.status) qs.set('status', String(p.status));
    if (p.type) qs.set('type', String(p.type));
    window.open(`${EXPORT_PATHS.invoices}?${qs.toString()}`, '_blank');
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<{ userId: string; note: string; items: DraftItem[] }>({
    userId: '',
    note: '',
    items: [{ description: '', qty: 1, unitPriceYuan: 0 }],
  });
  const [voidTarget, setVoidTarget] = useState<InvoiceListItem | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const doCreate = async () => {
    const userId = Number(createForm.userId);
    if (!userId || Number.isNaN(userId)) {
      message.warning('请填写客户 ID');
      return;
    }
    const items = createForm.items
      .filter((it) => it.description.trim())
      .map((it) => ({ description: it.description.trim(), qty: it.qty || 1, unitPrice: yuanToFen(it.unitPriceYuan) }));
    if (!items.length) {
      message.warning('请至少填写一条账单明细');
      return;
    }
    await createInvoice({ userId, items, note: createForm.note || undefined });
    message.success('账单已创建');
    setCreateOpen(false);
    setCreateForm({ userId: '', note: '', items: [{ description: '', qty: 1, unitPriceYuan: 0 }] });
    actionRef.current?.reload();
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      message.warning('请填写作废原因');
      return;
    }
    await voidInvoice(voidTarget.id, voidReason.trim());
    message.success('账单已作废');
    setVoidTarget(null);
    setVoidReason('');
    actionRef.current?.reload();
  };

  const columns: ProColumns<InvoiceListItem>[] = [
    { title: '账单号', dataIndex: 'invoiceNo', width: 140, search: false },
    { title: '客户', dataIndex: 'userName', ellipsis: true, search: false },
    { title: '客户 ID', dataIndex: 'userId', width: 90, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueType: 'select',
      valueEnum: {
        unpaid: { text: '未支付' },
        paid: { text: '已支付' },
        void: { text: '已作废' },
        refunded: { text: '已退款' },
        partially_refunded: { text: '部分退款' },
      },
      render: (_, r) => <StatusTag status={r.status} label={INVOICE_STATUS_LABEL[r.status] ?? r.status} />,
    },
    {
      title: '明细',
      dataIndex: 'items',
      search: false,
      ellipsis: true,
      render: (_, r) => (r.items ?? []).map((it) => `${it.description}×${it.qty}`).join('；') || '-',
    },
    { title: '优惠', dataIndex: 'discount', align: 'right', search: false, render: (_, r) => cny(r.discount) },
    { title: '金额', dataIndex: 'total', align: 'right', search: false, render: (_, r) => cny(r.total) },
    { title: '到期日', dataIndex: 'dueAt', search: false, render: (_, r) => formatDateTime(r.dueAt) },
    { title: '支付时间', dataIndex: 'paidAt', search: false, render: (_, r) => formatDateTime(r.paidAt) },
    { title: '创建时间', dataIndex: 'createdAt', search: false, render: (_, r) => formatDateTime(r.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 90,
      fixed: 'right',
      render: (_, r) =>
        access.canInvoicesManage && r.status === 'unpaid' ? (
          <a
            style={{ color: '#ff4d4f' }}
            onClick={() => {
              setVoidTarget(r);
              setVoidReason('');
            }}
          >
            作废
          </a>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<InvoiceListItem>
        rowKey="id"
        headerTitle="账单管理"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        request={async (params) => {
          lastParams.current = params;
          const res = await getInvoices(toQuery(params));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        toolBarRender={() => [
          <Button key="export-csv" icon={<DownloadOutlined />} onClick={doExportCsv}>
            导出 CSV
          </Button>,
          access.canInvoicesManage && (
            <Button
              key="create"
              type="primary"
              onClick={() => {
                setCreateForm({ userId: '', note: '', items: [{ description: '', qty: 1, unitPriceYuan: 0 }] });
                setCreateOpen(true);
              }}
            >
              手工开单
            </Button>
          ),
        ].filter(Boolean)}
      />

      {/* 手工开单 */}
      <Modal
        title="手工开单"
        open={createOpen}
        onOk={doCreate}
        okText="创建账单"
        width={720}
        onCancel={() => setCreateOpen(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            客户 ID：
            <InputNumber
              min={1}
              precision={0}
              style={{ width: 200 }}
              value={createForm.userId ? Number(createForm.userId) : undefined}
              onChange={(v) => setCreateForm({ ...createForm, userId: v ? String(v) : '' })}
              placeholder="客户用户 ID"
            />
          </div>
          <div>
            <Typography.Text strong>账单明细</Typography.Text>
            <div style={{ marginTop: 8 }}>
              {createForm.items.map((it, idx) => (
                <Space key={idx} style={{ display: 'flex', marginBottom: 8 }} wrap>
                  <Input
                    style={{ width: 280 }}
                    placeholder="项目描述"
                    value={it.description}
                    onChange={(e) => {
                      const items = [...createForm.items];
                      items[idx] = { ...it, description: e.target.value };
                      setCreateForm({ ...createForm, items });
                    }}
                  />
                  <InputNumber
                    min={1}
                    precision={0}
                    style={{ width: 90 }}
                    value={it.qty}
                    onChange={(v) => {
                      const items = [...createForm.items];
                      items[idx] = { ...it, qty: v ?? 1 };
                      setCreateForm({ ...createForm, items });
                    }}
                    addonAfter="件"
                  />
                  <InputNumber
                    min={0}
                    precision={2}
                    style={{ width: 140 }}
                    value={it.unitPriceYuan}
                    onChange={(v) => {
                      const items = [...createForm.items];
                      items[idx] = { ...it, unitPriceYuan: v ?? 0 };
                      setCreateForm({ ...createForm, items });
                    }}
                    addonBefore="¥"
                    placeholder="单价"
                  />
                  {createForm.items.length > 1 && (
                    <Button
                      danger
                      onClick={() =>
                        setCreateForm({ ...createForm, items: createForm.items.filter((_, i) => i !== idx) })
                      }
                    >
                      删除
                    </Button>
                  )}
                </Space>
              ))}
              <Button
                type="dashed"
                onClick={() =>
                  setCreateForm({
                    ...createForm,
                    items: [...createForm.items, { description: '', qty: 1, unitPriceYuan: 0 }],
                  })
                }
              >
                添加明细
              </Button>
            </div>
          </div>
          <Input.TextArea
            rows={2}
            placeholder="备注（可选）"
            value={createForm.note}
            onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })}
          />
        </Space>
      </Modal>

      {/* 作废确认 */}
      <Modal
        title={`作废账单 ${voidTarget?.invoiceNo ?? ''}`}
        open={!!voidTarget}
        onOk={doVoid}
        okText="确认作废"
        okButtonProps={{ danger: true }}
        onCancel={() => setVoidTarget(null)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>作废后账单不可恢复，客户将无法支付该账单。</div>
          <Input.TextArea
            rows={3}
            placeholder="作废原因（必填）"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
        </Space>
      </Modal>
    </PageContainer>
  );
};

export default InvoiceList;