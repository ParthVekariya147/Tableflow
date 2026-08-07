import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useBoot } from "../context/BootContext";

/** Indian mobile number — 10 digits starting with 6–9, optional +91/0 prefix. */
function isValidPhone(raw) {
  let digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits);
}

export default function SplashScreen() {
  const navigate = useNavigate();
  const { startSession } = useSession();
  const { tenant, table } = useBoot();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState(""); // honeypot — humans never see it
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const nameOk = name.trim().length >= 2;
  const phoneOk = isValidPhone(phone.trim());
  const canSubmit = nameOk && phoneOk && !submitting;

  async function handleReserve(e) {
    e.preventDefault();
    if (company) return; // bot tripped the honeypot — silently drop
    if (!canSubmit) {
      setError("Please enter your name and a valid 10-digit Indian mobile number.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await startSession({
        customerName: name.trim(),
        customerPhone: phone.trim(),
      });
      navigate("/welcome");
    } catch (err) {
      setError(err?.message ?? "Couldn’t reserve the table. Please try again.");
      setSubmitting(false);
    }
  }

  const logoUrl = tenant?.theme?.logoUrl;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-10 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute -top-20 -left-20 w-72 h-72 bg-secondary-container/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -right-20 w-60 h-60 bg-primary-fixed/20 rounded-full blur-3xl pointer-events-none" />

      <form
        onSubmit={handleReserve}
        className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mx-auto gap-5 relative z-10"
      >
        {/* Logo */}
        <div className="w-20 h-20 rounded-full overflow-hidden ring-4 ring-surface-container-lowest shadow-xl bg-primary-container flex items-center justify-center">
          {logoUrl ? (
            <img src={logoUrl} alt={tenant.name} className="w-full h-full object-cover" />
          ) : (
            <span className="material-symbols-outlined text-[2.25rem] text-on-primary-container">
              restaurant
            </span>
          )}
        </div>

        <div className="text-center">
          <h1 className="text-[1.875rem] font-bold text-on-surface font-serif leading-tight">
            {tenant?.name ?? "Welcome"}
          </h1>
          <p className="text-on-surface-variant text-[0.9375rem] mt-1">
            Scan successful — let’s get you seated.
          </p>
        </div>

        {/* Table badge */}
        <div className="flex items-center gap-2 bg-primary-container text-on-primary-container font-semibold px-5 py-2.5 rounded-full shadow-md">
          <span
            className="material-symbols-outlined text-[1.125rem]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            table_restaurant
          </span>
          <span>Table {table?.label ?? ""}</span>
        </div>

        {/* Reserve form */}
        <div className="w-full flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[0.8125rem] font-semibold text-on-surface-variant">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rahul Sharma"
              autoComplete="name"
              className="w-full rounded-2xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-[0.9375rem] text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[0.8125rem] font-semibold text-on-surface-variant">
              Phone number
              <span className="ml-1.5 text-[0.6875rem] font-normal text-on-surface-variant/60">Indian mobile</span>
            </span>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-[0.9375rem] font-medium text-on-surface-variant select-none pointer-events-none">
                +91
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
                type="tel"
                autoComplete="tel"
                inputMode="numeric"
                maxLength={13}
                className="w-full rounded-2xl border border-outline-variant bg-surface-container-lowest pl-14 pr-4 py-3 text-[0.9375rem] text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </label>

          {/* Honeypot: hidden from humans; bots that fill it are dropped. */}
          <input
            type="text"
            name="company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="hidden"
          />

          {error && (
            <p className="text-[0.8125rem] text-error text-center" role="alert">
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-primary text-on-primary font-semibold py-4 rounded-full shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2 text-[1rem] disabled:opacity-70"
        >
          {submitting ? (
            <>
              <span className="material-symbols-outlined text-[1.125rem] animate-spin">
                progress_activity
              </span>
              Reserving…
            </>
          ) : (
            <>
              Reserve this table
              <span className="material-symbols-outlined text-[1.125rem]">arrow_forward</span>
            </>
          )}
        </button>
      </form>

      <footer className="relative z-10 text-center text-[0.75rem] text-on-surface-variant/60">
        Powered by {tenant?.name ?? "Amber & Grain"}
      </footer>
    </div>
  );
}
