import { useSession } from "../context/SessionContext";

const GST_RATE = 0.1;

/**
 * Terminal screen shown once the guest has settled (card captured / cash
 * confirmed) or while awaiting cash at the counter.
 *
 * Rendered ABOVE the router (see App.jsx) so it overrides whatever route the
 * phone's hardware back button lands on — a settled guest can never navigate
 * back into the ordering screens and re-trigger those flows.
 */
export default function SessionEndScreen() {
  const { billTotal, tableNumber, sessionStartTime, awaitingCash, paidMethod } = useSession();

  const gst = billTotal * GST_RATE;
  const grandTotal = billTotal + gst;
  const startTime = sessionStartTime
    ? sessionStartTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--";

  // Cash chosen — keep the guest here while staff collect & confirm at the counter.
  if (awaitingCash) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-5 fade-in">
        <div className="w-20 h-20 rounded-full bg-primary-container flex items-center justify-center">
          <span className="material-symbols-outlined text-[40px] text-on-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>payments</span>
        </div>
        <h2 className="text-[26px] font-bold text-on-surface font-serif">Please pay at the counter</h2>
        <div className="bg-surface-container-lowest rounded-2xl p-5 w-full max-w-sm shadow-sm">
          <p className="text-[12px] text-on-surface-variant mb-1">Amount due</p>
          <p className="text-[32px] font-bold text-primary">${grandTotal.toFixed(2)}</p>
          <p className="text-[12px] text-on-surface-variant mt-1">Table {tableNumber}</p>
        </div>
        <div className="flex items-center gap-2 text-on-surface-variant text-[14px]">
          <span className="material-symbols-outlined text-[18px] animate-spin" style={{ animationDuration: "2s" }}>progress_activity</span>
          Waiting for staff to confirm your payment…
        </div>
        <p className="text-[12px] text-on-surface-variant/70 max-w-xs">
          Your session stays open until our team collects the cash. This screen updates automatically.
        </p>
      </div>
    );
  }

  // Session settled — card captured here, or cash confirmed by staff at the counter.
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-5 fade-in">
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
        <span className="material-symbols-outlined text-[40px] text-green-700" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
      </div>
      <h2 className="text-[28px] font-bold text-on-surface font-serif">Thanks for visiting!</h2>
      <p className="text-on-surface-variant text-[15px]">
        {paidMethod === "cash" ? "Paid at the counter — thank you!" : "Payment confirmed online."}<br />
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
