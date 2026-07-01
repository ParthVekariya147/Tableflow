import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useAdmin, billTotals } from "../store/AdminStore";
import { elapsed } from "../lib/money";
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
  const { state, dispatch, refresh, money } = useAdmin();
  const [picker, setPicker] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Force a fresh sync on open so we never render this table's previous session
  // snapshot (e.g. after it was reused, paid, or changed from another device).
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh, id]);

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
              onClick={() => setConfirmCancel(true)}
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
          onConfirm={(items) => {
            setPicker(false);
            void dispatch({ type: "ADD_ORDER_ITEMS", tableId: table.id, items });
          }}
        />
      )}

      {confirmCancel && (
        <ModalShell onClose={() => !cancelling && setConfirmCancel(false)}>
          <div className="flex flex-col items-center gap-md text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-container">
              <Icon name="cancel" size={26} className="text-error" />
            </div>
            <div>
              <h3 className="font-headline-md text-headline-md text-on-background">Cancel order?</h3>
              <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
                This abandons {table.label}&rsquo;s session without payment and frees the table. This can&rsquo;t be undone.
              </p>
            </div>
          </div>
          <div className="mt-lg flex gap-sm">
            <button
              onClick={() => setConfirmCancel(false)}
              disabled={cancelling}
              className="flex-1 rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-70"
            >
              Keep Session
            </button>
            <button
              onClick={async () => {
                if (cancelling) return;
                setCancelling(true);
                await dispatch({ type: "CANCEL_ORDER", tableId: table.id });
                navigate("/tables");
              }}
              disabled={cancelling}
              className="flex flex-1 items-center justify-center gap-xs rounded-full bg-error px-md py-sm font-label-md text-label-md text-on-error transition-colors hover:bg-error/90 disabled:opacity-70"
            >
              {cancelling && <Icon name="progress_activity" size={16} className="ag-spin" />}
              {cancelling ? "Cancelling…" : "Cancel Order"}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-on-background/20 p-md backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-scale-in rounded-card border border-outline-variant bg-surface-container-lowest p-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
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
  onConfirm,
}: {
  onClose: () => void;
  /** Called once with every selected line when staff confirms the batch. */
  onConfirm: (items: Array<{ menuItemId: string; qty: number }>) => void;
}) {
  const { state, money } = useAdmin();
  const [query, setQuery] = useState("");
  // Staged locally — nothing hits the API until "Add" is pressed, so picking
  // N items is one request instead of N.
  const [selected, setSelected] = useState<Record<string, number>>({});
  const items = state.items.filter(
    (i) => i.available && i.name.toLowerCase().includes(query.toLowerCase()),
  );

  function bump(itemId: string, delta: number) {
    setSelected((prev) => {
      const next = Math.max(0, (prev[itemId] ?? 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[itemId];
      else copy[itemId] = next;
      return copy;
    });
  }

  const entries = Object.entries(selected);
  const totalCount = entries.reduce((sum, [, qty]) => sum + qty, 0);
  const totalCents = entries.reduce((sum, [itemId, qty]) => {
    const item = state.items.find((i) => i.id === itemId);
    return sum + (item?.priceCents ?? 0) * qty;
  }, 0);

  function confirm() {
    if (totalCount === 0) return;
    onConfirm(entries.map(([menuItemId, qty]) => ({ menuItemId, qty })));
  }

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
            {items.map((item) => {
              const qty = selected[item.id] ?? 0;
              return (
                <li key={item.id}>
                  <div
                    className={`flex w-full items-center gap-md rounded-lg border p-sm text-left transition-colors ${
                      qty > 0
                        ? "border-primary/40 bg-primary-container/10"
                        : "border-transparent hover:border-outline-variant hover:bg-surface-container-low"
                    }`}
                  >
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${item.swatch}`}>
                      <Icon name={item.icon} size={24} className="text-on-background/50" />
                    </div>
                    <button
                      onClick={() => bump(item.id, 1)}
                      className="flex-1 text-left"
                    >
                      <div className="font-body-lg text-body-lg font-medium text-on-surface">{item.name}</div>
                      <div className="font-data-mono text-data-mono text-on-surface-variant">
                        {money(item.priceCents)}
                      </div>
                    </button>
                    {qty > 0 ? (
                      <div className="flex items-center gap-xs">
                        <button
                          onClick={() => bump(item.id, -1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                        >
                          <Icon name="remove" size={16} />
                        </button>
                        <span className="w-5 text-center font-data-mono text-data-mono text-on-surface">
                          {qty}
                        </span>
                        <button
                          onClick={() => bump(item.id, 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                        >
                          <Icon name="add" size={16} />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => bump(item.id, 1)}>
                        <Icon name="add_circle" className="text-primary" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        {totalCount > 0 && (
          <div className="shrink-0 border-t border-outline-variant bg-surface p-md">
            <button
              onClick={confirm}
              className="flex w-full items-center justify-center gap-xs rounded-lg bg-primary py-sm font-label-lg text-label-lg text-on-primary shadow-sm transition-colors hover:bg-primary-container"
            >
              Add {totalCount} {totalCount === 1 ? "Item" : "Items"} · {money(totalCents)}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
