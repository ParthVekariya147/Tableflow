import { useEffect, useState } from "react";
import type { TenantCredential } from "@amber/api-client";
import { MaterialIcon } from "@amber/ui";
import { api } from "../api";
import { Spinner } from "../components/Skeleton";

export function CredentialsPage() {
  const [rows, setRows] = useState<TenantCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Reset-password modal state
  const [target, setTarget] = useState<TenantCredential | null>(null);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .getCredentials()
      .then(setRows)
      .catch((e) => setError(e?.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = rows.filter(
    (r) =>
      !search ||
      r.tenantName.toLowerCase().includes(search.toLowerCase()) ||
      r.tenantSlug.toLowerCase().includes(search.toLowerCase()) ||
      (r.ownerEmail ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  function openReset(row: TenantCredential) {
    setTarget(row);
    setNewPw("");
    setConfirmPw("");
    setShowPw(false);
    setSaveError(null);
  }

  function closeModal() {
    setTarget(null);
    setSaveError(null);
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !target.ownerUserId) return;
    if (newPw !== confirmPw) { setSaveError("Passwords do not match"); return; }
    if (newPw.length < 8) { setSaveError("Password must be at least 8 characters"); return; }
    setSaving(true);
    setSaveError(null);
    try {
      await api.admin.resetOwnerPassword(target.tenantId, target.ownerUserId, newPw);
      setSavedFor(target.tenantName);
      closeModal();
      // Refresh row's hasPassword flag
      setRows((prev) =>
        prev.map((r) => r.tenantId === target.tenantId ? { ...r, hasPassword: true } : r),
      );
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to reset password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold">Tenant Credentials</h1>
          <p className="text-sm text-on-surface-variant">
            Owner login email and password status for every tenant.
          </p>
        </div>
      </header>

      {/* Search */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <MaterialIcon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            placeholder="Search tenant or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-outline-variant bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Success banner */}
      {savedFor && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-secondary bg-secondary/5 px-4 py-3 text-sm">
          <MaterialIcon name="check_circle" size={18} className="text-secondary" />
          <span>Password updated for <strong>{savedFor}</strong>.</span>
          <button onClick={() => setSavedFor(null)} className="ml-auto text-on-surface-variant hover:text-on-surface">
            <MaterialIcon name="close" size={16} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
        {loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-on-surface-variant">
            <Spinner size={20} />
            Loading credentials…
          </div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center text-sm text-error">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-on-surface-variant">
            No tenants found.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Owner email</th>
                <th className="px-4 py-3">Owner name</th>
                <th className="px-4 py-3">Password</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr
                  key={row.tenantId}
                  className={`${i < filtered.length - 1 ? "border-b border-surface-container" : ""} hover:bg-surface-container-low/50`}
                >
                  <td className="px-4 py-3 font-semibold">{row.tenantName}</td>
                  <td className="px-4 py-3 font-mono text-on-surface-variant">{row.tenantSlug}</td>
                  <td className="px-4 py-3">
                    {row.ownerEmail ? (
                      <span className="font-mono">{row.ownerEmail}</span>
                    ) : (
                      <span className="italic text-on-surface-variant">No owner set</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{row.ownerName ?? "—"}</td>
                  <td className="px-4 py-3">
                    {row.ownerUserId ? (
                      row.hasPassword ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary/10 px-2.5 py-0.5 text-xs font-semibold text-secondary">
                          <MaterialIcon name="lock" size={13} />
                          Set
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-error/10 px-2.5 py-0.5 text-xs font-semibold text-error">
                          <MaterialIcon name="lock_open" size={13} />
                          Not set
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-on-surface-variant">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        row.tenantActive
                          ? "bg-primary/10 text-primary"
                          : "bg-surface-container text-on-surface-variant"
                      }`}
                    >
                      {row.tenantActive ? "Active" : "Suspended"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.ownerUserId ? (
                      <button
                        onClick={() => openReset(row)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-semibold hover:bg-surface-container-low"
                      >
                        <MaterialIcon name="key" size={14} />
                        Reset password
                      </button>
                    ) : (
                      <span className="text-xs text-on-surface-variant">No admin user</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reset-password modal */}
      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-serif text-lg font-bold">Reset password</h2>
                <p className="text-sm text-on-surface-variant">
                  Set a new login password for <strong>{target.tenantName}</strong>'s owner account.
                </p>
              </div>
              <button onClick={closeModal} className="ml-2 rounded-lg p-1 hover:bg-surface-container-low">
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            <div className="mb-4 rounded-xl bg-surface-container-low px-4 py-3 text-sm">
              <span className="text-on-surface-variant">Owner email: </span>
              <span className="font-mono font-semibold">{target.ownerEmail}</span>
            </div>

            <form onSubmit={handleReset} className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  New password <span className="normal-case font-normal">(min 8 chars)</span>
                </span>
                <div className="relative">
                  <input
                    autoFocus
                    type={showPw ? "text" : "password"}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 pr-9 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                    tabIndex={-1}
                  >
                    <MaterialIcon name={showPw ? "visibility_off" : "visibility"} size={18} />
                  </button>
                </div>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Confirm password
                </span>
                <input
                  type={showPw ? "text" : "password"}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Re-enter password"
                  className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-primary ${
                    confirmPw && newPw !== confirmPw ? "border-error" : "border-outline-variant"
                  }`}
                />
                {confirmPw && newPw !== confirmPw && (
                  <p className="mt-1 text-xs text-error">Passwords do not match</p>
                )}
              </label>

              {saveError && (
                <p className="rounded-lg bg-error-container px-3 py-2 text-sm text-on-error-container">
                  {saveError}
                </p>
              )}

              <div className="flex justify-end gap-3 border-t border-surface-container pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !newPw || newPw !== confirmPw}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
                >
                  {saving ? <Spinner size={14} /> : <MaterialIcon name="key" size={16} />}
                  {saving ? "Saving…" : "Update password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
