import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useAdmin, billTotals, itemUnitPrice } from "../store/AdminStore";
import { elapsed } from "../lib/money";
import type { ItemStatus, MenuItem, ModifierGroup, OrderItemModifier, Round } from "../data/types";

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
                              {money(itemUnitPrice(item))}
                            </span>
                          </div>
                          {item.modifiers && item.modifiers.length > 0 && (
                            <p className="mt-base font-body-md text-[12px] text-on-surface-variant">
                              {item.modifiers.map((m) => (m.textValue ? `"${m.textValue}"` : m.name)).join(", ")}
                            </p>
                          )}
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
                            {money(itemUnitPrice(item) * item.qty)}
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

/** One staged line in the "Add Item" drawer — not sent to the API until "Add" is pressed. */
interface StagedLine {
  key: string;
  menuItemId: string;
  qty: number;
  modifiers: OrderItemModifier[];
  notes?: string;
}

let stagedLineSeq = 0;
function newLineKey() {
  stagedLineSeq += 1;
  return `staged_${stagedLineSeq}`;
}

function ItemPicker({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  /** Called once with every selected line when staff confirms the batch. */
  onConfirm: (
    items: Array<{ menuItemId: string; qty: number; notes?: string; modifiers?: OrderItemModifier[] }>,
  ) => void;
}) {
  const { state, money } = useAdmin();
  const [query, setQuery] = useState("");
  const [configuring, setConfiguring] = useState<MenuItem | null>(null);
  // Staged locally — nothing hits the API until "Add" is pressed, so picking
  // N items is one request instead of N.
  const [lines, setLines] = useState<StagedLine[]>([]);

  const items = state.items.filter(
    (i) => i.available && i.name.toLowerCase().includes(query.toLowerCase()),
  );
  const categorized = state.categories
    .map((c) => ({ category: c, items: items.filter((i) => i.categoryId === c.id) }))
    .filter((g) => g.items.length > 0);
  const otherItems = items.filter((i) => !state.categories.some((c) => c.id === i.categoryId));

  function hasRequiredModifiers(item: MenuItem) {
    return (item.modifierGroups ?? []).some((g) => g.required);
  }

  /** Bump the plain (no modifiers/note) staged line for an item — the fast path
   *  for items that don't need any customization. */
  function bumpBare(item: MenuItem, delta: number) {
    setLines((prev) => {
      const idx = prev.findIndex(
        (l) => l.menuItemId === item.id && l.modifiers.length === 0 && !l.notes,
      );
      if (idx === -1) {
        if (delta <= 0) return prev;
        return [...prev, { key: newLineKey(), menuItemId: item.id, qty: 1, modifiers: [] }];
      }
      const qty = prev[idx]!.qty + delta;
      if (qty <= 0) return prev.filter((_, i) => i !== idx);
      return prev.map((l, i) => (i === idx ? { ...l, qty } : l));
    });
  }

  function bareQtyFor(itemId: string) {
    return lines.find((l) => l.menuItemId === itemId && l.modifiers.length === 0 && !l.notes)?.qty ?? 0;
  }

  function addConfiguredLine(item: MenuItem, qty: number, modifiers: OrderItemModifier[], notes: string) {
    setLines((prev) => [
      ...prev,
      { key: newLineKey(), menuItemId: item.id, qty, modifiers, notes: notes || undefined },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const totalCount = lines.reduce((sum, l) => sum + l.qty, 0);
  const totalCents = lines.reduce((sum, l) => {
    const item = state.items.find((i) => i.id === l.menuItemId);
    const modDelta = l.modifiers.reduce((s, m) => s + m.priceDelta, 0);
    return sum + ((item?.priceCents ?? 0) + modDelta) * l.qty;
  }, 0);

  function confirm() {
    if (lines.length === 0) return;
    onConfirm(
      lines.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty, notes: l.notes, modifiers: l.modifiers })),
    );
  }

  function renderItemRow(item: MenuItem) {
    const bareQty = bareQtyFor(item.id);
    const requiresConfig = hasRequiredModifiers(item);
    return (
      <li key={item.id}>
        <div
          className={`flex w-full items-center gap-md rounded-lg border p-sm text-left transition-colors ${
            bareQty > 0
              ? "border-primary/40 bg-primary-container/10"
              : "border-transparent hover:border-outline-variant hover:bg-surface-container-low"
          }`}
        >
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${item.swatch}`}>
            <Icon name={item.icon} size={24} className="text-on-background/50" />
          </div>
          <button
            onClick={() => (requiresConfig ? setConfiguring(item) : bumpBare(item, 1))}
            className="flex-1 text-left"
          >
            <div className="font-body-lg text-body-lg font-medium text-on-surface">{item.name}</div>
            <div className="font-data-mono text-data-mono text-on-surface-variant">
              {money(item.priceCents)}
            </div>
          </button>
          <div className="flex items-center gap-xs">
            {!requiresConfig &&
              (bareQty > 0 ? (
                <div className="flex items-center gap-xs">
                  <button
                    onClick={() => bumpBare(item, -1)}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                  >
                    <Icon name="remove" size={16} />
                  </button>
                  <span className="w-5 text-center font-data-mono text-data-mono text-on-surface">
                    {bareQty}
                  </span>
                  <button
                    onClick={() => bumpBare(item, 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                  >
                    <Icon name="add" size={16} />
                  </button>
                </div>
              ) : (
                <button onClick={() => bumpBare(item, 1)}>
                  <Icon name="add_circle" className="text-primary" />
                </button>
              ))}
            <button
              onClick={() => setConfiguring(item)}
              title="Modifiers / note / quantity"
              className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                requiresConfig
                  ? "border-primary text-primary hover:bg-primary-container/20"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              <Icon name="tune" size={16} />
            </button>
          </div>
        </div>
      </li>
    );
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
          {categorized.map(({ category, items: catItems }) => (
            <div key={category.id} className="mb-md last:mb-0">
              <h3 className="mb-xs px-sm font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                {category.name}
              </h3>
              <ul className="flex flex-col gap-xs">{catItems.map(renderItemRow)}</ul>
            </div>
          ))}
          {otherItems.length > 0 && (
            <div className="mb-md last:mb-0">
              <h3 className="mb-xs px-sm font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                Other
              </h3>
              <ul className="flex flex-col gap-xs">{otherItems.map(renderItemRow)}</ul>
            </div>
          )}
        </div>
        {lines.length > 0 && (
          <div className="max-h-40 shrink-0 overflow-y-auto border-t border-outline-variant bg-surface px-md py-sm">
            <ul className="flex flex-col gap-xs">
              {lines.map((l) => {
                const item = state.items.find((i) => i.id === l.menuItemId);
                return (
                  <li key={l.key} className="flex items-center justify-between gap-sm text-left">
                    <div className="min-w-0 flex-1">
                      <span className="font-body-md text-body-md text-on-surface">
                        {l.qty}× {item?.name ?? "Item"}
                      </span>
                      {(l.modifiers.length > 0 || l.notes) && (
                        <p className="truncate font-body-md text-[12px] text-on-surface-variant">
                          {[
                            ...l.modifiers.map((m) => (m.textValue ? `"${m.textValue}"` : m.name)),
                            ...(l.notes ? [`Note: ${l.notes}`] : []),
                          ].join(", ")}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => removeLine(l.key)}
                      className="shrink-0 rounded-full p-xs text-on-surface-variant hover:bg-surface-container-high hover:text-error"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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
      {configuring && (
        <ItemConfigurator
          item={configuring}
          money={money}
          onClose={() => setConfiguring(null)}
          onAdd={(qty, modifiers, notes) => {
            addConfiguredLine(configuring, qty, modifiers, notes);
            setConfiguring(null);
          }}
        />
      )}
    </div>
  );
}

/** Initial selection state per group: "" for single/text, [] for multiple/toggle. */
function initSelections(groups: ModifierGroup[]) {
  const s: Record<string, string | string[]> = {};
  for (const g of groups) {
    s[g.id ?? g.name] = g.inputType === "single" || g.inputType === "text" ? "" : [];
  }
  return s;
}

/** Modal for picking an item's modifiers + quantity + kitchen note before it's
 *  staged in the Add Item drawer — mirrors the customer app's ItemSheet so
 *  staff can record the same "spice level" / "extra naan" / special-instruction
 *  detail a guest could when placing a walk-in or phone order. */
function ItemConfigurator({
  item,
  money,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  money: (cents: number) => string;
  onClose: () => void;
  onAdd: (qty: number, modifiers: OrderItemModifier[], notes: string) => void;
}) {
  const groups = item.modifierGroups ?? [];
  const [qty, setQty] = useState(1);
  const [sel, setSel] = useState<Record<string, string | string[]>>(() => initSelections(groups));
  const [notes, setNotes] = useState("");

  const setSingle = (gid: string, optionId: string) =>
    setSel((s) => ({ ...s, [gid]: s[gid] === optionId ? "" : optionId }));
  const toggleMany = (gid: string, optionId: string, max?: number | null) =>
    setSel((s) => {
      const cur = (s[gid] as string[]) ?? [];
      if (cur.includes(optionId)) return { ...s, [gid]: cur.filter((x) => x !== optionId) };
      if (max != null && cur.length >= max) return s;
      return { ...s, [gid]: [...cur, optionId] };
    });
  const setText = (gid: string, value: string) => setSel((s) => ({ ...s, [gid]: value }));

  const chosen: OrderItemModifier[] = [];
  let valid = true;
  for (const g of groups) {
    const gid = g.id ?? g.name;
    if (g.inputType === "text") {
      const text = ((sel[gid] as string) ?? "").trim();
      if (text) {
        chosen.push({ id: newLineKey(), optionId: null, groupName: g.name, name: "", priceDelta: 0, textValue: text });
      } else if (g.required) valid = false;
    } else {
      const ids = g.inputType === "single" ? (sel[gid] ? [sel[gid] as string] : []) : ((sel[gid] as string[]) ?? []);
      for (const id of ids) {
        const opt = g.options.find((o) => o.id === id);
        if (opt) {
          chosen.push({
            id: newLineKey(),
            optionId: opt.id ?? null,
            groupName: g.name,
            name: opt.name,
            priceDelta: opt.priceCents,
          });
        }
      }
      const min = g.required ? Math.max(g.minSelect ?? 0, 1) : g.minSelect ?? 0;
      if (ids.length < min) valid = false;
    }
  }

  const unitPrice = item.priceCents + chosen.reduce((s, m) => s + m.priceDelta, 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-on-background/30 p-md backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-outline-variant px-lg py-md">
          <div>
            <h3 className="font-title-lg text-title-lg text-on-surface">{item.name}</h3>
            <p className="font-data-mono text-data-mono text-on-surface-variant">{money(unitPrice)}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-xs text-on-surface-variant hover:bg-surface-container-high">
            <Icon name="close" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-lg">
          {groups.map((g) => {
            const gid = g.id ?? g.name;
            return (
              <div key={gid} className="mb-lg">
                <div className="mb-xs flex items-center justify-between">
                  <h4 className="font-label-lg text-label-lg text-on-surface">{g.name}</h4>
                  <span className="font-label-md text-[11px] text-on-surface-variant">
                    {g.required ? "Required" : "Optional"}
                    {g.inputType === "multiple" && g.maxSelect ? ` · up to ${g.maxSelect}` : ""}
                  </span>
                </div>
                {g.inputType === "text" ? (
                  <textarea
                    rows={2}
                    maxLength={g.maxLength ?? undefined}
                    value={(sel[gid] as string) ?? ""}
                    onChange={(e) => setText(gid, e.target.value)}
                    placeholder={g.placeholder || "Add a note…"}
                    className="w-full resize-none rounded-lg border border-outline-variant bg-surface px-md py-sm font-body-md text-on-surface outline-none focus:border-primary"
                  />
                ) : (
                  <div className="flex flex-col gap-xs">
                    {g.options
                      .filter((o) => o.available !== false)
                      .map((o) => {
                        const selectedIds =
                          g.inputType === "single" ? (sel[gid] ? [sel[gid] as string] : []) : ((sel[gid] as string[]) ?? []);
                        const on = o.id != null && selectedIds.includes(o.id);
                        const onPick = () =>
                          o.id != null &&
                          (g.inputType === "single" ? setSingle(gid, o.id) : toggleMany(gid, o.id, g.maxSelect));
                        return (
                          <button
                            key={o.id ?? o.name}
                            onClick={onPick}
                            className={`flex items-center justify-between rounded-lg border px-md py-sm text-left transition-colors ${
                              on ? "border-primary bg-primary-container/10" : "border-outline-variant hover:bg-surface-container-low"
                            }`}
                          >
                            <span className="font-body-md text-on-surface">{o.name}</span>
                            <span className="font-data-mono text-[12px] text-on-surface-variant">
                              {o.priceCents > 0 ? `+${money(o.priceCents)}` : o.priceCents < 0 ? money(o.priceCents) : ""}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="mb-lg">
            <h4 className="mb-xs font-label-lg text-label-lg text-on-surface">Note for the kitchen</h4>
            <textarea
              rows={2}
              maxLength={200}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. less spicy, no onion…"
              className="w-full resize-none rounded-lg border border-outline-variant bg-surface px-md py-sm font-body-md text-on-surface outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="font-label-lg text-label-lg text-on-surface">Quantity</span>
            <div className="flex items-center gap-md rounded-lg border border-outline-variant">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex h-8 w-8 items-center justify-center text-on-surface-variant hover:bg-surface-container-low"
              >
                <Icon name="remove" size={18} />
              </button>
              <span className="w-6 text-center font-data-mono text-data-mono text-on-surface">{qty}</span>
              <button
                onClick={() => setQty((q) => q + 1)}
                className="flex h-8 w-8 items-center justify-center text-on-surface-variant hover:bg-surface-container-low"
              >
                <Icon name="add" size={18} />
              </button>
            </div>
          </div>
          {!valid && (
            <p className="mt-md text-center font-body-md text-[12px] text-error">
              Please complete the required options above.
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-outline-variant p-lg">
          <button
            onClick={() => valid && onAdd(qty, chosen, notes.trim())}
            disabled={!valid}
            className="flex w-full items-center justify-center gap-xs rounded-lg bg-primary py-sm font-label-lg text-label-lg text-on-primary shadow-sm transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add · {money(unitPrice * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}
