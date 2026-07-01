import { useState } from "react";
import { ApiError } from "@amber/api-client";
import { Icon } from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

/**
 * Forced password change — rendered above the whole app (see App.tsx) while
 * `AuthUser.mustChangePassword` is true (the member is still on the fixed
 * `changeme123` default a team lead set when adding them). Blocks every route
 * until a new password is set.
 */
export function ChangePasswordPage() {
  const { logout, clearMustChangePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      clearMustChangePassword();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Current password is incorrect."
          : "Couldn't update your password — please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background text-on-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-primary-container/5 blur-[100px]" />
        <div className="absolute -bottom-1/4 -left-1/4 h-[600px] w-[600px] rounded-full bg-secondary-container/10 blur-[80px]" />
      </div>

      <div className="relative z-10 mx-md w-full max-w-[420px] rounded-card bg-surface-container-lowest p-xl shadow-card">
        <div className="mb-lg flex justify-center">
          <div className="flex h-[88px] w-[88px] items-center justify-center rounded-card bg-primary text-display-lg font-bold text-on-primary">
            <Icon name="lock_reset" size={40} />
          </div>
        </div>

        <div className="mb-xl text-center">
          <h1 className="inline-block border-b border-surface-variant pb-base font-headline-md text-headline-md text-primary">
            Set a new password
          </h1>
          <p className="mt-sm font-body-md text-body-md text-on-surface-variant">
            You're still on the default password. Set your own before continuing.
          </p>
        </div>

        <form className="space-y-lg" onSubmit={submit}>
          <div>
            <label
              htmlFor="currentPassword"
              className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface"
            >
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-sm py-sm font-body-md text-body-md text-on-surface transition-colors placeholder:text-outline-variant focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="newPassword"
              className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface"
            >
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-sm py-sm font-body-md text-body-md text-on-surface transition-colors placeholder:text-outline-variant focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface"
            >
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-sm py-sm font-body-md text-body-md text-on-surface transition-colors placeholder:text-outline-variant focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
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
            {busy ? "Saving…" : "Save password"}
            <Icon name="arrow_forward" size={18} />
          </button>
        </form>

        <div className="mt-xl flex items-center justify-between border-t border-outline-variant/30 pt-lg">
          <button
            type="button"
            onClick={logout}
            className="font-label-md text-label-md text-on-surface-variant transition-colors hover:text-primary"
          >
            ← Sign in as someone else
          </button>
        </div>
      </div>
    </div>
  );
}
