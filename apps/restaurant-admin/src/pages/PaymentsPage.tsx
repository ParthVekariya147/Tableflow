import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@amber/api-client";
import {
  PAYMENT_METHOD_LABELS,
  mergePaymentMethods,
  type PaymentMethod,
  type PaymentMethodConfig,
} from "@amber/domain";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import { Spinner } from "../components/Skeleton";
import { Toggle } from "../components/Toggle";
import { withRetry } from "../lib/retry";
import { useTenantBrand } from "../context/TenantThemeGate";

/** Staff-facing copy per tender. Card/UPI are *recorded*, not collected by the
 *  app — the guest has already paid on the bank's card machine or by scanning
 *  the UPI QR, which is how these work in every counter-POS deployment. */
const METHOD_INFO: Record<
  PaymentMethod,
  { icon: string; desc: string }
> = {
  cash: { icon: "payments", desc: "Staff collect cash and confirm at checkout." },
  card: { icon: "credit_card", desc: "Guest taps on your own card machine; staff record it." },
  upi: { icon: "qr_code_2", desc: "Guest scans the bill's UPI QR; staff confirm receipt." },
};

/**
 * Payments settings (`/settings/payments`).
 * Lets the Admin configure UPI VPA + mobile for QR-code / deep-link billing.
 * Persists via PATCH /tenant (same endpoint as Branding).
 */
