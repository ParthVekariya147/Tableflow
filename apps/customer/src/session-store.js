/**
 * Persists the live dine-in session so a page refresh resumes the SAME order
 * instead of losing it (which used to let the app send phantom rounds to the
 * KDS with no backing Order). Also records a terminal "ended" marker so a
 * settled device is locked out of the ordering flow until it scans a fresh QR.
 *
 * Shape (one localStorage key):
 *   active : { slug, qrToken, tableId, orderId }
 *   ended  : { ended: true }
 *   none   : key absent
 *
 * The orderId here is NOT a secret — ownership is proven by the device id
 * (X-Device-Id), which the API checks against Order.deviceId.
 */
const KEY = "ag.session";

export function readSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Save the active session (call right after the Order is created). */
export function writeSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* localStorage unavailable — resume just won't work this visit. */
  }
}

/** Mark the session terminal: the device can only see the closed screen now. */
export function markSessionEnded() {
  writeSession({ ended: true });
}

/** Forget everything (e.g. a fresh QR scan starts a clean slate). */
export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
