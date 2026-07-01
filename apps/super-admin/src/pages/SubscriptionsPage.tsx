import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatMoney, type TenantWithSubscription } from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import { StatusBadge } from "../components/StatusBadge";
import { tenantStatus } from "../lib/tenantStatus";
import { api } from "../api";
import { TableRowsSkeleton } from "../components/Skeleton";

export function SubscriptionsPage() {
  const [tenants, setTenants] = useState<TenantWithSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.admin
      .listTenants()
      .then(setTenants)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load subscriptions"),
      )
      .finally(() => setLoading(false));
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function updateSub(
    t: TenantWithSubscription,
    patch: { status?: "active" | "trialing" | "past_due" | "canceled"; cancelAtPeriodEnd?: boolean },
  ) {
    setBusyId(t.id);
    setOpenMenuId(null);
    try {
      const updated = await api.admin.updateSubscriptionStatus(t.id, patch);
      setTenants((all) => all.map((x) => (x.id === t.id ? { ...x, subscription: updated } : x)));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-2xl font-bold">Subscriptions</h1>
        <p className="text-sm text-on-surface-variant">
          Billing status across the network
        </p>
      </header>

      {error && <p className="mb-4 text-on-surface-variant">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-outline-variant bg-surface-container-low text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
            <tr>
              <th className="px-3 py-3 sm:px-4">Tenant</th>
              <th className="px-3 py-3 sm:px-4">Plan</th>
              <th className="px-3 py-3 sm:px-4">Status</th>
              <th className="px-3 py-3 sm:px-4">Renews / Ends</th>
              <th className="px-3 py-3 text-right sm:px-4">MRR</th>
              <th className="px-3 py-3 text-right sm:px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableRowsSkeleton rows={6} cols={6} />
            ) : (
              <>
                {tenants.map((t) => {
                  const status = tenantStatus(t.active, t.subscription?.status);
                  const sub = t.subscription;
                  const busy = busyId === t.id;
                  const canCancel =
                    sub &&
                    (sub.status === "active" ||
                      sub.status === "trialing" ||
                      sub.status === "past_due") &&
                    !sub.cancelAtPeriodEnd;
                  const canUndo = sub?.cancelAtPeriodEnd === true;
                  const canReactivate = sub?.status === "canceled";

                  return (
                    <tr
                      key={t.id}
                      className="border-b border-outline-variant last:border-0"
                    >
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <Link
                          to={`/tenants/${t.id}`}
                          className="flex items-center gap-2.5 font-semibold hover:text-primary"
                        >
                          <span
                            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                            style={{ background: t.theme.colors.primary ?? "#8a8178" }}
                          >
                            {t.name.slice(0, 1).toUpperCase()}
                          </span>
                          {t.name}
                        </Link>
                      </td>

                      <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <span className="rounded-md bg-surface-container px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
                          {sub?.plan.name ?? "—"}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={status} />
                          {canUndo && (
                            <span className="text-xs text-tertiary font-medium">
                              Cancels {new Date(sub!.currentPeriodEnd).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-2.5 text-on-surface-variant sm:px-4 sm:py-3">
                        {sub
                          ? new Date(sub.currentPeriodEnd).toLocaleDateString()
                          : "—"}
                      </td>

                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums sm:px-4 sm:py-3">
                        {sub &&
                        (sub.status === "active" || sub.status === "past_due")
                          ? formatMoney(sub.plan.priceCents)
                          : formatMoney(0)}
                      </td>

                      <td className="px-3 py-2.5 text-right sm:px-4 sm:py-3">
                        {!sub ? (
                          <span className="text-xs text-on-surface-variant">No plan</span>
                        ) : (
                          <div className="relative inline-block" ref={openMenuId === t.id ? menuRef : null}>
                            <div className="flex items-center justify-end gap-1.5">
                              {canUndo && (
                                <button
                                  disabled={busy}
                                  onClick={() => updateSub(t, { cancelAtPeriodEnd: false })}
                                  className="rounded-lg border border-outline-variant px-2.5 py-1 text-xs font-semibold hover:bg-surface-container-low disabled:opacity-50"
                                >
                                  Undo cancel
                                </button>
                              )}
                              {canReactivate && (
                                <button
                                  disabled={busy}
                                  onClick={() => updateSub(t, { status: "active" })}
                                  className="rounded-lg border border-secondary px-2.5 py-1 text-xs font-semibold text-secondary hover:bg-secondary/10 disabled:opacity-50"
                                >
                                  Reactivate
                                </button>
                              )}
                              {canCancel && (
                                <div className="relative">
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      setOpenMenuId((cur) => (cur === t.id ? null : t.id))
                                    }
                                    className="flex items-center gap-1 rounded-lg border border-outline-variant px-2.5 py-1 text-xs font-semibold hover:bg-surface-container-low disabled:opacity-50"
                                  >
                                    Cancel
                                    <MaterialIcon name="expand_more" size={14} />
                                  </button>
                                  {openMenuId === t.id && (
                                    <div
                                      ref={menuRef}
                                      className="absolute right-0 top-full z-10 mt-1 w-48 rounded-xl border border-outline-variant bg-surface shadow-lg"
                                    >
                                      <button
                                        onClick={() =>
                                          updateSub(t, { cancelAtPeriodEnd: true })
                                        }
                                        className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-container-low rounded-t-xl"
                                      >
                                        <MaterialIcon
                                          name="schedule"
                                          size={16}
                                          className="mt-0.5 shrink-0 text-tertiary"
                                        />
                                        <span>
                                          <span className="block font-semibold">At period end</span>
                                          <span className="text-xs text-on-surface-variant">
                                            Access until {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                                          </span>
                                        </span>
                                      </button>
                                      <button
                                        onClick={() =>
                                          updateSub(t, { status: "canceled" })
                                        }
                                        className="flex w-full items-start gap-2 border-t border-outline-variant px-3 py-2.5 text-left text-sm text-error hover:bg-error/5 rounded-b-xl"
                                      >
                                        <MaterialIcon
                                          name="cancel"
                                          size={16}
                                          className="mt-0.5 shrink-0"
                                        />
                                        <span>
                                          <span className="block font-semibold">Cancel immediately</span>
                                          <span className="text-xs text-on-surface-variant">
                                            Locks out restaurant-admin now
                                          </span>
                                        </span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                              {!canCancel && !canUndo && !canReactivate && (
                                <span className="text-xs text-on-surface-variant">—</span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
        {!loading && tenants.length === 0 && !error && (
          <p className="p-12 text-center text-on-surface-variant">
            No tenants yet.
          </p>
        )}
      </div>
    </div>
  );
}
