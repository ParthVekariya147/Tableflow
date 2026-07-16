# Amber & Grain — Project Reference

> Quick-orientation map so changes can be made without re-scanning the whole tree.
> Keep this updated when structure, packages, contracts, or theming change.

## What this is
A **multi-tenant restaurant ordering platform**. Core principle (see `dump/theadpp.svg`):
**one codebase serves many restaurant tenants.** Each restaurant is a row in a
`tenants` table; the same app code loads one tenant's config at runtime and
renders that brand's experience. **No code is forked per restaurant.** Theming =
tenant config → CSS variables → shared components.

## Monorepo layout (pnpm workspaces + Turborepo)
```
amber-grain/
├── apps/
│   ├── customer/          # guest ordering PWA (Vite + React 19) — the original app
│   ├── restaurant-admin/  # KDS + menu/table mgmt (shell; spec in DESIGN.md)
│   └── super-admin/       # tenant onboarding / billing / analytics (shell)
├── packages/
│   ├── config/            # shared tsconfig bases, eslint presets, Tailwind preset
│   ├── domain/            # @amber/domain — Zod schemas + types (the contract)
│   ├── ui/                # @amber/ui — TenantThemeProvider + tokens + components
│   └── api-client/        # @amber/api-client — one typed client (no hand-written fetch)
├── services/
│   ├── api/               # @amber/api — NestJS + Prisma (Postgres), source of truth
│   └── print-agent/       # @amber/print-agent — local print bridge (KOT/receipt printing)
├── pnpm-workspace.yaml · turbo.json · package.json (workspace root) · tsconfig.json
```
Package names are scoped `@amber/*`. Internal deps use `workspace:*`.

## Stack decisions
- **TypeScript everywhere.** Customer app is TS-first with `allowJs` so its
  existing `.jsx` screens still compile during incremental migration.
- **pnpm 9 + Turborepo 2** (`turbo run build|dev|lint|typecheck`).
- **Backend: NestJS 10 + Prisma 6 + PostgreSQL.**
- **Validation/types: Zod** in `@amber/domain` (schemas double as types via `z.infer`).

## Commands (run from root)
- `pnpm install` — install workspace
- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — fan out via Turbo
- Tests: **Vitest** unit tests live in `packages/domain/test/` (money math, loyalty
  math, schema guards). CI (`.github/workflows/ci.yml`) runs
  install → `db:generate` → lint → typecheck → test → build on push/PR to main/develop.
- `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` — Prisma (in `@amber/api`)
- Per app: `pnpm --filter @amber/customer dev` (customer 5173, restaurant-admin 5174, super-admin 5175)
- API needs `services/api/.env` (copy `.env.example`) + a Postgres DB.

## The multi-tenant theming engine (the crux)
1. `@amber/config/tailwind/preset` maps every semantic color token to a CSS var:
   `bg-primary` → `rgb(var(--ag-primary) / <alpha-value>)`. Token list in
   `packages/config/tailwind/tokens.cjs`. **Never bake hex into components** — use tokens.
2. `@amber/ui/tokens.css` ships the **baseline** `--ag-*` values (the amber defaults)
   as space-separated RGB channels (so opacity modifiers work).
3. `<TenantThemeProvider tenant={...}>` (`packages/ui/src/theme/`) converts the
   tenant's hex `theme.colors` → channels via `hexToRgbChannels` and sets the
   `--ag-*` vars on the root at runtime, plus font vars + font `<link>`s.
4. Result: identical components render every brand. A tenant is just data.

## The contract — `@amber/domain` (`packages/domain/src/`)
All shapes are Zod schemas with inferred types. Key entities:
- `Tenant` (`tenant.ts`) — `{ id, slug, name, currency, taxRate, theme, active }`.
  `ThemeConfig` = `{ colors (partial token overrides, hex), typography, logoUrl, mode }`.
- `MenuItem` / `MenuCategory` / `Menu` (`menu.ts`) — price is **minor units (cents)**.
  `MenuItem.modifierGroups` carries custom modifiers: `ModifierGroup` has an
  `inputType` (`single` radio · `multiple` checkbox · `toggle` switches · `text`
  free-text) + `required`/`min`/`maxSelect`/`maxLength`; `ModifierOption` has a
  `priceDelta` (cents, may be negative). See **`MODIFIERS.md`** for the full feature.
- `Table` (`table.ts`) — `{ id, tenantId, label, qrToken, seats? }`.
- `Order` / `Round` / `OrderItem` (`order.ts`) — Order = a table session holding
  Rounds. Round `type`: `instant` ("bring it") | `bundled` ("bring these").
  Item `status`: `placed → preparing → ready → served` (+`cancelled`) — `ready` =
  plated, not yet delivered. `OrderItem.menuItemId` is **nullable** (set null if the
  source menu item is later deleted; name/price are snapshotted). `Order` carries
  `billRequestedAt?` (drives staff "Awaiting Bill") and optional guest contact
  `customerName?` / `customerPhone?` (captured for the bill/receipt). Helpers: `ITEM_STATUS_FLOW`,
  `orderSubtotal`, `formatMoney`.
- `common.ts` — id/money/timestamp/slug primitives.
- `service-request.ts` — `ServiceRequest` (`{ id, tenantId, tableId, tableLabel,
  orderId?, type, status, createdAt, acknowledgedAt?, resolvedAt? }`) — a guest's
  request for staff attention (`water` | `call_staff` | `call_manager`),
  deliberately **not** an Order/Round/OrderItem — it never touches the kitchen.
  `status`: `pending → acknowledged → resolved`. `SERVICE_REQUEST_META` is the
  single source of truth for each type's label/icon, shared by the customer
  Quick Actions UI and the admin notification bell — an icon is always looked
  up from the request's `type`, never a menu-item fallback. See flow 8.
- `payment.ts` — `Payment` (full capture) + `Sale` (denormalized sales-feed row).
- `analytics.ts` — `AnalyticsSummary` (revenue/orders/avgTicket + deltas, revenue
  series, top items, category split, peak hours) for the dashboard/analytics page.
- See **`FEATURES.md`** (repo root) for the full per-app feature → data-requirement
  inventory that drives the schema.

