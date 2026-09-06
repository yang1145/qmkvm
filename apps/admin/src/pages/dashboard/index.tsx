/**
 * 仪表盘：顶部今日/本月概览、近 30 天 GMV 趋势与新增用户图表、待办区与最近订单。
 */
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Spin, Statistic, Table, TableProps, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { cny, formatDateTime } from '@/utils/format';
import {
  getDashboard,
  getOrders,
  getRevenueReport,
  getUserReport,
} from '@/services/admin';
import type { DashboardDto, OrderListItem } from '@/services/types';
import type { RevenuePoint, UserGrowthPoint } from '@/services/admin';

const { Text } = Typography;

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  processing: '处理中',
  completed: '已完成',
  cancelled: '已取消',
};

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardDto | null>(null);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [users, setUsers] = useState<UserGrowthPoint[]>([]);
  const [recentOrders, setRecentOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const range = {
      from: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
      to: dayjs().format('YYYY-MM-DD'),
    };
    Promise.all([
      getDashboard(),
      getRevenueReport(range),
      getUserReport(range),
      getOrders({ page: 1, pageSize: 5 }),
    ])
      .then(([dash, rev, usr, orders]) => {
        setData(dash);
        setRevenue(rev.items ?? []);
        setUsers(usr.items ?? []);
        setRecentOrders(orders.items ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '120px auto' }} />;

  const orderColumns: TableProps<OrderListItem>['columns'] = [
    { title: '订单号', dataIndex: 'id', width: 90 },
    { title: '客户', dataIndex: ['user', 'name'], render: (v, row) => v || `用户 #${row.userId}` },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: string) => ({ new: '新购', renewal: '续费', upgrade: '升级', recharge: '充值', manual: '人工' }[v] ?? v) },
    { title: '金额', dataIndex: 'total', width: 110, align: 'right' as const, render: (v: number) => cny(v) },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => ORDER_STATUS_LABEL[v] ?? v },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => formatDateTime(v) },
  ];

  return (
    <PageContainer>
      <ProCard title="今日概览" gutter={16} style={{ marginBottom: 16 }}>
        <ProCard colSpan={6}>
          <Statistic title="新增用户" value={data?.today.newUsers ?? 0} />
        </ProCard>
        <ProCard colSpan={6}>
          <Statistic title="订单数" value={data?.today.orders ?? 0} />
        </ProCard>
        <ProCard colSpan={6}>
          <Statistic title="GMV" value={cny(data?.today.gmv ?? 0)} />
        </ProCard>
        <ProCard colSpan={6}>
          <Statistic title="支付成功率" value={data?.today.paymentSuccessRate ?? 0} suffix="%" />
        </ProCard>
      </ProCard>

      <ProCard title="本月概览" gutter={16} style={{ marginBottom: 16 }}>
        <ProCard colSpan={8}>
          <Statistic title="新增用户" value={data?.month.newUsers ?? 0} />
        </ProCard>
        <ProCard colSpan={8}>
          <Statistic title="订单数" value={data?.month.orders ?? 0} />
        </ProCard>
        <ProCard colSpan={8}>
          <Statistic title="GMV" value={cny(data?.month.gmv ?? 0)} />
        </ProCard>
      </ProCard>

      <ProCard gutter={16} style={{ marginBottom: 16 }}>
        <ProCard colSpan={{ xs: 24, lg: 14 }} title="近 30 天 GMV 趋势（元）">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={revenue} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="gmvGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1677ff" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#1677ff" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => v.slice(5)}
                tick={{ fontSize: 11 }}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} width={70} />
              <Tooltip
                formatter={(v) => [`¥${Number(v).toFixed(2)}`, 'GMV']}
              />
              <Area
                type="monotone"
                dataKey="gmv"
                stroke="#1677ff"
                strokeWidth={2}
                fill="url(#gmvGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ProCard>
        <ProCard colSpan={{ xs: 24, lg: 10 }} title="近 30 天新增用户">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={users} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => v.slice(5)}
                tick={{ fontSize: 11 }}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} width={40} />
              <Tooltip formatter={(v) => [`${v} 人`, '新增用户']} />
              <Bar dataKey="count" fill="#52c41a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ProCard>
      </ProCard>

      <ProCard title="待办事项" gutter={16} style={{ marginBottom: 16 }}>
        <ProCard colSpan={{ xs: 24, sm: 12, lg: 4 }} style={{ height: '100%' }}>
          <Statistic title="未付账单" value={data?.pending.unpaidInvoices ?? 0} valueStyle={{ color: '#faad14' }} />
        </ProCard>
        <ProCard colSpan={{ xs: 24, sm: 12, lg: 4 }} style={{ height: '100%' }}>
          <Statistic title="逾期服务" value={data?.pending.overdueServices ?? 0} valueStyle={{ color: '#cf1322' }} />
        </ProCard>
        <ProCard colSpan={{ xs: 24, sm: 12, lg: 4 }} style={{ height: '100%' }}>
          <Statistic title="待回复工单" value={data?.pending.openTickets ?? 0} valueStyle={{ color: '#faad14' }} />
        </ProCard>
        <ProCard colSpan={{ xs: 24, sm: 12, lg: 4 }} style={{ height: '100%' }}>
          <Statistic title="供应任务" value={data?.pending.provisionTasks ?? 0} />
        </ProCard>
        <ProCard colSpan={{ xs: 24, sm: 12, lg: 4 }} style={{ height: '100%' }}>
          <Statistic title="死信任务" value={data?.pending.deadTasks ?? 0} valueStyle={{ color: '#cf1322' }} />
        </ProCard>
      </ProCard>

      <ProCard title="最近订单" headerBordered>
        <Table<OrderListItem>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={recentOrders}
          columns={orderColumns}
          locale={{ emptyText: <Text type="secondary">暂无订单</Text> }}
        />
      </ProCard>
    </PageContainer>
  );
};

export default Dashboard;
