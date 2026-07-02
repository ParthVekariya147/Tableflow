import type { Permission } from "@amber/domain";

/** One primary sidebar destination + the permission that unlocks it. */
export interface NavItem {
  to: string;
  label: string;
  icon: string;
  perm: Permission;
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
  { to: "/billing", label: "Billing", icon: "point_of_sale", perm: "tables.manage" },
  { to: "/kds", label: "Kitchen Display", icon: "skillet", perm: "kds.use" },
  { to: "/history", label: "Order History", icon: "history", perm: "orders.history" },
  { to: "/analytics", label: "Sales Analytics", icon: "analytics", perm: "analytics.view" },
];

/**
 * The best landing route for a user: their highest-priority allowed nav item.
 * A KDS-only user lands on /kds; a user with no nav permissions gets the
 * sentinel "" (callers render a no-access state). Used after login and to
 * redirect away from forbidden URLs.
 */
export function homeRouteFor(permissions: readonly Permission[]): string {
  const first = NAV_ITEMS.find((n) => permissions.includes(n.perm));
  return first?.to ?? "";
}
