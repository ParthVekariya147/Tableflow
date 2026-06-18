import { z } from "zod";
import { idSchema } from "./common.js";

/** A physical table guests scan into. Scoped to a tenant. */
export const tableSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  /** Human label shown to guests/staff, e.g. "7" or "Patio 3". */
  label: z.string().min(1),
  /** Token encoded in the table's QR code. */
  qrToken: z.string().min(1),
  seats: z.number().int().positive().optional(),
});

export type Table = z.infer<typeof tableSchema>;
