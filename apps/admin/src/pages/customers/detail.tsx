/**
 * 客户详情页：资料 / 服务 / 订单 / 账单 / 余额流水
 */
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { useAccess, useParams } from '@umijs/max';
import { Alert, App, Button, Card, Descriptions, Input, Modal, Popconfirm, Space, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';
import {
  adjustCustomerCredit,
  getCustomerDetail,
  setCustomerStatus,
} from '@/services/admin';
import type {
  CustomerDetail,
  CreditLedgerItem,
  InvoiceListItem,
  OrderListItem,
  ServiceListItem,
} from '@/services/types';
import { cny, formatDateTime, yuanToFen } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { INVOICE_STATUS_LABEL, LEDGER_TYPE_LABEL, ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, SERVICE_STATUS_LABEL, USER_STATUS_LABEL } from '@/services/enums';

const CustomerDetailPage: React.FC = () => {
  const params = useParams<{ id: string }>();
  const access = useAccess();
  const { message } = App.useApp();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditForm, setCreditForm] = useState<{ amount: string; remark: string }>({ amount: '', remark: '' });

  const load = () => {
    setLoading(true);
    getCustomerDetail(Number(params.id))
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, [params.id]);

  if (loading && !detail) {
    return (
      <PageContainer>
        <Card loading />
      </PageContainer>
    );
  }
  if (!detail) {
    return (
      <PageContainer>
        <Alert type="error" message="客户不存在或加载失败" />
      </PageContainer>
    );
  }

  const disabled = detail.status === 'disabled';

  const doSetStatus = async (status: 'active' | 'disabled') => {
    await setCustomerStatus(detail.id, status);
    message.success(status === 'disabled' ? '已禁用' : '已启用');
    load();
  };

  const doAdjustCredit = async () => {
    if (!creditForm.amount || !creditForm.remark) {
      message.warning('请填写调整金额与备注');
      return;
    }
    const fen = yuanToFen(creditForm.amount);
    if (fen === 0) {
      message.warning('金额不能为 0');
      return;
    }
    await adjustCustomerCredit({ userId: detail.id, amount: fen, remark: creditForm.remark });
    message.success('余额调整成功');
    setCreditOpen(false);
    setCreditForm({ amount: '', remark: '' });
    load();
  };

  // ============ 子表列 ============

  const serviceCols: ColumnsType<ServiceListItem> = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '服务名', dataIndex: 'name', ellipsis: true },
    { title: '商品', dataIndex: 'productName', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, r) => <StatusTag status={r.status} label={SERVICE_STATUS_LABEL[r.status] ?? r.status} />,
    },
    { title: '周期', dataIndex: 'cycle', width: 90 },
    {
      title: '续费金额',
      dataIndex: 'renewalAmount',
      align: 'right',
      render: (_, r) => cny(r.renewalAmount),
    },
    { title: '到期日', dataIndex: 'nextDueDate', render: (_, r) => formatDateTime(r.nextDueDate) },
    { title: '创建时间', dataIndex: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
  ];

  const orderCols: ColumnsType<OrderListItem> = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (_, r) => ORDER_TYPE_LABEL[r.type] ?? r.type,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, r) => <StatusTag status={r.status} label={ORDER_STATUS_LABEL[r.status] ?? r.status} />,
    },
    {
      title: '实付金额',
      dataIndex: 'total',
      align: 'right',
      render: (_, r) => cny(r.total),
    },
    { title: '支付时间', dataIndex: 'paidAt', render: (_, r) => formatDateTime(r.paidAt) },
    { title: '创建时间', dataIndex: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
  ];

  const invoiceCols: ColumnsType<InvoiceListItem> = [
    { title: '账单号', dataIndex: 'invoiceNo', width: 140 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (_, r) => ORDER_TYPE_LABEL[r.type] ?? r.type,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, r) => <StatusTag status={r.status} label={INVOICE_STATUS_LABEL[r.status] ?? r.status} />,
    },
    {
      title: '金额',
      dataIndex: 'total',
      align: 'right',
      render: (_, r) => cny(r.total),
    },
    { title: '到期日', dataIndex: 'dueAt', render: (_, r) => formatDateTime(r.dueAt) },
    { title: '支付时间', dataIndex: 'paidAt', render: (_, r) => formatDateTime(r.paidAt) },
    { title: '创建时间', dataIndex: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
  ];

  const ledgerCols: ColumnsType<CreditLedgerItem> = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (_, r) => LEDGER_TYPE_LABEL[r.type] ?? r.type,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      align: 'right',
      render: (_, r) => (
        <span style={{ color: r.amount >= 0 ? '#52c41a' : '#ff4d4f' }}>{cny(r.amount)}</span>
      ),
    },
    { title: '变动后余额', dataIndex: 'balanceAfter', align: 'right', render: (_, r) => cny(r.balanceAfter) },
    { title: '备注', dataIndex: 'remark', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageContainer
      title={`客户详情 #${detail.id}`}
      extra={
        <Space>
          {access.canCustomersManage && (
            <Popconfirm
              title={disabled ? '确认启用该客户？' : '确认禁用该客户？禁用后无法登录。'}
              onConfirm={() => doSetStatus(disabled ? 'active' : 'disabled')}
            >
              <Button danger={!disabled}>{disabled ? '启用' : '禁用'}</Button>
            </Popconfirm>
          )}
          {access.canCustomersCredit && (
            <Button type="primary" danger onClick={() => setCreditOpen(true)}>
              余额调整
            </Button>
          )}
        </Space>
      }
    >
      <ProCard>
        <Descriptions
          column={3}
          size="middle"
          items={[
            { label: 'ID', children: detail.id },
            { label: '姓名', children: detail.name ?? '-' },
            { label: '手机号', children: detail.phone ?? '-' },
            { label: '邮箱', children: detail.email ?? '-' },
            {
              label: '余额',
              children: <Tag color={detail.creditBalance >= 0 ? 'green' : 'red'}>{cny(detail.creditBalance)}</Tag>,
            },
            {
              label: '状态',
              children: <StatusTag status={detail.status} label={USER_STATUS_LABEL[detail.status] ?? detail.status} />,
            },
            { label: '最后登录', children: formatDateTime(detail.lastLoginAt) },
            { label: '注册时间', children: formatDateTime(detail.createdAt) },
          ]}
        />
      </ProCard>

      <Card style={{ marginTop: 16 }}>
        <Tabs
          items={[
            { key: 'services', label: '服务', children: <Table rowKey="id" size="small" columns={serviceCols} dataSource={detail.services} pagination={false} /> },
            { key: 'orders', label: '订单', children: <Table rowKey="id" size="small" columns={orderCols} dataSource={detail.orders} pagination={false} /> },
            { key: 'invoices', label: '账单', children: <Table rowKey="id" size="small" columns={invoiceCols} dataSource={detail.invoices} pagination={false} /> },
            { key: 'ledger', label: '余额流水', children: <Table rowKey="id" size="small" columns={ledgerCols} dataSource={detail.ledger} pagination={false} /> },
          ]}
        />
      </Card>

      <Modal
        title="余额调整"
        open={creditOpen}
        onOk={doAdjustCredit}
        okText="确认调整"
        okButtonProps={{ danger: true }}
        onCancel={() => setCreditOpen(false)}
      >
        <Alert
          type="warning"
          showIcon
          message="该操作直接变更客户余额并记录流水，请谨慎操作"
          style={{ marginBottom: 16 }}
        />
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            prefix="¥"
            placeholder="调整金额，正数为充值、负数为扣减，如 50 或 -20"
            value={creditForm.amount}
            onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })}
          />
          <Input.TextArea
            placeholder="调整备注（必填）"
            rows={2}
            value={creditForm.remark}
            onChange={(e) => setCreditForm({ ...creditForm, remark: e.target.value })}
          />
        </Space>
      </Modal>
    </PageContainer>
  );
};

export default CustomerDetailPage;