/**
 * 通知模板：channel×event 列表、编辑 subject/body、{{变量}} 提示、启用开关
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Input, Modal, Select, Space, Switch, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import { getTemplates, updateTemplate } from '@/services/admin';
import type { TemplateItem } from '@/services/types';
import { CHANNEL_LABEL } from '@/services/enums';

const VARIABLE_HINTS = ['{{siteName}}', '{{userName}}', '{{userEmail}}', '{{serviceName}}', '{{invoiceNo}}', '{{amount}}', '{{dueDate}}', '{{ticketId}}', '{{ticketSubject}}'];

const TemplateList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message } = App.useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateItem | null>(null);

  const doSave = async () => {
    if (!editing) return;
    if (editing.channel === 'email' && !editing.subject?.trim()) {
      message.warning('邮件模板必须填写主题');
      return;
    }
    if (!editing.body.trim()) {
      message.warning('模板内容不能为空');
      return;
    }
    await updateTemplate(editing.id, {
      subject: editing.subject,
      body: editing.body,
      active: editing.active,
    });
    message.success('模板已保存');
    setEditOpen(false);
    actionRef.current?.reload();
  };

  const toggleActive = async (row: TemplateItem) => {
    await updateTemplate(row.id, { active: !row.active });
    message.success(row.active ? '已停用' : '已启用');
    actionRef.current?.reload();
  };

  const columns: ProColumns<TemplateItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    {
      title: '渠道',
      dataIndex: 'channel',
      width: 100,
      valueType: 'select',
      valueEnum: { email: { text: '邮件' }, sms: { text: '短信' }, inapp: { text: '站内信' } },
      render: (_, r) => <Tag color="blue">{CHANNEL_LABEL[r.channel] ?? r.channel}</Tag>,
    },
    { title: '事件', dataIndex: 'event', width: 220 },
    { title: '主题', dataIndex: 'subject', ellipsis: true, search: false, render: (_, r) => r.subject ?? '-' },
    { title: '内容预览', dataIndex: 'body', ellipsis: true, search: false },
    {
      title: '启用',
      dataIndex: 'active',
      width: 90,
      search: false,
      render: (_, r) =>
        access.canTemplatesManage ? (
          <Switch size="small" checked={r.active} onChange={() => toggleActive(r)} />
        ) : r.active ? (
          <Tag color="green">启用</Tag>
        ) : (
          <Tag>停用</Tag>
        ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 90,
      render: (_, r) =>
        access.canTemplatesManage ? (
          <a
            onClick={() => {
              setEditing(r);
              setEditOpen(true);
            }}
          >
            编辑
          </a>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<TemplateItem>
        rowKey="id"
        headerTitle="通知模板"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        search={false}
        request={async (params) => {
          const res = await getTemplates({ page: params.current ?? 1, pageSize: params.pageSize ?? 20 });
          return { data: res.items ?? (res as unknown as TemplateItem[]), success: true, total: res.total ?? 0 };
        }}
        pagination={{ defaultPageSize: 20 }}
      />

      <Modal
        title={`编辑模板：${editing ? `${CHANNEL_LABEL[editing.channel]} / ${editing.event}` : ''}`}
        open={editOpen}
        onOk={doSave}
        okText="保存"
        width={760}
        onCancel={() => setEditOpen(false)}
      >
        {editing && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <Typography.Text type="secondary">可用变量：</Typography.Text>
              <Space size={4} wrap style={{ marginTop: 4 }}>
                {VARIABLE_HINTS.map((v) => (
                  <Tag key={v} color="processing" style={{ cursor: 'pointer' }}
                    onClick={() => setEditing({ ...editing, body: editing.body + v })}>
                    {v}
                  </Tag>
                ))}
              </Space>
            </div>
            {editing.channel === 'email' && (
              <div>
                主题：
                <Input
                  style={{ width: '80%' }}
                  value={editing.subject ?? ''}
                  onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                />
              </div>
            )}
            <div>
              内容（{'{{变量}}'} 在发送时替换为实际值）：
              <Input.TextArea
                rows={10}
                style={{ marginTop: 4 }}
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              />
            </div>
            <Space>
              <span>启用：</span>
              <Switch checked={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} />
            </Space>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default TemplateList;