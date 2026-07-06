import { useEffect, useState } from "react";
import { type SubscriptionWithPlan } from "@amber/domain";
import { Icon } from "../components/Icon";
import { CenteredSpinner } from "../components/Skeleton";
import { api } from "../lib/api";
import {
  CURRENCIES,
  type SupportedCurrency,
  detectUserCurrency,
  fetchRates,
  formatInCurrency,
} from "../lib/currency";

const STATUS_LABEL: Record<SubscriptionWithPlan["status"], string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past Due",
  canceled: "Canceled",
};

const STATUS_CLASS: Record<SubscriptionWithPlan["status"], string> = {
  trialing: "bg-secondary-container text-on-secondary-container",
  active: "bg-primary-container text-on-primary-container",
  past_due: "bg-error-container text-on-error-container",
  canceled: "bg-error-container text-on-error-container",
};

function planFeatures(plan: SubscriptionWithPlan["plan"]): string[] {
  const features: string[] = [
    "QR table ordering",
    "Menu management",
    "Kitchen Display System (KDS)",
    "Real-time order sync",
    "Analytics dashboard",
  ];
  if (!plan.limits.maxTables) features.push("Unlimited tables");
  if (!plan.limits.maxOrdersPerMonth) features.push("Unlimited orders / month");
  return features;
}

/** Read-only "Plan & Billing" settings page — GET /billing/me. */
export function PlanBillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionWithPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currency, setCurrency] = useState<SupportedCurrency>("USD");
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [ratesError, setRatesError] = useState(false);

  useEffect(() => {
    api.billing
      .me()
      .then(setSubscription)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load billing info"),
      )
      .finally(() => setLoaded(true));

    setCurrency(detectUserCurrency());
    fetchRates()
      .then(setRates)
      .catch(() => setRatesError(true));
  }, []);

  if (!loaded) {
    return <CenteredSpinner label="Loading plan & billing…" />;
  }

  if (error) {
    return <p className="font-body-md text-body-md text-error">{error}</p>;
  }

  if (!subscription) {
    return (
      <div className="rounded-card bg-surface-container-lowest p-xl shadow-card">
        <h1 className="mb-sm font-headline-md text-headline-md text-primary">
          Plan &amp; Billing
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          No subscription has been assigned to this restaurant yet. Contact the
          platform team to get started.
        </p>
      </div>
    );
  }

  const { plan, status, currentPeriodEnd, cancelAtPeriodEnd } = subscription;
  const renewalLabel = cancelAtPeriodEnd ? "Ends on" : "Renews on";
  const features = planFeatures(plan);

  const localPrice = rates
    ? formatInCurrency(plan.priceCents, currency, rates)
    : `$${(plan.priceCents / 100).toFixed(2)}`;
  const usdPrice = `$${(plan.priceCents / 100).toFixed(2)}`;
  const showUsdEquivalent = currency !== "USD" && !!rates;

  return (
    <div className="max-w-2xl space-y-lg">
      {/* Current plan card */}
      <div className="rounded-card bg-surface-container-lowest p-xl shadow-card">
        {/* Header */}
        <div className="mb-lg flex items-center justify-between">
          <h1 className="font-headline-md text-headline-md text-primary">
            Plan &amp; Billing
          </h1>
          <span
            className={`rounded-full px-md py-xs font-label-md text-label-md uppercase tracking-wider ${STATUS_CLASS[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
        </div>

        {/* Plan name */}
        <p className="mb-xs font-headline-md text-headline-md text-on-surface">
          {plan.name}
        </p>

        {/* Price */}
        <div className="mb-xs flex items-baseline gap-sm">
          <span className="font-headline-lg text-headline-lg text-on-surface">
            {localPrice}
          </span>
          <span className="font-body-md text-body-md text-on-surface-variant">
            / {plan.interval}
          </span>
        </div>
        {showUsdEquivalent && (
          <p className="mb-md text-xs text-on-surface-variant">
            {usdPrice} USD / {plan.interval}
          </p>
        )}

        {/* Currency selector */}
        <div className="mb-lg flex flex-wrap items-center gap-sm">
          <span className="text-xs font-semibold text-on-surface-variant">
            Show price in:
          </span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
            className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-xs outline-none focus:border-primary"
          >
            {(Object.keys(CURRENCIES) as SupportedCurrency[]).map((c) => (
              <option key={c} value={c}>
                {CURRENCIES[c].flag} {c} — {CURRENCIES[c].name}
              </option>
            ))}
          </select>
          {ratesError && (
            <span className="text-xs text-on-surface-variant">
              (live rates unavailable)
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

        {/* Limits grid */}
        <dl className="mb-lg grid grid-cols-2 gap-md border-t border-outline-variant/30 pt-lg">
          <div>
            <dt className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
              {renewalLabel}
            </dt>
            <dd className="mt-xs font-body-md text-body-md text-on-surface">
              {new Date(currentPeriodEnd).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </dd>
          </div>
          <div>
            <dt className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
              Table limit
            </dt>
            <dd className="mt-xs font-body-md text-body-md text-on-surface">
              {plan.limits.maxTables ?? "Unlimited"}
            </dd>
          </div>
          <div>
            <dt className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
              Orders / month
            </dt>
            <dd className="mt-xs font-body-md text-body-md text-on-surface">
              {plan.limits.maxOrdersPerMonth
                ? plan.limits.maxOrdersPerMonth.toLocaleString()
                : "Unlimited"}
            </dd>
          </div>
        </dl>

        {cancelAtPeriodEnd && (
          <div className="mb-md flex items-center gap-sm rounded-lg bg-secondary-container/40 px-md py-sm">
            <Icon name="info" size={18} />
            <span className="text-xs text-on-surface">
              This subscription will not renew and ends on the date above.
            </span>
          </div>
        )}

        <p className="text-xs text-on-surface-variant">
          Plan changes are managed by the platform team — contact support to
          upgrade or change billing.
        </p>
      </div>

      {/* What's included card */}
      <div className="rounded-card bg-surface-container-lowest p-xl shadow-card">
        <h2 className="mb-md font-title-lg text-title-lg text-on-surface">
          What&apos;s included
        </h2>
        <ul className="space-y-sm">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-center gap-sm font-body-md text-body-md text-on-surface-variant"
            >
              <Icon name="check_circle" size={18} className="text-primary" />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
