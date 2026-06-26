import { useState } from "react";

/**
 * Full-screen states for the QR bootstrap (before a session exists). These
 * render with the baseline theme (the tenant isn't resolved yet on loading /
 * invalid), so they stick to neutral tokens.
 */

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-background max-w-md mx-auto flex flex-col items-center justify-center px-6 py-10 text-center gap-4">
      {children}
    </div>
  );
}

/** Shown while we resolve tenant + table + occupancy. */
export function BootSplash({ label = "Setting your table…" }) {
  return (
    <Shell>
      <span className="material-symbols-outlined text-[40px] text-primary animate-spin">
        progress_activity
      </span>
      <p className="text-on-surface-variant text-[15px]">{label}</p>
    </Shell>
  );
}

/** Bad / unknown QR — the token didn't resolve to a tenant or table. */
export function InvalidQr({ reason }) {
  return (
    <Shell>
      <span className="material-symbols-outlined text-[48px] text-error">
        qr_code_scanner
      </span>
      <h1 className="text-[22px] font-bold text-on-surface font-serif">
        This code didn’t work
      </h1>
      <p className="text-on-surface-variant text-[15px] leading-relaxed">
        {reason ?? "We couldn’t find that table. Ask a staff member for help."}
      </p>
    </Shell>
  );
}

/**
 * Terminal screen for a device whose session has already been settled. After
 * paying, a refresh must NOT drop back into the ordering flow — the device can
 * only see this neutral page until it scans a fresh table QR to start anew.
 */
export function SessionClosed() {
  return (
    <Shell>
      <span className="material-symbols-outlined text-[48px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
        local_cafe
      </span>
      <h1 className="text-[22px] font-bold text-on-surface font-serif">
        Thanks for dining with us
      </h1>
      <p className="text-on-surface-variant text-[15px] leading-relaxed">
        Your previous order has been settled. To start a new order, please scan
        the QR code on your table again.
      </p>
    </Shell>
  );
}

/**
 * The scanned table already has a live session. If it’s theirs (they lost
 * browser state / switched device), they can re-join by entering their phone.
 *
 * `api` + `table` + `onReclaimed` are optional so legacy call-sites that don’t
 * have them still render the fallback message without crashing.
 */
export function TableInUse({ table, api, onReclaimed }) {
  const [showForm, setShowForm] = useState(false);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleReclaim(e) {
    e.preventDefault();
    if (!phone.trim() || !api || !table || !onReclaimed) return;
    setLoading(true);
    setError(null);
    try {
      const order = await api.orders.reclaimSession(table.id, phone.trim());
      onReclaimed(order);
    } catch (err) {
      const msg = err?.message ?? "";
      setError(
        msg.includes("does not match")
          ? "That number doesn’t match our record. Ask a staff member for help."
          : msg.includes("No active")
          ? "This table no longer has an active order. Ask a staff member."
          : "Couldn’t reconnect. Please try again.",
      );
      setLoading(false);
    }
  }

  return (
    <Shell>
      <span className="material-symbols-outlined text-[48px] text-tertiary">
        groups
      </span>
      <h1 className="text-[22px] font-bold text-on-surface font-serif">
        Table {table?.label ?? ""} is in use
      </h1>
      <p className="text-on-surface-variant text-[15px] leading-relaxed">
        There’s already an open order on this table.
      </p>

      {api && onReclaimed && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mt-2 text-primary font-semibold text-[14px] underline underline-offset-2"
        >
          Already at this table? Re-join with your phone
        </button>
      )}

      {showForm && (
        <form onSubmit={handleReclaim} className="w-full max-w-xs flex flex-col gap-3 mt-2">
          <label className="flex flex-col gap-1 text-left">
            <span className="text-[13px] font-semibold text-on-surface-variant">
              Your phone number
            </span>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-[14px] font-medium text-on-surface-variant select-none pointer-events-none">
                +91
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
                type="tel"
                inputMode="numeric"
                maxLength={13}
                autoFocus
                className="w-full rounded-2xl border border-outline-variant bg-surface-container-lowest pl-14 pr-4 py-3 text-[15px] text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </label>
          {error && (
            <p className="text-[13px] text-error text-center" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !phone.trim()}
            className="w-full bg-primary text-on-primary font-semibold py-3 rounded-full text-[15px] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && (
              <span className="material-symbols-outlined text-[16px] animate-spin">
                progress_activity
              </span>
            )}
            {loading ? "Verifying…" : "Re-join my order"}
          </button>
          <button
            type="button"
            onClick={() => { setShowForm(false); setError(null); }}
            className="text-[13px] text-on-surface-variant text-center"
          >
            Cancel
          </button>
        </form>
      )}

      {!showForm && (
        <p className="text-on-surface-variant/70 text-[13px]">
          Not your order? Ask a staff member for help.
        </p>
      )}
    </Shell>
  );
}
