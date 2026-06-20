import { z } from "zod";

/** POST /tables */
export const createTableSchema = z.object({
  label: z.string().trim().min(1),
  seats: z.number().int().positive().optional(),
  room: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateTableDto = z.infer<typeof createTableSchema>;

/** PATCH /tables/:id — every field optional. */
export const updateTableSchema = createTableSchema.partial();
export type UpdateTableDto = z.infer<typeof updateTableSchema>;
