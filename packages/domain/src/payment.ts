import { z } from "zod";
import { idSchema, moneyMinorSchema, isoTimestampSchema } from "./common.js";

/**
 * How a bill was settled — the platform's full tender vocabulary.
 *
 * ⚠️ Values are NEVER removed from this enum, only hidden per tenant (see
 * `paymentMethodConfigSchema` below). Every historical `Payment`/`Sale` row and
 * every staff member's `lastPaymentMethod` is parsed through here: dropping a
 * value would make old records fail validation on read, breaking Order History,
 * analytics and receipt reprints for sales that were taken years ago. A
 * restaurant that stops accepting cards disables the tender; the sales it
 * already took on cards must still be readable forever.
 */
export const paymentMethodSchema = z.enum(["cash", "card", "upi"]);

/** Display label per tender — one source of truth for staff-facing lists. */
export const PAYMENT_METHOD_LABELS: Record<
  z.infer<typeof paymentMethodSchema>,
  string
> = { cash: "Cash", card: "Card", upi: "UPI" };

/**
 * Which tenders a tenant accepts at checkout — the POS-standard "tender type"
 * configuration (Square/Toast/Petpooja all model it this way): an ordered list
 * the merchant toggles, where disabling is **presentational only**. It hides a
 * tender from NEW checkouts; it never rewrites history and never rejects a
 * payment the API is asked to record (a stale guest phone mid-checkout must
 * still be able to settle).
 */
export const paymentMethodConfigSchema = z.object({
  method: paymentMethodSchema,
  enabled: z.boolean().default(true),
});

/** Today's behaviour: every tender on. An unconfigured tenant gets exactly this. */
export const DEFAULT_PAYMENT_METHODS: readonly z.infer<
  typeof paymentMethodConfigSchema
>[] = [
  { method: "cash", enabled: true },
  { method: "card", enabled: true },
  { method: "upi", enabled: true },
];

/**
 * Fill a tenant's saved tender config against the defaults — same "auto pick up
 * new features" pattern as `mergeReceiptSections`/`mergeQuickActions`: saved
 * order wins, tenders added to the platform later are appended enabled.
 *
 * Also enforces the one invariant a POS can't live without: **at least one
 * tender stays enabled**. A config that disables everything would leave staff
 * unable to close any bill, so cash is forced back on rather than trusting the
 * UI to have prevented it.
 */
export function mergePaymentMethods(
  saved: z.infer<typeof paymentMethodConfigSchema>[] | undefined,
): z.infer<typeof paymentMethodConfigSchema>[] {
  const base = saved?.length
    ? saved.map((m) => ({ ...m }))
    : DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }));
  for (const def of DEFAULT_PAYMENT_METHODS) {
    if (!base.some((m) => m.method === def.method)) base.push({ ...def });
  }
  if (!base.some((m) => m.enabled)) {
    const cash = base.find((m) => m.method === "cash");
    if (cash) cash.enabled = true;
    else base.unshift({ method: "cash", enabled: true });
  }
  return base;
}

/** The tenders to offer at checkout, in the tenant's configured order. */
export function enabledPaymentMethods(
  saved: z.infer<typeof paymentMethodConfigSchema>[] | undefined,
): z.infer<typeof paymentMethodSchema>[] {
  return mergePaymentMethods(saved)
    .filter((m) => m.enabled)
    .map((m) => m.method);
}

/** Whether one tender is currently offered. Unknown/unset = the default (on). */
export function isPaymentMethodEnabled(
  saved: z.infer<typeof paymentMethodConfigSchema>[] | undefined,
  method: z.infer<typeof paymentMethodSchema>,
): boolean {
  return enabledPaymentMethods(saved).includes(method);
}

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
export type PaymentMethodConfig = z.infer<typeof paymentMethodConfigSchema>;
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
