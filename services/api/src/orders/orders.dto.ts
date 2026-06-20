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

/** POST /orders/:id/items — staff adds a single item to the running session. */
export const addItemSchema = z.object({
  menuItemId: z.string().min(1),
  qty: z.number().int().positive().default(1),
});
export type AddItemDto = z.infer<typeof addItemSchema>;

/** PATCH /orders/:id/items/:itemId — change qty and/or advance kitchen status. */
export const updateItemSchema = z
  .object({
    qty: z.number().int().nonnegative().optional(),
    status: itemStatusSchema.optional(),
  })
  .refine((v) => v.qty !== undefined || v.status !== undefined, {
    message: "Provide qty and/or status",
  });
export type UpdateItemDto = z.infer<typeof updateItemSchema>;

/** POST /orders/:id/payment — settle the bill and close the session. */
export const capturePaymentSchema = z.object({
  method: paymentMethodSchema,
  tip: z.number().int().nonnegative().default(0),
  tendered: z.number().int().nonnegative().optional(),
});
export type CapturePaymentDto = z.infer<typeof capturePaymentSchema>;
