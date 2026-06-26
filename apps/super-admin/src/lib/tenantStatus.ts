import type { SubscriptionStatus } from "@amber/domain";

/**
 * Tenant lifecycle state shown in the directory/detail/subscriptions tables.
 * "suspended" isn't a `SubscriptionStatus` — it's `Tenant.active === false`,
 * surfaced as its own visual state since it overrides whatever the
 * subscription says (a suspended tenant is locked out regardless of plan).
 */
export type TenantStatus = SubscriptionStatus | "suspended" | "no_plan";

/** Resolve the visual status for a tenant row: suspension wins over billing status. */
export function tenantStatus(
  active: boolean,
  subscriptionStatus: SubscriptionStatus | undefined,
): TenantStatus {
  if (!active) return "suspended";
  if (!subscriptionStatus) return "no_plan";
  return subscriptionStatus;
}
