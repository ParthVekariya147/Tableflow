import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useAdmin, billTotals } from "../store/AdminStore";
import { money, elapsed } from "../lib/money";
import type { ItemStatus, Round } from "../data/types";

const ROUND_STATE: Record<string, { label: string; chip: string }> = {
  placed: { label: "Placed", chip: "bg-secondary-container/40 text-on-secondary-container" },
  preparing: { label: "In Prep", chip: "bg-tertiary-container/20 text-tertiary" },
  served: { label: "Served", chip: "bg-[#e8f5e9] text-[#2e7d32]" },
};

function roundState(round: Round): keyof typeof ROUND_STATE {
  const items = round.items.filter((i) => i.status !== "cancelled");
  if (items.length && items.every((i) => i.status === "served")) return "served";
  if (items.some((i) => i.status === "preparing")) return "preparing";
  return "placed";
}

export function TableSessionPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useAdmin();
  const [picker, setPicker] = useState(false);

  const table = state.tables.find((t) => t.id === id);

  if (!table || !table.session) {
    return (
      <div className="flex flex-col items-center gap-md py-xxl text-on-surface-variant">
        <Icon name="table_restaurant" size={48} />
        <p className="font-body-md text-body-md">This table has no active session.</p>
        <Link to="/tables" className="font-label-md text-label-md text-primary hover:underline">
          ← Back to Floor
        </Link>
      </div>
    );
  }

  const totals = billTotals(table.session.rounds, state.taxRate);

  return (
    <>
      <div className="mb-lg flex items-end justify-between">
        <div>
          <div className="mb-xs flex items-center gap-sm">
            <button
              onClick={() => navigate("/tables")}
              className="flex items-center text-on-surface-variant transition-colors hover:text-primary"
            >
              <Icon name="arrow_back" />
            </button>
            <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
              {table.room}
            </span>
          </div>
          <h2 className="flex items-center gap-md font-headline-lg text-headline-lg text-on-background">
            {table.label} Session
            <span className="rounded-full bg-surface-variant px-sm py-xs font-data-mono text-data-mono text-on-surface-variant">
              Seated for {elapsed(table.session.openedAt)}
            </span>
          </h2>
        </div>
        <div className="flex gap-sm">
          <button
            onClick={() => setPicker(true)}
            className="flex items-center gap-xs rounded-lg bg-primary px-md py-sm font-label-md text-label-md text-on-primary shadow-sm transition-colors hover:bg-primary-container"
          >
            <Icon name="add" size={18} /> Add Item
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
        {/* Rounds */}
        <div className="space-y-lg lg:col-span-2">
          {table.session.rounds.length === 0 && (
            <div className="flex flex-col items-center gap-sm rounded-card border border-dashed border-outline-variant bg-surface-container-lowest py-xxl text-on-surface-variant">
              <Icon name="receipt_long" size={40} />
              <p className="font-body-md text-body-md">No items yet. Add the first round.</p>
            </div>
          )}
          {table.session.rounds.map((round, idx) => {
            const st = ROUND_STATE[roundState(round)]!;
            const visible = round.items.filter((i) => i.status !== "cancelled");
            if (visible.length === 0) return null;
            return (
              <div
                key={round.id}
                className="overflow-hidden rounded-card border border-surface-variant bg-surface-container-lowest shadow-card"
              >
                <div className="flex items-center justify-between border-b border-surface-variant bg-surface-container-low px-lg py-md">
                  <h3 className="font-title-lg text-title-lg text-on-surface">
                    Round {idx + 1}
                    <span className="ml-xs font-body-md text-on-surface-variant">
                      — {round.type === "instant" ? "Bring it" : "Bring these"}
                    </span>
                  </h3>
                  <span className={`rounded-full px-sm py-base font-label-md text-label-md ${st.chip}`}>
                    {st.label}
                  </span>
                </div>
                <div>
                  {visible.map((item) => {
                    const locked: ItemStatus[] = ["served"];
                    const isLocked = locked.includes(item.status);
                    return (
                      <div
                        key={item.id}
                        className="group flex items-center border-b border-surface-variant p-md transition-colors last:border-0 hover:bg-primary/5"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-sm">
                            <span className="font-title-lg text-title-lg text-on-surface">{item.name}</span>
                            <span className="font-data-mono text-data-mono text-on-surface-variant">
                              {money(item.priceCents)}
                            </span>
                          </div>
                          {item.note && (
                            <p className="mt-base font-body-md text-body-md text-on-surface-variant">
                              {item.note}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-md">
                          <div
                            className={`flex items-center overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest ${
                              isLocked ? "pointer-events-none opacity-50" : ""
                            }`}
                          >
                            <button
                              onClick={() =>
                                dispatch({ type: "CHANGE_QTY", tableId: table.id, roundId: round.id, itemId: item.id, delta: -1 })
                              }
                              className="flex items-center justify-center p-xs text-on-surface-variant transition-colors hover:bg-surface-container-low"
                            >
                              <Icon name="remove" size={18} />
                            </button>
                            <span className="min-w-[2.5rem] border-x border-outline-variant px-md text-center font-data-mono text-data-mono">
                              {item.qty}
                            </span>
                            <button
                              onClick={() =>
                                dispatch({ type: "CHANGE_QTY", tableId: table.id, roundId: round.id, itemId: item.id, delta: 1 })
                              }
                              className="flex items-center justify-center p-xs text-on-surface-variant transition-colors hover:bg-surface-container-low"
                            >
                              <Icon name="add" size={18} />
                            </button>
                          </div>
                          <span className="min-w-[4rem] text-right font-data-mono text-data-mono font-semibold text-on-surface">
                            {money(item.priceCents * item.qty)}
                          </span>
                          <button
                            onClick={() =>
                              dispatch({ type: "CANCEL_ITEM", tableId: table.id, roundId: round.id, itemId: item.id })
                            }
                            title="Cancel item"
                            className="ml-sm flex items-center justify-center rounded-lg p-xs text-on-surface-variant opacity-0 transition-colors hover:bg-error-container/50 hover:text-error group-hover:opacity-100"
                          >
                            <Icon name="cancel" size={20} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bill summary */}
        <div className="sticky top-24 flex h-fit flex-col rounded-card border border-surface-variant bg-surface-container-lowest shadow-card">
          <div className="border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-surface">Bill Summary</h3>
          </div>
          <div className="flex-1 space-y-sm p-lg">
            <Row label={`Subtotal (${totals.count} items)`} value={money(totals.subtotal)} />
            <Row label={`Tax (${(state.taxRate * 100).toFixed(1)}%)`} value={money(totals.tax)} />
            <div className="mt-sm flex items-center justify-between border-t border-surface-variant pt-sm font-title-lg text-on-surface">
              <span>Total</span>
              <span className="font-data-mono text-data-mono font-bold">{money(totals.total)}</span>
            </div>
          </div>
          <div className="space-y-sm rounded-b-card border-t border-surface-variant bg-surface-container-low p-lg">
            <button
              onClick={() => navigate(`/tables/${table.id}/billing`)}
              disabled={totals.count === 0}
              className="flex w-full items-center justify-center gap-xs rounded-lg bg-primary py-md font-title-lg text-title-lg text-on-primary shadow-sm transition-all hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="payments" /> Take Payment
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Cancel the entire order for ${table.label}? This frees the table.`)) {
                  dispatch({ type: "CANCEL_ORDER", tableId: table.id });
                  navigate("/tables");
                }
              }}
              className="w-full rounded-lg border border-error/50 py-sm font-label-md text-label-md text-error transition-colors hover:border-error hover:bg-error-container"
            >
              Cancel Order
            </button>
          </div>
        </div>
      </div>

      {picker && (
        <ItemPicker
          onClose={() => setPicker(false)}
          onPick={(menuItemId) => dispatch({ type: "ADD_ORDER_ITEM", tableId: table.id, menuItemId })}
        />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between font-body-md text-on-surface-variant">
      <span>{label}</span>
      <span className="font-data-mono text-data-mono">{value}</span>
    </div>
  );
}

function ItemPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (menuItemId: string) => void;
}) {
  const { state } = useAdmin();
  const [query, setQuery] = useState("");
  const items = state.items.filter(
    (i) => i.available && i.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-on-background/20 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md animate-slide-in-right flex-col border-l border-outline-variant bg-surface-container-lowest shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-lg py-md">
          <h2 className="font-headline-md text-headline-md text-on-background">Add Item</h2>
          <button onClick={onClose} className="rounded-full p-xs text-on-surface-variant hover:bg-surface-container-high">
            <Icon name="close" />
          </button>
        </header>
        <div className="border-b border-outline-variant p-md">
          <div className="relative">
            <Icon
              name="search"
              size={20}
              className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu…"
              className="w-full rounded-lg border border-outline-variant bg-surface py-sm pl-10 pr-sm font-body-md text-on-surface outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-md">
          <ul className="flex flex-col gap-xs">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => onPick(item.id)}
                  className="flex w-full items-center gap-md rounded-lg border border-transparent p-sm text-left transition-colors hover:border-outline-variant hover:bg-surface-container-low"
                >
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${item.swatch}`}>
                    <Icon name={item.icon} size={24} className="text-on-background/50" />
                  </div>
                  <div className="flex-1">
                    <div className="font-body-lg text-body-lg font-medium text-on-surface">{item.name}</div>
                    <div className="font-data-mono text-data-mono text-on-surface-variant">
                      {money(item.priceCents)}
                    </div>
                  </div>
                  <Icon name="add_circle" className="text-primary" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
