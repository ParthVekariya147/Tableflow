/**
 * The logged-in tenant slug, persisted in localStorage so the api-client
 * stays pointed at the correct restaurant across refreshes. AuthContext owns
 * writing/clearing it on login/logout; api.ts reads it via getTenantSlug.
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
    /* storage unavailable (private mode) */
  }
}
