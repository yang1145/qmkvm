/**
 * 发票管理：开票申请列表 + 审批/驳回/回填发票号 + CSV 导出
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Descriptions, Drawer, Input, Modal, Space, Typography } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import {
  approveFapiaoRequest,
  exportFapiaoCsv,
  getFapiaoRequests,
  issueFapiaoRequest,
  rejectFapiaoRequest,
} from '@/services/admin';
import type { FapiaoRequestListItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { cny, formatDateTime } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { FAPIAO_STATUS_LABEL, FAPIAO_TYPE_LABEL } from '@/services/enums';

const FapiaoList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message } = App.useApp();
  const [detail, setDetail] = useState<FapiaoRequestListItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<FapiaoRequestListItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [issueTarget, setIssueTarget] = useState<FapiaoRequestListItem | null>(null);
  const [issueForm, setIssueForm] = useState<{ fapiaoNo: string; fapiaoUrl: string }>({
    fapiaoNo: '',
    fapiaoUrl: '',
  });

  const openReject = (r: FapiaoRequestListItem) => {
    setRejectTarget(r);
    setRejectReason('');
  };

  const canManage = !!access.canInvoicesManage;

  const doApprove = async (r: FapiaoRequestListItem) => {
    await approveFapiaoRequest(r.id);
    message.success(`申请 #${r.id} 已审批通过`);
    actionRef.current?.reload();
    if (detail?.id === r.id) setDetail({ ...detail, status: 'approved' });
  };

  const doReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      message.warning('请填写驳回原因');
      return;
    }
    await rejectFapiaoRequest(rejectTarget.id, rejectReason.trim());
    message.success(`申请 #${rejectTarget.id} 已驳回`);
    setRejectTarget(null);
    setRejectReason('');
    actionRef.current?.reload();
    if (detail?.id === rejectTarget.id) {
      setDetail({ ...detail, status: 'rejected', rejectReason: rejectReason.trim() });
    }
  };

  const doIssue = async () => {
    if (!issueTarget) return;
    if (!issueForm.fapiaoNo.trim()) {
      message.warning('请填写发票号');
      return;
    }
    await issueFapiaoRequest(issueTarget.id, {
      fapiaoNo: issueForm.fapiaoNo.trim(),
      fapiaoUrl: issueForm.fapiaoUrl.trim() || undefined,
    });
    message.success(`申请 #${issueTarget.id} 已开票`);
    setIssueTarget(null);
    setIssueForm({ fapiaoNo: '', fapiaoUrl: '' });
    actionRef.current?.reload();
    if (detail?.id === issueTarget.id) {
      setDetail({ ...detail, status: 'issued', fapiaoNo: issueForm.fapiaoNo.trim() });
    }
  };

  const columns: ProColumns<FapiaoRequestListItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '客户 ID', dataIndex: 'userId', width: 80 },
    {
      title: '客户',
      dataIndex: 'userName',
      search: false,
      ellipsis: true,
      render: (_, r) => r.user?.name || '-',
    },
    { title: '账单号', dataIndex: 'invoiceNo', width: 140, search: false, render: (_, r) => r.invoiceNo || '-' },
    {
      title: '抬头',
      dataIndex: 'titleName',
      search: false,
      ellipsis: true,
      render: (_, r) => r.title?.name || '-',
    },
    {
      title: '税号',
      dataIndex: 'taxNo',
      search: false,
      width: 170,
      ellipsis: true,
      render: (_, r) => r.title?.taxNo || '-',
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      valueType: 'select',
      fieldProps: { options: [
        { label: FAPIAO_TYPE_LABEL.electronic, value: 'electronic' },
        { label: FAPIAO_TYPE_LABEL.special, value: 'special' },
      ] },
      render: (_, r) => FAPIAO_TYPE_LABEL[r.type] ?? r.type,
    },
    { title: '金额', dataIndex: 'amount', align: 'right', width: 100, search: false, render: (_, r) => cny(r.amount) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      fieldProps: { options: Object.entries(FAPIAO_STATUS_LABEL).map(([value, label]) => ({ label, value })) },
      render: (_, r) => <StatusTag status={r.status} label={FAPIAO_STATUS_LABEL[r.status] ?? r.status} />,
    },
    { title: '发票号', dataIndex: 'fapiaoNo', search: false, ellipsis: true, render: (_, r) => r.fapiaoNo || '-' },
    { title: '申请时间', dataIndex: 'createdAt', width: 150, search: false, render: (_, r) => formatDateTime(r.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 170,
      fixed: 'right',
      render: (_, r) => (
        <Space size={4} wrap>
          <a onClick={() => setDetail(r)}>详情</a>
          {canManage && r.status === 'pending' && (
            <>
              <a style={{ color: '#52c41a' }} onClick={() => doApprove(r)}>通过</a>
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
          {canManage && r.status === 'approved' && (
            <>
              <a
                onClick={() => {
                  setIssueTarget(r);
                  setIssueForm({ fapiaoNo: '', fapiaoUrl: '' });
                }}
              >
                回填发票号
              </a>
              <a style={{ color: '#ff4d4f' }} onClick={() => openReject(r)}>驳回</a>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<FapiaoRequestListItem>
        rowKey="id"
        headerTitle="发票管理"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        request={async (params) => {
          const res = await getFapiaoRequests(toQuery(params));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        toolBarRender={() => [
          <Button key="export" onClick={() => exportFapiaoCsv().catch(() => undefined)}>
            导出 CSV
          </Button>,
        ]}
      />

      {/* 详情抽屉 */}
      <Drawer width={520} open={!!detail} onClose={() => setDetail(null)} title={`开票申请 #${detail?.id ?? ''}`}>
        {detail ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Descriptions
              column={1}
              size="small"
              bordered
              items={[
                { key: 'status', label: '状态', children: FAPIAO_STATUS_LABEL[detail.status] ?? detail.status },
                { key: 'user', label: '客户', children: `${detail.user?.name || '-'}（ID ${detail.userId}）` },
                { key: 'invoice', label: '关联账单', children: detail.invoiceNo || `#${detail.invoiceId}` },
                {
                  key: 'title',
                  label: '发票抬头',
                  children: detail.title
                    ? `${detail.title.name}（${detail.title.type === 'enterprise' ? '企业' : '个人'}）`
                    : '-',
                },
                { key: 'taxNo', label: '税号', children: detail.title?.taxNo || '-' },
                { key: 'email', label: '接收邮箱', children: detail.title?.email || '-' },
                { key: 'amount', label: '金额', children: cny(detail.amount) },
                { key: 'type', label: '类型', children: FAPIAO_TYPE_LABEL[detail.type] ?? detail.type },
                { key: 'remark', label: '备注', children: detail.remark || '-' },
                { key: 'reject', label: '驳回原因', children: detail.rejectReason || '-' },
                { key: 'fapiaoNo', label: '发票号', children: detail.fapiaoNo || '-' },
                {
                  key: 'fapiaoUrl',
                  label: '发票链接',
                  children: detail.fapiaoUrl ? (
                    <a href={detail.fapiaoUrl} target="_blank" rel="noreferrer">
                      {detail.fapiaoUrl}
                    </a>
                  ) : (
                    '-'
                  ),
                },
                { key: 'createdAt', label: '申请时间', children: formatDateTime(detail.createdAt) },
                { key: 'issuedAt', label: '开票时间', children: formatDateTime(detail.issuedAt) },
              ]}
            />
            {canManage && detail.status === 'pending' && (
              <Space>
                <Button type="primary" onClick={() => doApprove(detail)}>
                  审批通过
                </Button>
                <Button danger onClick={() => openReject(detail)}>
                  驳回
                </Button>
              </Space>
            )}
            {canManage && detail.status === 'approved' && (
              <Button type="primary" onClick={() => setIssueTarget(detail)}>
                回填发票号
              </Button>
            )}
          </Space>
        ) : null}
      </Drawer>

      {/* 驳回 */}
      <Modal
        title={`驳回开票申请 #${rejectTarget?.id ?? ''}`}
        open={!!rejectTarget}
        onOk={doReject}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        onCancel={() => setRejectTarget(null)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>驳回后客户将收到通知，可修改后重新申请。</Typography.Text>
          <Input.TextArea
            rows={3}
            placeholder="驳回原因（必填）"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </Space>
      </Modal>

      {/* 回填发票号 */}
      <Modal
        title={`回填发票号 #${issueTarget?.id ?? ''}`}
        open={!!issueTarget}
        onOk={doIssue}
        okText="确认开票"
        onCancel={() => setIssueTarget(null)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="发票号码（必填）"
            value={issueForm.fapiaoNo}
            onChange={(e) => setIssueForm({ ...issueForm, fapiaoNo: e.target.value })}
          />
          <Input
            placeholder="发票文件链接（选填）"
            value={issueForm.fapiaoUrl}
            onChange={(e) => setIssueForm({ ...issueForm, fapiaoUrl: e.target.value })}
          />
        </Space>
      </Modal>
    </PageContainer>
  );
};

export default FapiaoList;
