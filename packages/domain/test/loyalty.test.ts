import { describe, expect, it } from "vitest";
import {
  maxRedeemablePoints,
  pointsForSpend,
  redemptionValueMinor,
} from "../src/loyalty";

// Default-ish program: 1 point per currency unit, 100 points = 1 currency unit,
// min 100 points to redeem, redemption capped at 50% of the bill.
const program = {
  earnRatePerCurrency: 1,
  redemptionRate: 100,
  minRedeemPoints: 100,
  maxRedeemPercent: 0.5,
};

describe("pointsForSpend", () => {
  it("earns earnRate points per whole currency unit", () => {
    expect(pointsForSpend(2500, program)).toBe(25); // ₹25.00 → 25 pts
  });

  it("floors fractional currency (no points for partial units)", () => {
    expect(pointsForSpend(2599, program)).toBe(25);
    expect(pointsForSpend(99, program)).toBe(0);
  });

  it("scales with the earn rate", () => {
    expect(pointsForSpend(1000, { earnRatePerCurrency: 2.5 })).toBe(25);
  });

  it("earns nothing at a zero earn rate", () => {
    expect(pointsForSpend(5000, { earnRatePerCurrency: 0 })).toBe(0);
  });
});

describe("redemptionValueMinor", () => {
  it("converts points to minor units at the redemption rate", () => {
    // 250 points at 100 pts per currency unit → 2.50 → 250 minor
    expect(redemptionValueMinor(250, program)).toBe(250);
  });

  it("floors partial minor units", () => {
    // 150 points at rate 400 → 0.375 currency → 37 minor (floored)
    expect(redemptionValueMinor(150, { redemptionRate: 400 })).toBe(37);
  });

  it("is 0 when the redemption rate is 0 or negative (no divide-by-zero)", () => {
    expect(redemptionValueMinor(500, { redemptionRate: 0 })).toBe(0);
    expect(redemptionValueMinor(500, { redemptionRate: -1 })).toBe(0);
  });
});

describe("maxRedeemablePoints", () => {
  it("is 0 below the minimum redeemable balance", () => {
    expect(maxRedeemablePoints(10_000, 99, program)).toBe(0);
  });

  it("is limited by the guest's balance", () => {
    // Bill ₹100.00, 50% cap = ₹50.00 = 5000 pts cap; balance 300 is the binding limit.
    expect(maxRedeemablePoints(10_000, 300, program)).toBe(300);
  });

  it("is limited by maxRedeemPercent of the bill", () => {
    // Bill ₹4.00, 50% cap = ₹2.00 = 200 pts; huge balance doesn't matter.
    expect(maxRedeemablePoints(400, 100_000, program)).toBe(200);
  });

  it("never returns a negative number", () => {
    expect(maxRedeemablePoints(0, 500, program)).toBe(0);
  });

  it("allows redemption exactly at the minimum balance", () => {
    // Balance == minRedeemPoints, generous bill → whole balance is redeemable.
    expect(maxRedeemablePoints(100_000, 100, program)).toBe(100);
  });
});
