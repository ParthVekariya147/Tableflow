import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { Icon } from "../components/Icon";
import { useAdmin, billTotals } from "../store/AdminStore";
import type { PaymentMethod } from "../data/types";

// ── UPI deep-link builder ─────────────────────────────────────────────────────

function buildUpiUrl({
  upiId,
  name,
  amount,
  note,
}: {
  upiId: string;
  name: string;
  amount: number; // in rupees (decimal)
  note: string;
}) {
  // `pa` (the UPI VPA) must NOT be percent-encoded — the @ must stay literal
  // or UPI apps reject the QR as invalid. Only pn/tn (human text) are encoded.
  return `upi://pay?pa=${upiId}&pn=${encodeURIComponent(name)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
}

// ── Payment method config ─────────────────────────────────────────────────────

const METHOD_META: Record<PaymentMethod, { icon: string; label: string; desc: string }> = {
  cash: { icon: "payments", label: "Cash", desc: "Collect cash at the table" },
  card: { icon: "credit_card", label: "Card", desc: "Guest pays at POS / counter" },
  upi: { icon: "qr_code_2", label: "UPI", desc: "Scan QR · instant transfer" },
};

export function BillingPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, refresh, money, currencySymbol } = useAdmin();

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh, id]);

  const table = state.tables.find((t) => t.id === id);
  const totals = useMemo(
    () => (table?.session ? billTotals(table.session.rounds, state.taxRate) : null),
    [table, state.taxRate],
  );

  // Default to UPI if the tenant has it configured, otherwise cash
  const defaultMethod: PaymentMethod = state.upiId ? "upi" : "cash";
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod);
  const [paying, setPaying] = useState(false);
  const [tendered, setTendered] = useState<string>(() =>
    totals ? (totals.total / 100).toFixed(2) : "0.00",
  );
  const [upiCopied, setUpiCopied] = useState(false);

  if (!table || !table.session || !totals) {
    return <Navigate to="/tables" replace />;
  }

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
  const totalRupees = totals.total / 100;

  // UPI deep link (amount in minor → rupees for the URL)
  const upiUrl = state.upiId
    ? buildUpiUrl({
        upiId: state.upiId,
        name: state.tenantName ?? "Restaurant",
        amount: totalRupees,
        note: `${table.label} bill`,
      })
    : null;

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
    setPaying(true);
    await dispatch({ type: "COMPLETE_PAYMENT", tableId: activeTable.id, method, amountCents: bill.total });
    navigate(`/tables/${activeTable.id}/complete`, {
      state: { method, totalCents: bill.total, tableLabel: activeTable.label },
    });
  }

  async function copyUpiId() {
    if (!state.upiId) return;
    await navigator.clipboard.writeText(state.upiId).catch(() => {});
    setUpiCopied(true);
    setTimeout(() => setUpiCopied(false), 2000);
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
                  <div
                    key={i.id}
                    className="flex items-baseline justify-between py-xs font-body-md text-body-md text-on-surface"
                  >
                    <span>
                      <span className="font-data-mono text-on-surface-variant">{i.qty}×</span>{" "}
                      {i.name}
                    </span>
                    <span className="font-data-mono">{money(i.priceCents * i.qty)}</span>
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
            <Line label={`Tax (${(state.taxRate * 100).toFixed(1)}%)`} value={money(totals.tax)} />
            <Line label="Suggested gratuity (20%)" value={money(gratuity)} muted />
            <div className="mt-sm flex items-baseline justify-between border-t border-outline-variant pt-md">
              <span className="font-title-lg text-title-lg text-on-surface">Total Due</span>
              <span className="font-display-lg text-[32px] font-bold leading-none text-primary">
                {money(totals.total)}
              </span>
            </div>
          </div>
        </section>

        {/* ── Payment panel ─────────────────────────────────────────────────── */}
        <section className="flex h-[640px] flex-col rounded-2xl bg-surface-container-lowest shadow-card">
          {/* Method selector */}
          <div className="border-b border-outline-variant px-lg py-md">
            <p className="mb-sm font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
              Payment Method
            </p>
            <div className="grid grid-cols-3 gap-sm">
              {(Object.entries(METHOD_META) as [PaymentMethod, typeof METHOD_META[PaymentMethod]][]).map(
                ([m, meta]) => {
                  const isUpi = m === "upi";
                  const unavailable = isUpi && !state.upiId;
                  const active = method === m;
                  return (
                    <button
                      key={m}
                      onClick={() => !unavailable && setMethod(m)}
                      disabled={unavailable}
                      title={unavailable ? "Configure UPI in Settings → Payments" : undefined}
                      className={`relative flex flex-col items-center gap-xs rounded-xl border px-sm py-md transition-all ${
                        active
                          ? "border-primary bg-primary-container/15 shadow-sm"
                          : unavailable
                          ? "cursor-not-allowed border-outline-variant opacity-40"
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
                        {unavailable ? "Not configured" : meta.desc}
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

            {/* ── Card ── */}
            {method === "card" && (
              <div className="flex flex-1 flex-col items-center justify-center gap-lg">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/20 text-primary">
                  <Icon name="contactless" size={40} fill />
                </div>
                <div className="text-center">
                  <p className="mb-xs font-title-lg text-title-lg text-on-surface">Card Payment</p>
                  <p className="font-body-md text-body-md text-on-surface-variant">
                    Direct the guest to your POS terminal or card reader.
                  </p>
                </div>
                <div className="rounded-2xl border border-primary/20 bg-primary-container/10 px-xl py-lg text-center">
                  <p className="mb-xs font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                    Amount to collect
                  </p>
                  <p className="font-display-lg text-[40px] font-bold leading-none text-primary">
                    {money(totals.total)}
                  </p>
                </div>
              </div>
            )}

            {/* ── UPI ── */}
            {method === "upi" && state.upiId && upiUrl && (
              <div className="flex flex-1 flex-col items-center justify-between gap-md overflow-y-auto">
                {/* Amount pill */}
                <div className="w-full rounded-xl border border-primary/20 bg-primary-container/10 px-md py-sm text-center">
                  <p className="font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
                    Payable Amount
                  </p>
                  <p className="font-display-lg text-[36px] font-bold leading-none text-primary">
                    {money(totals.total)}
                  </p>
                </div>

                {/* QR + details */}
                <div className="flex flex-col items-center gap-md">
                  {/* QR code */}
                  <div className="relative">
                    <div className="rounded-2xl border-2 border-primary/20 bg-white p-md shadow-md">
                      <QRCodeCanvas
                        value={upiUrl}
                        size={200}
                        level="M"
                        includeMargin={true}
                      />
                    </div>
                    {/* UPI badge */}
                    <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-outline-variant bg-surface px-md py-[3px] font-data-mono text-[10px] font-bold uppercase tracking-wider text-primary shadow-sm">
                      UPI
                    </div>
                  </div>

                  {/* UPI ID row */}
                  <div className="flex w-full items-center justify-between gap-sm rounded-xl border border-outline-variant bg-surface-container-low px-md py-sm">
                    <div className="min-w-0">
                      <p className="font-label-md text-[10px] uppercase tracking-wider text-on-surface-variant">
                        UPI ID
                      </p>
                      <p className="truncate font-data-mono text-[13px] font-semibold text-on-surface">
                        {state.upiId}
                      </p>
                    </div>
                    <button
                      onClick={copyUpiId}
                      className="flex shrink-0 items-center gap-xs rounded-full border border-outline-variant px-sm py-1 font-label-md text-[11px] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                    >
                      <Icon name={upiCopied ? "check" : "content_copy"} size={14} />
                      {upiCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>

                  {state.upiMobile && (
                    <p className="font-body-md text-[12px] text-on-surface-variant">
                      <Icon name="phone" size={13} className="mr-xs inline-block align-middle" />
                      {state.upiMobile}
                    </p>
                  )}
                </div>

                {/* Open in UPI App button */}
                <a
                  href={upiUrl}
                  className="flex w-full items-center justify-center gap-sm rounded-xl border border-primary/40 bg-primary-container/15 px-md py-sm font-label-md text-label-md text-primary transition-colors hover:bg-primary-container/30"
                >
                  <Icon name="open_in_new" size={16} />
                  Open in UPI App (GPay / PhonePe / Paytm)
                </a>

                <p className="text-center font-body-md text-[11px] text-on-surface-variant">
                  Ask the guest to scan with any UPI app. Amount is pre-filled.{" "}
                  Confirm receipt, then tap Mark Paid below.
                </p>
              </div>
            )}
          </div>

          {/* Confirm button */}
          <div className="border-t border-outline-variant px-lg py-md">
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
