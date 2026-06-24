import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTenant } from "@amber/ui";
import { ApiError } from "@amber/api-client";
import type { ThemeColors, ThemeConfig, ThemeTypography } from "@amber/domain";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import { useTenantBrand } from "../context/TenantThemeGate";

/** Brand colors the admin can tune (a subset of the full token set). */
const COLOR_FIELDS: { key: keyof ThemeColors; label: string; fallback: string }[] = [
  { key: "primary", label: "Primary", fallback: "#8c5000" },
  { key: "primary-container", label: "Primary (light)", fallback: "#e8943a" },
  { key: "secondary-container", label: "Secondary", fallback: "#fdcf49" },
  { key: "tertiary", label: "Accent", fallback: "#6c5b4d" },
];

/** Font pairings (each loads via Google Fonts so the choice actually renders). */
const FONT_PRESETS = [
  {
    id: "jakarta-literata",
    label: "Jakarta + Literata (default)",
    sans: "Plus Jakarta Sans, sans-serif",
    serif: "Literata, serif",
    links: [
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Literata:opsz,wght@7..72,500;7..72,600;7..72,700&display=swap",
    ],
  },
  {
    id: "inter-fraunces",
    label: "Inter + Fraunces",
    sans: "Inter, sans-serif",
    serif: "Fraunces, serif",
    links: [
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap",
    ],
  },
  {
    id: "poppins-playfair",
    label: "Poppins + Playfair Display",
    sans: "Poppins, sans-serif",
    serif: "Playfair Display, serif",
    links: [
      "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap",
    ],
  },
  {
    id: "system",
    label: "System (no web font)",
    sans: "system-ui, sans-serif",
    serif: "Georgia, serif",
    links: [] as string[],
  },
] as const;

const CURRENT = "__current";

function presetIdFor(typo: ThemeTypography): string {
  return FONT_PRESETS.find((p) => p.sans === typo.sans)?.id ?? CURRENT;
}

/**
 * Branding (`/settings/branding`) — the Admin sets the tenant's theme (colors,
 * fonts, logo). Changes apply **live across the whole app** as a preview; Save
 * persists them (`PATCH /tenant`) so they stick for everyone. Leaving without
 * saving reverts. Gated by `settings.manage`.
 */
