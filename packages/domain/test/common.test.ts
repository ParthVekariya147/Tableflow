import { describe, expect, it } from "vitest";
import { formatMoney, slugSchema, moneyMinorSchema } from "../src/common";

describe("formatMoney", () => {
  it("formats minor units as dollars by default", () => {
    expect(formatMoney(1450)).toBe("$14.50");
  });

  it("formats zero", () => {
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("respects the currency argument", () => {
    expect(formatMoney(1450, "INR")).toBe("₹14.50");
    expect(formatMoney(1450, "EUR")).toBe("€14.50");
  });
});

describe("moneyMinorSchema", () => {
  it("accepts non-negative integers only", () => {
    expect(moneyMinorSchema.safeParse(0).success).toBe(true);
    expect(moneyMinorSchema.safeParse(1450).success).toBe(true);
    expect(moneyMinorSchema.safeParse(-1).success).toBe(false);
    expect(moneyMinorSchema.safeParse(10.5).success).toBe(false);
  });
});

describe("slugSchema", () => {
  it("accepts lowercase kebab-case", () => {
    expect(slugSchema.safeParse("amber-grain").success).toBe(true);
    expect(slugSchema.safeParse("bella-pizza-2").success).toBe(true);
  });

  it("rejects uppercase, spaces, and leading/trailing hyphens", () => {
    expect(slugSchema.safeParse("Amber-Grain").success).toBe(false);
    expect(slugSchema.safeParse("amber grain").success).toBe(false);
    expect(slugSchema.safeParse("-amber").success).toBe(false);
    expect(slugSchema.safeParse("amber-").success).toBe(false);
    expect(slugSchema.safeParse("").success).toBe(false);
  });
});
