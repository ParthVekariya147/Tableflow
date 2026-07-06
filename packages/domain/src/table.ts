import { z } from "zod";
import { idSchema } from "./common.js";
import { orderSchema } from "./order.js";

/** A physical table guests scan into. Scoped to a tenant. */
export const tableSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  /** Human label shown to guests/staff, e.g. "7" or "Patio 3". */
  label: z.string().min(1),
  /** Token encoded in the table's QR code. */
  qrToken: z.string().min(1),
  seats: z.number().int().positive().optional(),
  /** Room/zone the table sits in, e.g. "Main" / "Patio". */
  room: z.string().optional(),
  /** Sort order within the floor list. */
  sortOrder: z.number().int().default(0),
  /** True for the auto-created virtual "Counter Sale" table used by the
   *  no-table quick-sale flow — hidden from the normal floor plan grid. */
  isCounter: z.boolean().default(false),
});

/**
 * Floor status derived from the table's current session:
 * `free` (no open order) · `seated` (open, no items yet) ·
 * `ordering` (items in flight) · `bill` (guest requested the bill).
 */
export const tableStatusSchema = z.enum(["free", "seated", "ordering", "bill"]);

/** A table plus its live session — what the staff floor view renders. */
export const floorTableSchema = tableSchema.extend({
  status: tableStatusSchema,
  /** The currently open/billed order for this table, if any. */
  activeOrder: orderSchema.nullable(),
});

export type Table = z.infer<typeof tableSchema>;
export type TableStatus = z.infer<typeof tableStatusSchema>;
export type FloorTable = z.infer<typeof floorTableSchema>;
