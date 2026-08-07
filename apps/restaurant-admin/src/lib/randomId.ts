/**
 * A random opaque id that works in INSECURE contexts too.
 *
 * `crypto.randomUUID()` is only defined in secure contexts (HTTPS/localhost),
 * and this admin panel is routinely served over plain `http://<lan-ip>:5174`
 * on a till or phone — there `randomUUID` is undefined and calling it throws.
 * `crypto.getRandomValues` IS available on plain http, so build the id from
 * that (same approach as the customer app's `src/device.js`).
 *
 * 128 bits of entropy, hex encoded — collision risk is nil, which matters
 * because this backs the payment idempotency key.
 */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  const c: Crypto | undefined =
    typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    // Last-resort fallback for an environment with no WebCrypto at all. Weaker,
    // but an id is always produced — never throw from an id generator.
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
