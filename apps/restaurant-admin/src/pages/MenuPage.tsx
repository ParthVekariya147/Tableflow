import { useState } from "react";
import { Icon } from "../components/Icon";
import { Toggle } from "../components/Toggle";
import { ItemPanel } from "../components/ItemPanel";
import { useAdmin } from "../store/AdminStore";
import type { MenuItem } from "../data/types";

export function MenuPage() {
  const { state, dispatch } = useAdmin();
  const [activeCat, setActiveCat] = useState(state.categories[0]?.id ?? "");
  // panel: undefined = closed, null = add new, MenuItem = edit
  const [panel, setPanel] = useState<MenuItem | null | undefined>(undefined);

  const category = state.categories.find((c) => c.id === activeCat);
  const itemsInCat = state.items.filter((i) => i.categoryId === activeCat);

  function countFor(catId: string) {
    return state.items.filter((i) => i.categoryId === catId).length;
  }

  function addCategory() {
    const name = window.prompt("New category name");
    if (name?.trim()) dispatch({ type: "ADD_CATEGORY", name: name.trim() });
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
              <li key={c.id}>
                <button
                  onClick={() => setActiveCat(c.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-md py-sm font-label-md text-label-md transition-all ${
                    isActive
                      ? "border border-primary/20 bg-surface-container-high text-primary"
                      : "border border-transparent text-on-surface-variant hover:border-outline-variant/30 hover:bg-surface-container-low"
                  }`}
                >
                  <span>{c.name}</span>
                  <span className="text-[10px] text-on-surface-variant">{countFor(c.id)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          onClick={addCategory}
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

        {itemsInCat.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-sm py-xxl text-on-surface-variant">
            <Icon name="restaurant_menu" size={48} />
            <p className="font-body-md text-body-md">No items in this category yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 content-start gap-lg md:grid-cols-2 xl:grid-cols-3">
            {itemsInCat.map((item) => (
              <ItemCard key={item.id} item={item} onEdit={() => setPanel(item)} />
            ))}
          </div>
        )}
      </section>

      {panel !== undefined && (
        <ItemPanel item={panel} defaultCategoryId={activeCat} onClose={() => setPanel(undefined)} />
      )}
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
      <div className={`relative h-32 w-full bg-gradient-to-br ${item.swatch}`}>
        <div className="flex h-full w-full items-center justify-center">
          <Icon name={item.icon} size={48} className="text-on-background/40" />
        </div>
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
