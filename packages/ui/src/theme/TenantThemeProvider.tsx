import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { Tenant } from "@amber/domain";
import { themeColorsToCssVars } from "./colors.js";

interface TenantContextValue {
  tenant: Tenant;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/** Access the active tenant. Throws if used outside TenantThemeProvider. */
export function useTenant(): Tenant {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used within a <TenantThemeProvider>");
  }
  return ctx.tenant;
}

export interface TenantThemeProviderProps {
  tenant: Tenant;
  /** Element to scope the theme to. Defaults to document.documentElement. */
  target?: HTMLElement | null;
  children: ReactNode;
}

/**
 * Injects the active tenant's brand into the DOM at runtime:
 *  - overrides the --ag-* color variables with the tenant's hex values
 *  - sets the font-family variables
 *  - loads any tenant font <link> hrefs
 *
 * This is the mechanism behind "one codebase, many branded tenants": the same
 * components render every restaurant; only these variables change.
 */
export function TenantThemeProvider({
  tenant,
  target,
  children,
}: TenantThemeProviderProps) {
  const cssVars = useMemo(() => {
    const vars = themeColorsToCssVars(tenant.theme.colors);
    const { sans, serif } = tenant.theme.typography;
    if (sans) vars["--ag-font-sans"] = sans;
    if (serif) vars["--ag-font-serif"] = serif;
    return vars;
  }, [tenant]);

  useEffect(() => {
    const el = target ?? document.documentElement;
    for (const [key, value] of Object.entries(cssVars)) {
      el.style.setProperty(key, value);
    }
    el.dataset.tenant = tenant.slug;
    el.dataset.themeMode = tenant.theme.mode;
    return () => {
      for (const key of Object.keys(cssVars)) el.style.removeProperty(key);
    };
  }, [cssVars, target, tenant.slug, tenant.theme.mode]);

  // Load tenant-specific font stylesheets (deduped by href).
  useEffect(() => {
    const links = tenant.theme.typography.fontLinks ?? [];
    const created: HTMLLinkElement[] = [];
    for (const href of links) {
      if (document.querySelector(`link[href="${href}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      created.push(link);
    }
    return () => created.forEach((l) => l.remove());
  }, [tenant.theme.typography.fontLinks]);

  const value = useMemo<TenantContextValue>(() => ({ tenant }), [tenant]);

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}
