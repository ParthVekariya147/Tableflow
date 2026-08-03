import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTenant } from "@amber/ui";
import { ApiError } from "@amber/api-client";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import { withRetry } from "../lib/retry";

const CURRENCIES = [
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
] as const;

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

/**
 * Restaurant Profile (`/settings/profile`) — name, currency, tax rate, GST number.
 * All fields go through `PATCH /tenant` so they apply immediately for all users.
 */
export function RestaurantProfilePage() {
  const navigate = useNavigate();
  const tenant = useTenant();
  const committedRef = useRef(tenant);

  const [name, setName] = useState(tenant.name);
  const [currency, setCurrency] = useState(tenant.currency);
  const [taxPct, setTaxPct] = useState(
    String(Math.round(tenant.taxRate * 100)),
  );
  const [gstNumber, setGstNumber] = useState(tenant.gstNumber ?? "");
  const [fssaiNumber, setFssaiNumber] = useState(tenant.fssaiNumber ?? "");
  const [address, setAddress] = useState(tenant.address ?? "");
  const [phone, setPhone] = useState(tenant.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Sync if tenant prop changes (e.g. after external save).
  useEffect(() => {
    committedRef.current = tenant;
  }, [tenant]);

  const taxRate = parseFloat(taxPct) / 100;
  const taxValid = !isNaN(taxRate) && taxRate >= 0 && taxRate <= 1;

  const dirty =
    name.trim() !== committedRef.current.name ||
    currency !== committedRef.current.currency ||
    parseFloat(taxPct) !== Math.round(committedRef.current.taxRate * 100) ||
    gstNumber.trim() !== (committedRef.current.gstNumber ?? "") ||
    fssaiNumber.trim() !== (committedRef.current.fssaiNumber ?? "") ||
    address.trim() !== (committedRef.current.address ?? "") ||
    phone.trim() !== (committedRef.current.phone ?? "");

  function discard() {
    const t = committedRef.current;
    setName(t.name);
    setCurrency(t.currency);
    setTaxPct(String(Math.round(t.taxRate * 100)));
    setGstNumber(t.gstNumber ?? "");
    setFssaiNumber(t.fssaiNumber ?? "");
    setAddress(t.address ?? "");
    setPhone(t.phone ?? "");
    setError(null);
  }

  async function save() {
    if (!taxValid) {
      setError("Tax rate must be between 0 and 100.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await withRetry(() =>
        api.tenant.update({
          name: name.trim(),
          currency,
          taxRate,
          gstNumber: gstNumber.trim(),
          fssaiNumber: fssaiNumber.trim(),
          address: address.trim(),
          phone: phone.trim(),
        }),
      );
      committedRef.current = updated;
      setSavedTick((t) => t + 1);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  const selectedCurrency = CURRENCIES.find((c) => c.code === currency);

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
          <h1 className="font-headline-md text-headline-md text-on-surface">
            Restaurant Profile
          </h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Name, currency, tax rate, address, phone, and GST/FSSAI numbers
            shown on bills.
          </p>
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">
          {error}
        </p>
      )}

      <div className="max-w-xl space-y-lg">
        {/* Restaurant Name */}
        <Section title="Restaurant Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your restaurant name"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
          />
        </Section>

        {/* Currency */}
        <Section title="Currency">
          <p className="mb-md font-body-md text-body-md text-on-surface-variant">
            Sets the symbol and number format shown on all menus and bills.
          </p>
          <div className="space-y-sm">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} — {c.code} · {c.name}
                </option>
              ))}
            </select>
            {selectedCurrency && (
              <p className="font-body-md text-body-md text-on-surface-variant">
                Example:{" "}
                <span className="font-semibold text-on-surface">
                  {new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: selectedCurrency.code,
                  }).format(1234.5)}
                </span>
              </p>
            )}
          </div>
        </Section>

        {/* Tax Rate */}
        <Section title="Tax Rate">
          <p className="mb-md font-body-md text-body-md text-on-surface-variant">
            Applied to every bill. Enter as a percentage (e.g.{" "}
            <span className="font-semibold">18</span> for 18% GST).
          </p>
          <div className="flex items-center gap-sm">
            <div className="relative w-36">
              <input
                value={taxPct}
                onChange={(e) => setTaxPct(e.target.value)}
                type="number"
                min="0"
                max="100"
                step="0.5"
                placeholder="18"
                className={`w-full rounded-lg border bg-surface-container-lowest px-md py-sm pr-10 font-body-md text-body-md text-on-surface focus:outline-none ${
                  taxValid
                    ? "border-outline-variant focus:border-primary"
                    : "border-error focus:border-error"
                }`}
              />
              <span className="absolute right-md top-1/2 -translate-y-1/2 font-body-md text-body-md text-on-surface-variant">
                %
              </span>
            </div>
            <span className="font-body-md text-body-md text-on-surface-variant">
              = {taxValid ? (taxRate * 100).toFixed(2) : "—"}% stored as{" "}
              {taxValid ? taxRate.toFixed(4) : "—"}
            </span>
          </div>
        </Section>

        {/* GST Number */}
        <Section title="GST Number">
          <p className="mb-md font-body-md text-body-md text-on-surface-variant">
            Your GST registration number is printed on every bill and receipt. Leave
            blank if you are not GST-registered.
          </p>
          <input
            value={gstNumber}
            onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
            placeholder="e.g. 22AAAAA0000A1Z5"
            maxLength={15}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-data-mono text-[14px] uppercase tracking-widest text-on-surface focus:border-primary focus:outline-none"
          />
          {gstNumber.trim().length > 0 && gstNumber.trim().length !== 15 && (
            <p className="mt-xs font-body-md text-body-md text-error">
              GST number must be exactly 15 characters.
            </p>
          )}
        </Section>

        {/* FSSAI License */}
        <Section title="FSSAI License Number">
          <p className="mb-md font-body-md text-body-md text-on-surface-variant">
            Your 14-digit FSSAI food-safety license, printed on every bill.
            Leave blank if not applicable.
          </p>
          <input
            value={fssaiNumber}
            onChange={(e) => setFssaiNumber(e.target.value.replace(/\D/g, ""))}
            placeholder="e.g. 10012031000123"
            maxLength={14}
            inputMode="numeric"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-data-mono text-[14px] tracking-widest text-on-surface focus:border-primary focus:outline-none"
          />
          {fssaiNumber.trim().length > 0 && fssaiNumber.trim().length !== 14 && (
            <p className="mt-xs font-body-md text-body-md text-error">
              FSSAI license number must be exactly 14 digits.
            </p>
          )}
        </Section>

        {/* Address & Phone */}
        <Section title="Address & Phone">
          <p className="mb-md font-body-md text-body-md text-on-surface-variant">
            Printed centered under the restaurant name on every bill.
          </p>
          <div className="space-y-sm">
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 12 MG Road, Ahmedabad, Gujarat 380001"
              rows={2}
              className="w-full resize-y rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 079-2656 0000 or 98765 43210"
              type="tel"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
            />
          </div>
        </Section>

        {/* Actions */}
        <div className="flex items-center gap-sm">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
          >
            {saving && (
              <Icon name="progress_activity" size={16} className="ag-spin" />
            )}
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={discard}
            disabled={saving || !dirty}
            className="rounded-full px-lg py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
          >
            Discard
          </button>
          {!dirty && savedTick > 0 && (
            <span className="flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
              <Icon name="check_circle" size={16} /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
      <h3 className="mb-md font-title-lg text-title-lg text-on-surface">
        {title}
      </h3>
      {children}
    </section>
  );
}
