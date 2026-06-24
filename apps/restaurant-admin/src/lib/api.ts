import { createApiClient } from "@amber/api-client";
import { defaultTenant } from "../tenant/defaultTenant";
import { getStoredToken } from "./auth-token";

/**
 * Shared admin api-client for page-level queries (e.g. Order History, auth) that
 * need the API directly rather than through the AdminStore's action `dispatch`.
 * Same config the store uses: base URL from `VITE_API_URL`, tenant from
 * defaultTenant. `getToken` reads the persisted bearer token at call time so
 * authed routes (e.g. /auth/me) carry it without recreating the client.
 */
export const api = createApiClient({
  baseUrl:
    (import.meta.env.VITE_API_URL as string | undefined) ??
    "http://localhost:3001",
  tenantSlug: defaultTenant.slug,
  getToken: getStoredToken,
});
