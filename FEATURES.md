# Amber & Grain — Feature & Data Inventory

> Purpose: a single map of **every feature across the three apps** and the **data each
> feature needs**, derived from the current code. Use this as the input for the database
> design → migration → build-out work.
>
> Status legend per feature:
> - ✅ **Built** — working in the app today (even if on mock/in-memory data)
> - 🟡 **Partial** — UI exists but backed by hardcoded/derived/fake data
> - ⛔ **Planned** — referenced in design/prototype/TODO, no working code yet
>
> Backing-data legend:
> - 🗄️ field already exists in `services/api/prisma/schema.prisma`
> - 🆕 field NOT yet in the schema (gap to design for)

---

## 0. Big picture / current state

Three frontends + one backend + shared packages:

| App | Port | Purpose | Data source today |
|-----|------|---------|-------------------|
| `apps/customer` | 5173 | Guest ordering PWA (the original app) | `src/data/menu.json` + in-memory `SessionContext`; floats for money |
| `apps/restaurant-admin` | 5174 | Manager cockpit + KDS | in-memory `AdminStore` (seed) + KDS relay client; cents |
| `apps/super-admin` | 5175 | Tenant onboarding / billing / analytics | live `@amber/api` `/admin/tenants` (only list works) |
| `services/api` | 3001 | NestJS + Prisma + Postgres, source of truth | Postgres (schema written, partially wired) |

**Key reality:** `services/api/prisma/schema.prisma` is already the most advanced
artifact — it models User/Membership/Room/Modifiers/Payment that the *apps don't use yet*.
The apps run on their own local mock stores. So the DB-design task is largely:
**reconcile the three app data models into the (already good) Prisma schema, fill the gaps,
then wire each app to the API.**

Three structural mismatches to resolve first:
1. **Money type:** customer app uses float dollars (`menu.json`, `price * qty`); admin + domain + API use **integer cents**. → Standardize on cents.
2. **Item status set:** domain (`order.ts`) and admin (`types.ts`) = `placed/preparing/served/cancelled`; **Prisma schema + customer Status screen + KDS = adds `ready`**. → Standardize on `placed/preparing/ready/served/cancelled`.
3. **Two parallel "session" models:** customer `rounds` vs admin `Table.session.rounds` vs API `Order→Round→OrderItem`. → Collapse into the API's `Order` model.

---

## 1. Customer app (`apps/customer`) — guest ordering PWA

Flow: Splash → Welcome → Menu → My Order → Status → Bill. Routing is in-memory
(`MemoryRouter`); table is hardcoded to `7`; one session lives entirely in React state.

### C1. QR / table entry & session start — 🟡
Guest "scans into" a table and a dine-in session begins.
- **Today:** `tableNumber` hardcoded to `7`; `startSession()` just sets a timestamp.
- **Data needed:**
  - Table: `id`, `label`, `qrToken`, `seats`, `roomId` 🗄️
  - Tenant resolved from QR/subdomain: `tenant.slug`, `name`, `currency`, `taxRate`, `theme` 🗄️
  - Order (session): `id`, `tableId`, `tenantId`, `status`, `createdAt` 🗄️
  - 🆕 mapping of **qrToken → tenant + table** so a scan opens the right session
  - 🆕 (optional) guest/device identity to rejoin a session, party size, guest name

### C2. Tenant theming at runtime — ✅ (infra) / 🟡 (per-tenant)
Brand colors/fonts/logo applied via `TenantThemeProvider`.
- **Today:** uses `src/tenant/defaultTenant.ts` fallback, not API.
- **Data needed:** `tenant.theme` = `{ colors (hex token overrides), typography {sans, serif, fontLinks}, logoUrl, mode }` 🗄️ (stored as JSON)

### C3. Welcome / upsell starters — ✅
Horizontal "Something to drink?" / "Quick bites" carousels with **Bring it** + **+ Order**.
- **Today:** reads `menu.json` `starters.drinks` / `starters.bites` (a curated subset).
- **Data needed:**
  - MenuItem: `id`, `name`, `price`, `imageUrl` 🗄️
  - 🆕 a way to flag **which items are "welcome/upsell starters"** and their grouping/section label (currently a hand-built JSON shape, no DB equivalent)

