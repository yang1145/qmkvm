/**
 * 客户列表页
 */
import { history } from '@umijs/max';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useRef } from 'react';
import type React from 'react';
import { getCustomers, EXPORT_PATHS } from '@/services/admin';
import type { CustomerListItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { formatDateTime } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { USER_STATUS_LABEL } from '@/services/enums';

const CustomerList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  // 记录最近一次表格查询参数，供导出 CSV 复用筛选条件
  const lastParams = useRef<Record<string, unknown>>({});

  const doExportCsv = () => {
    const p = lastParams.current;
    const qs = new URLSearchParams();
    const q = p.q ?? p.name ?? p.phone ?? p.keyword;
    if (q) qs.set('q', String(q));
    if (p.status) qs.set('status', String(p.status));
    window.open(`${EXPORT_PATHS.customers}?${qs.toString()}`, '_blank');
  };

  const columns: ProColumns<CustomerListItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '姓名', dataIndex: 'name', ellipsis: true },
    { title: '手机号', dataIndex: 'phone', ellipsis: true },
    { title: '邮箱', dataIndex: 'email', ellipsis: true, search: false },
    {
      title: '余额',
      dataIndex: 'creditBalance',
      search: false,
      align: 'right',
      render: (_, r) => (r.creditBalance / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 }),
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: {
        active: { text: '正常' },
        disabled: { text: '已禁用' },
      },
      render: (_, r) => <StatusTag status={r.status} label={USER_STATUS_LABEL[r.status] ?? r.status} />,
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      search: false,
      render: (_, r) => formatDateTime(r.lastLoginAt),
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      search: false,
      render: (_, r) => formatDateTime(r.createdAt),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 100,
      render: (_, r) => [
        <a key="detail" onClick={() => history.push(`/customers/${r.id}`)}>
          查看详情
        </a>,
      ],
    },
  ];

  return (
    <PageContainer>
      <ProTable<CustomerListItem>
        rowKey="id"
        headerTitle="客户列表"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        request={async (params) => {
          lastParams.current = params;
          const res = await getCustomers(toQuery(params, { q: params.keyword, status: params.status }));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        toolBarRender={() => [
          <Button key="export-csv" icon={<DownloadOutlined />} onClick={doExportCsv}>
            导出 CSV
          </Button>,
        ]}
      />
    </PageContainer>
  );
};

export default CustomerList;