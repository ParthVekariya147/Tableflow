import { z } from "zod";
import { idSchema, moneyMinorSchema, isoTimestampSchema } from "./common.js";

/** How a bill was settled. */
export const paymentMethodSchema = z.enum(["cash", "card", "upi"]);

/**
 * One Payment per Order. Money fields snapshot the bill at capture time so the
 * receipt is stable even if the menu/order changes later. All in minor units.
 */
export const paymentSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  orderId: idSchema,
  method: paymentMethodSchema,
  subtotal: moneyMinorSchema,
  tax: moneyMinorSchema,
  tip: moneyMinorSchema.default(0),
  /** subtotal + tax + tip. */
  total: moneyMinorSchema,
  /** Cash handed over (null/absent for card). Change = tendered - total. */
  tendered: moneyMinorSchema.optional(),
  createdAt: isoTimestampSchema,
});

/** A completed sale, denormalized for staff dashboards (sales feed/analytics). */
export const saleSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  tableLabel: z.string(),
  method: paymentMethodSchema,
  total: moneyMinorSchema,
  createdAt: isoTimestampSchema,
});

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type Sale = z.infer<typeof saleSchema>;

/**
 * Builds a `upi://pay` deep link — used both for the live checkout QR
 * (BillingPage) and an optional "scan to pay via UPI" section on printed
 * receipts. UPI is India-specific regardless of the tenant's own currency, so
 * `cu` is always "INR". The VPA (`pa`) must NOT be percent-encoded — the `@`
 * has to stay literal or UPI apps reject the QR as invalid; only the
 * human-readable `pn`/`tn` fields are encoded.
 */
export function buildUpiPaymentUrl(params: {
  upiId: string;
  payeeName: string;
  amountCents: number;
  note: string;
}): string {
  const amount = (params.amountCents / 100).toFixed(2);
  return `upi://pay?pa=${params.upiId}&pn=${encodeURIComponent(params.payeeName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(params.note)}`;
}
