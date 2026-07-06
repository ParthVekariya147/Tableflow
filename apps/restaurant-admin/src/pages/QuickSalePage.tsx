import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@amber/api-client";
import { Icon } from "../components/Icon";
import { CenteredSpinner, PinnerLoader } from "../components/Skeleton";
import { api } from "../lib/api";
import { kdsClient } from "../kds/kdsClient";
import { useAdmin, itemUnitPrice } from "../store/AdminStore";
import { ItemPicker } from "./TableSessionPage";
import type { ItemStatus, OrderItemModifier, TableSession } from "../data/types";

/** One line of the counter cart. `isNew` lines exist only in this component's
 *  state; everything else was loaded from an existing (e.g. previously saved
 *  but not yet charged) session and carries the server's item id as `key`. */
interface DraftLine {
  key: string;
  isNew: boolean;
  roundId?: string;
  menuItemId: string;
  name: string;
  /** Per-unit price incl. modifier deltas, in cents — display only. */
  unitPriceCents: number;
  qty: number;
  notes?: string;
  modifiers?: OrderItemModifier[];
  status?: ItemStatus;
}

let localLineSeq = 0;
function newLocalKey() {
  localLineSeq += 1;
  return `local_${localLineSeq}`;
}

/**
 * "Add items, charge, print" with no table involved — a counter/walk-in POS
 * mode, backed by the tenant's single auto-created virtual "Counter Sale"
 * table (`isCounter`, hidden from the floor plan).
 *
 * Quantity/remove edits stay entirely local (no network call per tap) — a
 * counter sale is one cashier on one screen, not a shared dine-in table, so
 * there's no concurrent-device write to race against. Everything is synced
 * in a single batch ("Save & Charge") that diffs the local cart against what
 * was last loaded from the server, so it costs one `addRound` call for new
 * lines plus one `updateItem` per line that actually changed qty/was
 * removed — never one call per click.
 */
