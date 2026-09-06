import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { formatInvoiceNo } from "../src/billing/invoice.js";

describe("formatInvoiceNo（PHJ-YYYYMM-XXXXXX）", () => {
  it("按 UTC 年月格式化", () => {
    expect(formatInvoiceNo(new Date("2026-09-06T12:00:00Z"), "ABC123")).toBe("PHJ-202609-ABC123");
    expect(formatInvoiceNo(new Date("2026-01-01T00:00:00Z"), "ZZZ999")).toBe("PHJ-202601-ZZZ999");
  });

  it("非法后缀（小写/长度不足/特殊字符）拒绝", () => {
    for (const bad of ["abc123", "ABC12", "ABC1234", "ABC12!", ""]) {
      expect(() => formatInvoiceNo(new Date(), bad)).toThrowError(AppError);
    }
  });
});
