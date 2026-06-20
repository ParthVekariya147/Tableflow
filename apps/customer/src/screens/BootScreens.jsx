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

/** The scanned table already has a live session — block and defer to staff. */
export function TableInUse({ table }) {
  return (
    <Shell>
      <span className="material-symbols-outlined text-[48px] text-tertiary">
        groups
      </span>
      <h1 className="text-[22px] font-bold text-on-surface font-serif">
        Table {table?.label ?? ""} is in use
      </h1>
      <p className="text-on-surface-variant text-[15px] leading-relaxed">
        There’s already an open order on this table. Please ask a staff member
        if you think this is a mistake.
      </p>
    </Shell>
  );
}