export function QuickSalePage() {
  const navigate = useNavigate();
  const { state, refreshFloor, money } = useAdmin();
  const [counterId, setCounterId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | undefined>(undefined);
  const [resolving, setResolving] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [baseline, setBaseline] = useState<DraftLine[]>([]);

  function seedFromSession(session?: TableSession) {
    const lines: DraftLine[] = session
      ? session.rounds.flatMap((round) =>
          round.items
            .filter((item) => item.status !== "cancelled")
            .map((item) => ({
              key: item.id,
              isNew: false,
              roundId: round.id,
              menuItemId: item.menuItemId,
              name: item.name,
              unitPriceCents: itemUnitPrice(item),
              qty: item.qty,
              notes: item.note,
              modifiers: item.modifiers,
              status: item.status,
            })),
        )
      : [];
    setDraft(lines);
    setBaseline(lines);
    setOrderId(session?.orderId);
  }

  // Find-or-create the counter table once. Errors (incl. the backend's known
  // connection-pool-burst timeout, see BUGS.md BUG-003) must land in a
  // retryable state, not an infinite spinner.
  async function resolveCounter() {
    setResolving(true);
    setLoadError(null);
    try {
      const table = await api.tables.counter();
      setCounterId(table.id);
      await refreshFloor();
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't reach the server");
    } finally {
      setResolving(false);
    }
  }

  useEffect(() => {
    void resolveCounter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed the local cart from whatever the counter table already holds, once.
  // Re-armed (via `setSeeded(false)`) only after a failed save, so a partial
  // failure re-syncs against the server's actual state instead of silently
  // re-sending the same deltas twice.
  useEffect(() => {
    if (seeded || !counterId) return;
    const t = state.tables.find((x) => x.id === counterId);
    if (!t) return;
    seedFromSession(t.session);
    setSeeded(true);
  }, [counterId, state.tables, seeded]);

  const diff = useMemo(() => {
    const baselineByKey = new Map(baseline.map((l) => [l.key, l.qty]));
    const added = draft.filter((l) => l.isNew).length;
    const changed = draft.filter((l) => !l.isNew && l.qty !== baselineByKey.get(l.key)).length;
    const removed = baseline.filter((b) => !draft.some((d) => d.key === b.key)).length;
    return { added, changed, removed, total: added + changed + removed };
  }, [draft, baseline]);

  const count = draft.reduce((sum, l) => sum + l.qty, 0);
  const subtotal = draft.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);
  const tax = Math.round(subtotal * state.taxRate);
  const total = subtotal + tax;

  function addItems(
    items: Array<{ menuItemId: string; qty: number; notes?: string; modifiers?: OrderItemModifier[] }>,
  ) {
    const additions = items
      .map((sel) => {
        const menuItem = state.items.find((i) => i.id === sel.menuItemId);
        if (!menuItem) return null;
        const modDelta = (sel.modifiers ?? []).reduce((s, m) => s + m.priceDelta, 0);
        const line: DraftLine = {
          key: newLocalKey(),
          isNew: true,
          menuItemId: menuItem.id,
          name: menuItem.name,
          unitPriceCents: menuItem.priceCents + modDelta,
          qty: sel.qty,
          notes: sel.notes,
          modifiers: sel.modifiers,
        };
        return line;
      })
      .filter((l): l is DraftLine => l !== null);
    if (additions.length === 0) return;
    setDraft((prev) => [...prev, ...additions]);
  }

  function changeQty(key: string, delta: number) {
    setDraft((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx === -1) return prev;
      const line = prev[idx]!;
      const qty = line.qty + delta;
      if (qty <= 0) return prev.filter((_, i) => i !== idx);
      return prev.map((l, i) => (i === idx ? { ...l, qty } : l));
    });
  }

  function removeLine(key: string) {
    setDraft((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSave() {
    if (saving || !counterId || count === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      let liveOrderId = orderId;
      if (!liveOrderId) {
        const order = await api.orders.createForTable(counterId, {});
        liveOrderId = order.id;
      }

      const baselineByKey = new Map(baseline.map((l) => [l.key, l.qty]));
      const newLines = draft.filter((l) => l.isNew);
      const changedLines = draft.filter((l) => !l.isNew && l.qty !== baselineByKey.get(l.key));
      const removedLines = baseline.filter((b) => !draft.some((d) => d.key === b.key));

      const calls: Promise<unknown>[] = [];

      if (newLines.length > 0) {
        calls.push(
          api.orders.addRound(liveOrderId, {
            type: "bundled",
            items: newLines.map((l) => {
              const menuItem = state.items.find((i) => i.id === l.menuItemId);
              return {
                menuItemId: l.menuItemId,
                name: l.name,
                unitPrice: menuItem?.priceCents ?? l.unitPriceCents,
                qty: l.qty,
                notes: l.notes || undefined,
                modifiers: l.modifiers?.map((m) => ({
                  optionId: m.optionId ?? undefined,
                  groupName: m.groupName,
                  name: m.name,
                  priceDelta: m.priceDelta,
                  textValue: m.textValue,
                })),
              };
            }),
          }),
        );
      }
      for (const line of changedLines) {
        calls.push(
          api.orders.updateItem(liveOrderId, line.key, {
            qtyDelta: line.qty - (baselineByKey.get(line.key) ?? 0),
          }),
        );
      }
      for (const line of removedLines) {
        calls.push(api.orders.updateItem(liveOrderId, line.key, { status: "cancelled" }));
      }

      await Promise.all(calls);
      for (const line of removedLines) {
        if (line.roundId) void kdsClient.removeTicket?.(`${line.roundId}::${line.key}`);
      }

      // No refreshFloor() here: BillingPage re-syncs the floor itself on
      // mount, and the SSE stream already pushed this same order update to
      // every other subscriber — a third fetch here would just duplicate it.
      navigate(`/tables/${counterId}/billing`);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Couldn't save — try again.");
      await refreshFloor();
      setSeeded(false);
    } finally {
      setSaving(false);
    }
  }

  if (resolving) {
    return <CenteredSpinner label="Loading Quick Sale…" />;
  }

  if (loadError || !counterId) {
    return (
      <div className="flex flex-col items-center gap-md rounded-card border border-outline-variant bg-surface-container-lowest py-xxl text-center text-on-surface-variant">
        <Icon name="error" size={40} />
        <p className="font-body-md text-body-md">
          {loadError ?? "Couldn't load Quick Sale."}
        </p>
        <button
          onClick={() => void resolveCounter()}
          className="flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low"
        >
          <Icon name="refresh" size={18} /> Retry
        </button>
      </div>
    );
  }

  if (!seeded) {
    return <CenteredSpinner label="Loading Quick Sale…" />;
  }

  return (
    <>
      {saving && <PinnerLoader />}
      <div className="mb-lg flex items-end justify-between">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-background">Quick Sale</h2>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Add items and charge — no table needed.
          </p>
        </div>
        <button
          onClick={() => setPicker(true)}
          className="flex items-center gap-xs rounded-lg bg-primary px-md py-sm font-label-md text-label-md text-on-primary shadow-sm transition-colors hover:bg-primary-container"
        >
          <Icon name="add" size={18} />
          Add Item
        </button>
      </div>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
        <div className="space-y-lg lg:col-span-2">
          {draft.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-card border border-dashed border-outline-variant bg-surface-container-lowest py-xxl text-on-surface-variant">
              <Icon name="point_of_sale" size={40} />
              <p className="font-body-md text-body-md">No items yet. Add the first one.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-surface-variant bg-surface-container-lowest shadow-card">
              {draft.map((line) => {
                const locked: ItemStatus[] = ["served"];
                const isLocked = !!line.status && locked.includes(line.status);
                return (
                  <div
                    key={line.key}
                    className="group flex items-center border-b border-surface-variant p-md transition-colors last:border-0 hover:bg-primary/5"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-sm">
                        <span className="font-title-lg text-title-lg text-on-surface">{line.name}</span>
                        <span className="font-data-mono text-data-mono text-on-surface-variant">
                          {money(line.unitPriceCents)}
                        </span>
                      </div>
                      {line.modifiers && line.modifiers.length > 0 && (
                        <p className="mt-base font-body-md text-[12px] text-on-surface-variant">
                          {line.modifiers.map((m) => (m.textValue ? `"${m.textValue}"` : m.name)).join(", ")}
                        </p>
                      )}
                      {line.notes && (
                        <p className="mt-base font-body-md text-body-md text-on-surface-variant">{line.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-md">
                      <div
                        className={`flex items-center overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest ${
                          isLocked ? "pointer-events-none opacity-50" : ""
                        }`}
                      >
                        <button
                          onClick={() => changeQty(line.key, -1)}
                          className="flex items-center justify-center p-xs text-on-surface-variant transition-colors hover:bg-surface-container-low"
                        >
                          <Icon name="remove" size={18} />
                        </button>
                        <span className="flex min-w-[2.5rem] items-center justify-center border-x border-outline-variant px-md text-center font-data-mono text-data-mono">
                          {line.qty}
                        </span>
                        <button
                          onClick={() => changeQty(line.key, 1)}
                          className="flex items-center justify-center p-xs text-on-surface-variant transition-colors hover:bg-surface-container-low"
                        >
                          <Icon name="add" size={18} />
                        </button>
                      </div>
                      <span className="min-w-[4rem] text-right font-data-mono text-data-mono font-semibold text-on-surface">
                        {money(line.unitPriceCents * line.qty)}
                      </span>
                      <button
                        onClick={() => removeLine(line.key)}
                        disabled={isLocked}
                        title="Remove item"
                        className="ml-sm flex items-center justify-center rounded-lg p-xs text-on-surface-variant opacity-0 transition-colors hover:bg-error-container/50 hover:text-error group-hover:opacity-100 disabled:opacity-30"
                      >
                        <Icon name="cancel" size={20} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="sticky top-24 flex h-fit flex-col rounded-card border border-surface-variant bg-surface-container-lowest shadow-card">
          <div className="border-b border-surface-variant px-lg py-md">
            <h3 className="font-title-lg text-title-lg text-on-surface">Bill Summary</h3>
          </div>
          <div className="flex-1 space-y-sm p-lg">
            <Row label={`Subtotal (${count} items)`} value={money(subtotal)} />
            <Row label={`Tax (${(state.taxRate * 100).toFixed(1)}%)`} value={money(tax)} />
            <div className="mt-sm flex items-center justify-between border-t border-surface-variant pt-sm font-title-lg text-on-surface">
              <span>Total</span>
              <span className="font-data-mono text-data-mono font-bold">{money(total)}</span>
            </div>
          </div>
          <div className="rounded-b-card border-t border-surface-variant bg-surface-container-low p-lg">
            <button
              onClick={() => void handleSave()}
              disabled={saving || count === 0}
              className="flex w-full items-center justify-center gap-xs rounded-lg bg-primary py-md font-title-lg text-title-lg text-on-primary shadow-sm transition-all hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name={saving ? "progress_activity" : "save"} className={saving ? "ag-spin" : ""} />
              {saving ? "Saving…" : "Save & Charge"}
            </button>
            {saveError && (
              <p className="mt-sm text-center font-body-md text-body-md text-error">{saveError}</p>
            )}
            {!saving && !saveError && diff.total > 0 && (
              <p className="mt-sm text-center font-body-md text-[12px] text-on-surface-variant">
                {diff.total} item{diff.total === 1 ? "" : "s"} changed — not yet saved
              </p>
            )}
          </div>
        </div>
      </div>

      {picker && (
        <ItemPicker
          onClose={() => setPicker(false)}
          onConfirm={(items) => {
            setPicker(false);
            addItems(items);
          }}
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
