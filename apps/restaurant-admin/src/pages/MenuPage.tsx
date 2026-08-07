import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Toggle } from "../components/Toggle";
import { ItemPanel } from "../components/ItemPanel";
import { DietaryMark } from "../components/DietaryMark";
import { useAdmin } from "../store/AdminStore";
import type { Category, MenuItem } from "../data/types";

/** Sentinel tab id for the "All" view (not a real category id). */
const ALL_CAT = "__all__";

type ViewMode = "grid" | "list";
/** Grid density — cozy = larger cards (≤3 cols), compact = smaller cards (≤5 cols). */
type Density = "cozy" | "compact";

const VIEW_PREFS_KEY = "ag-menu-view";

function loadViewPrefs(): { view: ViewMode; density: Density } {
  try {
    const raw = localStorage.getItem(VIEW_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<{ view: ViewMode; density: Density }>;
      return {
        view: p.view === "list" ? "list" : "grid",
        density: p.density === "compact" ? "compact" : "cozy",
      };
    }
  } catch {
    /* corrupted/unavailable storage — fall through to defaults */
  }
  return { view: "grid", density: "cozy" };
}

export function MenuPage() {
  const { state, pendingItems } = useAdmin();
  const [activeCat, setActiveCat] = useState(ALL_CAT);
  const [query, setQuery] = useState("");
  const [{ view, density }, setViewPrefs] = useState(loadViewPrefs);
  // panel: undefined = closed, null = add new, MenuItem = edit
  const [panel, setPanel] = useState<MenuItem | null | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify({ view, density }));
    } catch {
      /* storage unavailable — preference just won't persist */
    }
  }, [view, density]);

  const [catModal, setCatModal] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [deleteCat, setDeleteCat] = useState<Category | null>(null);

  // If the active category disappears (deleted/refetched), fall back to "All".
  useEffect(() => {
    if (activeCat !== ALL_CAT && !state.categories.some((c) => c.id === activeCat)) {
      setActiveCat(ALL_CAT);
    }
  }, [state.categories, activeCat]);

  const isAll = activeCat === ALL_CAT;
  const category = isAll ? undefined : state.categories.find((c) => c.id === activeCat);
  const q = query.trim().toLowerCase();
  /** Name or description match — same case-insensitive contains as the table
   *  session's "Search menu…" picker, so both surfaces behave alike. */
  const matches = (i: MenuItem) =>
    !q ||
    i.name.toLowerCase().includes(q) ||
    (i.description ?? "").toLowerCase().includes(q);

  const inCat = isAll ? state.items : state.items.filter((i) => i.categoryId === activeCat);
  const itemsInCat = inCat.filter(matches);
  // How many of the *other* categories would match — powers the "search all
  // categories" escape hatch when the current tab comes up empty.
  const matchesEverywhere = q ? state.items.filter(matches).length : 0;
  const pendingInCat = (isAll ? pendingItems : pendingItems.filter((p) => p.categoryId === activeCat))
    // A still-saving item only shows while it matches what's being searched.
    .filter((p) => !q || p.name.toLowerCase().includes(q));

  function countFor(catId: string) {
    return state.items.filter((i) => i.categoryId === catId).length;
  }

  function categoryNameOf(catId: string) {
    return state.categories.find((c) => c.id === catId)?.name;
  }

  return (
    <div className="flex min-h-[calc(100vh-160px)] flex-col gap-lg">
      {/* Categories navbar — horizontal tabs */}
      <nav className="flex items-center gap-sm overflow-x-auto border-b border-outline-variant pb-md">
        <button
          onClick={() => setActiveCat(ALL_CAT)}
          className={`flex shrink-0 items-center gap-xs rounded-full px-md py-sm font-label-md text-label-md transition-all ${
            isAll
              ? "bg-primary text-on-primary shadow-sm"
              : "text-on-surface-variant hover:bg-surface-container-low"
          }`}
        >
          <span className="whitespace-nowrap">All</span>
          <span
            className={`rounded-full px-1.5 text-[10px] ${
              isAll
                ? "bg-on-primary/20 text-on-primary"
                : "bg-surface-variant text-on-surface-variant"
            }`}
          >
            {state.items.length}
          </span>
        </button>
        {state.categories.map((c) => {
          const isActive = c.id === activeCat;
          return (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className={`flex shrink-0 items-center gap-xs rounded-full px-md py-sm font-label-md text-label-md transition-all ${
                isActive
                  ? "bg-primary text-on-primary shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container-low"
              }`}
            >
              <span className="whitespace-nowrap">{c.name}</span>
              <span
                className={`rounded-full px-1.5 text-[10px] ${
                  isActive
                    ? "bg-on-primary/20 text-on-primary"
                    : "bg-surface-variant text-on-surface-variant"
                }`}
              >
                {countFor(c.id)}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => setCatModal(true)}
          className="flex shrink-0 items-center gap-xs rounded-full border border-dashed border-outline px-md py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          <Icon name="add" size={16} />
          Add Category
        </button>
      </nav>

      {/* Items grid */}
      <section className="flex flex-1 flex-col">
        <div className="mb-lg flex items-center justify-between border-b border-outline-variant pb-md">
          <div>
            <div className="flex items-center gap-xs">
              <h2 className="font-headline-md text-headline-md text-on-background">
                {isAll ? "All Items" : category?.name ?? "Menu"}
              </h2>
              {category && (
                <>
                  <button
                    onClick={() => setEditCat(category)}
                    title="Rename category"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                  >
                    <Icon name="edit" size={17} />
                  </button>
                  <button
                    onClick={() => setDeleteCat(category)}
                    title="Delete category"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-error-container hover:text-error"
                  >
                    <Icon name="delete" size={17} />
                  </button>
                </>
              )}
            </div>
            <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
              {q
                ? `${itemsInCat.length} of ${inCat.length} item${inCat.length === 1 ? "" : "s"} match “${query.trim()}”`
                : "Manage items, pricing, and availability."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-sm">
            <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
              <Icon
                name="search"
                size={18}
                className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                placeholder="Search items…"
                aria-label="Search menu items"
                className="w-full rounded-full border border-outline-variant bg-surface py-sm pl-9 pr-9 font-body-md text-on-surface outline-none transition-shadow focus:border-primary focus:ring-1 focus:ring-primary"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  title="Clear search"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-background"
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
            {/* Layout switcher: grid ↔ rows */}
            <Segmented
              value={view}
              onChange={(v) => setViewPrefs((p) => ({ ...p, view: v }))}
              options={[
                { value: "grid", icon: "grid_view", title: "Grid view" },
                { value: "list", icon: "view_list", title: "Row view" },
              ]}
            />
            {/* Grid density — only meaningful in grid view */}
            {view === "grid" && (
              <Segmented
                value={density}
                onChange={(d) => setViewPrefs((p) => ({ ...p, density: d }))}
                options={[
                  { value: "cozy", icon: "view_cozy", title: "Comfortable — bigger cards" },
                  { value: "compact", icon: "view_comfy", title: "Compact — more cards per row" },
                ]}
              />
            )}
            <button
              onClick={() => setPanel(null)}
              className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary shadow-sm transition-colors hover:bg-primary-container"
            >
              <Icon name="add" size={18} />
              Add Item
            </button>
          </div>
        </div>

        {itemsInCat.length === 0 && pendingInCat.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-sm py-xxl text-on-surface-variant">
            <Icon name={q ? "search_off" : "restaurant_menu"} size={48} />
            <p className="font-body-md text-body-md">
              {q
                ? `Nothing matches “${query.trim()}”${isAll ? "" : " in this category"}.`
                : isAll
                  ? "No items on the menu yet."
                  : "No items in this category yet."}
            </p>
            {/* Searched inside one category and missed — the item probably lives
                in another one, so offer the wider search rather than a dead end. */}
            {q && !isAll && matchesEverywhere > 0 && (
              <button
                onClick={() => setActiveCat(ALL_CAT)}
                className="flex items-center gap-xs rounded-full border border-primary px-md py-xs font-label-md text-label-md text-primary transition-colors hover:bg-primary-container/10"
              >
                <Icon name="search" size={16} />
                Search all categories ({matchesEverywhere})
              </button>
            )}
          </div>
        ) : view === "list" ? (
          <div className="divide-y divide-outline-variant overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-card">
            {itemsInCat.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                categoryName={isAll ? categoryNameOf(item.categoryId) : undefined}
                onEdit={() => setPanel(item)}
              />
            ))}
            {pendingInCat.map((p) => (
              <CraftingRow key={p.tempId} name={p.name} />
            ))}
          </div>
        ) : (
          <div
            className={`grid content-start ${
              density === "compact"
                ? "grid-cols-2 gap-md md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
                : "grid-cols-1 gap-lg md:grid-cols-2 xl:grid-cols-3"
            }`}
          >
            {itemsInCat.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                compact={density === "compact"}
                categoryName={isAll ? categoryNameOf(item.categoryId) : undefined}
                onEdit={() => setPanel(item)}
              />
            ))}
            {pendingInCat.map((p) => (
              <CraftingCard key={p.tempId} name={p.name} />
            ))}
          </div>
        )}
      </section>

      {panel !== undefined && (
        <ItemPanel
          item={panel}
          defaultCategoryId={isAll ? state.categories[0]?.id ?? "" : activeCat}
          onClose={() => setPanel(undefined)}
        />
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

/** Pill-style segmented icon control (view mode / grid density). */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; icon: string; title: string }[];
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-outline-variant bg-surface-container p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`flex h-8 w-9 items-center justify-center rounded-full transition-all ${
              active
                ? "bg-surface-container-lowest text-primary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <Icon name={o.icon} size={18} fill={active} />
          </button>
        );
      })}
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

function ItemCard({
  item,
  onEdit,
  compact = false,
  categoryName,
}: {
  item: MenuItem;
  onEdit: () => void;
  /** Compact density — tighter card so more fit per row. */
  compact?: boolean;
  /** Shown as a chip on the photo in the "All" view. */
  categoryName?: string;
}) {
  const { dispatch, currencySymbol } = useAdmin();

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
      <div
        className={`relative w-full overflow-hidden bg-gradient-to-br ${item.swatch} ${
          compact ? "h-24" : "h-32"
        }`}
      >
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon name={item.icon} size={compact ? 36 : 48} className="text-on-background/40" />
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
          {!compact && (
            <span
              className={`font-label-md text-[10px] ${
                item.available ? "text-on-surface" : "text-on-error-container"
              }`}
            >
              {item.available ? "Available" : "86'd"}
            </span>
          )}
        </div>
        <button
          onClick={onEdit}
          title="Edit item"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-lowest/90 text-on-surface-variant backdrop-blur-sm transition-opacity hover:text-primary lg:opacity-0 lg:group-hover:opacity-100"
        >
          <Icon name="edit" size={18} />
        </button>
        {categoryName && (
          <span className="absolute bottom-2 left-2 rounded-full bg-surface-container-lowest/90 px-2 py-0.5 font-label-md text-[10px] text-on-surface-variant backdrop-blur-sm">
            {categoryName}
          </span>
        )}
        {(item.dietary || item.jain) && (
          <div className="absolute bottom-2 right-2 rounded-md bg-surface-container-lowest/90 p-1 backdrop-blur-sm">
            <DietaryMark dietary={item.dietary} jain={item.jain} size={16} />
          </div>
        )}
      </div>

      <div className={`flex flex-1 flex-col ${compact ? "gap-xs p-sm" : "gap-sm p-md"}`}>
        <input
          type="text"
          defaultValue={item.name}
          onBlur={(e) => commitName(e.target.value)}
          className={`editable-field w-full truncate border-none bg-transparent p-0 text-on-background focus:ring-0 ${
            compact ? "font-title-md text-title-md" : "font-title-lg text-title-lg"
          }`}
        />
        <div className="flex items-center gap-xs font-data-mono text-data-mono text-primary">
          <span>{currencySymbol}</span>
          <input
            type="text"
            defaultValue={(item.priceCents / 100).toFixed(2)}
            onBlur={(e) => commitPrice(e.target.value)}
            className="editable-field w-16 border-none bg-transparent p-0 focus:ring-0"
          />
        </div>
      </div>

      <div
        className={`flex items-center justify-between border-t border-outline-variant bg-surface-container ${
          compact ? "px-sm py-xs" : "px-md py-sm"
        }`}
      >
        <span className="font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
          {compact ? (item.available ? "Live" : "86'd") : "Availability"}
        </span>
        <Toggle
          checked={item.available}
          onChange={() => dispatch({ type: "TOGGLE_AVAILABILITY", itemId: item.id })}
        />
      </div>
    </div>
  );
}

/** One menu item as a full-width row (list view) — same inline edits as the card. */
function ItemRow({
  item,
  onEdit,
  categoryName,
}: {
  item: MenuItem;
  onEdit: () => void;
  categoryName?: string;
}) {
  const { dispatch, currencySymbol } = useAdmin();

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
      className={`group flex items-center gap-md px-md py-sm transition-colors hover:bg-surface-container-low ${
        item.available ? "" : "opacity-70 grayscale-[30%]"
      }`}
    >
      <div
        className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br ${item.swatch}`}
      >
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon name={item.icon} size={26} className="text-on-background/40" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-sm">
          <input
            type="text"
            defaultValue={item.name}
            onBlur={(e) => commitName(e.target.value)}
            className="editable-field min-w-0 flex-1 truncate border-none bg-transparent p-0 font-title-md text-title-md text-on-background focus:ring-0 sm:flex-none sm:basis-64"
          />
          <DietaryMark dietary={item.dietary} jain={item.jain} size={14} />
        </div>
        <div className="flex items-center gap-sm">
          {categoryName && (
            <span className="rounded-full bg-surface-variant px-2 py-0.5 font-label-md text-[10px] text-on-surface-variant">
              {categoryName}
            </span>
          )}
          {item.description && (
            <span className="hidden truncate font-body-md text-[12px] text-on-surface-variant md:inline">
              {item.description}
            </span>
          )}
        </div>
      </div>

      <span
        className={`hidden items-center gap-1 rounded-full border px-2 py-1 sm:flex ${
          item.available
            ? "border-outline-variant bg-surface-container-lowest"
            : "border-error/20 bg-error-container"
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
      </span>

      <div className="flex w-24 shrink-0 items-center gap-xs font-data-mono text-data-mono text-primary">
        <span>{currencySymbol}</span>
        <input
          type="text"
          defaultValue={(item.priceCents / 100).toFixed(2)}
          onBlur={(e) => commitPrice(e.target.value)}
          className="editable-field w-16 border-none bg-transparent p-0 focus:ring-0"
        />
      </div>

      <Toggle
        checked={item.available}
        onChange={() => dispatch({ type: "TOGGLE_AVAILABILITY", itemId: item.id })}
      />

      <button
        onClick={onEdit}
        title="Edit item"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
      >
        <Icon name="edit" size={18} />
      </button>
    </div>
  );
}

/** List-view counterpart of CraftingCard — shimmer row while an item saves. */
function CraftingRow({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-md px-md py-sm">
      <div className="ag-shimmer h-14 w-14 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <span className="truncate font-title-md text-title-md text-on-background/70">
          {name || "New item"}
        </span>
        <div className="ag-shimmer h-3 w-24 rounded" />
      </div>
      <span className="flex items-center gap-xs font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant">
        <Icon name="progress_activity" size={16} className="ag-spin text-primary" />
        Saving
      </span>
    </div>
  );
}
