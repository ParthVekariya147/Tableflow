import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ApiError } from "@amber/api-client";
import { createGuestApi, DEFAULT_SLUG } from "../api";
import { BootSplash, InvalidQr, TableInUse, SessionClosed, ResumeError } from "../screens/BootScreens";
import { readSession, writeSession, clearSession, markSessionEnded } from "../session-store";

/**
 * QR entry bootstrap (see apps/customer/docs/qr-entry-flow.md).
 *
 * The guest scans a table QR encoding `/{tenantSlug}/t/{qrToken}`. Before any
 * screen renders we resolve the tenant (→ dynamic theme) + table and decide the
 * boot state. Crucially, sessions are now **device-bound and resumable** so a
 * refresh can't lose the live order (which used to let the app fire phantom
 * rounds at the KDS with no backing Order):
 *
 *   1. Fresh QR scan (path has /{slug}/t/{token}) → resolve + check occupancy.
 *        free      → ready (the splash opens a new Order)
 *        occupied  → if it's THIS device's order, resume it; else "Table in use"
 *   2. No QR (refresh / direct hit):
 *        ended marker      → "closed" (locked out until a fresh scan)
 *        saved live order  → re-verify against the API, then resume (or close)
 *        nothing           → dev fallback (first free table) for local dev
 *
 * Resume passes the persisted orderId down via `resumeOrder` so SessionProvider
 * can rehydrate without re-creating an Order.
 */

const BootContext = createContext(null);

export const useBoot = () => {
  const ctx = useContext(BootContext);
  if (!ctx) throw new Error("useBoot must be used within a <BootProvider>");
  return ctx;
};

/** Parse `/{slug}/t/{qrToken}` from the entry path. Null if it doesn't match. */
function parseEntryPath(pathname) {
  const m = pathname.match(/^\/([^/]+)\/t\/([^/]+)\/?$/);
  if (!m) return null;
  return { slug: decodeURIComponent(m[1]), qrToken: decodeURIComponent(m[2]) };
}

const LIVE = ["open", "billed"];