export function BrandingPage() {
  const navigate = useNavigate();
  const liveTenant = useTenant();
  const { applyTenant } = useTenantBrand();

  // The committed (saved) brand we revert to on Discard / leaving the page.
  const committedRef = useRef(liveTenant);

  const [colors, setColors] = useState<ThemeColors>({ ...liveTenant.theme.colors });
  const [fontId, setFontId] = useState<string>(presetIdFor(liveTenant.theme.typography));
  const [logoUrl, setLogoUrl] = useState(liveTenant.theme.logoUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  const typography: ThemeTypography = useMemo(() => {
    if (fontId === CURRENT) return committedRef.current.theme.typography;
    const p = FONT_PRESETS.find((f) => f.id === fontId) ?? FONT_PRESETS[0];
    return { sans: p.sans, serif: p.serif, fontLinks: [...p.links] };
  }, [fontId]);

  const draftTheme: ThemeConfig = useMemo(
    () => ({
      colors,
      typography,
      logoUrl: logoUrl.trim() || undefined,
      mode: committedRef.current.theme.mode,
    }),
    [colors, typography, logoUrl],
  );

  // Live preview: apply the draft brand to the whole app as it changes.
  useEffect(() => {
    applyTenant({ ...committedRef.current, theme: draftTheme });
  }, [draftTheme, applyTenant]);

  // Revert to the committed brand if we leave without saving.
  useEffect(() => () => applyTenant(committedRef.current), [applyTenant]);

  const dirty = useMemo(
    () => JSON.stringify(draftTheme) !== JSON.stringify(committedRef.current.theme),
    [draftTheme, savedTick],
  );

  function setColor(key: keyof ThemeColors, value: string) {
    setColors((c) => ({ ...c, [key]: value }));
  }

  async function onPickLogo(file: File) {
    setUploading(true);
    setError(null);
    try {
      const { url } = await api.menu.uploadImage(file);
      setLogoUrl(url);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.tenant.update({ theme: draftTheme });
      committedRef.current = updated;
      applyTenant(updated);
      setSavedTick((t) => t + 1);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    const t = committedRef.current;
    setColors({ ...t.theme.colors });
    setFontId(presetIdFor(t.theme.typography));
    setLogoUrl(t.theme.logoUrl ?? "");
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
          <h1 className="font-headline-md text-headline-md text-on-surface">Branding</h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Set your restaurant's colors, fonts, and logo. Changes preview live —
            Save to keep them.
          </p>
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-[1fr_360px]">
        {/* Controls */}
        <div className="space-y-lg">
          <Section title="Colors">
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              {COLOR_FIELDS.map((f) => {
                const value = colors[f.key] ?? f.fallback;
                return (
                  <div key={f.key} className="flex items-center gap-md">
                    <input
                      type="color"
                      value={value}
                      onChange={(e) => setColor(f.key, e.target.value)}
                      className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-outline-variant bg-transparent"
                      aria-label={f.label}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-label-md text-label-md text-on-surface">{f.label}</p>
                      <input
                        value={value}
                        onChange={(e) => setColor(f.key, e.target.value)}
                        className="mt-1 w-full rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-1 font-data-mono text-[12px] text-on-surface focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Typography">
            <label className="block">
              <span className="mb-base block font-label-md text-label-md text-on-surface">
                Font pairing
              </span>
              <select
                value={fontId}
                onChange={(e) => setFontId(e.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
              >
                {fontId === CURRENT && <option value={CURRENT}>Current (custom)</option>}
                {FONT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section title="Logo">
            <div className="flex items-center gap-md">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-card border border-outline-variant bg-surface-container">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-bold text-on-surface-variant">
                    {liveTenant.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-sm">
                <input
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://… logo image URL"
                  className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-1 font-body-md text-[13px] text-on-surface focus:border-primary focus:outline-none"
                />
                <div className="flex items-center gap-sm">
                  <label className="inline-flex cursor-pointer items-center gap-xs rounded-full border border-outline px-md py-1 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low">
                    <Icon name="upload" size={16} />
                    {uploading ? "Uploading…" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onPickLogo(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {logoUrl && (
                    <button
                      onClick={() => setLogoUrl("")}
                      className="font-label-md text-label-md text-on-surface-variant hover:text-error"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Section>

          <div className="flex items-center gap-sm">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
            >
              {saving && <Icon name="progress_activity" size={16} className="ag-spin" />}
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

        {/* Live preview */}
        <aside className="space-y-md rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
          <p className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
            Preview
          </p>
          <h2 className="font-headline-md text-[22px] text-on-surface">{liveTenant.name}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            The quick brown fox runs the kitchen at dinner service.
          </p>
          <div className="flex flex-wrap gap-sm">
            <span className="rounded-full bg-primary px-md py-sm font-label-md text-label-md text-on-primary">
              Primary
            </span>
            <span className="rounded-full bg-primary-container px-md py-sm font-label-md text-label-md text-on-primary-container">
              Container
            </span>
            <span className="rounded-full bg-secondary-container px-md py-sm font-label-md text-label-md text-on-secondary-container">
              Secondary
            </span>
          </div>
          <div className="rounded-card border border-outline-variant bg-surface-container p-md">
            <div className="flex items-center justify-between">
              <span className="font-label-md text-label-md text-on-surface">Table 4</span>
              <span className="rounded-full bg-primary/10 px-sm py-[2px] font-label-md text-[11px] text-primary">
                Open
              </span>
            </div>
            <p className="mt-xs font-data-mono text-data-mono text-primary">$42.00</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
      <h3 className="mb-md font-title-lg text-title-lg text-on-surface">{title}</h3>
      {children}
    </section>
  );
}

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}
