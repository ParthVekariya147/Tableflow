import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Tenant, ThemeColors } from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import { api } from "../api";
import { Toggle } from "../components/Toggle";
import { CardSkeleton, Bone } from "../components/Skeleton";

/** Color tokens exposed in the editor — the full themeColorsSchema key list is
 * longer, but these are the ones that visibly brand a tenant's customer app. */
const EDITABLE_TOKENS: { key: keyof ThemeColors; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "tertiary", label: "Tertiary" },
  { key: "background", label: "Background" },
];

export function TenantEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [taxPct, setTaxPct] = useState("0");
  const [active, setActive] = useState(true);
  const [colors, setColors] = useState<ThemeColors>({});

  useEffect(() => {
    if (!id) return;
    api.admin
      .listTenants()
      .then((all) => {
        const found = all.find((t) => t.id === id) ?? null;
        if (!found) {
          setError("Tenant not found");
          return;
        }
        setTenant(found);
        setName(found.name);
        setCurrency(found.currency);
        setTaxPct(String(found.taxRate * 100));
        setActive(found.active);
        setColors(found.theme.colors);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load tenant"),
      )
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.admin.updateTenant(tenant.id, {
        name,
        currency,
        taxRate: Math.max(0, Math.min(100, Number(taxPct) || 0)) / 100,
        active,
        theme: { ...tenant.theme, colors },
      });
      navigate(`/tenants/${tenant.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Link
        to={id ? `/tenants/${id}` : "/tenants"}
        className="mb-4 inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary"
      >
        <MaterialIcon name="arrow_back" size={18} />
        {tenant?.name ?? "Tenant"}
      </Link>
      <h1 className="mb-6 font-serif text-2xl font-bold">
        Edit {tenant?.name ?? "tenant"}
      </h1>

      {error && <p className="text-error">{error}</p>}

      {loading && !error && (
        <div className="grid max-w-4xl grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={4} />
          <div className="flex justify-end gap-2.5 md:col-span-2">
            <Bone className="h-9 w-20 rounded-lg" />
            <Bone className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      )}

      {tenant && (
        <form
          onSubmit={handleSubmit}
          className="grid max-w-4xl grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2"
        >
          <div className="flex flex-col gap-4 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <div className="text-sm font-semibold text-on-surface-variant">
              Business info
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Restaurant name
              </span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Slug
              </span>
              <input
                disabled
                value={tenant.slug}
                title="Slug can't be changed after creation"
                className="w-full rounded-lg border border-outline-variant bg-surface-container px-3 py-2 font-mono text-sm text-on-surface-variant"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Currency
                </span>
                <input
                  required
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm uppercase outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Tax rate (%)
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={taxPct}
                  onChange={(e) => setTaxPct(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-outline-variant px-3.5 py-3">
              <div>
                <div className="text-sm font-medium">Active</div>
                <div className="text-xs text-on-surface-variant">
                  Off locks the tenant out of restaurant-admin
                </div>
              </div>
              <Toggle checked={active} onChange={() => setActive((a) => !a)} />
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <div className="text-sm font-semibold text-on-surface-variant">
              Theme
            </div>
            <p className="text-xs text-on-surface-variant">
              Drives the tenant's customer-facing menu. Unset tokens fall
              back to the platform defaults.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {EDITABLE_TOKENS.map((tok) => (
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
          </div>

          <div className="flex items-center gap-3 md:col-span-2">
            {saveError && <p className="text-sm text-error">{saveError}</p>}
            <div className="ml-auto flex gap-2.5">
              <Link
                to={`/tenants/${tenant.id}`}
                className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-low"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
