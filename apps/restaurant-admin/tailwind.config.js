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
      // Spacing/type are in REM (not px) on purpose: index.css scales the root
      // font-size down on small screens, so every font, padding and button
      // shrinks proportionally on mobile without per-page overrides.
      spacing: {
        base: "0.25rem",
        xs: "0.5rem",
        sm: "0.75rem",
        md: "1rem",
        lg: "1.5rem",
        xl: "2rem",
        xxl: "3rem",
        gutter: "1.5rem",
        "container-max": "1440px",
      },
      borderRadius: {
        card: "1rem",
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
        "display-lg": ["3rem", { lineHeight: "3.5rem", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg": ["2rem", { lineHeight: "2.5rem", fontWeight: "600" }],
        "headline-md": ["1.5rem", { lineHeight: "2rem", fontWeight: "600" }],
        "title-lg": ["1.25rem", { lineHeight: "1.75rem", fontWeight: "600" }],
        "title-md": ["1rem", { lineHeight: "1.375rem", fontWeight: "600" }],
        "body-lg": ["1rem", { lineHeight: "1.5rem", fontWeight: "400" }],
        "body-md": ["0.875rem", { lineHeight: "1.25rem", fontWeight: "400" }],
        "label-md": ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.05em", fontWeight: "600" }],
        "data-mono": ["0.875rem", { lineHeight: "1.25rem", fontWeight: "500" }],
      },
    },
  },
};
