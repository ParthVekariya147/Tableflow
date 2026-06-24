import { useEffect, useState, type ReactNode } from "react";
import { TenantThemeProvider } from "@amber/ui";
import type { Tenant } from "@amber/domain";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { defaultTenant } from "../tenant/defaultTenant";

/**
 * Applies the **logged-in tenant's** brand (colors, fonts, name, logo) to the
 * whole admin app at runtime — the multi-tenant theming engine. Before sign-in
 * (or while auth resolves) it falls back to the Amber platform default so the
 * login screen is Amber-branded. After login it fetches the active tenant
 * (`api.tenant.current()`, scoped to the stored slug) and re-themes; on logout
 * it reverts. Components read the active tenant via `useTenant()` from @amber/ui.
 */
export function TenantThemeGate({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [tenant, setTenant] = useState<Tenant>(defaultTenant);

  useEffect(() => {
    if (status !== "authed") {
      setTenant(defaultTenant);
      return;
    }
    let cancelled = false;
    api.tenant
      .current()
      .then((t) => {
        if (!cancelled) setTenant(t);
      })
      .catch(() => {
        // Fall back to the platform brand if the tenant can't be loaded.
        if (!cancelled) setTenant(defaultTenant);
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch when the active tenant changes (a login to a different restaurant).
  }, [status, user?.tenantId]);

  return <TenantThemeProvider tenant={tenant}>{children}</TenantThemeProvider>;
}
