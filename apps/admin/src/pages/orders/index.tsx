/**
 * 订单列表页：人工确认收款 / 取消
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Popconfirm, Space } from 'antd';
import { useRef } from 'react';
import type React from 'react';
import { cancelOrder, getOrders, markOrderPaid } from '@/services/admin';
import type { OrderListItem } from '@/services/types';
import { tableRequestAdapter } from '@/utils/table';
import { cny, formatDateTime } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL } from '@/services/enums';

const OrderList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message, modal } = App.useApp();

  const doMarkPaid = async (row: OrderListItem) => {
    modal.confirm({
      title: `人工确认收款`,
      content: `确认订单 #${row.id} 已收到款项（${cny(row.total)}）？确认后订单将标记为已支付并进入开通流程。`,
      okText: '确认收款',
      okType: 'danger',
      onOk: async () => {
        await markOrderPaid(row.id);
        message.success('已确认收款');
        actionRef.current?.reload();
      },
    });
  };

  const doCancel = (row: OrderListItem) => {
    modal.confirm({
      title: '取消订单',
      content: `确认取消订单 #${row.id}？`,
      okText: '取消订单',
      okType: 'danger',
      onOk: async () => {
        await cancelOrder(row.id);
        message.success('订单已取消');
        actionRef.current?.reload();
      },
    });
  };

  const columns: ProColumns<OrderListItem>[] = [
    { title: '订单号', dataIndex: 'id', width: 90, search: false },
    { title: '客户', dataIndex: 'userName', ellipsis: true, search: false },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      valueType: 'select',
      valueEnum: {
        new: { text: '新购' },
        renewal: { text: '续费' },
        upgrade: { text: '升级' },
        recharge: { text: '充值' },
        manual: { text: '人工' },
      },
      render: (_, r) => ORDER_TYPE_LABEL[r.type] ?? r.type,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        pending: { text: '待支付' },
        paid: { text: '已支付' },
        processing: { text: '处理中' },
        completed: { text: '已完成' },
        cancelled: { text: '已取消' },
        failed: { text: '失败' },
      },
      render: (_, r) => <StatusTag status={r.status} label={ORDER_STATUS_LABEL[r.status] ?? r.status} />,
    },
    {
      title: '明细',
      dataIndex: 'items',
      search: false,
      ellipsis: true,
      render: (_, r) => (r.items ?? []).map((it) => it.description).join('；') || '-',
    },
    { title: '优惠码', dataIndex: 'promoCode', width: 110, search: false, render: (_, r) => r.promoCode ?? '-' },
    {
      title: '实付金额',
      dataIndex: 'total',
      align: 'right',
      search: false,
      render: (_, r) => cny(r.total),
    },
    { title: '支付时间', dataIndex: 'paidAt', search: false, render: (_, r) => formatDateTime(r.paidAt) },
    { title: '创建时间', dataIndex: 'createdAt', search: false, render: (_, r) => formatDateTime(r.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      fixed: 'right',
      render: (_, r) => {
        const actions: React.ReactNode[] = [];
        if (access.canOrdersManage && r.status === 'pending') {
          actions.push(
            <a key="mark-paid" style={{ color: '#ff4d4f' }} onClick={() => doMarkPaid(r)}>
              确认收款
            </a>,
            <a key="cancel" onClick={() => doCancel(r)}>
              取消
            </a>,
          );
        }
        return actions.length ? <Space size={8}>{actions}</Space> : '-';
      },
    },
  ];

  return (
    <PageContainer>
      <ProTable<OrderListItem>
        rowKey="id"
        headerTitle="订单列表"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await getOrders({ page: current ?? 1, pageSize: pageSize ?? 20, ...rest });
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
      />
    </PageContainer>
  );
};

export default OrderList;