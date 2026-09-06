/**
 * 交易流水列表（只读）
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import React from 'react';
import { getTransactions } from '@/services/admin';
import type { TransactionItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { cny, formatDateTime } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { TRANSACTION_STATUS_LABEL, TRANSACTION_TYPE_LABEL } from '@/services/enums';

const TransactionList: React.FC = () => {
  const columns: ProColumns<TransactionItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '客户 ID', dataIndex: 'userId', width: 90, search: false },
    { title: '账单 ID', dataIndex: 'invoiceId', width: 90, search: false },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      valueType: 'select',
      valueEnum: {
        payment: { text: '支付' },
        refund: { text: '退款' },
      },
      render: (_, r) => TRANSACTION_TYPE_LABEL[r.type] ?? r.type,
    },
    { title: '支付网关', dataIndex: 'gatewayCode', width: 100, search: false },
    { title: '网关流水号', dataIndex: 'gatewayTxnId', width: 180, ellipsis: true, search: false },
    {
      title: '金额',
      dataIndex: 'amount',
      align: 'right',
      search: false,
      render: (_, r) => cny(r.amount),
    },
    { title: '手续费', dataIndex: 'fee', align: 'right', search: false, render: (_, r) => cny(r.fee) },
    { title: '币种', dataIndex: 'currency', width: 70, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        pending: { text: '处理中' },
        success: { text: '成功' },
        failed: { text: '失败' },
        refunded: { text: '已退款' },
      },
      render: (_, r) => (
        <StatusTag status={r.status} label={TRANSACTION_STATUS_LABEL[r.status] ?? r.status} />
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt', search: false, render: (_, r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageContainer>
      <ProTable<TransactionItem>
        rowKey="id"
        headerTitle="交易流水"
        columns={columns}
        cardBordered
        search={false}
        request={async (params) => {
          const res = await getTransactions(toQuery(params));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
      />
    </PageContainer>
  );
};

export default TransactionList;