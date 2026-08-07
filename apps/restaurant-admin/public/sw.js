/**
 * TableFlow restaurant-admin service worker.
 *
 * Its ONLY job is to make the panel installable + give it an app shell that
 * survives a dead network. It deliberately does **not** cache data:
 *
 *  - The API is a different origin (:3001 vs the app's own port), so every
 *    `/orders`, `/tables`, `/menu` call and the SSE streams fall straight
 *    through to the network — an installed till must never render a stale
 *    floor, and a cached SSE response would break realtime outright.
 *  - Navigations are network-first, so a deploy is picked up on the next load
 *    instead of being pinned to a cached index.html.
 *  - Only Vite's content-hashed `/assets/*` files are served cache-first; a new
 *    build emits new filenames, so those entries can never go stale.
 *
 * Bump CACHE_VERSION to evict everything on the next activation.
 */
const CACHE_VERSION = "v1";
const SHELL_CACHE = `tableflow-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `tableflow-assets-${CACHE_VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE]);

const SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `reload` bypasses the HTTP cache so a fresh install never captures a
      // stale shell from a previous deploy.
      await cache.addAll([
        new Request(SHELL_URL, { cache: "reload" }),
        new Request("/manifest.webmanifest", { cache: "reload" }),
      ]);
      // Take over as soon as the new worker is ready; paired with clients.claim
      // below this avoids the "refresh twice to get the update" trap.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((n) => (KEEP.has(n) ? undefined : caches.delete(n))));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Anything not served by this origin (the API, Google Fonts) is left to the
  // browser — see the header comment.
  if (url.origin !== self.location.origin) return;
  // Server-sent events must stay a live connection, never a cached body.
  if (request.headers.get("accept")?.includes("text/event-stream")) return;

  // SPA navigations: network first, cached shell as the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(SHELL_URL, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(SHELL_URL);
          return (
            cached ??
            new Response("Offline — reconnect to load TableFlow.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      })(),
    );
    return;
  }

  // Content-hashed build output + icons: cache-first, filled on first use.
  const isHashedAsset = url.pathname.startsWith("/assets/");
  const isIcon = /^\/(icon-|apple-touch-icon).*\.png$/.test(url.pathname);
  if (isHashedAsset || isIcon) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(ASSET_CACHE);
          cache.put(request, fresh.clone());
        }
        return fresh;
      })(),
    );
  }
});
