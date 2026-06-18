import { useEffect, useState } from "react";
import type { Tenant } from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import { api } from "./api";

/**
 * Super Admin shell — tenant onboarding, billing, cross-restaurant analytics.
 *
 * Build-out plan:
 *  - Onboarding wizard -> api.admin.createTenant({ slug, name, theme }).
 *  - Per-tenant billing + usage analytics dashboards.
 *  - Live theme editor that writes a tenant's ThemeConfig (the same config the
 *    apps consume at runtime).
 */
export default function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .listTenants()
      .then(setTenants)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load tenants"),
      );
  }, []);

  return (
    <div className="min-h-screen bg-background text-on-surface p-8">
      <header className="flex items-center gap-3 mb-6">
        <MaterialIcon name="apartment" filled size={28} className="text-primary" />
        <h1 className="text-2xl font-serif font-bold">Tenants</h1>
      </header>

      {error && (
        <p className="text-on-surface-variant mb-4">
          API not reachable ({error}). Start <code>@amber/api</code> and seed the
          DB to see live tenants.
        </p>
      )}

      <ul className="space-y-2 max-w-md">
        {tenants.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-3 rounded-2xl bg-surface-container-lowest p-3 shadow-sm"
          >
            <span
              className="w-6 h-6 rounded-md"
              style={{ background: t.theme.colors.primary ?? "#999" }}
            />
            <span className="font-semibold">{t.name}</span>
            <span className="text-on-surface-variant text-sm">/{t.slug}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
