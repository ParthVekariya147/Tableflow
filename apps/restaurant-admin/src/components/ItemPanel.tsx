import { useState } from "react";
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
  const { state, dispatch } = useAdmin();
  const isEdit = item !== null;

  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? (item.priceCents / 100).toFixed(2) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? defaultCategoryId);
  const [icon, setIcon] = useState(item?.icon ?? "restaurant");
  const [swatch, setSwatch] = useState(item?.swatch ?? SWATCHES[0]!);
  const [available, setAvailable] = useState(item?.available ?? true);
  const [allowSpice, setAllowSpice] = useState(true);
  const [addOns, setAddOns] = useState<AddOn[]>([
    { name: "Poached Egg", priceCents: 250 },
    { name: "Extra Cheese", priceCents: 200 },
  ]);

  function save() {
    const priceCents = Math.round((parseFloat(price) || 0) * 100);
    if (!name.trim()) return;
    if (isEdit && item) {
      dispatch({
        type: "UPDATE_ITEM",
        itemId: item.id,
        patch: { name, description, priceCents, categoryId, icon, swatch, available },
      });
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
      };
      dispatch({ type: "ADD_ITEM", item: newItem });
    }
    onClose();
  }

  function remove() {
    if (item) dispatch({ type: "DELETE_ITEM", itemId: item.id });
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
          {/* "Photo" — gradient swatch + icon picker */}
          <section className="flex flex-col gap-sm">
            <label className="font-label-md text-label-md text-on-background">Photo</label>
            <div
              className={`flex h-40 w-full items-center justify-center rounded-lg bg-gradient-to-br ${swatch}`}
            >
              <Icon name={icon} size={64} className="text-on-background/70" />
            </div>
            <div className="flex gap-xs">
              {SWATCHES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSwatch(s)}
                  className={`h-7 w-7 rounded-full bg-gradient-to-br ${s} ${
                    swatch === s ? "ring-2 ring-primary ring-offset-2" : ""
                  }`}
                />
              ))}
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
              className="flex-1 rounded-full border border-primary bg-surface py-sm font-label-md text-label-md uppercase tracking-wider text-primary transition-colors hover:bg-primary-container/10"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="flex-1 rounded-full bg-primary py-sm font-label-md text-label-md uppercase tracking-wider text-on-primary shadow-md transition-colors hover:bg-primary-container"
            >
              {isEdit ? "Save Changes" : "Create Item"}
            </button>
          </div>
          {isEdit && (
            <div className="text-center">
              <button
                onClick={remove}
                className="font-label-md text-label-md text-error underline decoration-error/50 underline-offset-4 transition-colors hover:text-on-error-container"
              >
                Delete Item
              </button>
            </div>
          )}
        </footer>
      </aside>
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
