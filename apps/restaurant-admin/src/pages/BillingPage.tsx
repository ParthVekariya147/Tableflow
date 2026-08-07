import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { useTenant } from "@amber/ui";
import {
  enabledPaymentMethods,
  isModuleEnabled,
  isPaymentMethodEnabled,
  isPrintingEnabled,
  maxRedeemablePoints,
} from "@amber/domain";
import type { LoyaltyAccount } from "@amber/domain";
import { ApiError } from "@amber/api-client";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { buildReceipt } from "../lib/receipt";
import { printReceipt, type PrintResult } from "../lib/printAgent";
import { useAuth } from "../context/AuthContext";
import { useAdmin, billTotals, itemUnitPrice } from "../store/AdminStore";
import type { PaymentMethod } from "../data/types";

// ── Payment method config ─────────────────────────────────────────────────────
// All three are staff-recorded, not staff-collected: the guest has already
// paid (cash handed over, card tapped on the counter's own POS, UPI scanned
// from their own phone or the printed bill) before this screen opens. This
// panel's job is only to pick which method it was and confirm — never to
// re-collect it, so there is still no QR on this staff-only panel. The
// scan-to-pay QR belongs on guest-facing surfaces: the customer app's
// BillScreen and the "Print Bill" paper below (see printBill).
const METHOD_META: Record<PaymentMethod, { icon: string; label: string; desc: string }> = {
  cash: { icon: "payments", label: "Cash", desc: "Collect cash at the table" },
  card: { icon: "credit_card", label: "Card", desc: "Guest pays at POS / counter" },
  upi: { icon: "qr_code_2", label: "UPI", desc: "Confirm UPI received" },
};

