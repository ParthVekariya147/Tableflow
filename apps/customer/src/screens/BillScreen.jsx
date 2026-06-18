import { useState } from "react";
import { useSession } from "../context/SessionContext";
import TopAppBar from "../components/TopAppBar";

const GST_RATE = 0.1;

export default function BillScreen() {
  const { rounds, billTotal, tableNumber, sessionStartTime, billRequested, setBillRequested } = useSession();
  const [paid, setPaid] = useState(false);
  const [payMethod, setPayMethod] = useState(null);

  const gst = billTotal * GST_RATE;
  const grandTotal = billTotal + gst;

  const startTime = sessionStartTime
    ? sessionStartTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--";

  if (paid) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-5 fade-in">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
          <span className="material-symbols-outlined text-[40px] text-green-700" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <h2 className="text-[28px] font-bold text-on-surface font-serif">Thanks for visiting!</h2>
        <p className="text-on-surface-variant text-[15px]">
          {payMethod === "online" ? "Payment confirmed online." : "Please settle at the counter."}<br />
          Hope to see you again soon ☕
        </p>
        <div className="bg-surface-container-lowest rounded-2xl p-5 w-full max-w-sm shadow-sm">
          <p className="text-[12px] text-on-surface-variant mb-1">Total paid</p>
          <p className="text-[32px] font-bold text-primary">${grandTotal.toFixed(2)}</p>
          <p className="text-[12px] text-on-surface-variant mt-1">Table {tableNumber} · Session started {startTime}</p>
        </div>
        <div className="flex gap-2 mt-2">
          {[1,2,3,4,5].map(s => (
            <span key={s} className="material-symbols-outlined text-[28px] text-secondary-fixed-dim" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
          ))}
        </div>
        <p className="text-[13px] text-on-surface-variant">Rate your experience</p>
      </div>
    );
  }

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
            onClick={() => setBillRequested(true)}
            className="w-full bg-primary text-on-primary font-bold py-4 rounded-full shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2 text-[16px]"
          >
            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
            Request Bill
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
                onClick={() => { setPayMethod("online"); setPaid(true); }}
                className="flex-1 bg-primary text-on-primary font-bold py-4 rounded-2xl flex flex-col items-center gap-1 active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>contactless</span>
                <span className="text-[13px]">Pay Online</span>
              </button>
              <button
                onClick={() => { setPayMethod("cash"); setPaid(true); }}
                className="flex-1 border-2 border-primary text-primary font-bold py-4 rounded-2xl flex flex-col items-center gap-1 active:scale-95 transition-transform"
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
