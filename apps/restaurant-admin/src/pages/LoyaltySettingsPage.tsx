import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@amber/api-client";
import type { LoyaltyProgram } from "@amber/domain";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import { Toggle } from "../components/Toggle";
import { Spinner } from "../components/Skeleton";

const DEFAULT_PROGRAM: LoyaltyProgram = {
  enabled: false,
  earnRatePerCurrency: 1,
  redemptionRate: 100,
  minRedeemPoints: 100,
  maxRedeemPercent: 0.5,
};

/**
 * Loyalty program settings (`/settings/loyalty`). Staff-only, no guest-facing
 * surface — a guest never sees points; staff apply redemptions on the guest's
 * behalf in Billing. Persists via PATCH /tenant (same endpoint as Branding/
 * Payments). Gated by `settings.manage` (route) — day-to-day use of the
 * program (directory, redemption) is gated separately by `loyalty.manage`.
 */
export function LoyaltySettingsPage() {
  const navigate = useNavigate();

  const [draft, setDraft] = useState<LoyaltyProgram>(DEFAULT_PROGRAM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    let active = true;
    api.tenant
      .current()
      .then((t) => {
        if (active) setDraft(t.loyalty);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.tenant.update({ loyalty: draft });
      setDraft(updated.loyalty);
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
          <h1 className="font-headline-md text-headline-md text-on-surface">Loyalty</h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Reward returning guests with points. Guests never see this — staff track
            and redeem points from the Loyalty directory and Billing.
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
        <div className="max-w-[560px] space-y-lg">
          <section className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-title-lg text-title-lg text-on-surface">
                  Enable loyalty points
                </h3>
                <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
                  Guests earn points automatically on every payment (by phone number).
                </p>
              </div>
              <Toggle
                checked={draft.enabled}
                onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
              />
            </div>
          </section>

          <section
            className={`space-y-lg rounded-card border border-outline-variant bg-surface-container-lowest p-lg transition-opacity ${
              draft.enabled ? "" : "pointer-events-none opacity-50"
            }`}
          >
            <NumberField
              label="Points earned per unit spent"
              hint="e.g. 1 point for every $1 of the (post-discount) bill."
              value={draft.earnRatePerCurrency}
              onChange={(v) => setDraft((d) => ({ ...d, earnRatePerCurrency: v }))}
              min={0}
              step={0.1}
            />
            <NumberField
              label="Points required per unit of discount"
              hint="e.g. 100 points = $1 off at checkout."
              value={draft.redemptionRate}
              onChange={(v) => setDraft((d) => ({ ...d, redemptionRate: v }))}
              min={1}
              step={1}
            />
            <NumberField
              label="Minimum balance to redeem"
              hint="Guests need at least this many points before any redemption is offered."
              value={draft.minRedeemPoints}
              onChange={(v) => setDraft((d) => ({ ...d, minRedeemPoints: v }))}
              min={0}
              step={10}
            />
            <NumberField
              label="Maximum redemption (% of bill)"
              hint="Caps how much of a single bill can be discounted with points."
              value={Math.round(draft.maxRedeemPercent * 100)}
              onChange={(v) => setDraft((d) => ({ ...d, maxRedeemPercent: v / 100 }))}
              min={0}
              max={100}
              step={5}
              suffix="%"
            />
          </section>

          <div className="flex items-center gap-sm">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
            >
              {saving && <Icon name="progress_activity" size={16} className="ag-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </button>
            {!saving && savedTick > 0 && (
              <span className="flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
                <Icon name="check_circle" size={16} /> Saved
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div>
      <label className="mb-xs block font-label-md text-label-md text-on-surface">{label}</label>
      <p className="mb-sm font-body-md text-body-md text-on-surface-variant">{hint}</p>
      <div className="relative w-40">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-lg border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-md top-1/2 -translate-y-1/2 font-body-md text-body-md text-on-surface-variant">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
