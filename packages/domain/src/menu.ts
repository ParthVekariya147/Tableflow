import { z } from "zod";
import { idSchema, moneyMinorSchema } from "./common.js";

/** Menu definitions. Every record is scoped to a tenant in the API. */

/**
 * How a modifier group is presented + behaves while ordering (see MODIFIERS.md):
 *   single   → pick one  (radio / bullet list; dropdown if many)
 *   multiple → pick many (checkboxes, bounded by min/maxSelect)
 *   toggle   → independent on/off switches, one per option
 *   text     → free text, NO options
 */
export const modifierInputTypeSchema = z.enum([
  "single",
  "multiple",
  "toggle",
  "text",
]);

/** Dietary classification shown as a corner marker on item cards. */
export const dietaryTypeSchema = z.enum(["veg", "non_veg"]);
export type DietaryType = z.infer<typeof dietaryTypeSchema>;

/** A selectable option within a group, e.g. "Large" (+150c), "Extra cheese". */
export const modifierOptionSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** Price change in minor units (cents); may be 0 or negative. */
  priceDelta: z.number().int(),
  available: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

/** A choice group attached to a menu item. */
export const modifierGroupSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  inputType: modifierInputTypeSchema,
  required: z.boolean().default(false),
  /** `multiple` bounds (min picks / max picks; null max = unlimited). */
  minSelect: z.number().int().default(0),
  maxSelect: z.number().int().nullable().default(null),
  /** `text` only: optional length cap + input hint. */
  maxLength: z.number().int().positive().nullable().default(null),
  placeholder: z.string().optional(),
  sortOrder: z.number().int().default(0),
  options: z.array(modifierOptionSchema).default([]),
});

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
  /** Image URL or inline data-URL (staff photo upload). */
  imageUrl: z.string().optional(),
  /** Material Symbols icon name used as a photo stand-in when imageUrl is unset. */
  icon: z.string().optional(),
  /** Tailwind gradient classes for the stand-in card backdrop. */
  swatch: z.string().optional(),
  /** Available to order right now. */
  available: z.boolean().default(true),
  /** Veg / Non-veg dietary marker (Indian menu convention). null = unmarked. */
  dietary: dietaryTypeSchema.nullable().default(null),
  /** Jain (no roots/onion/garlic). Independent of `dietary`; shown as a J badge. */
  jain: z.boolean().default(false),
  /** Sort order within its category. */
  sortOrder: z.number().int().default(0),
  /** Custom modifier groups (cheese, toppings, spice, notes…). */
  modifierGroups: z.array(modifierGroupSchema).default([]),
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

export type ModifierInputType = z.infer<typeof modifierInputTypeSchema>;
export type ModifierOption = z.infer<typeof modifierOptionSchema>;
export type ModifierGroup = z.infer<typeof modifierGroupSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type MenuCategory = z.infer<typeof menuCategorySchema>;
export type Menu = z.infer<typeof menuSchema>;
