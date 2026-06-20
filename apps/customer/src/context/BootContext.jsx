import { createContext, useContext, useEffect, useState } from "react";
import { ApiError } from "@amber/api-client";
import { createGuestApi, DEFAULT_SLUG } from "../api";
import { BootSplash, InvalidQr, TableInUse } from "../screens/BootScreens";

/**
 * QR entry bootstrap (see apps/customer/docs/qr-entry-flow.md).
 *
 * The guest scans a table QR encoding `/{tenantSlug}/t/{qrToken}`. Before any
 * screen renders we:
 *   1. parse the entry path → { slug, qrToken },
 *   2. build an api-client bound to that tenant slug,
 *   3. resolve the tenant (→ drives the dynamic theme) and the table (by QR),
 *   4. check occupancy — block if the table already has an open order.
 * Only when the table is free do we expose { api, tenant, table } to the app.
 *
 * Without a QR in the path (local dev / direct visit) we fall back to the
 * default tenant and the first free table so the app stays runnable.
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

export function BootProvider({ children }) {
  const [boot, setBoot] = useState({ status: "loading" });

  useEffect(() => {
    let active = true;
    (async () => {
      const parsed = parseEntryPath(window.location.pathname);
      const slug = parsed?.slug ?? DEFAULT_SLUG;
      const api = createGuestApi(slug);
      try {
        // Tenant first (404 ⇒ unknown restaurant ⇒ invalid QR).
        const tenant = await api.tenant.bySlug(slug);

        // Table: from the scanned QR token, or (dev fallback) the first table.
        let table;
        if (parsed) {
          table = await api.tables.byQrToken(parsed.qrToken);
        } else {
          const floor = await api.tables.list();
          table = floor.find((t) => t.status === "free") ?? floor[0];
          if (!table) throw new ApiError(404, "No tables configured");
        }

        // Occupancy: a free table has no order in the "open" set.
        const open = await api.orders.list("open");
        const occupied = open.some((o) => o.tableId === table.id);

        if (!active) return;
        setBoot({
          status: occupied ? "occupied" : "ready",
          api,
          tenant,
          table,
        });
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

  return (
    <BootContext.Provider
      value={{ api: boot.api, tenant: boot.tenant, table: boot.table }}
    >
      {children}
    </BootContext.Provider>
  );
}
