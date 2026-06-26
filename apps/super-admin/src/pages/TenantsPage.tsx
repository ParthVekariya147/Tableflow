import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { TenantWithSubscription } from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { tenantStatus, type TenantStatus } from "../lib/tenantStatus";
import { Toggle } from "../components/Toggle";
import { TableRowsSkeleton } from "../components/Skeleton";

const restaurantAdminUrl =
  import.meta.env.VITE_RESTAURANT_ADMIN_URL ?? "http://localhost:5174";

const FILTERS: { key: TenantStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "trialing", label: "Trialing" },
  { key: "past_due", label: "Past due" },
  { key: "suspended", label: "Suspended" },
];

type ModalState =
  | { kind: "impersonate"; tenant: TenantWithSubscription }
  | { kind: "suspend"; tenant: TenantWithSubscription }
  | null;

export function TenantsPage() {
  const [tenants, setTenants] = useState<TenantWithSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TenantStatus | "all">("all");
  const [modal, setModal] = useState<ModalState>(null);
  const [masterPw, setMasterPw] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .listTenants()
      .then(setTenants)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load tenants"),
      )
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tenants.filter((t) => {
      const status = tenantStatus(t.active, t.subscription?.status);
      if (filter !== "all" && status !== filter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q)
      );
    });
  }, [tenants, query, filter]);

  function closeModal() {
    setModal(null);
    setMasterPw("");
    setActionError(null);
  }

  async function toggleActive(t: TenantWithSubscription) {
    if (t.active) {
      setModal({ kind: "suspend", tenant: t });
      return;
    }
    setBusyId(t.id);
    try {
      const updated = await api.admin.updateTenant(t.id, { active: true });
      setTenants((all) =>
        all.map((x) => (x.id === t.id ? { ...x, active: updated.active } : x)),
      );
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmSuspend() {
    if (modal?.kind !== "suspend") return;
    const t = modal.tenant;
    setBusyId(t.id);
    try {
      const updated = await api.admin.updateTenant(t.id, { active: false });
      setTenants((all) =>
        all.map((x) => (x.id === t.id ? { ...x, active: updated.active } : x)),
      );
      closeModal();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmImpersonate() {
    if (modal?.kind !== "impersonate" || !masterPw) return;
    const t = modal.tenant;
    setBusyId(t.id);
    setActionError(null);
    try {
      const { token } = await api.admin.impersonate({
        tenantSlug: t.slug,
        masterPassword: masterPw,
      });
      window.open(
        `${restaurantAdminUrl}?impersonationToken=${encodeURIComponent(token)}`,
        "_blank",
      );
      closeModal();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Impersonation failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold">Tenants</h1>
          <p className="text-sm text-on-surface-variant">
            Every restaurant on Amber &amp; Grain
          </p>
        </div>
        <Link
          to="/tenants/new"
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:opacity-90"
        >
          <MaterialIcon name="add" size={18} />
          New tenant
        </Link>
      </header>

      {error && (
        <p className="mb-4 text-on-surface-variant">
          API not reachable ({error}). Start <code>@amber/api</code> and seed
          the DB to see live tenants.
        </p>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="relative w-full sm:max-w-sm sm:flex-1 sm:min-w-[220px]">
          <MaterialIcon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, slug…"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                filter === f.key
                  ? "border-primary bg-primary-container text-on-primary-container"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-on-surface-variant sm:ml-auto">
          {visible.length} of {tenants.length} tenants
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
        <table className="w-full min-w-[580px] text-left text-sm">
          <thead className="border-b border-outline-variant bg-surface-container-low text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
            <tr>
              <th className="px-3 py-3 sm:px-4">Restaurant</th>
              <th className="px-3 py-3 sm:px-4">Plan</th>
              <th className="px-3 py-3 sm:px-4">Status</th>
              <th className="px-3 py-3 text-right sm:px-4">MRR</th>
              <th className="px-3 py-3 text-right sm:px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableRowsSkeleton rows={6} cols={5} />
            ) : (<>{visible.map((t) => {
              const status = tenantStatus(t.active, t.subscription?.status);
              return (
                <tr
                  key={t.id}
                  className="cursor-pointer border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
                >
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                    <Link to={`/tenants/${t.id}`} className="flex items-center gap-2.5">
                      <span
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full font-serif text-sm font-bold text-white"
                        style={{ background: t.theme.colors.primary ?? "#8a8178" }}
                      >
                        {t.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{t.name}</div>
                        <div className="truncate font-mono text-xs text-on-surface-variant">
                          {t.slug}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                    <span className="rounded-md bg-surface-container px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
                      {t.subscription?.plan.name ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums sm:px-4 sm:py-3">
                    {t.subscription &&
                    (t.subscription.status === "active" ||
                      t.subscription.status === "past_due")
                      ? "$" + (t.subscription.plan.priceCents / 100).toFixed(0)
                      : "$0"}
                  </td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Toggle
                        checked={t.active}
                        disabled={busyId === t.id}
                        onChange={() => toggleActive(t)}
                        title={t.active ? "Disable" : "Reactivate"}
                      />
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setModal({ kind: "impersonate", tenant: t });
                        }}
                        title="Impersonate"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant text-secondary hover:bg-secondary/10 hover:border-secondary"
                      >
                        <MaterialIcon name="visibility" size={16} />
                      </button>
                      <Link
                        to={`/tenants/${t.id}/edit`}
                        title="Edit"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                      >
                        <MaterialIcon name="edit" size={16} />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}</>)}
          </tbody>
        </table>
        {!loading && visible.length === 0 && !error && (
          <p className="p-12 text-center text-on-surface-variant">
            No tenants match your search.
          </p>
        )}
      </div>

      {modal?.kind === "impersonate" && (
        <Modal onClose={closeModal}>
          <div className="flex items-center gap-3 bg-inverse-surface px-6 py-4">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/10">
              <MaterialIcon name="visibility" size={18} className="text-secondary-fixed-dim" />
            </span>
            <div>
              <div className="text-sm font-semibold text-inverse-on-surface">
                Platform Support Access
              </div>
              <div className="text-xs text-inverse-on-surface/70">
                Higher-trust action · will be logged
              </div>
            </div>
          </div>
          <div className="p-6">
            <p className="mb-4 text-sm leading-relaxed">
              You're about to sign into <strong>{modal.tenant.name}</strong>'s
              restaurant admin as platform support. Enter the master password
              to continue.
            </p>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              Master password
            </label>
            <input
              type="password"
              autoFocus
              value={masterPw}
              onChange={(e) => setMasterPw(e.target.value)}
              placeholder="Enter platform master password"
              className="mb-2 w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
            <p className="mb-4 text-xs text-on-surface-variant">
              Opens {modal.tenant.slug} in a new tab with a 30-minute
              impersonation token.
            </p>
            {actionError && (
              <p className="mb-3 text-sm text-error">{actionError}</p>
            )}
            <div className="flex justify-end gap-2.5">
              <button
                onClick={closeModal}
                className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                onClick={confirmImpersonate}
                disabled={!masterPw || busyId === modal.tenant.id}
                className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-on-secondary disabled:opacity-50"
              >
                <MaterialIcon name="visibility" size={16} />
                Authenticate &amp; open
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal?.kind === "suspend" && (
        <Modal onClose={closeModal}>
          <div className="p-6">
            <div className="flex gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-error/10">
                <MaterialIcon name="warning" size={20} className="text-error" />
              </span>
              <div>
                <h3 className="font-serif text-lg font-bold">
                  Suspend {modal.tenant.name}?
                </h3>
                <p className="text-sm text-on-surface-variant">
                  This locks {modal.tenant.name} out of restaurant-admin
                  immediately — staff are signed out and ordering stops until
                  reactivated.
                </p>
              </div>
            </div>
            {actionError && (
              <p className="mt-3 text-sm text-error">{actionError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                onClick={closeModal}
                className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-low"
              >
                Keep active
              </button>
              <button
                onClick={confirmSuspend}
                disabled={busyId === modal.tenant.id}
                className="rounded-lg bg-error px-4 py-2 text-sm font-semibold text-on-error disabled:opacity-50"
              >
                Suspend tenant
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
