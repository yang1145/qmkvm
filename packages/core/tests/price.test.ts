import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import {
  computeLineAmount,
  hasStock,
  validateAndPriceSelections,
  type ConfigGroupLike,
  type ConfigOptionLike,
  type OptionSelection,
} from "../src/billing/price.js";

const groups: ConfigGroupLike[] = [
  { id: 1, name: "CPU", type: "select", required: true },
  { id: 2, name: "内存", type: "radio", required: true },
  { id: 3, name: "流量包", type: "checkbox", required: false },
  { id: 4, name: "额外硬盘", type: "quantity", required: false },
];

const options: ConfigOptionLike[] = [
  { id: 11, groupId: 1, label: "1核", value: "1c", priceDelta: 0, setupDelta: 0 },
  { id: 12, groupId: 1, label: "2核", value: "2c", priceDelta: 1000, setupDelta: 500 },
  { id: 21, groupId: 2, label: "1GB", value: "1g", priceDelta: 500, setupDelta: 0 },
  { id: 22, groupId: 2, label: "2GB", value: "2g", priceDelta: 1500, setupDelta: 0 },
  { id: 31, groupId: 3, label: "100G", value: "100g", priceDelta: 300, setupDelta: 0 },
  { id: 32, groupId: 3, label: "200G", value: "200g", priceDelta: 500, setupDelta: 0 },
  { id: 41, groupId: 4, label: "10GB", value: "10g", priceDelta: 200, setupDelta: 100 },
];

/** 仅可选组（checkbox/quantity），用于单独测可选组行为 */
const optionalGroups: ConfigGroupLike[] = groups.filter((g) => !g.required);

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  throw new Error("预期抛出 AppError，但未抛出");
}

describe("validateAndPriceSelections · select/radio", () => {
  it("单选累加 priceDelta 与 setupDelta，生成选项摘要", () => {
    const r = validateAndPriceSelections(
      groups,
      options,
      "monthly",
      [
        { groupId: 1, optionIds: [12] },
        { groupId: 2, optionIds: [22] },
      ],
    );
    expect(r.priceDeltaSum).toBe(2500);
    expect(r.setupDeltaSum).toBe(500);
    expect(r.optionsSummary).toEqual(["CPU：2核", "内存：2GB"]);
    expect(r.selections).toHaveLength(2);
  });

  it("select/radio 多个选项报错", () => {
    const selections: OptionSelection[] = [{ groupId: 1, optionIds: [11, 12] }];
    expect(errorCode(() => validateAndPriceSelections(groups, options, "monthly", selections))).toBe(
      "CATALOG_OPTIONS_INVALID",
    );
  });

  it("required 组缺失报错（含空 optionIds）", () => {
    const missing: OptionSelection[] = [{ groupId: 2, optionIds: [21] }];
    expect(errorCode(() => validateAndPriceSelections(groups, options, "monthly", missing))).toBe(
      "CATALOG_OPTIONS_INVALID",
    );
    const empty: OptionSelection[] = [
      { groupId: 1, optionIds: [] },
      { groupId: 2, optionIds: [21] },
    ];
    expect(errorCode(() => validateAndPriceSelections(groups, options, "monthly", empty))).toBe(
      "CATALOG_OPTIONS_INVALID",
    );
  });

  it("required 组缺失时报错信息包含组名", () => {
    try {
      validateAndPriceSelections(groups, options, "monthly", [{ groupId: 2, optionIds: [21] }]);
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).message).toContain("CPU");
    }
  });
});

describe("validateAndPriceSelections · checkbox", () => {
  it("多选累加（0.5 折扣场景无关，仅求和）", () => {
    const r = validateAndPriceSelections(optionalGroups, options, "monthly", [{ groupId: 3, optionIds: [31, 32] }]);
    expect(r.priceDeltaSum).toBe(800);
    expect(r.setupDeltaSum).toBe(0);
    expect(r.optionsSummary).toEqual(["流量包：100G、200G"]);
  });

  it("可选组不选不贡献金额也不报错", () => {
    const r = validateAndPriceSelections(groups, options, "annually", [
      { groupId: 1, optionIds: [11] },
      { groupId: 2, optionIds: [21] },
    ]);
    expect(r.priceDeltaSum).toBe(500);
    expect(r.setupDeltaSum).toBe(0);
    expect(r.optionsSummary).not.toContain(expect.stringContaining("流量包"));
  });

  it("checkbox 重复选同一选项只计一次", () => {
    const r = validateAndPriceSelections(optionalGroups, options, "monthly", [{ groupId: 3, optionIds: [31, 31] }]);
    expect(r.priceDeltaSum).toBe(300);
  });

  it("checkbox 选项不属于该组报错", () => {
    const selections: OptionSelection[] = [{ groupId: 3, optionIds: [12] }];
    expect(errorCode(() => validateAndPriceSelections(optionalGroups, options, "monthly", selections))).toBe(
      "CATALOG_OPTIONS_INVALID",
    );
  });
});

