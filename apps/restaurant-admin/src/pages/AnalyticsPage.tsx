import { useState } from "react";
import { Icon } from "../components/Icon";
import { useAdmin } from "../store/AdminStore";
import { money } from "../lib/money";

type Range = "Today" | "Yesterday" | "7 Days" | "Custom";

// Per-range multipliers so the range selector visibly changes the numbers.
const RANGE_FACTOR: Record<Range, number> = {
  Today: 1,
  Yesterday: 0.92,
  "7 Days": 6.4,
  Custom: 3.1,
};

const TOP_ITEMS = [
  { name: "Wagyu Burger", units: 24, revenueCents: 43200 },
  { name: "Truffle Fries", units: 38, revenueCents: 34200 },
  { name: "House Old Fashioned", units: 18, revenueCents: 25200 },
  { name: "House Salad", units: 15, revenueCents: 18000 },
  { name: "Ribeye Steak", units: 4, revenueCents: 17600 },
];

const PEAK = [
  { hour: "11a", value: 20 },
  { hour: "12p", value: 80 },
  { hour: "1p", value: 60 },
  { hour: "2p", value: 15 },
  { hour: "3p", value: 10 },
  { hour: "4p", value: 25 },
  { hour: "5p", value: 70 },
  { hour: "6p", value: 95 },
  { hour: "7p", value: 85 },
];

const CATEGORIES = [
  { name: "Mains", pct: 55, color: "#6a3c00", chip: "bg-primary" },
  { name: "Beverages", pct: 28, color: "#004b71", chip: "bg-tertiary" },
  { name: "Appetizers", pct: 17, color: "#6c5b4d", chip: "bg-secondary" },
];

