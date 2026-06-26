/**
 * Auto-detects this machine's current LAN IPv4 and rewrites the
 * VITE_API_URL / VITE_KDS_URL / VITE_CUSTOMER_URL lines in each app's `.env`
 * (or `.env.local`, whichever exists) to point at it — instead of a
 * hand-edited IP that goes stale the moment Wi-Fi hands out a new one.
 *
 * Run automatically by `pnpm dev` (see tools/dev.mjs) before the servers
 * start. Every other line in each file (Supabase keys, etc.) is left alone.
 * Override the detected IP with `LAN_IP=x.x.x.x pnpm dev` if autodetection
 * ever picks the wrong adapter (VPN/VirtualBox/WSL all show up too).
 */
import { networkInterfaces } from "node:os";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const PORTS = { api: 3001, kds: 4001, customer: 5173, restaurantAdmin: 5174 };

/** Adapter name patterns that are almost never the real LAN/Wi-Fi link. */
const DEPRIORITIZED = /virtualbox|vmware|hyper-v|veth|docker|wsl|loopback|tailscale|tunnel/i;

function detectLanIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP;

  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const isPrivate =
        /^10\./.test(addr.address) ||
        /^192\.168\./.test(addr.address) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(addr.address);
      if (!isPrivate) continue;
      candidates.push({ name, address: addr.address, deprioritized: DEPRIORITIZED.test(name) });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Number(a.deprioritized) - Number(b.deprioritized));
  return candidates[0].address;
}

/** Replace (or append) `KEY=value` lines in `content`, leaving everything else untouched. */
function applyEnvValues(content, values) {
  const lines = content.length ? content.split("\n") : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (match && Object.prototype.hasOwnProperty.call(values, match[1])) {
      seen.add(match[1]);
      return `${match[1]}=${values[match[1]]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  return next.join("\n");
}

function syncApp(appDir, values) {
  const envPath = join(root, appDir, ".env");
  const localPath = join(root, appDir, ".env.local");
  const target = existsSync(localPath) ? localPath : envPath;
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  const updated = applyEnvValues(current, values);
  if (updated !== current) {
    writeFileSync(target, updated);
    return true;
  }
  return false;
}

export function syncLanEnv() {
  const ip = detectLanIp();
  if (!ip) {
    console.warn(
      "[sync-lan-env] No LAN IPv4 detected — skipping (.env files left as-is). " +
        "Set LAN_IP=x.x.x.x to force one.",
    );
    return null;
  }

  const apiUrl = `http://${ip}:${PORTS.api}`;
  const kdsUrl = `http://${ip}:${PORTS.kds}`;
  const customerUrl = `http://${ip}:${PORTS.customer}`;
  const restaurantAdminUrl = `http://${ip}:${PORTS.restaurantAdmin}`;

  const changed = [
    syncApp("apps/customer", { VITE_API_URL: apiUrl, VITE_KDS_URL: kdsUrl }),
    syncApp("apps/restaurant-admin", {
      VITE_API_URL: apiUrl,
      VITE_KDS_URL: kdsUrl,
      VITE_CUSTOMER_URL: customerUrl,
    }),
    syncApp("apps/super-admin", {
      VITE_API_URL: apiUrl,
      VITE_RESTAURANT_ADMIN_URL: restaurantAdminUrl,
    }),
  ].some(Boolean);

  console.log(`[sync-lan-env] LAN IP: ${ip}${changed ? " (env files updated)" : " (already up to date)"}`);
  return ip;
}

// Allow `node tools/sync-lan-env.mjs` standalone, not just as an import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncLanEnv();
}
