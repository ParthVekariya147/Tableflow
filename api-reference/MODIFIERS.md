# Menu Item Modifiers — Feature Spec

> **Status:** ✅ Implemented end-to-end (schema → domain → API → client → admin →
> customer → seed), per the §11 build order and the §12 decisions. Verified:
> `GET /menu` serializes groups; admin authors via the full modal; guest selects in
> `ItemSheet`; rounds persist modifiers; the server re-prices/validates (invalid
> option → 400, missing required → 400); subtotal/tax include deltas.
>
> **Owner:** restaurant-admin (authoring) + customer (ordering) + API (contract).
> Sibling of `FEATURES.md`; see `CLAUDE.md` for the overall architecture.

## 1. Goal

Let a restaurant admin attach **custom modifiers** to any menu item and control
**how each modifier renders** in the guest ordering flow. Modifiers can change the
line price (e.g. *Extra cheese +$2.00*) and can be required or optional.

Concrete cases the feature must support (the admin's mental model):

| Example | Kind | Renders as | Selection |
|---|---|---|---|
| "Which cheese?" (Mozzarella / Cheddar / Vegan) | `single` | bullet / radio list | pick exactly one |
| "Extra toppings" (Mushroom, Olives, Pepperoni…) | `multiple` | checkboxes | pick any number |
| "Extra cheese" / "Make it a combo" | `toggle` | on/off switch(es) | each option independent |
| "Spice level" (Mild / Medium / Hot) | `single` | radio list (or switch) | pick one |
| "Special request for the kitchen" | `text` | text box | free text |

Plus a **secondary UX change**: move the item create/edit UI from the current
right-hand **slide-over** (`ItemPanel.tsx`) to a **full / large centered modal**, so
the modifier builder has room. Applies to both **create** and **edit**.

## 2. Current state (what exists today)

- **Prisma** (`services/api/prisma/schema.prisma`) — model exists, **unused**:
  - `ModifierGroup { name, selection: ModifierSelection(single|multiple), required,
    minSelect, maxSelect, sortOrder, menuItemId }`
  - `ModifierOption { name, priceDelta (cents, may be 0/negative), available,
    sortOrder, groupId }`
  - `OrderItemModifier { name (snapshot), priceDelta (snapshot), optionId? (SetNull
    on option delete), orderItemId }`
  - `MenuItem.modifierGroups` relation.
- **Domain** (`packages/domain/src/menu.ts`) — **no** modifier schemas; `menuItemSchema`
  omits modifiers.
- **API** (`services/api/src/menu/`) — **no** modifier endpoints/DTOs; `getMenu`
  loads only `category` (no `modifierGroups`). `createItemSchema`/`updateItemSchema`
  have no modifier fields.
- **api-client** (`packages/api-client/src/index.ts`) — **no** modifier methods.
- **restaurant-admin** (`components/ItemPanel.tsx`) — slide-over with a **hardcoded,
  non-functional** "Modifiers" mockup (dummy `addOns`, dead `allowSpice` toggle);
  local state only, never persisted.
- **customer** (`components/ItemSheet.jsx`) — bottom sheet with qty + "Bring it" /
  "Add to order"; renders **no** modifiers. `MenuContext` doesn't map modifiers.
  Round payload (`SessionContext.bringIt/bringThese` → `addRound`) carries no
  modifiers.

**Conclusion:** greenfield vertical slice. Only the base tables exist, and they need
extending (no `toggle` / `text` kinds, no free-text capture).

## 3. Data model changes

### 3.1 The kind dimension (the master switch)

Replace `ModifierSelection { single, multiple }` with a richer enum that maps 1:1 to
how the group renders and behaves:

```prisma
enum ModifierInputType {
  single    // pick one  -> radio / bullet list (dropdown if many options)
  multiple  // pick many -> checkboxes (bounded by min/maxSelect)
  toggle    // independent on/off switches, one per option
  text      // free text, NO options
}
```

`ModifierGroup` becomes:

```prisma
model ModifierGroup {
  id         String            @id @default(cuid())
  tenantId   String
  menuItemId String
  name       String            // "Cheese", "Toppings", "Spice Level", "Special Request"
  inputType  ModifierInputType @default(single)
  required   Boolean           @default(false)
  minSelect  Int               @default(0)   // used by `multiple`
  maxSelect  Int?                            // null = unlimited (for `multiple`)
  // text-only:
  maxLength  Int?                            // optional cap for `text`
  placeholder String?                        // optional hint for `text`
  sortOrder  Int               @default(0)
  // relations unchanged (tenant, menuItem, options)
}
```

`ModifierOption` is unchanged (used by `single` / `multiple` / `toggle`; ignored by
`text`).

`OrderItemModifier` gains free-text support and makes price/option nullable for text:

```prisma
model OrderItemModifier {
  id          String   @id @default(cuid())
  tenantId    String
  orderItemId String
  groupName   String   // snapshot of the group label, e.g. "Spice Level"
  optionId    String?  // null for text, or if option later deleted
  name        String   // snapshot of the chosen option name (or "" for text)
  priceDelta  Int      @default(0) // snapshot, cents
  textValue   String?  // for `text` groups
  // relations unchanged
}
```

> **Migration note:** Supabase uses `prisma db push` (no migrations dir — see
> `CLAUDE.md` / memory). The modifier tables are empty today, so replacing the enum
> and adding columns is a clean push. `pnpm db:seed` is idempotent and will be
> extended with sample modifiers (§9).

### 3.2 Pricing rule (decided)

Modifiers are **per-unit**. A line's total is:

```
lineTotal = (item.unitPrice + Σ option.priceDelta) × qty
```

`OrderItemModifier.priceDelta` snapshots each chosen option's delta at order time.
`text` modifiers contribute `0`. Subtotal/tax/total (`orderSubtotal`,
`capturePayment`) must be updated to include modifier deltas.

## 4. Domain (`@amber/domain`)

Add schemas in `menu.ts` and infer types:

```ts
export const modifierInputTypeSchema = z.enum(["single","multiple","toggle","text"]);

export const modifierOptionSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  priceDelta: z.number().int(),          // cents; may be negative
  available: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const modifierGroupSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  inputType: modifierInputTypeSchema,
  required: z.boolean().default(false),
  minSelect: z.number().int().default(0),
  maxSelect: z.number().int().nullable().default(null),
  maxLength: z.number().int().positive().nullable().default(null),
  placeholder: z.string().optional(),
  sortOrder: z.number().int().default(0),
  options: z.array(modifierOptionSchema).default([]),
});

// menuItemSchema gains:
//   modifierGroups: z.array(modifierGroupSchema).default([]),
```

Order side (`order.ts`): `orderItemSchema` gains
`modifiers: z.array(orderItemModifierSchema).default([])`, where each carries
`{ optionId?, groupName, name, priceDelta, textValue? }`. `orderSubtotal` updated to
add `Σ modifiers.priceDelta` per line.

## 5. API (`services/api`)

### 5.1 Read

`getMenu` (and the item mappers) must `include: { modifierGroups: { include:
{ options: true }, orderBy: { sortOrder } } }` and map to the domain shape.

### 5.2 Write — authoring (admin)

**Approach: replace-on-save (nested).** Keep one save action from the modal.

- `createItemSchema` / `updateItemSchema` gain an optional `modifierGroups` array
  (groups with nested options, no ids required for new ones).
- On `createItem` / `updateItem`, the service **transactionally replaces** the item's
  groups + options with the submitted set (delete removed, upsert the rest). Existing
  `OrderItemModifier` rows are unaffected (they snapshot name/price; `optionId`
  SetNull-s on option delete).

> Alternative (deferred): granular endpoints (`POST /menu/items/:id/modifier-groups`,
> etc.). Not needed for v1; the modal saves the whole item at once.

### 5.3 Write — ordering (customer)

- `addRoundSchema` item shape gains
  `modifiers?: [{ optionId?: string, groupName: string, name: string,
  priceDelta: number, textValue?: string }]`.
- `OrdersService.addRound` writes `OrderItemModifier` rows alongside each
  `OrderItem`.
- **Server-side validation (trust boundary):** re-resolve each `optionId` against the
  item's groups; recompute `priceDelta` from the DB (don't trust the client's number);
  enforce `required` / `minSelect` / `maxSelect`. Reject mismatches.
- `capturePayment` subtotal calc includes modifier deltas.

## 6. api-client (`@amber/api-client`)

- `menu.get()` response now includes `modifierGroups` (schema-validated).
- `menu.addItem` / `menu.updateItem` input types extended with `modifierGroups`.
- `orders.addRound` input item type extended with `modifiers`.
- No new endpoints required for the replace-on-save approach.

## 7. restaurant-admin UI

### 7.1 Item editor → full modal

Replace the `ItemPanel.tsx` right-hand slide-over with a **centered large modal**
(`max-w-3xl`-ish, scrollable body), used for both create and edit. Two regions:

- **Left/top — item details** (existing fields: photo, name, price, category,
  description, available).
- **Right/bottom — Modifier Groups builder** (new, real, replaces the mockup):
  - "Add modifier group" → pick **kind** (`single` / `multiple` / `toggle` / `text`),
    set **name**, **required**, and for `multiple` the **min/max**; for `text` an
    optional **max length / placeholder**.
  - Per group (non-text): list of **options**, each with **name**, **price delta**
    ($, may be negative), **available** toggle; add/remove/reorder.
  - Reorder groups; delete group (with confirm).
- **Save** dispatches the whole item (incl. `modifierGroups`) through `AdminStore`
  (`ADD_ITEM` / `UPDATE_ITEM` → api-client). `data/types.ts` view model + the
  store mapper gain `modifierGroups`.

### 7.2 Kind → editor affordance

| Kind | Builder shows | Guest preview hint |
|---|---|---|
| single | option rows; "required" defaults on | radio list |
| multiple | option rows + min/max | checkboxes |
| toggle | option rows (each = one switch) | switches |
| text | placeholder + max length (no options) | text box |

## 8. customer UI (ordering)

`ItemSheet.jsx` renders each `modifierGroup` by `inputType`:

- `single` → radio/bullet list (one selected; respects `required`).
- `multiple` → checkboxes (enforce min/max client-side; server re-checks).
- `toggle` → a switch per option.
- `text` → text input (respects `maxLength`, `placeholder`).

Live **price recompute**: header price = `(unitPrice + Σ selected deltas) × qty`.
"Bring it" / "Add to order" validation blocks until `required` groups are satisfied.
Selections travel through `SessionContext` (`bringIt` / `bringThese` cart items) into
`addRound`'s `modifiers`. The bill/status/KDS lines should show chosen modifiers
(e.g. "+ Extra cheese", "Spice: Hot", note text). `MenuContext` mapper carries
`modifierGroups` (cents → dollars for deltas).

## 9. Seed data

Extend `prisma/seed.ts` with example groups so the demo shows it off, e.g.:
- **Wagyu Burger** → `single` "Doneness" (Rare/Medium/Well), `toggle` "Add-ons"
  (Extra cheese +$2, Bacon +$3), `text` "Notes".
- **Margherita** (bella-pizza) → `multiple` "Extra toppings" (min 0, max 5),
  `single` "Crust" (Thin/Thick).
- **Butter Chicken** → `single` "Spice Level" (Mild/Medium/Hot).

## 10. Edge cases & decisions

- **Editing options used by past orders:** safe — `OrderItemModifier` snapshots
  name + priceDelta; `optionId` SetNull-s on delete. Historical bills stay correct.
- **Unavailable option / item:** unavailable options are hidden/disabled in the guest
  sheet; server rejects ordering them.
- **Required text:** if `required` + `text`, guest must type something (non-empty).
- **Price integrity:** server recomputes all deltas from the DB; client numbers are
  display-only (matches the existing "server recomputes totals" rule).
- **KDS:** chosen modifiers should appear on the ticket (relay payload + `notes`-style
  line). KDS is still relay-based (see `CLAUDE.md` §KDS) — include modifiers in the
  round it publishes.

## 11. Build order (vertical slice, per `CLAUDE.md` convention)

1. **Schema** — extend enum + fields; `prisma db push` + regen client.
2. **Domain** — modifier schemas; extend `menuItemSchema` + order item schema +
   `orderSubtotal`.
3. **API** — `getMenu` include + mapper; item create/update accept + replace groups;
   `addRound` accept + validate + persist modifiers; payment subtotal.
4. **api-client** — extend menu/orders types (no new endpoints).
5. **restaurant-admin** — full modal + modifier builder + store/view-model wiring.
6. **customer** — render groups in `ItemSheet`, price recompute, carry through order.
7. **Seed** — sample modifiers; verify end-to-end (admin authors → guest orders →
   bill/KDS reflect deltas).

Each step is independently testable; DB must be reachable (`prisma db push` +
`pnpm db:seed`).

## 12. Decisions (confirmed)

1. **Kind model:** ✅ Single `inputType { single | multiple | toggle | text }` enum
   — kind drives both behavior and rendering.
2. **Save model:** ✅ Replace-on-save — the item modal sends the whole item incl.
   modifier groups in one request; server replaces the set transactionally.
3. **Modal layout:** ✅ Centered large modal (~`max-w-3xl`, two-region, scrollable),
   replacing the right-side slide-over, for both create and edit.
4. **v1 scope:** ✅ Everything end-to-end — authoring + guest display + full order
   flow (deltas in cart, bill, KDS) in one slice (build order per §11).
