import { createContext, useContext, useEffect, useState } from "react";
import { useBoot } from "./BootContext";

/**
 * Loads the active tenant's menu from the platform API (the same menu the
 * restaurant-admin manages) and maps it to the shape the guest screens expect.
 * Money arrives in cents; we expose `price` in dollars for display and keep
 * `priceCents` + the API `id` for placing orders.
 */
const MenuContext = createContext(null);

function toScreenItem(i) {
  return {
    id: i.id,
    name: i.name,
    category: i.category,
    price: i.price / 100,
    priceCents: i.price,
    desc: i.description || "",
    badge: i.badge,
    img: i.imageUrl || null,
    icon: i.icon || "restaurant",
    swatch: i.swatch,
    dietary: i.dietary ?? null,
    jain: i.jain ?? false,
    // Modifier groups, deltas in dollars for display (priceCents kept for orders).
    modifierGroups: (i.modifierGroups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      inputType: g.inputType,
      required: g.required,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      maxLength: g.maxLength,
      placeholder: g.placeholder,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        price: o.priceDelta / 100,
        priceCents: o.priceDelta,
        available: o.available,
      })),
    })),
  };
}

export function MenuProvider({ children }) {
  const { api, menuPromise } = useBoot();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState(["All"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    // Prefer the prefetch started during boot (already in flight / resolved);
    // fall back to a fresh fetch only if it wasn't provided.
    (menuPromise ?? api.menu.get())
      .then((menu) => {
        if (!active) return;
        setItems(menu.items.map(toScreenItem));
        setCategories(["All", ...menu.categories.map((c) => c.name)]);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, menuPromise]);

  // Welcome-screen carousels, derived from the live menu (no placements API yet).
  const drinks = items.filter((i) => /drink|beverage/i.test(i.category));
  const bites = items.filter((i) => /starter|appetiz|side|small|bite/i.test(i.category));
  const welcome = {
    drinks: (drinks.length ? drinks : items).slice(0, 6),
    bites: (bites.length ? bites : items.slice(6)).slice(0, 6),
  };

  return (
    <MenuContext.Provider value={{ items, categories, welcome, loading, error }}>
      {children}
    </MenuContext.Provider>
  );
}

export const useMenu = () => useContext(MenuContext);
