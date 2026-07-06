import { useCallback, useEffect, useState } from "react";
import type { AnalyticsSummary } from "@amber/domain";
import { Icon } from "../components/Icon";
import { AnalyticsSkeleton, PinnerLoader } from "../components/Skeleton";
import { api } from "../lib/api";
import { useMoney } from "../store/AdminStore";

type RangeKey = "today" | "yesterday" | "week" | "month";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "7 Days" },
  { key: "month", label: "30 Days" },
];

/** Local day boundary (00:00:00 of the given date). */
function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Resolve a range key to an ISO {from,to} window (local-day aligned). */
function rangeWindow(key: RangeKey): { from: string; to: string } {
  const now = new Date();
  const today = dayStart(now);
  const day = 86_400_000;
  switch (key) {
    case "today":
      return { from: today.toISOString(), to: now.toISOString() };
    case "yesterday":
      return {
        from: new Date(today.getTime() - day).toISOString(),
        to: today.toISOString(),
      };
    case "week":
      return { from: new Date(today.getTime() - 6 * day).toISOString(), to: now.toISOString() };
    case "month":
      return { from: new Date(today.getTime() - 29 * day).toISOString(), to: now.toISOString() };
  }
}

// Donut palette (cycled across however many categories come back).
const CAT_COLORS = ["#6a3c00", "#004b71", "#6c5b4d", "#8a6d3b", "#3e6b4f", "#7a4a6b"];

/** Format a period-over-period delta fraction into a chip's text/icon/tone. */
function deltaChip(delta: number | null): { text: string; icon: string; tone: string } {
  if (delta === null) return { text: "—", icon: "horizontal_rule", tone: "text-on-surface-variant bg-surface-variant" };
  const pct = Math.round(delta * 100);
  if (pct > 0) return { text: `+${pct}%`, icon: "trending_up", tone: "text-[#2e7d32] bg-[#e8f5e9]" };
  if (pct < 0) return { text: `${pct}%`, icon: "trending_down", tone: "text-[#c62828] bg-[#ffebee]" };
  return { text: "0%", icon: "horizontal_rule", tone: "text-on-surface-variant bg-surface-variant" };
}

