import { useRef, useState } from "react";
import { Icon } from "./Icon";
import { Toggle } from "./Toggle";
import { useAdmin } from "../store/AdminStore";
import type { MenuItem } from "../data/types";
import { uid } from "../data/seed";

interface AddOn {
  name: string;
  priceCents: number;
}

const SWATCHES = [
  "from-amber-200 to-orange-300",
  "from-rose-200 to-red-300",
  "from-green-200 to-emerald-400",
  "from-stone-300 to-amber-500",
  "from-yellow-200 to-amber-400",
];

/**
 * Slide-over panel for creating or editing a menu item. Save dispatches to the
 * store so the change is reflected immediately on the menu grid.
 * `item === null` means "add new".
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
  const { state, dispatch, uploadImage } = useAdmin();
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const busy = saving || deleting || uploading;
  const [allowSpice, setAllowSpice] = useState(true);
  const [addOns, setAddOns] = useState<AddOn[]>([
    { name: "Poached Egg", priceCents: 250 },
    { name: "Extra Cheese", priceCents: 200 },
  ]);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setUploadError(null);
    // Show an instant local preview while the upload runs; swap to the stored
    // public URL on success, or revert if it fails.
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
    if (isEdit && item) {
      // Keep the panel open with a spinner until the edit is confirmed.
      setSaving(true);
      await dispatch({
        type: "UPDATE_ITEM",
        itemId: item.id,
        patch: { name, description, priceCents, categoryId, icon, swatch, available, imageUrl },
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
        icon,
        swatch,
        imageUrl,
      };
      // Fire and close immediately — the grid shows a "crafting" placeholder
      // until the server confirms the new item.
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
    <div className="fixed inset-0 z-[60] flex justify-end bg-on-background/20 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md animate-slide-in-right flex-col border-l border-outline-variant bg-surface-container-lowest shadow-2xl"
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

        <div className="flex flex-1 flex-col gap-xl overflow-y-auto p-lg">
          {/* "Photo" — uploaded image, or gradient swatch + icon stand-in */}
          <section className="flex flex-col gap-sm">
            <label className="font-label-md text-label-md text-on-background">Photo</label>
            <div
              className={`relative flex h-40 w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br ${swatch}`}
            >
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
                  <span className="font-label-md text-[11px] uppercase tracking-wider">
                    Uploading…
                  </span>
                </div>
              )}
            </div>
            {uploadError && (
              <p className="font-body-md text-body-md text-error">{uploadError}</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPickImage}
            />
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
                      className={`h-7 w-7 rounded-full bg-gradient-to-br ${s} ${
                        swatch === s ? "ring-2 ring-primary ring-offset-2" : ""
                      }`}
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
                  <span className="absolute left-sm top-1/2 -translate-y-1/2 font-data-mono text-on-surface-variant">
                    $
                  </span>
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
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
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
          </section>

          <hr className="border-outline-variant" />

          {/* Modifiers */}
          <section className="flex flex-col gap-md">
            <h3 className="border-b border-outline-variant pb-xs font-title-lg text-title-lg text-on-background">
              Modifiers
            </h3>
            <div className="rounded-lg border border-outline-variant bg-surface p-md">
              <div className="mb-sm flex items-center justify-between">
                <span className="font-body-md text-body-md font-bold text-on-background">Add-ons</span>
                <button
                  onClick={() =>
                    setAddOns((a) => [...a, { name: "New Add-on", priceCents: 100 }])
                  }
                  className="text-primary hover:text-primary-container"
                >
                  <Icon name="add_circle" />
                </button>
              </div>
              <div className="flex flex-col gap-sm">
                {addOns.map((a, idx) => (
                  <div key={idx} className="group flex items-center justify-between">
                    <span className="font-body-md text-body-md text-on-surface-variant">{a.name}</span>
                    <div className="flex items-center gap-sm">
                      <span className="font-data-mono text-data-mono text-on-surface-variant">
                        +${(a.priceCents / 100).toFixed(2)}
                      </span>
                      <button
                        onClick={() => setAddOns((list) => list.filter((_, i) => i !== idx))}
                        className="text-outline opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                      >
                        <Icon name="delete" size={20} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface p-md">
              <span className="font-body-md text-body-md font-bold text-on-background">
                Allow Spice Level Selection
              </span>
              <Toggle checked={allowSpice} onChange={setAllowSpice} />
            </div>
          </section>
        </div>

        <footer className="flex shrink-0 flex-col gap-md border-t border-outline-variant bg-surface p-lg">
          <div className="flex gap-md">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-full border border-primary bg-surface py-sm font-label-md text-label-md uppercase tracking-wider text-primary transition-colors hover:bg-primary-container/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-xs rounded-full bg-primary py-sm font-label-md text-label-md uppercase tracking-wider text-on-primary shadow-md transition-colors hover:bg-primary-container disabled:opacity-70"
            >
              {saving && <Icon name="progress_activity" size={18} className="ag-spin" />}
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Item"}
            </button>
          </div>
          {isEdit && (
            <div className="text-center">
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="inline-flex items-center justify-center gap-xs font-label-md text-label-md text-error underline decoration-error/50 underline-offset-4 transition-colors hover:text-on-error-container disabled:opacity-50"
              >
                {deleting && <Icon name="progress_activity" size={16} className="ag-spin" />}
                {deleting ? "Deleting…" : "Delete Item"}
              </button>
            </div>
          )}
        </footer>
      </aside>

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
