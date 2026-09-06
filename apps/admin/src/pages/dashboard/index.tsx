import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Spin, Statistic } from 'antd';
import React, { useEffect, useState } from 'react';
import { getDashboard } from '@/services/admin';
import type { DashboardDto } from '@/services/types';
import { cny } from '@/utils/format';

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '120px auto' }} />;

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

      <ProCard title="待办事项" gutter={16}>
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
    </PageContainer>
  );
};

export default Dashboard;