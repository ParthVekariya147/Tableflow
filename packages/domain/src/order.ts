import { z } from "zod";
import { idSchema, moneyMinorSchema, isoTimestampSchema } from "./common.js";

/**
 * An Order is a dine-in session for one table. It accumulates Rounds (batches
 * sent to the kitchen). Each Round holds OrderItems with their own kitchen
 * status. This mirrors the customer app's "bring it" (instant) vs "bring these"
 * (bundled) flows.
 */

/** Kitchen lifecycle for a single line item. */
export const itemStatusSchema = z.enum([
  "placed",
  "preparing",
  "served",
  "cancelled",
]);

/** How a round reached the kitchen. */
export const roundTypeSchema = z.enum(["instant", "bundled"]);

/** Lifecycle of the whole table session. */
export const orderStatusSchema = z.enum(["open", "billed", "paid", "closed"]);

export const orderItemSchema = z.object({
  id: idSchema,
  menuItemId: idSchema,
  /** Snapshot of name at order time (menu may change later). */
  name: z.string().min(1),
  /** Snapshot of unit price in minor units at order time. */
  unitPrice: moneyMinorSchema,
  qty: z.number().int().positive(),
  status: itemStatusSchema.default("placed"),
  notes: z.string().optional(),
});

export const roundSchema = z.object({
  id: idSchema,
  type: roundTypeSchema,
  items: z.array(orderItemSchema).min(1),
  createdAt: isoTimestampSchema,
});

export const orderSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  tableId: idSchema,
  status: orderStatusSchema.default("open"),
  rounds: z.array(roundSchema).default([]),
  createdAt: isoTimestampSchema,
  closedAt: isoTimestampSchema.optional(),
});

export type ItemStatus = z.infer<typeof itemStatusSchema>;
export type RoundType = z.infer<typeof roundTypeSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type Round = z.infer<typeof roundSchema>;
export type Order = z.infer<typeof orderSchema>;

/** Ordered kitchen stages; index used to compare/advance progress. */
export const ITEM_STATUS_FLOW: readonly ItemStatus[] = [
  "placed",
  "preparing",
  "served",
] as const;

/** Subtotal (pre-tax) of an order across all rounds, in minor units. */
export function orderSubtotal(order: Pick<Order, "rounds">): number {
  return order.rounds.reduce(
    (sum, round) =>
      sum + round.items.reduce((s, i) => s + i.unitPrice * i.qty, 0),
    0,
  );
}
