import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Toggle } from "../components/Toggle";
import { ItemPanel } from "../components/ItemPanel";
import { useAdmin } from "../store/AdminStore";
import type { Category, MenuItem } from "../data/types";

export function MenuPage() {
  const { state, dispatch, pendingItems } = useAdmin();
  const [activeCat, setActiveCat] = useState(state.categories[0]?.id ?? "");
  // panel: undefined = closed, null = add new, MenuItem = edit
  const [panel, setPanel] = useState<MenuItem | null | undefined>(undefined);

  const [catModal, setCatModal] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [deleteCat, setDeleteCat] = useState<Category | null>(null);

  // If the active category disappears (deleted/refetched), fall back to the first.
  useEffect(() => {
    if (state.categories.length && !state.categories.some((c) => c.id === activeCat)) {
      setActiveCat(state.categories[0]!.id);
    }
  }, [state.categories, activeCat]);

  const category = state.categories.find((c) => c.id === activeCat);
  const itemsInCat = state.items.filter((i) => i.categoryId === activeCat);
  const pendingInCat = pendingItems.filter((p) => p.categoryId === activeCat);

  function countFor(catId: string) {
    return state.items.filter((i) => i.categoryId === catId).length;
  }

  return (
    <div className="flex min-h-[calc(100vh-160px)] gap-xl">
      {/* Categories rail */}
      <aside className="flex w-64 shrink-0 flex-col">
        <h3 className="mb-lg flex items-center justify-between font-title-lg text-title-lg text-on-background">
          Categories
          <span className="rounded-full bg-surface-variant px-2 py-1 font-label-md text-label-md text-on-surface-variant">
            {state.categories.length}
          </span>
        </h3>
        <ul className="mb-lg flex flex-col gap-xs">
          {state.categories.map((c) => {
            const isActive = c.id === activeCat;
            return (
              <li key={c.id} className="group/cat relative">
                <button
                  onClick={() => setActiveCat(c.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-md py-sm font-label-md text-label-md transition-all ${
                    isActive
                      ? "border border-primary/20 bg-surface-container-high text-primary"
                      : "border border-transparent text-on-surface-variant hover:border-outline-variant/30 hover:bg-surface-container-low"
                  }`}
                >
                  <span className="truncate pr-12">{c.name}</span>
                  <span className="text-[10px] text-on-surface-variant group-hover/cat:opacity-0">
                    {countFor(c.id)}
                  </span>
                </button>
                {/* Hover actions — rename / delete this category. */}
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover/cat:opacity-100">
                  <button
                    onClick={() => setEditCat(c)}
                    title="Rename category"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    onClick={() => setDeleteCat(c)}
                    title="Delete category"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-error-container hover:text-error"
                  >
                    <Icon name="delete" size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <button
          onClick={() => setCatModal(true)}
          className="mt-auto flex w-full items-center justify-center gap-xs rounded-full border border-primary bg-transparent px-md py-sm font-label-md text-label-md text-primary transition-colors hover:bg-primary-container/5"
        >
          <Icon name="add" size={18} />
          Add Category
        </button>
      </aside>

      <div className="hidden w-px bg-outline-variant lg:block" />

      {/* Items grid */}
      <section className="flex flex-1 flex-col">
        <div className="mb-lg flex items-center justify-between border-b border-outline-variant pb-md">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-background">{category?.name}</h2>
            <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
              Manage items, pricing, and availability.
            </p>
          </div>
          <button
            onClick={() => setPanel(null)}
            className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary shadow-sm transition-colors hover:bg-primary-container"
          >
            <Icon name="add" size={18} />
            Add Item
          </button>
        </div>

        {itemsInCat.length === 0 && pendingInCat.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-sm py-xxl text-on-surface-variant">
            <Icon name="restaurant_menu" size={48} />
            <p className="font-body-md text-body-md">No items in this category yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 content-start gap-lg md:grid-cols-2 xl:grid-cols-3">
            {itemsInCat.map((item) => (
              <ItemCard key={item.id} item={item} onEdit={() => setPanel(item)} />
            ))}
            {pendingInCat.map((p) => (
              <CraftingCard key={p.tempId} name={p.name} />
            ))}
          </div>
        )}
      </section>

      {panel !== undefined && (
        <ItemPanel item={panel} defaultCategoryId={activeCat} onClose={() => setPanel(undefined)} />
      )}
      {catModal && <CategoryModal onClose={() => setCatModal(false)} />}
      {editCat && <CategoryModal category={editCat} onClose={() => setEditCat(null)} />}
      {deleteCat && (
        <DeleteCategoryModal
          category={deleteCat}
          itemCount={countFor(deleteCat.id)}
          onClose={() => setDeleteCat(null)}
        />
      )}
    </div>
  );
}

/** In-app category dialog — add a new category, or rename an existing one. */
function CategoryModal({
  category,
  onClose,
}: {
  category?: Category;
  onClose: () => void;
}) {
  const { dispatch } = useAdmin();
  const isEdit = !!category;
  const [name, setName] = useState(category?.name ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    if (isEdit && trimmed === category!.name) return onClose();
    setSaving(true);
    await dispatch(
      isEdit
        ? { type: "UPDATE_CATEGORY", categoryId: category!.id, name: trimmed }
        : { type: "ADD_CATEGORY", name: trimmed },
    );
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-on-background/20 p-md backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-scale-in rounded-card border border-outline-variant bg-surface-container-lowest p-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-md font-headline-md text-headline-md text-on-background">
          {isEdit ? "Rename Category" : "Add Category"}
        </h3>
        <label className="flex flex-col gap-base">
          <span className="font-label-md text-label-md uppercase text-on-background">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="e.g. Desserts"
            className="rounded-md border border-outline-variant bg-surface px-sm py-sm font-body-md text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
        <div className="mt-lg flex gap-sm">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="flex flex-1 items-center justify-center gap-xs rounded-full bg-primary px-md py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-70"
          >
            {saving && <Icon name="progress_activity" size={16} className="ag-spin" />}
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Category"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Confirmation for deleting a category. The API rejects deleting a non-empty
 * category (item FK is Restrict), so when items remain we explain and block,
 * pointing staff to clear the category first.
 */
function DeleteCategoryModal({
  category,
  itemCount,
  onClose,
}: {
  category: Category;
  itemCount: number;
  onClose: () => void;
}) {
  const { dispatch } = useAdmin();
  const [deleting, setDeleting] = useState(false);
  const hasItems = itemCount > 0;

  async function remove() {
    if (hasItems || deleting) return;
    setDeleting(true);
    await dispatch({ type: "DELETE_CATEGORY", categoryId: category.id });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-on-background/30 p-md backdrop-blur-sm"
      onClick={() => !deleting && onClose()}
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
            <h3 className="font-headline-md text-headline-md text-on-background">
              Delete category?
            </h3>
            <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
              {hasItems ? (
                <>
                  <span className="font-bold text-on-background">{category.name}</span> still has{" "}
                  {itemCount} item{itemCount === 1 ? "" : "s"}. Move or delete{" "}
                  {itemCount === 1 ? "it" : "them"} before deleting the category.
                </>
              ) : (
                <>
                  <span className="font-bold text-on-background">{category.name}</span> will be
                  removed. This can't be undone.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="mt-lg flex gap-sm">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50"
          >
            {hasItems ? "Close" : "Cancel"}
          </button>
          {!hasItems && (
            <button
              onClick={remove}
              disabled={deleting}
              className="flex flex-1 items-center justify-center gap-xs rounded-full bg-error px-md py-sm font-label-md text-label-md text-on-error transition-colors hover:bg-error/90 disabled:opacity-70"
            >
              {deleting && <Icon name="progress_activity" size={16} className="ag-spin" />}
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Placeholder shown while a new item is being saved — same footprint as ItemCard. */
function CraftingCard({ name }: { name: string }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-dashed border-primary/40 bg-surface-container-lowest shadow-card">
      <div className="ag-shimmer relative flex h-32 w-full items-center justify-center">
        <div className="flex flex-col items-center gap-xs text-primary">
          <Icon name="progress_activity" size={32} className="ag-spin" />
          <span className="font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
            Crafting…
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-sm p-md">
        <span className="truncate font-title-lg text-title-lg text-on-background/70">
          {name || "New item"}
        </span>
        <div className="ag-shimmer h-4 w-16 rounded" />
      </div>
      <div className="flex items-center justify-between border-t border-outline-variant bg-surface-container px-md py-sm">
        <span className="font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
          Saving
        </span>
        <div className="ag-shimmer h-5 w-9 rounded-full" />
      </div>
    </div>
  );
}

function ItemCard({ item, onEdit }: { item: MenuItem; onEdit: () => void }) {
  const { dispatch } = useAdmin();

  function commitPrice(value: string) {
    const cents = Math.round((parseFloat(value) || 0) * 100);
    if (cents !== item.priceCents) dispatch({ type: "UPDATE_ITEM", itemId: item.id, patch: { priceCents: cents } });
  }
  function commitName(value: string) {
    const name = value.trim();
    if (name && name !== item.name) dispatch({ type: "UPDATE_ITEM", itemId: item.id, patch: { name } });
  }

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-card transition ${
        item.available ? "" : "opacity-75 grayscale-[30%]"
      }`}
    >
      <div className={`relative h-32 w-full overflow-hidden bg-gradient-to-br ${item.swatch}`}>
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon name={item.icon} size={48} className="text-on-background/40" />
          </div>
        )}
        <div
          className={`absolute left-2 top-2 flex items-center gap-1 rounded-full border px-2 py-1 backdrop-blur-sm ${
            item.available
              ? "border-outline-variant bg-surface-container-lowest/90"
              : "border-error/20 bg-error-container/90"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${item.available ? "bg-green-500" : "bg-error"}`} />
          <span
            className={`font-label-md text-[10px] ${
              item.available ? "text-on-surface" : "text-on-error-container"
            }`}
          >
            {item.available ? "Available" : "86'd"}
          </span>
        </div>
        <button
          onClick={onEdit}
          title="Edit item"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-lowest/90 text-on-surface-variant opacity-0 backdrop-blur-sm transition-opacity hover:text-primary group-hover:opacity-100"
        >
          <Icon name="edit" size={18} />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-sm p-md">
        <input
          type="text"
          defaultValue={item.name}
          onBlur={(e) => commitName(e.target.value)}
          className="editable-field w-full truncate border-none bg-transparent p-0 font-title-lg text-title-lg text-on-background focus:ring-0"
        />
        <div className="flex items-center gap-xs font-data-mono text-data-mono text-primary">
          <span>$</span>
          <input
            type="text"
            defaultValue={(item.priceCents / 100).toFixed(2)}
            onBlur={(e) => commitPrice(e.target.value)}
            className="editable-field w-16 border-none bg-transparent p-0 focus:ring-0"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-outline-variant bg-surface-container px-md py-sm">
        <span className="font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
          Availability
        </span>
        <Toggle
          checked={item.available}
          onChange={() => dispatch({ type: "TOGGLE_AVAILABILITY", itemId: item.id })}
        />
      </div>
    </div>
  );
}
