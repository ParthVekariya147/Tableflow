/**
 * Seeds the three tenants from the architecture diagram, each with a distinct
 * brand theme, to demonstrate "one codebase, many branded tenants".
 *
 * Amber & Grain is seeded end-to-end — categories, menu (with icon/swatch
 * stand-ins), rooms + tables, curated menu placements (Welcome carousels +
 * featured), staff users/memberships, and a realistic spread of orders,
 * payments and reviews — so the customer app, the manager cockpit, the KDS and
 * the analytics screens all have live data. Green Bowl and Bella Pizza get a
 * lean menu + tables to prove multi-tenancy when switching brands.
 *
 * Idempotent: wipes all rows (children → parents) then recreates from scratch,
 * so `pnpm db:seed` can be run repeatedly.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MIN = 60_000;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);

// Auth is a backend TODO; staff rows carry a clearly-fake hash until it lands.
const PLACEHOLDER_HASH = "$2b$10$seedplaceholderseedplaceholderseedplaceholders";

type ItemStatus = "placed" | "preparing" | "ready" | "served" | "cancelled";

interface SeedItem {
  name: string;
  category: string;
  price: number; // minor units (cents)
  description: string;
  icon: string;
  swatch: string;
  badge?: string;
  available?: boolean;
}

interface TableDef {
  label: string;
  room: string;
  seats: number;
}

async function wipe(): Promise<void> {
  await prisma.review.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItemModifier.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.round.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuPlacement.deleteMany();
  await prisma.modifierOption.deleteMany();
  await prisma.modifierGroup.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.table.deleteMany();
  await prisma.room.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
}

/** Create a tenant's categories + items. Returns a name → {id, price} lookup. */
async function seedMenu(
  tenantId: string,
  categoryNames: string[],
  items: SeedItem[],
): Promise<Map<string, { id: string; price: number }>> {
  const catId = new Map<string, string>();
  for (const [i, name] of categoryNames.entries()) {
    const c = await prisma.menuCategory.create({
      data: { tenantId, name, sortOrder: i },
    });
    catId.set(name, c.id);
  }

  const itemByName = new Map<string, { id: string; price: number }>();
  const perCat: Record<string, number> = {};
  for (const it of items) {
    const sortOrder = perCat[it.category] ?? 0;
    perCat[it.category] = sortOrder + 1;
    const mi = await prisma.menuItem.create({
      data: {
        tenantId,
        categoryId: catId.get(it.category)!,
        name: it.name,
        description: it.description,
        price: it.price,
        icon: it.icon,
        swatch: it.swatch,
        badge: it.badge,
        available: it.available ?? true,
        sortOrder,
      },
    });
    itemByName.set(it.name, { id: mi.id, price: mi.price });
  }
  return itemByName;
}

/** Create a tenant's rooms + tables. Returns a label → tableId lookup. */
async function seedTables(
  tenantId: string,
  slug: string,
  defs: TableDef[],
): Promise<Map<string, string>> {
  const roomId = new Map<string, string>();
  for (const [i, name] of [...new Set(defs.map((d) => d.room))].entries()) {
    const r = await prisma.room.create({ data: { tenantId, name, sortOrder: i } });
    roomId.set(name, r.id);
  }

  const tableByLabel = new Map<string, string>();
  for (const [i, d] of defs.entries()) {
    const t = await prisma.table.create({
      data: {
        tenantId,
        roomId: roomId.get(d.room)!,
        label: d.label,
        seats: d.seats,
        sortOrder: i,
        qrToken: `${slug}-${d.label.toLowerCase()}`,
      },
    });
    tableByLabel.set(d.label, t.id);
  }
  return tableByLabel;
}

// ── Menu data ────────────────────────────────────────────────────────────────

