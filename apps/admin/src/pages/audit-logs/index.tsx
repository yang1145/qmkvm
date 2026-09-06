/**
 * 审计日志：action/actorType/日期筛选，before/after JSON 折叠展示
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import React from 'react';
import { getAuditLogs } from '@/services/admin';
import type { AuditLogItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { formatDateTime } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { ACTOR_TYPE_LABEL } from '@/services/enums';
import { Tag, Typography } from 'antd';

const AuditLogList: React.FC = () => {
  const columns: ProColumns<AuditLogItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    {
      title: '操作者',
      width: 130,
      search: false,
      render: (_, r) => (
        <span>
          <Tag color={r.actorType === 'admin' ? 'blue' : r.actorType === 'user' ? 'green' : 'default'}>
            {ACTOR_TYPE_LABEL[r.actorType] ?? r.actorType}
          </Tag>
          {r.actorName ?? r.actorId ?? '-'}
        </span>
      ),
    },
    {
      title: '操作者类型',
      dataIndex: 'actorType',
      width: 110,
      valueType: 'select',
      valueEnum: { admin: { text: '管理员' }, user: { text: '客户' }, system: { text: '系统' } },
    },
    { title: '动作', dataIndex: 'action', width: 180 },
    {
      title: '目标',
      width: 160,
      search: false,
      render: (_, r) => (r.targetType ? `${r.targetType} #${r.targetId ?? '-'}` : '-'),
    },
    {
      title: '变更内容',
      search: false,
      render: (_, r) => (
        <Typography.Paragraph
          style={{ marginBottom: 0 }}
          ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
        >
          <span style={{ color: '#999' }}>before：</span>
          <code style={{ fontSize: 12 }}>{r.before === null ? '-' : JSON.stringify(r.before)}</code>
          <br />
          <span style={{ color: '#999' }}>after：</span>
          <code style={{ fontSize: 12 }}>{r.after === null ? '-' : JSON.stringify(r.after)}</code>
        </Typography.Paragraph>
      ),
    },
    { title: 'IP', dataIndex: 'ip', width: 130, search: false, render: (_, r) => r.ip ?? '-' },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_, r) => formatDateTime(r.createdAt),
    },
    {
      title: '日期范围',
      dataIndex: 'dateRange',
      valueType: 'dateRange',
      hideInTable: true,
      search: {
        transform: (value?: string[]) => {
          if (!value || value.length !== 2) return {};
          return { dateFrom: value[0], dateTo: value[1] };
        },
      },
    },
  ];

  return (
    <PageContainer>
      <ProTable<AuditLogItem>
        rowKey="id"
        headerTitle="审计日志"
        columns={columns}
        cardBordered
        request={async (params) => {
          const res = await getAuditLogs(toQuery(params));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        options={{ reload: true, density: false, setting: false }}
      />
    </PageContainer>
  );
};

export default AuditLogList;