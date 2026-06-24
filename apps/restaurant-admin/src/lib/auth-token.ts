/**
 * The admin's bearer token, persisted in localStorage so a refresh keeps the
 * session. The api-client reads it via its `getToken` hook (see lib/api.ts), and
 * AuthContext owns writing/clearing it on login/logout.
 */
const TOKEN_KEY = "amber-admin-token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — token stays in-memory only */
  }
}
