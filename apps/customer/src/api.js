import { createApiClient } from "@amber/api-client";
import { getDeviceId } from "./device";

/**
 * The guest app's typed link to the platform API (services/api → Supabase).
 *
 * The active tenant is no longer fixed: the QR entry flow resolves the tenant
 * slug from the scanned path (`/{slug}/t/{qrToken}`) and builds a client bound
 * to it via `createGuestApi(slug)` (see context/BootContext.jsx). `DEFAULT_SLUG`
 * is only a fallback for local dev / direct visits without a QR.
 */
export const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** Fallback tenant slug when the entry path carries no QR (dev / direct hit). */
export const DEFAULT_SLUG = "amber-grain";

/** Build a guest api-client bound to one tenant slug (from the scanned QR).
 *  Sends X-Device-Id so the API can bind the session to this device. */
export function createGuestApi(slug) {
  return createApiClient({ baseUrl, tenantSlug: slug, getDeviceId });
}

/** Fallback client for code paths that may run before boot resolves a tenant. */
export const api = createGuestApi(DEFAULT_SLUG);
