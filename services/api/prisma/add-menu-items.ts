/**
 * Additive menu extension — grows ONE tenant's counter menu without a wipe.
 *
 * Unlike `seed.ts` (which deletes children → parents and rebuilds all three demo
 * tenants), this script only ever **INSERTs**. It never deletes, never renames
 * and never edits a row that already exists, so it is safe to run against a
 * live restaurant's database:
 *
 *   - a category is created only if the tenant has no category of that name
 *   - an item is created only if the tenant has no item of that name
 *     (case-insensitive) — an existing item keeps its own price, photo,
 *     availability and modifier groups, untouched
 *   - re-running is a no-op: everything reports as "skipped (already there)"
 *
 * Menus are per-restaurant, so this targets a SINGLE tenant — `amber-grain` by
 * default. Pass another slug only if you really mean to.
 *
 *   pnpm --filter @amber/api menu:extend                # amber-grain
 *   pnpm --filter @amber/api menu:extend -- --dry-run   # preview, writes nothing
 *   pnpm --filter @amber/api menu:extend -- --tenant=<slug>
 *
 * Prices below are authored in **rupees** (`rs(180)` → 18000 paise) because the
 * target tenant bills in INR; the script aborts if the tenant's currency is
 * something else, so a ₹ price list can't silently land on a $ menu.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const FORCE_CURRENCY = argv.includes("--force-currency");
const TENANT_SLUG =
  argv.find((a) => a.startsWith("--tenant="))?.slice("--tenant=".length) ??
  argv.find((a) => !a.startsWith("--")) ??
  "amber-grain";

// ── Types (mirror seed.ts's shapes so items can be moved between the two) ────

type ModifierInputType = "single" | "multiple" | "toggle" | "text";
type DietaryType = "veg" | "non_veg";

interface SeedModifierOption {
  name: string;
  priceDelta?: number; // minor units (paise)
}
interface SeedModifierGroup {
  name: string;
  inputType: ModifierInputType;
  required?: boolean;
  minSelect?: number;
  maxSelect?: number | null;
  maxLength?: number | null;
  placeholder?: string;
  options?: SeedModifierOption[];
}
interface SeedItem {
  name: string;
  category: string;
  price: number; // minor units (paise)
  description: string;
  icon: string;
  swatch: string;
  badge?: string;
  available?: boolean;
  dietary?: DietaryType;
  /** Jain (no roots/onion/garlic) — independent of `dietary`. */
  jain?: boolean;
  imageUrl?: string;
  /** Custom modifier groups (see api-reference/MODIFIERS.md). */
  modifiers?: SeedModifierGroup[];
}

/** ₹ → minor units. The whole price list below is written in rupees. */
const rs = (rupees: number): number => Math.round(rupees * 100);

/**
 * Keyword-locked LoremFlickr photo (same helper/convention as `seed.ts`).
 * `lock` pins one result so the menu doesn't reshuffle on every load. These are
 * stand-ins — replace with real uploads via the admin (→ Supabase Storage).
 * `FoodImage` falls back to the item's icon + swatch if a URL ever fails.
 */
const flickr = (tag: string, lock = 1): string =>
  `https://loremflickr.com/800/600/${tag}?lock=${lock}`;

// ── Reusable modifier groups ─────────────────────────────────────────────────
// Customizations are attached only where the dish genuinely has a choice — a
// bottle of water or a rasmalai gets none, so the counter stays two taps.

/** Required spice pick — the one question the kitchen always needs answered. */
const spiceLevel = (): SeedModifierGroup => ({
  name: "Spice Level",
  inputType: "single",
  required: true,
  options: [{ name: "Mild" }, { name: "Medium" }, { name: "Spicy" }],
});

/** Half/full portion. `extra` is the surcharge for the full plate. */
const portion = (extra: number): SeedModifierGroup => ({
  name: "Portion",
  inputType: "single",
  required: true,
  options: [{ name: "Half" }, { name: "Full", priceDelta: extra }],
});

/** Free-text line that rides through to the KOT. */
const kitchenNote = (placeholder: string): SeedModifierGroup => ({
  name: "Notes for the kitchen",
  inputType: "text",
  maxLength: 140,
  placeholder,
});

const breadChoice = (): SeedModifierGroup => ({
  name: "Bread",
  inputType: "single",
  required: true,
  options: [
    { name: "Tandoori Roti" },
    { name: "Butter Roti", priceDelta: rs(20) },
    { name: "Butter Naan", priceDelta: rs(40) },
  ],
});

const gravyStyle = (): SeedModifierGroup => ({
  name: "Style",
  inputType: "single",
  required: true,
  options: [{ name: "Dry" }, { name: "Gravy" }],
});