### C4. Menu browse — ✅
Category tabs (incl. "All"), featured card, item list, badges, tap-to-open detail sheet.
- **Data needed:**
  - MenuCategory: `id`, `name`, `sortOrder` 🗄️
  - MenuItem: `id`, `categoryId`, `name`, `description`, `price`, `badge`, `imageUrl`, `icon`, `swatch`, `available`, `sortOrder` 🗄️
  - 🆕 "featured" concept is implicit (just `filtered[0]`) — decide if **featured** is a real flag

### C5. Item detail sheet (`ItemSheet.jsx`) — ✅
Item detail with qty + add. (Modifiers not surfaced in customer UI yet.)
- **Data needed:** MenuItem full record 🗄️; **ModifierGroup / ModifierOption** 🗄️ (exist in schema, **unused by customer UI** — decide if v1 needs item options)

### C6. "My Order" cart (holding area) — ✅
Add/remove, change qty, running subtotal + count, "send all at once."
- **Today:** in-memory `myOrder[]`; **not persisted**, not sent until "Bring these."
- **Data needed:**
  - Cart line: `menuItemId`, `name` (snapshot), `unitPrice` (snapshot), `qty`, `notes` 🗄️ (maps to `OrderItem`)
  - 🆕 decide: is the pre-send cart **client-only** or a persisted draft round? (today client-only)
  - 🆕 per-item **note to kitchen** — UI has an "Add a note" button (non-functional); `OrderItem.notes` exists 🗄️

### C7. Two order modes: "Bring it" (instant) vs "Bring these" (bundled) — ✅
- **Today:** creates a `round` `{id, type, timestamp, items[]}`, prepends to `rounds`, publishes to KDS relay.
- **Data needed:**
  - Round: `id`, `orderId`, `type` (`instant`|`bundled`), `createdAt` 🗄️
  - OrderItem: `id`, `roundId`, `menuItemId`, `name`, `unitPrice`, `qty`, `status`, `notes` 🗄️

### C8. Live order status tracking — ✅
Per-item progress pills **placed → preparing → ready → served**; "served so far" total; "Live" indicator; round grouping with timestamps.
- **Today:** subscribes to KDS relay; folds `ticket-updated`/`ticket-removed` events back onto rounds.
- **Data needed:**
  - OrderItem.`status` with the **5-state set incl. `ready`** 🗄️ (note: domain `order.ts` is missing `ready` — schema has it)
  - 🆕 real-time channel (SSE/WS) keyed by `orderId`/round id so guest sees kitchen updates
  - 🆕 per-status **timestamps** if you want "X min ago" / SLA (only `createdAt`/`updatedAt` exist today)

