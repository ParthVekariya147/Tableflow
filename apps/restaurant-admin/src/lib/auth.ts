import { defaultTenant } from "../tenant/defaultTenant";
import { getStoredToken } from "./auth-token";

/**
 * Impersonation (see PLATFORM_PLAN.md "Master-password impersonation"). The
 * super-admin "Impersonate" button (TenantsPage.tsx) opens this app in a NEW
 * TAB as `<restaurantAdminUrl>?impersonationToken=<token>` (a new tab can't
 * share the super-admin's in-memory Supabase session, and localStorage isn't
 * shared cross-origin/port either) — captured here once on boot, then kept
 * in this app's own localStorage for the rest of the session. The tenant's
 * slug isn't a separate query param — it's decoded from the token itself
 * (`ImpersonationToken.tenantSlug`, minted server-side in auth.service.ts),
 * since the token is the only thing the link carries.
 */
const IMPERSONATION_TOKEN_KEY = "amber.impersonationToken";

/** Decodes a JWT payload without verifying the signature — display-only. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Call once on app boot: pulls `?impersonationToken=` out of the URL into storage. */
export function captureImpersonationFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("impersonationToken");
  if (!token) return;

  localStorage.setItem(IMPERSONATION_TOKEN_KEY, token);
  params.delete("impersonationToken");
  const rest = params.toString();
  const url = `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", url);
}

// Run once, synchronously, the moment this module is first imported — before
// any caller (e.g. lib/api.ts reading getActiveTenantSlug()) can observe the
// pre-capture state. Avoids needing every entry point to remember to call
// captureImpersonationFromUrl() itself.
captureImpersonationFromUrl();

export function getImpersonationToken(): string | null {
  return localStorage.getItem(IMPERSONATION_TOKEN_KEY);
}

function getImpersonationPayload(): Record<string, unknown> | null {
  const token = getImpersonationToken();
  return token ? decodeJwtPayload(token) : null;
}

export function isImpersonating(): boolean {
  return getImpersonationPayload()?.impersonated === true;
}

export function clearImpersonation(): void {
  localStorage.removeItem(IMPERSONATION_TOKEN_KEY);
}

/**
 * The bearer for `@amber/api-client`'s `getToken` config. An impersonation
 * token (if present) takes precedence and is used directly — it's already a
 * complete JWT, no Supabase session involved in that path.
 */
export function getAuthToken(): string | null {
  return getImpersonationToken() ?? getStoredToken();
}

/** The tenant slug to scope API calls to: the impersonated tenant if active, else the default. */
export function getActiveTenantSlug(): string {
  const payload = getImpersonationPayload();
  const tenantSlug = payload?.tenantSlug;
  return typeof tenantSlug === "string" ? tenantSlug : defaultTenant.slug;
}
