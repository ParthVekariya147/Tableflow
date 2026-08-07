import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@amber/api-client";
import { useTenant } from "@amber/ui";
import { enabledPaymentMethods } from "@amber/domain";
import { Icon } from "../components/Icon";
import { PinnerLoader } from "../components/Skeleton";
import { api } from "../lib/api";
import {
  clearQuickSaleDraft,
  getQuickSaleRequestId,
  loadQuickSaleDraft,
  saveQuickSaleDraft,
  type QuickSaleDraftLine,
} from "../lib/quickSaleDraft";
import { useAdmin } from "../store/AdminStore";
import { useAuth } from "../context/AuthContext";
import { ItemPicker } from "./TableSessionPage";
import type { OrderItemModifier, PaymentMethod } from "../data/types";

const METHOD_META: Record<PaymentMethod, { icon: string; label: string; desc: string }> = {
  cash: { icon: "payments", label: "Cash", desc: "Collect cash at the counter" },
  card: { icon: "credit_card", label: "Card", desc: "Customer pays at the POS" },
  upi: { icon: "qr_code_2", label: "UPI", desc: "Confirm UPI received" },
};

let localLineSeq = 0;
function newLocalKey() {
  localLineSeq += 1;
  return `local_${Date.now()}_${localLineSeq}`;
}

/**
 * "Add items, charge, print" with no table involved — a counter/walk-in POS
 * mode.
 *
 * The cart is **device-local until charged**: it lives only in this device's
 * localStorage (restored on reopen, so an app close / refresh / dead network
 * mid-sale loses nothing) and NOTHING is written to the server while items are
 * being added. Only confirming the payment sends the whole sale — one atomic
 * `POST /orders/quick-sale` that records order + items + payment together and
 * then clears the local cart. Because no quick-sale order is ever live on the
 * shared counter table, any number of tills/phones can each ring up their own
 * sale in parallel without ever seeing (or blocking) each other's carts.
 */
