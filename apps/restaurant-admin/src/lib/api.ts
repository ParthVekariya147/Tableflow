import { createApiClient } from "@amber/api-client";
import { defaultTenant } from "../tenant/defaultTenant";
import { getStoredToken } from "./auth-token";
import { getStoredTenantSlug } from "./auth-tenant";

/**
 * Shared admin api-client for page-level queries (e.g. Order History, auth) that
 * need the API directly rather than through the AdminStore's action `dispatch`.
 * Base URL from `VITE_API_URL`. Both `getToken` and `getTenantSlug` are read at
 * call time so the client follows the *logged-in* tenant (email-first login picks
 * it; persisted in storage) instead of a hardcoded restaurant. `defaultTenant.slug`
 * is only a dev fallback before anyone has signed in.
 */
export const api = createApiClient({
  baseUrl:
    (import.meta.env.VITE_API_URL as string | undefined) ??
    "http://localhost:3001",
  getTenantSlug: () => getStoredTenantSlug() ?? defaultTenant.slug,
  getToken: getStoredToken,
});