export function BootProvider({ children }) {
  const [boot, setBoot] = useState({ status: "loading" });
  // Bumped by the "Try again" button on ResumeError to re-run the whole boot
  // sequence below (a transient resume failure must not fall through to the
  // dev-fallback path — see the `!parsed` branch).
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let active = true;

    /** Try to resume a persisted order. Returns a boot state or null. The boot
     *  calls run in parallel (they don't depend on each other) to cut latency. */
    async function tryResume(api, saved) {
      if (!saved?.orderId || !saved?.slug || !saved?.qrToken) return null;
      try {
        // tenant / table / order are independent — fetch concurrently.
        // Sends X-Device-Id on the order; 403 if it belongs to a different device.
        const [tenant, table, order] = await Promise.all([
          api.tenant.bySlug(saved.slug),
          api.tables.byQrToken(saved.qrToken),
          api.orders.get(saved.orderId),
        ]);
        if (order.tableId === table.id && LIVE.includes(order.status)) {
          writeSession(saved); // refresh the record
          return { status: "ready", api, tenant, table, resumeOrder: order };
        }
        // Order settled/cancelled → lock the device out of ordering.
        markSessionEnded();
        return { status: "closed" };
      } catch (e) {
        // 403 (not ours) / 404 (gone) / network → drop the stale session.
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
          markSessionEnded();
          return { status: "closed" };
        }
        return null; // transient — let the caller fall through
      }
    }

    (async () => {
      // Reset to the splash on a retry (harmless no-op on the initial mount,
      // where boot is already "loading") so "Try again" doesn't leave the
      // error screen showing while the resume check re-runs.
      if (retryNonce > 0 && active) setBoot({ status: "loading" });

      const parsed = parseEntryPath(window.location.pathname);
      const saved = readSession();

      // Lockout: a settled device with no fresh QR is closed out immediately.
      if (!parsed && saved?.ended) {
        if (active) setBoot({ status: "closed" });
        return;
      }

      // The tenant slug is known up-front (from the QR path, the saved session,
      // or the dev fallback), so build the client and **start the menu fetch NOW**
      // — it's the slowest call, and prefetching it overlaps it with the boot
      // resolution instead of waiting until after the app renders. The promise is
      // handed to MenuProvider via context so it isn't re-fetched.
      const slug = parsed?.slug ?? saved?.slug ?? DEFAULT_SLUG;
      const api = createGuestApi(slug);
      const menuPromise = api.menu.get();
      menuPromise.catch(() => {}); // pre-attach so an early reject isn't "unhandled"

      // ── No QR in the path: refresh / direct visit → try resume first ──────
      if (!parsed) {
        const hadSavedSession = Boolean(saved?.orderId);
        const resumed = await tryResume(api, saved);
        if (!active) return;
        if (resumed) {
          setBoot(resumed.status === "ready" ? { ...resumed, menuPromise } : resumed);
          return;
        }
        // `resumed === null` means tryResume hit a TRANSIENT failure (network/5xx),
        // not "there was nothing to resume" (that returns {status:"closed"} and is
        // handled above). If we had a real saved session, do NOT fall through to
        // the free-table dev-fallback below — that would silently wipe the guest's
        // live order and reseat them at an unrelated table. Let them retry instead.
        if (hadSavedSession) {
          setBoot({ status: "resume-error" });
          return;
        }
        // Genuinely nothing to resume — dev fallback so the app stays runnable locally.
      }

      // ── Fresh QR scan, or dev fallback ────────────────────────────────────
      // The first-free-table fallback is DEV-ONLY (audit C4): in production a
      // no-QR hit must never silently seat the guest at an arbitrary table —
      // the qrToken is the capability, so demand a scan instead.
      if (!parsed && !import.meta.env.DEV) {
        setBoot({
          status: "invalid",
          reason: "Scan the QR code on your table to get started.",
        });
        return;
      }
      try {
        // tenant, table and the open-order list are independent → run in parallel.
        const tablePromise = parsed
          ? api.tables.byQrToken(parsed.qrToken)
          : api.tables
              .list()
              .then((floor) => floor.find((t) => t.status === "free") ?? floor[0]);
        const [tenant, table, openTableIds] = await Promise.all([
          api.tenant.bySlug(slug),
          tablePromise,
          api.orders.openTableIds(),
        ]);
        if (!table) throw new ApiError(404, "No tables configured");

        // Occupancy: a free table has no order in the "open"/"billed" set.
        const occupied = openTableIds.includes(table.id);

        if (occupied) {
          // It might be THIS device's session (e.g. re-scanned after refresh) —
          // resume rather than block. tryResume verifies ownership server-side.
          const resumed =
            saved?.tableId === table.id ? await tryResume(api, saved) : null;
          if (!active) return;
          if (resumed?.status === "ready") {
            setBoot({ ...resumed, menuPromise });
          } else {
            // Carry api/tenant/menuPromise so TableInUse can offer phone re-join.
            setBoot({ status: "occupied", table, api, tenant, menuPromise });
          }
          return;
        }

        // Free table → clean slate for a brand-new session.
        clearSession();
        if (!active) return;
        setBoot({ status: "ready", api, tenant, table, resumeOrder: null, menuPromise });
      } catch (e) {
        if (!active) return;
        const notFound = e instanceof ApiError && e.status === 404;
        setBoot({
          status: "invalid",
          reason: notFound
            ? "We couldn’t find that table. Ask a staff member for help."
            : !parsed
              ? // Dev-only fallback path (see the guard above): GET /tables is
                // staff-gated, so tell the developer the truth instead of the
                // misleading "couldn't reach the restaurant".
                "Dev fallback can’t list tables (staff-only endpoint) — open a table QR link instead, e.g. /amber-grain/t/<qrToken>."
              : "We couldn’t reach the restaurant. Please try again in a moment.",
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [retryNonce]);

  // Memoized so every consumer doesn't re-render whenever BootProvider does —
  // only when one of these fields actually changes. Computed unconditionally
  // (before the status early-returns below) since hooks can't be called
  // conditionally; it's simply unused on the non-"ready" render paths.
  const bootValue = useMemo(
    () => ({
      api: boot.api,
      tenant: boot.tenant,
      table: boot.table,
      resumeOrder: boot.resumeOrder ?? null,
      // Menu fetch kicked off during boot (overlaps the boot calls) so the menu
      // is usually already in flight / resolved by the time MenuProvider mounts.
      menuPromise: boot.menuPromise ?? null,
    }),
    [boot.api, boot.tenant, boot.table, boot.resumeOrder, boot.menuPromise],
  );

  if (boot.status === "loading") return <BootSplash />;
  if (boot.status === "invalid") return <InvalidQr reason={boot.reason} />;
  if (boot.status === "resume-error")
    return <ResumeError onRetry={() => setRetryNonce((n) => n + 1)} />;
  if (boot.status === "occupied")
    return (
      <TableInUse
        table={boot.table}
        api={boot.api}
        onReclaimed={(order) => {
          writeSession({
            slug: boot.tenant.slug,
            qrToken: boot.table.qrToken,
            tableId: boot.table.id,
            orderId: order.id,
          });
          setBoot({
            status: "ready",
            api: boot.api,
            tenant: boot.tenant,
            table: boot.table,
            resumeOrder: order,
            menuPromise: boot.menuPromise,
          });
        }}
      />
    );
  if (boot.status === "closed") return <SessionClosed />;

  return (
    <BootContext.Provider value={bootValue}>
      {children}
    </BootContext.Provider>
  );
}
