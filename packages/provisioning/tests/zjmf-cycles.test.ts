/** zjmf 周期键归一化与映射单测（对照 MNBT 版 matchUpCycle/cycleAliases 的联调结论） */
import { describe, expect, it } from "vitest";
import {
  cycleAliases,
  mapUpCycles,
  normCycleKey,
  resolveUpCycle,
  toLocalCycle,
} from "../src/modules/zjmf/cycles.js";

describe("normCycleKey", () => {
  it("小写化并剔除符号（保留中文）", () => {
    expect(normCycleKey("Monthly")).toBe("monthly");
    expect(normCycleKey("Half-Year")).toBe("halfyear");
    expect(normCycleKey("月付")).toBe("月付");
  });
});

describe("cycleAliases / toLocalCycle", () => {
  it("英文别名归位", () => {
    expect(toLocalCycle("monthly")).toBe("monthly");
    expect(toLocalCycle("Monthly")).toBe("monthly");
    expect(toLocalCycle("semiannually")).toBe("semiannually");
    expect(toLocalCycle("biennially")).toBe("biennially");
  });

  it("中文别名归位", () => {
    expect(toLocalCycle("月付")).toBe("monthly");
    expect(toLocalCycle("年")).toBe("annually");
    expect(toLocalCycle("半年")).toBe("semiannually");
    expect(toLocalCycle("三年付")).toBe("triennially");
  });

  it("未知周期返回 null", () => {
    expect(toLocalCycle("daily")).toBeNull();
    expect(toLocalCycle("")).toBeNull();
  });

  it("别名集合含归一化中文名", () => {
    expect(cycleAliases("monthly")).toContain("月付");
  });
});

describe("resolveUpCycle", () => {
  it("显式映射优先", () => {
    expect(resolveUpCycle({ monthly: "m1" }, "monthly", ["monthly", "month"])).toBe("m1");
  });

  it("无显式映射时按别名匹配上游可用键（大小写不敏感）", () => {
    expect(resolveUpCycle(undefined, "monthly", ["Monthly", "Quarterly"])).toBe("Monthly");
    expect(resolveUpCycle(undefined, "semiannually", ["half_year"])).toBe("half_year");
  });

  it("无匹配时回退本地周期小写", () => {
    expect(resolveUpCycle(undefined, "annually", ["年付贵价"])).toBe("annually");
    expect(resolveUpCycle(undefined, "quarterly")).toBe("quarterly");
  });
});

describe("mapUpCycles", () => {
  it("上游键列表映射为本地周期（首个命中生效）", () => {
    expect(mapUpCycles(["Monthly", "Quarterly", "月付"])).toEqual({
      monthly: "Monthly",
      quarterly: "Quarterly",
    });
  });
});
