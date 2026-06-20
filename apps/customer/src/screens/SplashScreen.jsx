import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useBoot } from "../context/BootContext";

/** Lenient phone check — at least 7 digits, allowing +, spaces, (), -. */
function isValidPhone(phone) {
  return /^[0-9+()\-\s]+$/.test(phone) && phone.replace(/\D/g, "").length >= 7;
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
      setError("Please enter your name and a valid phone number.");
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
            <span className="material-symbols-outlined text-[36px] text-on-primary-container">
              restaurant
            </span>
          )}
        </div>

        <div className="text-center">
          <h1 className="text-[30px] font-bold text-on-surface font-serif leading-tight">
            {tenant?.name ?? "Welcome"}
          </h1>
          <p className="text-on-surface-variant text-[15px] mt-1">
            Scan successful — let’s get you seated.
          </p>
        </div>

        {/* Table badge */}
        <div className="flex items-center gap-2 bg-primary-container text-on-primary-container font-semibold px-5 py-2.5 rounded-full shadow-md">
          <span
            className="material-symbols-outlined text-[18px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            table_restaurant
          </span>
          <span>Table {table?.label ?? ""}</span>
        </div>

        {/* Reserve form */}
        <div className="w-full flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-on-surface-variant">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Morgan"
              autoComplete="name"
              className="w-full rounded-2xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-[15px] text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-on-surface-variant">Phone number</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. (555) 123-4567"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              className="w-full rounded-2xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-[15px] text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
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
            <p className="text-[13px] text-error text-center" role="alert">
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-primary text-on-primary font-semibold py-4 rounded-full shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2 text-[16px] disabled:opacity-70"
        >
          {submitting ? (
            <>
              <span className="material-symbols-outlined text-[18px] animate-spin">
                progress_activity
              </span>
              Reserving…
            </>
          ) : (
            <>
              Reserve this table
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </>
          )}
        </button>
      </form>

      <footer className="relative z-10 text-center text-[12px] text-on-surface-variant/60">
        Powered by {tenant?.name ?? "Amber & Grain"}
      </footer>
    </div>
  );
}
