import { ApiError } from "@amber/api-client";

/**
 * Retry a mutating API call, but ONLY when no response was ever received
 * (network drop, DNS failure, connection refused — thrown as something other
 * than `ApiError`). Once the server actually answers — even a 5xx — we stop,
 * because for a non-idempotent write (create) there's no way from here to
 * tell "the server never saw it" apart from "it processed the request and
 * only the response was lost." Retrying that case risks a duplicate write.
 * Transport-level drops are the common LAN-blip case this is for.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
  backoffMs = 400,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const noResponseReceived = !(e instanceof ApiError);
      if (!noResponseReceived || i === attempts) throw e;
      await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw lastErr;
}
