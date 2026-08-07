import { useEffect, useRef, useState } from "react";

/**
 * A menu item's photo, with the icon/swatch stand-in as fallback.
 *
 * Two things here exist specifically to stop the "images sometimes don't
 * load" failure mode:
 *
 * 1. `loading="lazy"` — the menu renders every item at once (75+ for Amber &
 *    Grain), so an eager <img> fired 75 simultaneous requests at whatever host
 *    `imageUrl` points to. Third-party hosts rate-limit that burst: measured
 *    live, 43/55 loremflickr URLs returned 500 and Wikimedia returned 429,
 *    while the SAME urls fetched one at a time all returned 200. Lazy loading
 *    means only the few images actually on screen are requested, which keeps
 *    the app under the limit instead of triggering it.
 *
 * 2. A bounded retry — a burst-induced 500/429 is transient, but the old
 *    component treated the first `onError` as permanent and dropped straight
 *    to the icon for the rest of the session. Two retries with a short backoff
 *    recover those without hammering a host that is genuinely down.
 *
 * The durable fix is still to host photos ourselves (Supabase Storage, via the
 * admin's `POST /menu/upload`) rather than hotlink — self-hosted images
 * measured 0 failures and ~130ms vs loremflickr's ~900ms. See
 * `services/api/prisma/rehost-images.ts`.
 *
 * `eager` opts a specific image out of lazy loading — use it only for
 * above-the-fold hero images, where lazy loading would delay first paint.
 */

const MAX_RETRIES = 2;

export default function FoodImage({ item, className = "", eager = false }) {
  const src = item?.img || null;
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  // True between a failed load and its retry. We drop to the icon stand-in for
  // that gap on purpose: leaving the broken <img> mounted makes the browser
  // paint its own torn-page glyph, which looks like a bug to the guest.
  const [retrying, setRetrying] = useState(false);
  const timerRef = useRef(null);

  // A different item (or a re-uploaded photo) gets a fresh set of attempts.
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setRetrying(false);
  }, [src]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function handleError() {
    setAttempt((prev) => {
      if (prev >= MAX_RETRIES) {
        setFailed(true);
        return prev;
      }
      const next = prev + 1;
      setRetrying(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setRetrying(false);
        setAttempt(next);
      }, 400 * next);
      return prev;
    });
  }

  if (src && !failed && !retrying) {
    // Cache-bust retries only — the first request stays plainly cacheable, but
    // a retry must not be served from the browser's copy of the failed one.
    const url =
      attempt === 0
        ? src
        : `${src}${src.includes("?") ? "&" : "?"}_retry=${attempt}`;

    return (
      <img
        key={url}
        src={url}
        alt={item?.name ?? ""}
        className={className}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={handleError}
      />
    );
  }

  const icon = item?.icon || "restaurant";
  const swatch = item?.swatch || "from-surface-container to-surface-container-highest";
  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br ${swatch} ${className}`}
    >
      {/* Swatches range from pale (yellow-100) to saturated (red-400), so a
          flat white glyph disappears on the light end. The shadow is what
          keeps it legible across the whole palette. */}
      <span
        className="material-symbols-outlined text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.35)]"
        style={{ fontSize: 40 }}
      >
        {icon}
      </span>
    </div>
  );
}
