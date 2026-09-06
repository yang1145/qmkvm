/**
 * 商品列表：搜索 + 上下架 + 跳转编辑
 */
import { history } from '@umijs/max';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Popconfirm, Space } from 'antd';
import { useRef } from 'react';
import type React from 'react';
import { getProducts, updateProduct } from '@/services/admin';
import type { ProductListItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { StatusTag } from '@/utils/status';
import { PRODUCT_STATUS_LABEL } from '@/services/enums';

const ProductList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message } = App.useApp();

  const toggleStatus = async (row: ProductListItem) => {
    const next = row.status === 'active' ? 'inactive' : 'active';
    await updateProduct(row.id, { status: next });
    message.success(next === 'active' ? '已上架' : '已下架');
    actionRef.current?.reload();
  };

  const columns: ProColumns<ProductListItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '商品名', dataIndex: 'name', ellipsis: true },
    { title: 'slug', dataIndex: 'slug', width: 140, ellipsis: true, search: false },
    { title: '分组', dataIndex: 'groupName', width: 120, ellipsis: true, search: false, render: (_, r) => r.groupName ?? '-' },
    { title: '模块', dataIndex: 'moduleCode', width: 110, search: false },
    {
      title: '库存',
      dataIndex: 'inStock',
      width: 110,
      search: false,
      render: (_, r) =>
        r.stockTotal === null ? (
          '不限'
        ) : (
          <span>
            {r.stockUsed}/{r.stockTotal}
          </span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      valueType: 'select',
      valueEnum: {
        active: { text: '上架' },
        inactive: { text: '下架' },
      },
      render: (_, r) => <StatusTag status={r.status} label={PRODUCT_STATUS_LABEL[r.status] ?? r.status} />,
    },
    { title: '排序', dataIndex: 'sortOrder', width: 70, search: false },
    {
      title: '定价',
      dataIndex: 'pricing',
      search: false,
      render: (_, r) =>
        (r.pricing ?? []).length ? `${r.pricing.length} 个周期` : '-',
    },
    {
      title: '操作',
      valueType: 'option',
      width: 150,
      fixed: 'right',
      render: (_, r) =>
        access.canProductsManage ? (
          <Space size={4}>
            <a onClick={() => history.push(`/products/${r.id}/edit`)}>编辑</a>
            <Popconfirm title={r.status === 'active' ? '确认下架该商品？' : '确认上架该商品？'} onConfirm={() => toggleStatus(r)}>
              <a style={{ color: r.status === 'active' ? '#faad14' : '#52c41a' }}>
                {r.status === 'active' ? '下架' : '上架'}
              </a>
            </Popconfirm>
          </Space>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<ProductListItem>
        rowKey="id"
        headerTitle="商品列表"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        request={async (params) => {
          const res = await getProducts(toQuery(params, { q: params.keyword }));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        toolBarRender={() => [
          access.canProductsManage && (
            <Button key="new" type="primary" onClick={() => history.push('/products/0/edit')}>
              新建商品
            </Button>
          ),
        ].filter(Boolean)}
      />
    </PageContainer>
  );
};

export default ProductList;