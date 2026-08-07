import { z } from "zod";
import { modifierInputTypeSchema, dietaryTypeSchema } from "@amber/domain";

/** A modifier option as authored in the admin (no id — server mints them). */
export const modifierOptionInputSchema = z.object({
  name: z.string().trim().min(1),
  priceDelta: z.number().int(), // cents; may be negative
  available: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/** A modifier group as authored in the admin. */
export const modifierGroupInputSchema = z.object({
  name: z.string().trim().min(1),
  inputType: modifierInputTypeSchema,
  required: z.boolean().optional(),
  minSelect: z.number().int().nonnegative().optional(),
  maxSelect: z.number().int().positive().nullable().optional(),
  maxLength: z.number().int().positive().nullable().optional(),
  placeholder: z.string().optional(),
  sortOrder: z.number().int().optional(),
  options: z.array(modifierOptionInputSchema).default([]),
});

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
  /** Veg / Non-veg marker; null clears it. */
  dietary: dietaryTypeSchema.nullable().optional(),
  jain: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  /** Full modifier set (replace-on-save). Omit to leave untouched on PATCH. */
  modifierGroups: z.array(modifierGroupInputSchema).optional(),
});
export type CreateItemDto = z.infer<typeof createItemSchema>;

/** PATCH /menu/items/:id — every field optional. */
export const updateItemSchema = createItemSchema.partial();
export type UpdateItemDto = z.infer<typeof updateItemSchema>;

/**
 * POST /menu/import-image — pull a pasted photo link into our own storage.
 * Only the shape is checked here; reachability, content-type, size and the
 * SSRF host guard live in `StorageService.importImageFromUrl`.
 */
export const importImageSchema = z.object({
  url: z.string().url().max(2048),
});
export type ImportImageDto = z.infer<typeof importImageSchema>;
