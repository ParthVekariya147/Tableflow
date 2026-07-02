import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { billTotals, useAdmin, type BillTotals } from "../store/AdminStore";
import { elapsed } from "../lib/money";
import type { Table } from "../data/types";

/** Past this wait, a table is flagged as an urgent checkout. */
const LONG_WAIT_MS = 10 * 60 * 1000;

type SortKey = "wait" | "amount";

/**
 * Every table currently awaiting its bill, in one place — so a rush of
 * simultaneous "Bring the bill" requests doesn't force staff to hunt through
 * the floor plan table-by-table. Checkout still opens the existing
 * `BillingPage` receipt/payment panel; this page is purely a triage queue.
 */
export function BillingQueuePage() {
  const { state, money } = useAdmin();
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortKey>("wait");

  const queue = useMemo(() => {
    const rows = state.tables
      .filter((t) => t.status === "bill" && t.session)
      .map((t) => ({
        table: t,
        totals: billTotals(t.session!.rounds, state.taxRate),
        requestedAt: t.session!.billRequestedAt ?? t.session!.openedAt,
      }));
    return rows.sort((a, b) =>
      sort === "wait" ? a.requestedAt - b.requestedAt : b.totals.total - a.totals.total,
    );
  }, [state.tables, state.taxRate, sort]);

  const totalDue = queue.reduce((sum, q) => sum + q.totals.total, 0);
  const urgentCount = queue.filter((q) => Date.now() - q.requestedAt > LONG_WAIT_MS).length;

  return (
    <>
      <div className="mb-lg flex flex-col justify-between gap-md md:flex-row md:items-end">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-background">Billing Queue</h2>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Every table waiting on its check, longest wait first.
          </p>
        </div>

        <div className="flex items-center gap-md self-start">
          {queue.length > 0 && (
            <div className="flex items-center gap-lg rounded-card border border-outline-variant bg-surface-container-lowest px-lg py-sm shadow-card">
              <Stat value={String(queue.length)} label="Awaiting" tone={urgentCount > 0 ? "text-[#f57f17]" : undefined} />
              <div className="h-8 w-px bg-outline-variant" />
              <Stat value={money(totalDue)} label="Pending" tone="text-primary" />
            </div>
          )}
          <div className="flex items-center gap-sm rounded-full border border-outline-variant bg-surface-container-high p-1">
            {(["wait", "amount"] as SortKey[]).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`rounded-full px-md py-sm font-label-md text-label-md transition-all ${
                  sort === s
                    ? "bg-surface-container-lowest text-primary shadow-sm"
                    : "text-on-surface-variant hover:text-primary"
                }`}
              >
                {s === "wait" ? "Longest wait" : "Highest amount"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-md rounded-card border border-outline-variant bg-surface-container-lowest p-xxl text-center shadow-card">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f5e9] text-[#2e7d32]">
            <Icon name="check_circle" size={28} fill />
          </div>
          <div>
            <p className="font-title-lg text-title-lg text-on-surface">All tables current</p>
            <p className="font-body-md text-body-md text-on-surface-variant">
              No one is waiting on a bill right now.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-card">
          <ul className="flex flex-col">
            {queue.map(({ table, totals, requestedAt }) => (
              <QueueRow
                key={table.id}
                table={table}
                totals={totals}
                requestedAt={requestedAt}
                money={money}
                onCheckout={() => navigate(`/tables/${table.id}/billing`)}
              />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="text-center">
      <div className={`font-headline-md text-headline-md text-on-surface ${tone ?? ""}`}>{value}</div>
      <div className="font-label-md text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</div>
    </div>
  );
}

function QueueRow({
  table,
  totals,
  requestedAt,
  money,
  onCheckout,
}: {
  table: Table;
  totals: BillTotals;
  requestedAt: number;
  money: (cents: number) => string;
  onCheckout: () => void;
}) {
  const urgent = Date.now() - requestedAt > LONG_WAIT_MS;

  return (
    <li
      className={`flex flex-col gap-md border-b border-surface-variant p-lg last:border-0 sm:flex-row sm:items-center sm:justify-between ${
        urgent ? "bg-[#fff8e1]/40" : ""
      }`}
    >
      <Link to={`/tables/${table.id}`} className="flex min-w-0 items-center gap-md">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
            urgent ? "bg-[#ffb300] text-[#4e342e]" : "bg-tertiary-container text-on-tertiary-container"
          }`}
        >
          <Icon name="receipt_long" size={20} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-xs">
            <span className="font-title-lg text-title-lg text-on-surface hover:underline">{table.label}</span>
            {table.room && (
              <span className="font-body-md text-[11px] text-on-surface-variant">· {table.room}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-xs font-body-md text-body-md text-on-surface-variant">
            <Icon name="group" size={14} /> {table.seats} seats
            <span>•</span>
            <Icon name="schedule" size={14} className={urgent ? "text-[#f57f17]" : undefined} />
            <span className={urgent ? "font-medium text-[#f57f17]" : undefined}>
              waiting {elapsed(requestedAt)}
            </span>
            {urgent && (
              <span className="rounded-full bg-[#ffb300]/20 px-xs py-[1px] font-label-md text-[10px] uppercase tracking-wider text-[#f57f17]">
                Long wait
              </span>
            )}
          </div>
        </div>
      </Link>

      <div className="flex items-center justify-between gap-lg sm:justify-end">
        <div className="text-right">
          <div className="font-headline-md text-headline-md text-on-surface">{money(totals.total)}</div>
          <div className="font-body-md text-[11px] text-on-surface-variant">
            {totals.count} item{totals.count === 1 ? "" : "s"}
          </div>
        </div>
        <button
          onClick={onCheckout}
          className="flex shrink-0 items-center gap-xs rounded-full border border-tertiary px-md py-sm font-label-md text-label-md text-tertiary transition-colors hover:bg-tertiary-fixed"
        >
          <Icon name="point_of_sale" size={18} /> Checkout
        </button>
      </div>
    </li>
  );
}
