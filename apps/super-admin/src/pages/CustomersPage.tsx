import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminLoyaltyAccountDetail, AdminLoyaltyAccountSummary } from "@amber/api-client";
import { MaterialIcon } from "@amber/ui";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { Spinner, TableRowsSkeleton } from "../components/Skeleton";

/**
 * Cross-tenant customer lookup (`/customers`) — platform support can search
 * every tenant's loyalty accounts by phone/name. Read-only: point corrections
 * stay a restaurant-admin action so they're attributable to that tenant's
 * staff (see admin.service.ts's listLoyaltyAccounts).
 */
export function CustomersPage() {
  const [accounts, setAccounts] = useState<AdminLoyaltyAccountSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      api.admin.loyaltyAccounts
        .list({ search: query || undefined })
        .then(setAccounts)
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : "Failed to load customers"),
        )
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-2xl font-bold">Customers</h1>
        <p className="text-sm text-on-surface-variant">
          Loyalty accounts across every restaurant tenant.
        </p>
      </header>

      {error && (
        <p className="mb-4 text-on-surface-variant">
          API not reachable ({error}).
        </p>
      )}

      <div className="relative mb-4 w-full max-w-sm">
        <MaterialIcon
          name="search"
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search phone or name…"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-outline-variant bg-surface-container-low text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
            <tr>
              <th className="px-3 py-3 sm:px-4">Customer</th>
              <th className="px-3 py-3 sm:px-4">Restaurant</th>
              <th className="px-3 py-3 text-right sm:px-4">Balance</th>
              <th className="px-3 py-3 text-right sm:px-4">Lifetime</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableRowsSkeleton rows={6} cols={4} />
            ) : (
              accounts.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setDetailId(a.id)}
                  className="cursor-pointer border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
                >
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                    <div className="font-semibold">{a.name || "Unnamed guest"}</div>
                    <div className="font-mono text-xs text-on-surface-variant">{a.phone}</div>
                  </td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                    <span className="rounded-md bg-surface-container px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
                      {a.tenantName}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums sm:px-4 sm:py-3">
                    {a.pointsBalance}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-on-surface-variant sm:px-4 sm:py-3">
                    {a.lifetimePoints}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && accounts.length === 0 && !error && (
          <p className="p-12 text-center text-on-surface-variant">
            No customers match your search.
          </p>
        )}
      </div>

      {detailId && (
        <CustomerDetailModal id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

function CustomerDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminLoyaltyAccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin.loyaltyAccounts
      .get(id)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
        <h2 className="font-serif text-lg font-bold">
          {detail?.name || detail?.phone || "Customer"}
        </h2>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low"
        >
          <MaterialIcon name="close" size={18} />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-on-surface-variant">
            <Spinner size={22} />
            <span className="text-sm">Loading…</span>
          </div>
        ) : error ? (
          <p className="text-sm text-error">{error}</p>
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-xl border border-outline-variant p-4">
              <div>
                <div className="font-mono text-sm text-on-surface-variant">{detail.phone}</div>
                <Link
                  to={`/tenants/${detail.tenantId}`}
                  className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  <MaterialIcon name="apartment" size={14} />
                  {detail.tenantName}
                </Link>
              </div>
              <div className="text-right">
                <div className="font-serif text-2xl font-bold text-primary">
                  {detail.pointsBalance}
                </div>
                <div className="text-xs text-on-surface-variant">
                  {detail.lifetimePoints} lifetime
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-on-surface-variant">History</h3>
              {detail.transactions.length === 0 ? (
                <p className="text-sm text-on-surface-variant">No transactions yet.</p>
              ) : (
                <ul className="divide-y divide-outline-variant">
                  {detail.transactions.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <p className="text-sm font-semibold capitalize">
                          {t.type}
                          {t.note && (
                            <span className="ml-1 font-normal text-on-surface-variant">
                              — {t.note}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          {new Date(t.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <span
                        className={`font-mono text-sm ${
                          t.points >= 0 ? "text-primary" : "text-error"
                        }`}
                      >
                        {t.points >= 0 ? "+" : ""}
                        {t.points}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
