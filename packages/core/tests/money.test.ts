import { describe, expect, it } from "vitest";
import { applyPercent, centsToYuan, formatCny, minAmount } from "../src/money.js";

describe("formatCny", () => {
  it("基本格式（分 → ¥x.xx）", () => {
    expect(formatCny(0)).toBe("¥0.00");
    expect(formatCny(3900)).toBe("¥39.00");
    expect(formatCny(5)).toBe("¥0.05");
    expect(formatCny(100000)).toBe("¥1,000.00");
    expect(formatCny(1234567)).toBe("¥12,345.67");
  });

  it("负数金额", () => {
    expect(formatCny(-3900)).toBe("-¥39.00");
    expect(formatCny(-5)).toBe("-¥0.05");
  });
});

describe("applyPercent 边界", () => {
  it("常规与边界（1..100）", () => {
    expect(applyPercent(10_000, 1)).toBe(100);
    expect(applyPercent(10_000, 10)).toBe(1_000);
    expect(applyPercent(10_000, 100)).toBe(10_000);
    expect(applyPercent(7, 100)).toBe(7);
  });

  it("四舍五入到分（整数运算）", () => {
    expect(applyPercent(999, 1)).toBe(10); // 9.99 → 10
    expect(applyPercent(1050, 15)).toBe(158); // 157.5 → 158（.5 进位）
    expect(applyPercent(1010, 15)).toBe(152); // 151.5 → 152
    expect(applyPercent(3, 50)).toBe(2); // 1.5 → 2
    expect(applyPercent(1, 50)).toBe(1); // 0.5 → 1
  });

  it("0 基数与负数基数", () => {
    expect(applyPercent(0, 10)).toBe(0);
    expect(applyPercent(-10_000, 10)).toBe(-1_000);
  });
});

describe("minAmount", () => {
  it("取小", () => {
    expect(minAmount(1, 2)).toBe(1);
    expect(minAmount(2, 1)).toBe(1);
    expect(minAmount(0, 100)).toBe(0);
    expect(minAmount(-1, 5)).toBe(-1);
  });
});

describe("centsToYuan", () => {
  it("分 → 元", () => {
    expect(centsToYuan(3900)).toBe(39);
    expect(centsToYuan(1)).toBe(0.01);
  });
});
