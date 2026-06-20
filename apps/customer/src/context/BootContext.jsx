import { createContext, useContext, useEffect, useState } from "react";
import { ApiError } from "@amber/api-client";
import { createGuestApi, DEFAULT_SLUG } from "../api";
import { BootSplash, InvalidQr, TableInUse, SessionClosed } from "../screens/BootScreens";
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

  useEffect(() => {
    let active = true;

    /** Try to resume a persisted order. Returns a boot state or null. */
    async function tryResume(saved) {
      if (!saved?.orderId || !saved?.slug || !saved?.qrToken) return null;
      const api = createGuestApi(saved.slug);
      try {
        const tenant = await api.tenant.bySlug(saved.slug);
        const table = await api.tables.byQrToken(saved.qrToken);
        // Sends X-Device-Id; 403 if this order belongs to a different device.
        const order = await api.orders.get(saved.orderId);
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
      const parsed = parseEntryPath(window.location.pathname);
      const saved = readSession();

      // ── No QR in the path: refresh / direct visit ─────────────────────────
      if (!parsed) {
        if (saved?.ended) {
          if (active) setBoot({ status: "closed" });
          return;
        }
        const resumed = await tryResume(saved);
        if (!active) return;
        if (resumed) {
          setBoot(resumed);
          return;
        }
        // Nothing to resume — dev fallback so the app stays runnable locally.
      }

      // ── Fresh QR scan, or dev fallback ────────────────────────────────────
      const slug = parsed?.slug ?? DEFAULT_SLUG;
      const api = createGuestApi(slug);
      try {
        const tenant = await api.tenant.bySlug(slug);

        let table;
        if (parsed) {
          table = await api.tables.byQrToken(parsed.qrToken);
        } else {
          const floor = await api.tables.list();
          table = floor.find((t) => t.status === "free") ?? floor[0];
          if (!table) throw new ApiError(404, "No tables configured");
        }

        // Occupancy: a free table has no order in the "open"/"billed" set.
        const open = await api.orders.list("open");
        const occupied = open.some((o) => o.tableId === table.id);

        if (occupied) {
          // It might be THIS device's session (e.g. re-scanned after refresh) —
          // resume rather than block. tryResume verifies ownership server-side.
          const resumed =
            saved?.tableId === table.id ? await tryResume(saved) : null;
          if (!active) return;
          if (resumed?.status === "ready") {
            setBoot(resumed);
          } else {
            setBoot({ status: "occupied", table });
          }
          return;
        }

        // Free table → clean slate for a brand-new session.
        clearSession();
        if (!active) return;
        setBoot({ status: "ready", api, tenant, table, resumeOrder: null });
      } catch (e) {
        if (!active) return;
        const notFound = e instanceof ApiError && e.status === 404;
        setBoot({
          status: "invalid",
          reason: notFound
            ? "We couldn’t find that table. Ask a staff member for help."
            : "We couldn’t reach the restaurant. Please try again in a moment.",
        });
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (boot.status === "loading") return <BootSplash />;
  if (boot.status === "invalid") return <InvalidQr reason={boot.reason} />;
  if (boot.status === "occupied") return <TableInUse table={boot.table} />;
  if (boot.status === "closed") return <SessionClosed />;

  return (
    <BootContext.Provider
      value={{
        api: boot.api,
        tenant: boot.tenant,
        table: boot.table,
        resumeOrder: boot.resumeOrder ?? null,
      }}
    >
      {children}
    </BootContext.Provider>
  );
}
