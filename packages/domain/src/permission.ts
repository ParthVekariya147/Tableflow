import { z } from "zod";

/**
 * The fixed permission vocabulary — the ONLY thing in RBAC that is hardcoded.
 *
 * The app can only gate capabilities it actually has, so these keys are a closed
 * set. Custom, Admin-named *roles* (see role.ts) are built by bundling these
 * keys; per-user overrides (Membership.permissions) are also drawn from this set.
 * Each key maps to a page/capability in restaurant-admin (see SETTINGS.md §B).
 */
export const PERMISSIONS = [
  "dashboard.view", // Dashboard (/)
  "menu.manage", // Menu Management (/menu)
  "tables.manage", // Tables + sessions + billing (/tables*)
  "kds.use", // Kitchen Display (/kds, /kds/display)
  "orders.history", // Order History (/history)
  "analytics.view", // Sales Analytics (/analytics)
  "settings.manage", // Settings (/settings/*)
  "team.manage", // Add/remove users & change roles/permissions
] as const;

export const permissionSchema = z.enum(PERMISSIONS);

export type Permission = z.infer<typeof permissionSchema>;

/** Human-readable labels for the permission toggles in the Team/Roles UI. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "dashboard.view": "View Dashboard",
  "menu.manage": "Manage Menu",
  "tables.manage": "Manage Tables & Sessions",
  "kds.use": "Use Kitchen Display",
  "orders.history": "View Order History",
  "analytics.view": "View Sales Analytics",
  "settings.manage": "Manage Settings",
  "team.manage": "Manage Team & Roles",
};

/** True if `held` grants `needed`. Central so guards/UI agree on the check. */
export function hasPermission(
  held: readonly Permission[],
  needed: Permission,
): boolean {
  return held.includes(needed);
}
