import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  formatMoney,
  type Plan,
  type TenantWithSubscription,
} from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import type { TenantPayment } from "@amber/api-client";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { tenantStatus } from "../lib/tenantStatus";
import { Toggle } from "../components/Toggle";
import {
  TenantDetailHeaderSkeleton,
  CardSkeleton,
} from "../components/Skeleton";

const restaurantAdminUrl =
  import.meta.env.VITE_RESTAURANT_ADMIN_URL ?? "http://localhost:5174";

type ModalState = "impersonate" | "suspend" | "plan" | null;

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<TenantWithSubscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<TenantPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [masterPw, setMasterPw] = useState("");
  const [pickPlanId, setPickPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.admin.getTenant(id),
      api.admin.listPlans(),
      api.admin.getTenantPayments(id),
    ])
      .then(([found, allPlans, tenantPayments]) => {
        setTenant(found);
        setPlans(allPlans);
        setPayments(tenantPayments);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load tenant"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  function closeModal() {
    setModal(null);
    setMasterPw("");
    setActionError(null);
  }

  async function toggleActive() {
    if (!tenant) return;
    if (tenant.active) {
      setModal("suspend");
      return;
    }
    setBusy(true);
    try {
      await api.admin.updateTenant(tenant.id, { active: true });
      load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSuspend() {
    if (!tenant) return;
    setBusy(true);
    try {
      await api.admin.updateTenant(tenant.id, { active: false });
      load();
      closeModal();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImpersonate() {
    if (!tenant || !masterPw) return;
    setBusy(true);
    setActionError(null);
    try {
      const { token } = await api.admin.impersonate({
        tenantSlug: tenant.slug,
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
      setBusy(false);
    }
  }

  async function confirmPlanChange() {
    if (!tenant || !pickPlanId) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.admin.setSubscription(tenant.id, { planId: pickPlanId });
      load();
      closeModal();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Plan change failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateSubStatus(
    patch: { status?: "active" | "trialing" | "past_due" | "canceled"; cancelAtPeriodEnd?: boolean },
  ) {
    if (!tenant) return;
    setBusy(true);
    try {
      await api.admin.updateSubscriptionStatus(tenant.id, patch);
      load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const backLink = (
    <button
      onClick={() => navigate("/tenants")}
      className="mb-4 inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary"
    >
      <MaterialIcon name="arrow_back" size={18} />
      All tenants
    </button>
  );

  if (loading) {
    return (
      <div>
        {backLink}
        <TenantDetailHeaderSkeleton />
        <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-4">
            <CardSkeleton lines={3} />
            <CardSkeleton lines={4} />
            <CardSkeleton lines={6} />
          </div>
          <CardSkeleton lines={5} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {backLink}
        <p className="text-error">{error}</p>
      </div>
    );
  }
  if (!tenant) return null;

  const status = tenantStatus(tenant.active, tenant.subscription?.status);
  const swatches = Object.values(tenant.theme.colors).slice(0, 4);

  return (
    <div>
      {backLink}

      <div className="flex flex-wrap items-start gap-5 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm sm:items-center sm:p-6">
        <span
          className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full font-serif text-2xl font-bold text-white"
          style={{ background: tenant.theme.colors.primary ?? "#8a8178" }}
        >
          {tenant.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-serif text-2xl font-bold">{tenant.name}</h2>
            <StatusBadge status={status} />
          </div>
          <div className="mt-1 font-mono text-sm text-on-surface-variant">
            {tenant.slug}
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={() => setModal("impersonate")}
            className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-on-secondary hover:opacity-90"
          >
            <MaterialIcon name="visibility" size={16} />
            Impersonate
          </button>
          <Link
            to={`/tenants/${tenant.id}/edit`}
            className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-low"
          >
            <MaterialIcon name="edit" size={16} />
            Edit details
          </Link>
          {tenant.active && (
            <button
              onClick={() => setModal("suspend")}
              className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold text-error hover:bg-error/10"
            >
              Suspend
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          {/* Subscription */}
          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-on-surface-variant">
              Subscription
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="font-serif text-xl font-bold">
                  {tenant.subscription?.plan.name ?? "No plan"}{" "}
                  {tenant.subscription && (
                    <span className="font-sans text-sm font-semibold text-on-surface-variant">
                      {formatMoney(tenant.subscription.plan.priceCents)}/
                      {tenant.subscription.plan.interval}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm text-on-surface-variant">
                  {tenant.subscription
                    ? `Renews ${new Date(tenant.subscription.currentPeriodEnd).toLocaleDateString()}`
                    : "No subscription assigned"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setPickPlanId(tenant.subscription?.plan.id ?? plans[0]?.id ?? null);
                    setModal("plan");
                  }}
                  className="rounded-lg border border-outline-variant px-3.5 py-2 text-sm font-semibold hover:bg-surface-container-low"
                >
                  Change plan
                </button>
                {tenant.subscription?.status === "canceled" && (
                  <button
                    disabled={busy}
                    onClick={() => updateSubStatus({ status: "active" })}
                    className="rounded-lg border border-secondary px-3.5 py-2 text-sm font-semibold text-secondary hover:bg-secondary/10 disabled:opacity-50"
                  >
                    Reactivate
                  </button>
                )}
                {tenant.subscription?.cancelAtPeriodEnd && (
                  <button
                    disabled={busy}
                    onClick={() => updateSubStatus({ cancelAtPeriodEnd: false })}
                    className="rounded-lg border border-outline-variant px-3.5 py-2 text-sm font-semibold hover:bg-surface-container-low disabled:opacity-50"
                  >
                    Undo cancel
                  </button>
                )}
                {tenant.subscription &&
                  !tenant.subscription.cancelAtPeriodEnd &&
                  tenant.subscription.status !== "canceled" && (
                    <button
                      disabled={busy}
                      onClick={() => updateSubStatus({ cancelAtPeriodEnd: true })}
                      className="rounded-lg border border-outline-variant px-3.5 py-2 text-sm font-semibold text-error hover:bg-error/5 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                <div className="flex flex-col items-center gap-1">
                  <Toggle checked={tenant.active} disabled={busy} onChange={toggleActive} />
                  <span
                    className={`text-xs font-semibold ${tenant.active ? "text-primary" : "text-on-surface-variant"}`}
                  >
                    {tenant.active ? "On" : "Off"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Plan limits (real data; "usage" itself isn't tracked cross-tenant yet) */}
          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-on-surface-variant">
              Plan limits
            </div>
            {tenant.subscription ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-on-surface-variant">Tables</div>
                  <div className="font-semibold">
                    {tenant.subscription.plan.limits.maxTables ?? "Unlimited"}
                  </div>
                </div>
                <div>
                  <div className="text-on-surface-variant">Orders / month</div>
                  <div className="font-semibold">
                    {tenant.subscription.plan.limits.maxOrdersPerMonth ?? "Unlimited"}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">
                Assign a plan to see its limits.
              </p>
            )}
            <p className="mt-3 text-xs text-on-surface-variant">
              Actual usage (tables in use, orders this month) isn't tracked
              cross-tenant yet — needs a platform analytics endpoint.
            </p>
          </div>

          {/* Billing history — last 50 orders with payments */}
          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-on-surface-variant">
              Billing history{" "}
              <span className="font-normal text-on-surface-variant/60">
                (last {payments.length} transactions)
              </span>
            </div>
            {payments.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                No transactions recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-outline-variant">
                      <th className="pb-2 text-left font-semibold text-on-surface-variant">
                        Table
                      </th>
                      <th className="pb-2 text-left font-semibold text-on-surface-variant">
                        Guest
                      </th>
                      <th className="pb-2 text-right font-semibold text-on-surface-variant">
                        Total
                      </th>
                      <th className="pb-2 pl-3 text-left font-semibold text-on-surface-variant">
                        Method
                      </th>
                      <th className="pb-2 text-right font-semibold text-on-surface-variant">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-outline-variant/50 last:border-0"
                      >
                        <td className="py-1.5 pr-2 font-medium">
                          {p.tableLabel}
                        </td>
                        <td className="py-1.5 pr-2 text-on-surface-variant">
                          {p.customerName ?? "—"}
                        </td>
                        <td className="py-1.5 text-right font-semibold">
                          {formatMoney(p.total)}
                        </td>
                        <td className="py-1.5 pl-3 capitalize text-on-surface-variant">
                          {p.method}
                        </td>
                        <td className="py-1.5 text-right text-on-surface-variant">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Account info */}
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
          <div className="mb-3.5 text-sm font-semibold text-on-surface-variant">
            Account
          </div>
          <div className="flex flex-col gap-3.5 text-sm">
            <div>
              <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Slug
              </div>
              <div className="font-mono">{tenant.slug}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Currency
                </div>
                <div>{tenant.currency}</div>
              </div>
              <div>
                <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Tax rate
                </div>
                <div>{(tenant.taxRate * 100).toFixed(2)}%</div>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Brand theme
              </div>
              <div className="flex gap-1.5">
                {swatches.length === 0 && (
                  <span className="text-on-surface-variant">Default</span>
                )}
                {swatches.map((c, i) => (
                  <span
                    key={i}
                    className="h-6 w-6 rounded-md border border-outline-variant"
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <p className="text-xs text-on-surface-variant">
              Owner contact / billing address fields aren't modeled on{" "}
              <code>Tenant</code> yet (see PLATFORM_PLAN.md open risks).
            </p>
          </div>
        </div>
      </div>

      {modal === "impersonate" && (
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
              You're about to sign into <strong>{tenant.name}</strong>'s
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
              Opens {tenant.slug} in a new tab with a 30-minute impersonation
              token.
            </p>
            {actionError && <p className="mb-3 text-sm text-error">{actionError}</p>}
            <div className="flex justify-end gap-2.5">
              <button
                onClick={closeModal}
                className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                onClick={confirmImpersonate}
                disabled={!masterPw || busy}
                className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-on-secondary disabled:opacity-50"
              >
                <MaterialIcon name="visibility" size={16} />
                Authenticate &amp; open
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "suspend" && (
        <Modal onClose={closeModal}>
          <div className="p-6">
            <div className="flex gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-error/10">
                <MaterialIcon name="warning" size={20} className="text-error" />
              </span>
              <div>
                <h3 className="font-serif text-lg font-bold">
                  Suspend {tenant.name}?
                </h3>
                <p className="text-sm text-on-surface-variant">
                  This locks {tenant.name} out of restaurant-admin immediately
                  — staff are signed out and ordering stops until
                  reactivated.
                </p>
              </div>
            </div>
            {actionError && <p className="mt-3 text-sm text-error">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                onClick={closeModal}
                className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-low"
              >
                Keep active
              </button>
              <button
                onClick={confirmSuspend}
                disabled={busy}
                className="rounded-lg bg-error px-4 py-2 text-sm font-semibold text-on-error disabled:opacity-50"
              >
                Suspend tenant
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "plan" && (
        <Modal onClose={closeModal}>
          <div className="p-6">
            <h3 className="mb-1 font-serif text-lg font-bold">Change plan</h3>
            <p className="mb-4 text-sm text-on-surface-variant">
              Select a new plan for {tenant.name}.
            </p>
            <div className="mb-5 flex flex-col gap-2.5">
              {plans.map((p) => {
                const picked = pickPlanId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setPickPlanId(p.id)}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                      picked
                        ? "border-primary bg-primary/5"
                        : "border-outline-variant hover:bg-surface-container-low"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                        picked ? "border-primary" : "border-outline-variant"
                      }`}
                    >
                      {picked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                    </span>
                    <span className="flex-1 text-sm font-semibold">{p.name}</span>
                    <span className="font-serif text-base font-bold">
                      {formatMoney(p.priceCents)}
                      <span className="font-sans text-xs font-medium text-on-surface-variant">
                        /{p.interval}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {actionError && <p className="mb-3 text-sm text-error">{actionError}</p>}
            <div className="flex justify-end gap-2.5">
              <button
                onClick={closeModal}
                className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                onClick={confirmPlanChange}
                disabled={!pickPlanId || busy}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
              >
                Assign plan
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
