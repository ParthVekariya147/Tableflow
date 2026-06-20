import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useAdmin, billTotals } from "../store/AdminStore";
import { money } from "../lib/money";
import type { PaymentMethod } from "../data/types";

export function BillingPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, refresh } = useAdmin();

  // Sync on open so the bill reflects the latest items (the server also
  // recomputes totals on capture, but the displayed figures should match).
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh, id]);

  const table = state.tables.find((t) => t.id === id);
  const totals = useMemo(
    () => (table?.session ? billTotals(table.session.rounds, state.taxRate) : null),
    [table, state.taxRate],
  );

  const [method, setMethod] = useState<PaymentMethod>("card");
  const [paying, setPaying] = useState(false);
  const [tendered, setTendered] = useState<string>(() =>
    totals ? (totals.total / 100).toFixed(2) : "0.00",
  );

  if (!table || !table.session || !totals) {
    return <Navigate to="/tables" replace />;
  }

  // Capture the narrowed values so the closures below see non-null types.
  const activeTable = table;
  const bill = totals;

  const lineItems = table.session.rounds.map((round, idx) => ({
    idx: idx + 1,
    type: round.type,
    items: round.items.filter((i) => i.status !== "cancelled"),
  }));

  const gratuity = Math.round(totals.subtotal * 0.2);
  const tenderedCents = Math.round((parseFloat(tendered) || 0) * 100);
  const change = method === "cash" ? Math.max(0, tenderedCents - totals.total) : 0;

  function pad(key: string) {
    setTendered((cur) => {
      if (key === "del") return cur.slice(0, -1) || "0";
      if (key === "." && cur.includes(".")) return cur;
      const next = cur === "0" && key !== "." ? key : cur + key;
      return next;
    });
  }

  async function complete() {
    if (paying) return;
    // Wait for the charge to be confirmed before showing the success screen.
    setPaying(true);
    await dispatch({ type: "COMPLETE_PAYMENT", tableId: activeTable.id, method, amountCents: bill.total });
    navigate(`/tables/${activeTable.id}/complete`, {
      state: { method, totalCents: bill.total, tableLabel: activeTable.label },
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-xl">
      <div className="grid w-full max-w-[1000px] grid-cols-1 gap-xl md:grid-cols-2">
        {/* Receipt */}
        <section className="flex h-[600px] flex-col rounded-card bg-surface-container-lowest p-lg shadow-card">
          <div className="mb-md flex items-center justify-between border-b border-outline-variant pb-xs">
            <div className="flex items-center gap-sm">
              <button
                onClick={() => navigate(`/tables/${table.id}`)}
                className="text-on-surface-variant transition-colors hover:text-primary"
              >
                <Icon name="arrow_back" />
              </button>
              <h2 className="font-headline-md text-headline-md text-primary">{table.label} Checkout</h2>
            </div>
            <span className="font-data-mono text-data-mono text-on-surface-variant">
              #CHK-{table.id.slice(-4).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto pr-xs">
            {lineItems.map((round) => (
              <div key={round.idx} className="mb-lg space-y-sm">
                <h3 className="font-label-md text-label-md uppercase text-on-surface-variant">
                  Round {round.idx} · {round.type === "instant" ? "Bring it" : "Bring these"}
                </h3>
                {round.items.map((i) => (
                  <div key={i.id} className="flex justify-between font-body-md text-body-md text-on-surface">
                    <span>
                      {i.qty}× {i.name}
                    </span>
                    <span className="font-data-mono">{money(i.priceCents * i.qty)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="mt-auto space-y-sm border-t border-outline-variant pt-md">
            <Line label="Subtotal" value={money(totals.subtotal)} />
            <Line label={`Tax (${(state.taxRate * 100).toFixed(1)}%)`} value={money(totals.tax)} />
            <Line label="Gratuity (suggested 20%)" value={money(gratuity)} muted />
            <div className="flex justify-between pt-xs font-title-lg text-title-lg text-primary">
              <span>Total Due</span>
              <span className="font-data-mono">{money(totals.total)}</span>
            </div>
          </div>
        </section>

        {/* Payment controls */}
        <section className="flex h-[600px] flex-col rounded-card bg-surface-container-lowest p-lg shadow-card">
          <h3 className="mb-md font-label-md text-label-md uppercase text-on-surface-variant">
            Payment Method
          </h3>
          <div className="mb-lg grid grid-cols-2 gap-sm">
            {(["cash", "card"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`rounded-lg border px-xs py-sm font-label-md text-label-md capitalize transition-colors ${
                  method === m
                    ? "border-primary bg-primary-container/10 text-primary"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="mb-md">
            <label className="mb-base block font-label-md text-label-md text-on-surface-variant">
              Amount Tendered
            </label>
            <div className="relative">
              <span className="absolute left-md top-1/2 -translate-y-1/2 font-headline-md text-headline-md text-on-surface-variant">
                $
              </span>
              <input
                readOnly
                value={tendered}
                className="w-full rounded-lg border border-outline-variant bg-surface py-sm pl-xl pr-md text-right font-headline-md text-headline-md text-on-surface focus:border-primary focus:outline-none"
              />
            </div>
            {method === "cash" && (
              <div className="mt-sm flex justify-between font-body-md text-body-md text-on-surface-variant">
                <span>Change Due</span>
                <span className="font-data-mono text-data-mono">{money(change)}</span>
              </div>
            )}
          </div>

          <div className="mb-auto grid grid-cols-3 gap-xs">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => (
              <button
                key={k}
                onClick={() => pad(k)}
                className="flex items-center justify-center rounded-lg bg-surface-container-low py-md font-headline-md text-headline-md text-on-surface transition-colors hover:bg-surface-variant"
              >
                {k === "del" ? <Icon name="backspace" fill /> : k}
              </button>
            ))}
          </div>

          <button
            onClick={complete}
            disabled={paying}
            className="mt-lg flex w-full items-center justify-center gap-xs rounded-full bg-[#2e7d32] py-md font-label-md text-label-md uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-[#1b5e20] disabled:opacity-70"
          >
            <Icon name={paying ? "progress_activity" : "check_circle"} size={18} className={paying ? "ag-spin" : ""} />
            {paying ? "Processing…" : "Mark Paid & Complete Session"}
          </button>
        </section>
      </div>
    </div>
  );
}

function Line({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      className={`flex justify-between font-body-md text-body-md ${
        muted ? "text-on-surface-variant/70" : "text-on-surface-variant"
      }`}
    >
      <span>{label}</span>
      <span className="font-data-mono">{value}</span>
    </div>
  );
}
