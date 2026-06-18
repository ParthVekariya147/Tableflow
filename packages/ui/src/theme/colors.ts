import type { ThemeColors } from "@amber/domain";

/** Convert "#8c5000" or "#abc" into Tailwind-friendly "140 80 0" channels. */
export function hexToRgbChannels(hex: string): string | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = parseInt(h, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `${r} ${g} ${b}`;
}

/**
 * Map a tenant's hex color overrides to CSS custom properties, e.g.
 *   { primary: "#8c5000" }  ->  { "--ag-primary": "140 80 0" }
 * Invalid/unknown values are skipped so a bad row can't break the UI.
 */
export function themeColorsToCssVars(
  colors: ThemeColors,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [token, hex] of Object.entries(colors)) {
    if (!hex) continue;
    const channels = hexToRgbChannels(hex);
    if (channels) vars[`--ag-${token}`] = channels;
  }
  return vars;
}
