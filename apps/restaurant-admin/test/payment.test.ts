import { describe, it, expect, vi } from "vitest";
import { ApiError } from "@amber/api-client";
import type { Payment } from "@amber/domain";
import { settlePayment, type PaymentApi } from "../src/lib/payment";

/**
 * These cover the checkout trust boundary. The rule under test is one-sided and
 * absolute: `ok: true` is returned ONLY when the server has confirmed a Payment
 * row exists. Anything less keeps staff on the billing screen with the table
 * still open.
 */

const PAYMENT: Payment = {
  id: "pay_1",
  tenantId: "t_1",
  orderId: "o_1",
  method: "cash",
  subtotal: 1000,
  tax: 100,
  tip: 0,
  total: 1100,
  createdAt: new Date().toISOString(),
};

/** Builds a fake api whose two methods are scripted per-call. */
function fakeApi(opts: {
  capture: Array<() => Promise<Payment>>;
  getPayment?: Array<() => Promise<Payment | null>>;
}): PaymentApi & { captureCalls: number; getPaymentCalls: number } {
  let captureIdx = 0;
  let getIdx = 0;
  const api = {
    captureCalls: 0,
    getPaymentCalls: 0,
    orders: {
      capturePayment: async () => {
        const step = opts.capture[Math.min(captureIdx, opts.capture.length - 1)]!;
        captureIdx += 1;
        api.captureCalls += 1;
        return step();
      },
      getPayment: async () => {
        const steps = opts.getPayment ?? [async () => null];
        const step = steps[Math.min(getIdx, steps.length - 1)]!;
        getIdx += 1;
        api.getPaymentCalls += 1;
        return step();
      },
    },
  };
  return api;
}

const ok = async () => PAYMENT;
const netFail = async (): Promise<Payment> => {
  throw new TypeError("Failed to fetch");
};
const httpFail = (status: number, message: string) => async (): Promise<Payment> => {
  throw new ApiError(status, message);
};

describe("settlePayment — successful payment", () => {
  it("settles on the happy path and reports it as a fresh charge", async () => {
    const api = fakeApi({ capture: [ok] });
    const result = await settlePayment(api, "o_1", { method: "cash", tendered: 1500 });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.alreadySettled).toBe(false);
    expect(result.payment?.total).toBe(1100);
    expect(api.captureCalls).toBe(1);
    // No reconciliation needed when the capture itself succeeded.
    expect(api.getPaymentCalls).toBe(0);
  });
});

describe("settlePayment — network failure", () => {
  it("fails closed when the request never reached the server", async () => {
    // withRetry re-sends transport drops (3 attempts), then we re-check for a
    // payment row; none exists, so this is a genuine "not charged".
    const api = fakeApi({ capture: [netFail], getPayment: [async () => null] });
    const result = await settlePayment(api, "o_1", { method: "cash" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("network");
    expect(result.message).toMatch(/NOT charged/i);
  });

  it("does NOT report failure when the write actually landed but the reply was lost", async () => {
    // The dangerous case: transport error, yet the server did record it.
    // Reporting failure here is what pushes staff into charging twice.
    const api = fakeApi({ capture: [netFail], getPayment: [async () => PAYMENT] });
    const result = await settlePayment(api, "o_1", { method: "cash" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.alreadySettled).toBe(true);
  });

  it("stays failed if the reconciliation check itself cannot reach the server", async () => {
    // We must never guess "probably fine" — no confirmation means not settled.
    const api = fakeApi({
      capture: [netFail],
      getPayment: [
        async () => {
          throw new TypeError("Failed to fetch");
        },
      ],
    });
    const result = await settlePayment(api, "o_1", { method: "cash" });
    expect(result.ok).toBe(false);
  });
});

describe("settlePayment — server error", () => {
  it("fails closed on a 500 and does not retry a server-answered request", async () => {
    const api = fakeApi({ capture: [httpFail(500, "Internal server error")] });
    const result = await settlePayment(api, "o_1", { method: "card" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("server");
    // withRetry must NOT re-send once the server has answered — that's how a
    // non-idempotent write gets duplicated.
    expect(api.captureCalls).toBe(1);
  });
});

describe("settlePayment — duplicate payment", () => {
  it("treats an already-paid order as settled when a payment row exists", async () => {
    const api = fakeApi({
      capture: [httpFail(400, "Order already paid")],
      getPayment: [async () => PAYMENT],
    });
    const result = await settlePayment(api, "o_1", { method: "cash" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.alreadySettled).toBe(true);
    expect(result.payment?.id).toBe("pay_1");
  });

  it("handles the 409 double-capture race the same way", async () => {
    const api = fakeApi({
      capture: [httpFail(409, "This order has already been paid.")],
      getPayment: [async () => PAYMENT],
    });
    const result = await settlePayment(api, "o_1", { method: "upi" });
    expect(result.ok).toBe(true);
  });

  it("does NOT claim success on a 409 when no payment exists (cancelled session)", async () => {
    // Same status code, opposite meaning — only the payment row disambiguates.
    const api = fakeApi({
      capture: [httpFail(409, "This session was cancelled and can't be paid.")],
      getPayment: [async () => null],
    });
    const result = await settlePayment(api, "o_1", { method: "cash" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("conflict");
    expect(result.message).toMatch(/cancelled/i);
  });
});

describe("settlePayment — retry after failure", () => {
  it("lets staff retry after a failed attempt and succeed", async () => {
    // First attempt: server 500. Staff tap Confirm again; second attempt works.
    const api = fakeApi({
      capture: [httpFail(500, "Internal server error"), ok],
      getPayment: [async () => null],
    });

    const first = await settlePayment(api, "o_1", { method: "cash" });
    expect(first.ok).toBe(false);

    const second = await settlePayment(api, "o_1", { method: "cash" });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.alreadySettled).toBe(false);
  });

  it("a retry after a lost response settles idempotently instead of double-charging", async () => {
    // Attempt 1: response lost (and the reconciliation check also fails) →
    // reported as not charged. Attempt 2: server says already paid, and the
    // payment row proves it → settled, exactly one charge total.
    const api = fakeApi({
      capture: [netFail, httpFail(400, "Order already paid")],
      getPayment: [
        async () => {
          throw new TypeError("Failed to fetch");
        },
        async () => PAYMENT,
      ],
    });

    const first = await settlePayment(api, "o_1", { method: "cash" });
    expect(first.ok).toBe(false);

    const second = await settlePayment(api, "o_1", { method: "cash" });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.alreadySettled).toBe(true);
  });
});

describe("settlePayment — no silent success", () => {
  it("never returns ok without a confirmed payment across every failure shape", async () => {
    const shapes = [
      httpFail(400, "bad"),
      httpFail(409, "conflict"),
      httpFail(500, "boom"),
      httpFail(503, "unavailable"),
      netFail,
    ];
    for (const shape of shapes) {
      const api = fakeApi({ capture: [shape], getPayment: [async () => null] });
      const result = await settlePayment(api, "o_1", { method: "cash" });
      expect(result.ok).toBe(false);
    }
  });
});

describe("withRetry interaction", () => {
  it("retries transport drops but gives up rather than looping forever", async () => {
    const capture = vi.fn(netFail);
    const api = fakeApi({ capture: [capture], getPayment: [async () => null] });
    await settlePayment(api, "o_1", { method: "cash" });
    // withRetry(attempts = 2) → 1 initial + 2 retries.
    expect(api.captureCalls).toBe(3);
  });
});
