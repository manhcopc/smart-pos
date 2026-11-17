import { describe, expect, it } from "vitest";
import {
  calculateEffectiveIncomingUnitCost,
  calculateLineSubtotal,
  calculatePercentAmount,
  calculateWeightedAverageCost,
  formatMoney,
  formatQuantity,
  parseMoney,
  parseQuantity,
} from "../money";

describe("fixed-point money and inventory math", () => {
  it("avoids floating-point drift on decimal money parsing and formatting", () => {
    const a = parseMoney("0.10");
    const b = parseMoney("0.20");
    expect(formatMoney(a + b)).toBe("0.30");

    const vnd = parseMoney("150000");
    expect(formatMoney(vnd)).toBe("150000.00");
  });

  it("computes fractional quantity line totals accurately", () => {
    const qty = parseQuantity("1.250");
    const price = parseMoney("45000.00");
    expect(formatQuantity(qty)).toBe("1.250");
    expect(formatMoney(calculateLineSubtotal(qty, price))).toBe("56250.00");
  });

  it("computes VAT / percentage amounts with half-up rounding", () => {
    const base = parseMoney("1000.00");
    expect(formatMoney(calculatePercentAmount(base, "8.00"))).toBe("80.00");
    expect(formatMoney(calculatePercentAmount(parseMoney("10.05"), "10"))).toBe("1.01");
  });

  it("computes weighted average cost (AVCO) on incoming stock", () => {
    const nextAvg = calculateWeightedAverageCost(
      parseQuantity("10"),
      parseMoney("10000"),
      parseQuantity("5"),
      parseMoney("13000"),
    );
    expect(formatMoney(nextAvg)).toBe("11000.00");
  });

  it("rejects non-finite values or excess decimal precision", () => {
    expect(() => parseMoney(Number.NaN)).toThrow(RangeError);
    expect(() => parseMoney("10.123")).toThrow(RangeError);
    expect(() => parseQuantity("1.2345")).toThrow(RangeError);
  });

  it("computes effective incoming unit cost after line discount and handles negative pre-stock clamp", () => {
    const effective = calculateEffectiveIncomingUnitCost(
      parseQuantity("10"),
      parseMoney("20000"),
      parseMoney("10000"),
    );
    expect(formatMoney(effective)).toBe("19000.00");

    const nextAvg = calculateWeightedAverageCost(
      parseQuantity("-2"),
      parseMoney("50000"),
      parseQuantity("5"),
      effective,
    );
    expect(formatMoney(nextAvg)).toBe("19000.00");
  });
});