const drinkSize = (extra: number): SeedModifierGroup => ({
  name: "Size",
  inputType: "single",
  required: true,
  options: [{ name: "Regular" }, { name: "Large", priceDelta: extra }],
});

// ── The new menu ─────────────────────────────────────────────────────────────
// Categories are created in this order if the tenant doesn't already have them.
// Existing ones (Starters / Mains / Sides / Drinks / Desserts) are reused as-is.

const NEW_CATEGORIES = [
  "Snacks & Chaat",
  "South Indian",
  "Rice & Biryani",
  "Breads",
  "Chinese",
  "Combos & Thalis",
];

const ITEMS: SeedItem[] = [
  // ── Snacks & Chaat ─────────────────────────────────────────────────────────
  {
    name: "Pav Bhaji",
    category: "Snacks & Chaat",
    price: rs(180),
    description: "Buttery mashed vegetable curry, toasted pav, onion & lime.",
    icon: "brunch_dining",
    swatch: "from-orange-300 to-red-400",
    dietary: "veg",
    badge: "Popular",
    imageUrl: flickr("pav-bhaji", 11),
    modifiers: [
      spiceLevel(),
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [
          { name: "Extra pav (2)", priceDelta: rs(30) },
          { name: "Cheese", priceDelta: rs(40) },
          { name: "Extra butter", priceDelta: rs(20) },
        ],
      },
    ],
  },
  {
    name: "Vada Pav",
    category: "Snacks & Chaat",
    price: rs(60),
    description: "Spiced potato fritter in a soft bun, dry garlic chutney.",
    icon: "lunch_dining",
    swatch: "from-amber-200 to-orange-400",
    dietary: "veg",
    imageUrl: flickr("vada-pav", 12),
    modifiers: [
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [
          { name: "Fried green chilli", priceDelta: rs(10) },
          { name: "Extra chutney", priceDelta: rs(10) },
          { name: "Cheese slice", priceDelta: rs(30) },
        ],
      },
    ],
  },
  {
    name: "Samosa Chaat",
    category: "Snacks & Chaat",
    price: rs(120),
    description: "Crushed samosa, chole, yoghurt, tamarind & mint chutney.",
    icon: "tapas",
    swatch: "from-yellow-200 to-amber-400",
    dietary: "veg",
    imageUrl: flickr("samosa-chaat", 13),
    modifiers: [spiceLevel()],
  },
  {
    name: "Pani Puri (6 pcs)",
    category: "Snacks & Chaat",
    price: rs(80),
    description: "Crisp puris, spiced potato, chilled mint water.",
    icon: "tapas",
    swatch: "from-lime-200 to-emerald-300",
    dietary: "veg",
    imageUrl: flickr("pani-puri", 14),
    modifiers: [
      {
        name: "Pani",
        inputType: "single",
        required: true,
        options: [{ name: "Regular" }, { name: "Extra spicy" }, { name: "Sweet & tangy" }],
      },
    ],
  },
  {
    name: "Dahi Puri",
    category: "Snacks & Chaat",
    price: rs(110),
    description: "Puris filled with potato, chilled yoghurt, sev & chutneys.",
    icon: "tapas",
    swatch: "from-stone-200 to-amber-300",
    dietary: "veg",
    imageUrl: flickr("dahi-puri", 15),
  },
  {
    name: "Bhel Puri",
    category: "Snacks & Chaat",
    price: rs(90),
    description: "Puffed rice, onion, tomato, sev, tamarind chutney.",
    icon: "rice_bowl",
    swatch: "from-amber-100 to-yellow-300",
    dietary: "veg",
    imageUrl: flickr("bhel-puri", 16),
    modifiers: [spiceLevel()],
  },
  {
    name: "Masala Papad",
    category: "Snacks & Chaat",
    price: rs(70),
    description: "Roasted papad topped with onion, tomato & chaat masala.",
    icon: "cookie",
    swatch: "from-yellow-100 to-orange-200",
    dietary: "veg",
    imageUrl: flickr("papad", 17),
    modifiers: [
      {
        name: "Papad",
        inputType: "single",
        required: true,
        options: [{ name: "Roasted" }, { name: "Fried" }],
      },
    ],
  },
  {
    name: "Cheese Grilled Sandwich",
    category: "Snacks & Chaat",
    price: rs(140),
    description: "Griddled sandwich, melting cheese, mint chutney.",
    icon: "lunch_dining",
    swatch: "from-yellow-200 to-amber-300",
    dietary: "veg",
    imageUrl: flickr("grilled-sandwich", 18),
    modifiers: [
      {
        name: "Bread",
        inputType: "single",
        required: true,
        options: [
          { name: "White" },
          { name: "Brown" },
          { name: "Multigrain", priceDelta: rs(10) },
        ],
      },
      {
        // Capped multi-pick (checkboxes) rather than a toggle row: the griddle
        // can only hold so much before the sandwich stops closing.
        name: "Fillings",
        inputType: "multiple",
        minSelect: 0,
        maxSelect: 3,
        options: [
          { name: "Extra cheese", priceDelta: rs(40) },
          { name: "Grilled veggies", priceDelta: rs(30) },
          { name: "Sweet corn", priceDelta: rs(30) },
          { name: "Paneer", priceDelta: rs(50) },
          { name: "Jalapeño", priceDelta: rs(20) },
        ],
      },
    ],
  },

  // ── South Indian ───────────────────────────────────────────────────────────
  {
    name: "Plain Dosa",
    category: "South Indian",
    price: rs(130),
    description: "Crisp rice crêpe, sambar & coconut chutney.",
    icon: "restaurant",
    swatch: "from-amber-100 to-yellow-300",
    dietary: "veg",
    imageUrl: flickr("dosa", 21),
    modifiers: [
      {
        name: "Make it",
        inputType: "single",
        required: true,
        options: [
          { name: "Plain" },
          { name: "Butter", priceDelta: rs(30) },
          { name: "Ghee roast", priceDelta: rs(50) },
        ],
      },
    ],
  },
  {
    name: "Masala Dosa",
    category: "South Indian",
    price: rs(160),
    description: "Dosa folded over spiced potato masala, sambar & chutney.",
    icon: "restaurant",
    swatch: "from-yellow-200 to-amber-400",
    dietary: "veg",
    badge: "Popular",
    imageUrl: flickr("masala-dosa", 22),
    modifiers: [
      {
        name: "Make it",
        inputType: "single",
        required: true,
        options: [
          { name: "Plain" },
          { name: "Butter", priceDelta: rs(30) },
          { name: "Ghee roast", priceDelta: rs(50) },
        ],
      },
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [
          { name: "Extra sambar", priceDelta: rs(30) },
          { name: "Extra chutney", priceDelta: rs(20) },
          { name: "Cheese", priceDelta: rs(40) },
        ],
      },
    ],
  },
  {
    name: "Rava Dosa",
    category: "South Indian",
    price: rs(170),
    description: "Lacy semolina dosa, cumin & curry leaf.",
    icon: "restaurant",
    swatch: "from-amber-200 to-orange-300",
    dietary: "veg",
    imageUrl: flickr("rava-dosa", 23),
    modifiers: [
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [
          { name: "Onion", priceDelta: rs(20) },
          { name: "Cheese", priceDelta: rs(40) },
        ],
      },
    ],
  },
  {
    name: "Idli Sambar (3 pcs)",
    category: "South Indian",
    price: rs(110),
    description: "Steamed rice cakes, hot sambar, coconut chutney.",
    icon: "rice_bowl",
    swatch: "from-stone-100 to-amber-200",
    dietary: "veg",
    jain: true,
    imageUrl: flickr("idli", 24),
  },
  {
    name: "Medu Vada (2 pcs)",
    category: "South Indian",
    price: rs(100),
    description: "Crisp lentil doughnuts, sambar & chutney.",
    icon: "donut_small",
    swatch: "from-amber-200 to-yellow-400",
    dietary: "veg",
    imageUrl: flickr("medu-vada", 25),
  },
  {
    name: "Uttapam",
    category: "South Indian",
    price: rs(150),
    description: "Thick savoury pancake, griddled with toppings.",
    icon: "breakfast_dining",
    swatch: "from-orange-200 to-amber-400",
    dietary: "veg",
    imageUrl: flickr("uttapam", 26),
    modifiers: [
      {
        name: "Topping",
        inputType: "single",
        required: true,
        options: [
          { name: "Onion" },
          { name: "Tomato" },
          { name: "Mixed veg" },
          { name: "Cheese", priceDelta: rs(40) },
        ],
      },
    ],
  },

  // ── Rice & Biryani ─────────────────────────────────────────────────────────
  {
    name: "Veg Biryani",
    category: "Rice & Biryani",
    price: rs(240),
    description: "Dum-cooked basmati, seasonal vegetables, fried onion.",
    icon: "rice_bowl",
    swatch: "from-amber-200 to-orange-400",
    dietary: "veg",
    imageUrl: flickr("veg-biryani", 31),
    modifiers: [
      portion(rs(90)),
      spiceLevel(),
      {
        name: "Sides",
        inputType: "toggle",
        options: [
          { name: "Boondi raita", priceDelta: rs(40) },
          { name: "Mirchi ka salan", priceDelta: rs(30) },
        ],
      },
    ],
  },
  {
    name: "Chicken Biryani",
    category: "Rice & Biryani",
    price: rs(320),
    description: "Hyderabadi dum biryani, marinated chicken, saffron.",
    icon: "rice_bowl",
    swatch: "from-orange-300 to-red-400",
    dietary: "non_veg",
    badge: "Bestseller",
    imageUrl: flickr("chicken-biryani", 32),
    modifiers: [
      portion(rs(120)),
      spiceLevel(),
      {
        name: "Sides",
        inputType: "toggle",
        options: [
          { name: "Boondi raita", priceDelta: rs(40) },
          { name: "Mirchi ka salan", priceDelta: rs(30) },
          { name: "Extra gravy", priceDelta: rs(50) },
        ],
      },
      kitchenNote("e.g. leg piece please"),
    ],
  },
  {
    name: "Mutton Biryani",
    category: "Rice & Biryani",
    price: rs(420),
    description: "Slow-cooked mutton, long-grain basmati, whole spices.",
    icon: "rice_bowl",
    swatch: "from-red-300 to-rose-500",
    dietary: "non_veg",
    imageUrl: flickr("mutton-biryani", 33),
    modifiers: [portion(rs(150)), spiceLevel()],
  },
  {
    name: "Jeera Rice",
    category: "Rice & Biryani",
    price: rs(140),
    description: "Basmati tempered with cumin & ghee.",
    icon: "rice_bowl",
    swatch: "from-stone-100 to-amber-200",
    dietary: "veg",
    jain: true,
    imageUrl: flickr("jeera-rice", 34),
  },
  {
    name: "Veg Pulao",
    category: "Rice & Biryani",
    price: rs(180),
    description: "Fragrant rice tossed with garden vegetables.",
    icon: "rice_bowl",
    swatch: "from-lime-200 to-emerald-300",
    dietary: "veg",
    imageUrl: flickr("pulao", 35),
  },
  {
    name: "Curd Rice",
    category: "Rice & Biryani",
    price: rs(120),
    description: "Soft rice folded into curd, curry leaf tempering.",
    icon: "rice_bowl",
    swatch: "from-slate-100 to-stone-200",
    dietary: "veg",
    imageUrl: flickr("curd-rice", 36),
  },

  // ── Breads ─────────────────────────────────────────────────────────────────
  {
    name: "Butter Naan",
    category: "Breads",
    price: rs(60),
    description: "Tandoor-baked naan brushed with butter.",
    icon: "bakery_dining",
    swatch: "from-amber-100 to-yellow-300",
    dietary: "veg",
    imageUrl: flickr("naan", 41),
  },
  {
    name: "Tandoori Roti",
    category: "Breads",
    price: rs(40),
    description: "Whole-wheat roti straight off the tandoor.",
    icon: "bakery_dining",
    swatch: "from-stone-200 to-amber-200",
    dietary: "veg",
    jain: true,
    imageUrl: flickr("roti", 42),
    modifiers: [
      {
        name: "Butter",
        inputType: "toggle",
        options: [{ name: "With butter", priceDelta: rs(10) }],
      },
    ],
  },
  {
    name: "Laccha Paratha",
    category: "Breads",
    price: rs(70),
    description: "Flaky layered whole-wheat paratha.",
    icon: "bakery_dining",
    swatch: "from-amber-200 to-orange-300",
    dietary: "veg",
    jain: true,
    imageUrl: flickr("paratha", 43),
  },
  {
    name: "Missi Roti",
    category: "Breads",
    price: rs(55),
    description: "Gram-flour roti, ajwain & green chilli.",
    icon: "bakery_dining",
    swatch: "from-yellow-200 to-amber-300",
    dietary: "veg",
    imageUrl: flickr("missi-roti", 44),
  },
  {
    name: "Cheese Naan",
    category: "Breads",
    price: rs(110),
    description: "Naan stuffed with molten cheese.",
    icon: "bakery_dining",
    swatch: "from-yellow-100 to-amber-400",
    dietary: "veg",
    imageUrl: flickr("cheese-naan", 45),
  },

  // ── Chinese ────────────────────────────────────────────────────────────────
  {
    name: "Veg Hakka Noodles",
    category: "Chinese",
    price: rs(190),
    description: "Wok-tossed noodles, julienned vegetables, soy.",
    icon: "ramen_dining",
    swatch: "from-amber-200 to-orange-300",
    dietary: "veg",
    imageUrl: flickr("hakka-noodles", 51),
    modifiers: [
      spiceLevel(),
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [
          { name: "Extra veggies", priceDelta: rs(40) },
          { name: "Schezwan twist", priceDelta: rs(30) },
        ],
      },
    ],
  },
  {
    name: "Chicken Fried Rice",
    category: "Chinese",
    price: rs(250),
    description: "Wok-fried rice, shredded chicken, spring onion.",
    icon: "rice_bowl",
    swatch: "from-orange-200 to-red-300",
    dietary: "non_veg",
    imageUrl: flickr("fried-rice", 52),
    modifiers: [spiceLevel()],
  },
  {
    name: "Veg Manchurian",
    category: "Chinese",
    price: rs(210),
    description: "Vegetable dumplings in a garlic-soy sauce.",
    icon: "tapas",
    swatch: "from-amber-300 to-red-400",
    dietary: "veg",
    imageUrl: flickr("manchurian", 53),
    modifiers: [gravyStyle(), spiceLevel()],
  },
  {
    name: "Chilli Paneer",
    category: "Chinese",
    price: rs(240),
    description: "Paneer tossed with capsicum, onion & green chilli.",
    icon: "kebab_dining",
    swatch: "from-lime-300 to-emerald-400",
    dietary: "veg",
    badge: "Popular",
    imageUrl: flickr("chilli-paneer", 54),
    modifiers: [gravyStyle(), spiceLevel()],
  },
  {
    name: "Spring Rolls (4 pcs)",
    category: "Chinese",
    price: rs(160),
    description: "Crisp rolls stuffed with vegetables, chilli dip.",
    icon: "tapas",
    swatch: "from-yellow-200 to-amber-400",
    dietary: "veg",
    imageUrl: flickr("spring-rolls", 55),
  },

  // ── Combos & Thalis ────────────────────────────────────────────────────────
  {
    name: "Veg Thali",
    category: "Combos & Thalis",
    price: rs(320),
    description: "Two sabzi, dal, rice, breads, salad, papad & sweet.",
    icon: "dinner_dining",
    swatch: "from-amber-200 to-orange-400",
    dietary: "veg",
    badge: "Value",
    imageUrl: flickr("thali", 61),
    modifiers: [
      breadChoice(),
      spiceLevel(),
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [
          { name: "Extra sabzi", priceDelta: rs(60) },
          { name: "Extra sweet", priceDelta: rs(50) },
          { name: "Buttermilk", priceDelta: rs(40) },
        ],
      },
      kitchenNote("e.g. no onion & garlic"),
    ],
  },
  {
    name: "Deluxe Veg Thali",
    category: "Combos & Thalis",
    price: rs(450),
    description: "Paneer main, two sabzi, dal makhani, rice, breads & dessert.",
    icon: "dinner_dining",
    swatch: "from-orange-300 to-red-400",
    dietary: "veg",
    imageUrl: flickr("indian-thali", 62),
    modifiers: [breadChoice(), spiceLevel(), kitchenNote("e.g. Jain, no root vegetables")],
  },
  {
    name: "Non-Veg Thali",
    category: "Combos & Thalis",
    price: rs(480),
    description: "Chicken curry, kebab, dal, rice, breads, salad & sweet.",
    icon: "dinner_dining",
    swatch: "from-red-300 to-rose-500",
    dietary: "non_veg",
    imageUrl: flickr("non-veg-thali", 63),
    modifiers: [breadChoice(), spiceLevel()],
  },
  {
    name: "Dosa & Filter Coffee Combo",
    category: "Combos & Thalis",
    price: rs(200),
    description: "Masala dosa with a tumbler of South Indian filter coffee.",
    icon: "brunch_dining",
    swatch: "from-stone-200 to-amber-300",
    dietary: "veg",
    imageUrl: flickr("dosa-coffee", 64),
  },
  {
    name: "Pav Bhaji & Lassi Combo",
    category: "Combos & Thalis",
    price: rs(260),
    description: "Pav bhaji plate with a chilled sweet lassi.",
    icon: "brunch_dining",
    swatch: "from-amber-300 to-orange-500",
    dietary: "veg",
    imageUrl: flickr("pav-bhaji-lassi", 65),
    modifiers: [spiceLevel()],
  },

  // ── Starters (added to the existing category) ──────────────────────────────
  {
    name: "Chicken Tikka",
    category: "Starters",
    price: rs(340),
    description: "Charred yoghurt-marinated chicken, mint chutney.",
    icon: "kebab_dining",
    swatch: "from-red-300 to-orange-400",
    dietary: "non_veg",
    imageUrl: flickr("chicken-tikka", 71),
    modifiers: [portion(rs(130)), spiceLevel()],
  },
  {
    name: "Hara Bhara Kabab",
    category: "Starters",
    price: rs(220),
    description: "Spinach, pea & potato patties, pan-seared.",
    icon: "eco",
    swatch: "from-green-300 to-emerald-400",
    dietary: "veg",
    imageUrl: flickr("hara-bhara-kabab", 72),
  },
  {
    name: "Chilli Cheese Toast",
    category: "Starters",
    price: rs(150),
    description: "Grilled toast, green chilli & bubbling cheese.",
    icon: "bakery_dining",
    swatch: "from-yellow-200 to-amber-400",
    dietary: "veg",
    imageUrl: flickr("cheese-toast", 73),
  },

  // ── Mains (added to the existing category) ─────────────────────────────────
  {
    name: "Paneer Butter Masala",
    category: "Mains",
    price: rs(280),
    description: "Cottage cheese in a silky tomato-cashew gravy.",
    icon: "ramen_dining",
    swatch: "from-orange-300 to-red-400",
    dietary: "veg",
    badge: "Popular",
    imageUrl: flickr("paneer-butter-masala", 81),
    modifiers: [
      spiceLevel(),
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [
          { name: "Extra gravy", priceDelta: rs(60) },
          { name: "Extra cream", priceDelta: rs(30) },
        ],
      },
      kitchenNote("e.g. less oil"),
    ],
  },
  {
    name: "Dal Makhani",
    category: "Mains",
    price: rs(230),
    description: "Black lentils simmered overnight with butter & cream.",
    icon: "soup_kitchen",
    swatch: "from-stone-300 to-amber-500",
    dietary: "veg",
    imageUrl: flickr("dal-makhani", 82),
    modifiers: [spiceLevel()],
  },
  {
    name: "Palak Paneer",
    category: "Mains",
    price: rs(260),
    description: "Paneer in a smooth spinach gravy, garlic tempering.",
    icon: "eco",
    swatch: "from-green-300 to-emerald-500",
    dietary: "veg",
    imageUrl: flickr("palak-paneer", 83),
    modifiers: [spiceLevel()],
  },
  {
    name: "Kadai Chicken",
    category: "Mains",
    price: rs(330),
    description: "Chicken tossed with peppers in a roasted kadai masala.",
    icon: "ramen_dining",
    swatch: "from-red-300 to-rose-400",
    dietary: "non_veg",
    imageUrl: flickr("kadai-chicken", 84),
    modifiers: [spiceLevel(), kitchenNote("e.g. boneless only")],
  },
  {
    name: "Chole Bhature",
    category: "Mains",
    price: rs(190),
    description: "Spiced chickpeas with two puffed bhature, onion & pickle.",
    icon: "dinner_dining",
    swatch: "from-amber-200 to-orange-400",
    dietary: "veg",
    imageUrl: flickr("chole-bhature", 85),
    modifiers: [
      spiceLevel(),
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [{ name: "Extra bhatura", priceDelta: rs(50) }],
      },
    ],
  },

  // ── Sides (added to the existing category) ─────────────────────────────────
  {
    name: "Boondi Raita",
    category: "Sides",
    price: rs(80),
    description: "Whisked curd, crisp boondi, roasted cumin.",
    icon: "soup_kitchen",
    swatch: "from-slate-100 to-stone-200",
    dietary: "veg",
    imageUrl: flickr("raita", 91),
  },
  {
    name: "Green Salad",
    category: "Sides",
    price: rs(90),
    description: "Cucumber, tomato, onion & carrot with lime.",
    icon: "eco",
    swatch: "from-lime-200 to-green-300",
    dietary: "veg",
    jain: true,
    imageUrl: flickr("green-salad", 92),
  },
  {
    name: "Masala Fries",
    category: "Sides",
    price: rs(130),
    description: "Crisp fries tossed in house masala.",
    icon: "fastfood",
    swatch: "from-yellow-200 to-amber-400",
    dietary: "veg",
    imageUrl: flickr("masala-fries", 93),
    modifiers: [
      {
        name: "Seasoning",
        inputType: "single",
        required: true,
        options: [{ name: "Classic salt" }, { name: "Peri-peri" }, { name: "Chaat masala" }],
      },
    ],
  },

  // ── Drinks (added to the existing category) ────────────────────────────────
  {
    name: "Sweet Lassi",
    category: "Drinks",
    price: rs(120),
    description: "Thick churned curd, sugar, a pinch of cardamom.",
    icon: "local_drink",
    swatch: "from-stone-100 to-amber-200",
    dietary: "veg",
    imageUrl: flickr("lassi", 101),
    modifiers: [drinkSize(rs(40))],
  },
  {
    name: "Mango Lassi",
    category: "Drinks",
    price: rs(140),
    description: "Alphonso pulp blended with sweet curd.",
    icon: "local_drink",
    swatch: "from-yellow-200 to-orange-300",
    dietary: "veg",
    imageUrl: flickr("mango-lassi", 102),
    modifiers: [drinkSize(rs(40))],
  },
  {
    name: "Filter Coffee",
    category: "Drinks",
    price: rs(70),
    description: "South Indian decoction coffee, frothed by the tumbler.",
    icon: "coffee",
    swatch: "from-stone-300 to-amber-400",
    dietary: "veg",
    imageUrl: flickr("filter-coffee", 103),
    modifiers: [
      {
        name: "Sugar",
        inputType: "single",
        required: true,
        options: [{ name: "Regular" }, { name: "Less sugar" }, { name: "No sugar" }],
      },
    ],
  },
  {
    name: "Fresh Lime Soda",
    category: "Drinks",
    price: rs(90),
    description: "Hand-squeezed lime over chilled soda.",
    icon: "local_drink",
    swatch: "from-lime-200 to-emerald-300",
    dietary: "veg",
    imageUrl: flickr("lime-soda", 104),
    modifiers: [
      {
        name: "Style",
        inputType: "single",
        required: true,
        options: [{ name: "Sweet" }, { name: "Salted" }, { name: "Mixed" }],
      },
    ],
  },
  {
    name: "Buttermilk (Chaas)",
    category: "Drinks",
    price: rs(60),
    description: "Spiced churned buttermilk, cumin & coriander.",
    icon: "local_drink",
    swatch: "from-slate-100 to-lime-200",
    dietary: "veg",
    imageUrl: flickr("buttermilk", 105),
  },
  {
    name: "Cold Coffee",
    category: "Drinks",
    price: rs(160),
    description: "Blended iced coffee, thick and frothy.",
    icon: "coffee",
    swatch: "from-stone-400 to-amber-300",
    dietary: "veg",
    imageUrl: flickr("cold-coffee", 106),
    modifiers: [
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [
          { name: "Ice cream scoop", priceDelta: rs(50) },
          { name: "Extra shot", priceDelta: rs(30) },
        ],
      },
    ],
  },
  {
    name: "Bottled Water (1L)",
    category: "Drinks",
    price: rs(40),
    description: "Sealed packaged drinking water.",
    icon: "water_drop",
    swatch: "from-sky-100 to-blue-200",
    dietary: "veg",
    jain: true,
  },

  // ── Desserts (added to the existing category) ──────────────────────────────
  {
    name: "Rasmalai (2 pcs)",
    category: "Desserts",
    price: rs(140),
    description: "Soft chenna discs in saffron-cardamom milk.",
    icon: "icecream",
    swatch: "from-yellow-100 to-amber-200",
    dietary: "veg",
    imageUrl: flickr("rasmalai", 111),
  },
  {
    name: "Kulfi Falooda",
    category: "Desserts",
    price: rs(160),
    description: "Malai kulfi, falooda sev, rose syrup & basil seeds.",
    icon: "icecream",
    swatch: "from-rose-200 to-pink-300",
    dietary: "veg",
    imageUrl: flickr("kulfi", 112),
  },
  {
    name: "Sizzling Brownie",
    category: "Desserts",
    price: rs(220),
    description: "Warm brownie, vanilla ice cream, hot chocolate sauce.",
    icon: "cake",
    swatch: "from-stone-400 to-amber-600",
    dietary: "veg",
    badge: "Signature",
    imageUrl: flickr("brownie", 113),
    modifiers: [
      {
        name: "Add-ons",
        inputType: "toggle",
        options: [
          { name: "Extra ice cream scoop", priceDelta: rs(60) },
          { name: "Extra chocolate sauce", priceDelta: rs(30) },
        ],
      },
    ],
  },
  {
    name: "Moong Dal Halwa",
    category: "Desserts",
    price: rs(150),
    description: "Slow-roasted lentil halwa, ghee & almond slivers.",
    icon: "cake",
    swatch: "from-amber-300 to-orange-400",
    dietary: "veg",
    imageUrl: flickr("halwa", 114),
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true, name: true, currency: true },
  });
  if (!tenant) {
    const all = await prisma.tenant.findMany({ select: { slug: true } });
    throw new Error(
      `No tenant with slug "${TENANT_SLUG}". Known slugs: ${all
        .map((t) => t.slug)
        .join(", ")}`,
    );
  }

  // The price list is written in rupees. Landing it on a tenant that bills in
  // another currency would silently 100×-mangle every price, so stop.
  if (tenant.currency !== "INR" && !FORCE_CURRENCY) {
    throw new Error(
      `Tenant "${tenant.slug}" bills in ${tenant.currency}, but this price list is authored in INR. ` +
        `Re-price the items or pass --force-currency if you really mean it.`,
    );
  }

  console.log(
    `\n${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}` +
      `Tenant: ${tenant.name} (${tenant.slug}) · ${tenant.currency}`,
  );

  // ── Categories: reuse by name, create only what's missing ─────────────────
  const existingCats = await prisma.menuCategory.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, sortOrder: true },
  });
  const catId = new Map(existingCats.map((c) => [c.name, c.id]));
  let nextCatSort = existingCats.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;

  const neededCats = [...new Set(ITEMS.map((i) => i.category))];
  // Create in the declared order first, then any other category an item needs.
  const orderedNeeded = [
    ...NEW_CATEGORIES.filter((c) => neededCats.includes(c)),
    ...neededCats.filter((c) => !NEW_CATEGORIES.includes(c)),
  ];

  let catsCreated = 0;
  for (const name of orderedNeeded) {
    if (catId.has(name)) {
      console.log(`  cat  = ${name} (already there)`);
      continue;
    }
    catsCreated += 1;
    if (DRY_RUN) {
      console.log(`  cat  + ${name}`);
      catId.set(name, `dry-run-${name}`);
      continue;
    }
    const c = await prisma.menuCategory.create({
      data: { tenantId: tenant.id, name, sortOrder: nextCatSort++ },
    });
    catId.set(name, c.id);
    console.log(`  cat  + ${name}`);
  }

  // ── Items: skip any name the tenant already has ───────────────────────────
  const existing = await prisma.menuItem.findMany({
    where: { tenantId: tenant.id },
    select: { name: true, categoryId: true, sortOrder: true },
  });
  const taken = new Set(existing.map((i) => i.name.trim().toLowerCase()));
  // Next free sortOrder per category, so new items land after the current ones.
  const nextSort = new Map<string, number>();
  for (const i of existing) {
    nextSort.set(i.categoryId, Math.max(nextSort.get(i.categoryId) ?? -1, i.sortOrder) + 1);
  }

  let added = 0;
  let skipped = 0;
  for (const it of ITEMS) {
    if (taken.has(it.name.trim().toLowerCase())) {
      skipped += 1;
      console.log(`  item = ${it.name} (already there — left untouched)`);
      continue;
    }
    const categoryId = catId.get(it.category)!;
    const sortOrder = nextSort.get(categoryId) ?? 0;
    nextSort.set(categoryId, sortOrder + 1);
    taken.add(it.name.trim().toLowerCase());
    added += 1;

    const mods = it.modifiers?.length ?? 0;
    console.log(
      `  item + ${it.name}  [${it.category}] ` +
        `${(it.price / 100).toFixed(2)}${mods ? ` · ${mods} modifier group${mods === 1 ? "" : "s"}` : ""}`,
    );
    if (DRY_RUN) continue;

    await prisma.menuItem.create({
      data: {
        tenantId: tenant.id,
        categoryId,
        name: it.name,
        description: it.description,
        price: it.price,
        icon: it.icon,
        swatch: it.swatch,
        badge: it.badge,
        available: it.available ?? true,
        dietary: it.dietary,
        jain: it.jain ?? false,
        imageUrl: it.imageUrl,
        sortOrder,
        modifierGroups: it.modifiers?.length
          ? {
              create: it.modifiers.map((g, gi) => ({
                tenantId: tenant.id,
                name: g.name,
                inputType: g.inputType,
                required: g.required ?? false,
                minSelect: g.minSelect ?? 0,
                maxSelect: g.maxSelect ?? null,
                maxLength: g.maxLength ?? null,
                placeholder: g.placeholder,
                sortOrder: gi,
                options: {
                  create: (g.options ?? []).map((o, oi) => ({
                    tenantId: tenant.id,
                    name: o.name,
                    priceDelta: o.priceDelta ?? 0,
                    sortOrder: oi,
                  })),
                },
              })),
            }
          : undefined,
      },
    });
  }

  console.log(
    `\n${DRY_RUN ? "Would add" : "Added"}: ${catsCreated} categor${
      catsCreated === 1 ? "y" : "ies"
    }, ${added} item${added === 1 ? "" : "s"} · skipped ${skipped} already present.\n`,
  );
}

main()
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
