/**
 * 角色管理：权限编辑器（按域分组 checkbox）
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Checkbox, Input, Modal, Tag } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import { createRole, getRoles, updateRole } from '@/services/admin';
import type { RoleItem } from '@/services/types';
import { PERMISSION_ACCESS_MAP } from '@/access';

/** 权限点按域分组（域 = 权限点第一段） */
const GROUPED_PERMISSIONS: Record<string, { key: string; label: string }[]> = (() => {
  const LABELS: Record<string, string> = {
    'customers.read': '查看客户',
    'customers.manage': '管理客户',
    'customers.credit': '调整余额',
    'orders.read': '查看订单',
    'orders.manage': '管理订单',
    'services.read': '查看服务',
    'services.manage': '管理服务',
    'tasks.manage': '供应任务',
    'invoices.read': '查看账单',
    'invoices.manage': '管理账单',
    'transactions.read': '查看交易',
    'refunds.manage': '发起退款',
    'products.read': '查看商品',
    'products.manage': '管理商品',
    'promotions.manage': '优惠码',
    'tickets.read': '查看工单',
    'tickets.manage': '处理工单',
    'kb.manage': '知识库',
    'settings.manage': '系统设置',
    'admins.manage': '管理员',
    'audit.read': '审计日志',
    'templates.manage': '通知模板',
    'reports.read': '报表',
  };
  const grouped: Record<string, { key: string; label: string }[]> = {};
  for (const key of Object.keys(PERMISSION_ACCESS_MAP)) {
    const domain = key.split('.')[0];
    const domainLabel: Record<string, string> = {
      customers: '客户',
      orders: '订单',
      services: '服务',
      tasks: '任务',
      invoices: '账单',
      transactions: '交易',
      refunds: '退款',
      products: '商品',
      promotions: '营销',
      tickets: '工单',
      kb: '知识库',
      settings: '设置',
      admins: '权限',
      audit: '审计',
      templates: '通知',
      reports: '报表',
    };
    (grouped[domainLabel[domain] ?? domain] ??= []).push({ key, label: LABELS[key] ?? key });
  }
  return grouped;
})();

const RoleList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message, modal } = App.useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ id?: number; name: string; permissions: string[]; isSuper: boolean } | null>(
    null,
  );

  const doSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      message.warning('角色名称不能为空');
      return;
    }
    if (!editing.isSuper && editing.permissions.length === 0) {
      message.warning('请至少勾选一个权限（超级管理员除外）');
      return;
    }
    if (editing.id) {
      await updateRole(editing.id, { name: editing.name.trim(), permissions: editing.permissions, isSuper: editing.isSuper });
      message.success('角色已更新');
    } else {
      await createRole({ name: editing.name.trim(), permissions: editing.permissions, isSuper: editing.isSuper });
      message.success('角色已创建');
    }
    setEditOpen(false);
    actionRef.current?.reload();
  };

  const togglePerm = (key: string, checked: boolean) => {
    if (!editing) return;
    setEditing({
      ...editing,
      permissions: checked
        ? [...editing.permissions, key]
        : editing.permissions.filter((p) => p !== key),
    });
  };

  const columns: ProColumns<RoleItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '角色名', dataIndex: 'name' },
    {
      title: '类型',
      width: 110,
      render: (_, r) => (r.isSuper ? <Tag color="red">超级管理员</Tag> : <Tag>自定义</Tag>),
    },
    {
      title: '权限点',
      dataIndex: 'permissions',
      render: (_, r) =>
        r.isSuper ? (
          '全部权限'
        ) : (
          <span>{(r.permissions ?? []).length} 个权限点</span>
        ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 90,
      render: (_, r) =>
        access.canAdminsManage ? (
          <a
            onClick={() => {
              setEditing({ id: r.id, name: r.name, permissions: [...(r.permissions ?? [])], isSuper: r.isSuper });
              setEditOpen(true);
            }}
          >
            编辑权限
          </a>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<RoleItem>
        rowKey="id"
        headerTitle="角色管理"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        search={false}
        request={async () => {
          const items = await getRoles();
          return { data: items, success: true, total: items.length };
        }}
        pagination={false}
        toolBarRender={() => [
          access.canAdminsManage && (
            <Button
              key="new"
              type="primary"
              onClick={() => {
                setEditing({ name: '', permissions: [], isSuper: false });
                setEditOpen(true);
              }}
            >
              新建角色
            </Button>
          ),
        ].filter(Boolean)}
      />

      <Modal
        title={editing?.id ? `编辑角色：${editing.name}` : '新建角色'}
        open={editOpen}
        onOk={doSave}
        okText="保存"
        width={760}
        onCancel={() => setEditOpen(false)}
      >
        {editing && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              角色名称：
              <Input
                style={{ width: 300 }}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div>
              <Checkbox
                checked={editing.isSuper}
                onChange={(e) => setEditing({ ...editing, isSuper: e.target.checked })}
              >
                超级管理员（拥有全部权限，跳过权限检查）
              </Checkbox>
            </div>
            {!editing.isSuper && (
              <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid #f0f0f0', padding: 12, borderRadius: 8 }}>
                {Object.entries(GROUPED_PERMISSIONS).map(([domain, perms]) => (
                  <div key={domain} style={{ marginBottom: 12 }}>
                    <b>{domain}</b>
                    <div style={{ marginTop: 4 }}>
                      {perms.map((p) => (
                        <Checkbox
                          key={p.key}
                          checked={editing.permissions.includes(p.key)}
                          onChange={(e) => togglePerm(p.key, e.target.checked)}
                          style={{ marginRight: 16, marginLeft: 0 }}
                        >
                          {p.label}
                          <Tag style={{ marginLeft: 4 }} color="default">
                            {p.key}
                          </Tag>
                        </Checkbox>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default RoleList;