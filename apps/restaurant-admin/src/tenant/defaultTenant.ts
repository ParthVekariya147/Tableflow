import type { Tenant } from "@amber/domain";

/**
 * Fallback tenant so the KDS runs standalone (no backend yet). Mirrors the
 * customer app's defaultTenant so both adopt the same brand. In production this
 * is replaced by the staff member's tenant via @amber/api-client.
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
};
