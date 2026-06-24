import { PERMISSIONS, PERMISSION_LABELS, type Permission } from "@amber/domain";

/**
 * The fixed permission catalog as a checkbox grid. Used by the role builder and
 * the per-member override editor — the single place permission keys become UI.
 */
export function PermissionChecklist({
  value,
  onChange,
  disabled,
}: {
  value: Permission[];
  onChange: (next: Permission[]) => void;
  disabled?: boolean;
}) {
  function toggle(perm: Permission, on: boolean) {
    onChange(on ? [...value, perm] : value.filter((p) => p !== perm));
  }

  return (
    <div className="grid grid-cols-1 gap-xs sm:grid-cols-2">
      {PERMISSIONS.map((perm) => {
        const checked = value.includes(perm);
        return (
          <label
            key={perm}
            className={`flex items-center gap-sm rounded-lg border px-md py-sm transition-colors ${
              checked
                ? "border-primary bg-primary-container/10"
                : "border-outline-variant"
            } ${disabled ? "opacity-60" : "cursor-pointer hover:bg-surface-container-low"}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(e) => toggle(perm, e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="flex flex-col">
              <span className="font-label-md text-label-md text-on-surface">
                {PERMISSION_LABELS[perm]}
              </span>
              <span className="font-data-mono text-[11px] text-on-surface-variant">
                {perm}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
