import { describe, expect, it } from "vitest";
import { shouldRemind } from "../src/lifecycle/overdue.js";

describe("shouldRemind（到期提醒阈值：仅 T-14/7/3/1）", () => {
  it("14/7/3/1 为 true", () => {
    expect(shouldRemind(14)).toBe(true);
    expect(shouldRemind(7)).toBe(true);
    expect(shouldRemind(3)).toBe(true);
    expect(shouldRemind(1)).toBe(true);
  });

  it("其他天数均为 false", () => {
    for (const d of [15, 13, 12, 8, 6, 5, 4, 2, 0]) {
      expect(shouldRemind(d)).toBe(false);
    }
  });

  it("负数（已过期）与非法输入为 false", () => {
    for (const d of [-1, -3, -14, Number.NaN]) {
      expect(shouldRemind(d)).toBe(false);
    }
  });
});
