/**
 * 退款管理：列表 + 发起退款
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Input, InputNumber, Modal, Space } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import { createRefund, getRefunds } from '@/services/admin';
import type { RefundItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { cny, formatDateTime, yuanToFen } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { REFUND_STATUS_LABEL } from '@/services/enums';

const RefundList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ transactionId: string; amountYuan: string; reason: string }>({
    transactionId: '',
    amountYuan: '',
    reason: '',
  });

  const doCreate = async () => {
    const transactionId = Number(form.transactionId);
    if (!transactionId || Number.isNaN(transactionId)) {
      message.warning('请填写交易 ID');
      return;
    }
    const amount = yuanToFen(form.amountYuan);
    if (!amount) {
      message.warning('请填写退款金额');
      return;
    }
    if (!form.reason.trim()) {
      message.warning('请填写退款原因');
      return;
    }
    await createRefund({ transactionId, amount, reason: form.reason.trim() });
    message.success('退款已发起');
    setOpen(false);
    setForm({ transactionId: '', amountYuan: '', reason: '' });
    actionRef.current?.reload();
  };

  const columns: ProColumns<RefundItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '交易 ID', dataIndex: 'transactionId', width: 100, search: false },
    { title: '账单 ID', dataIndex: 'invoiceId', width: 100, search: false, render: (_, r) => r.invoiceId ?? '-' },
    {
      title: '退款金额',
      dataIndex: 'amount',
      align: 'right',
      search: false,
      render: (_, r) => cny(r.amount),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        pending: { text: '处理中' },
        succeeded: { text: '成功' },
        failed: { text: '失败' },
      },
      render: (_, r) => <StatusTag status={r.status} label={REFUND_STATUS_LABEL[r.status] ?? r.status} />,
    },
    { title: '退款原因', dataIndex: 'reason', ellipsis: true, search: false, render: (_, r) => r.reason ?? '-' },
    { title: '网关退款号', dataIndex: 'gatewayRefundId', width: 180, ellipsis: true, search: false, render: (_, r) => r.gatewayRefundId ?? '-' },
    { title: '操作人 ID', dataIndex: 'adminId', width: 100, search: false, render: (_, r) => r.adminId ?? '系统' },
    { title: '创建时间', dataIndex: 'createdAt', search: false, render: (_, r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageContainer>
      <ProTable<RefundItem>
        rowKey="id"
        headerTitle="退款管理"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        search={false}
        request={async (params) => {
          const res = await getRefunds(toQuery(params));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        toolBarRender={() => [
          access.canRefundsManage && (
            <Button
              key="create"
              type="primary"
              danger
              onClick={() => {
                setForm({ transactionId: '', amountYuan: '', reason: '' });
                setOpen(true);
              }}
            >
              发起退款
            </Button>
          ),
        ].filter(Boolean)}
      />

      <Modal
        title="发起退款"
        open={open}
        onOk={doCreate}
        okText="确认退款"
        okButtonProps={{ danger: true }}
        onCancel={() => setOpen(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>发起后资金将通过原路退回客户，请确认交易信息无误。</div>
          <div>
            交易 ID：
            <InputNumber
              min={1}
              precision={0}
              style={{ width: 200 }}
              value={form.transactionId ? Number(form.transactionId) : undefined}
              onChange={(v) => setForm({ ...form, transactionId: v ? String(v) : '' })}
              placeholder="原支付交易 ID"
            />
          </div>
          <div>
            退款金额（元）：
            <InputNumber
              min={0.01}
              precision={2}
              style={{ width: 200 }}
              value={form.amountYuan ? Number(form.amountYuan) : undefined}
              onChange={(v) => setForm({ ...form, amountYuan: v ? String(v) : '' })}
              placeholder="0.00"
            />
          </div>
          <Input.TextArea
            rows={3}
            placeholder="退款原因（必填）"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </Space>
      </Modal>
    </PageContainer>
  );
};

export default RefundList;