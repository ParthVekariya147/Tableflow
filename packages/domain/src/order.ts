import { z } from "zod";
import { idSchema, moneyMinorSchema, isoTimestampSchema } from "./common.js";

/**
 * An Order is a dine-in session for one table. It accumulates Rounds (batches
 * sent to the kitchen). Each Round holds OrderItems with their own kitchen
 * status. This mirrors the customer app's "bring it" (instant) vs "bring these"
 * (bundled) flows.
 */

/** Kitchen lifecycle for a single line item. `ready` = plated, not yet delivered. */
export const itemStatusSchema = z.enum([
  "placed",
  "preparing",
  "ready",
  "served",
  "cancelled",
]);

/** How a round reached the kitchen. */
export const roundTypeSchema = z.enum(["instant", "bundled"]);

/** Lifecycle of the whole table session. */
export const orderStatusSchema = z.enum(["open", "billed", "paid", "closed"]);

/** A chosen modifier on an order line — snapshotted so bills survive menu edits. */
export const orderItemModifierSchema = z.object({
  id: idSchema,
  /** Null for `text`, or if the source option was later deleted. */
  optionId: idSchema.nullable(),
  /** Snapshot of the group label, e.g. "Spice Level". */
  groupName: z.string().min(1),
  /** Snapshot of the chosen option name ("" for text). */
  name: z.string().default(""),
  /** Snapshot of the per-unit price change, in minor units (cents). */
  priceDelta: z.number().int().default(0),
  /** Free text for `text` groups. */
  textValue: z.string().optional(),
});

export const orderItemSchema = z.object({
  id: idSchema,
  /** Null once the source menu item is deleted — the name/price snapshot below preserves display. */
  menuItemId: idSchema.nullable(),
  /** Snapshot of name at order time (menu may change later). */
  name: z.string().min(1),
  /** Snapshot of unit price in minor units at order time. */
  unitPrice: moneyMinorSchema,
  qty: z.number().int().positive(),
  status: itemStatusSchema.default("placed"),
  notes: z.string().optional(),
  /** Chosen modifiers; their priceDelta is added per-unit to unitPrice. */
  modifiers: z.array(orderItemModifierSchema).default([]),
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
  /** Guest contact captured for the session — used on the bill/receipt. */
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().min(1).optional(),
  rounds: z.array(roundSchema).default([]),
  createdAt: isoTimestampSchema,
  closedAt: isoTimestampSchema.optional(),
  /** Set when the guest requests the bill — drives staff "Awaiting Bill". */
  billRequestedAt: isoTimestampSchema.optional(),
});

export type ItemStatus = z.infer<typeof itemStatusSchema>;
export type RoundType = z.infer<typeof roundTypeSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OrderItemModifier = z.infer<typeof orderItemModifierSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type Round = z.infer<typeof roundSchema>;
export type Order = z.infer<typeof orderSchema>;

/** Per-unit price of a line including its modifier deltas, in minor units. */
export function orderItemUnitPrice(
  item: Pick<OrderItem, "unitPrice" | "modifiers">,
): number {
  return (
    item.unitPrice +
    (item.modifiers ?? []).reduce((s, m) => s + m.priceDelta, 0)
  );
}

/** Ordered kitchen stages; index used to compare/advance progress. */
export const ITEM_STATUS_FLOW: readonly ItemStatus[] = [
  "placed",
  "preparing",
  "ready",
  "served",
] as const;

/** Subtotal (pre-tax) of an order across all rounds, in minor units. Includes
 *  each line's modifier price deltas (per-unit). */
export function orderSubtotal(order: Pick<Order, "rounds">): number {
  return order.rounds.reduce(
    (sum, round) =>
      sum + round.items.reduce((s, i) => s + orderItemUnitPrice(i) * i.qty, 0),
    0,
  );
}
