import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "@amber/api-client";
import type { AuthUser, Permission, TenantOption } from "@amber/domain";
import { api } from "../lib/api";
import { getStoredToken, setStoredToken } from "../lib/auth-token";
import { setStoredTenantSlug } from "../lib/auth-tenant";

type AuthStatus = "loading" | "authed" | "anon";

/**
 * Outcome of an email-first login: either signed straight in (one restaurant) or
 * a `select_tenant` step (the user belongs to several — show a picker, then call
 * `selectTenant` with the ticket + chosen tenant id).
 */
export type LoginOutcome =
  | { kind: "authenticated"; user: AuthUser }
  | { kind: "select_tenant"; ticket: string; tenants: TenantOption[] };

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** True if the current user holds the given permission. */
  can: (permission: Permission) => boolean;
  /** Sign in by email+password; resolves to the outcome, throws ApiError on failure. */
  login: (email: string, password: string) => Promise<LoginOutcome>;
  /** Step two of a multi-tenant login: redeem the ticket for the chosen tenant. */
  selectTenant: (ticket: string, tenantId: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Owns the authenticated session for restaurant-admin. On mount it restores the
 * session from the persisted token (`GET /auth/me`); `login`/`logout` write/clear
 * it. `can()` is the single source of truth for permission checks across nav
 * filtering (Shell) and route guards (RequirePermission). RBAC is enforced
 * client-side here; the API enforces the same checks once every route is gated.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  // Restore the session from a persisted token on first load.
  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();
    if (!token) {
      setStatus("anon");
      return;
    }
    api.auth
      .me()
      .then((u) => {
        if (cancelled) return;
        // Keep the stored slug in sync with the token's tenant (covers a token
        // restored from a previous session where the slug wasn't yet persisted).
        setStoredTenantSlug(u.tenantSlug);
        setUser(u);
        setStatus("authed");
      })
      .catch((err) => {
        if (cancelled) return;
        // Expired/invalid token (or revoked access) — clear and require re-login.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setStoredToken(null);
        }
        setUser(null);
        setStatus("anon");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Persist the session (token + tenant slug) and flip to authed. */
  const establish = useCallback((token: string, u: AuthUser) => {
    setStoredToken(token);
    setStoredTenantSlug(u.tenantSlug);
    setUser(u);
    setStatus("authed");
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const result = await api.auth.login(email, password);
      if (result.kind === "authenticated") {
        establish(result.token, result.user);
        return { kind: "authenticated", user: result.user };
      }
      // Multiple restaurants — defer to the picker; no session yet.
      return { kind: "select_tenant", ticket: result.ticket, tenants: result.tenants };
    },
    [establish],
  );

  const selectTenant = useCallback(
    async (ticket: string, tenantId: string): Promise<AuthUser> => {
      const { token, user: u } = await api.auth.selectTenant(ticket, tenantId);
      establish(token, u);
      return u;
    },
    [establish],
  );

  const logout = useCallback(() => {
    setStoredToken(null);
    setStoredTenantSlug(null);
    setUser(null);
    setStatus("anon");
  }, []);

  const can = useCallback(
    (permission: Permission) => !!user?.permissions.includes(permission),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, can, login, selectTenant, logout }),
    [status, user, can, login, selectTenant, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
