/**
 * @amber/ui — shared component library + multi-tenant theming engine.
 *
 * Import the baseline tokens once in an app's entry CSS:
 *   @import "@amber/ui/tokens.css";
 * Then wrap the app in <TenantThemeProvider tenant={...}> to apply a brand.
 */
export { TenantThemeProvider, useTenant } from "./theme/TenantThemeProvider.js";
export type { TenantThemeProviderProps } from "./theme/TenantThemeProvider.js";
export { hexToRgbChannels, themeColorsToCssVars } from "./theme/colors.js";

export { MaterialIcon } from "./components/MaterialIcon.js";
export type { MaterialIconProps } from "./components/MaterialIcon.js";
export { Button } from "./components/Button.js";
export type { ButtonProps } from "./components/Button.js";
