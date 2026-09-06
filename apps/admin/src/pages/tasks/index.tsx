/**
 * 供应任务页：状态/动作筛选、失败原因、重试/跳过
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Tooltip } from 'antd';
import { useRef } from 'react';
import type React from 'react';
import { getTasks, retryTask, skipTask } from '@/services/admin';
import type { ProvisionTaskItem } from '@/services/types';
import { tableRequestAdapter } from '@/utils/table';
import { formatDateTime } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { PROVISION_ACTION_LABEL, PROVISION_STATUS_LABEL } from '@/services/enums';

const TaskList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message, modal } = App.useApp();

  const doRetry = (row: ProvisionTaskItem) => {
    modal.confirm({
      title: '重试任务',
      content: `确认重试任务 #${row.id}（${PROVISION_ACTION_LABEL[row.action]}）？`,
      onOk: async () => {
        await retryTask(row.id);
        message.success('已加入重试队列');
        actionRef.current?.reload();
      },
    });
  };

  const doSkip = (row: ProvisionTaskItem) => {
    modal.confirm({
      title: '跳过任务',
      content: `确认跳过任务 #${row.id}？跳过后不再执行。`,
      okType: 'danger',
      onOk: async () => {
        await skipTask(row.id);
        message.success('已跳过');
        actionRef.current?.reload();
      },
    });
  };

  const columns: ProColumns<ProvisionTaskItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '服务 ID', dataIndex: 'serviceId', width: 90, search: false },
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      valueType: 'select',
      valueEnum: {
        provision: { text: '开通' },
        suspend: { text: '暂停' },
        unsuspend: { text: '恢复' },
        terminate: { text: '终止' },
        change_package: { text: '变更套餐' },
        sync: { text: '同步' },
      },
      render: (_, r) => PROVISION_ACTION_LABEL[r.action] ?? r.action,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        queued: { text: '排队中' },
        processing: { text: '执行中' },
        succeeded: { text: '成功' },
        failed: { text: '失败' },
        dead: { text: '死信' },
        skipped: { text: '已跳过' },
      },
      render: (_, r) => <StatusTag status={r.status} label={PROVISION_STATUS_LABEL[r.status] ?? r.status} />,
    },
    {
      title: '尝试次数',
      dataIndex: 'attempts',
      width: 100,
      search: false,
      render: (_, r) => `${r.attempts}/${r.maxAttempts}`,
    },
    {
      title: '失败原因',
      dataIndex: 'lastError',
      search: false,
      ellipsis: true,
      render: (_, r) =>
        r.lastError ? (
          <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.lastError}</pre>}>
            <span style={{ color: '#ff4d4f' }}>{r.lastError}</span>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    { title: '创建时间', dataIndex: 'createdAt', search: false, render: (_, r) => formatDateTime(r.createdAt) },
    { title: '执行时间', dataIndex: 'executedAt', search: false, render: (_, r) => formatDateTime(r.executedAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 120,
      render: (_, r) => {
        if (!access.canTasksManage) return '-';
        const canRetry = r.status === 'failed' || r.status === 'dead';
        const canSkip = r.status === 'failed' || r.status === 'dead' || r.status === 'queued';
        if (!canRetry && !canSkip) return '-';
        return (
          <>
            {canRetry && <a onClick={() => doRetry(r)}>重试</a>}
            {canRetry && canSkip ? ' ' : ''}
            {canSkip && <a onClick={() => doSkip(r)}>跳过</a>}
          </>
        );
      },
    },
  ];

  return (
    <PageContainer>
      <ProTable<ProvisionTaskItem>
        rowKey="id"
        headerTitle="供应任务"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await getTasks({ page: current ?? 1, pageSize: pageSize ?? 20, ...rest });
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
      />
    </PageContainer>
  );
};

export default TaskList;