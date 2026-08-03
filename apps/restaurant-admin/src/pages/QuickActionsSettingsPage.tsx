import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@amber/api-client";
import {
  MAX_CUSTOM_QUICK_ACTIONS,
  QUICK_ACTION_ICONS,
  QUICK_ACTION_SWATCHES,
  mergeQuickActions,
  type QuickAction,
  type QuickActionIcon,
  type QuickActionSwatch,
} from "@amber/domain";
import { api } from "../lib/api";
import { withRetry } from "../lib/retry";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { Toggle } from "../components/Toggle";

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

/** Small colored dot per swatch, used both on list rows and the swatch picker. */
const SWATCH_DOT: Record<QuickActionSwatch, string> = {
  neutral: "bg-stone-300",
  sky: "bg-sky-400",
  amber: "bg-amber-400",
  violet: "bg-violet-400",
  rose: "bg-rose-400",
  emerald: "bg-emerald-400",
};

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `custom-${base || "button"}`;
}

/** A unique id for a new custom button, appending -2/-3/... on collision. */
function uniqueId(label: string, existing: QuickAction[]): string {
  const base = slugify(label);
  if (!existing.some((a) => a.id === base)) return base;
  let n = 2;
  while (existing.some((a) => a.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

interface Draft {
  label: string;
  icon: QuickActionIcon;
  swatch: QuickActionSwatch;
}

const EMPTY_DRAFT: Draft = { label: "", icon: QUICK_ACTION_ICONS[0], swatch: "neutral" };

/**
 * Quick Actions settings (/settings/quick-actions) — the guest Welcome
 * screen's action row (Water/Call Staff/Manager/Full Menu today) is
 * per-tenant configurable: toggle/reorder the built-ins, add up to
 * MAX_CUSTOM_QUICK_ACTIONS custom buttons (own label/icon/color) that ping
 * staff exactly like Call Staff. Mirrors PrinterPage's receipt-sections
 * editor: load `api.tenant.current()`, edit locally, save via
 * `api.tenant.update({ quickActions })`.
 */
export function QuickActionsSettingsPage() {
  const navigate = useNavigate();
  const committedRef = useRef<QuickAction[]>([]);

  const [actions, setActions] = useState<QuickAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    let active = true;
    api.tenant
      .current()
      .then((t) => {
        if (!active) return;
        const seeded = mergeQuickActions(t.quickActions);
        committedRef.current = seeded;
        setActions(seeded);
      })
      .catch((e) => active && setError(messageOf(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const dirty = JSON.stringify(actions) !== JSON.stringify(committedRef.current);
  const customCount = actions.filter((a) => !a.builtIn).length;

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...actions];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setActions(next);
  }

  function toggle(index: number, enabled: boolean) {
    const next = [...actions];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, enabled };
    setActions(next);
  }

  function removeCustom(id: string) {
    if (!confirm("Remove this button? It'll disappear from the Welcome screen once saved.")) return;
    setActions((prev) => prev.filter((a) => a.id !== id));
  }

  function addCustom() {
    if (!draft || !draft.label.trim()) return;
    const id = uniqueId(draft.label.trim(), actions);
    setActions((prev) => [
      ...prev,
      {
        id,
        kind: "service_request",
        builtIn: false,
        enabled: true,
        label: draft.label.trim(),
        icon: draft.icon,
        swatch: draft.swatch,
      },
    ]);
    setDraft(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await withRetry(() => api.tenant.update({ quickActions: actions }));
      const seeded = mergeQuickActions(updated.quickActions);
      committedRef.current = seeded;
      setActions(seeded);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-lg">
      <header className="flex items-center gap-sm">
        <button
          onClick={() => navigate("/settings")}
          className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-surface-container-low"
          aria-label="Back to settings"
        >
          <Icon name="arrow_back" />
        </button>
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">
            Quick Actions
          </h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Customize the buttons guests see on the Welcome screen.
          </p>
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-xxl">
          <Icon name="progress_activity" size={32} className="ag-spin text-on-surface-variant" />
        </div>
      ) : (
        <div className="max-w-[560px] space-y-lg">
          <section className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
            <h3 className="mb-md font-title-lg text-title-lg text-on-surface">
              Buttons
            </h3>
            <p className="mb-md font-body-md text-body-md text-on-surface-variant">
              Drag to reorder, toggle to show or hide. Built-in buttons keep
              their name, icon and color — add your own below for anything
              else guests should be able to ask for.
            </p>
            <ul className="space-y-xs">
              {actions.map((action, index) => (
                <li
                  key={action.id}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) move(dragIndex, index);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className={`flex items-center gap-sm rounded-lg border border-outline-variant bg-surface px-sm py-sm transition-opacity ${
                    dragIndex === index ? "opacity-40" : ""
                  } ${!action.enabled ? "opacity-60" : ""}`}
                >
                  <span className="cursor-grab text-on-surface-variant" aria-hidden>
                    <Icon name="drag_indicator" size={18} />
                  </span>
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${SWATCH_DOT[action.swatch]}`}
                  >
                    <Icon name={action.icon} size={16} className="text-white" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-label-md text-label-md text-on-surface">
                      {action.label}
                    </span>
                    <span className="block font-body-md text-[11px] text-on-surface-variant">
                      {action.builtIn
                        ? action.kind === "full_menu"
                          ? "Opens the menu"
                          : "Built-in staff request"
                        : "Custom staff request"}
                    </span>
                  </span>
                  {!action.builtIn && (
                    <button
                      onClick={() => removeCustom(action.id)}
                      className="rounded-lg p-xs text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
                      aria-label={`Delete ${action.label}`}
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  )}
                  <Toggle checked={action.enabled} onChange={(next) => toggle(index, next)} />
                </li>
              ))}
            </ul>

            <button
              onClick={() => setDraft({ ...EMPTY_DRAFT })}
              disabled={customCount >= MAX_CUSTOM_QUICK_ACTIONS}
              className="mt-md flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface transition-colors hover:border-primary disabled:opacity-50"
            >
              <Icon name="add" size={18} /> Add custom button
            </button>
            {customCount >= MAX_CUSTOM_QUICK_ACTIONS && (
              <p className="mt-sm font-body-md text-[12px] text-on-surface-variant">
                You've reached the limit of {MAX_CUSTOM_QUICK_ACTIONS} custom buttons.
              </p>
            )}
          </section>

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-full bg-primary px-xl py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}

      {draft && (
        <Modal
          title="New Custom Button"
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
                onClick={addCustom}
                disabled={!draft.label.trim()}
                className="rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
              >
                Add
              </button>
            </>
          }
        >
          <div className="space-y-lg">
            <div>
              <label className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface">
                Label
              </label>
              <input
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value.slice(0, 24) })}
                placeholder="e.g. Call Sommelier"
                maxLength={24}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface">
                Icon
              </label>
              <div className="grid grid-cols-8 gap-xs">
                {QUICK_ACTION_ICONS.map((icon) => (
                  <button
                    key={icon}
                    onClick={() => setDraft({ ...draft, icon })}
                    aria-label={icon}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                      draft.icon === icon
                        ? "border-primary bg-primary-container/30 text-primary"
                        : "border-outline-variant text-on-surface-variant hover:border-primary"
                    }`}
                  >
                    <Icon name={icon} size={18} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-base block font-label-md text-label-md uppercase tracking-wider text-on-surface">
                Color
              </label>
              <div className="flex gap-sm">
                {QUICK_ACTION_SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    onClick={() => setDraft({ ...draft, swatch })}
                    aria-label={swatch}
                    className={`h-8 w-8 rounded-full ${SWATCH_DOT[swatch]} ${
                      draft.swatch === swatch ? "ring-2 ring-offset-2 ring-primary" : ""
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
