/**
 * 管理员管理：列表 + 新建/编辑（重置密码、角色分配、启用禁用）
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Input, InputNumber, Modal, Select, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { createAdmin, getAdmins, getRoles, updateAdmin } from '@/services/admin';
import type { AdminUserItem, RoleItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { formatDateTime } from '@/utils/format';
import { StatusTag } from '@/utils/status';
import { USER_STATUS_LABEL } from '@/services/enums';

const AdminList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message, modal } = App.useApp();
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{
    id?: number;
    username: string;
    name: string;
    roleId?: number;
    password: string;
    status: 'active' | 'disabled';
  } | null>(null);

  const loadRoles = () => {
    getRoles().then(setRoles).catch(() => {});
  };
  useEffect(loadRoles, []);

  const doSave = async () => {
    if (!editing) return;
    if (!editing.id && (!editing.username.trim() || !editing.password)) {
      message.warning('用户名与初始密码不能为空');
      return;
    }
    if (!editing.roleId) {
      message.warning('请选择角色');
      return;
    }
    if (editing.id) {
      await updateAdmin(editing.id, {
        name: editing.name || undefined,
        roleId: editing.roleId,
        status: editing.status,
        ...(editing.password ? { password: editing.password } : {}),
      });
      message.success('管理员已更新');
    } else {
      await createAdmin({
        username: editing.username.trim(),
        password: editing.password,
        name: editing.name || undefined,
        roleId: editing.roleId,
      });
      message.success('管理员已创建');
    }
    setEditOpen(false);
    actionRef.current?.reload();
  };

  const toggleStatus = (row: AdminUserItem) => {
    const next = row.status === 'active' ? 'disabled' : 'active';
    modal.confirm({
      title: next === 'disabled' ? '禁用管理员' : '启用管理员',
      content: `确认${next === 'disabled' ? '禁用' : '启用'}管理员「${row.username}」？`,
      okType: next === 'disabled' ? 'danger' : 'primary',
      onOk: async () => {
        await updateAdmin(row.id, { status: next });
        message.success('已更新');
        actionRef.current?.reload();
      },
    });
  };

  const columns: ProColumns<AdminUserItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '用户名', dataIndex: 'username', width: 140, search: false },
    { title: '姓名', dataIndex: 'name', search: false, render: (_, r) => r.name ?? '-' },
    {
      title: '角色',
      dataIndex: 'roleId',
      width: 130,
      valueType: 'select',
      fieldProps: { options: roles.map((r) => ({ value: r.id, label: r.name })) },
      render: (_, r) => r.roleName ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      search: false,
      render: (_, r) => <StatusTag status={r.status} label={USER_STATUS_LABEL[r.status] ?? r.status} />,
    },
    { title: '最后登录', dataIndex: 'lastLoginAt', search: false, render: (_, r) => formatDateTime(r.lastLoginAt) },
    { title: '创建时间', dataIndex: 'createdAt', search: false, render: (_, r) => formatDateTime(r.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      width: 140,
      fixed: 'right',
      render: (_, r) =>
        access.canAdminsManage ? (
          <Space size={4}>
            <a
              onClick={() => {
                setEditing({
                  id: r.id,
                  username: r.username,
                  name: r.name ?? '',
                  roleId: r.roleId ?? undefined,
                  password: '',
                  status: r.status,
                });
                setEditOpen(true);
              }}
            >
              编辑
            </a>
            <a style={{ color: r.status === 'active' ? '#ff4d4f' : '#52c41a' }} onClick={() => toggleStatus(r)}>
              {r.status === 'active' ? '禁用' : '启用'}
            </a>
          </Space>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<AdminUserItem>
        rowKey="id"
        headerTitle="管理员"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        search={false}
        request={async (params) => {
          const res = await getAdmins(toQuery(params));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        toolBarRender={() => [
          access.canAdminsManage && (
            <Button
              key="new"
              type="primary"
              onClick={() => {
                setEditing({ username: '', name: '', roleId: undefined, password: '', status: 'active' });
                setEditOpen(true);
              }}
            >
              新建管理员
            </Button>
          ),
        ].filter(Boolean)}
      />

      <Modal
        title={editing?.id ? `编辑管理员 ${editing.username}` : '新建管理员'}
        open={editOpen}
        onOk={doSave}
        okText="保存"
        onCancel={() => setEditOpen(false)}
      >
        {editing && (
          <div style={{ display: 'grid', gap: 12 }}>
            {!editing.id && (
              <div>
                用户名：
                <Input
                  style={{ width: '70%' }}
                  value={editing.username}
                  onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                  placeholder="登录用户名"
                />
              </div>
            )}
            <div>
              姓名：
              <Input
                style={{ width: '70%' }}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="显示姓名（可选）"
              />
            </div>
            <div>
              {editing.id ? '新密码（留空不修改）：' : '初始密码：'}
              <Input.Password
                style={{ width: '70%' }}
                value={editing.password}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                placeholder={editing.id ? '留空表示不修改密码' : '至少 8 位'}
              />
            </div>
            <div>
              角色：
              <Select
                style={{ width: '70%' }}
                value={editing.roleId}
                onChange={(v) => setEditing({ ...editing, roleId: v })}
                options={roles.map((r) => ({ value: r.id, label: r.name + (r.isSuper ? '（超级）' : '') }))}
                placeholder="选择角色"
              />
            </div>
            <div>
              状态：
              <Select
                style={{ width: 160 }}
                value={editing.status}
                onChange={(v) => setEditing({ ...editing, status: v })}
                options={[
                  { value: 'active', label: '正常' },
                  { value: 'disabled', label: '禁用' },
                ]}
              />
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default AdminList;