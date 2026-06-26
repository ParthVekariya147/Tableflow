/** Reusable skeleton primitives for page-level loading states. */

export function Bone({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-surface-container-low ${className}`}
    />
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin text-primary"
      aria-label="Loading"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="31.4"
        strokeDashoffset="10"
        className="opacity-25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 4-up KPI cards skeleton for DashboardPage */
export function DashboardKpiSkeleton() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5"
        >
          <div className="mb-2 flex items-center justify-between">
            <Bone className="h-3.5 w-24" />
            <Bone className="h-4 w-4 rounded-full" />
          </div>
          <Bone className="h-8 w-28" />
          <Bone className="mt-2 h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Revenue chart + top-tenants row skeleton for DashboardPage */
export function DashboardChartSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[1.55fr_1fr]">
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <Bone className="h-4 w-36" />
          <Bone className="h-3 w-16" />
        </div>
        <div className="flex h-24 items-end gap-px">
          {Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 animate-pulse rounded-t bg-surface-container-low"
              style={{ height: `${20 + Math.random() * 80}%` }}
            />
          ))}
        </div>
        <div className="mt-3 flex gap-4">
          <Bone className="h-3 w-20" />
          <Bone className="h-3 w-20" />
        </div>
      </div>
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5">
        <Bone className="mb-4 h-4 w-24" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <Bone className="h-4 w-32" />
              <Bone className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Skeleton rows for a data table */
export function TableRowsSkeleton({
  rows = 6,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-outline-variant last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-3 py-3 sm:px-4">
              <Bone
                className={`h-4 ${c === 0 ? "w-36" : c === cols - 1 ? "w-16" : "w-24"}`}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Skeleton for the TenantDetailPage hero header band */
export function TenantDetailHeaderSkeleton() {
  return (
    <div className="flex flex-wrap items-start gap-5 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm sm:items-center sm:p-6">
      <Bone className="h-16 w-16 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Bone className="h-7 w-48" />
        <Bone className="h-4 w-24" />
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Bone className="h-9 w-28 rounded-lg" />
        <Bone className="h-9 w-28 rounded-lg" />
      </div>
    </div>
  );
}

/** Skeleton for a generic content card */
export function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <Bone className="mb-4 h-4 w-28" />
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Bone key={i} className={`h-4 ${i % 2 === 0 ? "w-full" : "w-3/4"}`} />
        ))}
      </div>
    </div>
  );
}

/** Grid of plan-card skeletons */
export function PlanCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
        >
          <Bone className="mb-3 h-6 w-24" />
          <Bone className="mb-3 h-9 w-32" />
          <div className="flex-1 space-y-2">
            <Bone className="h-3.5 w-full" />
            <Bone className="h-3.5 w-4/5" />
          </div>
          <Bone className="mt-4 h-9 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