export function QuickSalePage() {
  const navigate = useNavigate();
  const { state, refreshFloor, money, currencySymbol } = useAdmin();
  const { user, setLastPaymentMethod } = useAuth();
  const tenant = useTenant();

  const [draft, setDraft] = useState<QuickSaleDraftLine[]>(() => loadQuickSaleDraft());
  const [picker, setPicker] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [pickedMethod, setMethod] = useState<PaymentMethod>(
    user?.lastPaymentMethod ?? "cash",
  );
  const [tendered, setTendered] = useState("0");
  const [charging, setCharging] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);

  // Tenders this restaurant accepts (Settings → Payments). Derived so a
  // remembered-but-since-disabled method can't stay selected.
  const availableMethods = enabledPaymentMethods(tenant.paymentMethods);
  const method: PaymentMethod = availableMethods.includes(pickedMethod)
    ? pickedMethod
    : availableMethods[0] ?? "cash";

  // Write-through persistence: every cart change lands in localStorage at
  // once, so the draft survives whatever happens to the tab next.
  useEffect(() => {
    saveQuickSaleDraft(draft);
  }, [draft]);

  /** Per-unit price incl. modifier deltas. Prefers the LIVE menu price (a
   *  restored draft may carry a stale snapshot; the server re-prices from the
   *  DB at charge time, so displaying the live number keeps the on-screen
   *  total equal to what will actually be charged). */
  function unitPrice(line: QuickSaleDraftLine): number {
    const liveBase =
      state.items.find((i) => i.id === line.menuItemId)?.priceCents ?? line.basePriceCents;
    const modDelta = (line.modifiers ?? []).reduce((s, m) => s + m.priceDelta, 0);
    return liveBase + modDelta;
  }

  const count = draft.reduce((sum, l) => sum + l.qty, 0);
  const subtotal = draft.reduce((sum, l) => sum + unitPrice(l) * l.qty, 0);
  const tax = Math.round(subtotal * state.taxRate);
  const total = subtotal + tax;

  function addItems(
    items: Array<{ menuItemId: string; qty: number; notes?: string; modifiers?: OrderItemModifier[] }>,
  ) {
    const additions = items
      .map((sel) => {
        const menuItem = state.items.find((i) => i.id === sel.menuItemId);
        if (!menuItem) return null;
        const line: QuickSaleDraftLine = {
          key: newLocalKey(),
          menuItemId: menuItem.id,
          name: menuItem.name,
          basePriceCents: menuItem.priceCents,
          qty: sel.qty,
          notes: sel.notes,
          modifiers: sel.modifiers,
        };
        return line;
      })
      .filter((l): l is QuickSaleDraftLine => l !== null);
    if (additions.length === 0) return;
    setDraft((prev) => [...prev, ...additions]);
  }

  function changeQty(key: string, delta: number) {
    setDraft((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx === -1) return prev;
      const qty = prev[idx]!.qty + delta;
      if (qty <= 0) return prev.filter((_, i) => i !== idx);
      return prev.map((l, i) => (i === idx ? { ...l, qty } : l));
    });
  }

  function removeLine(key: string) {
    setDraft((prev) => prev.filter((l) => l.key !== key));
  }

  function openPayment() {
    if (count === 0) return;
    setChargeError(null);
    setTendered((total / 100).toFixed(2));
    setPayOpen(true);
  }

  const tenderedCents = Math.round((parseFloat(tendered) || 0) * 100);
  const change = method === "cash" ? Math.max(0, tenderedCents - total) : 0;

  async function handleCharge() {
    if (charging || count === 0) return;
    setCharging(true);
    setChargeError(null);
    try {
      const { order, payment } = await api.orders.quickSale({
        // Stable per cart and persisted, so a retry after a lost response
        // resolves to the SAME sale instead of charging twice.
        clientRequestId: getQuickSaleRequestId(),
        items: draft.map((l) => ({
          menuItemId: l.menuItemId,
          name: l.name,
          unitPrice:
            state.items.find((i) => i.id === l.menuItemId)?.priceCents ?? l.basePriceCents,
          qty: l.qty,
          notes: l.notes || undefined,
          modifiers: l.modifiers?.map((m) => ({
            optionId: m.optionId ?? undefined,
            groupName: m.groupName,
            name: m.name,
            priceDelta: m.priceDelta,
            textValue: m.textValue,
          })),
        })),
        payment: {
          method,
          tendered: method === "cash" ? tenderedCents : undefined,
        },
      });
      // The sale is in the DB — only NOW does the local cart go away.
      clearQuickSaleDraft();
      setDraft([]);
      setLastPaymentMethod(method).catch(() => {});
      // Light floor sync so PaymentCompletePage can recognise the counter
      // table (isCounter → "New Sale" button) even on a tenant's first sale.
      await refreshFloor().catch(() => {});
      navigate(
        `/tables/${order.tableId}/complete?order=${encodeURIComponent(order.id)}`,
        { state: { method, totalCents: payment.total, tableLabel: "Counter Sale" } },
      );
    } catch (e) {
      // The cart (and its idempotency key) are still on this device, so
      // retrying is safe: if the sale actually did land and only the reply was
      // lost, the retry resolves to that same sale rather than charging again.
      // The copy no longer promises "nothing was charged" — that was only true
      // for pre-commit failures and it talked staff into double-charging.
      setChargeError(
        e instanceof ApiError
          ? e.message
          : "Couldn't reach the server. Tap Confirm again — if the sale already went through, it won't be charged twice.",
      );
    } finally {
      setCharging(false);
    }
  }

  return (
    <>
      {charging && <PinnerLoader />}
      <div className="mb-lg flex flex-wrap items-end justify-between gap-sm">
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
              {draft.map((line) => (
                <div
                  key={line.key}
                  className="group flex flex-wrap items-center gap-y-sm border-b border-surface-variant p-md transition-colors last:border-0 hover:bg-primary/5"
                >
                  <div className="min-w-[10rem] flex-1">
                    <div className="flex items-center gap-sm">
                      <span className="font-title-lg text-title-lg text-on-surface">{line.name}</span>
                      <span className="font-data-mono text-data-mono text-on-surface-variant">
                        {money(unitPrice(line))}
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
                  <div className="ml-auto flex items-center gap-sm md:gap-md">
                    <div className="flex items-center overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
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
                      {money(unitPrice(line) * line.qty)}
                    </span>
                    <button
                      onClick={() => removeLine(line.key)}
                      title="Remove item"
                      className="ml-sm flex items-center justify-center rounded-lg p-xs text-on-surface-variant transition-colors hover:bg-error-container/50 hover:text-error lg:opacity-0 lg:group-hover:opacity-100"
                    >
                      <Icon name="cancel" size={20} />
                    </button>
                  </div>
                </div>
              ))}
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
              onClick={openPayment}
              disabled={count === 0}
              className="flex w-full items-center justify-center gap-xs rounded-lg bg-primary py-md font-title-lg text-title-lg text-on-primary shadow-sm transition-all hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="point_of_sale" />
              Charge {count > 0 ? money(total) : ""}
            </button>
            <p className="mt-sm flex items-center justify-center gap-xs text-center font-body-md text-[12px] text-on-surface-variant">
              <Icon name="save" size={14} />
              Saved on this device — recorded only when charged.
            </p>
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

      {payOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-on-background/30 p-md backdrop-blur-sm"
          onClick={() => !charging && setPayOpen(false)}
        >
          <div
            className="flex w-full max-w-md flex-col rounded-2xl bg-surface-container-lowest shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-outline-variant px-lg py-md">
              <div>
                <h3 className="font-title-lg text-title-lg text-on-surface">Take Payment</h3>
                <p className="font-body-md text-[12px] text-on-surface-variant">
                  {count} item{count === 1 ? "" : "s"} · recorded on confirm
                </p>
              </div>
              <span className="font-display-lg text-[28px] font-bold leading-none text-primary">
                {money(total)}
              </span>
            </div>

            <div className="space-y-md px-lg py-md">
              <div
                className={`grid gap-sm ${
                  availableMethods.length === 1
                    ? "grid-cols-1"
                    : availableMethods.length === 2
                    ? "grid-cols-2"
                    : "grid-cols-3"
                }`}
              >
                {availableMethods.map(
                  (m) => {
                    const meta = METHOD_META[m];
                    const active = method === m;
                    return (
                      <button
                        key={m}
                        onClick={() => setMethod(m)}
                        className={`flex flex-col items-center gap-xs rounded-xl border px-sm py-md transition-all ${
                          active
                            ? "border-primary bg-primary-container/15 shadow-sm"
                            : "border-outline-variant hover:border-primary/60 hover:bg-surface-container-low"
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                            active ? "bg-primary text-on-primary" : "bg-surface-variant text-on-surface-variant"
                          }`}
                        >
                          <Icon name={meta.icon} size={20} fill={active} />
                        </div>
                        <span
                          className={`font-label-md text-[13px] font-semibold ${
                            active ? "text-primary" : "text-on-surface"
                          }`}
                        >
                          {meta.label}
                        </span>
                        <span className="text-center font-body-md text-[10px] leading-tight text-on-surface-variant">
                          {meta.desc}
                        </span>
                      </button>
                    );
                  },
                )}
              </div>

              {method === "cash" && (
                <div>
                  <label className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                    Amount Tendered
                  </label>
                  <div className="relative">
                    <span className="absolute left-md top-1/2 -translate-y-1/2 font-title-lg text-title-lg text-on-surface-variant">
                      {currencySymbol}
                    </span>
                    <input
                      value={tendered}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^\d*\.?\d*$/.test(v)) setTendered(v === "" ? "0" : v);
                      }}
                      onFocus={(e) => e.target.select()}
                      inputMode="decimal"
                      className="w-full rounded-xl border border-outline-variant bg-surface py-sm pl-xl pr-md text-right font-headline-md text-headline-md text-on-surface focus:border-primary focus:outline-none"
                    />
                  </div>
                  {change > 0 && (
                    <div className="mt-sm flex items-center justify-between rounded-lg bg-[#e8f5e9] px-md py-sm font-body-md text-body-md text-[#2e7d32]">
                      <span className="flex items-center gap-xs">
                        <Icon name="currency_exchange" size={16} /> Change Due
                      </span>
                      <span className="font-data-mono font-bold">{money(change)}</span>
                    </div>
                  )}
                </div>
              )}

              {chargeError && (
                <p className="font-body-md text-body-md text-error">{chargeError}</p>
              )}
            </div>

            <div className="flex gap-sm border-t border-outline-variant px-lg py-md">
              <button
                onClick={() => setPayOpen(false)}
                disabled={charging}
                className="flex-1 rounded-full border border-outline-variant py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-60"
              >
                Back
              </button>
              <button
                onClick={() => void handleCharge()}
                disabled={charging}
                className="flex flex-[2] items-center justify-center gap-xs rounded-full bg-[#2e7d32] py-sm font-label-md text-label-md uppercase tracking-wider text-white shadow-sm transition-all hover:bg-[#1b5e20] active:scale-[0.98] disabled:opacity-70"
              >
                {charging ? (
                  <Icon name="progress_activity" size={18} className="ag-spin" />
                ) : (
                  <Icon name="check_circle" size={18} fill />
                )}
                {charging ? "Charging…" : `Confirm ${METHOD_META[method].label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between font-body-md text-on-surface-variant">
      <span>{label}</span>
      <span className="font-data-mono">{value}</span>
    </div>
  );
}
