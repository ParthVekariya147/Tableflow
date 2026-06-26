import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Plan, ThemeColors } from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import { api } from "../api";
import { Spinner } from "../components/Skeleton";

const STEPS = ["Business info", "Theme", "Plan", "Review"];

const THEME_TOKENS: { key: keyof ThemeColors; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "tertiary", label: "Tertiary" },
  { key: "background", label: "Background" },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [currency, setCurrency] = useState("USD");

  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerPasswordConfirm, setOwnerPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [colors, setColors] = useState<ThemeColors>({
    primary: "#7a3b2e",
    secondary: "#2e5d4f",
    tertiary: "#c98b4b",
    background: "#f3e7d3",
  });

  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [planId, setPlanId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Owner fields are optional — but if any are filled, all three are required.
  const ownerPartiallyFilled = ownerName || ownerEmail || ownerPassword;
  const ownerComplete =
    ownerName.trim() && ownerEmail.trim() && ownerPassword.length >= 8 && ownerPassword === ownerPasswordConfirm;
  const ownerValid = !ownerPartiallyFilled || ownerComplete;

  useEffect(() => {
    api.admin
      .listPlans()
      .then((all) => {
        setPlans(all);
        setPlanId(all.find((p) => p.active)?.id ?? null);
      })
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false));
  }, []);

  function slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  const canContinue =
    step === 0
      ? name.trim().length > 0 && slug.trim().length > 0 && ownerValid
      : true;

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const tenant = await api.admin.createTenant({
        slug,
        name,
        currency,
        theme: {
          colors,
          typography: { sans: "Inter, sans-serif", serif: "Fraunces, serif", fontLinks: [] },
          mode: "light",
        },
        ...(ownerComplete
          ? { ownerEmail: ownerEmail.trim(), ownerName: ownerName.trim(), ownerPassword }
          : {}),
      });
      if (planId) {
        await api.admin.setSubscription(tenant.id, { planId });
      }
      navigate(`/tenants/${tenant.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create tenant");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedPlan = plans.find((p) => p.id === planId) ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="font-serif text-2xl font-bold">Onboard a tenant</h1>
        <p className="text-sm text-on-surface-variant">
          Provision a new restaurant in four steps
        </p>
      </header>

      <div className="mb-6 flex items-center">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 items-center last:flex-initial">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i < step
                    ? "bg-secondary text-on-secondary"
                    : i === step
                      ? "bg-primary text-on-primary"
                      : "border border-outline-variant text-on-surface-variant"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span
                className={`whitespace-nowrap text-xs sm:text-sm ${i === step ? "font-semibold" : "text-on-surface-variant"}`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-2 h-0.5 flex-1 rounded sm:mx-3 ${i < step ? "bg-secondary" : "bg-outline-variant"}`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-7">
        {step === 0 && (
          <div>
            <h3 className="mb-1 font-serif text-xl font-bold">Business info</h3>
            <p className="mb-5 text-sm text-on-surface-variant">
              Identify the restaurant.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Restaurant name
                </span>
                <input
                  autoFocus
                  placeholder="e.g. The Copper Pan"
                  value={name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setName(v);
                    setSlug((prev) =>
                      prev === slugify(name) || prev === "" ? slugify(v) : prev,
                    );
                  }}
                  className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Slug
                </span>
                <input
                  placeholder="copper-pan"
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Currency
                </span>
                <input
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm uppercase outline-none focus:border-primary"
                />
              </label>
            </div>

            {/* Owner account — optional; creates User + Admin role + Membership */}
            <div className="mt-6 border-t border-surface-container pt-5">
              <div className="mb-4">
                <p className="text-sm font-semibold">Owner account <span className="font-normal text-on-surface-variant">(optional)</span></p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Creates login credentials for the restaurant owner. Leave blank to add them later from the tenant detail page.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Owner name
                  </span>
                  <input
                    placeholder="e.g. Jane Smith"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Owner email
                  </span>
                  <input
                    type="email"
                    placeholder="owner@restaurant.com"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Password <span className="normal-case font-normal">(min 8 chars)</span>
                  </span>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Set a strong password"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 pr-9 text-sm outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                      tabIndex={-1}
                    >
                      <MaterialIcon name={showPassword ? "visibility_off" : "visibility"} size={18} />
                    </button>
                  </div>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Confirm password
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={ownerPasswordConfirm}
                    onChange={(e) => setOwnerPasswordConfirm(e.target.value)}
                    className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-primary ${
                      ownerPasswordConfirm && ownerPassword !== ownerPasswordConfirm
                        ? "border-error"
                        : "border-outline-variant"
                    }`}
                  />
                  {ownerPasswordConfirm && ownerPassword !== ownerPasswordConfirm && (
                    <p className="mt-1 text-xs text-error">Passwords do not match</p>
                  )}
                </label>
              </div>
              {ownerPartiallyFilled && !ownerComplete && (
                <p className="mt-3 text-xs text-on-surface-variant">
                  Fill in all owner fields (name, email, and matching passwords of 8+ chars) or leave all blank.
                </p>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h3 className="mb-1 font-serif text-xl font-bold">Theme</h3>
            <p className="mb-5 text-sm text-on-surface-variant">
              Set the restaurant's brand colors. These drive their
              customer-facing menu.
            </p>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1.2fr_1fr]">
              <div className="grid grid-cols-2 gap-3">
                {THEME_TOKENS.map((tok) => (
                  <label
                    key={tok.key}
                    className="flex items-center gap-2.5 rounded-lg border border-outline-variant p-2"
                  >
                    <input
                      type="color"
                      value={colors[tok.key] ?? "#cccccc"}
                      onChange={(e) =>
                        setColors((c) => ({ ...c, [tok.key]: e.target.value }))
                      }
                      className="h-9 w-9 flex-shrink-0 cursor-pointer rounded-md border border-outline-variant"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{tok.label}</div>
                      <div className="truncate font-mono text-[11px] text-on-surface-variant">
                        {(colors[tok.key] ?? "—").toUpperCase()}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="overflow-hidden rounded-xl border border-outline-variant">
                <div
                  className="flex h-16 items-end p-3"
                  style={{ background: colors.primary ?? "#7a3b2e" }}
                >
                  <span className="font-serif text-base font-bold text-white">
                    {name || "Your Restaurant"}
                  </span>
                </div>
                <div className="bg-white p-3.5">
                  <div className="mb-2 text-xs text-on-surface-variant">
                    Live preview
                  </div>
                  <div className="flex items-center justify-between border-b border-surface-container py-2 text-sm">
                    <span>Truffle pasta</span>
                    <span className="font-semibold" style={{ color: colors.primary }}>
                      $24
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 text-sm">
                    <span>House salad</span>
                    <span className="font-semibold" style={{ color: colors.primary }}>
                      $12
                    </span>
                  </div>
                  <button
                    type="button"
                    className="mt-2 w-full rounded-lg py-2 text-xs font-semibold text-white"
                    style={{ background: colors.primary ?? "#7a3b2e" }}
                  >
                    Add to order
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 className="mb-1 font-serif text-xl font-bold">Choose a plan</h3>
            <p className="mb-5 text-sm text-on-surface-variant">
              You can change this any time from the subscription panel.
            </p>
            {plansLoading ? (
              <div className="flex h-24 items-center justify-center gap-2 text-sm text-on-surface-variant">
                <Spinner size={18} />
                Loading plans…
              </div>
            ) : (
            <div className="flex flex-col gap-2.5">
              {plans.filter((p) => p.active).map((p) => {
                const picked = planId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left ${
                      picked
                        ? "border-primary bg-primary/5"
                        : "border-outline-variant hover:bg-surface-container-low"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                        picked ? "border-primary" : "border-outline-variant"
                      }`}
                    >
                      {picked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                    </span>
                    <span className="flex-1 text-sm font-semibold">{p.name}</span>
                    <span className="font-serif text-base font-bold">
                      ${(p.priceCents / 100).toFixed(0)}
                      <span className="font-sans text-xs font-medium text-on-surface-variant">
                        /{p.interval}
                      </span>
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setPlanId(null)}
                className={`rounded-xl border px-4 py-3 text-left text-sm ${
                  planId === null
                    ? "border-primary bg-primary/5 font-semibold"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                No plan yet — assign one later
              </button>
              {plans.length === 0 && (
                <p className="text-sm text-on-surface-variant">
                  No plans in the catalog yet —{" "}
                  <a href="/plans" className="text-primary hover:underline">
                    create one first
                  </a>
                  , or skip and assign later.
                </p>
              )}
            </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <h3 className="mb-1 font-serif text-xl font-bold">Review &amp; create</h3>
            <p className="mb-5 text-sm text-on-surface-variant">
              Confirm the details before provisioning the tenant.
            </p>
            <div className="overflow-hidden rounded-xl border border-outline-variant">
              {[
                ["Restaurant", name],
                ["Slug", slug],
                ["Currency", currency],
                ["Plan", selectedPlan ? `${selectedPlan.name} · trialing` : "None yet"],
                ["Owner", ownerComplete ? ownerEmail.trim() : "None — add later"],
              ].map(([label, value], i, arr) => (
                <div
                  key={label}
                  className={`flex justify-between px-4 py-3 text-sm ${i < arr.length - 1 ? "border-b border-surface-container" : ""}`}
                >
                  <span className="text-on-surface-variant">{label}</span>
                  <span className={`font-semibold ${label === "Owner" && !ownerComplete ? "text-on-surface-variant" : ""}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
            {ownerComplete && (
              <p className="mt-3 text-xs text-on-surface-variant">
                The owner can log in at the restaurant admin panel with <span className="font-mono">{ownerEmail.trim()}</span> and the password you set.
              </p>
            )}
            {error && <p className="mt-3 text-sm text-error">{error}</p>}
          </div>
        )}

        <div className="mt-5 flex justify-between border-t border-surface-container pt-4 sm:mt-6 sm:pt-5">
          <button
            type="button"
            onClick={() => (step === 0 ? navigate("/tenants") : setStep((s) => s - 1))}
            className="rounded-lg border border-outline-variant px-4 py-2.5 text-sm font-semibold hover:bg-surface-container-low"
          >
            Back
          </button>
          <button
            type="button"
            disabled={!canContinue || submitting}
            onClick={() =>
              step === 3 ? handleCreate() : setStep((s) => Math.min(3, s + 1))
            }
            className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary disabled:opacity-50"
          >
            {step === 3
              ? submitting
                ? "Creating…"
                : "Create tenant"
              : "Continue"}
            {step !== 3 && <MaterialIcon name="arrow_forward" size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
