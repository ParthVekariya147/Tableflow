import { defaultTenant } from "../tenant/defaultTenant";
import { getStoredTenantSlug } from "./auth-tenant";

/**
 * Build the deep link a guest's phone opens when scanning a table's QR. It
 * encodes the path the customer app boots from (see
 * apps/customer/docs/qr-entry-flow.md): `/{tenantSlug}/t/{qrToken}`.
 *
 * The customer app's origin is configurable via `VITE_CUSTOMER_URL` (where the
 * guest PWA is deployed); it defaults to the local dev server on :5173.
 */
const customerBaseUrl = (
  (import.meta.env.VITE_CUSTOMER_URL as string | undefined) ??
  "http://localhost:5173"
).replace(/\/+$/, "");

/**
 * The full scannable URL for a table's QR token. The slug is the *logged-in*
 * tenant's (read at call time, same source as the api-client) so every
 * restaurant's QR encodes its own tenant — byQrToken is tenant-scoped, so a QR
 * baked with the wrong slug 404s ("Invalid QR"). defaultTenant.slug is only
 * the pre-login dev fallback.
 */
export function tableQrUrl(qrToken: string): string {
  const slug = getStoredTenantSlug() ?? defaultTenant.slug;
  return `${customerBaseUrl}/${encodeURIComponent(slug)}/t/${encodeURIComponent(qrToken)}`;
}
