/**
 * The semantic color token contract for the whole platform.
 *
 * Every token resolves to a CSS custom property at runtime, e.g.
 *   bg-primary  ->  background-color: rgb(var(--ag-primary) / <alpha-value>)
 *
 * CSS variables hold **space-separated RGB channels** (e.g. "140 80 0") so
 * Tailwind opacity modifiers (bg-primary/40) keep working.
 *
 * No tenant's hex values live here. Defaults are provided by @amber/ui's
 * baseline stylesheet, and each tenant overrides the same variables at runtime
 * via TenantThemeProvider. This is what lets ONE codebase render every brand.
 */

/** Canonical list of Material-3-style semantic tokens used across all apps. */
const TOKENS = [
  "primary",
  "on-primary",
  "primary-container",
  "on-primary-container",
  "primary-fixed",
  "primary-fixed-dim",
  "on-primary-fixed",
  "on-primary-fixed-variant",
  "inverse-primary",
  "secondary",
  "on-secondary",
  "secondary-container",
  "on-secondary-container",
  "secondary-fixed",
  "secondary-fixed-dim",
  "on-secondary-fixed",
  "on-secondary-fixed-variant",
  "tertiary",
  "on-tertiary",
  "tertiary-fixed",
  "background",
  "on-background",
  "surface",
  "surface-dim",
  "surface-bright",
  "surface-variant",
  "surface-tint",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "on-surface",
  "on-surface-variant",
  "inverse-surface",
  "inverse-on-surface",
  "outline",
  "outline-variant",
  "error",
  "on-error",
  "error-container",
  "on-error-container",
];

/** Build the Tailwind `colors` object: token -> rgb(var(--ag-token) / alpha). */
function buildColors() {
  return Object.fromEntries(
    TOKENS.map((t) => [t, `rgb(var(--ag-${t}) / <alpha-value>)`]),
  );
}

module.exports = { TOKENS, buildColors };
