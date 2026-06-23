import { useRef, useState } from "react";
import { Icon } from "./Icon";
import { Toggle } from "./Toggle";
import { DietaryMark } from "./DietaryMark";
import { useAdmin } from "../store/AdminStore";
import type { MenuItem, ModifierGroup, ModifierInputType } from "../data/types";
import { uid } from "../data/seed";

const SWATCHES = [
  "from-amber-200 to-orange-300",
  "from-rose-200 to-red-300",
  "from-green-200 to-emerald-400",
  "from-stone-300 to-amber-500",
  "from-yellow-200 to-amber-400",
];

const KIND_LABEL: Record<ModifierInputType, string> = {
  single: "Pick one (radio)",
  multiple: "Pick many (checkboxes)",
  toggle: "On/off switches",
  text: "Free text box",
};

const KIND_HINT: Record<ModifierInputType, string> = {
  single: "Guest picks exactly one option, e.g. “Which cheese?”",
  multiple: "Guest picks any number, e.g. “Extra toppings”",
  toggle: "Each option is an independent switch, e.g. “Extra cheese”",
  text: "Guest types free text, e.g. “Special request”. No options.",
};

function emptyGroup(): ModifierGroup {
  return { name: "", inputType: "single", required: false, options: [{ name: "", priceCents: 0 }] };
}

/**
 * Centered modal for creating or editing a menu item, including its custom
 * modifier groups (see MODIFIERS.md). Save dispatches to the store, which sends
 * the full modifier set (replace-on-save). `item === null` means "add new".
 */
