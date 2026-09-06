/**
 * 实名管理：实名信息列表 + 详情（完整证件号核对）+ 审核通过/驳回
 * 权限：列表 canCustomersRead，审核操作 canCustomersManage
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Descriptions, Drawer, Input, Modal, Popconfirm, Space, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import { getIdentities, getIdentity, reviewIdentity } from '@/services/admin';
import type { IdentityDetail, IdentityListItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { formatDateTime } from '@/utils/format';
import { IDENTITY_STATUS_LABEL, IDENTITY_TYPE_LABEL } from '@/services/enums';

/** 状态语义色：verified 绿 / pending 橙 / rejected 红 / unverified 灰 */
const IDENTITY_TAG_COLOR: Record<string, string> = {
  verified: 'green',
  pending: 'orange',
  rejected: 'red',
  unverified: 'default',
};

function IdentityStatusTag({ status }: { status: string }) {
  return (
    <Tag color={IDENTITY_TAG_COLOR[status] ?? 'default'}>
      {IDENTITY_STATUS_LABEL[status] ?? status}
    </Tag>
  );
}

const IdentityList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message } = App.useApp();
  const [detail, setDetail] = useState<IdentityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<IdentityListItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const canManage = !!access.canCustomersManage;

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const d = await getIdentity(id);
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  };

  const doApprove = async (id: number) => {
    await reviewIdentity(id, 'approve');
    message.success(`实名申请 #${id} 已通过`);
    actionRef.current?.reload();
    if (detail?.id === id) setDetail({ ...detail, status: 'verified', verifiedAt: new Date().toISOString(), rejectReason: null });
  };

  const doReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      message.warning('请填写驳回原因');
      return;
    }
    await reviewIdentity(rejectTarget.id, 'reject', reason);
    message.success(`实名申请 #${rejectTarget.id} 已驳回`);
    setRejectTarget(null);
    setRejectReason('');
    actionRef.current?.reload();
    if (detail?.id === rejectTarget.id) {
      setDetail({ ...detail, status: 'rejected', rejectReason: reason, verifiedAt: null });
    }
  };

  const columns: ProColumns<IdentityListItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '客户 ID', dataIndex: 'userId', width: 80, search: false },
    {
      title: '申请人',
      dataIndex: 'q',
      search: true,
      hideInTable: true,
      fieldProps: { placeholder: '姓名 / 企业名称 / 手机号' },
    },
    {
      title: '用户',
      dataIndex: 'userName',
      search: false,
      ellipsis: true,
      render: (_, r) => (r.user ? `${r.user.name || '-'}（${r.user.phone || r.user.email || '-'}）` : '-'),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      valueType: 'select',
      fieldProps: {
        options: Object.entries(IDENTITY_TYPE_LABEL).map(([value, label]) => ({ label, value })),
      },
      render: (_, r) => IDENTITY_TYPE_LABEL[r.type] ?? r.type,
    },
    { title: '姓名', dataIndex: 'realName', search: false, ellipsis: true, render: (_, r) => r.realName || '-' },
    { title: '企业名称', dataIndex: 'companyName', search: false, ellipsis: true, render: (_, r) => r.companyName || '-' },
    {
      title: '信用代码',
      dataIndex: 'creditCode',
      search: false,
      width: 190,
      ellipsis: true,
      render: (_, r) => r.creditCode || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      fieldProps: {
        options: Object.entries(IDENTITY_STATUS_LABEL).map(([value, label]) => ({ label, value })),
      },
      render: (_, r) => <IdentityStatusTag status={r.status} />,
    },
    {
      title: '驳回原因',
      dataIndex: 'rejectReason',
      search: false,
      ellipsis: true,
      render: (_, r) => r.rejectReason || '-',
    },
    { title: '提交时间', dataIndex: 'updatedAt', width: 160, search: false, render: (_, r) => formatDateTime(r.updatedAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 150,
      fixed: 'right',
      render: (_, r) => (
        <Space size={4} wrap>
          <a onClick={() => void openDetail(r.id)}>详情</a>
          {canManage && r.status === 'pending' && (
            <>
              <Popconfirm
                title="确认通过该实名申请？"
                onConfirm={() => void doApprove(r.id)}
                okText="通过"
                cancelText="取消"
              >
                <a style={{ color: '#52c41a' }}>通过</a>
              </Popconfirm>
              <a
                style={{ color: '#ff4d4f' }}
                onClick={() => {
                  setRejectTarget(r);
                  setRejectReason('');
                }}
              >
                驳回
              </a>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<IdentityListItem>
        rowKey="id"
        headerTitle="实名管理"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        request={async (params) => {
          const res = await getIdentities(toQuery(params));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
      />

      {/* 详情抽屉（完整证件号，仅供审核核对） */}
      <Drawer
        width={560}
        open={!!detail}
        onClose={() => setDetail(null)}
        title={`实名信息 #${detail?.id ?? ''}`}
        loading={detailLoading}
      >
        {detail ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Descriptions
              column={1}
              size="small"
              bordered
              items={[
                { key: 'status', label: '状态', children: <IdentityStatusTag status={detail.status} /> },
                {
                  key: 'user',
                  label: '用户',
                  children: detail.user
                    ? `${detail.user.name || '-'}（ID ${detail.userId}）`
                    : `ID ${detail.userId}`,
                },
                { key: 'phone', label: '手机号', children: detail.user?.phone || '-' },
                { key: 'email', label: '邮箱', children: detail.user?.email || '-' },
                { key: 'type', label: '类型', children: IDENTITY_TYPE_LABEL[detail.type] ?? detail.type },
                ...(detail.type === 'personal'
                  ? [
                      { key: 'realName', label: '姓名', children: detail.realName || '-' },
                      { key: 'idNumber', label: '证件号', children: <Typography.Text copyable>{detail.idNumber || '-'}</Typography.Text> },
                    ]
                  : [
                      { key: 'companyName', label: '企业名称', children: detail.companyName || '-' },
                      { key: 'creditCode', label: '统一社会信用代码', children: <Typography.Text copyable>{detail.creditCode || '-'}</Typography.Text> },
                    ]),
                { key: 'rejectReason', label: '驳回原因', children: detail.rejectReason || '-' },
                { key: 'verifiedAt', label: '认证时间', children: formatDateTime(detail.verifiedAt) },
                { key: 'createdAt', label: '首次提交', children: formatDateTime(detail.createdAt) },
                { key: 'updatedAt', label: '最近提交', children: formatDateTime(detail.updatedAt) },
              ]}
            />
            {canManage && detail.status === 'pending' && (
              <Space>
                <Popconfirm
                  title="确认通过该实名申请？"
                  onConfirm={() => void doApprove(detail.id)}
                  okText="通过"
                  cancelText="取消"
                >
                  <Button type="primary">审核通过</Button>
                </Popconfirm>
                <Button
                  danger
                  onClick={() => {
                    setRejectTarget(detail);
                    setRejectReason('');
                  }}
                >
                  驳回
                </Button>
              </Space>
            )}
          </Space>
        ) : null}
      </Drawer>

      {/* 驳回（原因必填） */}
      <Modal
        title={`驳回实名申请 #${rejectTarget?.id ?? ''}`}
        open={!!rejectTarget}
        onOk={() => void doReject()}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        onCancel={() => setRejectTarget(null)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>驳回后用户可修改信息重新提交，驳回原因将在门户实名页展示。</Typography.Text>
          <Input.TextArea
            rows={3}
            placeholder="驳回原因（必填）"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </Space>
      </Modal>
    </PageContainer>
  );
};

export default IdentityList;
