import type { Permission, TenantModule, TenantModuleConfig } from "@amber/domain";
import { isModuleEnabled } from "@amber/domain";

/** One primary sidebar destination + the permission that unlocks it. */
export interface NavItem {
  to: string;
  label: string;
  icon: string;
  perm: Permission;
  /**
   * Optional tenant module this destination belongs to. When the module is
   * switched off for the active tenant the item is hidden everywhere the nav
   * is consumed — sidebar, home-route resolution, route guards — not greyed
   * out. See `@amber/domain`'s module registry.
   */
  module?: TenantModule;
  end?: boolean;
}

/**
 * The primary nav, in priority order. Shared by the Shell (which renders only
 * the items the user `can()` reach — hide, don't grey out) and `homeRouteFor`
 * (where to land/redirect a user based on what they're allowed to see).
 */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", perm: "dashboard.view", end: true },
  { to: "/menu", label: "Menu Management", icon: "restaurant_menu", perm: "menu.manage" },
  { to: "/tables", label: "Tables", icon: "table_restaurant", perm: "tables.manage" },
  { to: "/quick-sale", label: "Quick Sale", icon: "shopping_bag", perm: "tables.manage" },
  { to: "/billing", label: "Billing", icon: "point_of_sale", perm: "tables.manage" },
  { to: "/kds", label: "Kitchen Display", icon: "skillet", perm: "kds.use" },
  { to: "/history", label: "Order History", icon: "history", perm: "orders.history" },
  { to: "/analytics", label: "Sales Analytics", icon: "analytics", perm: "analytics.view" },
  {
    to: "/loyalty",
    label: "Loyalty",
    icon: "loyalty",
    perm: "loyalty.manage",
    module: "loyalty",
  },
];

/**
 * Is this destination reachable right now — both permission AND module?
 * Two independent gates: `loyalty.manage` says "this person may run the points
 * program", the module says "this restaurant HAS a points program". A user can
 * hold the permission at a tenant that doesn't run the module.
 */
export function isNavItemVisible(
  item: NavItem,
  permissions: readonly Permission[],
  tenant: TenantModuleConfig | undefined,
): boolean {
  if (!permissions.includes(item.perm)) return false;
  if (item.module && !isModuleEnabled(tenant, item.module)) return false;
  return true;
}

/**
 * The best landing route for a user: their highest-priority allowed nav item.
 * A KDS-only user lands on /kds; a user with no nav permissions gets the
 * sentinel "" (callers render a no-access state). Used after login and to
 * redirect away from forbidden URLs.
 *
 * `tenant` is optional so pre-login callers still work; pass it wherever it is
 * available so a loyalty-only user at a tenant with loyalty switched off isn't
 * bounced to a page that no longer exists for them.
 */
export function homeRouteFor(
  permissions: readonly Permission[],
  tenant?: TenantModuleConfig,
): string {
  const first = NAV_ITEMS.find((n) => isNavItemVisible(n, permissions, tenant));
  return first?.to ?? "";
}
