import { z } from "zod";

/** PATCH /loyalty/accounts/:id/adjust — staff manual point correction (comp/fix). */
export const adjustLoyaltyAccountSchema = z.object({
  points: z.number().int().refine((n) => n !== 0, "points must be non-zero"),
  note: z.string().trim().max(280).optional(),
});
export type AdjustLoyaltyAccountDto = z.infer<typeof adjustLoyaltyAccountSchema>;
