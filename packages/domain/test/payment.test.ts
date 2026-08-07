import { describe, it, expect } from "vitest";
import {
  DEFAULT_PAYMENT_METHODS,
  enabledPaymentMethods,
  isPaymentMethodEnabled,
  mergePaymentMethods,
  paymentMethodSchema,
  type PaymentMethodConfig,
} from "../src/payment.js";

describe("paymentMethodSchema", () => {
  it("keeps every historical tender parseable", () => {
    // Guard against a future "we don't accept cards any more, delete it"
    // change: old Payment/Sale rows and staff lastPaymentMethod values are
    // parsed through this enum, so removing a value breaks reading history.
    for (const method of ["cash", "card", "upi"]) {
      expect(paymentMethodSchema.parse(method)).toBe(method);
    }
  });
});

describe("mergePaymentMethods", () => {
  it("treats an unconfigured tenant as accepting everything", () => {
    expect(mergePaymentMethods(undefined)).toEqual([...DEFAULT_PAYMENT_METHODS]);
    expect(mergePaymentMethods([])).toEqual([...DEFAULT_PAYMENT_METHODS]);
    expect(enabledPaymentMethods(undefined)).toEqual(["cash", "card", "upi"]);
  });

  it("keeps the tenant's saved order and appends tenders added later", () => {
    const saved: PaymentMethodConfig[] = [
      { method: "upi", enabled: true },
      { method: "cash", enabled: true },
    ];
    expect(mergePaymentMethods(saved)).toEqual([
      { method: "upi", enabled: true },
      { method: "cash", enabled: true },
      { method: "card", enabled: true },
    ]);
  });

  it("honours a disabled tender without touching the others", () => {
    const saved: PaymentMethodConfig[] = [
      { method: "cash", enabled: true },
      { method: "card", enabled: false },
      { method: "upi", enabled: true },
    ];
    expect(enabledPaymentMethods(saved)).toEqual(["cash", "upi"]);
    expect(isPaymentMethodEnabled(saved, "card")).toBe(false);
    expect(isPaymentMethodEnabled(saved, "upi")).toBe(true);
  });

  it("never leaves a checkout with zero tenders", () => {
    // A POS that can't close a bill is worse than one showing an extra
    // button, so an all-off config falls back to cash.
    const allOff: PaymentMethodConfig[] = [
      { method: "cash", enabled: false },
      { method: "card", enabled: false },
      { method: "upi", enabled: false },
    ];
    expect(enabledPaymentMethods(allOff)).toEqual(["cash"]);
  });
});
