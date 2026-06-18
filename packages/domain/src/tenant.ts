import { z } from "zod";
import { idSchema, slugSchema } from "./common.js";

/**
 * The Tenant is the center of the platform: each restaurant is one row.
 * The same app code loads a tenant's config at runtime and renders that
 * brand's experience. Nothing is forked per restaurant.
 */

/** A hex color like "#8c5000" or "#fff". */
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color");

/**
 * Per-tenant overrides for the semantic color tokens. All optional — a tenant
 * supplies only what differs from the baseline; the rest fall back to the
 * defaults shipped in @amber/ui. Keys mirror @amber/config's token list.
 */
export const themeColorsSchema = z
  .object({
    primary: hexColorSchema,
    "on-primary": hexColorSchema,
    "primary-container": hexColorSchema,
    "on-primary-container": hexColorSchema,
    secondary: hexColorSchema,
    "on-secondary": hexColorSchema,
    "secondary-container": hexColorSchema,
    "on-secondary-container": hexColorSchema,
    tertiary: hexColorSchema,
    background: hexColorSchema,
    "on-background": hexColorSchema,
    surface: hexColorSchema,
    "surface-container": hexColorSchema,
    "surface-container-lowest": hexColorSchema,
    "on-surface": hexColorSchema,
    "on-surface-variant": hexColorSchema,
    "inverse-surface": hexColorSchema,
    "inverse-on-surface": hexColorSchema,
    outline: hexColorSchema,
    "outline-variant": hexColorSchema,
    error: hexColorSchema,
  })
  .partial();

export const themeTypographySchema = z.object({
  /** CSS font-family stack for body text. */
  sans: z.string().default("Plus Jakarta Sans, sans-serif"),
  /** CSS font-family stack for headlines. */
  serif: z.string().default("Literata, serif"),
  /** Optional <link> hrefs to load the above (e.g. Google Fonts). */
  fontLinks: z.array(z.string().url()).default([]),
});

export const themeConfigSchema = z.object({
  colors: themeColorsSchema.default({}),
  typography: themeTypographySchema.default({}),
  /** URL of the tenant's logo/mark shown in app headers and splash. */
  logoUrl: z.string().url().optional(),
  /** Light or dark baseline the overrides sit on top of. */
  mode: z.enum(["light", "dark"]).default("light"),
});

export const tenantSchema = z.object({
  id: idSchema,
  /** URL-safe identifier used for routing/subdomain, e.g. "amber-grain". */
  slug: slugSchema,
  name: z.string().min(1),
  /** ISO-4217 currency code, e.g. "USD". Drives money formatting. */
  currency: z.string().length(3).default("USD"),
  /** Tax rate applied to bills, as a fraction (0.10 = 10%). */
  taxRate: z.number().min(0).max(1).default(0),
  theme: themeConfigSchema,
  active: z.boolean().default(true),
});

export type HexColor = z.infer<typeof hexColorSchema>;
export type ThemeColors = z.infer<typeof themeColorsSchema>;
export type ThemeTypography = z.infer<typeof themeTypographySchema>;
export type ThemeConfig = z.infer<typeof themeConfigSchema>;
export type Tenant = z.infer<typeof tenantSchema>;