### C9. Bill / request bill / pay — ✅
Receipt grouped by round, subtotal, **GST 10% hardcoded**, total; "Request Bill"; choose **Pay Online / Pay Cash**; confirmation + star rating.
- **Today:** `GST_RATE = 0.1` hardcoded (ignores `tenant.taxRate`); payment is fake; "bill requested" is a local boolean; rating not stored.
- **Data needed:**
  - Tax from `tenant.taxRate` 🗄️ (stop hardcoding)
  - Payment: `id`, `orderId`, `method` (cash|card), `subtotal`, `tax`, `tip`, `total`, `takenById`, `createdAt` 🗄️
  - Order.`status` transitions `open → billed → paid → closed` 🗄️
  - 🆕 **"bill requested" signal** to staff (a flag/event on Order — not in schema; staff Dashboard "Awaiting Bill" needs it)
  - 🆕 **tip/gratuity** entered by guest (schema has `Payment.tip` 🗄️, customer UI doesn't collect it yet)
  - 🆕 **guest rating/feedback** (stars + comment) — **no model exists**
  - 🆕 **online payment** integration (provider ref, status, txn id) — only `method` enum exists

---

## 2. Restaurant-admin (`apps/restaurant-admin`) — manager cockpit + KDS

Shell-wrapped pages (Dashboard, Menu, Tables, Analytics, KDS) + full-screen Login,
Billing, Payment-complete. All on the in-memory `AdminStore` seed.

### R1. Manager login / auth — 🟡
Login form (email + password) → just navigates in; "Forgot password" link.
- **Data needed:**
  - User: `id`, `email`, `passwordHash`, `name`, `isSuperAdmin`, `active` 🗄️
  - Membership: `userId`, `tenantId`, `role` (owner|manager|server|kitchen), `active` 🗄️
  - 🆕 **auth tokens / sessions** (JWT or session table), password reset tokens — none modeled
  - 🆕 the `/admin/*` API + restaurant-admin API both need an **auth guard** (TODO in CLAUDE.md)

### R2. Dashboard / overview — 🟡
Today's revenue, active tables (+capacity %), orders in progress, **86'd-items alert**,
**awaiting-bill alert** (+Resolve link), quick actions, **live activity feed**.
- **Today:** all derived from in-memory state; revenue = sum of `sales`.
- **Data needed:**
  - Orders + items (status) to compute active tables / in-progress 🗄️
  - MenuItem.`available` for 86'd list 🗄️
  - 🆕 **awaiting-bill** state (see C9 — needs a bill-requested flag)
  - Payments for revenue 🗄️
  - 🆕 **activity feed / audit log** — currently synthesized on the fly from sessions+sales; consider an `Event`/`AuditLog` table if you want a durable feed
  - "Main Kitchen" label is hardcoded — 🆕 station/kitchen concept (see R8)

### R3. Menu management — ✅
Category rail (+ add category, per-cat counts), item grid, inline edit name/price,
**availability toggle (86)**, add/edit item via `ItemPanel`, image upload (data URL), delete.
- **Data needed:**
  - MenuCategory CRUD: `name`, `sortOrder` 🗄️
  - MenuItem CRUD: `name`, `description`, `price`, `available`, `icon`, `swatch`, `imageUrl`, `categoryId`, `badge`, `sortOrder` 🗄️
  - 🆕 **image storage** (today a base64 data URL in `imageUrl`) — decide on object storage + URL
  - ModifierGroup/Option CRUD 🗄️ (schema ready; admin UI doesn't edit them yet)
  - 🆕 category delete / reorder, item reorder (drag) not implemented

### R4. Tables / floor overview — ✅
Grid of table cards grouped conceptually by **room**, status chips
(**free / seated / ordering / bill**), filter (all/free/occupied), QR view + **regenerate QR**,
edit table (label, seats), open session, go to checkout.
- **Data needed:**
  - Room: `id`, `name`, `sortOrder` 🗄️
  - Table: `id`, `label`, `roomId`, `seats`, `qrToken` 🗄️
  - 🆕 **table status** is *derived* in admin (`free/seated/ordering/bill`) from session state — in the API it's implied by Order.status + item statuses. Decide whether status is **computed** (recommended) or **stored**. Note `bill` status depends on the missing bill-requested flag.
  - QR regenerate = write new `qrToken` 🗄️

### R5. Table session detail — ✅
Per-round item list, add item (searchable picker, available items only), change qty,
**cancel item**, **cancel whole order**, per-item **note** display, live bill summary
(subtotal/tax/total), "seated for" elapsed time, take payment.
- **Data needed:**
  - Order + Round + OrderItem (+ statuses, notes) 🗄️
  - `Order.createdAt` for "seated for" elapsed 🗄️
  - Tax from `tenant.taxRate` 🗄️
  - 🆕 staff who added items / cancelled (accountability) — `Order.serverId` exists 🗄️ but no per-item actor
  - 🆕 **cancel reason** (void audit) — not modeled

### R6. Billing / checkout (POS) — ✅
Full-screen checkout: receipt by round, subtotal/tax, **suggested 20% gratuity**,
method (cash/card), **on-screen numpad for amount tendered**, **change due**,
check number (`#CHK-xxxx`), mark paid → completes session.
- **Data needed:**
  - Payment: `method`, `subtotal`, `tax`, `tip`, `total`, `takenById`, `createdAt` 🗄️
  - 🆕 **amount tendered + change** (cash) — not persisted; add fields if receipts need them
  - 🆕 **check/receipt number** — derived from table id today; decide on a real sequence per tenant
  - 🆕 **split bill / partial payments** — schema is **single Payment per Order** (`@unique orderId`); revisit if splits are required
  - 🆕 gratuity is computed 20% suggestion only; actual tip not captured into `Payment.tip`

### R7. Payment complete confirmation — ✅
Post-payment success screen (`PaymentCompletePage`), receives method/total/table via route state.
- **Data needed:** the persisted `Payment` + `Order` (so it survives refresh) 🗄️

### R8. KDS (Kitchen Display System) — ✅
Columns **New (placed) / Preparing / Ready**, ticket cards, advance stage,
live/offline indicator, order count, clock, "Main Kitchen • Station 01" label.
- **Today:** `kdsClient` transport (SSE/poll via `@amber/api-client`); tickets = `{id, tableLabel, type, items[], stage}`.
- **Data needed:**
  - Round/OrderItem with `status` incl. `ready` 🗄️
  - Table label, round type 🗄️
  - 🆕 **kitchen station / routing** (which items go to which station/printer) — "Station 01" is hardcoded; no station model
  - 🆕 ticket **timing/SLA** (placed-at, bump times) for "X min" alerts — only `createdAt`/`updatedAt`
  - 🆕 a real **realtime backend** for KDS (today a relay; API has no KDS endpoint/stream)

### R9. Analytics / reports — 🟡 (mostly fake)
Range selector (Today/Yesterday/7 Days/Custom), KPIs (revenue, total orders, avg ticket,
deltas), revenue trend line, **sales-by-category donut**, **top-performing items**, **peak hours**.
- **Today:** KPIs scale a multiplier off `sales`; **top items, categories, peak hours are hardcoded constants**.
- **Data needed (to make it real):**
  - Payments over a **date range** (`Payment.createdAt` indexed 🗄️) → revenue, order count, avg ticket
  - OrderItem aggregates by `menuItemId`/category → top items, sales-by-category (🆕 needs item-level sales history; payments only store totals, so **OrderItems must be retained** post-close)
  - Order/Round timestamps → peak hours (🆕 hour-bucketed aggregation)
  - 🆕 **deltas vs prior period** → need historical data + comparison queries
  - 🆕 custom date range params

---

## 3. Super-admin (`apps/super-admin`) — platform operator

Currently a thin shell: lists tenants from the API. Design/TODO describe more.

### S1. Tenant list — ✅
Lists tenants with name, slug, primary color swatch.
- **Data needed:** Tenant: `id`, `name`, `slug`, `theme.colors.primary`, `active` 🗄️

### S2. Tenant onboarding wizard — ⛔ (API exists, UI doesn't)
Create a tenant: `slug`, `name`, `currency`, `taxRate`, `theme`.
- **Today:** `POST /admin/tenants` works (`admin.service.ts`); no UI.
- **Data needed:** full Tenant record 🗄️; 🆕 create the **owner User + Membership** at onboarding (not done); 🆕 seed default rooms/tables/menu?

### S3. Live theme editor — ⛔
Edit a tenant's `ThemeConfig` (the same config apps consume).
- **Data needed:** `tenant.theme` JSON 🗄️; 🆕 an **update tenant** endpoint (only create + list exist)

### S4. Per-tenant billing (SaaS) — ⛔
Charge restaurants for using the platform; usage analytics.
- **Data needed (none modeled):**
  - 🆕 **Subscription/Plan**: tenant, plan tier, price, status, period, trial
  - 🆕 **Invoice / billing history**: amount, period, paid/unpaid, provider ref
  - 🆕 **Usage metrics**: orders/month, GMV, active tables (for metered billing)
  - 🆕 payment-processor customer/subscription IDs

### S5. Cross-tenant analytics — ⛔
Platform-wide dashboards (GMV across tenants, growth, top restaurants).
- **Data needed:** aggregate over all tenants' Payments/Orders 🗄️ (needs cross-tenant query path; `/admin/*` is already excluded from tenant scoping)
  - 🆕 super-admin **auth + audit** (S-level)

---

## 4. Cross-cutting / platform concerns

| Concern | Status | Data / notes |
|---------|--------|--------------|
| Multi-tenancy scoping | ✅ schema, 🟡 wiring | every row has `tenantId` 🗄️; `X-Tenant-Slug` middleware; RLS-ready. Apps don't all send tenant yet. |
| Auth & roles | ⛔ | `User`/`Membership`/`Role` modeled 🗄️; **no guard, no tokens, no password reset** (🆕). Login is fake in both admin apps. |
| Money | ⚠️ inconsistent | cents in API/admin/domain; **floats in customer** — unify on cents. |
| Item status set | ⚠️ inconsistent | unify on `placed/preparing/ready/served/cancelled` (domain `order.ts` missing `ready`). |
| Realtime | 🟡 | KDS relay + customer subscribe exist client-side; **API has no realtime endpoint** (🆕 SSE/WS per order + per kitchen). |
| Image/asset storage | 🆕 | menu images are base64 data URLs today; need object storage + URL strategy. |
| Snapshots for history | ✅ design | `OrderItem`/`OrderItemModifier`/`Payment` snapshot name+price so menu/tax edits don't rewrite history 🗄️. |
| Audit log / activity feed | 🆕 | Dashboard feed is synthesized; no durable event/audit table. |
| Notifications | 🆕 | "bill requested", "order ready", "staff on the way" are UI-only; no notification model/channel. |
| Bill-requested signal | 🆕 | needed by customer Bill screen + admin Dashboard "Awaiting Bill" + Tables `bill` status; **not in schema**. |
| Guest ratings/feedback | 🆕 | customer confirmation collects stars; **no model**. |
| Tips/gratuity | partial | `Payment.tip` exists 🗄️; neither app captures it into the field yet. |
| Split/partial payments | 🆕 | schema is one Payment per Order; revisit if needed. |
| Kitchen stations/routing | 🆕 | KDS hardcodes one station; no station/printer model. |
| Per-status timestamps / SLA | 🆕 | only `createdAt`/`updatedAt`; add stage timestamps if KDS timers/analytics need them. |

---

## 5. Suggested entity checklist for the DB design

**Already in `schema.prisma` (validate & reuse):**
`Tenant`, `User`, `Membership` (Role), `Room`, `Table`, `MenuCategory`, `MenuItem`,
`ModifierGroup`, `ModifierOption`, `Order` (OrderStatus), `Round` (RoundType),
`OrderItem` (ItemStatus incl. `ready`), `OrderItemModifier`, `Payment` (PaymentMethod).

**Gaps to add / decide (🆕):**
1. **Auth**: session/token store, password-reset tokens (or rely on stateless JWT + revend list).
2. **Bill-requested** signal on `Order` (e.g. `billRequestedAt` timestamp) — unblocks 3 features.
3. **Guest rating/feedback** model (order, stars, comment, createdAt).
4. **Tip capture** wiring (field exists; ensure flows populate it) + **amount tendered/change** if needed on receipts.
5. **Welcome/upsell starters** flag or section model for the customer Welcome screen.
6. **Featured item** flag (menu) if "featured" should be deliberate.
7. **Kitchen station / routing** (+ assign items/categories to stations) and **per-stage timestamps** for KDS timers + analytics.
8. **Activity/audit log** for the dashboard feed and accountability (cancels, voids, actor).
9. **Notifications** channel/log (bill requested, order ready, staff paged).
10. **SaaS billing**: `Subscription`/`Plan`, `Invoice`, usage metrics, processor IDs (super-admin S4).
11. **Online payment** provider refs/status on `Payment` (txn id, provider, captured/refunded).
12. **Image/asset** URL strategy (replace base64 data URLs).
13. **Reorder/sort** is via `sortOrder` ints — confirm coverage (categories, items, rooms, modifiers).
14. Decide **table status**: computed from Order/items (recommended) vs stored column.
15. Reconcile **`@amber/domain` `order.ts`** to add `ready` so domain == schema == UI.

---

*Generated from a review of `apps/customer`, `apps/restaurant-admin`, `apps/super-admin`,
`packages/domain`, and `services/api` (incl. `prisma/schema.prisma`). Update as features land.*
