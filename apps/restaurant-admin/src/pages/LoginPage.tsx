import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser, TenantOption } from "@amber/domain";
import { Icon } from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { homeRouteFor } from "../lib/nav";

export function LoginPage() {
  const navigate = useNavigate();
  const { login, selectTenant } = useAuth();
  const [username, setUsername] = useState("admin@amberandgrain.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // When the account belongs to several restaurants, we hold the ticket + the
  // choices and render a picker instead of navigating.
  const [choice, setChoice] = useState<{ ticket: string; tenants: TenantOption[] } | null>(
    null,
  );
  const [pickingTenantId, setPickingTenantId] = useState<string | null>(null);

  function goHome(user: AuthUser) {
    // Land on the user's highest-priority allowed page (KDS-only → /kds).
    navigate(homeRouteFor(user.permissions) || "/", { replace: true });
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const outcome = await login(username.trim(), password);
      if (outcome.kind === "authenticated") {
        goHome(outcome.user);
      } else {
        setChoice({ ticket: outcome.ticket, tenants: outcome.tenants });
      }
    } catch {
      setError("Invalid email or password, or no access to any restaurant.");
    } finally {
      setBusy(false);
    }
  }

  async function pickTenant(tenantId: string) {
    if (!choice) return;
    setError(null);
    setBusy(true);
    setPickingTenantId(tenantId);
    try {
      const user = await selectTenant(choice.ticket, tenantId);
      goHome(user);
    } catch {
      setError("That sign-in session expired — please sign in again.");
      setChoice(null);
    } finally {
      setBusy(false);
      setPickingTenantId(null);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background text-on-background">
      {/* Ambient accents */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-primary-container/5 blur-[100px]" />
        <div className="absolute -bottom-1/4 -left-1/4 h-[600px] w-[600px] rounded-full bg-secondary-container/10 blur-[80px]" />
      </div>

      <div className="relative z-10 mx-md w-full max-w-[420px] rounded-card bg-surface-container-lowest p-xl shadow-card">
        <div className="mb-lg flex justify-center">
          <div className="flex h-[88px] w-[88px] items-center justify-center rounded-card bg-primary text-display-lg font-bold text-on-primary">
            A
          </div>
        </div>

        <div className="mb-xl text-center">
          <h1 className="inline-block border-b border-surface-variant pb-base font-headline-md text-headline-md text-primary">
            Amber
          </h1>
          <p className="mt-sm font-body-md text-body-md text-on-surface-variant">
            {choice ? "Choose your restaurant" : "Sign in to your restaurant"}
          </p>
        </div>

        {choice ? (
          <div className="space-y-md">
            <ul className="space-y-sm">
              {choice.tenants.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pickTenant(t.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm text-left transition-colors hover:border-primary hover:bg-surface-container-low disabled:opacity-60"
                  >
                    <span className="flex items-center gap-sm">
                      <Icon name="storefront" className="text-primary" />
                      <span className="font-label-md text-label-md text-on-surface">
                        {t.name}
                      </span>
                    </span>
                    {pickingTenantId === t.id ? (
                      <Icon name="progress_activity" size={18} className="ag-spin text-on-surface-variant" />
                    ) : (
                      <Icon name="arrow_forward" size={18} className="text-on-surface-variant" />
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container"
              >
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                setChoice(null);
                setError(null);
              }}
              className="font-label-md text-label-md text-on-surface-variant transition-colors hover:text-primary"
            >
              ← Use a different account
            </button>
          </div>
        ) : (
        <form className="space-y-lg" onSubmit={signIn}>
          <div>
            <label
              htmlFor="username"
              className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface"
            >
              Username / Email
            </label>
            <div className="relative">
              <Icon
                name="person"
                className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
              />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-sm pl-10 pr-sm font-body-md text-body-md text-on-surface transition-colors placeholder:text-outline-variant focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface"
            >
              Password
            </label>
            <div className="relative">
              <Icon
                name="lock"
                className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
              />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-sm pl-10 pr-sm font-body-md text-body-md text-on-surface transition-colors placeholder:text-outline-variant focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-xs flex w-full items-center justify-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md uppercase tracking-wider text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign In"}
            {busy ? (
              <Icon name="progress_activity" size={18} className="ag-spin" />
            ) : (
              <Icon name="arrow_forward" size={18} />
            )}
          </button>
        </form>
        )}

        <div className="mt-xl flex items-center justify-between border-t border-outline-variant/30 pt-lg">
          <a href="#" className="font-label-md text-label-md text-on-surface-variant transition-colors hover:text-primary">
            Forgot Password?
          </a>
          <span className="font-data-mono text-[12px] text-outline">System v1.2</span>
        </div>
      </div>
    </div>
  );
}
