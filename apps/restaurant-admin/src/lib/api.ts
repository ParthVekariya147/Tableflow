import { createApiClient } from "@amber/api-client";
import { defaultTenant } from "../tenant/defaultTenant";

/**
 * Shared admin api-client for page-level queries (e.g. Order History) that need
 * the API directly rather than through the AdminStore's action `dispatch`. Same
 * config the store uses: base URL from `VITE_API_URL`, tenant from defaultTenant.
 */
export const api = createApiClient({
  baseUrl:
    (import.meta.env.VITE_API_URL as string | undefined) ??
    "http://localhost:3001",
  tenantSlug: defaultTenant.slug,
});
