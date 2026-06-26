import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatMoney } from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import type { PlatformAnalytics } from "@amber/api-client";
import { api } from "../api";
import {
  DashboardKpiSkeleton,
  DashboardChartSkeleton,
} from "../components/Skeleton";

function fmt(cents: number) {
  return formatMoney(cents);
}

function DeltaBadge({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? "text-green-600" : "text-error"}`}
    >
      <MaterialIcon name={up ? "arrow_upward" : "arrow_downward"} size={12} />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function RevenueBar({
  revenueSeries,
}: {
  revenueSeries: PlatformAnalytics["revenueSeries"];
}) {
  if (!revenueSeries.length) return null;
  const max = Math.max(...revenueSeries.map((d) => d.cents), 1);
  return (
    <div className="flex h-24 items-end gap-px">
      {revenueSeries.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${fmt(d.cents)}`}
          className="flex-1 rounded-t bg-primary opacity-80 hover:opacity-100"
          style={{ height: `${Math.max(4, (d.cents / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function DashboardPage() {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.admin
      .getPlatformAnalytics()
      .then(setAnalytics)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load analytics"),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <header className="mb-6">
          <div className="h-8 w-48 animate-pulse rounded-md bg-surface-container-low" />
          <div className="mt-1.5 h-4 w-64 animate-pulse rounded-md bg-surface-container-low" />
        </header>
        <DashboardKpiSkeleton />
        <DashboardChartSkeleton />
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div>
        <header className="mb-6">
          <h1 className="font-serif text-2xl font-bold">Platform overview</h1>
        </header>
        <p className="text-sm text-on-surface-variant">
          API not reachable ({error ?? "no data"}). Start <code>@amber/api</code>{" "}
          and seed the DB to see live data.
        </p>
      </div>
    );
  }

  const kpis = [
    {
      label: "Total GMV",
      value: fmt(analytics.totalGmvCents),
      icon: "payments",
      sub: null,
    },
    {
      label: "GMV last 30 d",
      value: fmt(analytics.gmv30dCents),
      icon: "trending_up",
      sub: <DeltaBadge pct={analytics.gmv30dDeltaPct} />,
    },
    {
      label: "MRR",
      value: fmt(analytics.mrrCents),
      icon: "repeat",
      sub: (
        <span className="text-xs text-on-surface-variant">
          {analytics.activeSubscriptions} active
        </span>
      ),
    },
    {
      label: "Orders last 30 d",
      value: String(analytics.orders30d),
      icon: "receipt_long",
      sub: <DeltaBadge pct={analytics.orders30dDeltaPct} />,
    },
  ];

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-2xl font-bold">Platform overview</h1>
        <p className="text-sm text-on-surface-variant">
          Network-wide health across every tenant
        </p>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-on-surface-variant sm:text-sm">
                {k.label}
              </span>
              <MaterialIcon
                name={k.icon}
                size={18}
                className="text-on-surface-variant"
              />
            </div>
            <div className="font-serif text-2xl font-bold sm:text-3xl">
              {k.value}
            </div>
            {k.sub && <div className="mt-1">{k.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[1.55fr_1fr]">
        {/* Revenue trend */}
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Revenue — last 30 days</span>
            <span className="text-xs text-on-surface-variant">Daily GMV</span>
          </div>
          {analytics.revenueSeries.every((d) => d.cents === 0) ? (
            <div className="flex h-24 items-center justify-center text-xs text-on-surface-variant">
              No revenue yet
            </div>
          ) : (
            <RevenueBar revenueSeries={analytics.revenueSeries} />
          )}
          <div className="mt-3 flex gap-4 text-xs text-on-surface-variant">
            <span>
              Cash: <strong>{fmt(analytics.methodSplit.cash)}</strong>
            </span>
            <span>
              Card: <strong>{fmt(analytics.methodSplit.card)}</strong>
            </span>
          </div>
        </div>

        {/* Top tenants by revenue */}
        <div className="flex flex-col rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5">
          <span className="mb-3 text-sm font-semibold">Top tenants</span>
          {analytics.topTenants.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-on-surface-variant">
              No sales yet
            </div>
          ) : (
            <ul className="space-y-2">
              {analytics.topTenants.map((t) => (
                <li key={t.tenantId} className="flex items-center justify-between gap-2">
                  <Link
                    to={`/tenants/${t.tenantId}`}
                    className="truncate text-sm font-medium hover:text-primary"
                  >
                    {t.name}
                  </Link>
                  <span className="shrink-0 text-sm font-semibold">
                    {fmt(t.totalCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/audit-log"
            className="mt-3 text-xs font-semibold text-primary hover:underline"
          >
            View audit log →
          </Link>
        </div>
      </div>
    </div>
  );
}
