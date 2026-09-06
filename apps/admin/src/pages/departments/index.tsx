/**
 * 部门管理（工单部门 CRUD）
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Checkbox, Input, InputNumber, Modal } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import { createDepartment, getDepartments, updateDepartment } from '@/services/admin';
import type { DepartmentItem } from '@/services/types';
import { formatDateTime } from '@/utils/format';

const DepartmentList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message } = App.useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<DepartmentItem> | null>(null);

  const doSave = async () => {
    if (!editing?.name?.trim()) {
      message.warning('部门名称不能为空');
      return;
    }
    if (editing.id) {
      await updateDepartment(editing.id, editing);
      message.success('部门已更新');
    } else {
      await createDepartment(editing);
      message.success('部门已创建');
    }
    setEditOpen(false);
    actionRef.current?.reload();
  };

  const columns: ProColumns<DepartmentItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '名称', dataIndex: 'name' },
    { title: '收件邮箱', dataIndex: 'emailTo', render: (_, r) => r.emailTo ?? '-' },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    {
      title: '隐藏',
      dataIndex: 'hidden',
      width: 80,
      render: (_, r) => (r.hidden ? '是' : '否'),
    },
    { title: '创建时间', dataIndex: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 90,
      render: (_, r) =>
        access.canTicketsManage ? (
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
      <ProTable<DepartmentItem>
        rowKey="id"
        headerTitle="工单部门"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        search={false}
        request={async () => {
          const items = await getDepartments();
          return { data: items, success: true, total: items.length };
        }}
        pagination={false}
        toolBarRender={() => [
          access.canTicketsManage && (
            <Button
              key="new"
              type="primary"
              onClick={() => {
                setEditing({ name: '', emailTo: '', sortOrder: 0, hidden: false });
                setEditOpen(true);
              }}
            >
              新建部门
            </Button>
          ),
        ].filter(Boolean)}
      />

      <Modal
        title={editing?.id ? '编辑部门' : '新建部门'}
        open={editOpen}
        onOk={doSave}
        okText="保存"
        onCancel={() => setEditOpen(false)}
      >
        {editing && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              名称：
              <Input
                style={{ width: '70%' }}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div>
              收件邮箱：
              <Input
                style={{ width: '70%' }}
                value={editing.emailTo ?? ''}
                onChange={(e) => setEditing({ ...editing, emailTo: e.target.value || null })}
                placeholder="工单转发邮箱（可选）"
              />
            </div>
            <div>
              排序：
              <InputNumber
                style={{ width: 120 }}
                value={editing.sortOrder}
                onChange={(v) => setEditing({ ...editing, sortOrder: v ?? 0 })}
              />
            </div>
            <Checkbox
              checked={editing.hidden}
              onChange={(e) => setEditing({ ...editing, hidden: e.target.checked })}
            >
              在客户提交表单中隐藏
            </Checkbox>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default DepartmentList;