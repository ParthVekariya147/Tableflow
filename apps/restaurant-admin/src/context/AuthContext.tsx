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
import type { AuthUser, Permission } from "@amber/domain";
import { api } from "../lib/api";
import { getStoredToken, setStoredToken } from "../lib/auth-token";

type AuthStatus = "loading" | "authed" | "anon";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** True if the current user holds the given permission. */
  can: (permission: Permission) => boolean;
  /** Sign in; resolves to the user on success, throws ApiError on failure. */
  login: (email: string, password: string) => Promise<AuthUser>;
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

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: u } = await api.auth.login(email, password);
    setStoredToken(token);
    setUser(u);
    setStatus("authed");
    return u;
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
    setStatus("anon");
  }, []);

  const can = useCallback(
    (permission: Permission) => !!user?.permissions.includes(permission),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, can, login, logout }),
    [status, user, can, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
