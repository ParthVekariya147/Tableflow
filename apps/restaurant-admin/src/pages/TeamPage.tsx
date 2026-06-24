import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@amber/api-client";
import {
  effectivePermissions,
  PERMISSION_LABELS,
  type Membership,
  type Permission,
  type Role,
} from "@amber/domain";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { Toggle } from "../components/Toggle";
import { PermissionChecklist } from "../components/PermissionChecklist";

/** New members are created with this password until email invites land. */
const DEFAULT_MEMBER_PASSWORD = "changeme123";

interface AddDraft {
  kind: "add";
  name: string;
  email: string;
  roleId: string;
}
interface EditDraft {
  kind: "edit";
  member: Membership;
  roleId: string;
  /** Whether to override the role's permissions for this user. */
  customize: boolean;
  permissions: Permission[];
  active: boolean;
}
type Draft = AddDraft | EditDraft;

/**
 * Team/user management (/settings/team) — the Admin's control panel. Add people,
 * assign a role, and grant/revoke individual permissions per user (a non-empty
 * override is that user's complete effective set). The API blocks removing the
 * last admin. See SETTINGS.md §B.
 */
export function TeamPage() {
  const [members, setMembers] = useState<Membership[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.members.list(), api.roles.list()])
      .then(([m, r]) => {
        setMembers(m);
        setRoles(r);
      })
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  function roleName(id: string): string {
    return roles.find((r) => r.id === id)?.name ?? "—";
  }

  function effectiveOf(m: Membership): Permission[] {
    const role = m.role ?? roles.find((r) => r.id === m.roleId);
    return effectivePermissions(role?.permissions ?? [], m.permissions);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      if (draft.kind === "add") {
        if (!draft.name.trim() || !draft.email.trim() || !draft.roleId) return;
        await api.members.add({
          name: draft.name.trim(),
          email: draft.email.trim(),
          roleId: draft.roleId,
        });
      } else {
        await api.members.update(draft.member.id, {
          roleId: draft.roleId,
          // Empty override = inherit the role; otherwise the custom set wins.
          permissions: draft.customize ? draft.permissions : [],
          active: draft.active,
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

  async function remove(m: Membership) {
    if (!confirm(`Remove ${m.user?.name ?? "this member"} from the team?`)) return;
    setError(null);
    try {
      await api.members.remove(m.id);
      load();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <div className="space-y-lg">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">Team</h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Add people, set their role, and fine-tune what each can access.
          </p>
        </div>
        <button
          onClick={() =>
            setDraft({ kind: "add", name: "", email: "", roleId: roles[0]?.id ?? "" })
          }
          className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container"
        >
          <Icon name="person_add" size={18} /> Add Member
        </button>
      </header>

      {error && (
        <p className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest">
        {loading ? (
          <p className="px-xl py-lg font-body-md text-body-md text-on-surface-variant">
            Loading…
          </p>
        ) : members.length === 0 ? (
          <p className="px-xl py-lg font-body-md text-body-md text-on-surface-variant">
            No team members yet.
          </p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {members.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-md px-xl py-lg">
                <div className="min-w-0">
                  <div className="flex items-center gap-sm">
                    <span className="font-label-md text-[15px] font-bold text-on-surface">
                      {m.user?.name ?? "Unknown"}
                    </span>
                    <span className="rounded-full bg-primary-container/20 px-sm py-[2px] font-label-md text-[11px] text-primary">
                      {roleName(m.roleId)}
                    </span>
                    {m.permissions.length > 0 && (
                      <span className="rounded-full bg-tertiary/15 px-sm py-[2px] font-label-md text-[11px] text-on-surface-variant">
                        Custom access
                      </span>
                    )}
                    {!m.active && (
                      <span className="rounded-full bg-error-container px-sm py-[2px] font-label-md text-[11px] text-on-error-container">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
                    {m.user?.email}
                  </p>
                  <p className="mt-xs font-body-md text-[12px] text-on-surface-variant">
                    {effectiveOf(m)
                      .map((p) => PERMISSION_LABELS[p])
                      .join(" · ") || "No access"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-xs">
                  <button
                    onClick={() =>
                      setDraft({
                        kind: "edit",
                        member: m,
                        roleId: m.roleId,
                        customize: m.permissions.length > 0,
                        permissions:
                          m.permissions.length > 0
                            ? [...m.permissions]
                            : [...(m.role?.permissions ?? roles.find((r) => r.id === m.roleId)?.permissions ?? [])],
                        active: m.active,
                      })
                    }
                    className="rounded-lg p-sm text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
                    aria-label="Edit member"
                  >
                    <Icon name="edit" size={20} />
                  </button>
                  <button
                    onClick={() => remove(m)}
                    className="rounded-lg p-sm text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
                    aria-label="Remove member"
                  >
                    <Icon name="delete" size={20} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {draft && (
        <Modal
          title={draft.kind === "add" ? "Add Member" : `Edit ${draft.member.user?.name ?? "Member"}`}
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
                disabled={saving}
                className="rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <div className="space-y-lg">
            {draft.kind === "add" ? (
              <>
                <Field label="Name">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Role">
                  <RoleSelect
                    roles={roles}
                    value={draft.roleId}
                    onChange={(roleId) => setDraft({ ...draft, roleId })}
                  />
                </Field>
                <p className="rounded-lg bg-surface-container-low px-md py-sm font-body-md text-[12px] text-on-surface-variant">
                  New members sign in with the temporary password{" "}
                  <code className="font-data-mono">{DEFAULT_MEMBER_PASSWORD}</code>.
                </p>
              </>
            ) : (
              <>
                <Field label="Role">
                  <RoleSelect
                    roles={roles}
                    value={draft.roleId}
                    onChange={(roleId) => {
                      const rolePerms =
                        roles.find((r) => r.id === roleId)?.permissions ?? [];
                      setDraft({
                        ...draft,
                        roleId,
                        // If not customizing, mirror the new role's permissions in the UI.
                        permissions: draft.customize ? draft.permissions : [...rolePerms],
                      });
                    }}
                  />
                </Field>

                <div className="flex items-center justify-between rounded-lg border border-outline-variant px-md py-sm">
                  <span className="font-label-md text-label-md text-on-surface">
                    Customize access for this user
                  </span>
                  <Toggle
                    checked={draft.customize}
                    onChange={(customize) => setDraft({ ...draft, customize })}
                  />
                </div>

                {draft.customize && (
                  <div>
                    <p className="mb-sm font-body-md text-[12px] text-on-surface-variant">
                      Overrides the role — this becomes exactly what this user can do.
                    </p>
                    <PermissionChecklist
                      value={draft.permissions}
                      onChange={(permissions) => setDraft({ ...draft, permissions })}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between rounded-lg border border-outline-variant px-md py-sm">
                  <span className="font-label-md text-label-md text-on-surface">Active</span>
                  <Toggle
                    checked={draft.active}
                    onChange={(active) => setDraft({ ...draft, active })}
                  />
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface">
        {label}
      </label>
      {children}
    </div>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
}: {
  roles: Role[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    >
      {roles.length === 0 && <option value="">No roles — create one first</option>}
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}