const AMBER_CATEGORIES = ["Starters", "Mains", "Sides", "Drinks", "Desserts"];
const AMBER_ITEMS: SeedItem[] = [
  // Starters
  { name: "Vegetable Samosa", category: "Starters", price: 600, description: "Crisp pastry, spiced potato & pea, tamarind chutney.", icon: "lunch_dining", swatch: "from-yellow-200 to-amber-400" },
  { name: "Soft Shell Crab", category: "Starters", price: 1450, description: "Lightly fried, micro-greens, citrus aioli.", icon: "set_meal", swatch: "from-rose-200 to-red-300", available: false },
  { name: "Paneer Tikka Bites", category: "Starters", price: 850, description: "Char-grilled paneer skewers, mint yogurt.", icon: "kebab_dining", swatch: "from-orange-200 to-amber-300" },
  // Mains
  { name: "Wagyu Burger", category: "Mains", price: 1800, description: "Wagyu patty, aged cheddar, brioche bun.", icon: "lunch_dining", swatch: "from-stone-300 to-amber-500", badge: "Signature" },
  { name: "Ribeye Steak", category: "Mains", price: 4400, description: "12oz dry-aged ribeye, peppercorn jus.", icon: "restaurant", swatch: "from-red-300 to-rose-500" },
  { name: "Grilled Salmon", category: "Mains", price: 2600, description: "Atlantic salmon, lemon butter, seasonal veg.", icon: "set_meal", swatch: "from-rose-200 to-orange-300" },
  { name: "Butter Chicken", category: "Mains", price: 1900, description: "Tandoori chicken, tomato-cream gravy, basmati.", icon: "ramen_dining", swatch: "from-orange-300 to-red-400", badge: "Popular" },
  // Sides
  { name: "Truffle Fries", category: "Sides", price: 900, description: "Hand-cut fries, truffle oil, parmesan.", icon: "fastfood", swatch: "from-yellow-200 to-amber-400" },
  { name: "House Salad", category: "Sides", price: 1200, description: "Mixed greens, heirloom tomato, vinaigrette.", icon: "eco", swatch: "from-green-200 to-emerald-400" },
  { name: "Garlic Naan", category: "Sides", price: 500, description: "Tandoor-baked flatbread, garlic butter.", icon: "bakery_dining", swatch: "from-amber-100 to-yellow-300" },
  // Drinks
  { name: "Masala Chai", category: "Drinks", price: 450, description: "Spiced black tea simmered with milk, cardamom & ginger.", icon: "local_cafe", swatch: "from-amber-200 to-orange-300" },
  { name: "House Old Fashioned", category: "Drinks", price: 1400, description: "Bourbon, bitters, demerara, orange twist.", icon: "local_bar", swatch: "from-amber-400 to-orange-600", badge: "Signature" },
  { name: "Oat Latte", category: "Drinks", price: 550, description: "Double espresso, steamed oat milk.", icon: "coffee", swatch: "from-stone-200 to-amber-300" },
  { name: "Fresh Lemonade", category: "Drinks", price: 600, description: "Hand-pressed lemon, mint, soda.", icon: "local_drink", swatch: "from-lime-200 to-yellow-300" },
  // Desserts
  { name: "Burnt Basque Cheesecake", category: "Desserts", price: 1100, description: "Caramelised top, vanilla cream.", icon: "cake", swatch: "from-amber-200 to-yellow-400" },
  { name: "Gulab Jamun", category: "Desserts", price: 700, description: "Warm milk dumplings, rose syrup.", icon: "icecream", swatch: "from-orange-200 to-rose-300" },
];

const AMBER_TABLES: TableDef[] = [
  { label: "T1", room: "Main Dining Room", seats: 4 },
  { label: "T2", room: "Main Dining Room", seats: 2 },
  { label: "T3", room: "Main Dining Room", seats: 4 },
  { label: "T4", room: "Main Dining Room", seats: 6 },
  { label: "T5", room: "Patio", seats: 2 },
  { label: "T6", room: "Patio", seats: 4 },
  { label: "T7", room: "Patio", seats: 4 },
  { label: "T8", room: "Bar", seats: 2 },
  { label: "T9", room: "Bar", seats: 2 },
  { label: "T10", room: "Private Room", seats: 8 },
  { label: "T11", room: "Private Room", seats: 6 },
  { label: "T12", room: "Main Dining Room", seats: 4 },
];

