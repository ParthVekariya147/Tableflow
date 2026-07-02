import type { Tenant } from "@amber/domain";

/**
 * Fallback tenant so the customer app runs standalone (no backend yet).
 *
 * In production this is replaced by a fetch through @amber/api-client:
 *   const tenant = await api.tenant.bySlug(slugFromQrOrSubdomain);
 * The slug typically comes from the scanned table QR or the host/subdomain.
 */
export const defaultTenant: Tenant = {
  id: "local-amber-grain",
  slug: "amber-grain",
  name: "Amber & Grain",
  currency: "USD",
  taxRate: 0.1,
  active: true,
  theme: {
    mode: "light",
    colors: {
      primary: "#8c5000",
      "primary-container": "#e8943a",
      "secondary-container": "#fdcf49",
    },
    typography: {
      sans: "Plus Jakarta Sans, sans-serif",
      serif: "Literata, serif",
      fontLinks: [],
    },
  },
  printer: {},
};
