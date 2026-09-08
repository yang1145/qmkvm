/** zjmf 金额解析单测：字符串分换算必须避开浮点误差（对照 PHP 版 toCents 的缺陷） */
import { describe, expect, it } from "vitest";
import { centsToYuan, parseMoneyToCents } from "../src/modules/zjmf/money.js";

describe("parseMoneyToCents", () => {
  it("解析整数元", () => {
    expect(parseMoneyToCents("25")).toBe(2500);
    expect(parseMoneyToCents("0")).toBe(0);
  });

  it("解析两位小数", () => {
    expect(parseMoneyToCents("25.00")).toBe(2500);
    expect(parseMoneyToCents("0.10")).toBe(10);
    expect(parseMoneyToCents("99.99")).toBe(9999);
  });

  it("第三位小数四舍五入", () => {
    expect(parseMoneyToCents("25.005")).toBe(2501);
    expect(parseMoneyToCents("25.004")).toBe(2500);
    expect(parseMoneyToCents("25.0051")).toBe(2501);
  });

  it("接受数字输入（Math.round 语义）", () => {
    expect(parseMoneyToCents(25)).toBe(2500);
    expect(parseMoneyToCents(25.5)).toBe(2550);
    expect(parseMoneyToCents(0.1 + 0.2)).toBe(30); // 浮点和 ≈ 0.30000000000000004 → 30 分
  });

  it("容忍千分位与货币符号", () => {
    expect(parseMoneyToCents("1,299.00")).toBe(129900);
    expect(parseMoneyToCents("¥25.00")).toBe(2500);
    expect(parseMoneyToCents("$0.99")).toBe(99);
    expect(parseMoneyToCents("40.67元")).toBe(4067); // 魔方首页余额形如 "40.67元"
  });

  it("非法输入返回 null", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-5.00")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents(undefined)).toBeNull();
    expect(parseMoneyToCents(Number.NaN)).toBeNull();
    expect(parseMoneyToCents(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("无浮点误差的经典用例", () => {
    // (int)round(4.35 * 100) 在浮点下可能是 434；字符串换算必须 435
    expect(parseMoneyToCents("4.35")).toBe(435);
    expect(parseMoneyToCents("8.40")).toBe(840);
    expect(parseMoneyToCents("1.005")).toBe(101);
  });
});

describe("centsToYuan", () => {
  it("分转元保留两位小数", () => {
    expect(centsToYuan(2500)).toBe("25.00");
    expect(centsToYuan(435)).toBe("4.35");
    expect(centsToYuan(0)).toBe("0.00");
  });
});