## API — `services/api` (NestJS + Prisma)
- `prisma/schema.prisma` — root `Tenant` (theme as JSON) + identity (`User`,
  `Membership`, `Role`; platform staff are `User.isSuperAdmin`). **RBAC:** `Role`
  is now a **per-tenant table** (`{ name, permissions String[], protected }`), NOT
  a fixed enum — Admins create/rename/edit custom roles. `Membership` carries
  `roleId` + an optional per-user `permissions String[]` override (non-empty =
  the member's COMPLETE effective set; else inherit the role — see
  `effectivePermissions`). The permission keys are the fixed catalog in
  `@amber/domain`'s `PERMISSIONS`. See **`SETTINGS.md`** §B. Then floor (`Room`,
  `Table` w/ `sortOrder`), menu
  (`MenuCategory`, `MenuItem`, optional `ModifierGroup`/`ModifierOption`),
  curated `MenuPlacement` (`PlacementKind` featured|welcome — fast lookup for the
  customer Welcome carousels + Menu hero), session (`Order`, `Round`, `OrderItem`
  w/ per-stage timestamps `preparingAt/readyAt/servedAt/cancelledAt`,
  `OrderItemModifier`), `Payment` (one per order, `method`, snapshot
  subtotal/tax/tip/total, `tendered`), and `Review` (guest stars + comment).
  Every non-tenant row carries `tenantId` (RLS-ready). `Order.billRequestedAt`
  powers the bill-request flow; `Order.customerName/customerPhone` (both optional)
  hold guest contact for the bill/receipt. ⚠️ Online-pay provider fields,
  kitchen-station routing and audit log are still **deliberately deferred**
  (see `FEATURES.md` §5). **Auth is implemented** (email+password login → JWT →
  role/permission resolution; see the `auth/` module below), and newer slices
  landed since: **SaaS billing** (`billing/` — platform plans + per-tenant
  subscriptions, `/admin/billing` super-admin routes + `GET /billing/me`),
  **loyalty** (`loyalty/` — staff-only points accounts keyed by tenant+phone,
  earn-on-capture + redeem; math helpers in `@amber/domain`'s `loyalty.ts`),
  Quick Sale (walk-in counter sale), and KOT/receipt printing via the
  `services/print-agent` bridge.
- **Tenant scoping:** `TenantMiddleware` reads `X-Tenant-Slug`, resolves the tenant,
  attaches it to the request; `@CurrentTenant()` injects it into handlers; services
  scope every query by `tenant.id`. `/admin/*` is excluded (cross-tenant, super-admin).
- Modules: `tenant/` (resolve + `GET /tenant`, `/tenants/:slug`; `PATCH /tenant`
  updates the active tenant's own settings — Branding `theme` / Restaurant Profile
  name·currency·taxRate — `settings.manage`-gated, scoped to the caller's tenant),
  `auth/` (**email-first login, NOT tenant-scoped** — `auth/*` is excluded from
  `TenantMiddleware`): `POST /auth/login` bcrypt-verifies by email globally, then
  resolves the user's active tenants → `{ kind:"authenticated", token, user }` if
  exactly one, or `{ kind:"select_tenant", ticket, tenants[] }` if several (no
  token yet). `POST /auth/select-tenant {ticket, tenantId}` redeems the short-lived
  (5 min, `scope:"tenant-select"`, no `tid`) ticket for the chosen tenant → `{token,
  user}`. `GET /auth/me` → current `AuthUser` (reads tenant from the token's `tid`,
  so it needs no header). `AuthUser` now carries `tenantSlug` so the client can
  scope later calls. Exports `JwtAuthGuard`, `@CurrentUser()`, `@RequirePermission()`
  + `PermissionsGuard`; the guard re-resolves role+permissions on every request so
  changes apply at once; `JWT_SECRET` in `.env`, 12h access tokens),
  `roles/` (`GET/POST/PATCH/DELETE /roles` — custom-role CRUD, `team.manage`-only;
  protected roles can't be deleted/can't drop `team.manage`; a role with members
  can't be deleted; **Admin-tier guard:** editing a `protected` role 403s unless the
  actor is themselves on a protected role), `members/` (`GET/POST/PATCH/DELETE /members`
  — add user (creates the User w/ temp password `changeme123` if new), change role, set
  per-user permission override, activate/deactivate; `team.manage`-only;
  **last-admin lockout guard** refuses removing/downgrading the only `team.manage`
  holder; **Admin-tier guard** (`assertCanManageProtected`): a non-protected actor
  (e.g. a Manager with `team.manage`) can't add/edit/remove a member on a `protected`
  (Admin) role, nor promote anyone *into* one — only an Admin manages Admins. The
  actor's tier rides on `AuthUser.roleProtected`),
  `menu/` (`GET /menu`, `POST /menu/categories`, `PATCH /menu/categories/:id`
  rename/reorder, `DELETE /menu/categories/:id` (blocked while it holds items),
  `POST /menu/items`, `PATCH /menu/items/:id`, `DELETE /menu/items/:id`,
  `POST /menu/upload` multipart item-photo upload → `{ url }`; item create/PATCH
  accept a full `modifierGroups` array — **replace-on-save** (the modal sends the
  whole set; the service transactionally replaces the item's groups+options)),
  `tables/` (`GET /tables` floor list + status + live session, `GET /tables/qr/:token`,
  `POST /tables`, `PATCH /tables/:id`, `POST /tables/:id/qr` regen, `DELETE /tables/:id`),
  `orders/` (`GET /orders?status=` live list, `GET /orders/sales` (optional
  `?from=&to=` ISO window for Order History; else recent feed),
  `GET /orders/analytics?from=&to=` **aggregated analytics** (revenue/orders/avg
  ticket + period-over-period deltas, revenue trend series, top items, category
  split, peak hours — computed from `Payment`+`OrderItem`; defaults to last 24h),
  `GET /orders/stream` **SSE live event bus** (see below), `GET /orders/:id`,
  `POST /orders`, `/:id/rounds`, `/:id/items` add, `PATCH /:id/items/:itemId` qty/status,
  `/:id/bill`, `/:id/cancel`, `/:id/payment` capture),
  `service-requests/` (`POST /service-requests` public guest create — dedupes:
  returns the existing row instead of a duplicate if that table already has a
  `pending` request of the same type; `GET /service-requests?status=` and
  `PATCH /service-requests/:id` staff-only, `@RequirePermission("tables.manage")`;
  `GET /service-requests/stream` SSE, same `?tenant=` fallback as the orders
  stream — see flow 8),
  `admin/` (`GET|POST /admin/tenants`). `prisma/` is a global module.
  Item-status PATCH stamps the per-stage timestamps; **it 409s if the order is
  `closed`/`paid`** (terminal) so a stale KDS board can't resurrect a dead order —
  e.g. mark "preparing" after staff cancelled it, which would wrongly reach the
  guest. payment recomputes
  subtotal/tax (from `tenant.taxRate`)/total server-side (cancelled lines excluded)
  and closes the order. `capturePayment` refuses a non-payable order — 400 if
  already `paid`, **409 if `closed`** (a cancelled session can't be resurrected
  into a paid sale by a stale guest client).
  **Modifiers on rounds:** `POST /:id/rounds` items accept a `modifiers` array;
  the service re-resolves each `optionId` against the menu item, **recomputes the
  `priceDelta` from the DB** (client numbers ignored), validates availability +
  required/min/max + text-group existence (400 on violation), and snapshots
  group/name/delta onto `OrderItemModifier`. Subtotals (`orderSubtotal`, payment)
  add modifier deltas per unit (`orderItemUnitPrice` in `@amber/domain`).
  **`POST /orders` enforces single-occupancy**: it 409s if the table already has
  an `open`/`billed` order, so a second guest or a stale client can't spawn a
  duplicate live session on one table (the trust-boundary occupancy guard).
  **Device-bound sessions:** the guest client sends an opaque per-device id as
  `X-Device-Id`; `createForTable` stores it on `Order.deviceId` and guest
  reads/writes (`get`/`addRound`/`bill`/`payment`) 403 if a *different* device id
  is presented (`assertDevice`). `deviceId` is **never serialized** back to
  clients (so it can't be read from the public order list and replayed). Staff
  (restaurant-admin) send no `X-Device-Id`, so their calls are unaffected — full
  auth is still deferred, this just binds a guest session to its origin device.
  **Real-time order sync (SSE event bus):** `OrdersEvents` (`orders.events.ts`)
  is an in-process per-tenant pub/sub (rxjs `Subject`). Every order mutation
  (`createForTable`/`addRound`/`addItem`/`updateItem`/`requestBill`/`cancel`/
  `capturePayment`) re-loads the fresh `Order` and `emit`s `{ type, orderId, order }`
  (`created`|`updated`|`closed`) — most funnel through the `refreshAndEmit` helper.
  `@Sse("stream")` `GET /orders/stream` returns the tenant's stream, prefixed with
  a one-shot `{ type:"snapshot", orders }` of the live floor so a (re)connecting
  client re-syncs. **EventSource can't set headers**, so the tenant rides as
  `?tenant=slug` — `TenantMiddleware` now accepts that query param as a fallback
  to `X-Tenant-Slug`. The stream is **authenticated via query params**
  (`OrderStreamGuard`): `?token=` (staff JWT → full tenant floor) or `?deviceId=`
  (guest → only that device's own live sessions, so the stream can't be used to
  read the whole floor or other guests' contact details). This drives admin +
  customer realtime and is the path that will eventually retire the KDS relay.
- DTO validation via Zod (`*.dto.ts`). Mappers convert Prisma rows ↔ domain types.
- **Item images** live in **Supabase Storage** (bucket `menu-images`, public read),
  not the DB. `storage/StorageService` uploads with the **service-role key**
  (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `services/api/.env`; key is
  server-only) under `<tenantId>/<uuid>.<ext>` and auto-creates the bucket on boot.
  `POST /menu/upload` (5 MB limit, image mimetypes only) returns the public `{ url }`,
  which the admin stores in `MenuItem.imageUrl`. If the env vars are unset the upload
  endpoint 503s (rest of the API still runs). `imageUrl` may still hold a plain URL or
  legacy data-URL for back-compat.
- `prisma/seed.ts` is **idempotent** (wipes children→parents, then recreates) and
  seeds 3 tenants (amber-grain, green-bowl, bella-pizza) with distinct themes.
  Amber & Grain is a **full demo**: categories + 16 items (icon/swatch stand-ins),
  rooms + tables, menu placements, staff users/memberships, 2 active sessions (one
  bill-requested), 4 paid orders + payments, 2 reviews — so the customer app, KDS,
  dashboard and analytics all have live data. Green Bowl / Bella Pizza get a lean
  menu + tables to prove multi-tenancy, **plus their own roles + Admin login**
  (`admin@greenbowl.com`, `admin@bellapizza.com`). A **cross-tenant owner**
  (`owner@ambergroup.com`) holds Admin memberships at both Amber & Grain and Green
  Bowl, so its login triggers the tenant picker.
- ⚠️ `@prisma/client` types require `pnpm db:generate` (offline, schema-only) before
  the API typechecks/builds.
  **Auth/RBAC status: staff routes are now guarded.** `menu/`, `tables/`, `orders/`,
  `roles/`, `members/`, `tenant/`, `billing/`, `loyalty/`, `admin/` and the staff
  side of `service-requests/` all carry `@RequirePermission(...)` / JWT guards
  (see each controller). Customer (guest) routes stay unauthenticated by design
  (device-id bound). A **global per-IP rate limit** (`@nestjs/throttler`,
  120 req/60s, `APP_GUARD`) covers everything; the SSE stream endpoints opt out
  via `@SkipThrottle()` (single long-lived connection, not a burst).
- The DB runs on **Supabase** (cloud Postgres). The Prisma datasource uses TWO
  URLs (`services/api/.env`): `DATABASE_URL` = the **pooler** (pgBouncer, IPv4,
  session mode `aws-1-…pooler.supabase.com:5432`) for runtime — keeps connections
  warm (~150 ms warm queries vs ~340 ms direct, and no IPv6-only flakiness);
  `DIRECT_URL` = the direct endpoint (`db.…supabase.co:5432`) used only by
  `npx prisma db push` / migrations (no `migrations/` dir). ⚠️ The pooler is
  **session mode, capped at 15 clients** — Prisma's *default* pool
  (`cpus×2+1`, ~17) exceeds that on its own → `FATAL: max clients reached
  (EMAXCONNSESSION)`. So `DATABASE_URL` MUST carry **`?connection_limit=5&pool_timeout=20`**
  (cap Prisma well under 15; leaves room for `nest --watch` restart overlap). Don't
  spawn extra long-lived API instances against the pooler. ⚠️ If the DB password
  contains a literal `@`, it MUST be percent-encoded (`@`→`%40`) in both URLs or
  the connection string mis-parses. ⚠️ The schema must be pushed before first use /
  after schema changes: `pnpm --filter @amber/api exec prisma db push` then
  `pnpm db:seed` (the `prisma-erd-generator: not found` line is harmless). After
  changing `.env`, **restart the API** (nest watch doesn't reload env).
- ⚠️ **Still missing** (see `FEATURES.md`): category reorder (edit/delete done),
  menu placements, and review submit. (Analytics aggregates are now a real
  server-side endpoint — `GET /orders/analytics` — wired into the Dashboard +
  Analytics page.) **Build order is vertical per slice:** domain
  schema/DTO → Nest controller+service → api-client method → rewire the frontend page.
  Verifying a slice needs the DB reachable (`prisma db push` + `pnpm db:seed`).

## The typed client — `@amber/api-client` (`packages/api-client/src/`)
`createApiClient({ baseUrl, tenantSlug?, getTenantSlug?, getToken?, getDeviceId?, fetch? })`
→ resource methods (`tenant`, `menu`, `tables`, `orders`, `serviceRequests`, `admin`). Central
`request()` (`http.ts`) attaches `X-Tenant-Slug` + bearer token and **validates
responses against domain schemas**. The tenant slug resolves as
`opts.tenantSlug ?? config.tenantSlug ?? config.getTenantSlug?.()` — the
**`getTenantSlug` hook** (read at call time, like `getToken`) lets a long-lived
client follow the *logged-in* tenant without being recreated (the admin panel uses
it; `orders.stream`'s `?tenant=` honors it too). `withTenant(client, slug)` clones
for a different tenant. `ApiError` for non-2xx.
- **Auth/RBAC:** `auth.login(email,password)` → `LoginResult` (a discriminated
  union: `{kind:"authenticated", token, user}` | `{kind:"select_tenant", ticket,
  tenants[]}`); `auth.selectTenant(ticket, tenantId)` → `{token, user}` (step two of
  a multi-tenant login); `auth.me()` → `AuthUser` (uses the `getToken` hook).
  `roles.list/create/update/remove` (custom roles) and `members.list/add/update/
  remove` (team management) — all `team.manage`-gated server-side.
- Resource methods now cover menu CRUD (`menu.addCategory/updateCategory/deleteCategory/
  addItem/updateItem/deleteItem`, plus `menu.uploadImage(file)` → multipart `FormData`
  POST returning `{ url }`; `request()` passes a `FormData` body through untouched),
  the floor (`tables.list/create/update/regenerateQr/remove/byQrToken`), and the full
  session lifecycle (`orders.list/sales/get/createForTable/addRound/addItem/updateItem/
  requestBill/cancel/capturePayment`, plus `orders.analytics({from,to})` →
  `AnalyticsSummary`). `tables.byQrToken` hits `GET /tables/qr/:token`.
  **Realtime:** `orders.stream(handler)` opens an `EventSource` to `/orders/stream`
  (tenant via `?tenant=` since EventSource can't set headers), validates each frame
  (`snapshot`/`created`/`updated`/`closed`) against `orderSchema`, and returns an
  unsubscribe fn — mirrors `createHttpKdsTransport`'s EventSource handling.
- **Service requests:** `serviceRequests.create({tableId,type})`,
  `serviceRequests.list(status?)`, `serviceRequests.updateStatus(id,status)`, and
  `serviceRequests.stream(handler)` (identical EventSource pattern to
  `orders.stream`, its own `/service-requests/stream` connection) — see flow 8.

## Apps
- **customer** (`apps/customer`) — the guest ordering app, **wired to the live API
  with QR-based tenant/table resolution** (see `apps/customer/docs/qr-entry-flow.md`).
  `context/MenuContext.jsx` (`MenuProvider`) loads the menu and maps it to the
  screens' shape (cents→dollars, `category` name, `priceCents`+`id` kept for ordering);
  Welcome carousels are derived from the live menu. **Perf:** the menu is the heaviest
  call, so `BootContext` **prefetches it during boot** (`api.menu.get()` kicked off as
  soon as the slug is known) and hands the in-flight promise to `MenuProvider` via
  `useBoot().menuPromise` (it only falls back to its own `api.menu.get()` if absent) —
  the menu overlaps the boot calls instead of starting after the app mounts. `context/SessionContext.jsx` opens a
  real **Order** on `startSession({ customerName, customerPhone })` for the scanned table
  via `api.orders.createForTable` and **persists each round** via `api.orders.addRound`,
  so guest orders appear in restaurant-admin's floor/sessions. The bill flow is wired
  end-to-end: `requestBill()` → `api.orders.requestBill` (flips the admin table to
  "Awaiting Bill"). `payBill(method)` then splits by method: **"Pay Online" (`card`)**
  captures immediately (`api.orders.capturePayment` → Order closed, table frees, sale
  recorded) and ends the session; **"Pay Cash"** does *not* capture — it shows a "pay at
  the counter" screen and keeps the session alive (`awaitingCash`), polling
  `api.orders.get` until **staff capture the cash in the admin** (BillingPage) and the
  Order flips to `paid`/`closed`, which ends the guest session. (Methods are `cash | card`;
  no separate online provider.) Bill totals use the **tenant's `taxRate`** (not a
  hardcoded 10%) and exclude cancelled lines, so the phone matches the server-captured
  total. The live Order is watched in **real time via `api.orders.stream`** (SSE,
  filtered to this session's `orderId`) so **staff/KDS actions reach the phone
  instantly**: staff **cancel** (Order → `closed`) drives a terminal "Session ended"
  screen (`sessionCancelled`) instead of a still-payable bill; cash capture (→ `paid`)
  ends the session; item add/cancel + KDS status rehydrate the bill/status. The
  former `api.orders.get` polls remain as a **low-frequency self-heal fallback**
  (covers a dropped stream / 404-deleted order; SSE can drop on a backgrounded tab).
  Session-end is **terminal**: it clears `orderIdRef`,
  blocks further ordering (`bringIt`/`bringThese`/`addToOrder` no-op once `sessionEnded`
  **or with no live `orderId`** — so a refreshed/settled client can't fire a phantom KDS
  ticket) and hides the BottomNav. The settled/awaiting-cash terminal screen
  (`screens/SessionEndScreen.jsx`) is rendered **above the router** (`App.jsx` `AppRoutes`
  guard) so the phone's hardware **back button** can't pop history back into the order
  flow — the end screen wins regardless of the URL.
  **Sessions are device-bound, persistent + resumable** (fixes the refresh-loses-session
  → phantom-KDS bug): `src/device.js` mints a stable per-device id in `localStorage`
  (`getDeviceId`, built from `crypto.getRandomValues` since `crypto.randomUUID` needs a
  secure context the LAN http origin lacks), sent as `X-Device-Id` by `createGuestApi`.
  `src/session-store.js` persists the live `{slug,qrToken,tableId,orderId}` and a terminal
  `{ended:true}` marker. On boot, `BootContext` **resumes** the saved order (re-verified
  against the API; ownership proven by the device id) instead of losing it; a settled
  device gets the neutral `SessionClosed` screen (locked out of ordering until it scans a
  fresh QR). `SessionProvider` rehydrates `orderId`/`rounds`/`billRequested` from the
  resumed Order via `useBoot().resumeOrder`.
  Seed items have no photos, so `components/FoodImage.jsx` falls back to an icon stand-in.
  `components/ItemSheet.jsx` renders an item's **modifier groups** (radio / checkbox /
  switch / text by `inputType`), live-recomputes the price as options are picked, blocks
  add until required groups are satisfied, and carries the chosen modifiers through the
  cart → round → `addRound` (effective per-unit price = base + Σ deltas). See `MODIFIERS.md`.
  **Quick Actions** (`screens/WelcomeScreen.jsx`) — Water / Call Staff / Manager —
  are guest **service requests**, not menu items: tapping one calls
  `sendServiceRequest(type)` (`context/SessionContext.jsx`) →
  `api.serviceRequests.create({tableId, type})`. They never call `bringIt` and
  never touch Order/Round/KDS (previously they were faked as zero-price menu
  items routed through `bringIt`, which both mis-modeled them as kitchen orders
  and hardcoded a delivery-truck toast icon for every "bring it" tap). Labels/
  icons come from `@amber/domain`'s `SERVICE_REQUEST_META`. See flow 8.
  ⚠️ The live **KDS board still flows through the relay** (`src/kitchen.js` →
  `createHttpKdsTransport` :4001), separate from the persisted API — so KDS status
  changes don't yet write back to the Order. Unifying KDS on the API is the next step.
  Screens + contexts are still `.jsx` (incremental TS migration pending);
  `src/data/menu.json` is now unused.
  **QR entry flow (implemented):** routing is `BrowserRouter`; the guest scans a table
  QR encoding `/{tenantSlug}/t/{qrToken}`. `context/BootContext.jsx` (`BootProvider`)
  parses the path, builds the api-client from the scanned `slug` (`src/api.js`
  `createGuestApi(slug)`; `DEFAULT_SLUG`/first-free-table is the no-QR dev fallback),
  resolves the tenant via `api.tenant.bySlug` (→ drives the **dynamic**
  `TenantThemeProvider` in `App.jsx`, no longer the static `tenant/defaultTenant.ts`)
  and the table via `api.tables.byQrToken`, plus occupancy via
  `api.orders.list("open")`. **Perf:** these three boot calls (and the menu prefetch)
  run **in parallel** (`Promise.all`), not as a serial waterfall, to cut first-paint
  latency — same for the resume path (`tryResume`: tenant + table + order in parallel).
  Boot renders its own loading / **"Invalid QR"** /
  **"Table in use"** / **"Session closed"** screens (`screens/BootScreens.jsx`); a free
  table renders the app, an occupied table that belongs to *this device* is **resumed**. `screens/SplashScreen.jsx` is the **reserve form**: required name + phone
  (client validation + honeypot) → `startSession` **re-checks occupancy** (race guard)
  → `createForTable(tableId, { customerName, customerPhone })`. Security: `qrToken` is
  the capability; the create-order DTO (`services/api/src/orders/orders.dto.ts`)
  enforces name/phone **format** server-side (the trust boundary) — kept optional so
  staff walk-in open-session still works, with *required* enforced client-side for
  guests. Live sessions are **device-bound** via `X-Device-Id` (`Order.deviceId`) so a
  guest can't read/resume/write another device's session. (A global per-IP
  rate limit — `@nestjs/throttler`, 120 req/60s — now covers order creation.)
  ⚠️ Still deferred: SPA host fallback for deep QR links in production.
- **restaurant-admin** (`apps/restaurant-admin`) — **wired to the live API; now
  multi-tenant.** The panel is **no longer pinned to one tenant** — both api-clients
  (`lib/api.ts` + `store/AdminStore.tsx`) scope via **`getTenantSlug`** reading the
  logged-in tenant from `lib/auth-tenant.ts` (`localStorage`, set on login from
  `AuthUser.tenantSlug`); `defaultTenant.slug` is only a pre-login dev fallback.
  **Auth + RBAC (Microsoft-style), email-first login:** `context/AuthContext.tsx`
  (`useAuth`) owns the session — `login`/`selectTenant`/`logout`, restores from a
  persisted bearer token (`lib/auth-token.ts`, read by `lib/api.ts`'s `getToken`),
  exposes `can(permission)`. `LoginPage` signs in by **email+password only**; if the
  account belongs to several restaurants it renders a **tenant picker**
  (`login` → `{kind:"select_tenant", ticket, tenants}` → `selectTenant(ticket, id)`).
  `AdminStore` loads/streams **only once `status==="authed"`** and re-fetches when the
  active tenant changes (logout clears the floor). ⚠️ No tenant *switcher* yet
  (one tenant per session — log out to switch).
  **Dynamic theming (the SaaS is "Amber"; tenants are named at onboarding):**
  `context/TenantThemeGate.tsx` sits inside `AuthProvider` and, once authed,
  fetches `api.tenant.current()` and feeds it to `@amber/ui`'s `TenantThemeProvider`
  so the logged-in **tenant's** brand (colors/fonts/logo) themes the whole panel;
  pre-login it falls back to the **Amber platform** default (`tenant/defaultTenant.ts`,
  `name:"Amber"`). `Shell` reads the active tenant via `useTenant()` — sidebar shows
  the tenant's name + logo/initial with a "Powered by Amber" subtitle; `LoginPage`
  is Amber-branded. (Tenant fonts load via each theme's `typography.fontLinks` in
  the seed.) `components/RequirePermission.tsx` guards every route
  (anon → `/login`; lacking the route's permission → redirected to the user's home
  via `homeRouteFor`, `lib/nav.ts`). `Shell` **filters the sidebar by `can()`**
  (hide, don't grey out — a Kitchen user sees only Kitchen Display) and shows the
  signed-in user. **Settings** (`/settings`, `settings.manage`-gated) is a card
  landing → **`TeamPage`** (`/settings/team`: add users, assign role, per-user
  permission overrides via `components/PermissionChecklist`, activate/remove) and
  **`RolesPage`** (`/settings/roles`: create/rename custom roles + pick permissions,
  delete), and **`BrandingPage`** (`/settings/branding`: edit the tenant's theme —
  brand colors, font pairing, logo upload — with a **live whole-app preview** via
  `useTenantBrand().applyTenant` from `TenantThemeGate`; Save persists via
  `api.tenant.update({theme})`, leaving without saving reverts). Team & Roles &
  Branding are live; Restaurant Profile + Payments are still placeholder cards.
  Both Team/Roles pages mirror the API's **Admin-tier guard** via `useAuth().user.roleProtected`:
  a non-Admin (e.g. a Manager) sees a "lock/Admin" chip instead of edit/remove on
  protected (Admin) members + the Admin role, and can't pick the Admin role when
  adding/assigning. ⚠️ RBAC is enforced **client-side** for nav/routes here; the API enforces
  it on `roles`/`members` already (incl. the Admin-tier guard), and other routes get
  gated next. Seeded demo logins (password `demo1234`): `admin@amberandgrain.com`
  = **Admin** (protected, all perms — the restaurant Owner), `manager@amberandgrain.com`
  = **Manager** (now holds `team.manage`+`settings.manage` so they run the team, but
  the Admin-tier guard blocks them touching the Admin), `kitchen@…` = Kitchen (→ `/kds`
  only). Other tenants now have logins too: `admin@greenbowl.com`, `admin@bellapizza.com`
  (each their tenant's Admin), and **`owner@ambergroup.com`** belongs to *both*
  Amber & Grain and Green Bowl → exercises the **tenant picker**. See **`SETTINGS.md`**.
  `store/AdminStore.tsx` is now API-backed: it loads menu + floor (`tables.list`) +
  sales on mount, maps the domain shapes to the local `data/types.ts` view model
  (kept for low page churn), and exposes an **async `dispatch`** that translates each
  UI action (menu edit, add table, open/run/cancel session, take payment) into the
  matching `@amber/api-client` call, then refetches. **Realtime sync** keeps the
  floor live so *external* changes (guest QR reservations, payments, KDS status from
  other devices) appear without a manual reload: it subscribes to `api.orders.stream`
  (SSE) and, on any pushed event, does a coalesced **light floor refetch**
  (`refreshFloor` — tables + sales only, leaving menu untouched), skipped while a
  local mutation is in flight (`mutatingRef`) so a pushed event can't clobber
  optimistic state. A visible-tab poll (now ~20s) + refetch on window focus/visibility
  remain as a **self-heal fallback** behind the stream; `refresh()` is exposed so
  `TableSessionPage`/`BillingPage` force a sync on open (avoids rendering a table's
  previous session snapshot), and `OPEN_SESSION` is awaited before navigating.
  ⚠️ KDS is still on its relay (Q1=a); folding it onto the order stream + retiring
  the relay is the remaining Phase-2 step. Pages
  (`MenuPage`, `TablesPage`,
  `TableSessionPage`, `BillingPage`, `DashboardPage`, `AnalyticsPage`) read the same
  `{ state, dispatch }` from `useAdmin()`. `MenuPage`'s item editor (`components/ItemPanel.tsx`)
  is a **centered full modal** (not the old slide-over) with a **modifier-group builder**
  (add groups by `inputType`, options with price deltas, required/min/max) — saved with
  the item (replace-on-save). See **`MODIFIERS.md`**. **`OrderHistoryPage`** (`/history`, sidebar
  "Order History") lists completed/paid sales for a date range (Today default /
  Yesterday / Last 7 days / All) via `api.orders.sales({from,to})`, with revenue/count
  summary and expandable rows that lazy-load each order's items (`api.orders.get`) to
  show what each table ordered. It uses the shared `lib/api.ts` client (not the store's
  action `dispatch`). `TablesPage` supports add / edit / **delete**
  (delete blocked while occupied / with order history) and renders a **real scannable
  QR** per table (`QRCodeCanvas` from `qrcode.react`) encoding
  `<VITE_CUSTOMER_URL>/<slug>/t/<qrToken>` via `lib/tableQr.ts` — with copy-link +
  download-PNG + **regenerate behind a confirm/warn step** (rotating the token via
  `REGEN_QR` invalidates any already-printed QR, so it must be reprinted; the modal
  re-renders the new code on confirm). Adding a table mints a fresh `qrToken`
  server-side.
  **`DashboardPage` + `AnalyticsPage` are now real-data** (no more hardcoded charts):
  both call `api.orders.analytics({from,to})` (`lib/api`). Analytics has a working
  range selector (Today / Yesterday / 7 Days / 30 Days) driving a real revenue-trend
  line, category donut, top-items table, peak-hours bars, and period-over-period KPI
  deltas. Dashboard's "Today's Revenue" is genuinely today-scoped with a real delta and
  refetches when a sale closes (keyed on `state.sales` length); the rest of the
  dashboard (active tables, orders-in-progress, 86'd, awaiting-bill, live feed) is
  derived from the live store as before.
  ⚠️ The `kds/` board still runs on its own
  `KdsTransport` seam (not yet pointed at `orders.list`). The real KDS (`kds/KdsPage`) renders
  both in-shell at **`/kds`** (managers) and chrome-free full-screen at **`/kds/display`**
  (kitchen staff — same live board, no sidebar; the in-shell view links to it). The
  KDS relay (`tools/kds-relay.mjs`) starts **empty** (no seeded sample tickets); tickets
  appear only when the customer app sends a round. The old static `kds.html` mockup
  (hardcoded dummy tickets) has been removed. `tenant/defaultTenant.ts` supplies the
  slug (`amber-grain`) + theme; base URL via `VITE_API_URL` (default `:3001`),
  customer PWA origin via `VITE_CUSTOMER_URL` (default `:5173`, for QR links).
  **Notification bell** (`components/Shell.tsx` `NotificationBell`, `tables.manage`-
  gated): a real, live badge + dropdown for guest **service requests** (water / call
  staff / call manager) — replaces the old decorative bell (a hardcoded static red
  dot wired to nothing). Backed by `notifications/useServiceRequests.tsx`
  (`ServiceRequestsProvider`, mounted in `main.tsx` alongside `AdminStoreProvider`),
  which subscribes to `api.serviceRequests.stream` via the shared `lib/api.ts`
  client. Acknowledge/Resolve call `api.serviceRequests.updateStatus`; the stream
  echo is what actually updates the list (no local optimistic state). A new
  `created` event (never a `snapshot`, so reconnects don't re-chime) plays a
  synthesized two-tone chime (`notifications/sound.ts`'s
  `playServiceRequestChime`, Web Audio API — no audio asset), mutable via a
  speaker icon in the bell dropdown (persisted to `localStorage`). **Also
  surfaced on `/tables`:** `TablesPage.tsx`'s `TableCard` reads the same
  `useServiceRequests()` state filtered to its own `tableId` and renders a
  request badge per open item (tap a pending one to acknowledge inline) plus a
  pulsing card border (reusing the KDS `pulse-ready` animation) while any
  request on that table is still `pending` — so staff scanning the floor grid
  see which tables need attention without opening the bell. See flow 8.
- **super-admin** — TS shell wired to `@amber/ui` + `@amber/api-client`, ready to
  build out (tenant onboarding/analytics).

## Major flows (end-to-end)

> The cross-cutting flows that span app → client → API → DB. Each lists the exact
> files so a change can be traced without re-reading everything. Keep in sync when
> the lifecycle changes.

### 1. Guest dine-in lifecycle (scan → order → pay)
The whole guest journey is one **Order** (a table session) holding **Rounds**.
1. **Scan.** The table QR encodes `<VITE_CUSTOMER_URL>/<slug>/t/<qrToken>`
   (minted in restaurant-admin `lib/tableQr.ts`, rendered with `qrcode.react`).
2. **Boot** (`apps/customer/src/context/BootContext.jsx`): parse the path →
   `{slug, qrToken}`; build a tenant-bound guest client (`src/api.js`
   `createGuestApi`); resolve tenant (`api.tenant.bySlug` → dynamic theme) + table
   (`api.tables.byQrToken`) + occupancy (`api.orders.list("open")`) — all fetched
   **in parallel**, with the menu prefetched alongside (perf). A free
   table renders the app; otherwise an "Invalid QR" / "Table in use" / "Session
   closed" boot screen (`screens/BootScreens.jsx`).
3. **Reserve** (`screens/SplashScreen.jsx`): required name + phone (client
   validation + honeypot) → `SessionContext.startSession()` **re-checks occupancy**
   (race guard) → `api.orders.createForTable(tableId, {customerName, customerPhone})`.
   This opens the Order (`POST /orders`, status `open`) and persists the session
   locally (see flow 3).
4. **Order.** `MenuScreen` → `addToOrder` (local cart) → **"Bring these"**
   (`bringThese`, bundled round) or **"Bring it"** (`bringIt`, instant round). Each
   round is **dual-written**: `publishRound` → KDS relay (live board, flow 4) AND
   `sendRoundToApi` → `api.orders.addRound` (persists to the Order so it shows on the
   admin floor/sessions). Rounds carry `menuItemId`+`unitPrice` (cents) snapshots.
5. **Track.** `StatusScreen` shows per-item kitchen status (`placed → preparing →
   ready → served`), updated live from the KDS relay subscription.
6. **Bill.** `BillScreen` → `requestBill` → `api.orders.requestBill` (Order →
   `billed`, `billRequestedAt` set → admin "Awaiting Bill").
7. **Pay** (`payBill(method)`): **card** → `api.orders.capturePayment` captures
   immediately (Order → `paid`/`closed`, table frees, sale recorded), session ends
   now. **cash** → NOT captured by the guest; enters `awaitingCash` ("pay at the
   counter") until **staff capture the cash** in restaurant-admin `BillingPage`,
   flipping the Order to `paid`/`closed`, which ends the session — observed in real
   time via the order stream (flow 7), with a low-freq `api.orders.get` poll as
   fallback. Server recomputes subtotal/tax (`tenant.taxRate`)/total — the client
   total is display-only.

### 2. Device-bound session security (the trust boundary)
Guests have no login, so a guest session is protected by **two server-side
guards** plus a **per-device capability** (staff act via JWT — see below):
- **Occupancy guard** (`orders.service.ts` `createForTable`): a table may hold only
  ONE live (`open`/`billed`) Order → `POST /orders` 409s otherwise. Stops a second
  guest or a stale client spawning a duplicate session.
- **Device binding**: the guest client mints a stable opaque id
  (`src/device.js` `getDeviceId`, in `localStorage`, built from
  `crypto.getRandomValues` because `crypto.randomUUID` needs a secure context the LAN
  http origin lacks). It rides every guest call as **`X-Device-Id`**
  (`api-client` `getDeviceId` config → `http.ts` header). `createForTable` stores it
  on `Order.deviceId`; guest reads/writes (`get`/`addRound`/`bill`/`payment`) **403**
  if a *different* id is presented (`orders.service.ts` `assertDevice`). `deviceId` is
  **never serialized back** to clients, so it can't be read from the public order list
  and replayed.
- **Format guard**: the create-order DTO (`orders.dto.ts`) enforces name/phone format
  server-side (kept optional so staff walk-ins work; required client-side for guests).
- **Staff bypass is token-based now** (the old "omit the header = staff" gap is
  closed): the routes shared by guests and staff (`GET /orders/:id`,
  `POST /orders/:id/payment`, item PATCH…) do a best-effort JWT check — a valid
  staff token (with the right permission) bypasses the device gate; a missing or
  invalid token falls back to **strict device matching** (the normal guest case).
  Staff-only routes (`GET /orders`, cancel, add-item, sales/analytics) are hard
  `@RequirePermission(...)`-guarded. See `orders.controller.ts`.

### 3. Session persistence, resume & lockout (refresh-safe)
Session state is in-memory; without persistence a refresh lost `orderId` and the app
fired **phantom KDS tickets** with no backing Order. Now:
- **Persist** (`src/session-store.js`): on `startSession`, store
  `{slug, qrToken, tableId, orderId}` in `localStorage`. On settle, replace it with a
  terminal `{ended:true}` marker.
- **Resume** (`BootContext` `tryResume`): on a no-QR boot (refresh / direct hit) or a
  re-scan of an occupied table that matches the saved `tableId`, re-fetch the Order
  (`api.orders.get`, ownership re-verified by `X-Device-Id`). If still `open`/`billed`
  → resume it (pass `resumeOrder` down; `SessionProvider` rehydrates
  `orderId`/`rounds`/`billRequested` from it). If settled/cancelled or 403/404 → set
  the ended marker.
- **Lockout**: a device with the ended marker boots straight to the neutral
  `SessionClosed` screen (`BootScreens.jsx`) — no ordering until it **scans a fresh
  QR** (which clears the marker). In-session settle shows the richer
  `screens/SessionEndScreen.jsx`.
- **Ordering gate**: `bringIt`/`bringThese`/`addToOrder` no-op unless there is a live
  `orderIdRef` (and `!sessionEnded`) — the definitive phantom-ticket fix.
- **Back-button guard**: `App.jsx` `AppRoutes` renders `SessionEndScreen` **above the
  router** when `sessionEnded || awaitingCash`, so the phone's hardware back button
  (which pops history through the ordering screens) can't re-enter the order flow.

### 4. KDS (kitchen display) flow — still relay-based
The live board does **not** yet run on the persisted API. Customer rounds publish via
`apps/customer/src/kitchen.js` (`createHttpKdsTransport`, `VITE_KDS_URL` :4001) to the
relay (`tools/kds-relay.mjs`, in-memory, SSE + JSON POST, starts empty). Both the
in-shell KDS (`/kds`) and chrome-free `/kds/display` in restaurant-admin
(`kds/kdsClient.ts`) subscribe to the same relay. KDS stage advances **do** write
back to the Order (`useKds.advance` → `api.orders.updateItem`), so served/preparing
survives a guest refresh. **Cancel/close cleanup:** because the relay is separate from the API, a
cancelled item or a settled/cancelled order's tickets would otherwise linger on
the board (kitchen keeps cooking, and any advance is rejected server-side with a
409). Two relay signals: `POST /kds/cancel-order {orderId}` drops every ticket for
an order; `POST /kds/remove-ticket {ticketId}` drops ONE ticket (ticket id =
`roundId::orderItemId`) for a **single cancelled item** while the order keeps
going. `AdminStore` fires these directly on the action — `CANCEL_ORDER` →
`cancelOrder`, `CANCEL_ITEM` → `removeTicket(roundId::itemId)` — and also
`cancelOrder` on any `closed` stream event (covers payment / cross-source).
**Self-correcting board (the robust guard):** `useKds` also subscribes to the API
order stream and tracks, per live order, its **active item ids** (order live + item
not `cancelled`); it renders ONLY tickets whose item is still active — so a stale
relay ticket (cancelled item, dead order, or one left over from before a relay
restart) is hidden regardless of relay state, and pulled off the relay via
`removeTicket` so the guest phone / `/kds/display` converge too. `advance` refuses a
non-active ticket and, if the status write-through 409s, drops it from board +
relay. The DB is the source of truth. Unifying KDS onto the order stream / an API
Orders gateway (retiring the relay) is the next step.

### 5. LAN / mobile access (testing on a phone)
Dev servers + API must be reachable from a phone on the same Wi-Fi, and the apps must
address the **dev machine's LAN IP**, not `localhost` (which on the phone means the
phone itself).
- Vite dev servers bind `0.0.0.0` via `server: { host: true }` in each app's
  `vite.config.*`. The API binds `0.0.0.0` (`services/api/src/main.ts`
  `app.listen(port, "0.0.0.0")`); CORS is open (`enableCors()`). The KDS relay already
  binds all interfaces.
- Point the apps at the LAN IP via **`.env.local`** (git-ignored, machine-specific):
  customer needs `VITE_API_URL` + `VITE_KDS_URL`; admin needs `VITE_API_URL` +
  `VITE_KDS_URL` + `VITE_CUSTOMER_URL` (the last bakes the LAN IP into the table QR
  codes so a scan from the phone resolves). Restart Vite after editing — env is read at
  startup. ⚠️ `crypto.randomUUID`/`subtle` and PWA/camera/geo need a secure context, so
  they don't work over plain `http://<ip>` (use a tunnel for HTTPS if needed).

### 6. Menu item images
`MenuItem.imageUrl` (optional) flows API → customer (`MenuContext` maps it to `img` →
`components/FoodImage.jsx` `<img>`, with the `icon`/`swatch` as fallback). The seed
(`prisma/seed.ts`) ships stand-in photos: curated exact shots from TheMealDB /
TheCocktailDB where a dish matches, else keyword-locked LoremFlickr (`flickr()` helper,
`?lock=` for determinism). Production path: upload real photos per item via the admin
(`POST /menu/upload` → Supabase Storage), which overwrites `imageUrl`.

### 7. Real-time order sync (SSE event bus) — admin + customer
The shared table session (one `Order`) used to drift between clients (each on its
own poll), so e.g. a **cancel from admin didn't reach the phone** live. Now every
order mutation broadcasts and all clients subscribe over SSE.
- **Emit** (`services/api/src/orders/orders.events.ts` `OrdersEvents`): an
  in-process per-tenant rxjs `Subject`. `OrdersService` calls
  `emit(tenant.id, { type, orderId, order })` after each mutation (via the
  `refreshAndEmit` helper; `created`/`updated`/`closed`).
- **Stream** (`orders.controller.ts` `@Sse("stream")` → `GET /orders/stream`):
  returns the tenant's observable, prefixed with a `{type:"snapshot", orders}` of
  the live floor so a (re)connecting client re-syncs. EventSource can't set
  headers → tenant via `?tenant=` (`TenantMiddleware` accepts the query param).
- **Subscribe** (`@amber/api-client` `orders.stream(handler)`): opens an
  `EventSource`, validates each frame against `orderSchema`, returns an unsubscribe.
- **Customer** (`SessionContext.jsx`): filters the stream to its own `orderId` →
  `closed`/`paid` drive the terminal screens (`closed` = "Order cancelled by the
  restaurant"), `updated` rehydrates rounds + bill status. A **single** item staff
  cancel (order stays live) lands as `updated` with that item `status:"cancelled"`;
  the guest keeps seeing the line **struck-through** ("Cancelled by restaurant" on
  `StatusScreen`, "Cancelled" on `BillScreen`) and it's excluded from every total.
  A cancelled item is terminal client-side — a late relay frame can't flip it back.
  **Admin**
  (`AdminStore.tsx`): any event → coalesced light floor refetch (`refreshFloor`),
  skipped while a local mutation is in flight; a `closed` event also pushes
  `kdsClient.cancelOrder` so the dead order's KDS tickets vanish (see flow 4).
- **Fallback**: the previous polls remain at a low cadence (customer 12–15s, admin
  ~20s + focus/visibility) to self-heal a dropped stream (mobile backgrounding).
- ⚠️ KDS still rides its own relay (flow 4); folding it onto this stream + retiring
  the relay is the remaining step. (The stream itself is authenticated —
  staff `?token=` / guest `?deviceId=`, see the API section.)

### 8. Guest service requests (water / call staff / call manager)
A guest's request for staff attention is a **`ServiceRequest`**, deliberately kept
separate from Order/Round/OrderItem/KDS (flow 4) — it's a notification, not a
kitchen ticket. Mirrors flow 7's SSE architecture end-to-end:
- **Create.** `WelcomeScreen.jsx`'s Quick Actions (Water / Call Staff / Manager) →
  `SessionContext.jsx` `sendServiceRequest(type)` → `api.serviceRequests.create({
  tableId, type })` → `POST /service-requests` (public, no device binding — not
  sensitive per-device state). `ServiceRequestsService.create` **dedupes**: a
  table can only have one `pending` request of a given type at a time, so a
  guest mashing the button re-returns the same row instead of piling up
  duplicates (the client's 4s "sent" cooldown in `WelcomeScreen.jsx` is just a
  UX debounce on top of this — the server dedupe is authoritative). It also
  opportunistically links the table's live `Order`, if any, via `orderId`.
- **Emit.** `service-requests.events.ts`'s `ServiceRequestsEvents` — an
  in-process per-tenant rxjs `Subject`, identical shape to `OrdersEvents` (flow
  7) — `emit`s `created`/`updated` after every create/acknowledge/resolve.
- **Stream.** `service-requests.controller.ts` `@Sse("stream")` →
  `GET /service-requests/stream`: prefixed with a `{type:"snapshot", requests}`
  of currently-open (pending + acknowledged) requests on (re)connect; tenant via
  `?tenant=` (EventSource can't set headers, same `TenantMiddleware` fallback).
- **Subscribe (admin).** `notifications/useServiceRequests.tsx`
  (`ServiceRequestsProvider`, mounted in `main.tsx`) opens
  `api.serviceRequests.stream`, gated on being signed in. `components/Shell.tsx`'s
  `NotificationBell` (`tables.manage`-gated) renders the live badge count + a
  dropdown listing each open request with its `SERVICE_REQUEST_META` icon/label
  and Acknowledge/Resolve buttons → `api.serviceRequests.updateStatus(id, status)`.
  A `resolved` update drops the row off the list; the UI never applies a status
  change locally — it waits for the stream to echo it back, same principle as
  the rest of the realtime surface.
- Icons/labels are looked up **only** from `@amber/domain`'s
  `SERVICE_REQUEST_META[type]`, shared by both apps — this is what fixed the bug
  where every "bring it" tap (including Water) showed a hardcoded delivery-truck
  toast icon, a symptom of the old design routing these through the food-order
  `bringIt` path instead of their own channel.

## Conventions & gotchas
- Money is **integer cents** in the domain/API. The legacy customer screens still
  use float dollars from `menu.json` — reconcile when migrating to the API.
- Add new color tokens in BOTH `packages/config/tailwind/tokens.cjs` and the baseline
  `packages/ui/src/tokens.css`; optionally expose them in `themeColorsSchema`.
- `apps/customer/src/components/KDS.jsx` is an empty legacy stub; the real KDS lives in `apps/restaurant-admin`.
- Build order matters: `@amber/domain` emits `dist/`; `ui`/`api-client` are consumed
  as source by Vite. Turbo's `^build` enforces dependency order.
