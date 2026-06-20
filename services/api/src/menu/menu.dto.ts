import { z } from "zod";

/** POST /menu/categories */
export const createCategorySchema = z.object({
  name: z.string().trim().min(1),
  sortOrder: z.number().int().optional(),
});
export type CreateCategoryDto = z.infer<typeof createCategorySchema>;

/** PATCH /menu/categories/:id — every field optional. */
export const updateCategorySchema = createCategorySchema.partial();
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;

/** POST /menu/items */
export const createItemSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  price: z.number().int().nonnegative(),
  badge: z.string().optional(),
  imageUrl: z.string().optional(),
  icon: z.string().optional(),
  swatch: z.string().optional(),
  available: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateItemDto = z.infer<typeof createItemSchema>;

/** PATCH /menu/items/:id — every field optional. */
export const updateItemSchema = createItemSchema.partial();
export type UpdateItemDto = z.infer<typeof updateItemSchema>;
