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
  /*
   * `MenuItem.swatch` holds gradient classes ("from-red-300 to-orange-400")
   * that come from the DATABASE, not from source. Tailwind's JIT only emits
   * CSS for class names it can see in `content`, so these were rendered into
   * the markup with no rule behind them — `background-image` computed to
   * `none`, and `FoodImage`'s stand-in showed as a blank box with an almost
   * invisible white icon on it.
   *
   * It stayed hidden while most items had a (broken) <img>; it became the
   * visible state once items without a usable photo fell back properly.
   *
   * Safelisting a bounded palette fixes it for any tenant-authored swatch
   * without needing every value to exist in source. Keep the shade list tight
   * — each entry here is real CSS in the bundle.
   */
  safelist: [
    {
      pattern:
        /^(from|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(100|200|300|400|500|600)$/,
    },
  ],
};