export function PaymentsPage() {
  const navigate = useNavigate();
  const { applyTenant } = useTenantBrand();

  const [upiId, setUpiId] = useState("");
  const [upiMobile, setUpiMobile] = useState("");
  const [methods, setMethods] = useState<PaymentMethodConfig[]>(() =>
    mergePaymentMethods(undefined),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  // Seed fields from the current tenant on mount
  useEffect(() => {
    let active = true;
    api.tenant
      .current()
      .then((t) => {
        if (!active) return;
        setUpiId(t.upiId ?? "");
        setUpiMobile(t.upiMobile ?? "");
        setMethods(mergePaymentMethods(t.paymentMethods));
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const dirty = upiId.trim() !== "" || upiMobile.trim() !== "" || savedTick > 0;

  /** Enabled count drives the "can't switch the last one off" guard — a POS
   *  with zero tenders can't close a bill. Mirrored server-side by
   *  `mergePaymentMethods`, which forces cash back on if it ever happens. */
  const enabledCount = methods.filter((m) => m.enabled).length;

  function toggleMethod(method: PaymentMethod, next: boolean) {
    if (!next && enabledCount <= 1) return;
    setMethods((prev) =>
      prev.map((m) => (m.method === method ? { ...m, enabled: next } : m)),
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await withRetry(() =>
        api.tenant.update({
          upiId: upiId.trim() || undefined,
          upiMobile: upiMobile.trim() || undefined,
          paymentMethods: methods,
        }),
      );
      // Push app-wide so the checkout screens drop/restore the tender at once.
      applyTenant(updated);
      setSavedTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-lg">
      <header className="flex items-center gap-sm">
        <button
          onClick={() => navigate("/settings")}
          className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-surface-container-low"
          aria-label="Back to settings"
        >
          <Icon name="arrow_back" />
        </button>
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">Payments</h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Configure UPI to accept instant digital payments at checkout.
          </p>
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-xxl">
          <Spinner size={32} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-lg lg:grid-cols-[1fr_340px]">
          {/* UPI Config */}
          <div className="space-y-lg">
            {/* Info banner */}
            <div className="flex items-start gap-md rounded-card border border-[#e3f2fd] bg-[#e3f2fd]/60 p-lg">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1565c0]/10 text-[#1565c0]">
                <Icon name="info" size={20} />
              </div>
              <div className="font-body-md text-body-md text-on-surface">
                <p className="mb-xs font-semibold text-[#1565c0]">How UPI billing works</p>
                <p className="text-on-surface-variant">
                  When staff selects "UPI" at checkout, a QR code is generated with the exact
                  bill amount pre-filled. The guest scans it with any UPI app (GPay, PhonePe,
                  Paytm) and pays instantly. Staff confirms receipt and closes the table.
                </p>
              </div>
            </div>

            <section className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
              <h3 className="mb-md font-title-lg text-title-lg text-on-surface">UPI Details</h3>

              <div className="space-y-lg">
                {/* UPI ID */}
                <div>
                  <label className="mb-xs block font-label-md text-label-md text-on-surface">
                    UPI ID (VPA)
                  </label>
                  <p className="mb-sm font-body-md text-body-md text-on-surface-variant">
                    Your registered UPI address — the guest's app credits this account.
                  </p>
                  <div className="relative">
                    <span className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant">
                      <Icon name="alternate_email" size={18} />
                    </span>
                    <input
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      placeholder="restaurant@okicici"
                      className="w-full rounded-lg border border-outline-variant bg-surface py-sm pl-xl pr-md font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>

                {/* Mobile */}
                <div>
                  <label className="mb-xs block font-label-md text-label-md text-on-surface">
                    Registered Mobile Number
                  </label>
                  <p className="mb-sm font-body-md text-body-md text-on-surface-variant">
                    Shown alongside the QR for guests who prefer typing. Include country code (e.g. 91xxxxxxxxxx).
                  </p>
                  <div className="relative">
                    <span className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant">
                      <Icon name="phone" size={18} />
                    </span>
                    <input
                      value={upiMobile}
                      onChange={(e) => setUpiMobile(e.target.value)}
                      placeholder="91xxxxxxxxxx"
                      inputMode="tel"
                      className="w-full rounded-lg border border-outline-variant bg-surface py-sm pl-xl pr-md font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>

              </div>
            </section>

            {/* Accepted methods — the master switch list. Turning one off hides
                it from every checkout (dine-in billing, Quick Sale, and the
                guest's own bill screen). Past sales keep their method: a
                disabled tender still prints, reports and reconciles as before. */}
            <section className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
              <h3 className="font-title-lg text-title-lg text-on-surface">Accepted Methods</h3>
              <p className="mb-md mt-xs font-body-md text-body-md text-on-surface-variant">
                Choose what staff can charge with. Switching one off removes it
                from every checkout screen — it never changes sales you've
                already taken.
              </p>
              <ul className="space-y-sm">
                {methods.map((m) => {
                  const info = METHOD_INFO[m.method];
                  const last = m.enabled && enabledCount <= 1;
                  const needsUpi = m.method === "upi" && m.enabled && !upiId.trim();
                  return (
                    <li
                      key={m.method}
                      className={`flex items-center gap-md rounded-card border p-md transition-colors ${
                        m.enabled
                          ? "border-primary/30 bg-primary-container/10"
                          : "border-outline-variant bg-surface-container opacity-70"
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          m.enabled
                            ? "bg-primary/10 text-primary"
                            : "bg-surface-variant text-on-surface-variant"
                        }`}
                      >
                        <Icon name={info.icon} size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-label-md text-label-md font-semibold text-on-surface">
                          {PAYMENT_METHOD_LABELS[m.method]}
                        </p>
                        <p className="font-body-md text-[12px] text-on-surface-variant">
                          {needsUpi ? "Add your UPI ID above to show the QR." : info.desc}
                        </p>
                        {last && (
                          <p className="mt-base font-body-md text-[11px] text-on-surface-variant">
                            Your only method — at least one must stay on.
                          </p>
                        )}
                      </div>
                      <Toggle
                        checked={m.enabled}
                        onChange={(next) => toggleMethod(m.method, next)}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* One save for the whole page (UPI details + accepted methods). */}
            <div className="flex items-center gap-sm">
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
              >
                {saving && <Icon name="progress_activity" size={16} className="ag-spin" />}
                {saving ? "Saving…" : "Save Payment Settings"}
              </button>
              {!saving && savedTick > 0 && (
                <span className="flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
                  <Icon name="check_circle" size={16} className="text-[#2e7d32]" /> Saved
                </span>
              )}
            </div>
          </div>

          {/* Preview panel */}
          <aside className="space-y-md rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
            <p className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
              Checkout Preview
            </p>
            <div className="rounded-lg border border-outline-variant/60 bg-surface p-md text-center">
              <div className="mx-auto mb-md flex h-24 w-24 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container">
                <Icon name="qr_code_2" size={52} className="text-on-surface-variant/40" />
              </div>
              <p className="font-label-md text-label-md font-semibold text-on-surface">
                {upiId.trim() || "restaurant@upi"}
              </p>
              {upiMobile.trim() && (
                <p className="mt-xs font-body-md text-[12px] text-on-surface-variant">
                  {upiMobile.trim()}
                </p>
              )}
              <div className="mt-md rounded-full bg-primary py-sm text-center font-label-md text-label-md text-on-primary">
                ₹ 450.00 · Open UPI App
              </div>
            </div>
            <p className="font-body-md text-[12px] text-on-surface-variant">
              QR code is generated dynamically with the exact bill amount at checkout — no static QR needed.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
