/**
 * 工单会话页：回复（内部备注开关）+ 状态推进
 */
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { useParams } from '@umijs/max';
import { App, Button, Card, Checkbox, Input, Select, Space, Spin, Tag } from 'antd';
import React, { useEffect, useState } from 'react';
import { getTicketDetail, replyTicket, setTicketStatus } from '@/services/admin';
import type { TicketDetail } from '@/services/types';
import { formatDateTime } from '@/utils/format';
import { StatusTag, statusColor } from '@/utils/status';
import { TICKET_STATUS, TICKET_STATUS_LABEL, TICKET_PRIORITY_LABEL } from '@/services/enums';

const TicketDetailPage: React.FC = () => {
  const params = useParams<{ id: string }>();
  const { message } = App.useApp();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [sending, setSending] = useState(false);

  const load = () => {
    setLoading(true);
    getTicketDetail(Number(params.id))
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, [params.id]);

  const doReply = async () => {
    if (!reply.trim()) {
      message.warning('请输入回复内容');
      return;
    }
    setSending(true);
    try {
      await replyTicket(detail!.id, { contentHtml: reply.trim(), internalNote: internalNote || undefined });
      message.success(internalNote ? '内部备注已添加' : '回复成功');
      setReply('');
      setInternalNote(false);
      load();
    } finally {
      setSending(false);
    }
  };

  const doStatus = async (status: string) => {
    await setTicketStatus(detail!.id, status);
    message.success('状态已更新');
    load();
  };

  if (loading && !detail) {
    return (
      <PageContainer>
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </PageContainer>
    );
  }
  if (!detail) {
    return <PageContainer>工单不存在或加载失败</PageContainer>;
  }

  return (
    <PageContainer
      title={`工单 #${detail.id}：${detail.subject}`}
      extra={
        <Space>
          <StatusTag status={detail.status} label={TICKET_STATUS_LABEL[detail.status] ?? detail.status} />
          <Tag color={statusColor(detail.priority)}>{TICKET_PRIORITY_LABEL[detail.priority] ?? detail.priority}</Tag>
          <Select
            value={detail.status}
            style={{ width: 130 }}
            onChange={doStatus}
            options={TICKET_STATUS.map((s) => ({ value: s, label: `设为：${TICKET_STATUS_LABEL[s]}` }))}
          />
        </Space>
      }
      onBack={() => window.history.back()}
    >
      <ProCard title="工单信息" size="small" style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <span>客户：{detail.userName ?? `#${detail.userId}`}</span>
          <span>部门：{detail.departmentName ?? '-'}</span>
          <span>创建时间：{formatDateTime(detail.createdAt)}</span>
          {detail.serviceId && <span>关联服务：#{detail.serviceId}</span>}
        </Space>
      </ProCard>

      <Card title="会话记录" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          {(detail.replies ?? []).map((r) => (
            <div
              key={r.id}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: r.internalNote ? '#fffbe6' : r.authorType === 'customer' ? '#f5f5f5' : '#e6f4ff',
                border: r.internalNote ? '1px solid #ffe58f' : 'none',
              }}
            >
              <div style={{ marginBottom: 6, fontSize: 12, color: '#666', display: 'flex', gap: 8 }}>
                <b>{r.authorName || (r.authorType === 'customer' ? '客户' : '客服')}</b>
                {r.authorType === 'system' && <Tag>系统</Tag>}
                {r.internalNote && <Tag color="gold">内部备注</Tag>}
                <span>{formatDateTime(r.createdAt)}</span>
              </div>
              <div dangerouslySetInnerHTML={{ __html: r.contentHtml }} />
            </div>
          ))}
          {(detail.replies ?? []).length === 0 && <div style={{ color: '#999' }}>暂无回复</div>}
        </div>
      </Card>

      <Card title={internalNote ? '添加内部备注' : '回复客户'}>
        <Input.TextArea
          rows={5}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={internalNote ? '输入内部备注内容（仅工作人员可见）' : '输入回复内容（支持简单 HTML）'}
        />
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Checkbox checked={internalNote} onChange={(e) => setInternalNote(e.target.checked)}>
            内部备注（客户不可见）
          </Checkbox>
          <Button type="primary" loading={sending} onClick={doReply}>
            {internalNote ? '添加备注' : '发送回复'}
          </Button>
        </div>
      </Card>
    </PageContainer>
  );
};

export default TicketDetailPage;