/**
 * A stable, opaque per-device id. Persisted in localStorage so it survives
 * refreshes and revisits; sent as `X-Device-Id` on every guest API call to bind
 * a dine-in session to the device that opened it (see SessionContext + the API's
 * Order.deviceId guard).
 *
 * NOTE: `crypto.randomUUID()` only exists in *secure contexts* (HTTPS / locahost).
 * On the LAN we serve over plain http://<ip>, so we build a v4 UUID from
 * `crypto.getRandomValues` (which is NOT gated), with a Math.random fallback.
 */
const KEY = "ag.deviceId";

function uuidv4() {
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(b);
  } else {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

/** Get this device's id, creating + persisting one on first use. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = uuidv4();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // localStorage blocked (private mode) — fall back to an ephemeral id so the
    // session still works for this page load (just won't survive a refresh).
    return uuidv4();
  }
}