describe("validateAndPriceSelections · quantity", () => {
  it("priceDelta 按数量乘，setupDelta 不乘（一次性加价）", () => {
    const r = validateAndPriceSelections(optionalGroups, options, "monthly", [
      { groupId: 4, optionIds: [41], quantity: 3 },
    ]);
    expect(r.priceDeltaSum).toBe(600); // 200 × 3
    expect(r.setupDeltaSum).toBe(100); // 不乘数量
    expect(r.optionsSummary).toEqual(["额外硬盘：10GB × 3"]);
  });

  it("quantity 缺省按 1", () => {
    const r = validateAndPriceSelections(optionalGroups, options, "monthly", [{ groupId: 4, optionIds: [41] }]);
    expect(r.priceDeltaSum).toBe(200);
    expect(r.selections[0]?.quantity).toBe(1);
  });

  it("quantity 非法（0 / 1000 / 非整数）报错", () => {
    for (const quantity of [0, 1000, 1.5]) {
      const selections: OptionSelection[] = [{ groupId: 4, optionIds: [41], quantity }];
      expect(
        errorCode(() => validateAndPriceSelections(optionalGroups, options, "monthly", selections)),
      ).toBe("CATALOG_OPTIONS_INVALID");
    }
  });

  it("quantity 型选多个选项报错", () => {
    const optionsWithTwoQty: ConfigOptionLike[] = [
      ...options,
      { id: 42, groupId: 4, label: "20GB", value: "20g", priceDelta: 400, setupDelta: 100 },
    ];
    const selections: OptionSelection[] = [{ groupId: 4, optionIds: [41, 42], quantity: 2 }];
    expect(errorCode(() => validateAndPriceSelections(optionalGroups, optionsWithTwoQty, "monthly", selections))).toBe(
      "CATALOG_OPTIONS_INVALID",
    );
  });
});

describe("validateAndPriceSelections · 非法输入", () => {
  it("selection 引用未知组报错", () => {
    const selections: OptionSelection[] = [{ groupId: 99, optionIds: [11] }];
    expect(errorCode(() => validateAndPriceSelections(groups, options, "monthly", selections))).toBe(
      "CATALOG_OPTIONS_INVALID",
    );
  });

  it("同一组重复选择报错", () => {
    const selections: OptionSelection[] = [
      { groupId: 1, optionIds: [11] },
      { groupId: 1, optionIds: [12] },
    ];
    expect(errorCode(() => validateAndPriceSelections(groups, options, "monthly", selections))).toBe(
      "CATALOG_OPTIONS_INVALID",
    );
  });

  it("非法计费周期报 VALIDATION_FAILED", () => {
    expect(
      errorCode(() =>
        validateAndPriceSelections(groups, options, "weekly" as never, []),
      ),
    ).toBe("VALIDATION_FAILED");
  });

  it("无配置组商品（空 selections）合法且加价为 0", () => {
    const r = validateAndPriceSelections([], [], "monthly", []);
    expect(r.priceDeltaSum).toBe(0);
    expect(r.setupDeltaSum).toBe(0);
    expect(r.optionsSummary).toEqual([]);
  });
});

describe("computeLineAmount / hasStock", () => {
  it("amount = unitFirst × qty + setupFee", () => {
    expect(computeLineAmount(1000, 500, 2)).toBe(2500);
    expect(computeLineAmount(1000, 0, 1)).toBe(1000);
    expect(computeLineAmount(0, 300, 3)).toBe(300);
  });

  it("库存边界：恰好售罄为不可购", () => {
    expect(hasStock(null, 100, 5)).toBe(true); // 不限量
    expect(hasStock(10, 8, 2)).toBe(true); // 恰好占满
    expect(hasStock(10, 8, 3)).toBe(false);
    expect(hasStock(10, 10, 1)).toBe(false);
  });
});
