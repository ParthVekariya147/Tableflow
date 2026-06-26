import { useState } from "react";
import { useSession } from "../context/SessionContext";
import { useBoot } from "../context/BootContext";
import { useMoney } from "../money";
import TopAppBar from "../components/TopAppBar";

export default function BillScreen() {
  const { rounds, billTotal, taxRate, tableNumber, sessionStartTime, billRequested, requestBill, payBill, showToast } = useSession();
  const { tenant } = useBoot();
  const money = useMoney();
  const gstNumber = tenant?.gstNumber;
  const upiId = tenant?.upiId;
  const upiMobile = tenant?.upiMobile;
  const [payMethod, setPayMethod] = useState(null);
  const [showUpiPanel, setShowUpiPanel] = useState(false);
  const [processing, setProcessing] = useState(false);

  async function handlePay(method) {
    if (processing) return;
    setProcessing(true);
    setPayMethod(method);
    try {
      await payBill(method);
    } catch {
      showToast("Payment didn’t go through — please try again", "error");
      setPayMethod(null);
    } finally {
      setProcessing(false);
    }
  }

  async function handleRequestBill() {
    if (processing) return;
    setProcessing(true);
    try {
      await requestBill();
    } catch {
      showToast("Couldn’t reach staff — please try again", "wifi_off");
    } finally {
      setProcessing(false);
    }
  }

  const gst = billTotal * taxRate;
  const grandTotal = billTotal + gst;
  const taxPct = Math.round(taxRate * 100);

  // UPI deep link — amount in rupees (grandTotal is already in display units)
  const upiUrl = upiId
    ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(tenant?.name ?? "Restaurant")}&am=${grandTotal.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Table ${tableNumber} bill`)}`
    : null;

  const startTime = sessionStartTime
    ? sessionStartTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--";

  // Note: the settled ("Thanks for visiting") and awaiting-cash screens are
  // rendered above the router (SessionEndScreen in App.jsx) so the phone back
  // button can't escape them back into the order flow.

  return (
    <div className="min-h-screen pb-28">
      <TopAppBar title="Bill" />

      <main className="px-5 py-4 max-w-lg mx-auto">
        <div className="mb-4">
          <h2 className="text-[22px] font-bold text-on-surface font-serif">Your Bill</h2>
          <p className="text-[13px] text-on-surface-variant">Table {tableNumber} · Session started {startTime}</p>
        </div>

        {/* Receipt card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0px_4px_20px_rgba(26,26,26,0.05)] overflow-hidden mb-5">
          {rounds.length === 0 ? (
            <div className="p-8 text-center text-on-surface-variant text-[14px]">No orders yet this session.</div>
          ) : (
            <div className="divide-y divide-surface-container">
              {[...rounds].reverse().map((round, idx) => {
                const time = round.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                // Round total excludes cancelled lines, matching the grand total
                // (SessionContext.billTotal) and the server-captured amount.
                const roundTotal = round.items
                  .filter((i) => i.status !== "cancelled")
                  .reduce((s, i) => s + i.price * i.qty, 0);
                return (
                  <div key={round.id} className="p-4">
                    <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold mb-3">
                      {round.type === "instant" ? "Instant" : `Round ${rounds.length - idx}`} · {time}
                    </p>
                    {round.items.map((item) => {
                      const cancelled = item.status === "cancelled";
                      return (
                        <div key={item.lineKey ?? item.id} className="flex justify-between mb-1.5">
                          <div>
                            <p className={`text-[14px] ${cancelled ? "text-on-surface-variant line-through" : "text-on-surface"}`}>{item.qty}× {item.name}</p>
                            {item.modifiers?.length > 0 && (
                              <p className={`text-[11px] text-on-surface-variant ${cancelled ? "line-through" : ""}`}>
                                {item.modifiers.map((m) => (m.textValue ? `“${m.textValue}”` : m.name)).join(", ")}
                              </p>
                            )}
                          </div>
                          {cancelled ? (
                            <p className="text-[11px] font-bold uppercase tracking-wide text-red-700">Cancelled</p>
                          ) : (
                            <p className="text-[14px] font-semibold text-on-surface">{money(item.price * item.qty)}</p>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex justify-between mt-2 pt-2 border-t border-surface-container/60">
                      <span className="text-[12px] text-on-surface-variant">Round total</span>
                      <span className="text-[12px] font-semibold text-on-surface-variant">{money(roundTotal)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Dashed divider */}
          <div className="mx-4 dashed-divider text-on-surface" />

          {/* Totals */}
          <div className="p-4 space-y-2">
            {gstNumber && (
              <p className="text-[11px] text-on-surface-variant font-mono tracking-widest pb-1 border-b border-surface-container/60">
                GSTIN: {gstNumber}
              </p>
            )}
            <div className="flex justify-between text-on-surface-variant text-[14px]">
              <span>Subtotal</span><span>{money(billTotal)}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant text-[14px]">
              <span>GST ({taxPct}%)</span><span>{money(gst)}</span>
            </div>
            <div className="flex justify-between text-primary font-bold text-[22px] pt-1">
              <span>Total</span><span>{money(grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        {!billRequested ? (
          <button
            onClick={handleRequestBill}
            disabled={processing}
            className="w-full bg-primary text-on-primary font-bold py-4 rounded-full shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2 text-[16px] disabled:opacity-70"
          >
            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
            {processing ? "Requesting…" : "Request Bill"}
          </button>
        ) : showUpiPanel && upiUrl ? (
          /* ── UPI panel ─────────────────────────────────────────────── */
          <div className="fade-in space-y-4">
            <div className="flex items-center gap-2 text-on-surface-variant text-[13px] justify-center">
              <span className="material-symbols-outlined text-[16px] animate-spin" style={{ animationDuration: "2s" }}>progress_activity</span>
              Bill requested · Staff on their way
            </div>

            {/* Amount highlight */}
            <div className="rounded-2xl border border-primary/20 bg-primary-container/10 px-5 py-4 text-center">
              <p className="text-[11px] text-on-surface-variant uppercase tracking-wider mb-1">Pay exactly</p>
              <p className="text-[36px] font-bold text-primary leading-none">{money(grandTotal)}</p>
            </div>

            {/* UPI ID */}
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3">
              <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">UPI ID</p>
              <p className="text-[15px] font-semibold font-mono text-on-surface break-all">{upiId}</p>
              {upiMobile && (
                <p className="text-[12px] text-on-surface-variant mt-1">
                  <span className="material-symbols-outlined text-[12px] align-middle">phone</span>{" "}
                  {upiMobile}
                </p>
              )}
            </div>

            {/* Open in UPI app */}
            <a
              href={upiUrl}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-[15px] font-bold text-on-primary active:scale-[0.98] transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>qr_code_2</span>
              Open UPI App · Amount Pre-filled
            </a>

            {/* I've paid */}
            <button
              onClick={() => handlePay("upi")}
              disabled={processing}
              className="w-full rounded-2xl border-2 border-primary py-4 text-[15px] font-bold text-primary active:scale-[0.98] transition-transform disabled:opacity-70"
            >
              {processing ? "Confirming…" : "I've paid — notify staff"}
            </button>

            <button
              onClick={() => setShowUpiPanel(false)}
              className="w-full text-[13px] text-on-surface-variant text-center py-2"
            >
              ← Choose a different method
            </button>
          </div>
        ) : !payMethod ? (
          <div className="fade-in space-y-3">
            <div className="flex items-center gap-2 text-on-surface-variant text-[13px] justify-center mb-4">
              <span className="material-symbols-outlined text-[16px] animate-spin" style={{ animationDuration: "2s" }}>progress_activity</span>
              Bill requested · Staff on their way
            </div>
            <p className="text-center text-[14px] font-semibold text-on-surface mb-3">How would you like to pay?</p>
            <div className={`grid gap-3 ${upiId ? "grid-cols-3" : "grid-cols-2"}`}>
              <button
                onClick={() => handlePay("card")}
                disabled={processing}
                className="flex-1 bg-primary text-on-primary font-bold py-4 rounded-2xl flex flex-col items-center gap-1 active:scale-95 transition-transform disabled:opacity-70"
              >
                <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>contactless</span>
                <span className="text-[13px]">Pay Online</span>
              </button>
              <button
                onClick={() => handlePay("cash")}
                disabled={processing}
                className="flex-1 border-2 border-primary text-primary font-bold py-4 rounded-2xl flex flex-col items-center gap-1 active:scale-95 transition-transform disabled:opacity-70"
              >
                <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>payments</span>
                <span className="text-[13px]">Pay Cash</span>
              </button>
              {upiId && (
                <button
                  onClick={() => setShowUpiPanel(true)}
                  disabled={processing}
                  className="flex-1 border-2 border-primary text-primary font-bold py-4 rounded-2xl flex flex-col items-center gap-1 active:scale-95 transition-transform disabled:opacity-70"
                >
                  <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>qr_code_2</span>
                  <span className="text-[13px]">Pay UPI</span>
                </button>
              )}
            </div>
          </div>
        ) : null}

        <p className="text-center text-[12px] text-on-surface-variant/60 mt-5">
          Please proceed to the counter if you prefer to pay there.
        </p>
      </main>
    </div>
  );
}
