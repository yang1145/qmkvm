import { describe, expect, it } from "vitest";
import {
  addCycle,
  addDays,
  daysBetween,
  formatDate,
  maxDate,
  parseDate,
  todayStr,
} from "../src/date-utils.js";

describe("parseDate / formatDate", () => {
  it("解析并回写 YYYY-MM-DD（UTC 基准）", () => {
    expect(formatDate(parseDate("2026-09-06"))).toBe("2026-09-06");
    expect(formatDate(parseDate("2024-02-29"))).toBe("2024-02-29");
  });

  it("拒绝非法格式与不存在的日期", () => {
    expect(() => parseDate("20260906")).toThrowError(/非法日期格式/);
    expect(() => parseDate("2026-13-01")).toThrowError(/非法日期/);
    expect(() => parseDate("2026-02-30")).toThrowError(/非法日期/);
    expect(() => parseDate("2025-02-29")).toThrowError(/非法日期/); // 平年无 2/29
    expect(() => addCycle("2026-02-30", "monthly")).toThrowError(/非法日期/);
  });
});

describe("todayStr", () => {
  it("按 UTC 取日期，忽略本地时区", () => {
    expect(todayStr(new Date("2026-09-06T23:30:00Z"))).toBe("2026-09-06");
    // 东八区 2026-09-07 05:00 = UTC 2026-09-06 21:00
    expect(todayStr(new Date("2026-09-07T05:00:00+08:00"))).toBe("2026-09-06");
  });
});

describe("addCycle", () => {
  it("onetime 原值返回", () => {
    expect(addCycle("2026-05-20", "onetime")).toBe("2026-05-20");
    expect(addCycle("2026-05-20", "onetime", "2026-01-01")).toBe("2026-05-20");
  });

  it("普通加月（monthly/quarterly/semiannually）", () => {
    expect(addCycle("2026-01-15", "monthly")).toBe("2026-02-15");
    expect(addCycle("2026-01-15", "quarterly")).toBe("2026-04-15");
    expect(addCycle("2026-01-15", "semiannually")).toBe("2026-07-15");
  });

  it("biennially / triennially 加 24 / 36 个月", () => {
    expect(addCycle("2026-01-15", "biennially")).toBe("2028-01-15");
    expect(addCycle("2026-01-15", "triennially")).toBe("2029-01-15");
  });

  it("跨年", () => {
    expect(addCycle("2025-12-15", "monthly")).toBe("2026-01-15");
    expect(addCycle("2025-11-30", "annually")).toBe("2026-11-30");
  });

  it("月末 clamp：1/31 + 1月 = 2/28", () => {
    expect(addCycle("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(addCycle("2026-03-31", "quarterly")).toBe("2026-06-30");
    expect(addCycle("2026-08-31", "monthly")).toBe("2026-09-30");
  });

  it("闰年：2024-01-31 + 1月 = 2024-02-29；2/29 + 12月 = 次年 2/28", () => {
    expect(addCycle("2024-01-31", "monthly")).toBe("2024-02-29");
    expect(addCycle("2024-02-29", "annually")).toBe("2025-02-28");
  });

  it("以 from 为基准计算（续费从 max(today, 到期日) 起算）", () => {
    expect(addCycle("2026-02-10", "monthly", "2026-01-31")).toBe("2026-02-28");
    expect(addCycle("2026-06-30", "quarterly", "2026-02-28")).toBe("2026-05-28");
    expect(addCycle("2026-06-30", "monthly", "2024-02-29")).toBe("2024-03-29");
  });
});

describe("daysBetween", () => {
  it("b - a 的自然日差", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2026-01-31", "2026-02-28")).toBe(28);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // 闰年 2/29
    expect(daysBetween("2023-02-28", "2023-03-01")).toBe(1);
  });

  it("支持负数（过去日期）", () => {
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
    expect(daysBetween("2026-12-31", "2026-01-01")).toBe(-364);
  });
});

describe("addDays / maxDate", () => {
  it("加减自然日", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-09-06", 14)).toBe("2026-09-20");
  });

  it("maxDate 取较晚日期", () => {
    expect(maxDate("2026-03-01", "2026-02-28")).toBe("2026-03-01");
    expect(maxDate("2026-01-01", "2026-12-31")).toBe("2026-12-31");
    expect(maxDate("2026-06-06", "2026-06-06")).toBe("2026-06-06");
  });
});
