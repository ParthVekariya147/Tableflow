import type { LoyaltyProgram } from "./loyalty.js";
import type { PrinterSettings } from "./printer.js";
import { isPrintingEnabled } from "./printer.js";

/**
 * ── Tenant modules: the universal "this restaurant doesn't use that" switch ──
 *
 * Some features are whole optional modules, not preferences: a restaurant that
 * bills without a printer, or runs no points program, should not see that
 * feature ANYWHERE — not in the sidebar, not on the Settings landing, not as a
 * button mid-checkout, not by typing the URL. Half-hiding it (greyed out, or
 * hidden in one place but live in another) is worse than not having it: staff
 * click a dead control and think the app is broken.
 *
 * This registry is the single source of truth for that. Add a module here once
 * and every consumer — the sidebar (`NAV_ITEMS`), route guards
 * (`RequirePermission module=`), the Settings landing card, and any in-page
 * surface — gets the same answer from `isModuleEnabled`.
 *
 * Three rules every module follows:
 *  1. **One switch, one owner.** Exactly one settings page holds the toggle,
 *     and that page is ALWAYS reachable — hiding it would strand the tenant
 *     with no way to turn the module back on. Its Settings card stays listed
 *     and is chipped "Off"; everything else about the module disappears.
 *  2. **Read through `isModuleEnabled`, never the raw flag.** Each module
 *     chooses its own default for an unset config (see `defaultEnabled`), and
 *     those defaults differ — printing is on (tenants were printing before the
 *     switch existed), loyalty is off (opt-in program). A raw `?.enabled`
 *     check silently gets one of them wrong.
 *  3. **Hiding is presentational; money and data are guarded separately.**
 *     Switching a module off must never make historical rows unreadable or
 *     break a request that is already in flight. The write paths that actually
 *     move value (loyalty earn/redeem in `OrdersService`) do their own
 *     server-side `enabled` check — this registry is what stops staff being
 *     offered the control in the first place.
 */
export const TENANT_MODULES = ["printing", "loyalty"] as const;

export type TenantModule = (typeof TENANT_MODULES)[number];

/**
 * The slice of a Tenant a module check needs. Structural, so a full `Tenant`
 * satisfies it — but so does a partially-loaded one, which matters because
 * several callers (Shell, route guards) run before the tenant fetch resolves.
 */
export interface TenantModuleConfig {
  printer?: PrinterSettings;
  loyalty?: LoyaltyProgram;
}

export interface TenantModuleMeta {
  key: TenantModule;
  /** Human label, used in "…is turned off for this restaurant" copy. */
  label: string;
  /**
   * The settings route that owns this module's master switch. This route is
   * exempt from module gating — it is the only way back on.
   */
  switchRoute: string;
  /** Shown on the module's Settings card while it is switched off. */
  offDescription: string;
  /** How an unset/legacy config reads. See rule 2 above. */
  defaultEnabled: boolean;
  isEnabled: (tenant: TenantModuleConfig | undefined) => boolean;
}

/**
 * Whether this tenant runs a points program. Unlike printing, an unset config
 * reads as OFF: loyalty is opt-in (a tenant who never opened the page never
 * agreed to accrue points against their guests' phone numbers), and
 * `loyaltyProgramSchema` already defaults `enabled` to false.
 *
 * Typed as a guard so it narrows exactly like the raw `program?.enabled` check
 * it replaces — call sites that go on to read the earn/redeem rates keep their
 * non-optional program without a cast.
 */
export function isLoyaltyEnabled(
  program: LoyaltyProgram | undefined,
): program is LoyaltyProgram {
  return program?.enabled === true;
}

export const TENANT_MODULE_META: Record<TenantModule, TenantModuleMeta> = {
  printing: {
    key: "printing",
    label: "Printing",
    switchRoute: "/settings/printer",
    offDescription: "Printing is turned off for this restaurant. Open to turn it back on.",
    defaultEnabled: true,
    isEnabled: (tenant) => isPrintingEnabled(tenant?.printer),
  },
  loyalty: {
    key: "loyalty",
    label: "Loyalty",
    switchRoute: "/settings/loyalty",
    offDescription:
      "Loyalty points are turned off for this restaurant. Open to turn them back on.",
    defaultEnabled: false,
    isEnabled: (tenant) => isLoyaltyEnabled(tenant?.loyalty),
  },
};

/**
 * The one check every surface should use. `tenant` may be undefined while the
 * tenant is still loading — in that case the module's `defaultEnabled` answers,
 * so a module that is on by default doesn't flicker out of the sidebar on every
 * page load, and one that is off by default doesn't flash into it.
 */
export function isModuleEnabled(
  tenant: TenantModuleConfig | undefined,
  module: TenantModule,
): boolean {
  const meta = TENANT_MODULE_META[module];
  if (!tenant) return meta.defaultEnabled;
  return meta.isEnabled(tenant);
}
