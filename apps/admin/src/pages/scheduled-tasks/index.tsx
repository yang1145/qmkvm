/**
 * 计划任务管理页：worker 定时任务清单（名称/周期/最近一次执行）、
 * 执行记录抽屉（job_runs 分页）、「立即执行」（经队列，tasks.manage 权限）。
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { HistoryOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useAccess } from '@umijs/max';
import { App, Button, Drawer, Table, Tooltip, Typography } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getScheduledTaskRuns,
  getScheduledTasks,
  runScheduledTask,
} from '@/services/admin';
import type { ScheduledTaskItem, ScheduledTaskRunItem } from '@/services/admin';
import { formatDateTime } from '@/utils/format';
import { tableRequestAdapter, toQuery } from '@/utils/table';

const { Text } = Typography;

const RUN_STATUS_META: Record<string, { label: string; color: string }> = {
  success: { label: '成功', color: 'green' },
  partial: { label: '部分成功', color: 'orange' },
  failed: { label: '失败', color: 'red' },
};

const ScheduledTasksPage: React.FC = () => {
  const access = useAccess();
  const { message, modal } = App.useApp();
  const [tasks, setTasks] = useState<ScheduledTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTask, setActiveTask] = useState<ScheduledTaskItem | null>(null);
  const runsActionRef = useRef<ActionType | undefined>(undefined);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getScheduledTasks();
      setTasks(res.items ?? []);
    } catch {
      // 错误提示由统一 errorHandler 处理
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const doRun = (row: ScheduledTaskItem) => {
    modal.confirm({
      title: '立即执行计划任务',
      content: `确认立即执行「${row.name}」？任务将经队列由 worker 执行并记录到执行历史。`,
      onOk: async () => {
        await runScheduledTask(row.name);
        message.success('已加入执行队列，稍后可在执行记录中查看结果');
        setTimeout(() => {
          loadTasks();
          runsActionRef.current?.reload();
        }, 1500);
      },
    });
  };

  const runsColumns: ProColumns<ScheduledTaskRunItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      search: false,
      render: (_, row) => {
        const meta = RUN_STATUS_META[row.status] ?? { label: row.status, color: 'default' };
        return <Text type={meta.color === 'red' ? 'danger' : undefined}>{meta.label}</Text>;
      },
    },
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      width: 170,
      search: false,
      render: (_, row) => formatDateTime(row.startedAt),
    },
    {
      title: '结束时间',
      dataIndex: 'finishedAt',
      width: 170,
      search: false,
      render: (_, row) => formatDateTime(row.finishedAt),
    },
    {
      title: '结果 / 错误',
      dataIndex: 'error',
      search: false,
      ellipsis: true,
      render: (_, row) =>
        row.error ? (
          <Tooltip title={row.error}>
            <Text type="danger">{row.error}</Text>
          </Tooltip>
        ) : (
          <Tooltip
            title={<pre style={{ maxWidth: 420, whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.result, null, 2)}</pre>}
          >
            <span>{row.result == null ? '-' : JSON.stringify(row.result)}</span>
          </Tooltip>
        ),
    },
  ];

  const columns: ProColumns<ScheduledTaskItem>[] = [
    { title: '任务名称', dataIndex: 'name', width: 200 },
    { title: '执行周期（UTC cron）', dataIndex: 'cron', width: 140 },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '最近一次执行',
      dataIndex: 'lastRun',
      width: 260,
      render: (_, row) => {
        if (!row.lastRun) return <Text type="secondary">尚未执行</Text>;
        const meta = RUN_STATUS_META[row.lastRun.status] ?? {
          label: row.lastRun.status,
          color: 'default',
        };
        return (
          <Tooltip title={row.lastRun.error ?? undefined}>
            <span>
              <Text type={meta.color === 'red' ? 'danger' : undefined}>{meta.label}</Text>
              <Text type="secondary"> · {formatDateTime(row.lastRun.startedAt)}</Text>
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '操作',
      valueType: 'option',
      width: 200,
      render: (_, row) => [
        <Button
          key="runs"
          size="small"
          icon={<HistoryOutlined />}
          onClick={() => {
            setActiveTask(row);
            setDrawerOpen(true);
          }}
        >
          执行记录
        </Button>,
        access.canTasksManage ? (
          <Button key="run" size="small" type="primary" ghost icon={<PlayCircleOutlined />} onClick={() => doRun(row)}>
            立即执行
          </Button>
        ) : null,
      ],
    },
  ];

  return (
    <PageContainer>
      <ProTable<ScheduledTaskItem>
        headerTitle="计划任务（与 worker 定时调度保持同步）"
        rowKey="name"
        search={false}
        options={{ reload: () => loadTasks() }}
        loading={loading}
        dataSource={tasks}
        pagination={false}
        columns={columns}
      />
      <Drawer
        title={activeTask ? `执行记录：${activeTask.name}` : '执行记录'}
        width={820}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnHidden
      >
        {activeTask && (
          <ProTable<ScheduledTaskRunItem>
            actionRef={runsActionRef}
            rowKey="id"
            search={false}
            request={async (params) => {
              const res = await getScheduledTaskRuns(activeTask.name, toQuery(params, { pageSize: 10 }));
              return tableRequestAdapter(res);
            }}
            pagination={{ pageSize: 10 }}
            columns={runsColumns}
          />
        )}
      </Drawer>
    </PageContainer>
  );
};

export default ScheduledTasksPage;
