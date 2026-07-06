import { z } from "zod";
import { roundTypeSchema, itemStatusSchema, paymentMethodSchema } from "@amber/domain";

/**
 * POST /orders
 *
 * Guest contact is the trust boundary for the QR reserve flow: when present we
 * enforce a real name + phone format here (Zod is the server-side guard the
 * customer client validation backs up). They stay *optional* so staff can still
 * open a walk-in session from restaurant-admin without contact details — the
 * customer app requires them client-side on the reserve screen.
 */
export const createOrderSchema = z.object({
  tableId: z.string().min(1),
  customerName: z.string().trim().min(2).max(80).optional(),
  customerPhone: z
    .string()
    .trim()
    .min(7)
    .max(32)
    .regex(/^[0-9+()\-\s]+$/, "Invalid phone number")
    .optional(),
});
export type CreateOrderDto = z.infer<typeof createOrderSchema>;

/** A chosen modifier on a round line. The server re-resolves `optionId` and
 *  recomputes `priceDelta` from the DB — client `name`/`priceDelta` are ignored
 *  (trust boundary). `optionId` is omitted for free-text groups (use `textValue`). */
export const roundItemModifierSchema = z.object({
  optionId: z.string().min(1).optional(),
  /** Group label (used to resolve text groups + for snapshots). */
  groupName: z.string().min(1),
  name: z.string().optional(),
  priceDelta: z.number().int().optional(),
  textValue: z.string().optional(),
});

/** POST /orders/:id/rounds
 *
 * The client may supply stable `id`s for the round + each line. They become the
 * DB primary keys so the customer app, the KDS relay ticket and the persisted
 * Order all share ONE id space — letting the kitchen's status advance write back
 * to the right OrderItem (so served/preparing survives a guest refresh/resume).
 * Optional + length-capped; omit (staff walk-in) to let Prisma mint a cuid. */
export const addRoundSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  type: roundTypeSchema,
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64).optional(),
        menuItemId: z.string().min(1),
        name: z.string().min(1),
        unitPrice: z.number().int().nonnegative(),
        qty: z.number().int().positive(),
        notes: z.string().optional(),
        modifiers: z.array(roundItemModifierSchema).optional(),
      }),
    )
    .min(1),
});
export type AddRoundDto = z.infer<typeof addRoundSchema>;

/** POST /orders/:id/items — staff adds a single item to the running session. */
export const addItemSchema = z.object({
  menuItemId: z.string().min(1),
  qty: z.number().int().positive().default(1),
});
export type AddItemDto = z.infer<typeof addItemSchema>;

/**
 * PATCH /orders/:id/items/:itemId — change qty and/or advance kitchen status.
 * `qty` sets an absolute value (kept for callers that already know the target,
 * e.g. removal via qty:0). `qtyDelta` applies a relative +/-N atomically at the
 * DB layer (`{ increment }`) so two rapid taps (double-click, or two staff
 * devices on the same table) can't clobber each other the way a client-computed
 * absolute write can — prefer this for stepper-style qty changes.
 */
export const updateItemSchema = z
  .object({
    qty: z.number().int().nonnegative().optional(),
    qtyDelta: z.number().int().optional(),
    status: itemStatusSchema.optional(),
  })
  .refine((v) => v.qty === undefined || v.qtyDelta === undefined, {
    message: "Provide only one of qty or qtyDelta",
  })
  .refine(
    (v) => v.qty !== undefined || v.qtyDelta !== undefined || v.status !== undefined,
    { message: "Provide qty, qtyDelta, and/or status" },
  );
export type UpdateItemDto = z.infer<typeof updateItemSchema>;

/** POST /orders/:id/payment — settle the bill and close the session. */
export const capturePaymentSchema = z.object({
  method: paymentMethodSchema,
  tip: z.number().int().nonnegative().default(0),
  tendered: z.number().int().nonnegative().optional(),
});
export type CapturePaymentDto = z.infer<typeof capturePaymentSchema>;

/**
 * POST /orders/reclaim — re-bind an existing open session to a new device when
 * the customer lost their browser state (cleared storage / new device) but the
 * table still has their live order. Phone number is the ownership proof; the
 * server normalises both sides to the last 10 digits before comparing.
 */
export const reclaimSessionSchema = z.object({
  tableId: z.string().min(1),
  customerPhone: z.string().trim().min(7).max(32),
});
export type ReclaimSessionDto = z.infer<typeof reclaimSessionSchema>;

/**
 * POST /orders/:id/loyalty/redeem — staff-only. Applies (or, with 0, clears) a
 * points redemption as a draft on the order; finalized at capturePayment.
 */
export const redeemLoyaltyPointsSchema = z.object({
  points: z.number().int().nonnegative(),
});
export type RedeemLoyaltyPointsDto = z.infer<typeof redeemLoyaltyPointsSchema>;
