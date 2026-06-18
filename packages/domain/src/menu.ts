import { z } from "zod";
import { idSchema, moneyMinorSchema } from "./common.js";

/** Menu definitions. Every record is scoped to a tenant in the API. */

export const menuItemSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  /** Price in minor units (cents). */
  price: moneyMinorSchema,
  category: z.string().min(1),
  /** Optional callout, e.g. "Signature" / "Popular". */
  badge: z.string().optional(),
  imageUrl: z.string().url().optional(),
  /** Available to order right now. */
  available: z.boolean().default(true),
  /** Sort order within its category. */
  sortOrder: z.number().int().default(0),
});

export const menuCategorySchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  name: z.string().min(1),
  sortOrder: z.number().int().default(0),
});

/** Convenience shape: a tenant's full menu as categories + items. */
export const menuSchema = z.object({
  categories: z.array(menuCategorySchema),
  items: z.array(menuItemSchema),
});

export type MenuItem = z.infer<typeof menuItemSchema>;
export type MenuCategory = z.infer<typeof menuCategorySchema>;
export type Menu = z.infer<typeof menuSchema>;
