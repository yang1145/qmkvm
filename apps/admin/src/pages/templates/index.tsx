/**
 * 通知模板：channel×event 列表、编辑 subject/body、{{变量}} 提示、启用开关
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Input, Modal, Select, Space, Switch, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import { getTemplates, setSmsSignature, testNotificationTemplate, updateTemplate } from '@/services/admin';
import type { TemplateItem } from '@/services/types';
import { CHANNEL_LABEL } from '@/services/enums';

const VARIABLE_HINTS = ['{{siteName}}', '{{userName}}', '{{userEmail}}', '{{serviceName}}', '{{invoiceNo}}', '{{amount}}', '{{dueDate}}', '{{ticketId}}', '{{ticketSubject}}'];

const TemplateList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message } = App.useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateItem | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testing, setTesting] = useState<TemplateItem | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [sigValue, setSigValue] = useState('');
  const [sigSaving, setSigSaving] = useState(false);

  const openSignatureModal = async () => {
    setSigOpen(true);
    setSigSaving(true);
    try {
      // 预填：从现有短信模板正文解析当前签名（【xxx】开头）
      const res = await getTemplates({ channel: 'sms', page: 1, pageSize: 100 });
      const items = res.items ?? (res as unknown as TemplateItem[]);
      const sms = items.find((t) => t.channel === 'sms');
      const m = sms?.body.match(/^【([^】]+)】/);
      setSigValue(m?.[1] ?? '');
    } finally {
      setSigSaving(false);
    }
  };

  const doSetSignature = async () => {
    const signature = sigValue.trim();
    if (!signature) {
      message.warning('签名不能为空');
      return;
    }
    setSigSaving(true);
    try {
      const res = await setSmsSignature(signature);
      message.success(`已更新 ${res.updated} 个短信模板签名`);
      setSigOpen(false);
      actionRef.current?.reload();
    } finally {
      setSigSaving(false);
    }
  };

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

  const doTestSend = async () => {
    if (!testing) return;
    if (!testTo.trim() || !testTo.includes('@')) {
      message.warning('请输入有效的目标邮箱');
      return;
    }
    setTestSending(true);
    try {
      const res = await testNotificationTemplate(testing.id, testTo.trim());
      if (res.ok) {
        message.success(
          res.provider === 'mock'
            ? '测试完成（当前未配置真实 SMTP，走 mock 发送）'
            : '测试邮件已发送，请查收',
        );
        setTestOpen(false);
      } else {
        message.error(`发送失败：${res.error ?? '未知错误'}`);
      }
    } finally {
      setTestSending(false);
    }
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
      width: 140,
      render: (_, r) =>
        access.canTemplatesManage ? (
          <Space size={12}>
            <a
              onClick={() => {
                setEditing(r);
                setEditOpen(true);
              }}
            >
              编辑
            </a>
            {r.channel === 'email' && (
              <a
                onClick={() => {
                  setTesting(r);
                  setTestTo('');
                  setTestOpen(true);
                }}
              >
                测试发送
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
      <ProTable<TemplateItem>
        rowKey="id"
        headerTitle="通知模板"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        search={false}
        toolBarRender={
          access.canTemplatesManage
            ? () => [
                <Button key="signature" onClick={openSignatureModal}>
                  批量设置短信签名
                </Button>,
              ]
            : undefined
        }
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
      <Modal
        title="批量设置短信签名"
        open={sigOpen}
        onOk={doSetSignature}
        okText="应用"
        confirmLoading={sigSaving}
        width={520}
        onCancel={() => setSigOpen(false)}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Typography.Text type="secondary">
            将全部短信模板的签名统一为【签名】（原签名会被替换，无签名的模板在最前面插入）。国内短信强制实名签名，建议与站点名保持一致。
          </Typography.Text>
          <div>
            签名（1-20 字）：
            <Input
              style={{ width: 240 }}
              maxLength={20}
              value={sigValue}
              placeholder="例如：启明智联"
              onChange={(e) => setSigValue(e.target.value)}
              onPressEnter={doSetSignature}
            />
          </div>
          <Typography.Text type="secondary">提示：签名填写 {'{{site.name}}'} 可直接复用站点名（发送时取系统设置中的站点名称）。</Typography.Text>
        </div>
      </Modal>
      <Modal
        title={`测试发送：${testing ? `${CHANNEL_LABEL[testing.channel]} / ${testing.event}` : ''}`}
        open={testOpen}
        onOk={doTestSend}
        okText="发送"
        confirmLoading={testSending}
        width={520}
        onCancel={() => setTestOpen(false)}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Typography.Text type="secondary">
            使用该模板渲染示例变量（{'{{变量}}'} 替换为演示值）后，按当前邮件设置真实发送一封测试邮件。
          </Typography.Text>
          <div>
            目标邮箱：
            <Input
              style={{ width: 280 }}
              value={testTo}
              placeholder="接收测试邮件的邮箱地址"
              onChange={(e) => setTestTo(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
};

export default TemplateList;