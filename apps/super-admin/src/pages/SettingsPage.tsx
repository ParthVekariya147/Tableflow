import { useEffect, useState } from "react";
import type { AuthUser } from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import { api } from "../api";
import { Bone } from "../components/Skeleton";

/**
 * Operator profile + platform policy. The profile card is real (synced
 * Supabase/Prisma `User` row). The master-password rotation and policy
 * toggles are visual-only, matching the design mock's own treatment of
 * "Log every impersonation — cannot be disabled": there's no
 * `PATCH /admin/settings` endpoint, and `PLATFORM_MASTER_PASSWORD` is an
 * `.env` value rotated by whoever has shell access, not through this UI.
 */
export function SettingsPage() {
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.auth
      .syncProfile()
      .then(setProfile)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load profile"),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-2xl font-bold">Settings</h1>
        <p className="text-sm text-on-surface-variant">
          Your profile and platform policy
        </p>
      </header>

      {error && <p className="mb-4 text-error">{error}</p>}

      <div className="grid max-w-4xl grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
          <div className="mb-4 text-sm font-semibold text-on-surface-variant">
            Operator profile
          </div>
          {loading ? (
            <div className="flex flex-col gap-3">
              <div>
                <Bone className="mb-1 h-3 w-12" />
                <Bone className="h-9 w-full rounded-lg" />
              </div>
              <div>
                <Bone className="mb-1 h-3 w-12" />
                <Bone className="h-9 w-full rounded-lg" />
              </div>
              <div>
                <Bone className="mb-1 h-3 w-10" />
                <Bone className="h-7 w-24 rounded-full" />
              </div>
            </div>
          ) : (
          <div className="flex flex-col gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Name
              </span>
              <input
                readOnly
                value={profile?.name ?? ""}
                className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Email
              </span>
              <input
                readOnly
                value={profile?.email ?? ""}
                className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
            </label>
            <div>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Role
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-container px-3 py-1.5 text-sm font-semibold text-on-primary-container">
                {profile?.isSuperAdmin ? "Super admin" : "—"}
              </span>
            </div>
            <p className="text-xs text-on-surface-variant">
              Profile is managed in Supabase Auth — there's no edit form
              here yet.
            </p>
          </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <div className="mb-2 text-sm font-semibold text-on-surface-variant">
              Platform master password
            </div>
            <p className="mb-3 text-xs text-on-surface-variant">
              Required to impersonate any tenant. It's the{" "}
              <code>PLATFORM_MASTER_PASSWORD</code> environment variable on{" "}
              <code>services/api</code> — rotate it there; there's no API to
              do it from this screen.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                disabled
                type="password"
                value="••••••••••••"
                className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface px-3 py-2 font-mono text-sm opacity-60"
              />
              <button
                disabled
                title="Rotate via the server's .env, not this UI"
                className="flex-shrink-0 rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold opacity-50"
              >
                Rotate
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-on-surface-variant">
              Platform policy
            </div>
            <div className="flex items-center justify-between border-b border-outline-variant py-2.5">
              <div>
                <div className="text-sm font-medium">
                  Auto-suspend past-due tenants
                </div>
                <div className="text-xs text-on-surface-variant">
                  Not implemented — no scheduled job exists yet
                </div>
              </div>
              <span className="inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full bg-outline-variant opacity-60">
                <MaterialIcon name="close" size={14} className="ml-1.5 text-on-surface-variant" />
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <div>
                <div className="text-sm font-medium">
                  Log every impersonation
                </div>
                <div className="text-xs text-on-surface-variant">
                  Writes to <code>ImpersonationLog</code> — cannot be disabled
                </div>
              </div>
              <span className="inline-flex h-6 w-11 flex-shrink-0 items-center justify-end rounded-full bg-primary pr-0.5 opacity-80">
                <span className="h-5 w-5 rounded-full bg-white shadow" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
