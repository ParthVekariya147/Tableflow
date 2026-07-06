import type { Tenant } from "@amber/domain";

/**
 * The **Amber platform** default brand — shown before a tenant is loaded (the
 * login screen) and as the theme fallback. "Amber" is the SaaS product name;
 * once a user signs in, the logged-in *tenant's* brand (name + theme) takes over
 * (see TenantThemeGate). The slug is only a dev fallback for tenant-scoped API
 * calls when nobody is signed in.
 */
export const defaultTenant: Tenant = {
  id: "amber-platform",
  slug: "amber-grain",
  name: "Amber",
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
  kitchenPrinter: {},
  loyalty: {
    enabled: false,
    earnRatePerCurrency: 1,
    redemptionRate: 100,
    minRedeemPoints: 100,
    maxRedeemPercent: 0.5,
  },
};