export function ItemPanel({
  item,
  defaultCategoryId,
  onClose,
}: {
  item: MenuItem | null;
  defaultCategoryId: string;
  onClose: () => void;
}) {
  const { state, dispatch, uploadImage, currencySymbol } = useAdmin();
  const isEdit = item !== null;

  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? (item.priceCents / 100).toFixed(2) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? defaultCategoryId);
  const [icon, setIcon] = useState(item?.icon ?? "restaurant");
  const [swatch, setSwatch] = useState(item?.swatch ?? SWATCHES[0]!);
  const [imageUrl, setImageUrl] = useState<string | undefined>(item?.imageUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [available, setAvailable] = useState(item?.available ?? true);
  const [dietary, setDietary] = useState<"veg" | "non_veg" | "">(item?.dietary ?? "");
  const [jain, setJain] = useState(item?.jain ?? false);
  const [groups, setGroups] = useState<ModifierGroup[]>(item?.modifierGroups ?? []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const busy = saving || deleting || uploading;

  // ── Modifier group helpers (immutable updates) ──────────────────────────────
  const patchGroup = (gi: number, patch: Partial<ModifierGroup>) =>
    setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const removeGroup = (gi: number) =>
    setGroups((gs) => gs.filter((_, i) => i !== gi));
  const addOption = (gi: number) =>
    patchGroup(gi, { options: [...groups[gi]!.options, { name: "", priceCents: 0 }] });
  const patchOption = (gi: number, oi: number, patch: Partial<ModifierGroup["options"][number]>) =>
    patchGroup(gi, {
      options: groups[gi]!.options.map((o, i) => (i === oi ? { ...o, ...patch } : o)),
    });
  const removeOption = (gi: number, oi: number) =>
    patchGroup(gi, { options: groups[gi]!.options.filter((_, i) => i !== oi) });

  /** Drop blank rows so the server (name min 1) doesn't reject the save. */
  function cleanGroups(): ModifierGroup[] {
    return groups
      .map((g) => ({
        ...g,
        name: g.name.trim(),
        options:
          g.inputType === "text"
            ? []
            : g.options
                .filter((o) => o.name.trim())
                .map((o) => ({ ...o, name: o.name.trim() })),
      }))
      .filter((g) => g.name && (g.inputType === "text" || g.options.length > 0));
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    const preview = URL.createObjectURL(file);
    const prev = imageUrl;
    setImageUrl(preview);
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setImageUrl(url);
    } catch (err) {
      setImageUrl(prev);
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      URL.revokeObjectURL(preview);
    }
  }

  async function save() {
    const priceCents = Math.round((parseFloat(price) || 0) * 100);
    if (!name.trim() || busy) return;
    const modifierGroups = cleanGroups();
    const dietaryValue = dietary || null;
    if (isEdit && item) {
      setSaving(true);
      await dispatch({
        type: "UPDATE_ITEM",
        itemId: item.id,
        patch: { name, description, priceCents, categoryId, icon, swatch, available, dietary: dietaryValue, jain, imageUrl, modifierGroups },
      });
      onClose();
    } else {
      const newItem: MenuItem = {
        id: uid("it"),
        categoryId,
        name,
        description,
        priceCents,
        available,
        dietary: dietaryValue,
        jain,
        icon,
        swatch,
        imageUrl,
        modifierGroups,
      };
      void dispatch({ type: "ADD_ITEM", item: newItem });
      onClose();
    }
  }

  async function remove() {
    if (!item || busy) return;
    setDeleting(true);
    await dispatch({ type: "DELETE_ITEM", itemId: item.id });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-on-background/30 p-md backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-5xl animate-scale-in flex-col overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-lg py-md">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-background">
              {isEdit ? "Edit Item" : "Add Item"}
            </h2>
            <p className="mt-base font-body-md text-body-md text-on-surface-variant">
              {isEdit ? `Modifying ${item?.name}` : "Create a new menu item"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-background"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-xl overflow-y-auto p-lg md:grid-cols-2">
          {/* ── Left: item details ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-xl">
            <section className="flex flex-col gap-sm">
              <label className="font-label-md text-label-md text-on-background">Photo</label>
              <div className={`relative flex h-40 w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br ${swatch}`}>
                {imageUrl ? (
                  <img src={imageUrl} alt={name || "Menu item"} className="h-full w-full object-cover" />
                ) : (
                  <Icon name={icon} size={64} className="text-on-background/70" />
                )}
                {imageUrl && !uploading && (
                  <button
                    type="button"
                    onClick={() => setImageUrl(undefined)}
                    title="Remove photo"
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-lowest/90 text-on-surface-variant backdrop-blur-sm transition-colors hover:text-error"
                  >
                    <Icon name="delete" size={18} />
                  </button>
                )}
                {uploading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-xs bg-on-background/40 text-on-primary backdrop-blur-sm">
                    <Icon name="progress_activity" size={28} className="ag-spin" />
                    <span className="font-label-md text-[11px] uppercase tracking-wider">Uploading…</span>
                  </div>
                )}
              </div>
              {uploadError && <p className="font-body-md text-body-md text-error">{uploadError}</p>}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
              <div className="flex items-center gap-sm">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-xs rounded-full border border-primary bg-surface px-md py-xs font-label-md text-label-md text-primary transition-colors hover:bg-primary-container/10 disabled:opacity-50"
                >
                  <Icon name={uploading ? "progress_activity" : "upload"} size={18} className={uploading ? "ag-spin" : ""} />
                  {uploading ? "Uploading…" : imageUrl ? "Change Photo" : "Upload Photo"}
                </button>
                {!imageUrl && (
                  <div className="flex gap-xs">
                    {SWATCHES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSwatch(s)}
                        className={`h-7 w-7 rounded-full bg-gradient-to-br ${s} ${swatch === s ? "ring-2 ring-primary ring-offset-2" : ""}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="flex flex-col gap-lg">
              <Field label="Item Name">
                <input
                  className="rounded-md border border-outline-variant bg-surface px-sm py-sm font-body-md text-on-background outline-none transition-shadow focus:border-primary focus:ring-1 focus:ring-primary"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Truffle Fries"
                />
              </Field>
              <div className="flex gap-lg">
                <Field label="Price" className="flex-1">
                  <div className="relative">
                    <span className="absolute left-sm top-1/2 -translate-y-1/2 font-data-mono text-on-surface-variant">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded-md border border-outline-variant bg-surface pl-xl pr-sm py-sm font-data-mono text-on-background outline-none transition-shadow focus:border-primary focus:ring-1 focus:ring-primary"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </Field>
                <Field label="Category" className="flex-1">
                  <select
                    className="w-full cursor-pointer rounded-md border border-outline-variant bg-surface px-sm py-sm font-body-md text-on-background outline-none transition-shadow focus:border-primary focus:ring-1 focus:ring-primary"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    {state.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  rows={3}
                  className="resize-none rounded-md border border-outline-variant bg-surface px-sm py-sm font-body-md text-on-background outline-none transition-shadow focus:border-primary focus:ring-1 focus:ring-primary"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description…"
                />
              </Field>
              <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface p-md">
                <span className="font-body-md text-body-md font-bold text-on-background">Available</span>
                <Toggle checked={available} onChange={setAvailable} />
              </div>

              {/* Dietary markers (shown as a corner badge on the customer + menu cards) */}
              <div className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface p-md">
                <div className="flex items-center justify-between gap-md">
                  <span className="font-body-md text-body-md font-bold text-on-background">Dietary</span>
                  <DietaryMark dietary={dietary || null} jain={jain} size={20} />
                </div>
                <Field label="Veg / Non-veg">
                  <select
                    className="w-full cursor-pointer rounded-md border border-outline-variant bg-surface px-sm py-sm font-body-md text-on-background outline-none transition-shadow focus:border-primary focus:ring-1 focus:ring-primary"
                    value={dietary}
                    onChange={(e) => setDietary(e.target.value as "veg" | "non_veg" | "")}
                  >
                    <option value="">— None —</option>
                    <option value="veg">Veg</option>
                    <option value="non_veg">Non-veg</option>
                  </select>
                </Field>
                <label className="flex items-center justify-between gap-md">
                  <span className="font-body-md text-body-md text-on-background">Jain (no roots / onion / garlic)</span>
                  <Toggle checked={jain} onChange={setJain} />
                </label>
              </div>
            </section>
          </div>

          {/* ── Right: modifier builder ────────────────────────────────────── */}
          <div className="flex flex-col gap-md">
            <div className="flex items-center justify-between border-b border-outline-variant pb-xs">
              <h3 className="font-title-lg text-title-lg text-on-background">Modifiers</h3>
              <button
                onClick={() => setGroups((gs) => [...gs, emptyGroup()])}
                className="flex items-center gap-xs rounded-full border border-primary bg-surface px-md py-xs font-label-md text-label-md text-primary transition-colors hover:bg-primary-container/10"
              >
                <Icon name="add" size={18} /> Add group
              </button>
            </div>

            {groups.length === 0 && (
              <p className="rounded-lg border border-dashed border-outline-variant p-md text-center font-body-md text-body-md text-on-surface-variant">
                No modifiers. Add a group for choices like cheese, toppings, spice level, or a notes box.
              </p>
            )}

            {groups.map((g, gi) => (
              <div key={gi} className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface p-md">
                <div className="flex items-center gap-sm">
                  <input
                    className="min-w-0 flex-1 rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-sm font-body-md text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    value={g.name}
                    onChange={(e) => patchGroup(gi, { name: e.target.value })}
                    placeholder="Group name e.g. Cheese"
                  />
                  <button
                    onClick={() => removeGroup(gi)}
                    title="Remove group"
                    className="text-outline transition-colors hover:text-error"
                  >
                    <Icon name="delete" size={20} />
                  </button>
                </div>

                <div className="flex flex-col gap-base">
                  <select
                    className="cursor-pointer rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    value={g.inputType}
                    onChange={(e) => patchGroup(gi, { inputType: e.target.value as ModifierInputType })}
                  >
                    {(Object.keys(KIND_LABEL) as ModifierInputType[]).map((k) => (
                      <option key={k} value={k}>{KIND_LABEL[k]}</option>
                    ))}
                  </select>
                  <p className="font-body-md text-[11px] text-on-surface-variant">{KIND_HINT[g.inputType]}</p>
                </div>

                <div className="flex flex-wrap items-center gap-md">
                  <label className="flex items-center gap-xs font-body-md text-body-md text-on-background">
                    <Toggle checked={g.required ?? false} onChange={(v) => patchGroup(gi, { required: v })} />
                    Required
                  </label>
                  {g.inputType === "multiple" && (
                    <>
                      <label className="flex items-center gap-xs font-body-md text-[12px] text-on-surface-variant">
                        Min
                        <input
                          type="number"
                          min={0}
                          className="w-14 rounded-md border border-outline-variant bg-surface-container-lowest px-xs py-base text-center"
                          value={g.minSelect ?? 0}
                          onChange={(e) => patchGroup(gi, { minSelect: Number(e.target.value) || 0 })}
                        />
                      </label>
                      <label className="flex items-center gap-xs font-body-md text-[12px] text-on-surface-variant">
                        Max
                        <input
                          type="number"
                          min={1}
                          className="w-14 rounded-md border border-outline-variant bg-surface-container-lowest px-xs py-base text-center"
                          value={g.maxSelect ?? ""}
                          placeholder="∞"
                          onChange={(e) => patchGroup(gi, { maxSelect: e.target.value ? Number(e.target.value) : null })}
                        />
                      </label>
                    </>
                  )}
                </div>

                {g.inputType === "text" ? (
                  <input
                    className="rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    value={g.placeholder ?? ""}
                    onChange={(e) => patchGroup(gi, { placeholder: e.target.value })}
                    placeholder="Placeholder hint e.g. “No onions, please”"
                  />
                ) : (
                  <div className="flex flex-col gap-base">
                    {g.options.map((o, oi) => (
                      <div key={oi} className="flex items-center gap-sm">
                        <input
                          className="min-w-0 flex-1 rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-sm font-body-md text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                          value={o.name}
                          onChange={(e) => patchOption(gi, oi, { name: e.target.value })}
                          placeholder="Option e.g. Mozzarella"
                        />
                        <div className="relative w-36 shrink-0">
                          <span className="absolute left-sm top-1/2 -translate-y-1/2 font-data-mono text-[12px] text-on-surface-variant">+{currencySymbol}</span>
                          <input
                            type="number"
                            step="0.01"
                            className="w-full rounded-md border border-outline-variant bg-surface-container-lowest pl-xl pr-sm py-sm text-right font-data-mono text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                            value={o.priceCents / 100}
                            onChange={(e) => patchOption(gi, oi, { priceCents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                            placeholder="0.00"
                          />
                        </div>
                        <button
                          onClick={() => removeOption(gi, oi)}
                          title="Remove option"
                          className="text-outline transition-colors hover:text-error"
                        >
                          <Icon name="close" size={18} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addOption(gi)}
                      className="self-start font-label-md text-label-md text-primary transition-colors hover:text-primary-container"
                    >
                      + Add option
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-md border-t border-outline-variant bg-surface p-lg">
          {isEdit ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="inline-flex items-center gap-xs font-label-md text-label-md text-error underline decoration-error/50 underline-offset-4 transition-colors hover:text-on-error-container disabled:opacity-50"
            >
              {deleting && <Icon name="progress_activity" size={16} className="ag-spin" />}
              {deleting ? "Deleting…" : "Delete Item"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-md">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-full border border-primary bg-surface px-xl py-sm font-label-md text-label-md uppercase tracking-wider text-primary transition-colors hover:bg-primary-container/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex items-center justify-center gap-xs rounded-full bg-primary px-xl py-sm font-label-md text-label-md uppercase tracking-wider text-on-primary shadow-md transition-colors hover:bg-primary-container disabled:opacity-70"
            >
              {saving && <Icon name="progress_activity" size={18} className="ag-spin" />}
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Item"}
            </button>
          </div>
        </footer>
      </div>

      {confirmDelete && item && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-on-background/30 p-md backdrop-blur-sm"
          onClick={(e) => {
            e.stopPropagation();
            if (!deleting) setConfirmDelete(false);
          }}
        >
          <div
            className="w-full max-w-sm animate-scale-in rounded-card border border-outline-variant bg-surface-container-lowest p-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-md flex items-start gap-md">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error-container text-on-error-container">
                <Icon name="delete" size={22} />
              </span>
              <div>
                <h3 className="font-headline-md text-headline-md text-on-background">Delete item?</h3>
                <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
                  <span className="font-bold text-on-background">{item.name}</span> will be removed
                  from the menu. This can't be undone.
                </p>
              </div>
            </div>
            <div className="mt-lg flex gap-sm">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="flex-1 rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={remove}
                disabled={deleting}
                className="flex flex-1 items-center justify-center gap-xs rounded-full bg-error px-md py-sm font-label-md text-label-md text-on-error transition-colors hover:bg-error/90 disabled:opacity-70"
              >
                {deleting && <Icon name="progress_activity" size={16} className="ag-spin" />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-base ${className}`}>
      <label className="font-label-md text-label-md uppercase text-on-background">{label}</label>
      {children}
    </div>
  );
}
