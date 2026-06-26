import { useSession } from "../context/SessionContext";
import { useBoot } from "../context/BootContext";
import { useMoney } from "../money";

/**
 * Terminal screen shown once the guest has settled (card captured / cash
 * confirmed) or while awaiting cash at the counter.
 *
 * Rendered ABOVE the router (see App.jsx) so it overrides whatever route the
 * phone's hardware back button lands on — a settled guest can never navigate
 * back into the ordering screens and re-trigger those flows.
 */
export default function SessionEndScreen() {
  const { billTotal, taxRate, tableNumber, sessionStartTime, awaitingCash, paidMethod, sessionCancelled } = useSession();
  const { tenant } = useBoot();
  const money = useMoney();
  const reviewLink = tenant?.theme?.reviewLink;

  const gst = billTotal * taxRate;
  const grandTotal = billTotal + gst;
  const startTime = sessionStartTime
    ? sessionStartTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--";

  // Staff cancelled this session — no payment is due. Shown above the router so
  // the guest can't navigate back into the (now dead) ordering/bill screens.
  if (sessionCancelled) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-5 fade-in">
        <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center">
          <span className="material-symbols-outlined text-[40px] text-on-surface-variant" style={{ fontVariationSettings: "'FILL' 1" }}>cancel</span>
        </div>
        <h2 className="text-[26px] font-bold text-on-surface font-serif">Order cancelled</h2>
        <p className="text-on-surface-variant text-[15px] max-w-xs">
          This order was cancelled by the restaurant, so no payment is due. If
          that’s unexpected, please ask a staff member — or scan the QR code
          again to start a new order.
        </p>
        <p className="text-[12px] text-on-surface-variant/70">Table {tableNumber}</p>
      </div>
    );
  }

  // Cash / UPI chosen — keep the guest here while staff confirm.
  if (awaitingCash) {
    const isUpi = paidMethod === "upi";
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-5 fade-in">
        <div className={`w-20 h-20 rounded-full flex items-center justify-center ${isUpi ? "bg-green-100" : "bg-primary-container"}`}>
          <span
            className={`material-symbols-outlined text-[40px] ${isUpi ? "text-green-700" : "text-on-primary-container"}`}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {isUpi ? "qr_code_2" : "payments"}
          </span>
        </div>
        <h2 className="text-[26px] font-bold text-on-surface font-serif">
          {isUpi ? "UPI Payment Sent!" : "Please pay at the counter"}
        </h2>
        <div className="bg-surface-container-lowest rounded-2xl p-5 w-full max-w-sm shadow-sm">
          <p className="text-[12px] text-on-surface-variant mb-1">
            {isUpi ? "Amount sent" : "Amount due"}
          </p>
          <p className="text-[32px] font-bold text-primary">{money(grandTotal)}</p>
          <p className="text-[12px] text-on-surface-variant mt-1">Table {tableNumber}</p>
        </div>
        <div className="flex items-center gap-2 text-on-surface-variant text-[14px]">
          <span className="material-symbols-outlined text-[18px] animate-spin" style={{ animationDuration: "2s" }}>progress_activity</span>
          {isUpi ? "Staff are verifying your UPI receipt…" : "Waiting for staff to confirm your payment…"}
        </div>
        <p className="text-[12px] text-on-surface-variant/70 max-w-xs">
          {isUpi
            ? "Your session stays open until our team confirms receipt. This screen updates automatically."
            : "Your session stays open until our team collects the cash. This screen updates automatically."}
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
        {paidMethod === "cash" ? "Paid at the counter — thank you!" : paidMethod === "upi" ? "UPI payment confirmed — thank you!" : "Payment confirmed online."}<br />
        Hope to see you again soon ☕
      </p>
      <div className="bg-surface-container-lowest rounded-2xl p-5 w-full max-w-sm shadow-sm">
        <p className="text-[12px] text-on-surface-variant mb-1">Total paid</p>
        <p className="text-[32px] font-bold text-primary">{money(grandTotal)}</p>
        <p className="text-[12px] text-on-surface-variant mt-1">Table {tableNumber} · Session started {startTime}</p>
      </div>
      {reviewLink ? (
        <a
          href={reviewLink}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col items-center gap-2 mt-2 group"
        >
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <span
                key={s}
                className="material-symbols-outlined text-[30px] text-secondary-fixed-dim transition-transform group-active:scale-110"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                star
              </span>
            ))}
          </div>
          <span className="text-[13px] font-semibold text-primary underline underline-offset-2">
            Rate your experience →
          </span>
        </a>
      ) : (
        <div className="flex flex-col items-center gap-2 mt-2">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <span
                key={s}
                className="material-symbols-outlined text-[30px] text-secondary-fixed-dim"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                star
              </span>
            ))}
          </div>
          <p className="text-[13px] text-on-surface-variant">Rate your experience</p>
        </div>
      )}
    </div>
  );
}
