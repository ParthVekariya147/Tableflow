/**
 * The signed-in tenant's slug, persisted alongside the bearer token so a refresh
 * keeps scoping every request to the right restaurant. Set on login (from the
 * resolved `AuthUser.tenantSlug`), cleared on logout. The api-clients read it via
 * their `getTenantSlug` hook (see lib/api.ts + AdminStore) so the admin panel
 * follows the logged-in tenant instead of a hardcoded one.
 */
const TENANT_KEY = "amber-admin-tenant";

export function getStoredTenantSlug(): string | null {
  try {
    return localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

export function setStoredTenantSlug(slug: string | null): void {
  try {
    if (slug) localStorage.setItem(TENANT_KEY, slug);
    else localStorage.removeItem(TENANT_KEY);
  } catch {
    /* storage unavailable (private mode) — slug stays in-memory only */
  }
}
