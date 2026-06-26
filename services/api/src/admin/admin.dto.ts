import { z } from "zod";
import { slugSchema, themeConfigSchema } from "@amber/domain";

/** POST /admin/tenants — onboard a new restaurant. */
export const createTenantSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  currency: z.string().length(3).default("USD"),
  taxRate: z.number().min(0).max(1).default(0),
  // Theme is optional at creation; missing fields fall back to UI defaults.
  theme: themeConfigSchema.default({}),
  // Optional owner account — if supplied, creates User + Admin role + Membership.
  ownerEmail: z.string().email().optional(),
  ownerName: z.string().min(1).optional(),
  ownerPassword: z.string().min(8).optional(),
});
export type CreateTenantDto = z.infer<typeof createTenantSchema>;

/** PATCH /admin/tenants/:id — update tenant fields. */
export const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  taxRate: z.number().min(0).max(1).optional(),
  currency: z.string().length(3).optional(),
  theme: themeConfigSchema.optional(),
});
export type UpdateTenantDto = z.infer<typeof updateTenantSchema>;
