/**
 * 状态 → antd Tag 颜色语义映射
 * 绿=正常/成功/已支付；橙=提醒/待处理；红=逾期/失败/终止/死信；灰=取消/作废
 */
import { Tag } from 'antd';
import type React from 'react';

export type TagColor = 'green' | 'orange' | 'red' | 'gray' | 'blue' | 'default';

const COLOR_MAP: Record<string, TagColor> = {
  // 客户/管理员
  active: 'green',
  disabled: 'gray',
  // 订单
  pending: 'orange',
  paid: 'green',
  processing: 'blue',
  completed: 'green',
  cancelled: 'gray',
  failed: 'red',
  // 账单
  unpaid: 'orange',
  void: 'gray',
  refunded: 'gray',
  partially_refunded: 'orange',
  // 服务
  suspended_overdue: 'red',
  suspended_manual: 'orange',
  terminated: 'red',
  // 供应任务
  queued: 'orange',
  dead: 'red',
  skipped: 'gray',
  // 工单
  open: 'orange',
  answered: 'blue',
  customer_reply: 'orange',
  in_progress: 'blue',
  resolved: 'green',
  closed: 'gray',
  // 优先级
  low: 'default',
  medium: 'blue',
  high: 'orange',
  urgent: 'red',
  // 交易/退款
  success: 'green',
  // 商品
  inactive: 'gray',
};

export function statusColor(status: string): TagColor {
  return COLOR_MAP[status] ?? 'default';
}

/** 状态标签 */
export function StatusTag({ status, label }: { status: string; label: string }): React.ReactElement {
  const color = statusColor(status);
  if (color === 'gray') {
    return (
      <Tag color="default" style={{ color: 'rgba(0,0,0,0.45)' }}>
        {label}
      </Tag>
    );
  }
  return <Tag color={color}>{label}</Tag>;
}