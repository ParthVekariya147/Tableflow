import type { CSSProperties } from "react";
import { Icon } from "./Icon";

/** Single shimmer block — shape via className / style. */
export function Sk({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={`ag-shimmer rounded-md ${className}`} style={style} />;
}

/** Inline rotating spinner (uses the ag-spin keyframe). */
export function Spinner({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Icon
      name="progress_activity"
      size={size}
      className={`ag-spin text-primary ${className}`}
    />
  );
}

/** Full-page centred spinner with a supporting label. */
export function CenteredSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-md py-xxl">
      <Spinner size={36} />
      <p className="font-body-md text-body-md text-on-surface-variant">{label}</p>
    </div>
  );
}

/** Indeterminate top-pinned progress bar ("pinner") — same visual as the
 *  mutation topbar but opt-in per page. */
export function PinnerLoader() {
  return <div className="ag-topbar" aria-hidden />;
}

/** Generic table skeleton: shimmer header row + N shimmer data rows. */
export function TableSkeleton({
  rows = 5,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  const COL_WIDTHS = ["30%", "50%", "40%", "35%", "45%", "25%"];
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-outline-variant">
          {Array.from({ length: cols }).map((_, i) => (
            <th key={i} className="px-lg py-sm">
              <Sk style={{ height: 12, width: COL_WIDTHS[i % COL_WIDTHS.length] }} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r} className="border-b border-surface-variant last:border-0">
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c} className="px-lg py-md">
                <Sk
                  style={{
                    height: 16,
                    width: COL_WIDTHS[(r * cols + c) % COL_WIDTHS.length],
                  }}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Page-level skeletons ──────────────────────────────────────────────────────

const NAV_WIDTHS = ["72%", "60%", "80%", "55%", "68%", "75%"];
const PEAK_HEIGHTS = [35, 55, 80, 95, 70, 45, 85, 60, 40, 75, 50, 65];

/** Full admin-shell skeleton shown during the initial store data load.
 *  Mirrors the real Shell (sidebar + topbar + dashboard-shaped content). */
export function AppShellSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Fake sidebar */}
      <aside className="hidden w-[280px] shrink-0 flex-col gap-md border-r border-surface-variant bg-surface-container-low p-lg lg:flex">
        <div className="mb-sm flex items-center gap-md">
          <Sk className="h-10 w-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-sm">
            <Sk style={{ height: 16, width: "65%" }} />
            <Sk style={{ height: 12, width: "45%" }} />
          </div>
        </div>
        {NAV_WIDTHS.map((w, i) => (
          <div key={i} className="flex items-center gap-md px-sm py-xs">
            <Sk className="h-5 w-5 rounded-sm" />
            <Sk style={{ height: 14, width: w }} />
          </div>
        ))}
      </aside>

      {/* Main panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Fake topbar */}
        <header className="flex h-20 shrink-0 items-center justify-between border-b border-surface-variant bg-surface-container-lowest px-xl">
          <div className="flex items-center gap-md">
            <Sk className="h-8 w-8 rounded-md" />
            <Sk style={{ height: 20, width: 140 }} />
          </div>
          <div className="flex items-center gap-md">
            <Sk className="h-8 w-8 rounded-full" />
            <Sk style={{ height: 32, width: 100, borderRadius: 9999 }} />
          </div>
        </header>

        {/* Fake page content (dashboard-shaped) */}
        <main className="flex-1 overflow-auto p-xl">
          {/* KPI cards */}
          <div className="mb-lg grid grid-cols-1 gap-lg md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-card border border-surface-variant bg-surface-container-lowest p-lg shadow-card"
              >
                <Sk style={{ height: 12, width: "55%", marginBottom: 16 }} />
                <Sk style={{ height: 40, width: "70%" }} />
              </div>
            ))}
          </div>

          {/* Alert strip */}
          <div className="mb-lg grid grid-cols-1 gap-md md:grid-cols-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="flex items-center gap-md rounded-card border border-surface-variant p-md"
              >
                <Sk className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-sm">
                  <Sk style={{ height: 12, width: "40%" }} />
                  <Sk style={{ height: 16, width: "70%" }} />
                </div>
              </div>
            ))}
          </div>

          {/* Live feed rows */}
          <div className="overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-card">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-md border-b border-surface-variant p-lg last:border-0"
              >
                <Sk className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-sm">
                  <Sk style={{ height: 16, width: "45%" }} />
                  <Sk style={{ height: 12, width: "30%" }} />
                </div>
                <Sk style={{ height: 12, width: 60 }} />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Analytics page skeleton — KPI chips + chart area placeholders. */
