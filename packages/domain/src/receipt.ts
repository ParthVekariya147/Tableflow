import { z } from "zod";
import { moneyMinorSchema, isoTimestampSchema } from "./common.js";
import { paymentMethodSchema } from "./payment.js";
import { receiptSectionSchema } from "./printer.js";

/**
 * The generic, printer-agnostic receipt payload the web app builds and the
 * print agent renders to ESC/POS. Neither side needs to know the other's
 * printer library — this schema is the contract between them (mirrors the
 * rest of @amber/domain's "Zod is the contract" convention).
 */

export const receiptLineSchema = z.object({
  name: z.string().min(1),
  qty: z.number().int().positive(),
  /** Per-unit price including modifier deltas, in minor units (cents). */
  unitPrice: moneyMinorSchema,
  /** Flattened display strings, e.g. "Spice: Hot", ready to print as-is. */
  modifiers: z.array(z.string()).default([]),
});

export const receiptSchema = z.object({
  tenantName: z.string().min(1),
  /** Statutory/contact lines under the restaurant name (header section). */
  address: z.string().optional(),
  phone: z.string().optional(),
  gstNumber: z.string().optional(),
  fssaiNumber: z.string().optional(),
  /** Guest details captured at reservation (customerInfo section). */
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  tableLabel: z.string().min(1),
  /** Human-facing check/receipt number, derived from the order id. */
  checkNumber: z.string().min(1),
  createdAt: isoTimestampSchema,
  lines: z.array(receiptLineSchema),
  subtotal: moneyMinorSchema,
  taxRate: z.number().min(0).max(1),
  tax: moneyMinorSchema,
  gratuity: moneyMinorSchema.optional(),
  total: moneyMinorSchema,
  /**
   * Has this bill actually been paid yet? Printed from BillingPage pre-payment
   * (a "Print Bill" for the guest to review/scan-and-pay) this is `false`;
   * printed from PaymentCompletePage post-payment it's `true`. Drives two
   * automatic (not just toggle-controlled) behaviors in the agent: the UPI QR
   * section only ever prints when `false` (paying an already-paid bill again
   * makes no sense), and the payment-method line only prints when `true`
   * (there's nothing to report yet on an unpaid bill).
   */
  settled: z.boolean(),
  method: paymentMethodSchema.optional(),
  tendered: moneyMinorSchema.optional(),
  change: moneyMinorSchema.optional(),
  currency: z.string().length(3),
  footerMessage: z.string().optional(),
  /** Tenant's logo (PNG only — see services/print-agent's renderLogo). */
  logoUrl: z.string().url().optional(),
  /** Precomputed "upi://pay" deep link for a "scan to pay via UPI" QR section. */
  upiPaymentUrl: z.string().optional(),
  /** Tenant's review/rating link for a "scan to rate us" QR section. */
  reviewUrl: z.string().url().optional(),
  /** Ordered, toggle-able layout. Falls back to DEFAULT_RECEIPT_SECTIONS if unset. */
  sections: z.array(receiptSectionSchema).optional(),
});

export type ReceiptLine = z.infer<typeof receiptLineSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
