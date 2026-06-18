import { createApiClient } from "@amber/api-client";

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/**
 * Super-admin uses the same typed client as every app — it just calls the
 * cross-tenant /admin endpoints. No hand-written fetch anywhere.
 */
export const api = createApiClient({
  baseUrl,
  getToken: () => localStorage.getItem("amber.adminToken"),
});