export function AnalyticsPage() {
  const { state } = useAdmin();
  const [range, setRange] = useState<Range>("Today");
  const factor = RANGE_FACTOR[range];

  const baseRevenue = state.sales.reduce((s, x) => s + x.totalCents, 0);
  const revenue = Math.round(baseRevenue * factor);
  const orders = Math.round(state.sales.length * factor);
  const avgTicket = orders ? Math.round(revenue / orders) : 0;

  // Donut: cumulative dash offsets around a r=40 circle (circumference ≈ 251.2).
  const CIRC = 251.2;
  let cursor = 0;
  const segments = CATEGORIES.map((c) => {
    const len = (c.pct / 100) * CIRC;
    const seg = { ...c, dash: `${len} ${CIRC}`, offset: -cursor };
    cursor += len;
    return seg;
  });

  return (
    <>
      <div className="mb-xl flex flex-col justify-between gap-lg md:flex-row md:items-end">
        <div>
          <h2 className="mb-xs font-headline-lg text-headline-lg text-on-background">
            Performance Overview
          </h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Real-time financial and operational metrics.
          </p>
        </div>
        <div className="flex self-start rounded-full border border-outline-variant bg-surface-container-highest p-base shadow-sm">
          {(["Today", "Yesterday", "7 Days", "Custom"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`flex items-center gap-xs rounded-full px-lg py-xs font-label-md text-label-md uppercase tracking-wide transition-colors ${
                range === r ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-primary"
              }`}
            >
              {r === "Custom" && <Icon name="calendar_month" size={16} />}
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-lg">
        {/* KPIs */}
        <Kpi
          className="md:col-span-4"
          icon="payments"
          iconTone="bg-primary-container/10 text-primary"
          label="Revenue"
          value={money(revenue)}
          delta="+12%"
          deltaTone="text-[#2e7d32] bg-[#e8f5e9]"
          deltaIcon="trending_up"
          note="vs same period last week"
          valueTone="text-primary"
        />
        <Kpi
          className="md:col-span-4"
          icon="receipt_long"
          iconTone="bg-secondary-container/30 text-secondary"
          label="Total Orders"
          value={String(orders)}
          delta="0%"
          deltaTone="text-on-surface-variant bg-surface-variant"
          deltaIcon="horizontal_rule"
          note="on pace with average"
          valueTone="text-on-background"
        />
        <Kpi
          className="md:col-span-4"
          icon="local_activity"
          iconTone="bg-tertiary-container/20 text-tertiary"
          label="Avg Ticket"
          value={money(avgTicket)}
          delta="-3%"
          deltaTone="text-[#c62828] bg-[#ffebee]"
          deltaIcon="trending_down"
          note="due to lunch volume"
          valueTone="text-on-background"
        />

        {/* Revenue line chart */}
        <div className="col-span-12 flex flex-col overflow-hidden rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-8">
          <div className="flex items-center justify-between border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-background">Revenue Trend</h3>
            <button className="text-on-surface-variant transition-colors hover:text-primary">
              <Icon name="more_vert" />
            </button>
          </div>
          <div className="relative flex min-h-[300px] flex-1 items-end p-lg">
            <div className="absolute bottom-lg left-lg top-lg flex w-12 flex-col justify-between border-r border-surface-variant pb-8 pr-md text-right font-data-mono text-[11px] text-on-surface-variant">
              <span>$400</span>
              <span>$300</span>
              <span>$200</span>
              <span>$100</span>
              <span>$0</span>
            </div>
            <div className="relative ml-14 h-[250px] w-full">
              <div className="absolute inset-0 z-0 flex flex-col justify-between">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-0 w-full border-t border-dashed border-surface-variant" />
                ))}
                <div className="h-0 w-full border-t border-surface-variant" />
              </div>
              <svg
                className="absolute inset-0 z-10 h-full w-full overflow-visible"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <path
                  d="M0,90 L10,85 L20,70 L30,80 L40,40 L50,60 L60,30 L70,20 L80,50 L90,10 L100,20 L100,100 L0,100 Z"
                  fill="url(#agGrad)"
                  opacity="0.12"
                />
                <path
                  className="chart-path text-primary"
                  d="M0,90 L10,85 L20,70 L30,80 L40,40 L50,60 L60,30 L70,20 L80,50 L90,10 L100,20"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                />
                <defs>
                  <linearGradient id="agGrad" x1="0%" x2="0%" y1="0%" y2="100%">
                    <stop offset="0%" stopColor="rgb(var(--ag-primary))" stopOpacity="1" />
                    <stop offset="100%" stopColor="rgb(var(--ag-primary))" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute -bottom-8 left-0 right-0 flex justify-between font-data-mono text-[11px] text-on-surface-variant">
                {["9 AM", "11 AM", "1 PM", "3 PM", "5 PM", "7 PM"].map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Category donut */}
        <div className="col-span-12 flex flex-col rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-4">
          <div className="border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-background">Sales by Category</h3>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center p-lg">
            <div className="relative mb-lg h-48 w-48">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f4e6dc" strokeWidth="16" />
                {segments.map((s) => (
                  <circle
                    key={s.name}
                    cx="50"
                    cy="50"
                    r="40"
                    fill="transparent"
                    stroke={s.color}
                    strokeWidth="16"
                    strokeDasharray={s.dash}
                    strokeDashoffset={s.offset}
                    className="transition-all duration-1000 ease-out"
                  />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="font-display-lg text-[24px] font-bold leading-none text-on-background">
                  245
                </span>
                <span className="mt-1 font-label-md text-[10px] uppercase text-on-surface-variant">
                  Total Items
                </span>
              </div>
            </div>
            <div className="flex w-full flex-col gap-sm">
              {CATEGORIES.map((c) => (
                <div key={c.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-xs">
                    <span className={`h-3 w-3 rounded-sm ${c.chip}`} />
                    <span className="font-body-md text-on-surface">{c.name}</span>
                  </div>
                  <span className="font-data-mono font-bold text-on-background">{c.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top items */}
        <div className="col-span-12 flex flex-col overflow-hidden rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-7">
          <div className="flex items-center justify-between border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-background">Top Performing Items</h3>
            <button className="font-label-md text-[11px] uppercase tracking-wider text-primary transition-colors hover:text-primary-container">
              View All Menu
            </button>
          </div>
          <div className="flex-1 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant/50">
                  <th className="w-12 px-lg py-sm text-center font-label-md text-[11px] font-medium uppercase text-on-surface-variant">
                    Rank
                  </th>
                  <th className="px-lg py-sm font-label-md text-[11px] font-medium uppercase text-on-surface-variant">
                    Item Name
                  </th>
                  <th className="px-lg py-sm text-right font-label-md text-[11px] font-medium uppercase text-on-surface-variant">
                    Units
                  </th>
                  <th className="px-lg py-sm text-right font-label-md text-[11px] font-medium uppercase text-on-surface-variant">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody className="font-body-md text-on-surface">
                {TOP_ITEMS.map((item, idx) => (
                  <tr
                    key={item.name}
                    className="group border-b border-surface-variant transition-colors last:border-0 hover:bg-primary/5"
                  >
                    <td className="px-lg py-md text-center font-data-mono font-bold text-outline">{idx + 1}</td>
                    <td className="px-lg py-md font-bold transition-colors group-hover:text-primary">
                      {item.name}
                    </td>
                    <td className="px-lg py-md text-right font-data-mono">{item.units}</td>
                    <td className="px-lg py-md text-right font-data-mono font-medium text-primary">
                      {money(item.revenueCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Peak hours */}
        <div className="col-span-12 flex flex-col rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-5">
          <div className="flex items-center justify-between border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-background">Peak Activity</h3>
            <span className="rounded-full bg-surface-variant px-sm py-1 font-label-md text-[10px] text-on-surface-variant">
              Orders / Hour
            </span>
          </div>
          <div className="relative flex h-[260px] flex-1 items-end gap-2 p-lg pt-12">
            {PEAK.map((bar) => {
              const tone =
                bar.value >= 90 ? "bg-primary" : bar.value >= 60 ? "bg-primary/75" : "bg-surface-variant";
              return (
                <div
                  key={bar.hour}
                  className={`group relative z-10 flex-1 rounded-t-sm transition-all hover:bg-primary ${tone}`}
                  style={{ height: `${bar.value}%` }}
                >
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 font-data-mono text-[10px] opacity-0 transition-opacity group-hover:opacity-100">
                    {Math.round((bar.value / 100) * 40)}
                  </span>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-data-mono text-[10px] text-outline">
                    {bar.hour}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function Kpi({
  className,
  icon,
  iconTone,
  label,
  value,
  valueTone,
  delta,
  deltaTone,
  deltaIcon,
  note,
}: {
  className: string;
  icon: string;
  iconTone: string;
  label: string;
  value: string;
  valueTone: string;
  delta: string;
  deltaTone: string;
  deltaIcon: string;
  note: string;
}) {
  return (
    <div
      className={`group col-span-12 flex flex-col justify-between rounded-2xl border border-surface-variant bg-surface-container-lowest p-lg shadow-card transition-colors hover:border-outline ${className}`}
    >
      <div className="mb-lg flex items-start justify-between">
        <div className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
          {label}
        </div>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform group-hover:scale-110 ${iconTone}`}
        >
          <Icon name={icon} size={18} />
        </div>
      </div>
      <div>
        <div className={`mb-1 font-display-lg text-[40px] font-bold leading-tight ${valueTone}`}>
          {value}
        </div>
        <div className="flex items-center gap-xs font-body-md text-body-md text-on-surface-variant">
          <span className={`flex items-center rounded-full px-2 py-0.5 text-[12px] font-bold ${deltaTone}`}>
            <Icon name={deltaIcon} size={14} className="mr-0.5" /> {delta}
          </span>
          {note}
        </div>
      </div>
    </div>
  );
}
