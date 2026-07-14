import preset from "@amber/config/tailwind/preset";

/**
 * Restaurant-admin Tailwind config.
 *
 * Colors / sans-serif / serif come from the shared preset (resolved from the
 * tenant's --ag-* CSS variables, so the admin panel rebrands per tenant just
 * like the customer app). On top of that we layer the "cockpit" design system
 * spacing / typography / radius / shadow scale lifted from the prototype
 * (apps/restaurant-admin/prototype/Panel) so the prototype's class names
 * (font-display-lg, text-headline-lg, p-xl, gap-lg, rounded-card, shadow-card…)
 * resolve directly.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  presets: [preset],
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      spacing: {
        base: "4px",
        xs: "8px",
        sm: "12px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        xxl: "48px",
        gutter: "24px",
        "container-max": "1440px",
      },
      borderRadius: {
        card: "16px",
        "2xl": "1rem",
      },
      boxShadow: {
        card: "0px 4px 20px rgba(83, 68, 55, 0.06)",
      },
      fontFamily: {
        "display-lg": ["var(--ag-font-serif)", "Literata", "serif"],
        "headline-lg": ["var(--ag-font-serif)", "Literata", "serif"],
        "headline-md": ["var(--ag-font-serif)", "Literata", "serif"],
        "title-lg": ["var(--ag-font-sans)", "Plus Jakarta Sans", "sans-serif"],
        "title-md": ["var(--ag-font-sans)", "Plus Jakarta Sans", "sans-serif"],
        "body-lg": ["var(--ag-font-sans)", "Plus Jakarta Sans", "sans-serif"],
        "body-md": ["var(--ag-font-sans)", "Plus Jakarta Sans", "sans-serif"],
        "label-md": ["var(--ag-font-sans)", "Plus Jakarta Sans", "sans-serif"],
        "data-mono": ["var(--ag-font-sans)", "Plus Jakarta Sans", "sans-serif"],
      },
      fontSize: {
        "display-lg": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg": ["32px", { lineHeight: "40px", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "title-lg": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "title-md": ["16px", { lineHeight: "22px", fontWeight: "600" }],
        "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-md": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-md": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "600" }],
        "data-mono": ["14px", { lineHeight: "20px", fontWeight: "500" }],
      },
    },
  },
};
