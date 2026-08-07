import { describe, it, expect } from "vitest";
import type { Order, Payment, Tenant } from "@amber/domain";
import { buildReceipt } from "../src/lib/receipt";

/**
 * The pre-payment bill print is what carries the scan-to-pay UPI QR, and that
 * QR encodes an AMOUNT. If the builder gets the unsettled total wrong the guest
 * pays the wrong number into the restaurant's account — a money bug with no
 * server-side backstop, since nothing about a UPI deep link is validated by us.
 * These tests pin the amount, and pin that an unpaid bill can never claim to be
 * settled.
 */

const tenant = {
  id: "t1",
  slug: "amber-grain",
  name: "Amber & Grain",
  currency: "INR",
  taxRate: 0.05,
  active: true,
  upiId: "ambergrain@okicici",
  theme: {},
  printer: {},
  loyalty: { enabled: false },
} as unknown as Tenant;

/** Two lines: 2 × 900 + 1 × 450 = 2250 subtotal. */
const order = {
  id: "o1",
  tenantId: "t1",
  status: "billed",
  rounds: [
    {
      id: "r1",
      type: "bundled",
      items: [
        { id: "i1", name: "Loaded Fries", qty: 2, unitPrice: 900, status: "served", modifiers: [] },
        { id: "i2", name: "Iced Latte", qty: 1, unitPrice: 450, status: "served", modifiers: [] },
        // Cancelled lines must not reach the paper or the QR amount.
        { id: "i3", name: "Mistake", qty: 1, unitPrice: 5000, status: "cancelled", modifiers: [] },
      ],
    },
  ],
} as unknown as Order;

function upiAmount(url: string | undefined): string | null {
  if (!url) return null;
  return new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("am");
}

describe("buildReceipt — pre-payment bill", () => {
  it("adds tax itself when there is no Payment row to read it off", () => {
    const r = buildReceipt({
      orderId: "o1",
      tableLabel: "Table 4",
      tenant,
      order,
      payment: null,
    });
    // 2250 subtotal + 5% = 2363 (rounded), NOT 2250 with zero tax.
    expect(r.subtotal).toBe(2250);
    expect(r.tax).toBe(113);
    expect(r.total).toBe(2363);
  });

  it("prints the amount the checkout screen is showing, discounts included", () => {
    const r = buildReceipt({
      orderId: "o1",
      tableLabel: "Table 4",
      tenant,
      order,
      payment: null,
      // e.g. 500 of loyalty points redeemed off the subtotal.
      bill: { subtotal: 1750, tax: 88, total: 1838 },
    });
    expect(r.total).toBe(1838);
    // The QR must ask for the discounted total, not the pre-discount one.
    expect(upiAmount(r.upiPaymentUrl)).toBe("18.38");
  });

  it("is never settled and names no payment method", () => {
    const r = buildReceipt({
      orderId: "o1",
      tableLabel: "Table 4",
      tenant,
      order,
      payment: null,
    });
    expect(r.settled).toBe(false);
    expect(r.method).toBeUndefined();
    expect(r.tendered).toBeUndefined();
  });

  it("excludes cancelled lines from the paper and the QR amount", () => {
    const r = buildReceipt({
      orderId: "o1",
      tableLabel: "Table 4",
      tenant,
      order,
      payment: null,
    });
    expect(r.lines.map((l) => l.name)).toEqual(["Loaded Fries", "Iced Latte"]);
    expect(upiAmount(r.upiPaymentUrl)).toBe("23.63");
  });

  it("carries a UPI url only while UPI is an accepted tender", () => {
    const base = { orderId: "o1", tableLabel: "Table 4", order, payment: null };

    // Unset config = every tender on (mergePaymentMethods' default).
    expect(buildReceipt({ ...base, tenant }).upiPaymentUrl).toContain("upi://pay");

    const upiOff = {
      ...tenant,
      paymentMethods: [
        { method: "cash", enabled: true },
        { method: "upi", enabled: false },
      ],
    } as unknown as Tenant;
    expect(buildReceipt({ ...base, tenant: upiOff }).upiPaymentUrl).toBeUndefined();

    const noVpa = { ...tenant, upiId: undefined } as unknown as Tenant;
    expect(buildReceipt({ ...base, tenant: noVpa }).upiPaymentUrl).toBeUndefined();
  });

  it("keeps the VPA's @ literal so UPI apps accept the QR", () => {
    const r = buildReceipt({
      orderId: "o1",
      tableLabel: "Table 4",
      tenant,
      order,
      payment: null,
    });
    expect(r.upiPaymentUrl).toContain("pa=ambergrain@okicici");
    expect(r.upiPaymentUrl).not.toContain("%40");
  });
});

describe("buildReceipt — post-payment receipt", () => {
  const payment = {
    id: "p1",
    orderId: "o1",
    method: "upi",
    subtotal: 2250,
    tax: 113,
    tip: 0,
    total: 2363,
    tendered: 2500,
    createdAt: "2026-08-07T10:00:00.000Z",
  } as unknown as Payment;

  it("takes its amounts from the captured row, not the screen or the order", () => {
    const r = buildReceipt({
      orderId: "o1",
      tableLabel: "Table 4",
      tenant,
      order,
      payment,
      // A stale/incorrect screen total must not override a captured payment.
      bill: { subtotal: 1, tax: 1, total: 2 },
    });
    expect(r.total).toBe(2363);
    expect(r.settled).toBe(true);
    expect(r.method).toBe("upi");
    expect(r.change).toBe(137);
  });
});
