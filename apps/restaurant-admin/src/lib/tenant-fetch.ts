import type { Tenant } from "@amber/domain";

let inFlight: Promise<Tenant> | null = null;

/**
 * `TenantThemeGate` and `AdminStore` both call `GET /tenant` right after
 * login — both react to the same `status === "authed"` transition, so they
 * fire within the same tick. Coalesce genuinely-concurrent calls into one
 * request instead of the two independent round trips every login used to
 * cost. Does NOT cache the result itself — once the in-flight call settles,
 * the next call (e.g. a later poll/refresh) fetches fresh again.
 */
export function fetchCurrentTenantCoalesced(fetch: () => Promise<Tenant>): Promise<Tenant> {
  if (!inFlight) {
    inFlight = fetch().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
