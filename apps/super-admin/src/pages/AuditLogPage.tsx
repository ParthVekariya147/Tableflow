import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MaterialIcon } from "@amber/ui";
import type { AuditLogEntry } from "@amber/api-client";
import { api } from "../api";
import { TableRowsSkeleton } from "../components/Skeleton";

const PAGE_SIZE = 50;

const EVENT_TYPES = [
  "impersonation",
  "tenant_created",
  "tenant_updated",
  "tenant_suspended",
  "tenant_reactivated",
  "plan_assigned",
  "subscription_status_changed",
] as const;

const EVENT_LABELS: Record<string, string> = {
  impersonation: "Impersonation",
  tenant_created: "Tenant created",
  tenant_updated: "Tenant updated",
  tenant_suspended: "Tenant suspended",
  tenant_reactivated: "Tenant reactivated",
  plan_assigned: "Plan assigned",
  subscription_status_changed: "Subscription changed",
};

const EVENT_COLORS: Record<string, string> = {
  impersonation: "bg-amber-100 text-amber-800",
  tenant_created: "bg-green-100 text-green-800",
  tenant_suspended: "bg-red-100 text-red-800",
  tenant_reactivated: "bg-blue-100 text-blue-800",
  plan_assigned: "bg-purple-100 text-purple-800",
  subscription_status_changed: "bg-orange-100 text-orange-800",
  tenant_updated: "bg-gray-100 text-gray-700",
};

function EventBadge({ type }: { type: string }) {
  const cls = EVENT_COLORS[type] ?? "bg-gray-100 text-gray-700";
  const label = EVENT_LABELS[type] ?? type;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>("");
  const [tenantSearch, setTenantSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    setLoading(true);
    api.admin
      .getAuditLog({
        limit: PAGE_SIZE,
        offset,
        type: typeFilter || undefined,
        from: fromDate ? new Date(fromDate).toISOString() : undefined,
        to: toDate ? new Date(toDate + "T23:59:59").toISOString() : undefined,
      })
      .then(({ entries: e, total: t }) => {
        if (!isMounted.current) return;
        setEntries(e);
        setTotal(t);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!isMounted.current) return;
        setError(err instanceof Error ? err.message : "Failed to load audit log");
      })
      .finally(() => {
        if (isMounted.current) setLoading(false);
      });
  }, [offset, typeFilter, fromDate, toDate]);

  // Client-side tenant name filter on top of server results
  const visible = tenantSearch.trim()
    ? entries.filter(
        (e) =>
          e.tenant?.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
          e.tenant?.slug.toLowerCase().includes(tenantSearch.toLowerCase()),
      )
    : entries;

  function resetFilters() {
    setTypeFilter("");
    setTenantSearch("");
    setFromDate("");
    setToDate("");
    setOffset(0);
  }

  const hasFilters = !!(typeFilter || tenantSearch || fromDate || toDate);
  const pages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div>
      <header className="mb-5">
        <h1 className="font-serif text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-on-surface-variant">
          Sensitive and billing events, newest first
          {total > 0 && ` · ${total} total`}
        </p>
      </header>

      {/* Filter bar */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {EVENT_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => { setTypeFilter((cur) => (cur === t ? "" : t)); setOffset(0); }}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                typeFilter === t
                  ? "border-primary bg-primary-container text-on-primary-container"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
              }`}
            >
              {EVENT_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1">
            <MaterialIcon
              name="search"
              size={16}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              value={tenantSearch}
              onChange={(e) => setTenantSearch(e.target.value)}
              placeholder="Filter by tenant…"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setOffset(0); }}
            className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm outline-none focus:border-primary"
            title="From date"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setOffset(0); }}
            className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm outline-none focus:border-primary"
            title="To date"
          />
          {hasFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low"
            >
              <MaterialIcon name="close" size={14} />
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-error-container p-3 text-sm text-on-error-container">
          {error}
        </p>
      )}

      {loading ? (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low">
                {["Event", "Actor", "Tenant", "Details", "When"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-3 text-xs font-semibold text-on-surface-variant sm:px-4 ${i === 4 ? "text-right" : "text-left"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <TableRowsSkeleton rows={8} cols={5} />
            </tbody>
          </table>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-outline-variant bg-surface-container-lowest p-12 text-center shadow-sm">
          <MaterialIcon name="history" size={32} className="mb-3 text-on-surface-variant" />
          <p className="font-semibold">No events match</p>
          <p className="mt-1 max-w-sm text-sm text-on-surface-variant">
            {hasFilters
              ? "Try clearing some filters."
              : "Audit events are recorded when tenants are created/updated, plans are assigned, subscriptions change, or a super-admin impersonates a tenant."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  {["Event", "Actor", "Tenant", "Details", "When"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-3 py-3 text-xs font-semibold text-on-surface-variant sm:px-4 ${i === 4 ? "text-right" : "text-left"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
                  >
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                      <EventBadge type={e.type} />
                    </td>
                    <td className="px-3 py-2.5 text-on-surface-variant sm:px-4 sm:py-3">
                      {e.actor ? (
                        <span title={e.actor.email}>{e.actor.name}</span>
                      ) : (
                        <span className="italic text-on-surface-variant/60">system</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                      {e.tenant ? (
                        <Link
                          to={`/tenants/${e.tenant.id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {e.tenant.name}
                        </Link>
                      ) : (
                        <span className="italic text-on-surface-variant/60">—</span>
                      )}
                    </td>
                    <td className="max-w-xs px-3 py-2.5 sm:px-4 sm:py-3">
                      <MetadataSummary type={e.type} meta={e.metadata} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-on-surface-variant sm:px-4 sm:py-3">
                      {formatDate(e.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">
                Page {currentPage} of {pages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="rounded-lg border border-outline-variant px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="rounded-lg border border-outline-variant px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetadataSummary({ type, meta }: { type: string; meta: Record<string, unknown> }) {
  switch (type) {
    case "impersonation":
      return (
        <span className="text-on-surface-variant">
          Slug: <code className="text-xs">{String(meta.tenantSlug ?? "—")}</code>
        </span>
      );
    case "plan_assigned":
      return (
        <span className="text-on-surface-variant">
          Plan:{" "}
          <strong className="text-on-surface">
            {String(meta.planName ?? meta.planId ?? "—")}
          </strong>
        </span>
      );
    case "subscription_status_changed":
      return (
        <span className="text-on-surface-variant">
          {String(meta.from ?? "?")} → <strong>{String(meta.to ?? "?")}</strong>
          {meta.cancelAtPeriodEnd === true && (
            <span className="ml-1 text-xs text-tertiary">(at period end)</span>
          )}
        </span>
      );
    case "tenant_suspended":
    case "tenant_reactivated":
      return null;
    default:
      return (
        <span className="truncate text-xs text-on-surface-variant/70">
          {Object.keys(meta).length > 0
            ? Object.entries(meta)
                .slice(0, 2)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(", ")
            : null}
        </span>
      );
  }
}
