/**
 * 魔方财务金额解析：上游接口金额一律为「元」字符串（如 "25.00"），
 * 本系统金额一律为整数分。解析用字符串运算，禁止浮点参与换算
 * （对照 PHP 版 toCents 的 (int)round((float)$val*100)，消除其浮点误差路径）。
 */

/**
 * 「元」字符串/数字 → 整数分（四舍五入到分，第三位小数 ≥5 进位）。
 * 接受 "25"、"25.00"、"25.005"、25、25.5；带千分位逗号或货币符号前缀亦可。
 * 无法解析（空串/负数/非数字）返回 null。
 */
export function parseMoneyToCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100);
  }
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[,¥￥$元]/g, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const [intPart = "0", fracPart = ""] = cleaned.split(".");
  const cents =
    Number.parseInt(intPart, 10) * 100 +
    Number.parseInt((fracPart + "00").slice(0, 2), 10);
  const thirdDecimal = Number.parseInt((fracPart + "0").slice(2, 3), 10);
  return thirdDecimal >= 5 ? cents + 1 : cents;
}

/** 分 → 展示用「元」字符串（两位小数），用于日志与结果消息 */
export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}
