import { ApiError } from "@amber/api-client";
import type { Payment, PaymentMethod } from "@amber/domain";
import { withRetry } from "./retry";

/**
 * Settling a bill is the one action in this app where guessing is unacceptable
 * in BOTH directions:
 *
 *  - Claiming success when the server never recorded the payment closes the
 *    table and shows staff a "Session Completed" screen for a guest who never
 *    paid.
 *  - Claiming failure when the server DID record it pushes staff to charge the
 *    guest a second time.
 *
 * The awkward case is a lost response: the request commits server-side but the
 * reply never arrives (wifi blip, tab backgrounded, proxy timeout). `withRetry`
 * re-sends those (it only retries transport-level drops), and the retry then
 * hits an already-paid order and comes back 400/409 — indistinguishable, from
 * the error alone, from a genuine "this session was cancelled" conflict.
 *
 * So a 400/409 is never trusted on its own: we go and ask the server whether a
 * Payment row actually exists for the order. A payment that exists means the
 * bill is settled (by our own lost retry, or by another till racing us) and the
 * checkout can complete idempotently. No payment row means a real failure and
 * staff stay on the billing screen.
 *
 * The invariant this exists to guarantee: **`ok: true` is only ever returned
 * when the server has confirmed a Payment.**
 */

export type SettleFailureReason =
  /** Never reached the server (offline, DNS, connection refused, timeout). */
  | "network"
  /** Server answered, refused, and no payment exists (e.g. session cancelled). */
  | "conflict"
  /** Server answered 5xx. */
  | "server"
  | "unknown";

export type SettleResult =
  | { ok: true; payment: Payment | null; alreadySettled: boolean }
  | { ok: false; reason: SettleFailureReason; message: string };

/** The slice of the api-client this needs — keeps it trivially fakeable in tests. */
export interface PaymentApi {
  orders: {
    capturePayment: (
      orderId: string,
      input: { method: PaymentMethod; tip?: number; tendered?: number },
    ) => Promise<Payment>;
    getPayment: (orderId: string) => Promise<Payment | null>;
  };
}

export interface SettleInput {
  method: PaymentMethod;
  tendered?: number;
  tip?: number;
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}

export async function settlePayment(
  api: PaymentApi,
  orderId: string,
  input: SettleInput,
): Promise<SettleResult> {
  try {
    const payment = await withRetry(() =>
      api.orders.capturePayment(orderId, input),
    );
    return { ok: true, payment, alreadySettled: false };
  } catch (e) {
    if (!(e instanceof ApiError)) {
      // No response was ever received — withRetry already exhausted its
      // attempts. The write MAY still have landed, so we must not assume
      // failure blindly either: check for a payment row before giving up.
      const reconciled = await findExistingPayment(api, orderId);
      if (reconciled) {
        return { ok: true, payment: reconciled, alreadySettled: true };
      }
      // Deliberately NOT the raw error text: a transport failure surfaces as
      // "Failed to fetch"/"NetworkError", which tells a cashier nothing. They
      // need to know the state of the bill, so state it plainly.
      return {
        ok: false,
        reason: "network",
        message:
          "Couldn't reach the server — the bill was NOT charged. Check the connection and try again.",
      };
    }

    // 400 "Order already paid" / 409 "already been paid" are the lost-response
    // signature. 409 is also a genuine "this session was cancelled". Only the
    // presence of a Payment row can tell them apart.
    if (e.status === 400 || e.status === 409) {
      const existing = await findExistingPayment(api, orderId);
      if (existing) {
        return { ok: true, payment: existing, alreadySettled: true };
      }
      return {
        ok: false,
        reason: "conflict",
        message: messageOf(e, "This session can no longer be charged."),
      };
    }

    return {
      ok: false,
      reason: e.status >= 500 ? "server" : "unknown",
      message: messageOf(e, "The payment could not be completed. Try again."),
    };
  }
}

/**
 * Ask the server whether this order already has a captured payment. Any error
 * here (including another network drop) returns null — "we could not confirm",
 * which the caller must treat as NOT settled. Confirmation only ever comes
 * from a real payment row.
 */
async function findExistingPayment(
  api: PaymentApi,
  orderId: string,
): Promise<Payment | null> {
  try {
    return await api.orders.getPayment(orderId);
  } catch {
    return null;
  }
}
