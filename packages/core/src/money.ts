/** 金额工具：全链路整数分，禁止 float 直接运算金额。 */

/** 分 → "¥39.00" 展示格式 */
export function formatCny(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${negative ? "-" : ""}¥${yuan.toLocaleString("en-US")}.${fen.toString().padStart(2, "0")}`;
}

/** 百分比折扣（percent 为 1..100 整数），四舍五入到分 */
export function applyPercent(base: number, percent: number): number {
  return Math.round((base * percent) / 100);
}

/** 取小 */
export function minAmount(a: number, b: number): number {
  return Math.min(a, b);
}

/** 分 → 元数字（仅展示用） */
export function centsToYuan(cents: number): number {
  return cents / 100;
}
