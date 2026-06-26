import type { AdminState, MenuItem, Table } from "./types";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const now = Date.now();

/** Short pseudo-random QR token, e.g. "QR-7F3A". */
export function makeQrToken(): string {
  return "QR-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

let n = 0;
export function uid(prefix = "id"): string {
  n += 1;
  return `${prefix}-${Date.now().toString(36)}-${n}`;
}

const categories = [
  { id: "cat-starters", name: "Starters" },
  { id: "cat-mains", name: "Mains" },
  { id: "cat-sides", name: "Sides" },
  { id: "cat-drinks", name: "Drinks" },
  { id: "cat-desserts", name: "Desserts" },
];

const items: MenuItem[] = [
  // Starters
  { id: "it-chai", categoryId: "cat-starters", name: "Masala Chai", description: "Spiced black tea simmered with milk, cardamom & ginger.", priceCents: 450, available: true, icon: "local_cafe", swatch: "from-amber-200 to-orange-300" },
  { id: "it-samosa", categoryId: "cat-starters", name: "Vegetable Samosa", description: "Crisp pastry, spiced potato & pea, tamarind chutney.", priceCents: 600, available: true, icon: "lunch_dining", swatch: "from-yellow-200 to-amber-400" },
  { id: "it-crab", categoryId: "cat-starters", name: "Soft Shell Crab", description: "Lightly fried, micro-greens, citrus aioli.", priceCents: 1450, available: false, icon: "set_meal", swatch: "from-rose-200 to-red-300" },
  { id: "it-paneer", categoryId: "cat-starters", name: "Paneer Tikka Bites", description: "Char-grilled paneer skewers, mint yogurt.", priceCents: 850, available: true, icon: "kebab_dining", swatch: "from-orange-200 to-amber-300" },

  // Mains
  { id: "it-wagyu", categoryId: "cat-mains", name: "Wagyu Burger", description: "Wagyu patty, aged cheddar, brioche bun.", priceCents: 1800, available: true, icon: "lunch_dining", swatch: "from-stone-300 to-amber-500" },
  { id: "it-ribeye", categoryId: "cat-mains", name: "Ribeye Steak", description: "12oz dry-aged ribeye, peppercorn jus.", priceCents: 4400, available: true, icon: "restaurant", swatch: "from-red-300 to-rose-500" },
  { id: "it-salmon", categoryId: "cat-mains", name: "Grilled Salmon", description: "Atlantic salmon, lemon butter, seasonal veg.", priceCents: 2600, available: true, icon: "set_meal", swatch: "from-rose-200 to-orange-300" },
  { id: "it-curry", categoryId: "cat-mains", name: "Butter Chicken", description: "Tandoori chicken, tomato-cream gravy, basmati.", priceCents: 1900, available: true, icon: "ramen_dining", swatch: "from-orange-300 to-red-400" },

  // Sides
  { id: "it-fries", categoryId: "cat-sides", name: "Truffle Fries", description: "Hand-cut fries, truffle oil, parmesan.", priceCents: 900, available: true, icon: "fastfood", swatch: "from-yellow-200 to-amber-400" },
  { id: "it-salad", categoryId: "cat-sides", name: "House Salad", description: "Mixed greens, heirloom tomato, vinaigrette.", priceCents: 1200, available: true, icon: "eco", swatch: "from-green-200 to-emerald-400" },
  { id: "it-naan", categoryId: "cat-sides", name: "Garlic Naan", description: "Tandoor-baked flatbread, garlic butter.", priceCents: 500, available: true, icon: "bakery_dining", swatch: "from-amber-100 to-yellow-300" },

  // Drinks
  { id: "it-oldfash", categoryId: "cat-drinks", name: "House Old Fashioned", description: "Bourbon, bitters, demerara, orange twist.", priceCents: 1400, available: true, icon: "local_bar", swatch: "from-amber-400 to-orange-600" },
  { id: "it-latte", categoryId: "cat-drinks", name: "Oat Latte", description: "Double espresso, steamed oat milk.", priceCents: 550, available: false, icon: "coffee", swatch: "from-stone-200 to-amber-300" },
  { id: "it-lemonade", categoryId: "cat-drinks", name: "Fresh Lemonade", description: "Hand-pressed lemon, mint, soda.", priceCents: 600, available: true, icon: "local_drink", swatch: "from-lime-200 to-yellow-300" },

  // Desserts
  { id: "it-cheesecake", categoryId: "cat-desserts", name: "Burnt Basque Cheesecake", description: "Caramelised top, vanilla cream.", priceCents: 1100, available: true, icon: "cake", swatch: "from-amber-200 to-yellow-400" },
  { id: "it-gulab", categoryId: "cat-desserts", name: "Gulab Jamun", description: "Warm milk dumplings, rose syrup.", priceCents: 700, available: true, icon: "icecream", swatch: "from-orange-200 to-rose-300" },
];

const tables: Table[] = [
  {
    id: "tbl-1",
    label: "T1",
    room: "Main Dining Room",
    seats: 4,
    status: "seated",
    qrToken: makeQrToken(),
    session: {
      openedAt: now - 45 * MIN,
      rounds: [
        {
          id: "rnd-1a",
          type: "bundled",
          placedAt: now - 20 * MIN,
          items: [
            { id: "oi-1a1", menuItemId: "it-oldfash", name: "House Old Fashioned", priceCents: 1400, qty: 2, status: "served" },
            { id: "oi-1a2", menuItemId: "it-paneer", name: "Paneer Tikka Bites", priceCents: 850, qty: 1, status: "served", note: "Extra mint yogurt" },
          ],
        },
        {
          id: "rnd-1b",
          type: "instant",
          placedAt: now - 5 * MIN,
          items: [
            { id: "oi-1b1", menuItemId: "it-wagyu", name: "Wagyu Burger", priceCents: 1800, qty: 2, status: "preparing" },
            { id: "oi-1b2", menuItemId: "it-fries", name: "Truffle Fries", priceCents: 900, qty: 1, status: "preparing", note: "No parmesan" },
          ],
        },
      ],
    },
  },
  { id: "tbl-2", label: "T2", room: "Main Dining Room", seats: 2, status: "free", qrToken: makeQrToken() },
  {
    id: "tbl-3",
    label: "T3",
    room: "Main Dining Room",
    seats: 4,
    status: "bill",
    qrToken: makeQrToken(),
    session: {
      openedAt: now - 70 * MIN,
      rounds: [
        {
          id: "rnd-3a",
          type: "bundled",
          placedAt: now - 55 * MIN,
          items: [
            { id: "oi-3a1", menuItemId: "it-ribeye", name: "Ribeye Steak", priceCents: 4400, qty: 1, status: "served" },
            { id: "oi-3a2", menuItemId: "it-salmon", name: "Grilled Salmon", priceCents: 2600, qty: 1, status: "served" },
            { id: "oi-3a3", menuItemId: "it-salad", name: "House Salad", priceCents: 1200, qty: 1, status: "served" },
          ],
        },
      ],
    },
  },
  { id: "tbl-4", label: "T4", room: "Main Dining Room", seats: 6, status: "free", qrToken: makeQrToken() },
  {
    id: "tbl-5",
    label: "T5",
    room: "Patio",
    seats: 2,
    status: "ordering",
    qrToken: makeQrToken(),
    session: {
      openedAt: now - 8 * MIN,
      rounds: [
        {
          id: "rnd-5a",
          type: "instant",
          placedAt: now - 2 * MIN,
          items: [
            { id: "oi-5a1", menuItemId: "it-chai", name: "Masala Chai", priceCents: 450, qty: 2, status: "placed", note: "Extra ginger, less sugar" },
          ],
        },
      ],
    },
  },
  { id: "tbl-6", label: "T6", room: "Patio", seats: 4, status: "free", qrToken: makeQrToken() },
  {
    id: "tbl-7",
    label: "T7",
    room: "Patio",
    seats: 4,
    status: "seated",
    qrToken: makeQrToken(),
    session: {
      openedAt: now - 30 * MIN,
      rounds: [
        {
          id: "rnd-7a",
          type: "bundled",
          placedAt: now - 18 * MIN,
          items: [
            { id: "oi-7a1", menuItemId: "it-curry", name: "Butter Chicken", priceCents: 1900, qty: 1, status: "served" },
            { id: "oi-7a2", menuItemId: "it-naan", name: "Garlic Naan", priceCents: 500, qty: 2, status: "served" },
          ],
        },
      ],
    },
  },
  { id: "tbl-8", label: "T8", room: "Bar", seats: 2, status: "free", qrToken: makeQrToken() },
  { id: "tbl-9", label: "T9", room: "Bar", seats: 2, status: "free", qrToken: makeQrToken() },
  { id: "tbl-10", label: "T10", room: "Private Room", seats: 8, status: "free", qrToken: makeQrToken() },
  { id: "tbl-11", label: "T11", room: "Private Room", seats: 6, status: "free", qrToken: makeQrToken() },
  { id: "tbl-12", label: "T12", room: "Main Dining Room", seats: 4, status: "free", qrToken: makeQrToken() },
];

export function makeSeedState(): AdminState {
  return {
    taxRate: 0.085,
    currency: "USD",
    categories,
    items,
    tables,
    // Some closed checks earlier in the day, so the dashboard / analytics have history.
    sales: [
      { id: "sale-1", tableLabel: "T5", totalCents: 14500, method: "card", at: now - 18 * MIN },
      { id: "sale-2", tableLabel: "T9", totalCents: 8230, method: "cash", at: now - 1 * HOUR },
      { id: "sale-3", tableLabel: "T2", totalCents: 22140, method: "card", at: now - 2 * HOUR },
      { id: "sale-4", tableLabel: "T8", totalCents: 6650, method: "cash", at: now - 3 * HOUR },
      { id: "sale-5", tableLabel: "T11", totalCents: 41200, method: "card", at: now - 4 * HOUR },
    ],
  };
}