export function AnalyticsPage() {
  const money = useMoney();
  const [range, setRange] = useState<RangeKey>("today");
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await api.orders.exportSalesReport(rangeWindow(range));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [range]);

  const load = useCallback((key: RangeKey) => {
    setLoading(true);
    setError(null);
    return api.orders
      .analytics(rangeWindow(key))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.orders
      .analytics(rangeWindow(range))
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [range]);

  const noteFor = range === "today" ? "vs yesterday" : range === "yesterday" ? "vs prior day" : range === "week" ? "vs previous 7 days" : "vs previous 30 days";

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
        <div className="flex items-center gap-md self-start">
          <div className="flex rounded-full border border-outline-variant bg-surface-container-highest p-base shadow-sm">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`flex items-center gap-xs rounded-full px-lg py-xs font-label-md text-label-md uppercase tracking-wide transition-colors ${
                  range === r.key ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-primary"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-60"
          >
            <Icon name={exporting ? "hourglass_empty" : "file_download"} size={18} />
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="mb-lg rounded-card border border-error/30 bg-error-container px-lg py-md font-body-md text-body-md text-on-error-container">
          Couldn't export the report: {exportError}
        </div>
      )}

      {error && (
        <div className="mb-lg rounded-card border border-error/30 bg-error-container px-lg py-md font-body-md text-body-md text-on-error-container">
          Couldn’t load analytics: {error}{" "}
          <button onClick={() => load(range)} className="font-label-md underline">Retry</button>
        </div>
      )}

      {loading && <PinnerLoader />}

      {loading ? (
        <AnalyticsSkeleton />
      ) : (
      <div className="grid grid-cols-12 gap-lg">
        {/* KPIs */}
        <Kpi
          className="md:col-span-4"
          icon="payments"
          iconTone="bg-primary-container/10 text-primary"
          label="Revenue"
          value={money(data?.revenue ?? 0)}
          delta={deltaChip(data?.revenueDelta ?? null)}
          note={noteFor}
          valueTone="text-primary"
        />
        <Kpi
          className="md:col-span-4"
          icon="receipt_long"
          iconTone="bg-secondary-container/30 text-secondary"
          label="Total Orders"
          value={String(data?.orders ?? 0)}
          delta={deltaChip(data?.ordersDelta ?? null)}
          note={noteFor}
          valueTone="text-on-background"
        />
        <Kpi
          className="md:col-span-4"
          icon="local_activity"
          iconTone="bg-tertiary-container/20 text-tertiary"
          label="Avg Ticket"
          value={money(data?.avgTicket ?? 0)}
          delta={deltaChip(data?.avgTicketDelta ?? null)}
          note={noteFor}
          valueTone="text-on-background"
        />

        {/* Revenue trend */}
        <div className="col-span-12 flex flex-col overflow-hidden rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-8">
          <div className="flex items-center justify-between border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-background">Revenue Trend</h3>
            <span className="font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
              {RANGES.find((r) => r.key === range)?.label}
            </span>
          </div>
          <RevenueTrend series={data?.revenueSeries ?? []} />
        </div>

        {/* Category donut */}
        <div className="col-span-12 flex flex-col rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-4">
          <div className="border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-background">Sales by Category</h3>
          </div>
          <CategoryDonut categories={data?.categories ?? []} totalItems={data?.totalItems ?? 0} />
        </div>

        {/* Top items */}
        <div className="col-span-12 flex flex-col overflow-hidden rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-7">
          <div className="flex items-center justify-between border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-background">Top Performing Items</h3>
          </div>
          <div className="flex-1 overflow-x-auto">
            {(data?.topItems.length ?? 0) === 0 ? (
              <EmptyRow label="No items sold in this period" />
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-outline-variant/50">
                    <th className="w-12 px-lg py-sm text-center font-label-md text-[11px] font-medium uppercase text-on-surface-variant">Rank</th>
                    <th className="px-lg py-sm font-label-md text-[11px] font-medium uppercase text-on-surface-variant">Item Name</th>
                    <th className="px-lg py-sm text-right font-label-md text-[11px] font-medium uppercase text-on-surface-variant">Units</th>
                    <th className="px-lg py-sm text-right font-label-md text-[11px] font-medium uppercase text-on-surface-variant">Revenue</th>
                  </tr>
                </thead>
                <tbody className="font-body-md text-on-surface">
                  {data!.topItems.map((item, idx) => (
                    <tr key={item.name} className="group border-b border-surface-variant transition-colors last:border-0 hover:bg-primary/5">
                      <td className="px-lg py-md text-center font-data-mono font-bold text-outline">{idx + 1}</td>
                      <td className="px-lg py-md font-bold transition-colors group-hover:text-primary">{item.name}</td>
                      <td className="px-lg py-md text-right font-data-mono">{item.units}</td>
                      <td className="px-lg py-md text-right font-data-mono font-medium text-primary">{money(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Peak hours */}
        <div className="col-span-12 flex flex-col rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-5">
          <div className="flex items-center justify-between border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-background">Peak Activity</h3>
            <span className="rounded-full bg-surface-variant px-sm py-1 font-label-md text-[10px] text-on-surface-variant">Orders / Hour</span>
          </div>
          <PeakHours hours={data?.peakHours ?? []} />
        </div>
      </div>
      )}
    </>
  );
}

/** Revenue line chart from a real series (scaled to its own max). */
function RevenueTrend({ series }: { series: AnalyticsSummary["revenueSeries"] }) {
  const money = useMoney();
  if (series.length === 0) {
    return <div className="flex min-h-[300px] flex-1 items-center justify-center font-body-md text-on-surface-variant">No revenue in this period</div>;
  }
  const max = Math.max(1, ...series.map((s) => s.value));
  const n = series.length;
  const pts = series.map((s, i) => {
    const x = n > 1 ? (i / (n - 1)) * 100 : 50;
    const y = 95 - (s.value / max) * 90; // 5..95, taller = more revenue
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L100,100 L0,100 Z`;
  // ~6 evenly spaced x labels.
  const step = Math.max(1, Math.ceil(n / 6));
  const xLabels = series.filter((_, i) => i % step === 0 || i === n - 1);

  return (
    <div className="relative flex min-h-[300px] flex-1 items-end p-lg">
      <div className="absolute bottom-lg left-lg top-lg flex w-14 flex-col justify-between border-r border-surface-variant pb-8 pr-md text-right font-data-mono text-[11px] text-on-surface-variant">
        <span>{money(max)}</span>
        <span>{money(Math.round(max * 0.75))}</span>
        <span>{money(Math.round(max * 0.5))}</span>
        <span>{money(Math.round(max * 0.25))}</span>
        <span>{money(0)}</span>
      </div>
      <div className="relative ml-16 h-[250px] w-full">
        <div className="absolute inset-0 z-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-0 w-full border-t border-dashed border-surface-variant" />
          ))}
          <div className="h-0 w-full border-t border-surface-variant" />
        </div>
        <svg className="absolute inset-0 z-10 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
          <path d={area} fill="url(#agGrad)" opacity="0.12" />
          <path className="text-primary" d={line} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          <defs>
            <linearGradient id="agGrad" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="rgb(var(--ag-primary))" stopOpacity="1" />
              <stop offset="100%" stopColor="rgb(var(--ag-primary))" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute -bottom-8 left-0 right-0 flex justify-between font-data-mono text-[11px] text-on-surface-variant">
          {xLabels.map((s, i) => (
            <span key={i}>{s.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Donut of category revenue share. */
function CategoryDonut({
  categories,
  totalItems,
}: {
  categories: AnalyticsSummary["categories"];
  totalItems: number;
}) {
  const CIRC = 251.2;
  let cursor = 0;
  const segments = categories.map((c, i) => {
    const len = (c.pct / 100) * CIRC;
    const seg = { ...c, color: CAT_COLORS[i % CAT_COLORS.length]!, dash: `${len} ${CIRC}`, offset: -cursor };
    cursor += len;
    return seg;
  });

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-lg">
      {categories.length === 0 ? (
        <p className="py-12 font-body-md text-on-surface-variant">No sales in this period</p>
      ) : (
        <>
          <div className="relative mb-lg h-48 w-48">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f4e6dc" strokeWidth="16" />
              {segments.map((s) => (
                <circle key={s.name} cx="50" cy="50" r="40" fill="transparent" stroke={s.color} strokeWidth="16" strokeDasharray={s.dash} strokeDashoffset={s.offset} className="transition-all duration-1000 ease-out" />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-display-lg text-[24px] font-bold leading-none text-on-background">{totalItems}</span>
              <span className="mt-1 font-label-md text-[10px] uppercase text-on-surface-variant">Total Items</span>
            </div>
          </div>
          <div className="flex w-full flex-col gap-sm">
            {segments.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-xs">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
                  <span className="font-body-md text-on-surface">{s.name}</span>
                </div>
                <span className="font-data-mono font-bold text-on-background">{s.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Orders-per-hour bars across the active business window. */
function PeakHours({ hours }: { hours: AnalyticsSummary["peakHours"] }) {
  // Trim to the active window (first..last hour with orders), default 9–21.
  const active = hours.filter((h) => h.orders > 0);
  const lo = active.length ? Math.min(...active.map((h) => h.hour)) : 9;
  const hi = active.length ? Math.max(...active.map((h) => h.hour)) : 21;
  const slice = hours.filter((h) => h.hour >= lo && h.hour <= hi);
  const max = Math.max(1, ...slice.map((h) => h.orders));
  const fmtHour = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

  return (
    <div className="relative flex h-[260px] flex-1 items-end gap-1.5 p-lg pt-12">
      {slice.map((bar) => {
        const pct = (bar.orders / max) * 100;
        const tone = pct >= 90 ? "bg-primary" : pct >= 50 ? "bg-primary/75" : "bg-surface-variant";
        return (
          <div key={bar.hour} className={`group relative z-10 flex-1 rounded-t-sm transition-all hover:bg-primary ${tone}`} style={{ height: `${Math.max(pct, bar.orders ? 4 : 1)}%` }}>
            <span className="absolute -top-6 left-1/2 -translate-x-1/2 font-data-mono text-[10px] opacity-0 transition-opacity group-hover:opacity-100">{bar.orders}</span>
            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-data-mono text-[10px] text-outline">{fmtHour(bar.hour)}</span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <div className="flex min-h-[160px] items-center justify-center font-body-md text-on-surface-variant">{label}</div>;
}

function Kpi({
  className,
  icon,
  iconTone,
  label,
  value,
  valueTone,
  delta,
  note,
}: {
  className: string;
  icon: string;
  iconTone: string;
  label: string;
  value: string;
  valueTone: string;
  delta: { text: string; icon: string; tone: string };
  note: string;
}) {
  return (
    <div className={`group col-span-12 flex flex-col justify-between rounded-2xl border border-surface-variant bg-surface-container-lowest p-lg shadow-card transition-colors hover:border-outline ${className}`}>
      <div className="mb-lg flex items-start justify-between">
        <div className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">{label}</div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform group-hover:scale-110 ${iconTone}`}>
          <Icon name={icon} size={18} />
        </div>
      </div>
      <div>
        <div className={`mb-1 font-display-lg text-[40px] font-bold leading-tight ${valueTone}`}>{value}</div>
        <div className="flex items-center gap-xs font-body-md text-body-md text-on-surface-variant">
          <span className={`flex items-center rounded-full px-2 py-0.5 text-[12px] font-bold ${delta.tone}`}>
            <Icon name={delta.icon} size={14} className="mr-0.5" /> {delta.text}
          </span>
          {note}
        </div>
      </div>
    </div>
  );
}
