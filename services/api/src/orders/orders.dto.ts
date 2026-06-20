import { z } from "zod";
import { roundTypeSchema } from "@amber/domain";

/** POST /orders */
export const createOrderSchema = z.object({
  tableId: z.string().min(1),
  customerName: z.string().trim().min(1).optional(),
  customerPhone: z.string().trim().min(1).optional(),
});
export type CreateOrderDto = z.infer<typeof createOrderSchema>;

/** POST /orders/:id/rounds */
export const addRoundSchema = z.object({
  type: roundTypeSchema,
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        name: z.string().min(1),
        unitPrice: z.number().int().nonnegative(),
        qty: z.number().int().positive(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
});
export type AddRoundDto = z.infer<typeof addRoundSchema>;
