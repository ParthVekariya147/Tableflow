import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AnalyticsSummary } from "@amber/domain";
import { Icon } from "../components/Icon";
import { Sk } from "../components/Skeleton";
import { useAdmin } from "../store/AdminStore";
import { api } from "../lib/api";
import { timeAgo } from "../lib/money";

export function DashboardPage() {
  const { state, money } = useAdmin();

  // Today's revenue + period-over-period delta, from the real analytics endpoint
  // (genuinely today-scoped, unlike the recent-50 sales feed). Refetched whenever
  // a new sale closes (state.sales changes via the store's realtime sync).
  const [today, setToday] = useState<AnalyticsSummary | null>(null);
  const salesCount = state.sales.length;
  useEffect(() => {
    let active = true;
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    api.orders
      .analytics({ from: start.toISOString(), to: now.toISOString() })
      .then((d) => active && setToday(d))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [salesCount]);

  const todayRevenue = today?.revenue ?? 0;
  const revenueDelta = today?.revenueDelta ?? null;
  const deltaPct = revenueDelta === null ? null : Math.round(revenueDelta * 100);
  const activeTables = state.tables.filter((t) => t.status !== "free");
  const ordersInProgress = state.tables.filter(
    (t) => t.session && t.session.rounds.some((r) => r.items.some((i) => i.status !== "served" && i.status !== "cancelled")),
  ).length;
  const eighteySixed = state.items.filter((i) => !i.available);
  const awaitingBill = state.tables.filter((t) => t.status === "bill");
  const capacity = Math.round((activeTables.length / state.tables.length) * 100);

  // Build a simple live feed from sessions + recent sales.
  const feed = [
    ...activeTables.flatMap((t) =>
      (t.session?.rounds ?? []).map((r) => ({
        at: r.placedAt,
        icon: "receipt_long",
        tone: "bg-secondary-container/30 text-secondary",
        title: `${t.label} ordered`,
        sub: `${r.items.length} items • ${r.type === "instant" ? "Bring it" : "Bring these"}`,
      })),
    ),
    ...state.sales.slice(0, 4).map((s) => ({
      at: s.at,
      icon: "check_circle",
      tone: "bg-[#e8f5e9] text-[#2e7d32]",
      title: `${s.tableLabel} check closed`,
      sub: `${money(s.totalCents)} • ${s.method === "card" ? "Card" : "Cash"}`,
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);

  return (
    <div className="grid grid-cols-12 gap-lg">
      <div className="col-span-12 mb-sm flex items-end justify-between">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-background">Overview</h2>
          <p className="mt-base font-body-md text-body-md text-on-surface-variant">
            Real-time service metrics for Main Kitchen
          </p>
        </div>
        <div className="flex items-center gap-xs font-data-mono text-data-mono text-on-surface-variant">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Live Updates Active
        </div>
      </div>

      {/* Stat cards */}
      <div className="col-span-12 mb-sm grid grid-cols-1 gap-lg md:grid-cols-3">
        <StatCard icon="payments" label="Today's Revenue" loading={today === null}>
          <div className="flex items-baseline gap-sm">
            <h3 className="font-display-lg text-display-lg text-on-surface">{money(todayRevenue)}</h3>
            {deltaPct !== null && (
              <span
                className={`flex items-center font-body-md text-body-md font-medium ${
                  deltaPct >= 0 ? "text-primary" : "text-error"
                }`}
              >
                <Icon name={deltaPct >= 0 ? "trending_up" : "trending_down"} size={16} />{" "}
                {deltaPct >= 0 ? "+" : ""}
                {deltaPct}%
              </span>
            )}
          </div>
        </StatCard>
        <StatCard icon="deck" label="Active Tables">
          <div className="flex items-baseline gap-sm">
            <h3 className="font-display-lg text-display-lg text-on-surface">
              {activeTables.length}
              <span className="text-[32px] text-on-surface-variant">/{state.tables.length}</span>
            </h3>
            <span className="rounded-full bg-secondary-container px-sm py-xs font-label-md text-label-md text-on-secondary-container">
              {capacity}% Capacity
            </span>
          </div>
        </StatCard>
        <StatCard icon="receipt_long" label="Orders in Progress">
          <div className="flex items-baseline gap-sm">
            <h3 className="font-display-lg text-display-lg text-on-surface">{ordersInProgress}</h3>
            <span className="font-body-md text-body-md text-on-surface-variant">Active Tickets</span>
          </div>
        </StatCard>
      </div>

      {/* Alerts strip */}
      <div className="col-span-12 flex flex-col gap-md md:flex-row">
        <div className="flex flex-1 items-center gap-md rounded-card border border-[#ffcfcf] bg-[#fff0f0] p-md shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error text-on-error">
            <Icon name="warning" />
          </div>
          <div className="flex flex-col">
            <span className="font-label-md text-label-md uppercase tracking-wider text-error">
              Critical Inventory Alert
            </span>
            <span className="font-body-md text-body-md font-medium text-on-surface">
              {eighteySixed.length === 0
                ? "No items 86'd"
                : `${eighteySixed.length} Item${eighteySixed.length > 1 ? "s" : ""} 86'd (${eighteySixed
                    .map((i) => i.name)
                    .join(", ")})`}
            </span>
          </div>
        </div>
        <div className="flex flex-1 items-center gap-md rounded-card border border-[#ffe082] bg-[#fff8e1] p-md shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ffb300] text-[#4e342e]">
            <Icon name="schedule" />
          </div>
          <div className="flex flex-col">
            <span className="font-label-md text-label-md uppercase tracking-wider text-[#f57f17]">
              Awaiting Bill
            </span>
            <span className="font-body-md text-body-md font-medium text-on-surface">
              {awaitingBill.length === 0
                ? "All tables current"
                : `${awaitingBill.map((t) => t.label).join(", ")} waiting on the bill`}
            </span>
          </div>
          {awaitingBill.length > 0 && (
            <Link
              to="/billing"
              className="ml-auto rounded-full border border-[#ffe082] px-md py-sm font-label-md text-label-md text-[#f57f17] transition-colors hover:bg-[#ffe082]/20"
            >
              {awaitingBill.length > 1 ? `Resolve (${awaitingBill.length})` : "Resolve"}
            </Link>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="col-span-12 flex flex-col gap-lg lg:col-span-4">
        <h3 className="border-b border-surface-variant pb-xs font-headline-md text-headline-md text-on-surface">
          Quick Actions
        </h3>
        <div className="grid grid-cols-1 gap-md">
          <QuickLink to="/menu" icon="restaurant_menu" title="Update Menu" sub="Manage 86 lists & specials" />
          <QuickLink to="/tables" icon="table_restaurant" title="Check Tables" sub="Floor plan & seating" />
          <QuickLink
            to="/billing"
            icon="point_of_sale"
            title="Billing Queue"
            sub={awaitingBill.length === 0 ? "No tables waiting" : `${awaitingBill.length} table${awaitingBill.length > 1 ? "s" : ""} waiting`}
          />
          <QuickLink to="/analytics" icon="analytics" title="View Reports" sub="End of shift summaries" />
        </div>
      </div>

      {/* Live feed */}
      <div className="col-span-12 flex flex-col gap-lg lg:col-span-8">
        <div className="flex items-end justify-between border-b border-surface-variant pb-xs">
          <h3 className="font-headline-md text-headline-md text-on-surface">Live Feed</h3>
          <button className="font-label-md text-label-md text-primary hover:underline">
            View All Activity
          </button>
        </div>
        <div className="overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-card">
          <ul className="flex flex-col">
            {feed.map((f, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between border-b border-surface-variant p-lg transition-colors last:border-0 hover:bg-surface/50"
              >
                <div className="flex items-center gap-md">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${f.tone}`}>
                    <Icon name={f.icon} size={20} />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-body-lg text-body-lg font-medium text-on-surface">
                      {f.title}
                    </span>
                    <span className="font-body-md text-body-md text-on-surface-variant">{f.sub}</span>
                  </div>
                </div>
                <span className="font-data-mono text-data-mono text-on-surface-variant">
                  {timeAgo(f.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  children,
  loading = false,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-card border border-surface-variant bg-surface-container-lowest p-lg shadow-card">
      <div className="absolute right-0 top-0 p-lg opacity-10 transition-opacity group-hover:opacity-20">
        <Icon name={icon} size={64} className="text-primary" />
      </div>
      <div className="relative z-10">
        <span className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
          {label}
        </span>
        {loading ? (
          <div className="flex flex-col gap-sm pt-xs">
            <Sk style={{ height: 40, width: "65%" }} />
            <Sk style={{ height: 16, width: "40%" }} />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function QuickLink({
  to,
  icon,
  title,
  sub,
}: {
  to: string;
  icon: string;
  title: string;
  sub: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-md rounded-card border border-outline-variant bg-surface-container-lowest p-lg text-left shadow-card transition-all hover:border-primary hover:bg-surface-container-low"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-primary transition-transform group-hover:scale-110">
        <Icon name={icon} size={28} />
      </div>
      <div className="flex flex-col">
        <span className="font-title-lg text-title-lg text-on-surface">{title}</span>
        <span className="font-body-md text-body-md text-on-surface-variant">{sub}</span>
      </div>
    </Link>
  );
}
