import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@amber/api-client";
import {
  PERMISSION_LABELS,
  type Permission,
  type Role,
} from "@amber/domain";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { PermissionChecklist } from "../components/PermissionChecklist";
import { withRetry } from "../lib/retry";
import { PinnerLoader, TableSkeleton } from "../components/Skeleton";

interface Draft {
  id?: string;
  name: string;
  permissions: Permission[];
  protected: boolean;
}

const EMPTY: Draft = { name: "", permissions: [], protected: false };

/**
 * Custom-role management (/settings/roles). The Admin creates freely-named roles
 * and picks each one's permissions — roles are bundles of the fixed permission
 * catalog. Protected roles (the Admin lockout role) can't be deleted. See
 * SETTINGS.md §B.
 */
export function RolesPage() {
  const { user } = useAuth();
  // Only an Admin may edit the protected (Admin) role — mirror the API guard.
  const amAdmin = !!user?.roleProtected;
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Distinguish "the list failed to load" from "the tenant has no roles" — a
  // timed-out GET must not render the misleading "No roles yet" empty state.
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    api.roles
      .list()
      .then(setRoles)
      .catch((e) => {
        setError(messageOf(e));
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function save() {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (draft.id) {
        const roleId = draft.id;
        await withRetry(() =>
          api.roles.update(roleId, {
            name: draft.name.trim(),
            permissions: draft.permissions,
          }),
        );
      } else {
        // Not retried: a create is non-idempotent (see retry.ts's policy).
        await api.roles.create({
          name: draft.name.trim(),
          permissions: draft.permissions,
        });
      }
      setDraft(null);
      load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(role: Role) {
    if (!confirm(`Delete the "${role.name}" role?`)) return;
    setError(null);
    try {
      await withRetry(() => api.roles.remove(role.id));
      load();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <div className="space-y-lg">
      <header className="flex flex-wrap items-center justify-between gap-sm">
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">Roles</h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Name your own roles and choose what each can do.
          </p>
        </div>
        <button
          onClick={() => setDraft({ ...EMPTY })}
          className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container"
        >
          <Icon name="add" size={18} /> New Role
        </button>
      </header>

      {error && (
        <p className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest">
        {loading ? (
          <>
            <PinnerLoader />
            <TableSkeleton rows={4} cols={2} />
          </>
        ) : loadFailed ? (
          <div className="flex items-center justify-between gap-md px-xl py-lg">
            <p className="font-body-md text-body-md text-on-surface-variant">
              Couldn’t load roles.
            </p>
            <button
              onClick={load}
              className="flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <Icon name="refresh" size={18} /> Retry
            </button>
          </div>
        ) : roles.length === 0 ? (
          <p className="px-xl py-lg font-body-md text-body-md text-on-surface-variant">
            No roles yet.
          </p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {roles.map((role) => (
              <li key={role.id} className="flex items-start justify-between gap-md px-xl py-lg">
                <div className="min-w-0">
                  <div className="flex items-center gap-sm">
                    <span className="font-label-md text-[15px] font-bold text-on-surface">
                      {role.name}
                    </span>
                    {role.protected && (
                      <span className="rounded-full bg-secondary-container px-sm py-[2px] font-label-md text-[11px] text-on-secondary-container">
                        Protected
                      </span>
                    )}
                  </div>
                  <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
                    {role.permissions.length === 0
                      ? "No permissions"
                      : role.permissions
                          .map((p) => PERMISSION_LABELS[p])
                          .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-xs">
                  {role.protected && !amAdmin ? (
                    <span className="flex items-center gap-xs rounded-full bg-surface-container-low px-sm py-[2px] font-label-md text-[11px] text-on-surface-variant">
                      <Icon name="lock" size={14} /> Admin only
                    </span>
                  ) : (
                  <button
                    onClick={() =>
                      setDraft({
                        id: role.id,
                        name: role.name,
                        permissions: [...role.permissions],
                        protected: role.protected,
                      })
                    }
                    className="rounded-lg p-sm text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
                    aria-label="Edit role"
                  >
                    <Icon name="edit" size={20} />
                  </button>
                  )}
                  {!role.protected && (
                    <button
                      onClick={() => remove(role)}
                      className="rounded-lg p-sm text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
                      aria-label="Delete role"
                    >
                      <Icon name="delete" size={20} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {draft && (
        <Modal
          title={draft.id ? "Edit Role" : "New Role"}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button
                onClick={() => setDraft(null)}
                className="rounded-full px-lg py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !draft.name.trim()}
                className="rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <div className="space-y-lg">
            <div>
              <label className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface">
                Role name
              </label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Floor Manager, Head Chef"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface">
                Permissions
              </label>
              {draft.protected && (
                <p className="mb-sm font-body-md text-[12px] text-on-surface-variant">
                  This is a protected role — it must keep “Manage Team”.
                </p>
              )}
              <PermissionChecklist
                value={draft.permissions}
                onChange={(permissions) => setDraft({ ...draft, permissions })}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}
