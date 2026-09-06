/**
 * 工单工作台：列表（状态/部门/优先级筛选）
 */
import { history } from '@umijs/max';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import React, { useEffect, useRef, useState } from 'react';
import { getDepartments, getTickets } from '@/services/admin';
import type { DepartmentItem, TicketListItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { formatDateTime } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { TICKET_PRIORITY, TICKET_PRIORITY_LABEL, TICKET_STATUS, TICKET_STATUS_LABEL } from '@/services/enums';

const TicketList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);

  useEffect(() => {
    getDepartments().then(setDepartments).catch(() => {});
  }, []);

  const columns: ProColumns<TicketListItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '主题', dataIndex: 'subject', ellipsis: true },
    { title: '客户', dataIndex: 'userName', ellipsis: true, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueType: 'select',
      valueEnum: Object.fromEntries(TICKET_STATUS.map((s) => [s, { text: TICKET_STATUS_LABEL[s] }])),
      render: (_, r) => <StatusTag status={r.status} label={TICKET_STATUS_LABEL[r.status] ?? r.status} />,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 90,
      valueType: 'select',
      valueEnum: Object.fromEntries(TICKET_PRIORITY.map((p) => [p, { text: TICKET_PRIORITY_LABEL[p] }])),
      render: (_, r) => <StatusTag status={r.priority} label={TICKET_PRIORITY_LABEL[r.priority] ?? r.priority} />,
    },
    {
      title: '部门',
      dataIndex: 'departmentId',
      width: 130,
      ellipsis: true,
      valueType: 'select',
      fieldProps: {
        showSearch: true,
        optionFilterProp: 'label',
        options: departments.map((d) => ({ value: d.id, label: d.name })),
      },
      render: (_, r) => r.departmentName ?? '-',
    },
    {
      title: '最后回复',
      width: 170,
      search: false,
      render: (_, r) => (
        <span style={{ fontSize: 12 }}>
          {r.lastReplyBy === 'customer' ? '客户' : r.lastReplyBy === 'staff' ? '客服' : '-'} {formatDateTime(r.lastReplyAt)}
        </span>
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt', search: false, render: (_, r) => formatDateTime(r.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 90,
      render: (_, r) => [
        <a key="open" onClick={() => history.push(`/tickets/${r.id}`)}>
          处理
        </a>,
      ],
    },
  ];

  return (
    <PageContainer>
      <ProTable<TicketListItem>
        rowKey="id"
        headerTitle="工单工作台"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        request={async (params) => {
          const res = await getTickets(toQuery(params));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
      />
    </PageContainer>
  );
};

export default TicketList;