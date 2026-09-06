import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import {
  checkPromoRules,
  computePromoDiscount,
  type PromoLike,
  type PromoRuleContext,
} from "../src/billing/promo.js";

function makePromo(overrides: Partial<PromoLike> = {}): PromoLike {
  return {
    id: 1,
    code: "SAVE10",
    name: "9 折券",
    type: "percent",
    value: 10,
    scope: "all",
    scopeIds: null,
    minAmount: 0,
    maxUses: null,
    perUserLimit: 1,
    newCustomerOnly: false,
    startsAt: null,
    endsAt: null,
    active: true,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PromoRuleContext> = {}): PromoRuleContext {
  return {
    subtotal: 10_000,
    productIds: [1],
    groupIds: [10],
    now: new Date("2026-09-06T00:00:00Z"),
    totalUses: 0,
    userUses: 0,
    isFirstOrder: true,
    ...overrides,
  };
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  throw new Error("预期抛出 AppError，但未抛出");
}

describe("computePromoDiscount", () => {
  it("percent：整数运算四舍五入", () => {
    expect(computePromoDiscount({ type: "percent", value: 10 }, 10_000)).toBe(1_000);
    expect(computePromoDiscount({ type: "percent", value: 100 }, 10_000)).toBe(10_000);
    expect(computePromoDiscount({ type: "percent", value: 15 }, 1050)).toBe(158); // 157.5 → 158
  });

  it("fixed：面额直减", () => {
    expect(computePromoDiscount({ type: "fixed", value: 500 }, 10_000)).toBe(500);
    expect(computePromoDiscount({ type: "fixed", value: 500 }, 300)).toBe(300);
  });

  it("percent>100 拒绝（含 0 与负数）", () => {
    expect(errorCode(() => computePromoDiscount({ type: "percent", value: 101 }, 10_000))).toBe("PROMO_INVALID");
    expect(errorCode(() => computePromoDiscount({ type: "percent", value: 0 }, 10_000))).toBe("PROMO_INVALID");
    expect(errorCode(() => computePromoDiscount({ type: "percent", value: -5 }, 10_000))).toBe("PROMO_INVALID");
    expect(errorCode(() => computePromoDiscount({ type: "percent", value: 10.5 }, 10_000))).toBe("PROMO_INVALID");
  });

  it("fixed 面额非法拒绝", () => {
    expect(errorCode(() => computePromoDiscount({ type: "fixed", value: 0 }, 10_000))).toBe("PROMO_INVALID");
    expect(errorCode(() => computePromoDiscount({ type: "fixed", value: -100 }, 10_000))).toBe("PROMO_INVALID");
  });

  it("subtotal=0 时折扣为 0 不倒贴", () => {
    expect(computePromoDiscount({ type: "percent", value: 50 }, 0)).toBe(0);
    expect(computePromoDiscount({ type: "fixed", value: 100 }, 0)).toBe(0);
  });
});

describe("checkPromoRules · 状态与时间窗", () => {
  it("inactive → PROMO_INVALID", () => {
    expect(
      errorCode(() => checkPromoRules(makePromo({ active: false }), makeCtx())),
    ).toBe("PROMO_INVALID");
  });

  it("未到生效时间 / 已过期 → PROMO_EXPIRED", () => {
    const now = makeCtx().now;
    expect(
      errorCode(() =>
        checkPromoRules(
          makePromo({ startsAt: new Date(now.getTime() + 1000) }),
          makeCtx(),
        ),
      ),
    ).toBe("PROMO_EXPIRED");
    expect(
      errorCode(() =>
        checkPromoRules(makePromo({ endsAt: new Date(now.getTime() - 1000) }), makeCtx()),
      ),
    ).toBe("PROMO_EXPIRED");
  });

  it("时间窗边界：now == startsAt / endsAt 可用", () => {
    const now = makeCtx().now;
    const discount = checkPromoRules(
      makePromo({ startsAt: now, endsAt: now }),
      makeCtx(),
    );
    expect(discount).toBe(1_000);
  });
});

describe("checkPromoRules · scope", () => {
  it("products 命中 / 未命中", () => {
    const promo = makePromo({ scope: "products", scopeIds: [2, 3] });
    expect(checkPromoRules(promo, makeCtx({ productIds: [1, 2] }))).toBe(1_000);
    expect(
      errorCode(() => checkPromoRules(promo, makeCtx({ productIds: [1] }))),
    ).toBe("PROMO_NOT_APPLICABLE");
  });

  it("groups 命中 / 未命中", () => {
    const promo = makePromo({ scope: "groups", scopeIds: [20] });
    expect(checkPromoRules(promo, makeCtx({ groupIds: [10, 20] }))).toBe(1_000);
    expect(
      errorCode(() => checkPromoRules(promo, makeCtx({ groupIds: [10] }))),
    ).toBe("PROMO_NOT_APPLICABLE");
  });

  it("scope=products 但 scopeIds 缺失视为不适用", () => {
    const promo = makePromo({ scope: "products", scopeIds: null });
    expect(errorCode(() => checkPromoRules(promo, makeCtx()))).toBe("PROMO_NOT_APPLICABLE");
  });
});

describe("checkPromoRules · minAmount 边界", () => {
  it("subtotal < minAmount 拒绝，等于通过", () => {
    const promo = makePromo({ minAmount: 10_000 });
    expect(errorCode(() => checkPromoRules(promo, makeCtx({ subtotal: 9_999 })))).toBe(
      "PROMO_NOT_APPLICABLE",
    );
    expect(checkPromoRules(promo, makeCtx({ subtotal: 10_000 }))).toBe(1_000);
  });
});

describe("checkPromoRules · newCustomerOnly", () => {
  it("非首单拒绝，首单通过", () => {
    const promo = makePromo({ newCustomerOnly: true });
    expect(errorCode(() => checkPromoRules(promo, makeCtx({ isFirstOrder: false })))).toBe(
      "PROMO_NOT_APPLICABLE",
    );
    expect(checkPromoRules(promo, makeCtx({ isFirstOrder: true }))).toBe(1_000);
  });
});

describe("checkPromoRules · 次数限制", () => {
  it("maxUses 边界：等于上限拒绝，未达通过，null 不限", () => {
    const promo = makePromo({ maxUses: 100 });
    expect(errorCode(() => checkPromoRules(promo, makeCtx({ totalUses: 100 })))).toBe(
      "PROMO_LIMIT_REACHED",
    );
    expect(checkPromoRules(promo, makeCtx({ totalUses: 99 }))).toBe(1_000);
    expect(checkPromoRules(makePromo({ maxUses: null }), makeCtx({ totalUses: 100_000 }))).toBe(1_000);
  });

  it("perUserLimit 边界", () => {
    const promo = makePromo({ perUserLimit: 2 });
    expect(errorCode(() => checkPromoRules(promo, makeCtx({ userUses: 2 })))).toBe(
      "PROMO_LIMIT_REACHED",
    );
    expect(checkPromoRules(promo, makeCtx({ userUses: 1 }))).toBe(1_000);
  });
});

describe("checkPromoRules · 组合", () => {
  it("fixed 优惠按面额返回", () => {
    const discount = checkPromoRules(makePromo({ type: "fixed", value: 2_500 }), makeCtx());
    expect(discount).toBe(2_500);
  });

  it("折扣不超 subtotal（percent 封顶）", () => {
    const discount = checkPromoRules(makePromo({ value: 100 }), makeCtx({ subtotal: 777 }));
    expect(discount).toBe(777);
  });
});
