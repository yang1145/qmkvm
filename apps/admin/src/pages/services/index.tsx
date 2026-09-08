/**
 * 服务列表页：供应操作 / 人工开通回填 / 改名 / zjmf 上游状态查看
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Descriptions, Input, Modal, Space, Spin, Tag } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import { getServices, getZjmfServiceUpstreamStatus, manualCompleteService, renameService, serviceAction } from '@/services/admin';
import type { ServiceListItem, ZjmfUpstreamStatusInfo } from '@/services/types';
import { tableRequestAdapter } from '@/utils/table';
import { cny, formatDateTime } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { BILLING_CYCLE_LABEL, SERVICE_STATUS_LABEL } from '@/services/enums';

/** zjmf 上游状态 → 展示 Tag */
const ZJMF_STATUS_TAG: Record<string, { color: string; text: string }> = {
  active: { color: 'green', text: '运行中' },
  pending: { color: 'blue', text: '待开通' },
  suspend: { color: 'orange', text: '已暂停' },
  terminated: { color: 'red', text: '已终止' },
  unknown: { color: 'default', text: '未知' },
};

const ServiceList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message, modal } = App.useApp();
  const [manualTarget, setManualTarget] = useState<ServiceListItem | null>(null);
  const [manualDeliver, setManualDeliver] = useState('');
  const [renameTarget, setRenameTarget] = useState<ServiceListItem | null>(null);
  const [renameVal, setRenameVal] = useState('');
  /** zjmf 上游状态查看弹窗 */
  const [upstreamStatus, setUpstreamStatus] = useState<{ name: string; info: ZjmfUpstreamStatusInfo | null } | null>(null);
  const [upstreamLoading, setUpstreamLoading] = useState(false);

  const showUpstreamStatus = async (row: ServiceListItem) => {
    setUpstreamStatus({ name: row.name, info: null });
    setUpstreamLoading(true);
    try {
      const info = await getZjmfServiceUpstreamStatus(row.id);
      setUpstreamStatus({ name: row.name, info });
    } catch {
      message.error('上游状态查询失败（上游不可达或服务未开通）');
      setUpstreamStatus(null);
    } finally {
      setUpstreamLoading(false);
    }
  };

  const doAction = (row: ServiceListItem, action: 'provision' | 'suspend' | 'unsuspend' | 'terminate' | 'sync' | 'renew') => {
    const titles: Record<string, string> = {
      provision: '开通服务',
      suspend: '暂停服务',
      unsuspend: '恢复服务',
      terminate: '终止服务',
      sync: '同步信息',
      renew: '同步续费（远端续期）',
    };
    modal.confirm({
      title: titles[action] ?? action,
      content: `确认对服务「${row.name}」（#${row.id}）执行「${titles[action]}」操作？`,
      okType: action === 'terminate' || action === 'suspend' ? 'danger' : 'primary',
      onOk: async () => {
        await serviceAction(row.id, { action });
        message.success('操作成功');
        actionRef.current?.reload();
      },
    });
  };

  const doManualComplete = async () => {
    if (!manualTarget) return;
    let deliverInfo: Record<string, unknown> = {};
    try {
      deliverInfo = manualDeliver.trim() ? JSON.parse(manualDeliver) : {};
    } catch {
      message.error('交付信息必须是合法 JSON');
      return;
    }
    await manualCompleteService(manualTarget.id, deliverInfo);
    message.success('人工开通完成');
    setManualTarget(null);
    setManualDeliver('');
    actionRef.current?.reload();
  };

  const doRename = async () => {
    if (!renameTarget) return;
    if (!renameVal.trim()) {
      message.warning('服务名不能为空');
      return;
    }
    await renameService(renameTarget.id, renameVal.trim());
    message.success('改名成功');
    setRenameTarget(null);
    actionRef.current?.reload();
  };

  const columns: ProColumns<ServiceListItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '服务名', dataIndex: 'name', ellipsis: true, search: false },
    { title: '客户', dataIndex: 'userName', ellipsis: true, search: false },
    { title: '商品', dataIndex: 'productName', ellipsis: true, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueType: 'select',
      valueEnum: {
        pending: { text: '待开通' },
        active: { text: '运行中' },
        suspended_overdue: { text: '逾期暂停' },
        suspended_manual: { text: '手动暂停' },
        terminated: { text: '已终止' },
        cancelled: { text: '已取消' },
      },
      render: (_, r) => <StatusTag status={r.status} label={SERVICE_STATUS_LABEL[r.status] ?? r.status} />,
    },
    {
      title: '周期',
      dataIndex: 'cycle',
      width: 90,
      search: false,
      render: (_, r) => BILLING_CYCLE_LABEL[r.cycle] ?? r.cycle,
    },
    {
      title: '续费金额',
      dataIndex: 'renewalAmount',
      align: 'right',
      search: false,
      render: (_, r) => cny(r.renewalAmount),
    },
    { title: '到期日', dataIndex: 'nextDueDate', search: false, render: (_, r) => formatDateTime(r.nextDueDate) },
    { title: '创建时间', dataIndex: 'createdAt', search: false, render: (_, r) => formatDateTime(r.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 220,
      fixed: 'right',
      render: (_, r) =>
        access.canServicesManage ? (
          <Space size={4} wrap>
            {r.status === 'pending' && (
              <a onClick={() => doAction(r, 'provision')}>开通</a>
            )}
            {r.status === 'active' && (
              <a onClick={() => doAction(r, 'suspend')}>暂停</a>
            )}
            {(r.status === 'suspended_manual' || r.status === 'suspended_overdue') && (
              <a onClick={() => doAction(r, 'unsuspend')}>恢复</a>
            )}
            {(r.status === 'active' || r.status.startsWith('suspended')) && (
              <a style={{ color: '#ff4d4f' }} onClick={() => doAction(r, 'terminate')}>
                终止
              </a>
            )}
            {r.status !== 'terminated' && r.status !== 'cancelled' && (
              <a onClick={() => doAction(r, 'sync')}>同步</a>
            )}
            {r.status === 'active' && r.cycle !== 'onetime' && (
              <a onClick={() => doAction(r, 'renew')}>续费同步</a>
            )}
            {r.moduleCode === 'zjmf' && r.deliverInfo?.upHostId != null && (
              <a onClick={() => void showUpstreamStatus(r)}>上游</a>
            )}
            <a
              onClick={() => {
                setRenameTarget(r);
                setRenameVal(r.name);
              }}
            >
              改名
            </a>
            {r.status === 'pending' && (
              <a
                onClick={() => {
                  setManualTarget(r);
                  setManualDeliver(JSON.stringify(r.deliverInfo ?? {}, null, 2));
                }}
              >
                人工开通
              </a>
            )}
          </Space>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<ServiceListItem>
        rowKey="id"
        headerTitle="服务列表"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await getServices({ page: current ?? 1, pageSize: pageSize ?? 20, ...rest });
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
      />

      <Modal
        title={`人工开通 - ${manualTarget?.name ?? ''}`}
        open={!!manualTarget}
        onOk={doManualComplete}
        okText="完成开通"
        onCancel={() => setManualTarget(null)}
        width={560}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>填写交付信息（JSON，如账号/密码/IP 等），将回填到服务 deliverInfo：</div>
          <Input.TextArea
            rows={8}
            placeholder='{"ip": "1.2.3.4", "username": "root", "password": "xxx"}'
            value={manualDeliver}
            onChange={(e) => setManualDeliver(e.target.value)}
          />
        </Space>
      </Modal>

      <Modal
        title="服务改名"
        open={!!renameTarget}
        onOk={doRename}
        okText="保存"
        onCancel={() => setRenameTarget(null)}
      >
        <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} placeholder="服务名称" />
      </Modal>

      <Modal
        title={`上游状态 - ${upstreamStatus?.name ?? ''}`}
        open={!!upstreamStatus}
        footer={null}
        onCancel={() => setUpstreamStatus(null)}
        width={520}
      >
        {upstreamLoading || !upstreamStatus?.info ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="上游主机 ID">{upstreamStatus.info.upHostId}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={ZJMF_STATUS_TAG[upstreamStatus.info.status]?.color}>
                {ZJMF_STATUS_TAG[upstreamStatus.info.status]?.text ?? upstreamStatus.info.status}
              </Tag>
              <span style={{ color: '#999' }}>（上游原始值：{upstreamStatus.info.rawStatus || '-'}）</span>
            </Descriptions.Item>
            <Descriptions.Item label="上游商品">{upstreamStatus.info.productName || '-'}</Descriptions.Item>
            <Descriptions.Item label="到期日">{upstreamStatus.info.expireAt ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="IP">{upstreamStatus.info.ip || '-'}</Descriptions.Item>
            <Descriptions.Item label="上游账号">{upstreamStatus.info.username || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </PageContainer>
  );
};

export default ServiceList;