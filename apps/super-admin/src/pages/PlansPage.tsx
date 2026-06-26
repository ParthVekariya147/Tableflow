import { useEffect, useState, type FormEvent } from "react";
import { type Plan } from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { PlanCardsSkeleton } from "../components/Skeleton";
import {
  CURRENCIES,
  type SupportedCurrency,
  detectUserCurrency,
  fetchRates,
  formatInCurrency,
} from "../lib/currency";

/**
 * Features shown per plan tier (index 0 = cheapest active plan).
 * Aligns with the 3 seeded plans: Free Trial → Starter → Growth Pro.
 */
const TIER_FEATURES: string[][] = [
  // Free Trial
  [
    "Up to 5 tables",
    "100 orders / month",
    "QR table ordering",
    "Basic menu management",
    "Basic analytics",
    "7-day trial — no credit card needed",
  ],
  // Starter
  [
    "Up to 15 tables",
    "500 orders / month",
    "QR table ordering",
    "Full menu management",
    "Kitchen Display System (KDS)",
    "Analytics dashboard",
    "Email support",
  ],
  // Growth Pro
  [
    "Up to 50 tables",
    "2,000 orders / month",
    "Everything in Starter",
    "Advanced analytics & reports",
    "Order history export",
    "Multi-device KDS",
    "Priority support",
  ],
];

function tierFeatures(index: number): string[] {
  return TIER_FEATURES[Math.min(index, TIER_FEATURES.length - 1)] ?? [];
}

type DraftForm = {
  name: string;
  priceDollars: string;
  interval: "month" | "year";
  maxTables: string;
  maxOrdersPerMonth: string;
  active: boolean;
};

const EMPTY_DRAFT: DraftForm = {
  name: "",
  priceDollars: "0",
  interval: "month",
  maxTables: "",
  maxOrdersPerMonth: "",
  active: true,
};

function planToDraft(p: Plan): DraftForm {
  return {
    name: p.name,
    priceDollars: (p.priceCents / 100).toFixed(2),
    interval: p.interval,
    maxTables: p.limits.maxTables ? String(p.limits.maxTables) : "",
    maxOrdersPerMonth: p.limits.maxOrdersPerMonth
      ? String(p.limits.maxOrdersPerMonth)
      : "",
    active: p.active,
  };
}

