/**
 * Shared Tailwind preset for every app in the monorepo.
 *
 * It wires the semantic color tokens (resolved from CSS variables, see
 * tokens.cjs) plus the brand typography/radius scale. Apps import this preset
 * and only declare their own `content` globs.
 *
 *   // tailwind.config.js
 *   module.exports = {
 *     presets: [require("@amber/config/tailwind/preset")],
 *     content: ["./index.html", "./src/**\/*.{ts,tsx}"],
 *   };
 */
const { buildColors } = require("./tokens.cjs");

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: buildColors(),
      fontFamily: {
        // Tenants can override --ag-font-sans / --ag-font-serif at runtime.
        sans: ["var(--ag-font-sans)", "Plus Jakarta Sans", "sans-serif"],
        serif: ["var(--ag-font-serif)", "Literata", "serif"],
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        full: "9999px",
      },
    },
  },
  plugins: [],
};
