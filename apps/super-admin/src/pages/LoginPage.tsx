import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MaterialIcon } from "@amber/ui";
import { signInWithGoogle, signInWithPassword } from "../lib/supabase";
import { api } from "../api";

/**
 * Super-admin login. Auth is Supabase Auth (see PLATFORM_PLAN.md) — this
 * calls supabase-js directly, there is no POST /auth/login on our API.
 * `RequireSession` (App.tsx) redirects here whenever there's no session.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithPassword(email, password);
      await api.auth.syncProfile().catch(() => {});
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3.5">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-primary shadow-md">
            <MaterialIcon name="shield_person" filled size={26} className="text-on-primary" />
          </span>
          <div className="text-center">
            <h1 className="font-serif text-2xl font-bold leading-tight">
              Platform Admin
            </h1>
            <p className="mt-0.5 text-sm text-on-surface-variant">
              Amber &amp; Grain control plane
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-7 shadow-sm"
        >

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-on-surface-variant">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 outline-none focus:border-primary"
          />
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-on-surface-variant">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 outline-none focus:border-primary"
          />
        </label>

        {error && <p className="mb-4 text-sm text-error">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mb-4 w-full rounded-lg bg-primary py-2.5 font-semibold text-on-primary disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div className="mb-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-outline-variant" />
          <span className="text-xs text-on-surface-variant">or</span>
          <div className="h-px flex-1 bg-outline-variant" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="w-full rounded-lg border border-outline-variant py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low"
        >
          Continue with Google
        </button>
        </form>

        <p className="mt-4 text-center text-xs text-on-surface-variant">
          Internal tool · access logged
        </p>
      </div>
    </div>
  );
}
