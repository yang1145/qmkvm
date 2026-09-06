import { describe, expect, it } from "vitest";
import { calculateProrata, previousCycleDate } from "../src/upgrade/prorata.js";

describe("previousCycleDate（用 addCycle 正向反推上期到期日）", () => {
  it("普通日期精确反推", () => {
    expect(previousCycleDate("2026-04-15", "monthly")).toBe("2026-03-15");
    expect(previousCycleDate("2026-04-15", "quarterly")).toBe("2026-01-15");
    expect(previousCycleDate("2026-04-15", "annually")).toBe("2025-04-15");
  });

  it("月末 clamp：due=2/28 反推为 1/31（非 1/28）", () => {
    expect(previousCycleDate("2026-02-28", "monthly")).toBe("2026-01-31");
  });

  it("due=7/31 反推为 6/30，周期总天数仍为 31", () => {
    const prev = previousCycleDate("2026-07-31", "monthly");
    expect(prev).toBe("2026-06-30");
  });

  it("闰年 2/29 到期日退化为 2/28，周期总天数为 366", () => {
    expect(previousCycleDate("2024-02-29", "annually")).toBe("2023-02-28");
  });

  it("onetime 原值返回", () => {
    expect(previousCycleDate("2026-05-20", "onetime")).toBe("2026-05-20");
  });
});

describe("calculateProrata", () => {
  it("整周期剩余：全额抵扣", () => {
    const r = calculateProrata({
      renewalAmount: 10_000,
      cycle: "monthly",
      nextDueDate: "2026-02-28",
      today: "2026-01-31",
      newFirstAmount: 15_000,
    });
    // 周期 1/31 → 2/28（月末 clamp 后 28 天），剩余 28 天
    expect(r.remainingDays).toBe(28);
    expect(r.cycleTotalDays).toBe(28);
    expect(r.creditFromOld).toBe(10_000);
    expect(r.payable).toBe(5_000);
    expect(r.refund).toBe(0);
  });

  it("剩余 1 天：floor 折算", () => {
    const r = calculateProrata({
      renewalAmount: 10_000,
      cycle: "monthly",
      nextDueDate: "2026-02-28",
      today: "2026-02-27",
      newFirstAmount: 15_000,
    });
    expect(r.remainingDays).toBe(1);
    expect(r.creditFromOld).toBe(Math.floor(10_000 / 28)); // 357
    expect(r.payable).toBe(15_000 - 357);
  });

  it("剩余 0 天（today = 到期日）：无抵扣", () => {
    const r = calculateProrata({
      renewalAmount: 10_000,
      cycle: "monthly",
      nextDueDate: "2026-02-28",
      today: "2026-02-28",
      newFirstAmount: 15_000,
    });
    expect(r.remainingDays).toBe(0);
    expect(r.creditFromOld).toBe(0);
    expect(r.payable).toBe(15_000);
  });

  it("负数防御（today 晚于到期日）：抵扣为 0，不产生负数应付", () => {
    const r = calculateProrata({
      renewalAmount: 10_000,
      cycle: "monthly",
      nextDueDate: "2026-02-28",
      today: "2026-03-05",
      newFirstAmount: 15_000,
    });
    expect(r.remainingDays).toBe(0);
    expect(r.creditFromOld).toBe(0);
    expect(r.payable).toBe(15_000);
    expect(r.refund).toBe(0);
  });

  it("newFirstAmount < creditFromOld：payable=0 且差额退余额", () => {
    const r = calculateProrata({
      renewalAmount: 10_000,
      cycle: "monthly",
      nextDueDate: "2026-02-28",
      today: "2026-01-31",
      newFirstAmount: 5_000,
    });
    expect(r.creditFromOld).toBe(10_000);
    expect(r.payable).toBe(0);
    expect(r.refund).toBe(5_000);
  });

  it("floor 取整（整数分运算）", () => {
    const r = calculateProrata({
      renewalAmount: 1_000,
      cycle: "monthly",
      nextDueDate: "2026-02-28",
      today: "2026-02-27",
      newFirstAmount: 2_000,
    });
    expect(r.creditFromOld).toBe(35); // floor(1000/28)
    expect(r.payable).toBe(1_965);
  });

  it("周期总天数用反推基准：7/31 到期月付周期为 31 天", () => {
    const r = calculateProrata({
      renewalAmount: 3_100,
      cycle: "monthly",
      nextDueDate: "2026-07-31",
      today: "2026-07-30",
      newFirstAmount: 10_000,
    });
    expect(r.cycleTotalDays).toBe(31);
    expect(r.remainingDays).toBe(1);
    expect(r.creditFromOld).toBe(100); // floor(3100/31)
  });

  it("闰年年付周期：2/29 到期总天数为 366", () => {
    const r = calculateProrata({
      renewalAmount: 36_600,
      cycle: "annually",
      nextDueDate: "2024-02-29",
      today: "2023-03-01",
      newFirstAmount: 50_000,
    });
    expect(r.cycleTotalDays).toBe(366);
    expect(r.remainingDays).toBe(365);
    expect(r.creditFromOld).toBe(36_500); // floor(36600×365/366)
  });

  it("onetime：无剩余价值，抵扣为 0", () => {
    const r = calculateProrata({
      renewalAmount: 10_000,
      cycle: "onetime",
      nextDueDate: "2026-02-28",
      today: "2026-01-31",
      newFirstAmount: 8_000,
    });
    expect(r.remainingDays).toBe(0);
    expect(r.creditFromOld).toBe(0);
    expect(r.payable).toBe(8_000);
  });

  it("renewalAmount 为 0 / 负数时抵扣为 0（防御）", () => {
    const base = {
      cycle: "monthly" as const,
      nextDueDate: "2026-02-28",
      today: "2026-01-31",
      newFirstAmount: 5_000,
    };
    expect(calculateProrata({ ...base, renewalAmount: 0 }).creditFromOld).toBe(0);
    expect(calculateProrata({ ...base, renewalAmount: -100 }).creditFromOld).toBe(0);
    expect(calculateProrata({ ...base, renewalAmount: -100 }).payable).toBe(5_000);
  });
});
