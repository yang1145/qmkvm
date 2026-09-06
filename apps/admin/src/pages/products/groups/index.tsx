/**
 * 商品分组管理（/product-groups CRUD）
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Modal, Input } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import {
  createProductGroup,
  deleteProductGroup,
  getProductGroups,
  updateProductGroup,
} from '@/services/admin';
import type { ProductGroupItem } from '@/services/types';

const ProductGroupList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message, modal } = App.useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<ProductGroupItem> | null>(null);

  const openNew = () => {
    setEditing({ name: '', slug: '', description: '' });
    setEditOpen(true);
  };

  const doSave = async () => {
    if (!editing?.name?.trim() || !editing?.slug?.trim()) {
      message.warning('名称与标识不能为空');
      return;
    }
    if (editing.id) {
      await updateProductGroup(editing.id, editing);
      message.success('分组已更新');
    } else {
      await createProductGroup(editing);
      message.success('分组已创建');
    }
    setEditOpen(false);
    actionRef.current?.reload();
  };

  const doDelete = (row: ProductGroupItem) => {
    modal.confirm({
      title: '删除分组',
      content: `确认删除分组「${row.name}」？分组下存在商品时可能删除失败。`,
      okType: 'danger',
      onOk: async () => {
        await deleteProductGroup(row.id);
        message.success('分组已删除');
        actionRef.current?.reload();
      },
    });
  };

  const columns: ProColumns<ProductGroupItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '名称', dataIndex: 'name', search: false },
    { title: '标识 slug', dataIndex: 'slug', search: false },
    { title: '描述', dataIndex: 'description', ellipsis: true, search: false, render: (_, r) => r.description ?? '-' },
    { title: '商品数', dataIndex: 'products', width: 90, search: false, render: (_, r) => r.products?.length ?? 0 },
    {
      title: '操作',
      valueType: 'option',
      width: 130,
      render: (_, r) =>
        access.canProductsManage ? (
          <>
            <a
              onClick={() => {
                setEditing(r);
                setEditOpen(true);
              }}
            >
              编辑
            </a>
            <a style={{ color: '#ff4d4f' }} onClick={() => doDelete(r)}>
              删除
            </a>
          </>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<ProductGroupItem>
        rowKey="id"
        headerTitle="商品分组"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        search={false}
        request={async () => {
          const items = await getProductGroups();
          return { data: items, success: true, total: items.length };
        }}
        pagination={false}
        toolBarRender={() => [
          access.canProductsManage && (
            <Button key="new" type="primary" onClick={openNew}>
              新建分组
            </Button>
          ),
        ].filter(Boolean)}
      />

      <Modal
        title={editing?.id ? '编辑分组' : '新建分组'}
        open={editOpen}
        onOk={doSave}
        okText="保存"
        onCancel={() => setEditOpen(false)}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            名称：
            <Input
              style={{ width: '70%' }}
              value={editing?.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="分组名称"
            />
          </div>
          <div>
            slug：
            <Input
              style={{ width: '70%' }}
              value={editing?.slug}
              onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
              placeholder="英文标识，如 vps"
            />
          </div>
          <Input.TextArea
            rows={3}
            value={editing?.description ?? ''}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            placeholder="分组描述（可选）"
          />
        </div>
      </Modal>
    </PageContainer>
  );
};

export default ProductGroupList;