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
});
export type CreateTenantDto = z.infer<typeof createTenantSchema>;
