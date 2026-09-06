/**
 * 优惠码管理：CRUD（ModalForm 编辑）
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { App, Button, Checkbox, DatePicker, Input, InputNumber, Modal, Select, Space, Tag } from 'antd';
import type { Dayjs } from 'dayjs';
import { useRef, useState } from 'react';
import type React from 'react';
import { createPromotion, deletePromotion, getPromotions, updatePromotion } from '@/services/admin';
import type { PromotionItem } from '@/services/types';
import { tableRequestAdapter, toQuery } from '@/utils/table';
import { cny, formatDateTime, yuanToFen } from '@/utils/format';

const SCOPE_LABEL: Record<string, string> = { all: '全场', products: '指定商品', groups: '指定分组' };

const PromotionList: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message, modal } = App.useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<PromotionItem> | null>(null);

  const openNew = () =>
    setEditing({
      code: '',
      name: '',
      type: 'percent',
      value: 0,
      scope: 'all',
      scopeIds: [],
      minAmount: 0,
      maxUses: null,
      perUserLimit: 1,
      newCustomerOnly: false,
      startsAt: null,
      endsAt: null,
      active: true,
    });

  const doSave = async () => {
    const e = editing;
    if (!e?.code?.trim() || !e?.name?.trim()) {
      message.warning('优惠码与名称不能为空');
      return;
    }
    const value = e.type === 'fixed' ? yuanToFen(e.value as number) : Number(e.value);
    if (!value || value <= 0) {
      message.warning('优惠面额必须大于 0');
      return;
    }
    const payload = {
      ...e,
      value,
      minAmount: yuanToFen(e.minAmount as number),
      startsAt: e.startsAt ?? null,
      endsAt: e.endsAt ?? null,
    };
    if (e.id) {
      await updatePromotion(e.id, payload);
      message.success('优惠码已更新');
    } else {
      await createPromotion(payload);
      message.success('优惠码已创建');
    }
    setEditOpen(false);
    actionRef.current?.reload();
  };

  const doDelete = (row: PromotionItem) => {
    modal.confirm({
      title: '删除优惠码',
      content: `确认删除优惠码「${row.code}」？`,
      okType: 'danger',
      onOk: async () => {
        await deletePromotion(row.id);
        message.success('已删除');
        actionRef.current?.reload();
      },
    });
  };

  const columns: ProColumns<PromotionItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '优惠码', dataIndex: 'code', width: 130, copyable: true, search: false },
    { title: '名称', dataIndex: 'name', ellipsis: true, search: false },
    {
      title: '类型 / 面额',
      width: 130,
      search: false,
      render: (_, r) =>
        r.type === 'percent' ? <Tag color="blue">{r.value}% 折扣</Tag> : <Tag color="purple">减 {cny(r.value)}</Tag>,
    },
    {
      title: '适用范围',
      dataIndex: 'scope',
      width: 110,
      valueType: 'select',
      valueEnum: { all: { text: '全场' }, products: { text: '指定商品' }, groups: { text: '指定分组' } },
      render: (_, r) => SCOPE_LABEL[r.scope] ?? r.scope,
    },
    { title: '最低消费', dataIndex: 'minAmount', align: 'right', width: 110, search: false, render: (_, r) => cny(r.minAmount) },
    {
      title: '使用情况',
      width: 110,
      search: false,
      render: (_, r) => (r.maxUses === null ? `${r.usedCount ?? 0} 次/不限` : `${r.usedCount ?? 0}/${r.maxUses}`),
    },
    {
      title: '每用户限用',
      dataIndex: 'perUserLimit',
      width: 100,
      search: false,
    },
    {
      title: '有效期',
      width: 220,
      search: false,
      render: (_, r) => (
        <span style={{ fontSize: 12 }}>
          {formatDateTime(r.startsAt)} ~ {formatDateTime(r.endsAt)}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'active',
      width: 90,
      valueType: 'select',
      valueEnum: { true: { text: '启用' }, false: { text: '停用' } },
      render: (_, r) =>
        r.active ? <Tag color="green">启用</Tag> : <Tag color="default" style={{ color: 'rgba(0,0,0,0.45)' }}>停用</Tag>,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 130,
      fixed: 'right',
      render: (_, r) =>
        access.canPromotionsManage ? (
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

  const e = editing;

  return (
    <PageContainer>
      <ProTable<PromotionItem>
        rowKey="id"
        headerTitle="优惠码"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        search={false}
        request={async (params) => {
          const res = await getPromotions(toQuery(params));
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        toolBarRender={() => [
          access.canPromotionsManage && (
            <Button key="new" type="primary" onClick={() => { openNew(); setEditOpen(true); }}>
              新建优惠码
            </Button>
          ),
        ].filter(Boolean)}
      />

      <Modal
        title={e?.id ? `编辑优惠码 ${e.code}` : '新建优惠码'}
        open={editOpen}
        onOk={doSave}
        okText="保存"
        width={640}
        onCancel={() => setEditOpen(false)}
      >
        {e && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              优惠码：
              <Input
                style={{ width: '65%' }}
                value={e.code}
                onChange={(ev) => setEditing({ ...e, code: ev.target.value.toUpperCase() })}
                placeholder="如 NEW10"
              />
            </div>
            <div>
              名称：
              <Input
                style={{ width: '65%' }}
                value={e.name}
                onChange={(ev) => setEditing({ ...e, name: ev.target.value })}
              />
            </div>
            <div>
              类型：
              <Select
                style={{ width: '65%' }}
                value={e.type}
                onChange={(v) => setEditing({ ...e, type: v })}
                options={[
                  { value: 'percent', label: '百分比折扣' },
                  { value: 'fixed', label: '固定金额' },
                ]}
              />
            </div>
            <div>
              面额：
              {e.type === 'percent' ? (
                <InputNumber
                  min={1}
                  max={99}
                  style={{ width: '65%' }}
                  value={e.value as number}
                  onChange={(v) => setEditing({ ...e, value: v ?? 0 })}
                  addonAfter="%"
                />
              ) : (
                <InputNumber
                  min={0.01}
                  precision={2}
                  style={{ width: '65%' }}
                  value={e.value as number}
                  onChange={(v) => setEditing({ ...e, value: v ?? 0 })}
                  addonBefore="¥"
                />
              )}
            </div>
            <div>
              适用范围：
              <Select
                style={{ width: '65%' }}
                value={e.scope}
                onChange={(v) => setEditing({ ...e, scope: v })}
                options={[
                  { value: 'all', label: '全场' },
                  { value: 'products', label: '指定商品' },
                  { value: 'groups', label: '指定分组' },
                ]}
              />
            </div>
            {e.scope !== 'all' && (
              <div>
                范围 ID（逗号分隔）：
                <Input
                  style={{ width: '50%' }}
                  placeholder="如 1,2,3"
                  value={(e.scopeIds ?? []).join(',')}
                  onChange={(ev) =>
                    setEditing({
                      ...e,
                      scopeIds: ev.target.value
                        .split(',')
                        .map((s) => Number(s.trim()))
                        .filter((n) => !Number.isNaN(n) && n > 0),
                    })
                  }
                />
              </div>
            )}
            <div>
              最低消费（元）：
              <InputNumber
                min={0}
                precision={2}
                style={{ width: '65%' }}
                value={(e.minAmount as number) / 100}
                onChange={(v) => setEditing({ ...e, minAmount: v ?? 0 })}
              />
            </div>
            <div>
              总限用次数：
              <InputNumber
                min={0}
                precision={0}
                style={{ width: '65%' }}
                value={e.maxUses ?? undefined}
                onChange={(v) => setEditing({ ...e, maxUses: v ?? null })}
                placeholder="空为不限"
              />
            </div>
            <div>
              每用户限用：
              <InputNumber
                min={1}
                precision={0}
                style={{ width: '65%' }}
                value={e.perUserLimit}
                onChange={(v) => setEditing({ ...e, perUserLimit: v ?? 1 })}
              />
            </div>
            <div>
              开始时间：
              <DatePicker
                showTime
                style={{ width: '60%' }}
                value={e.startsAt ? (e.startsAt as unknown as Dayjs) : undefined}
                onChange={(v) => setEditing({ ...e, startsAt: v ? (v.toISOString() as unknown as string) : null })}
              />
            </div>
            <div>
              结束时间：
              <DatePicker
                showTime
                style={{ width: '60%' }}
                value={e.endsAt ? (e.endsAt as unknown as Dayjs) : undefined}
                onChange={(v) => setEditing({ ...e, endsAt: v ? (v.toISOString() as unknown as string) : null })}
              />
            </div>
            <Space>
              <Checkbox
                checked={e.newCustomerOnly}
                onChange={(ev) => setEditing({ ...e, newCustomerOnly: ev.target.checked })}
              >
                仅限新客户
              </Checkbox>
              <Checkbox checked={e.active} onChange={(ev) => setEditing({ ...e, active: ev.target.checked })}>
                启用
              </Checkbox>
            </Space>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default PromotionList;