async function main(): Promise<void> {
  await wipe();

  // ── Amber & Grain (warm amber) ────────────────────────────────────────────
  const amber = await prisma.tenant.create({
    data: {
      slug: "amber-grain",
      name: "Amber & Grain",
      currency: "USD",
      taxRate: 0.1,
      theme: {
        mode: "light",
        colors: {
          primary: "#8c5000",
          "primary-container": "#e8943a",
          "secondary-container": "#fdcf49",
        },
        typography: { sans: "Plus Jakarta Sans, sans-serif", serif: "Literata, serif", fontLinks: [] },
      },
    },
  });
  const tenantId = amber.id;

  const item = await seedMenu(tenantId, AMBER_CATEGORIES, AMBER_ITEMS);
  const tables = await seedTables(tenantId, "amber-grain", AMBER_TABLES);
  const m = (name: string) => item.get(name)!;

  // Curated placements: Welcome carousels + Menu hero cards.
  const featured = ["Wagyu Burger", "Ribeye Steak"];
  for (const [i, name] of featured.entries()) {
    await prisma.menuPlacement.create({
      data: { tenantId, menuItemId: m(name).id, kind: "featured", sortOrder: i },
    });
  }
  const welcome: Record<string, string[]> = {
    drinks: ["Masala Chai", "Fresh Lemonade"],
    bites: ["Vegetable Samosa", "Paneer Tikka Bites"],
  };
  for (const [section, names] of Object.entries(welcome)) {
    for (const [i, name] of names.entries()) {
      await prisma.menuPlacement.create({
        data: { tenantId, menuItemId: m(name).id, kind: "welcome", section, sortOrder: i },
      });
    }
  }

  // Staff (auth deferred — placeholder hashes).
  const manager = await prisma.user.create({
    data: { email: "manager@amberandgrain.com", name: "Morgan Ellis", passwordHash: PLACEHOLDER_HASH, memberships: { create: { tenantId, role: "owner" } } },
  });
  const server = await prisma.user.create({
    data: { email: "server@amberandgrain.com", name: "Sam Rivera", passwordHash: PLACEHOLDER_HASH, memberships: { create: { tenantId, role: "server" } } },
  });
  await prisma.user.create({
    data: { email: "kitchen@amberandgrain.com", name: "Kit Tanaka", passwordHash: PLACEHOLDER_HASH, memberships: { create: { tenantId, role: "kitchen" } } },
  });
  await prisma.user.create({
    data: { email: "ops@amber.platform", name: "Platform Ops", passwordHash: PLACEHOLDER_HASH, isSuperAdmin: true },
  });

  // Helper to build one order-item create (snapshots name + price).
  const oi = (
    name: string,
    qty: number,
    status: ItemStatus,
    extra: { servedAt?: Date; readyAt?: Date; preparingAt?: Date; notes?: string } = {},
  ) => ({ tenantId, menuItemId: m(name).id, name, unitPrice: m(name).price, qty, status, ...extra });

  // Active session 1 — open, mix of served + preparing (drives KDS + status).
  await prisma.order.create({
    data: {
      tenantId, tableId: tables.get("T1")!, serverId: server.id, status: "open", createdAt: ago(45 * MIN),
      rounds: {
        create: [
          {
            tenantId, type: "bundled", createdAt: ago(20 * MIN),
            items: { create: [
              oi("House Old Fashioned", 2, "served", { preparingAt: ago(18 * MIN), readyAt: ago(15 * MIN), servedAt: ago(14 * MIN) }),
              oi("Paneer Tikka Bites", 1, "served", { preparingAt: ago(17 * MIN), readyAt: ago(12 * MIN), servedAt: ago(11 * MIN), notes: "Extra mint yogurt" }),
            ] },
          },
          {
            tenantId, type: "instant", createdAt: ago(5 * MIN),
            items: { create: [
              oi("Wagyu Burger", 2, "preparing", { preparingAt: ago(4 * MIN) }),
              oi("Truffle Fries", 1, "preparing", { preparingAt: ago(4 * MIN), notes: "No parmesan" }),
            ] },
          },
        ],
      },
    },
  });

  // Active session 2 — bill requested (drives the "Awaiting Bill" alert).
  await prisma.order.create({
    data: {
      tenantId, tableId: tables.get("T3")!, serverId: server.id, status: "billed", createdAt: ago(70 * MIN), billRequestedAt: ago(5 * MIN),
      rounds: { create: [{
        tenantId, type: "bundled", createdAt: ago(55 * MIN),
        items: { create: [
          oi("Ribeye Steak", 1, "served", { preparingAt: ago(50 * MIN), readyAt: ago(40 * MIN), servedAt: ago(38 * MIN) }),
          oi("Grilled Salmon", 1, "served", { preparingAt: ago(50 * MIN), readyAt: ago(41 * MIN), servedAt: ago(38 * MIN) }),
          oi("House Salad", 1, "served", { preparingAt: ago(50 * MIN), readyAt: ago(45 * MIN), servedAt: ago(44 * MIN) }),
        ] },
      }] },
    },
  });

  // Closed + paid history (drives Dashboard revenue + Analytics).
  async function paidOrder(
    tableLabel: string,
    lines: [string, number][],
    minsAgo: number,
    method: "cash" | "card",
  ): Promise<string> {
    const created = ago(minsAgo * MIN + 40 * MIN);
    const closed = ago(minsAgo * MIN);
    let subtotal = 0;
    const items = lines.map(([name, qty]) => {
      subtotal += m(name).price * qty;
      return oi(name, qty, "served", { preparingAt: ago(minsAgo * MIN + 30 * MIN), servedAt: ago(minsAgo * MIN + 15 * MIN) });
    });
    const order = await prisma.order.create({
      data: {
        tenantId, tableId: tables.get(tableLabel)!, serverId: server.id, status: "closed", createdAt: created, closedAt: closed,
        rounds: { create: [{ tenantId, type: "bundled", createdAt: created, items: { create: items } }] },
      },
    });
    const tax = Math.round(subtotal * amber.taxRate);
    const tip = method === "card" ? Math.round(subtotal * 0.18) : 0;
    const total = subtotal + tax + tip;
    await prisma.payment.create({
      data: {
        tenantId, orderId: order.id, method, subtotal, tax, tip, total,
        tendered: method === "cash" ? Math.ceil(total / 500) * 500 : null,
        takenById: manager.id, createdAt: closed,
      },
    });
    return order.id;
  }

  const paid1 = await paidOrder("T5", [["Wagyu Burger", 1], ["Truffle Fries", 1], ["House Old Fashioned", 1]], 18, "card");
  await paidOrder("T9", [["Butter Chicken", 1], ["Garlic Naan", 2]], 60, "cash");
  const paid3 = await paidOrder("T11", [["Ribeye Steak", 1], ["Grilled Salmon", 1], ["Burnt Basque Cheesecake", 2]], 120, "card");
  await paidOrder("T8", [["Masala Chai", 2], ["Gulab Jamun", 1]], 180, "cash");

  // A couple of guest reviews on closed orders.
  await prisma.review.create({ data: { tenantId, orderId: paid1, stars: 5, comment: "Wonderful evening — the Wagyu burger was unreal.", createdAt: ago(15 * MIN) } });
  await prisma.review.create({ data: { tenantId, orderId: paid3, stars: 4, createdAt: ago(110 * MIN) } });

  // ── Green Bowl (fresh green) ──────────────────────────────────────────────
  const green = await prisma.tenant.create({
    data: {
      slug: "green-bowl", name: "Green Bowl", currency: "USD", taxRate: 0.08,
      theme: {
        mode: "light",
        colors: { primary: "#1d9e75", "primary-container": "#3fc499", "secondary-container": "#bdf0d8" },
        typography: { sans: "Inter, sans-serif", serif: "Fraunces, serif", fontLinks: [] },
      },
    },
  });
  await seedMenu(green.id, ["Bowls", "Drinks", "Sides"], [
    { name: "Buddha Bowl", category: "Bowls", price: 1300, description: "Quinoa, roast veg, tahini dressing.", icon: "ramen_dining", swatch: "from-green-200 to-emerald-400", badge: "Signature" },
    { name: "Quinoa Crunch", category: "Bowls", price: 1200, description: "Crispy chickpeas, kale, avocado.", icon: "rice_bowl", swatch: "from-lime-200 to-green-300" },
    { name: "Green Goddess Smoothie", category: "Drinks", price: 700, description: "Spinach, mango, banana, coconut water.", icon: "local_drink", swatch: "from-emerald-200 to-teal-300" },
    { name: "Kombucha", category: "Drinks", price: 600, description: "House-brewed ginger kombucha.", icon: "sports_bar", swatch: "from-amber-100 to-lime-200" },
    { name: "Miso Soup", category: "Sides", price: 500, description: "White miso, tofu, scallion.", icon: "soup_kitchen", swatch: "from-yellow-100 to-amber-200" },
  ]);
  await seedTables(green.id, "green-bowl", [
    { label: "1", room: "Dining", seats: 2 }, { label: "2", room: "Dining", seats: 2 },
    { label: "3", room: "Dining", seats: 4 }, { label: "4", room: "Window", seats: 4 },
  ]);

  // ── Bella Pizza (rosso/pink) ──────────────────────────────────────────────
  const bella = await prisma.tenant.create({
    data: {
      slug: "bella-pizza", name: "Bella Pizza", currency: "USD", taxRate: 0.09,
      theme: {
        mode: "light",
        colors: { primary: "#d4537e", "primary-container": "#f08aab", "secondary-container": "#ffd9e3" },
        typography: { sans: "Poppins, sans-serif", serif: "Playfair Display, serif", fontLinks: [] },
      },
    },
  });
  await seedMenu(bella.id, ["Pizza", "Pasta", "Drinks"], [
    { name: "Margherita", category: "Pizza", price: 1400, description: "San Marzano, fior di latte, basil.", icon: "local_pizza", swatch: "from-red-200 to-rose-300", badge: "Classic" },
    { name: "Diavola", category: "Pizza", price: 1600, description: "Spicy salami, chilli, mozzarella.", icon: "local_pizza", swatch: "from-rose-300 to-red-400" },
    { name: "Carbonara", category: "Pasta", price: 1500, description: "Guanciale, egg, pecorino, pepper.", icon: "ramen_dining", swatch: "from-amber-100 to-yellow-300" },
    { name: "Chianti Glass", category: "Drinks", price: 900, description: "Tuscan red, by the glass.", icon: "wine_bar", swatch: "from-rose-300 to-red-500" },
    { name: "Aperol Spritz", category: "Drinks", price: 1000, description: "Aperol, prosecco, soda, orange.", icon: "local_bar", swatch: "from-orange-200 to-rose-300" },
  ]);
  await seedTables(bella.id, "bella-pizza", [
    { label: "1", room: "Trattoria", seats: 2 }, { label: "2", room: "Trattoria", seats: 4 },
    { label: "3", room: "Terrace", seats: 4 }, { label: "4", room: "Terrace", seats: 6 },
  ]);

  // eslint-disable-next-line no-console
  console.log("Seeded tenants: amber-grain (full demo), green-bowl, bella-pizza");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
