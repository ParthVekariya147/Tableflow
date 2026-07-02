import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets (e.g. the platform master
 * password). A plain `a === b` short-circuits on the first differing byte, so
 * the time it takes leaks how much of a guess is correct — a timing oracle an
 * attacker can use to recover the secret byte by byte.
 *
 * Both inputs are hashed to a fixed 32-byte digest first, so `timingSafeEqual`
 * (which throws on unequal lengths) is always fed equal-length buffers and the
 * comparison leaks neither the secret's content nor its length via timing.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}