export function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Currency exchange
  const [currency, setCurrency] = useState<SupportedCurrency>("USD");
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [ratesError, setRatesError] = useState(false);

  function load() {
    api.admin
      .listPlans()
      .then(setPlans)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load plans"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    setCurrency(detectUserCurrency());
    fetchRates()
      .then(setRates)
      .catch(() => setRatesError(true));
  }, []);

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setSaveError(null);
    setEditing("new");
  }

  function openEdit(p: Plan) {
    setDraft(planToDraft(p));
    setSaveError(null);
    setEditing(p);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const body = {
      name: draft.name,
      priceCents: Math.round((Number(draft.priceDollars) || 0) * 100),
      interval: draft.interval,
      limits: {
        ...(draft.maxTables ? { maxTables: Number(draft.maxTables) } : {}),
        ...(draft.maxOrdersPerMonth
          ? { maxOrdersPerMonth: Number(draft.maxOrdersPerMonth) }
          : {}),
      },
    };
    try {
      if (editing === "new") {
        await api.admin.createPlan(body);
      } else if (editing) {
        await api.admin.updatePlan(editing.id, { ...body, active: draft.active });
      }
      setEditing(null);
      load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function priceDisplay(priceCents: number): string {
    if (!rates) return `$${(priceCents / 100).toFixed(2)}`;
    return formatInCurrency(priceCents, currency, rates);
  }

  const monthlyPlans = plans.filter((p) => p.interval === "month");
  const yearlyPlans = plans.filter((p) => p.interval === "year");

  return (
    <div>
      {/* Header */}
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold">Subscription Plans</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Manage the plan catalog that restaurants subscribe to.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:opacity-90"
        >
          <MaterialIcon name="add" size={18} />
          New plan
        </button>
      </header>

      {/* Currency selector */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-on-surface-variant">
          Display prices in:
        </span>
        <div className="relative">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
            className="appearance-none rounded-lg border border-outline-variant bg-surface pl-3 pr-8 py-1.5 text-sm font-medium outline-none focus:border-primary"
          >
            {(Object.keys(CURRENCIES) as SupportedCurrency[]).map((c) => (
              <option key={c} value={c}>
                {CURRENCIES[c].flag} {c} — {CURRENCIES[c].name}
              </option>
            ))}
          </select>
          <MaterialIcon
            name="keyboard_arrow_down"
            size={16}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
        </div>
        {ratesError && (
          <span className="text-xs text-on-surface-variant">
            (Live rates unavailable — showing USD)
          </span>
        )}
        {rates && currency !== "USD" && (
          <span className="text-xs text-on-surface-variant">
            1 USD ≈ {CURRENCIES[currency].symbol}
            {(rates[currency] ?? 1).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </span>
        )}
      </div>

      {error && <p className="mb-4 text-on-surface-variant">{error}</p>}

      {/* Monthly plans */}
      <PlanSection
        title="Monthly Plans"
        plans={monthlyPlans}
        loading={loading}
        priceDisplay={priceDisplay}
        currency={currency}
        onEdit={openEdit}
      />

      {/* Yearly plans (if any) */}
      {!loading && yearlyPlans.length > 0 && (
        <PlanSection
          title="Yearly Plans"
          plans={yearlyPlans}
          loading={false}
          priceDisplay={priceDisplay}
          currency={currency}
          onEdit={openEdit}
          className="mt-10"
        />
      )}

      {!loading && plans.length === 0 && !error && (
        <div className="rounded-2xl border border-dashed border-outline-variant p-10 text-center">
          <p className="text-on-surface-variant">
            No plans yet. Create your first plan to get started.
          </p>
        </div>
      )}

      {/* Edit / Create modal */}
      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <form onSubmit={handleSubmit} className="p-6">
            <h3 className="mb-4 font-serif text-lg font-bold">
              {editing === "new" ? "New plan" : `Edit "${editing.name}"`}
            </h3>
            <div className="flex flex-col gap-3.5">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Plan name
                </span>
                <input
                  required
                  placeholder="e.g. Starter, Professional, Business"
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Price (USD / period)
                  </span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant">
                      $
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.priceDollars}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          priceDollars: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-outline-variant bg-surface pl-6 pr-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Billing interval
                  </span>
                  <select
                    value={draft.interval}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        interval: e.target.value as "month" | "year",
                      }))
                    }
                    className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                  >
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Max tables
                  </span>
                  <input
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    value={draft.maxTables}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, maxTables: e.target.value }))
                    }
                    className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Max orders / month
                  </span>
                  <input
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    value={draft.maxOrdersPerMonth}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        maxOrdersPerMonth: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </label>
              </div>
              {editing !== "new" && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, active: e.target.checked }))
                    }
                  />
                  Active (available for new subscriptions)
                </label>
              )}
            </div>

            {saveError && (
              <p className="mt-3 text-sm text-error">{saveError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
              >
                {saving
                  ? "Saving…"
                  : editing === "new"
                    ? "Create plan"
                    : "Save changes"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Plan section ──────────────────────────────────────────────────────────────

type PlanSectionProps = {
  title: string;
  plans: Plan[];
  loading: boolean;
  priceDisplay: (cents: number) => string;
  currency: SupportedCurrency;
  onEdit: (p: Plan) => void;
  className?: string;
};

function PlanSection({
  title,
  plans,
  loading,
  priceDisplay,
  currency,
  onEdit,
  className = "",
}: PlanSectionProps) {
  const midIndex = Math.floor((plans.length - 1) / 2);

  return (
    <section className={className}>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-on-surface-variant">
        {title}
      </h2>
      {loading ? (
        <PlanCardsSkeleton count={3} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {plans.map((p, i) => {
            const isPopular = plans.length >= 2 && i === midIndex;
            return (
              <PlanCard
                key={p.id}
                plan={p}
                index={i}
                isPopular={isPopular}
                priceDisplay={priceDisplay}
                currency={currency}
                onEdit={() => onEdit(p)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Plan card ─────────────────────────────────────────────────────────────────

type PlanCardProps = {
  plan: Plan;
  index: number;
  isPopular: boolean;
  priceDisplay: (cents: number) => string;
  currency: SupportedCurrency;
  onEdit: () => void;
};

function PlanCard({
  plan,
  index,
  isPopular,
  priceDisplay,
  currency,
  onEdit,
}: PlanCardProps) {
  const features = tierFeatures(index);
  const usdLabel =
    currency !== "USD"
      ? `$${(plan.priceCents / 100).toFixed(0)} USD`
      : null;

  return (
    <div
      className={[
        "relative flex flex-col rounded-2xl border p-5 shadow-sm transition-shadow hover:shadow-md",
        isPopular
          ? "border-primary bg-primary/5"
          : "border-outline-variant bg-surface-container-lowest",
        !plan.active ? "opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Popular badge */}
      {isPopular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-on-primary">
          Most Popular
        </span>
      )}

      {/* Inactive badge */}
      {!plan.active && (
        <span className="absolute right-3 top-3 rounded-full bg-error/10 px-2 py-0.5 text-xs font-semibold text-error">
          Inactive
        </span>
      )}

      {/* Plan name */}
      <h2 className="mb-1 font-serif text-lg font-bold text-on-surface">
        {plan.name}
      </h2>

      {/* Price */}
      <div className="mb-1">
        <span className="font-serif text-3xl font-extrabold text-on-surface">
          {priceDisplay(plan.priceCents)}
        </span>
        <span className="ml-1 text-sm text-on-surface-variant">
          / {plan.interval}
        </span>
      </div>
      {usdLabel && (
        <p className="mb-3 text-xs text-on-surface-variant">{usdLabel} / {plan.interval}</p>
      )}

      {/* Limits */}
      <div className="mb-4 flex flex-wrap gap-2">
        {plan.limits.maxTables ? (
          <Chip icon="table_restaurant" label={`${plan.limits.maxTables} tables`} />
        ) : (
          <Chip icon="all_inclusive" label="Unlimited tables" highlight />
        )}
        {plan.limits.maxOrdersPerMonth ? (
          <Chip
            icon="receipt_long"
            label={`${plan.limits.maxOrdersPerMonth.toLocaleString()} orders/mo`}
          />
        ) : (
          <Chip icon="all_inclusive" label="Unlimited orders" highlight />
        )}
      </div>

      {/* Feature list */}
      <ul className="mb-5 flex-1 space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-on-surface-variant">
            <MaterialIcon
              name="check_circle"
              size={16}
              className="mt-0.5 flex-shrink-0 text-primary"
            />
            {f}
          </li>
        ))}
      </ul>

      {/* Edit button */}
      <button
        onClick={onEdit}
        className={[
          "mt-auto w-full rounded-lg py-2 text-sm font-semibold transition-colors",
          isPopular
            ? "bg-primary text-on-primary hover:opacity-90"
            : "border border-outline-variant hover:bg-surface-container-low",
        ].join(" ")}
      >
        Edit plan
      </button>
    </div>
  );
}

function Chip({
  icon,
  label,
  highlight = false,
}: {
  icon: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <span
      className={[
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        highlight
          ? "bg-primary/10 text-primary"
          : "bg-surface-container-low text-on-surface-variant",
      ].join(" ")}
    >
      <MaterialIcon name={icon} size={12} />
      {label}
    </span>
  );
}
