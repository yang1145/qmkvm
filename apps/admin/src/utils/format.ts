/**
 * 格式化工具
 */

/** 金额（分）→ 元字符串，两位小数 */
export function formatCny(fen: number | null | undefined): string {
  if (fen === null || fen === undefined || Number.isNaN(fen)) return '-';
  const yuan = fen / 100;
  return yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 金额（分）→ ¥xx.xx 展示 */
export function cny(fen: number | null | undefined): string {
  return fen === null || fen === undefined ? '-' : `¥${formatCny(fen)}`;
}

/** 元（表单输入）→ 分（整数），用于提交 */
export function yuanToFen(yuan: number | string | null | undefined): number {
  const n = typeof yuan === 'string' ? Number.parseFloat(yuan) : yuan;
  if (n === null || n === undefined || Number.isNaN(n as number)) return 0;
  return Math.round((n as number) * 100);
}

/** 日期时间 zh-CN 本地化展示 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 仅日期 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('zh-CN');
}