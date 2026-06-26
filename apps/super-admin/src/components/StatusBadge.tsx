import type { TenantStatus } from "../lib/tenantStatus";

const META: Record<TenantStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-secondary/15 text-secondary" },
  trialing: { label: "Trialing", className: "bg-tertiary/15 text-tertiary" },
  past_due: { label: "Past due", className: "bg-tertiary/25 text-tertiary" },
  canceled: { label: "Canceled", className: "bg-error/10 text-error" },
  suspended: { label: "Suspended", className: "bg-error/10 text-error" },
  no_plan: {
    label: "No plan",
    className: "bg-surface-container text-on-surface-variant",
  },
};

export function StatusBadge({ status }: { status: TenantStatus }) {
  const meta = META[status];
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
