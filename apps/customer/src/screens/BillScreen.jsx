import { useState } from "react";
import { useSession } from "../context/SessionContext";
import TopAppBar from "../components/TopAppBar";

const GST_RATE = 0.1;

export default function BillScreen() {
  const { rounds, billTotal, tableNumber, sessionStartTime, billRequested, requestBill, payBill, showToast } = useSession();
  const [payMethod, setPayMethod] = useState(null);
  const [processing, setProcessing] = useState(false);

  // "online" is recorded as a card payment server-side (methods are cash | card;
  // no separate online provider). Cash is NOT captured here — staff settle it at
  // the counter and the session ends once the admin marks the order paid.
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

  const gst = billTotal * GST_RATE;
  const grandTotal = billTotal + gst;

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
                const roundTotal = round.items.reduce((s, i) => s + i.price * i.qty, 0);
                return (
                  <div key={round.id} className="p-4">
                    <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold mb-3">
                      {round.type === "instant" ? "Instant" : `Round ${rounds.length - idx}`} · {time}
                    </p>
                    {round.items.map((item) => (
                      <div key={item.id} className="flex justify-between mb-1.5">
                        <div>
                          <p className="text-[14px] text-on-surface">{item.qty}× {item.name}</p>
                        </div>
                        <p className="text-[14px] font-semibold text-on-surface">${(item.price * item.qty).toFixed(2)}</p>
                      </div>
                    ))}
                    <div className="flex justify-between mt-2 pt-2 border-t border-surface-container/60">
                      <span className="text-[12px] text-on-surface-variant">Round total</span>
                      <span className="text-[12px] font-semibold text-on-surface-variant">${roundTotal.toFixed(2)}</span>
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
            <div className="flex justify-between text-on-surface-variant text-[14px]">
              <span>Subtotal</span><span>${billTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant text-[14px]">
              <span>GST (10%)</span><span>${gst.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-primary font-bold text-[22px] pt-1">
              <span>Total</span><span>${grandTotal.toFixed(2)}</span>
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
        ) : !payMethod ? (
          <div className="fade-in space-y-3">
            <div className="flex items-center gap-2 text-on-surface-variant text-[13px] justify-center mb-4">
              <span className="material-symbols-outlined text-[16px] animate-spin" style={{ animationDuration: "2s" }}>progress_activity</span>
              Bill requested · Staff on their way
            </div>
            <p className="text-center text-[14px] font-semibold text-on-surface mb-3">How would you like to pay?</p>
            <div className="flex gap-3">
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