export function AnalyticsSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-lg">
      {/* 3 KPI cards */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="col-span-12 rounded-2xl border border-surface-variant bg-surface-container-lowest p-lg shadow-card md:col-span-4"
        >
          <div className="mb-lg flex items-start justify-between">
            <Sk style={{ height: 12, width: 80 }} />
            <Sk className="h-8 w-8 rounded-full" />
          </div>
          <Sk style={{ height: 40, width: "60%", marginBottom: 8 }} />
          <Sk style={{ height: 16, width: 120 }} />
        </div>
      ))}

      {/* Revenue trend chart */}
      <div className="col-span-12 overflow-hidden rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-8">
        <div className="flex items-center justify-between border-b border-surface-variant px-lg py-md">
          <Sk style={{ height: 20, width: 130 }} />
          <Sk style={{ height: 16, width: 60 }} />
        </div>
        <Sk className="m-lg rounded-lg" style={{ height: 280 }} />
      </div>

      {/* Category donut */}
      <div className="col-span-12 flex flex-col rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-4">
        <div className="border-b border-surface-variant px-lg py-md">
          <Sk style={{ height: 20, width: 140 }} />
        </div>
        <div className="flex flex-col items-center gap-lg p-lg">
          <Sk className="h-48 w-48 rounded-full" />
          {[80, 90, 70].map((w, i) => (
            <div key={i} className="flex w-full items-center justify-between gap-sm">
              <Sk style={{ height: 16, width: `${w}%` }} />
              <Sk style={{ height: 16, width: 36 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Top items table */}
      <div className="col-span-12 overflow-hidden rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-7">
        <div className="border-b border-surface-variant px-lg py-md">
          <Sk style={{ height: 20, width: 180 }} />
        </div>
        <TableSkeleton rows={5} cols={4} />
      </div>

      {/* Peak hours bars */}
      <div className="col-span-12 flex flex-col rounded-2xl border border-surface-variant bg-surface-container-lowest shadow-card lg:col-span-5">
        <div className="border-b border-surface-variant px-lg py-md">
          <Sk style={{ height: 20, width: 110 }} />
        </div>
        <div className="flex h-[260px] items-end gap-1.5 p-lg pt-12">
          {PEAK_HEIGHTS.map((h, i) => (
            <Sk key={i} className="flex-1 rounded-t-sm" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Order history page skeleton — stat cards + table rows. */
export function OrderHistorySkeleton() {
  return (
    <div className="flex flex-col gap-lg">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-md rounded-card border border-outline-variant bg-surface-container-lowest p-md shadow-card"
          >
            <Sk className="h-11 w-11 shrink-0 rounded-full" />
            <div className="flex flex-col gap-sm">
              <Sk style={{ height: 12, width: 80 }} />
              <Sk style={{ height: 24, width: 100 }} />
            </div>
          </div>
        ))}
      </div>
      {/* Table */}
      <div className="overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-card">
        <TableSkeleton rows={6} cols={4} />
      </div>
    </div>
  );
}

/** Menu page skeleton — category pill tabs + item cards grid. */
export function MenuSkeleton() {
  const TAB_WIDTHS = [80, 100, 72, 90, 65, 88];
  return (
    <div className="flex flex-col gap-lg">
      <div className="flex gap-sm overflow-x-hidden border-b border-outline-variant pb-md">
        {TAB_WIDTHS.map((w, i) => (
          <Sk key={i} className="h-8 shrink-0 rounded-full" style={{ width: w }} />
        ))}
      </div>
      <div
        className="grid gap-lg"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-card border border-surface-variant bg-surface-container-lowest shadow-card"
          >
            <Sk className="h-32 w-full rounded-none" />
            <div className="flex flex-col gap-sm p-md">
              <Sk style={{ height: 16, width: "75%" }} />
              <Sk style={{ height: 12, width: "45%" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tables page skeleton — grid of table status cards. */
export function TablesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-lg sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-md rounded-card border border-surface-variant bg-surface-container-lowest p-lg shadow-card"
        >
          <div className="flex items-center justify-between">
            <Sk style={{ height: 22, width: 60 }} />
            <Sk style={{ height: 24, width: 80, borderRadius: 9999 }} />
          </div>
          <Sk style={{ height: 12, width: "70%" }} />
          <Sk style={{ height: 36, width: "100%", borderRadius: 9999 }} />
        </div>
      ))}
    </div>
  );
}