export function BillingPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const {
    state,
    dispatch,
    refreshFloor,
    money,
    currencySymbol,
    error: storeError,
  } = useAdmin();
  const tenant = useTenant();
  const { user, setLastPaymentMethod } = useAuth();

  // Only tables/sales can differ on open (this table reused/paid/changed from
  // another device) — the light refresh skips re-fetching menu/tenant.
  useEffect(() => {
    refreshFloor().catch(() => {});
  }, [refreshFloor, id]);

  const table = state.tables.find((t) => t.id === id);
  const totals = useMemo(
    () => (table?.session ? billTotals(table.session.rounds, state.taxRate) : null),
    [table, state.taxRate],
  );

  // Defaults to whatever this staff member last completed a checkout with
  // (remembered server-side per-user); falls back to "cash" the very first
  // time, before any preference has been recorded.
  const [pickedMethod, setMethod] = useState<PaymentMethod>(
    user?.lastPaymentMethod ?? "cash",
  );
  // Tenders this restaurant accepts (Settings → Payments). Derived, not stored:
  // if the remembered method was since switched off, the selection falls back
  // to the first available one rather than leaving a dead panel selected.
  const availableMethods = enabledPaymentMethods(tenant.paymentMethods);
  const method: PaymentMethod = availableMethods.includes(pickedMethod)
    ? pickedMethod
    : availableMethods[0] ?? "cash";
  const [paying, setPaying] = useState(false);
  /** Set only after a failed settlement attempt — keeps staff on this screen
   *  with an explanation instead of silently showing a success page. */
  const [payError, setPayError] = useState<string | null>(null);
  // Once complete() has captured payment, the store's own refetch clears
  // table.session before complete()'s explicit navigate() to the receipt
  // page can run — without this flag, the render guard below wins that race
  // and bounces staff back to the floor instead of the print screen.
  const paidRef = useRef(false);
  const [tendered, setTendered] = useState<string>(() =>
    totals ? (totals.total / 100).toFixed(2) : "0.00",
  );

  // ── Pre-payment bill print ─────────────────────────────────────────────
  // Printing the bill BEFORE settling is the ONLY path that carries the
  // scan-to-pay UPI QR: both renderers drop that QR once a Payment row exists
  // (re-asking for money on a paid receipt invites a double payment), so the
  // post-payment receipt can never show it. This is the guest's copy — review
  // the lines, scan, pay — after which staff confirm below.
  const [printingBill, setPrintingBill] = useState(false);
  const [billPrintResult, setBillPrintResult] = useState<PrintResult | null>(null);
  const canPrintBill = isPrintingEnabled(tenant.printer);
  const upiOnBill =
    !!tenant.upiId && isPaymentMethodEnabled(tenant.paymentMethods, "upi");

  // ── Loyalty (staff-only; no guest-facing surface) ──────────────────────
  // Module-gated: with loyalty switched off, checkout never fetches an account
  // and never renders the redeem panel. An ALREADY-APPLIED discount still shows
  // in the totals below — hiding a line that is subtracted from the amount due
  // would make the printed bill fail to add up.
  const loyaltyOn = isModuleEnabled(tenant, "loyalty");
  const orderId = table?.session?.orderId;
  const [loyaltyAccountId, setLoyaltyAccountId] = useState<string | undefined>();
  const [pointsRedeemed, setPointsRedeemed] = useState(0);
  const [redemptionDiscount, setRedemptionDiscount] = useState(0);
  const [loyaltyAccount, setLoyaltyAccount] = useState<LoyaltyAccount | null>(null);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId || !loyaltyOn) return;
    let active = true;
    api.orders
      .get(orderId)
      .then((order) => {
        if (!active) return;
        setLoyaltyAccountId(order.loyaltyAccountId);
        setPointsRedeemed(order.pointsRedeemed ?? 0);
        setRedemptionDiscount(order.redemptionValueMinor ?? 0);
        if (order.loyaltyAccountId) {
          api.loyalty.accounts
            .get(order.loyaltyAccountId)
            .then(({ account }) => active && setLoyaltyAccount(account))
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [orderId, loyaltyOn]);

  if (!table) {
    return <Navigate to="/tables" replace />;
  }
  if (paidRef.current) {
    // complete() has captured payment and is about to navigate to the
    // receipt/print page — render nothing rather than either the redirect
    // below (table.session is already gone) or the billing UI (which
    // assumes it still exists).
    return null;
  }
  if (!table.session || !totals) {
    return <Navigate to="/tables" replace />;
  }

  const activeTable = table;
  // Post-redemption totals — what the server will actually charge (matches
  // OrdersService.capturePayment's discount-then-tax computation) so staff
  // don't ask the guest for the pre-discount amount.
  const discountedSubtotal = Math.max(0, totals.subtotal - redemptionDiscount);
  const bill = {
    subtotal: discountedSubtotal,
    tax: Math.round(discountedSubtotal * state.taxRate),
    total: discountedSubtotal + Math.round(discountedSubtotal * state.taxRate),
  };

  const maxPoints = loyaltyAccount
    ? maxRedeemablePoints(totals.subtotal, loyaltyAccount.pointsBalance, tenant.loyalty)
    : 0;

  async function applyRedeem(points: number) {
    if (!orderId) return;
    setRedeemBusy(true);
    setRedeemError(null);
    try {
      const order = await api.orders.redeemPoints(orderId, points);
      setPointsRedeemed(order.pointsRedeemed ?? 0);
      setRedemptionDiscount(order.redemptionValueMinor ?? 0);
      setRedeemInput("");
    } catch (e) {
      setRedeemError(e instanceof ApiError ? e.message : "Couldn't apply points");
    } finally {
      setRedeemBusy(false);
    }
  }

  const lineItems = table.session.rounds.map((round, idx) => ({
    idx: idx + 1,
    type: round.type,
    items: round.items.filter((i) => i.status !== "cancelled"),
  }));

  const gratuity = Math.round(bill.subtotal * 0.2);
  const tenderedCents = Math.round((parseFloat(tendered) || 0) * 100);
  const change = method === "cash" ? Math.max(0, tenderedCents - bill.total) : 0;

  function pad(key: string) {
    setTendered((cur) => {
      if (key === "del") return cur.slice(0, -1) || "0";
      if (key === "." && cur.includes(".")) return cur;
      const next = cur === "0" && key !== "." ? key : cur + key;
      return next;
    });
  }

  /**
   * Prints the unsettled bill for the guest. Rebuilt from the API (not the
   * store's view model) so the paper carries the same statutory header, guest
   * details and line detail as the final receipt — and re-reads the tenant so
   * a UPI id or layout change made minutes ago is on this print.
   *
   * Never touches payment state: nothing is captured, the table stays open.
   */
  async function printBill() {
    if (printingBill) return;
    const oid = activeTable.session?.orderId;
    if (!oid) return;
    setPrintingBill(true);
    setBillPrintResult(null);
    try {
      const [freshTenant, order] = await Promise.all([
        api.tenant.current(),
        api.orders.get(oid),
      ]);
      const receipt = buildReceipt({
        orderId: oid,
        tableId: activeTable.id,
        tableLabel: activeTable.label,
        tenant: freshTenant,
        order,
        // No Payment row — this is what makes the paper print "TOTAL DUE" and
        // the UPI QR rather than claiming the bill was paid.
        payment: null,
        // The post-redemption amounts staff are looking at, so the QR asks for
        // exactly the number on screen.
        bill,
      });
      setBillPrintResult(await printReceipt(freshTenant.printer, receipt));
    } catch {
      setBillPrintResult({
        ok: false,
        reason: "config",
        message: "Couldn't load the bill for printing. The table is untouched.",
      });
    } finally {
      setPrintingBill(false);
    }
  }

  async function complete() {
    // Duplicate-submit guard: `paying` is set synchronously before the first
    // await, so a double-tap (or an Enter key repeat) can't fire a second
    // capture while one is in flight.
    if (paying) return;
    setPaying(true);
    setPayError(null);
    // Capture the order id BEFORE settling — a successful payment clears
    // `table.session`, so reading it afterwards would yield undefined and drop
    // the ?order= param the receipt page needs to rebuild the receipt.
    const orderId = activeTable.session?.orderId;

    const ok = await dispatch({
      type: "COMPLETE_PAYMENT",
      tableId: activeTable.id,
      method,
      amountCents: bill.total,
      tenderedCents: method === "cash" ? tenderedCents : undefined,
    });

    // The session is NEVER marked complete locally on anything but a
    // server-confirmed settlement. On failure staff stay right here, with the
    // bill intact and the button re-armed, so they can retry without a reload.
    if (!ok) {
      setPayError(
        storeError ??
          "The payment could not be completed. Nothing was charged — please try again.",
      );
      setPaying(false);
      return;
    }

    // Only now is the checkout terminal: block the render guard's redirect and
    // move to the receipt screen.
    paidRef.current = true;
    // Remember this as the default for next time. Fire-and-forget — a failed
    // preference save shouldn't hold up navigating to the receipt/print page.
    setLastPaymentMethod(method).catch(() => {});
    navigate(
      `/tables/${activeTable.id}/complete${orderId ? `?order=${encodeURIComponent(orderId)}` : ""}`,
      { state: { method, totalCents: bill.total, tableLabel: activeTable.label } },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-xl">
      <div className="grid w-full max-w-[1100px] grid-cols-1 gap-xl md:grid-cols-2">

        {/* ── Receipt panel ─────────────────────────────────────────────────── */}
        <section className="flex h-[640px] flex-col rounded-2xl bg-surface-container-lowest shadow-card">
          {/* Header */}
          <div className="flex items-center justify-between rounded-t-2xl border-b border-outline-variant bg-surface-container-low px-lg py-md">
            <div className="flex items-center gap-sm">
              <button
                onClick={() => navigate(`/tables/${table.id}`)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container"
              >
                <Icon name="arrow_back" />
              </button>
              <div>
                <h2 className="font-title-lg text-title-lg text-primary">{table.label}</h2>
                <p className="font-body-md text-[11px] text-on-surface-variant">
                  Checkout · #{table.id.slice(-6).toUpperCase()}
                </p>
              </div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon name="receipt_long" size={20} />
            </div>
          </div>

          {/* Line items */}
          <div className="flex-1 overflow-y-auto px-lg py-md">
            {lineItems.map((round) => (
              <div key={round.idx} className="mb-lg">
                <p className="mb-sm font-label-md text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Round {round.idx} · {round.type === "instant" ? "Bring it" : "Bring these"}
                </p>
                {round.items.map((i) => (
                  <div key={i.id} className="py-xs">
                    <div className="flex items-baseline justify-between font-body-md text-body-md text-on-surface">
                      <span>
                        <span className="font-data-mono text-on-surface-variant">{i.qty}×</span>{" "}
                        {i.name}
                      </span>
                      <span className="font-data-mono">{money(itemUnitPrice(i) * i.qty)}</span>
                    </div>
                    {i.modifiers && i.modifiers.length > 0 && (
                      <p className="pl-lg font-body-md text-[11px] text-on-surface-variant">
                        {i.modifiers.map((m) => (m.textValue ? `"${m.textValue}"` : m.name)).join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="rounded-b-2xl border-t border-outline-variant bg-surface-container-low px-lg py-md">
            {state.gstNumber && (
              <p className="mb-xs font-data-mono text-[11px] text-on-surface-variant">
                GST: {state.gstNumber}
              </p>
            )}
            <Line label="Subtotal" value={money(totals.subtotal)} />
            {redemptionDiscount > 0 && (
              <Line
                label={`Loyalty discount (${pointsRedeemed} pts)`}
                value={`-${money(redemptionDiscount)}`}
              />
            )}
            <Line label={`Tax (${(state.taxRate * 100).toFixed(1)}%)`} value={money(bill.tax)} />
            <Line label="Suggested gratuity (20%)" value={money(gratuity)} muted />
            <div className="mt-sm flex items-baseline justify-between border-t border-outline-variant pt-md">
              <span className="font-title-lg text-title-lg text-on-surface">Total Due</span>
              <span className="font-display-lg text-[32px] font-bold leading-none text-primary">
                {money(bill.total)}
              </span>
            </div>
          </div>

          {/* Loyalty — staff-only, applied on the guest's behalf (no guest UI). */}
          {loyaltyOn && loyaltyAccountId && (
            <div className="border-t border-outline-variant px-lg py-md">
              <p className="mb-sm font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
                Loyalty
              </p>
              {loyaltyAccount ? (
                <div className="space-y-sm">
                  <div className="flex items-center justify-between font-body-md text-body-md text-on-surface">
                    <span className="text-on-surface-variant">{loyaltyAccount.phone}</span>
                    <span className="font-data-mono">{loyaltyAccount.pointsBalance} pts</span>
                  </div>
                  {redeemError && (
                    <p className="font-body-md text-[12px] text-error">{redeemError}</p>
                  )}
                  {pointsRedeemed > 0 ? (
                    <button
                      onClick={() => applyRedeem(0)}
                      disabled={redeemBusy}
                      className="rounded-full border border-outline-variant px-md py-1 font-label-md text-[12px] text-on-surface-variant transition-colors hover:bg-surface-container disabled:opacity-60"
                    >
                      Clear redemption
                    </button>
                  ) : maxPoints > 0 ? (
                    <div className="flex items-center gap-sm">
                      <input
                        value={redeemInput}
                        onChange={(e) => setRedeemInput(e.target.value.replace(/\D/g, ""))}
                        placeholder={`Up to ${maxPoints}`}
                        inputMode="numeric"
                        className="w-24 rounded-lg border border-outline-variant bg-surface px-sm py-1 font-data-mono text-[13px] text-on-surface focus:border-primary focus:outline-none"
                      />
                      <button
                        onClick={() => applyRedeem(Number(redeemInput) || 0)}
                        disabled={redeemBusy || !Number(redeemInput)}
                        className="rounded-full border border-outline-variant px-md py-1 font-label-md text-[12px] text-on-surface transition-colors hover:bg-surface-container disabled:opacity-60"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => applyRedeem(maxPoints)}
                        disabled={redeemBusy}
                        className="rounded-full bg-primary-container/20 px-md py-1 font-label-md text-[12px] text-primary transition-colors hover:bg-primary-container/30 disabled:opacity-60"
                      >
                        Use max ({maxPoints})
                      </button>
                    </div>
                  ) : (
                    <p className="font-body-md text-[12px] text-on-surface-variant">
                      Not enough points to redeem yet.
                    </p>
                  )}
                </div>
              ) : (
                <p className="flex items-center gap-xs font-body-md text-[12px] text-on-surface-variant">
                  <Icon name="progress_activity" size={14} className="ag-spin" /> Loading…
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── Payment panel ─────────────────────────────────────────────────── */}
        <section className="flex h-[640px] flex-col rounded-2xl bg-surface-container-lowest shadow-card">
          {/* Method selector */}
          <div className="border-b border-outline-variant px-lg py-md">
            <p className="mb-sm font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
              Payment Method
            </p>
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
                      className={`relative flex flex-col items-center gap-xs rounded-xl border px-sm py-md transition-all ${
                        active
                          ? "border-primary bg-primary-container/15 shadow-sm"
                          : "border-outline-variant hover:border-primary/60 hover:bg-surface-container-low"
                      }`}
                    >
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                          active ? "bg-primary text-on-primary" : "bg-surface-variant text-on-surface-variant"
                        }`}
                      >
                        <Icon name={meta.icon} size={22} fill={active} />
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
                      {active && (
                        <span className="absolute right-xs top-xs flex h-4 w-4 items-center justify-center rounded-full bg-primary text-on-primary">
                          <Icon name="check" size={12} />
                        </span>
                      )}
                    </button>
                  );
                },
              )}
            </div>
          </div>

          {/* Method body */}
          <div className="flex flex-1 flex-col overflow-hidden px-lg py-md">
            {/* ── Cash ── */}
            {method === "cash" && (
              <div className="flex flex-1 flex-col">
                <label className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                  Amount Tendered
                </label>
                <div className="relative mb-md">
                  <span className="absolute left-md top-1/2 -translate-y-1/2 font-headline-md text-headline-md text-on-surface-variant">
                    {currencySymbol}
                  </span>
                  <input
                    value={tendered}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Allow digits + single decimal point only
                      if (/^\d*\.?\d*$/.test(v)) setTendered(v === "" ? "0" : v);
                    }}
                    onFocus={(e) => e.target.select()}
                    inputMode="decimal"
                    className="w-full rounded-xl border border-outline-variant bg-surface py-sm pl-xl pr-md text-right font-headline-md text-headline-md text-on-surface focus:border-primary focus:outline-none"
                  />
                </div>
                {change > 0 && (
                  <div className="mb-sm flex items-center justify-between rounded-lg bg-[#e8f5e9] px-md py-sm font-body-md text-body-md text-[#2e7d32]">
                    <span className="flex items-center gap-xs">
                      <Icon name="currency_exchange" size={16} /> Change Due
                    </span>
                    <span className="font-data-mono font-bold">{money(change)}</span>
                  </div>
                )}
                <div className="mb-auto grid grid-cols-3 gap-xs">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => (
                    <button
                      key={k}
                      onClick={() => pad(k)}
                      className="flex items-center justify-center rounded-xl bg-surface-container-low py-md font-headline-md text-headline-md text-on-surface transition-colors hover:bg-surface-variant active:scale-95"
                    >
                      {k === "del" ? <Icon name="backspace" fill /> : k}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Card / UPI — both already collected elsewhere (POS terminal /
                the counter's own UPI QR); this screen only records which one
                and confirms. ── */}
            {method === "card" && (
              <CollectPanel
                icon="contactless"
                title="Card Payment"
                desc="Direct the guest to your POS terminal or card reader."
                amount={money(bill.total)}
              />
            )}
            {method === "upi" && (
              <CollectPanel
                icon="qr_code_2"
                title="UPI Payment"
                desc="Guest has already paid via UPI at the counter."
                amount={money(bill.total)}
              />
            )}
          </div>

          {/* Confirm button */}
          <div className="border-t border-outline-variant px-lg py-md">
            {payError && (
              <div
                role="alert"
                className="mb-sm flex items-start gap-xs rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container"
              >
                <Icon name="error" size={18} fill className="mt-[1px] shrink-0" />
                <span>
                  {payError}{" "}
                  <span className="font-semibold">The table is still open.</span>
                </span>
              </div>
            )}
            {canPrintBill && (
              <>
                {billPrintResult && !billPrintResult.ok && (
                  <div
                    role="alert"
                    className="mb-sm flex items-start gap-xs rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container"
                  >
                    <Icon name="print_disabled" size={18} fill className="mt-[1px] shrink-0" />
                    <span>{billPrintResult.message}</span>
                  </div>
                )}
                {billPrintResult?.ok && (
                  <p className="mb-sm flex items-center gap-xs font-body-md text-body-md text-on-surface-variant">
                    <Icon name="check_circle" size={16} fill className="shrink-0 text-[#2e7d32]" />
                    Bill printed
                    {upiOnBill && " — the guest can scan the UPI QR to pay"}
                  </p>
                )}
                <button
                  onClick={printBill}
                  disabled={printingBill || paying}
                  className="mb-sm flex w-full items-center justify-center gap-sm rounded-full border border-primary bg-transparent py-sm font-label-md text-label-md text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                >
                  <Icon
                    name={printingBill ? "progress_activity" : upiOnBill ? "qr_code_2" : "print"}
                    size={18}
                    className={printingBill ? "ag-spin" : ""}
                  />
                  {printingBill
                    ? "Printing…"
                    : upiOnBill
                    ? "Print Bill with UPI QR"
                    : "Print Bill"}
                </button>
              </>
            )}
            <button
              onClick={complete}
              disabled={paying}
              className="flex w-full items-center justify-center gap-sm rounded-full bg-[#2e7d32] py-md font-label-md text-label-md uppercase tracking-wider text-white shadow-sm transition-all hover:bg-[#1b5e20] active:scale-[0.98] disabled:opacity-70"
            >
              {paying ? (
                <Icon name="progress_activity" size={18} className="ag-spin" />
              ) : (
                <Icon name="check_circle" size={18} fill />
              )}
              {paying
                ? "Processing…"
                : method === "upi"
                ? "Confirm Receipt & Close Table"
                : method === "cash"
                ? "Mark Paid & Complete Session"
                : "Card Collected — Complete Session"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function CollectPanel({
  icon,
  title,
  desc,
  amount,
}: {
  icon: string;
  title: string;
  desc: string;
  amount: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-lg">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/20 text-primary">
        <Icon name={icon} size={40} fill />
      </div>
      <div className="text-center">
        <p className="mb-xs font-title-lg text-title-lg text-on-surface">{title}</p>
        <p className="font-body-md text-body-md text-on-surface-variant">{desc}</p>
      </div>
      <div className="rounded-2xl border border-primary/20 bg-primary-container/10 px-xl py-lg text-center">
        <p className="mb-xs font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
          Amount to collect
        </p>
        <p className="font-display-lg text-[40px] font-bold leading-none text-primary">{amount}</p>
      </div>
    </div>
  );
}

function Line({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      className={`flex justify-between py-[2px] font-body-md text-body-md ${
        muted ? "text-on-surface-variant/60" : "text-on-surface-variant"
      }`}
    >
      <span>{label}</span>
      <span className="font-data-mono">{value}</span>
    </div>
  );
}
