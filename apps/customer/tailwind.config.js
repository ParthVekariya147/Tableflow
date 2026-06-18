import preset from "@amber/config/tailwind/preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
    // Scan shared UI so its token-based classes are included.
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};
