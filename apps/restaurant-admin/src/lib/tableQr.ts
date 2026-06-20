import { defaultTenant } from "../tenant/defaultTenant";

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

/** The full scannable URL for a table's QR token. */
export function tableQrUrl(qrToken: string): string {
  return `${customerBaseUrl}/${defaultTenant.slug}/t/${encodeURIComponent(qrToken)}`;
}
