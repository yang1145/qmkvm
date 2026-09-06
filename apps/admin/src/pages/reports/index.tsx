/**
 * 数据中心（PRD-billing F12）：收入 / 商品销量 / 服务留存 / 用户增长 报表。
 * 时间窗：RangePicker + 近 7/30/90 天快捷，默认近 30 天。
 */
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Button, DatePicker, Space, Spin, Statistic } from 'antd';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  getProductReport,
  getRevenueReport,
  getRetentionReport,
  getUserReport,
} from '@/services/admin';
import type { ProductStat, RevenuePoint, RetentionPoint, UserGrowthPoint } from '@/services/admin';

const { RangePicker } = DatePicker;

/** 报表窗口（from 含头、to 含尾） */
const Reports: React.FC = () => {
  const [range, setRange] = useState<[string, string]>([
    dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);
  const [loading, setLoading] = useState(true);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [products, setProducts] = useState<ProductStat[]>([]);
  const [retention, setRetention] = useState<RetentionPoint[]>([]);
  const [users, setUsers] = useState<UserGrowthPoint[]>([]);

  const load = async (from: string, to: string) => {
    setLoading(true);
    try {
      const [rev, prod, ret, usr] = await Promise.all([
        getRevenueReport({ from, to }),
        getProductReport({ from, to }),
        getRetentionReport({ from, to }),
        getUserReport({ from, to }),
      ]);
      setRevenue(rev.items);
      setProducts(prod.items);
      setRetention(ret.items);
      setUsers(usr.items);
    } catch {
      // 错误由全局 request 拦截器统一提示
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(range[0], range[1]);
    // 仅首次挂载加载；后续由快捷键/日期选择触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const gmv = revenue.reduce((s, r) => s + Number(r.gmv || 0), 0);
    const orders = revenue.reduce((s, r) => s + (r.orders || 0), 0);
    const newServices = retention.reduce((s, r) => s + (r.newServices || 0), 0);
    const renewals = retention.reduce((s, r) => s + (r.renewals || 0), 0);
    const newUsers = users.reduce((s, r) => s + (r.count || 0), 0);
    const renewRate =
      newServices + renewals > 0 ? ((renewals / (newServices + renewals)) * 100).toFixed(1) : '0.0';
    return { gmv, orders, newServices, renewals, newUsers, renewRate };
  }, [revenue, retention, users]);

  const applyRange = (from: string, to: string) => {
    setRange([from, to]);
    load(from, to);
  };

  const topProducts = products.slice(0, 10);

  return (
    <PageContainer>
      <ProCard style={{ marginBottom: 16 }}>
        <Space wrap>
          <RangePicker
            value={[dayjs(range[0]), dayjs(range[1])]}
            allowClear={false}
            onChange={(v) => {
              if (v && v[0] && v[1]) {
                applyRange(v[0].format('YYYY-MM-DD'), v[1].format('YYYY-MM-DD'));
              }
            }}
          />
          <Button onClick={() => applyRange(dayjs().subtract(7, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD'))}>
            近 7 天
          </Button>
          <Button onClick={() => applyRange(dayjs().subtract(30, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD'))}>
            近 30 天
          </Button>
          <Button onClick={() => applyRange(dayjs().subtract(90, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD'))}>
            近 90 天
          </Button>
        </Space>
      </ProCard>

      <ProCard gutter={16} style={{ marginBottom: 16 }}>
        <ProCard colSpan={4}>
          <Statistic title="收入合计 (元)" value={totals.gmv.toFixed(2)} />
        </ProCard>
        <ProCard colSpan={4}>
          <Statistic title="订单数" value={totals.orders} />
        </ProCard>
        <ProCard colSpan={4}>
          <Statistic title="新增服务" value={totals.newServices} />
        </ProCard>
        <ProCard colSpan={4}>
          <Statistic title="续费单数" value={totals.renewals} />
        </ProCard>
        <ProCard colSpan={4}>
          <Statistic title="续费占比" value={totals.renewRate} suffix="%" />
        </ProCard>
        <ProCard colSpan={4}>
          <Statistic title="新增用户" value={totals.newUsers} />
        </ProCard>
      </ProCard>

      {loading ? (
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      ) : (
        <>
          <ProCard title="每日收入（元）" style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={revenue}>
                <defs>
                  <linearGradient id="gmvFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1677ff" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#1677ff" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="gmv" name="收入(元)" stroke="#1677ff" fill="url(#gmvFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </ProCard>

          <ProCard title="商品销量 Top10（按收入）" style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={Math.max(300, topProducts.length * 36 + 60)}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={160} />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" name="销量" fill="#1677ff" />
                <Bar dataKey="revenue" name="收入(元)" fill="#722ed1" />
              </BarChart>
            </ResponsiveContainer>
          </ProCard>

          <ProCard title="服务留存：新增 vs 续费" style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={retention}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="newServices" name="新增服务" stroke="#1677ff" />
                <Line type="monotone" dataKey="renewals" name="续费单" stroke="#fa8c16" />
              </LineChart>
            </ResponsiveContainer>
          </ProCard>

          <ProCard title="新增用户">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={users}>
                <defs>
                  <linearGradient id="userFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#52c41a" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#52c41a" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="count" name="新增用户" stroke="#52c41a" fill="url(#userFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </ProCard>
        </>
      )}
    </PageContainer>
  );
};

export default Reports;
