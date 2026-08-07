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
  math, schema guards) and `apps/restaurant-admin/test/` (checkout settlement +
  Quick Sale idempotency — see the payment-safety note below). CI (`.github/workflows/ci.yml`) runs
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
- `Tenant` (`tenant.ts`) — `{ id, slug, name, currency, taxRate, theme, active }`
  plus bill/statutory fields (`gstNumber?`, `fssaiNumber?`, `address?`, `phone?` —
  printed on receipts), UPI (`upiId?`, `upiMobile?`), and four JSON config blobs:
  `printer` + `kitchenPrinter` (`PrinterSettings`, see printing below),
  `loyalty` (`LoyaltyProgram`), and `quickActions` (`QuickAction[]`, see
  `quick-action.ts` above — the guest Welcome screen's action row).
  `updateTenantRequestSchema` = the `PATCH /tenant`
  body (all fields optional; slug/active are platform-only).
  `ThemeConfig` = `{ colors (partial token overrides, hex), typography, logoUrl, mode }`.
- `MenuItem` / `MenuCategory` / `Menu` (`menu.ts`) — price is **minor units (cents)**.
  `MenuItem.modifierGroups` carries custom modifiers: `ModifierGroup` has an
  `inputType` (`single` radio · `multiple` checkbox · `toggle` switches · `text`
  free-text) + `required`/`min`/`maxSelect`/`maxLength`; `ModifierOption` has a
  `priceDelta` (cents, may be negative). See **`api-reference/MODIFIERS.md`** for
  the full feature.
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
  request for staff attention, deliberately **not** an Order/Round/OrderItem —
  it never touches the kitchen. `status`: `pending → acknowledged → resolved`.
  `type` is a plain string now (was a closed 3-value enum): the 3 built-ins
  (`water` | `call_staff` | `call_manager`, still in `SERVICE_REQUEST_TYPES`/
  `SERVICE_REQUEST_META`, the source of truth for their label/icon/sublabel)
  plus any tenant-authored custom quick-action id — see `quick-action.ts`.
  Whether a given `type` is a currently-configured, enabled button for the
  tenant is validated server-side (`service-requests.service.ts`), not by
  this schema.
- `quick-action.ts` — the guest Welcome screen's per-tenant configurable
  "Quick Actions" row (Water / Call Staff / Manager / Full Menu by default).
  `QuickAction` = `{ id, kind ("service_request"|"full_menu"), builtIn,
  enabled, label, icon, sublabel?, swatch }`; `icon`/`swatch` are each a
  small curated enum (`QUICK_ACTION_ICONS`/`QUICK_ACTION_SWATCHES`) so admin
  pickers stay a fixed grid. `DEFAULT_QUICK_ACTIONS` is today's exact 4-entry
  row (built from `SERVICE_REQUEST_META` + a `full_menu` entry); `mergeQuickActions(saved)`
  (same "auto pick up new features" pattern as `printer.ts`'s
  `mergeReceiptSections`) fills in any tenant's saved config against it —
  critically, a built-in's `label`/`icon`/`sublabel`/`swatch` are **always**
  re-stamped from the default (only `enabled` + order are tenant-editable for
  built-ins); non-built-in entries are tenant-authored custom buttons, capped
  at `MAX_CUSTOM_QUICK_ACTIONS` (4). Used both client-side (rendering) and
  server-side (`service-requests.service.ts`, validating a create's `type`
  against the tenant's live config). See flow 8.
- `payment.ts` — `Payment` (full capture) + `Sale` (denormalized sales-feed row)
  + the **accepted-tender config**. `paymentMethodSchema` (`cash`|`card`|`upi`)
  is the platform's full vocabulary and **values are never removed** — every
  historical `Payment`/`Sale` and each staff member's `lastPaymentMethod` parses
  through it, so deleting one would break reading old sales. A restaurant that
  stops taking cards instead **disables the tender**: `Tenant.paymentMethods`
  (`paymentMethodConfigSchema[]`, Settings → Payments) + `mergePaymentMethods`
  (same "append new features to a saved config" pattern as
  `mergeReceiptSections`/`mergeQuickActions`, and it force-enables cash if a
  config would leave zero tenders) + `enabledPaymentMethods` /
  `isPaymentMethodEnabled` / `PAYMENT_METHOD_LABELS`. Disabling is
  **presentational only** — it hides the tender from new checkouts
  (BillingPage, QuickSalePage, the guest's BillScreen) and NEVER rejects a
  capture server-side, so a stale guest phone mid-payment can still settle.
  Empty/unset = every tender on.
- `analytics.ts` — `AnalyticsSummary` (revenue/orders/avgTicket + deltas, revenue
  series, top items, category split, peak hours) for the dashboard/analytics page.
- `permission.ts` — `PERMISSIONS`, the fixed 9-key permission catalog (incl.
  `loyalty.manage`) + `PERMISSION_LABELS` + `hasPermission`. Roles are data;
  this vocabulary is the only hardcoded part of RBAC.
- `loyalty.ts` — `LoyaltyProgram` (tenant config) + `LoyaltyAccount`/
  `LoyaltyTransaction` + the earn/redeem math helpers.
- `module.ts` — **the tenant-module registry** (see flow 10): `TENANT_MODULES`
  (`printing` | `loyalty`) + `TENANT_MODULE_META` + `isModuleEnabled(tenant,
  module)`, the ONE check every surface uses to decide whether a restaurant
  runs an optional feature at all. ⚠️ Never read `tenant.printer?.enabled` /
  `tenant.loyalty?.enabled` raw — the two modules **disagree** about what an
  unset config means (printing defaults ON so pre-switch tenants keep printing;
  loyalty defaults OFF because it's opt-in), and only the registry gets both
  right. `isPrintingEnabled` (`printer.ts`) / `isLoyaltyEnabled` (a type guard,
  so it narrows like the raw `?.enabled` it replaces) are the per-module
  primitives it delegates to.
- **Printing contract** (see flow 9): `printer.ts` — `PrinterSettings`
  (agent URL/secret, `connectionType` usb|bluetooth|network, `commandLanguage`
  `auto`|`escpos`|`tspl`, free-form `paperWidth` `"<mm>mm"` +
  `PAPER_WIDTH_PRESETS` [58/76/80/101mm] + `paperWidthToMm`, ordered
  toggle-able `sections` + `mergeReceiptSections` which appends section types
  added after a layout was saved, e.g. `customerInfo`); `receipt.ts` —
  `Receipt` (tenant identity incl. `address`/`phone`/`gstNumber`/`fssaiNumber`,
  guest `customerName`/`customerPhone`, lines, totals, settled flag, UPI/review
  URLs); `kot.ts` — `Kot` (kitchen ticket: table/round/items/modifiers/notes,
  no prices); `print-format.ts` — the **shared text-layout engine** used by
  BOTH the print agent's renderers and the admin's live preview (`formatAmount`
  plain numbers without currency symbol, `wrapText`, `labelValueRow` truncates
  the label never the amount, `itemTableColumns/Header/Rows` Item·Qty·Price·
  Amount table that drops the unit-Price column under 34 cols, `taxRows`
  CGST/SGST split when GST-registered, `shouldUseTspl`, `printerColumns`).
- See **`api-reference/FEATURES.md`** for the full per-app feature →
  data-requirement inventory that drives the schema.

## API — `services/api` (NestJS + Prisma)
- `prisma/schema.prisma` — root `Tenant` (theme / printer / kitchenPrinter /
  loyalty / quickActions / paymentMethods as JSON; statutory bill fields `gstNumber`/`fssaiNumber`/`address`/
  `phone`; UPI `upiId`/`upiMobile`) + identity (`User`,
  `Membership`, `Role`; platform staff are `User.isSuperAdmin`). **RBAC:** `Role`
  is now a **per-tenant table** (`{ name, permissions String[], protected }`), NOT
  a fixed enum — Admins create/rename/edit custom roles. `Membership` carries
  `roleId` + an optional per-user `permissions String[]` override (non-empty =
  the member's COMPLETE effective set; else inherit the role — see
  `effectivePermissions`). The permission keys are the fixed catalog in
  `@amber/domain`'s `PERMISSIONS` (`permission.ts`). Then floor (`Room`,
  `Table` w/ `sortOrder`), menu
  (`MenuCategory`, `MenuItem`, optional `ModifierGroup`/`ModifierOption`),
  curated `MenuPlacement` (`PlacementKind` featured|welcome — fast lookup for the
  customer Welcome carousels + Menu hero), session (`Order`, `Round`, `OrderItem`
  w/ per-stage timestamps `preparingAt/readyAt/servedAt/cancelledAt`,
  `OrderItemModifier`), `Payment` (one per order, `method`, snapshot
  subtotal/tax/tip/total, `tendered`), `Review` (guest stars + comment), and
  loyalty (`LoyaltyAccount` keyed tenant+phone, `LoyaltyTransaction` ledger).
  Every non-tenant row carries `tenantId` (RLS-ready). `Order.billRequestedAt`
  powers the bill-request flow; `Order.customerName/customerPhone` (both optional)
  hold guest contact for the bill/receipt. ⚠️ Online-pay provider fields,
  kitchen-station routing and audit log are still **deliberately deferred**
  (see `api-reference/FEATURES.md` §5). **Auth is implemented** (email+password login → JWT →
  role/permission resolution; see the `auth/` module below), and newer slices
  landed since: **SaaS billing** (`billing/` — platform plans + per-tenant
  subscriptions, `/admin/billing` super-admin routes + `GET /billing/me`),
  **loyalty** (`loyalty/` — staff-only points accounts keyed by tenant+phone,
  earn-on-capture + redeem; math helpers in `@amber/domain`'s `loyalty.ts`),
  Quick Sale (walk-in counter sale — **atomic**: `POST /orders/quick-sale`
  records order + one round of items + payment in ONE transaction, the order is
  born `paid` on the virtual counter table so it is never live — that's what
  lets many tills ring up counter sales in parallel without occupancy conflicts
  or cross-device cart leaks), and KOT/receipt printing via the
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
  `service-requests/` (`POST /service-requests` public guest create — validates
  `type` against the tenant's live `quickActions` config (`mergeQuickActions`,
  400 if unknown/disabled — `ServiceRequest.type` is a plain `String` column,
  not a fixed Prisma enum, since it may be a tenant-authored custom button id)
  and dedupes: returns the existing row instead of a duplicate if that table
  already has a `pending` request of the same type; `GET /service-requests?status=`
  and `PATCH /service-requests/:id` staff-only, `@RequirePermission("tables.manage")`;
  `GET /service-requests/stream` SSE, same `?tenant=` fallback as the orders
  stream — see flow 8),
  `loyalty/` (`GET /loyalty/accounts?search=`, `GET /loyalty/accounts/:id` →
  account + transaction ledger + order summaries, `PATCH /loyalty/accounts/:id/adjust`
  — whole controller `loyalty.manage`-gated; guests never talk to it — account
  creation + earn/redeem happen server-side from `OrdersService`),
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
- `prisma/add-menu-items.ts` (`pnpm --filter @amber/api menu:extend`, `--dry-run` /
  `--tenant=<slug>`) is the **additive** counterpart to the seed: it only INSERTs,
  so it is safe against a live restaurant's DB. It grows ONE tenant's menu
  (`amber-grain` by default — menus are per-restaurant, never fan this out to
  every tenant), creating a category only if that name is missing and an item only
  if the tenant has no item of that name (case-insensitive); an existing row keeps
  its own price/photo/availability/modifiers untouched, so re-running is a no-op.
  Prices are authored in **rupees** (`rs(180)`) and it **aborts unless the tenant
  bills in INR** (`--force-currency` overrides) so a ₹ list can't 100×-mangle a $
  menu. Amber & Grain now carries 75 items over 11 categories (Snacks & Chaat,
  South Indian, Rice & Biryani, Breads, Chinese, Combos & Thalis + the original 5),
  38 of them with modifier groups covering all four `inputType`s.
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
- ⚠️ **Still missing** (see `api-reference/FEATURES.md`): category reorder (edit/delete done),
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
  **Responsive/type scale (phone-first):** `src/index.css` sets
  `html { font-size: clamp(14.2px, 6px + 2.56vw, 16px) }` — the single knob the
  guest UI scales from (same technique as restaurant-admin, tuned for the range
  guests actually scan from: 320px→14.2px, 360px→15.2px, 390px+→16px, clamped
  so nothing grows past the `max-w-md` design). **All font sizes are rem**
  (`text-[0.8125rem]`, not `text-[13px]`) — a hardcoded px size opts that
  element out of the scale, which is exactly what made the guest UI
  unresponsive before (the Welcome carousel's "Bring it" button was a fixed
  61×34px at every width). Touch targets are the deliberate exception and stay
  in **px** via the `.tap-target` / `.tap-target-sm` / `.tap-square` utilities
  (44/40/44² px): a fingertip is not smaller on a small phone, so those must
  not scale. Money rows follow the printed-bill rule — the name gets
  `min-w-0` and wraps/truncates, the amount is `flex-shrink-0 tabular-nums` and
  never truncates. Welcome's quick-action row is a `grid grid-cols-4` (not a
  flex row) because a tenant may enable up to 8 actions.
  Seed items have no photos, so `components/FoodImage.jsx` falls back to an icon stand-in.
  `components/ItemSheet.jsx` renders an item's **modifier groups** (radio / checkbox /
  switch / text by `inputType`), live-recomputes the price as options are picked, blocks
  add until required groups are satisfied, and carries the chosen modifiers through the
  cart → round → `addRound` (effective per-unit price = base + Σ deltas). See `api-reference/MODIFIERS.md`.
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
  Screens + contexts are still `.jsx` (incremental TS migration pending). Dead
  pre-API files (`src/data/menu.json`, `src/tenant/defaultTenant.ts`, the empty
  `components/KDS.jsx` stub) have been deleted.
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
  `api.tenant.update({theme})`, leaving without saving reverts). Also live under
  Settings: **`RestaurantProfilePage`** (`/settings/profile`: name, currency,
  tax rate, GST number, **FSSAI license** (14-digit validation), **address**,
  **phone** — the statutory fields printed on every bill), **`PaymentsPage`**
  (`/settings/payments`: the payments master page — UPI id/mobile for the
  bill's payment QR **plus "Accepted Methods"**, real per-tender toggles
  persisted to `Tenant.paymentMethods`; the UI refuses to switch off the last
  enabled tender and `applyTenant` pushes the change to every checkout live),
  **`PrinterPage`** (`/settings/printer`: print-agent + receipt layout — see
  flow 9), **`LoyaltySettingsPage`** (`/settings/loyalty`), and
  **`QuickActionsSettingsPage`** (`/settings/quick-actions`: drag-reorder +
  toggle the guest Welcome screen's action row, add up to 4 custom buttons
  with their own label/icon/color — see `quick-action.ts` above and flow 8).
  (`PlanBillingPage` — read-only subscription via `GET /billing/me` — exists as
  a file but is currently **unrouted**: the `/settings/billing` route was
  removed.) Beyond Settings, newer operational pages: **`QuickSalePage`** (`/quick-sale`,
  walk-in counter sale — **local-first**: the cart lives ONLY in this device's
  localStorage (`lib/quickSaleDraft.ts`, keyed per tenant slug; restored on
  reopen, so a close/refresh/offline spell loses nothing and each till/phone
  has its own private cart — no more cross-device cart leakage via the shared
  counter session), nothing is written server-side while items are added;
  confirming payment (in-page modal: method picker + cash tendered/change)
  sends ONE atomic `api.orders.quickSale({items, payment})` call, clears the
  local cart only on success, then navigates to the unchanged
  `PaymentCompletePage` (Print Receipt / New Sale)), **`BillingQueuePage`** (`/billing`, floor-wide list of
  sessions awaiting payment), and **`LoyaltyPage`** (`/loyalty`,
  `loyalty.manage`-gated customer points directory + adjust).
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
  Amber & Grain and Green Bowl → exercises the **tenant picker**. See `docs/apps/restaurant-admin.md` for the full RBAC write-up.
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
  the item (replace-on-save). See **`api-reference/MODIFIERS.md`**. **`OrderHistoryPage`** (`/history`, sidebar
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
  **Installable PWA** (staff run this on phones): `public/manifest.webmanifest`
  (name **TableFlow**, `standalone`, brand `#8c5000`, shortcuts to Quick Sale /
  KDS display / Tables) + generated icons (`icon-192/512`, `icon-maskable-512`,
  `apple-touch-icon`) + `public/sw.js`, registered from `main.tsx` via
  `lib/pwa.ts`'s `registerServiceWorker()` — **production builds only** (a worker
  over Vite's dev module graph fights HMR). The SW is deliberately data-free:
  the API is a different origin so every `/orders` call and both SSE streams fall
  straight through uncached (an installed till must never show a stale floor);
  navigations are network-first with the cached `/index.html` as the offline
  fallback, and only content-hashed `/assets/*` are cache-first. Bump
  `CACHE_VERSION` in `sw.js` to evict. `components/InstallAppButton.tsx` on
  `LoginPage` turns Chromium's captured `beforeinstallprompt` into an "Install
  app" button, falls back to manual Share → Add to Home Screen steps on iOS
  (which has no install API), and renders nothing once launched standalone or
  where install is impossible. ⚠️ Install + service worker need a **secure
  context** — they're unavailable over a plain `http://<lan-ip>:5174` dev origin;
  test via `pnpm --filter @amber/restaurant-admin build && … preview` on
  localhost, or serve the LAN over HTTPS/a tunnel.
  **Responsive/type scale:** the design tokens in `tailwind.config.js` are in
  **rem**, and `src/index.css` sets `html { font-size: clamp(13px, 11.8px + 0.4vw,
  16px) }` — so fonts, padding and controls scale down together on phones
  (~13.3px root at 390px, full 16px ≥1050px) instead of needing per-page
  overrides. Keep new tokens in rem or they won't scale.
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

### 0. Payment safety — the one-sided rule (read before touching checkout)
Settling a bill must never be guessed in EITHER direction: a false success closes
the table on an unpaid guest, a false failure makes staff charge twice. Two
mechanisms enforce this and must not be bypassed:
- **`apps/restaurant-admin/src/lib/payment.ts` `settlePayment`** is the trust
  boundary for dine-in. It returns `ok:true` **only** when the server has
  confirmed a `Payment` row. A 400/409 (or an exhausted transport retry) is
  never trusted alone — it re-reads `orders.getPayment`, because "Order already
  paid" from our own lost-response retry and "session was cancelled" are the
  same status code and only the payment row disambiguates. `AdminStore`'s
  `COMPLETE_PAYMENT` throws on `ok:false` so `dispatch` returns false, and
  **`BillingPage` only sets `paidRef`/navigates when `dispatch` returned true** —
  it previously navigated to "Session Completed" unconditionally, showing a
  success screen for failed payments.
- **Quick Sale is idempotent by key.** The cart's `clientRequestId`
  (`lib/quickSaleDraft.ts`, persisted beside the draft, minted via
  `lib/randomId.ts` — NOT `crypto.randomUUID`, which is undefined on the LAN's
  plain http) rides on `POST /orders/quick-sale`. `Order.clientRequestId` is
  **unique**; the service replays the original sale on a repeat key and on a
  `P2002` race. Verified live: 6 concurrent/sequential attempts → 1 sale.
  ⚠️ Never clear the draft (and its key) except after a confirmed sale.

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
- ⚠️ **Never hotlink; never use `flickr()` for a dish Flickr has no photos of.**
  loremflickr returns a permanent **HTTP 500** for an unmatched tag (no
  placeholder — the URL is dead forever). Every regional Indian dish name tried
  this way was dead, so 42 items shipped with URLs that could never load — the
  real cause behind "images sometimes don't load". If there's no reliable photo,
  **omit `imageUrl`** and let the icon/swatch stand-in render; it's a designed
  state, not a failure. Amber & Grain is now 32 self-hosted photos + 43 stand-ins,
  **zero external hotlinks** (100% load at ~143ms, vs 58% failing at ~900ms).
- `prisma/rehost-images.ts` (`pnpm --filter @amber/api images:rehost`, flags
  `--dry-run` / `--tenant=` / `--all-tenants` / `--prune-dead`) pulls existing
  hotlinks into our own bucket and, with `--prune-dead`, clears URLs it
  re-verifies as permanently gone. Only ever touches `imageUrl`; already-ours
  rows are skipped so re-running is a no-op.
- `prisma/fill-missing-images.ts` (`pnpm --filter @amber/api images:fill`)
  sources a photo for items with **no** `imageUrl` from Wikipedia lead images
  (OVERRIDES map → cleaned name → search), stores it in our bucket, and writes
  license/author to `prisma/image-attribution.json`. Only fills NULLs, so it
  can't clobber a real upload. ⚠️ Wikimedia requires **serial** API calls —
  concurrency 3 tripped the limiter, and the limit body is plain text, not
  JSON, so it masqueraded as "no match" for 29 of 43 dishes. ⚠️ Most of these
  photos are **CC BY-SA: attribution is a license condition** wherever shown —
  fine for demo data, but a live menu should use the restaurant's own photos.
- **Pasted links are imported, not stored raw.** `POST /menu/import-image`
  (`menu.manage`, `StorageService.importImageFromUrl`, api-client
  `menu.importImage`) fetches a pasted URL server-side and stores the bytes in
  our bucket, so admin "Paste Link" and "Upload Photo" end identically. It
  enforces http(s), the image-mime allow-list, a 5 MB cap, and an **SSRF host
  guard** (loopback / link-local / RFC1918 / bare hostnames) since it fetches a
  user-supplied URL from inside the API's network.
- `FoodImage.jsx` **lazy-loads** (`loading="lazy"`) and retries twice with
  backoff. Lazy loading is load-bearing: the menu renders 75 items at once, and
  an eager `<img>` fired 75 simultaneous requests, which is what drew
  Wikimedia's 429s. It also swaps to the stand-in *during* a retry so the
  browser never paints its own torn-page glyph.
- ⚠️ `swatch` gradient classes (`from-red-300 to-orange-400`) come from the
  **DB**, so Tailwind's JIT can't see them in `content` — they need the
  `safelist` pattern in `apps/customer/tailwind.config.js` or they render with
  `background-image: none`. Add any new swatch shade to that pattern's range.

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

### 8. Guest service requests + the per-tenant Quick Actions row
A guest's request for staff attention is a **`ServiceRequest`**, deliberately kept
separate from Order/Round/OrderItem/KDS (flow 4) — it's a notification, not a
kitchen ticket. The Welcome screen's **Quick Actions row is per-tenant
configurable** (`@amber/domain`'s `quick-action.ts`, restaurant-admin's
`QuickActionsSettingsPage` at `/settings/quick-actions`): an Admin can
show/hide + reorder the 3 built-in requests (Water / Call Staff / Manager)
and the navigational Full Menu entry, and add up to `MAX_CUSTOM_QUICK_ACTIONS`
(4) fully custom buttons (own label + icon + color swatch, each picked from a
small curated set) that behave exactly like Call Staff — a generic staff
notification, no other action type exists. `mergeQuickActions(tenant.quickActions)`
is the join point: an unconfigured tenant (`quickActions` empty/unset) gets
today's exact 4-button default; built-ins always keep their default
label/icon/sublabel/swatch (only `enabled`+order are tenant-editable for
them) even if a saved payload tries to override it. Mirrors flow 7's SSE
architecture end-to-end:
- **Create.** `WelcomeScreen.jsx` renders `mergeQuickActions(tenant.quickActions)`
  filtered to `enabled`; tapping a `kind:"service_request"` entry (built-in or
  custom) → `SessionContext.jsx` `sendServiceRequest(id)` → `api.serviceRequests.create({
  tableId, type: id })` → `POST /service-requests` (public, no device binding — not
  sensitive per-device state); a `kind:"full_menu"` entry just navigates, no
  request created. `ServiceRequestsService.create` first validates `type`
  against the tenant's live quick-actions config (400 if it's not a
  currently-enabled `service_request` button — blocks both garbage and a
  disabled/deleted button being spammed directly), then **dedupes**: a
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
- Icons/labels for the 3 built-ins come from `@amber/domain`'s
  `SERVICE_REQUEST_META[type]` — this is what originally fixed the bug where
  every "bring it" tap (including Water) showed a hardcoded delivery-truck
  toast icon, a symptom of the old design routing these through the food-order
  `bringIt` path instead of their own channel. A custom button's icon/label
  aren't in that static map (it only ever covers the built-ins by design), so
  both `Shell.tsx`'s `NotificationBell` and `TablesPage.tsx`'s per-table
  request badges fall back to `mergeQuickActions(tenant.quickActions)` (via
  `useTenant()`) keyed by `id` when `SERVICE_REQUEST_META` misses, with a
  generic icon/label as the last resort (a pending request whose custom
  button was since deleted).

### 9. Receipt & KOT printing (print-agent bridge)
Browsers can't talk to thermal/label printers, so printing goes **browser → local
print agent** (`services/print-agent`, Express on **:9200**, runs on the till PC next
to the printer). The agent is **stateless** — every request carries the full printer
connection config, so the tenant's settings are the single source of truth.
- **Master switch.** `PrinterSettings.enabled` is the per-tenant on/off for the
  WHOLE printing module — many restaurants bill without a printer. Read it via
  `isPrintingEnabled(settings)` (unset = ON, so pre-existing tenants keep
  printing; only an explicit `false` is off). When off: PrinterPage collapses
  to just the switch (no agent/connection/layout/test/preview),
  `PaymentCompletePage`'s "Print Receipt" button is **not rendered**, and the
  Settings landing's Printer card is dimmed + chipped "Off". The card itself
  deliberately stays listed — it holds the switch, so hiding it would strand
  the tenant with no way back on. Saving the toggle calls `applyTenant`
  (`useTenantBrand`, same channel as BrandingPage) so every surface updates
  without a reload.
- **Two print surfaces — and the UPI QR only exists on one.** The scan-to-pay
  `upiQr` section is suppressed by BOTH renderers once `settled`, so the
  post-payment receipt can never carry it (re-asking for money on a paid bill
  invites a double payment). The QR therefore needs a **pre-payment** print:
  restaurant-admin `BillingPage`'s **"Print Bill"** (`printBill`) builds the
  receipt with `payment: null` → the paper prints `TOTAL DUE` + the QR, and
  nothing is captured (the table stays open; staff still confirm below).
  `PaymentCompletePage`'s "Print Receipt" is the settled counterpart.
  The QR follows the **tender toggle**, not just the presence of a VPA:
  `upiPaymentUrl` is set only when `tenant.upiId && isPaymentMethodEnabled(
  tenant.paymentMethods, "upi")`, so a restaurant that switched UPI off in
  Settings → Payments keeps its VPA on file but stops inviting UPI payment.
  `upiQr` **defaults enabled** in `DEFAULT_RECEIPT_SECTIONS` (it is doubly
  data-gated, so on-by-default is inert for tenants with no UPI); a tenant whose
  saved layout predates that change keeps their stored `false` —
  `mergeReceiptSections` only appends missing types, it never re-enables an
  explicit off, so they must flip it in Settings → Printer.
- **Settings.** `PrinterSettings` (`@amber/domain` `printer.ts`) lives on the tenant
  as two JSON blobs: `Tenant.printer` (receipts) + `Tenant.kitchenPrinter` (KOTs).
  Edited in restaurant-admin `/settings/printer` (`PrinterPage.tsx`), saved via
  `PATCH /tenant`. Fields: `agentUrl`/`agentSecret`, `connectionType`
  (`usb`|`bluetooth`|`network` + per-type address), `commandLanguage`
  (`auto`|`escpos`|`tspl`), `paperWidth` (`"<mm>mm"`, presets 58/76/80/101 + custom
  40–210 mm), and an ordered toggle-able `sections` layout. `mergeReceiptSections`
  appends section types added to the codebase after a tenant saved their layout
  (e.g. `customerInfo`), so old saved configs pick up new sections automatically.
- **The shared layout engine** (`@amber/domain` `print-format.ts`) is used by BOTH
  the agent's renderers and `PrinterPage`'s live preview, so the on-screen preview
  matches the paper **character-for-character**: `printerColumns` (ESC/POS 58→32,
  76→42, 80→48 cols; TSPL computed from mm at the head's REAL dpi —
  `PrinterSettings.dpi` 203|300, unset = device-name sniff DA310/DA320 → 300
  via `printerDpi`, plus configurable `marginLeftMm`/`marginRightMm` side
  margins (default 3mm) via `printerMarginsMm`; ⚠️ dot math at the wrong dpi
  prints a "101mm" layout in ~68mm of a 300-dpi head's paper), `formatAmount` (plain
  numbers, **no currency symbol** — thermal charsets can't print ₹), `wrapText`,
  `labelValueRow` (truncates the label, never the amount), `itemTableColumns/
  Header/Rows` (Item·Qty·Price·Amount; drops the unit-Price column under 34 cols),
  `taxRows` (CGST/SGST split when `gstNumber` is set), `shouldUseTspl` (explicit
  `commandLanguage`, else sniffs `tsc`/`da310` in the device address).
- **Build the receipt.** `lib/receipt.ts`'s `buildReceipt` (client-side, shared by
  BOTH print surfaces so the bill and the receipt can never drift) re-fetches
  order + payment and assembles the `Receipt` (`receipt.ts`): tenant identity
  incl. statutory `address`/`phone`/`gstNumber`/`fssaiNumber`, guest
  `customerName`/`customerPhone`, lines (cancelled excluded), totals.
  `settled` is derived **only** from `!!payment` — never a caller-supplied flag,
  so no page can print "paid" on an unpaid bill. With no payment row it takes
  its amounts from the caller's `bill` (BillingPage's post-loyalty-redemption
  totals, so paper == screen) and otherwise recomputes tax from `tenant.taxRate`
  — reading `payment?.tax ?? 0` would print a bill with zero tax and a short total.
  "Print Again" just re-sends. `lib/printAgent.ts` (`printReceipt`/
  `printTestReceipt`/`checkAgentHealth`) does a direct `fetch` to the agent (8s
  timeout, `X-Agent-Secret` header) — deliberately NOT via `@amber/api-client`
  (the agent is a LAN device, not the API).
- **Agent routes** (`services/print-agent/src/routes/`): `POST /print` (receipt),
  `POST /print/test`, `POST /print/kot`, and `POST /printer/info` (**paper/dpi
  detection**: `printer/queryPrinter.ts` asks the OS driver — Windows
  `System.Drawing.Printing.PrinterSettings` DEVMODE, queue matched by Name OR
  ShareName like `osPrintDriver` — for the configured stock width/height/dpi;
  USB/Bluetooth installed printers only, a raw network :9100 target has no
  driver; surfaced as PrinterPage's "Detect from printer" button, which snaps
  the width to a preset within 2mm — e.g. a 4.00" stock's 101.6mm → 101mm —
  and sets `dpi`) — all gated by `X-Agent-Secret` when
  `AGENT_SECRET` is set; `GET /health` open. Each branches on `shouldUseTspl`:
  **ESC/POS** → `node-thermal-printer` (`handlePrint.ts` + `printer/render.ts`/
  `renderKot.ts`; `connect.ts` pins width via `printerColumns` + charset PC437);
  **TSPL** (label printers like the TSC DA310) → `printer/renderTspl.ts` builds the
  command buffer (TEXT/native QRCODE/BITMAP — the logo is fetched and converted to
  a 1-bit bitmap via `pngjs`) and `printer/rawPrint.ts` sends the raw bytes:
  `network` → TCP :9100; `usb`/`bluetooth` → the OS queue (`osPrintDriver.ts`) —
  **Windows** via winspool RAW (PowerShell `Add-Type` `RawPrinterHelper`, queue
  matched by Name OR ShareName — printer sharing is NOT required anymore),
  macOS/Linux via `lp -d <name> -o raw`.
- **Errors** map to UX: agent unreachable / bad secret / **400** = config problem
  (fix settings) / **502** = printer failure (check the device). Surfaced as
  `PrintResult` reasons in `lib/printAgent.ts`.
- **TWO transports (the mobile/PWA fix).** An https admin page CANNOT call
  `http://<lan-ip>` — mixed content, with no override in installed PWAs or on
  iOS. So printing has two paths, chosen automatically in `lib/printAgent.ts`:
  1. **Direct LAN** (original, unchanged): browser → agent on :9200. Kept for a
     desktop till on the same machine; `directWouldBeBlocked()` allows it for
     http pages and for `localhost`/`127.0.0.1` even on https (secure context).
  2. **Cloud relay** (`@amber/domain` `print-relay.ts`): the **agent dials OUT**
     to the API (`GET /print/agent/stream`, SSE, authenticated by the tenant's
     existing `printer.agentSecret` — no new credential) and holds the
     connection; the browser POSTs `/print/jobs` over ordinary same-origin
     HTTPS and the API pushes the job down that stream, awaiting the agent's
     `POST /print/agent/result`. This works identically on desktop, Android
     Chrome, iOS Safari and both installed PWAs, because the client only ever
     makes a normal API call. Requires **zero** inbound network config, certs
     or per-device trust.
     - API: `services/api/src/print/` (`PrintRegistry` = connected agents +
       pending-job promises, `PrintAgentGuard` = timing-safe secret check).
       ⚠️ Registry state is **in-process**, same constraint as `OrdersEvents` —
       multi-instance needs shared pub/sub routing.
     - Agent: `services/print-agent/src/relay/relayClient.ts` (SSE read via
       native `fetch` streaming — no dep, no experimental global EventSource;
       capped-backoff reconnect + staleness watchdog). Enabled only when
       `AMBER_API_URL` + `AMBER_TENANT_SLUG` + `AGENT_SECRET` are all set;
       otherwise the agent behaves exactly as before.
     - Both transports run the SAME renderers via
       `services/print-agent/src/printer/execute.ts` + `executeJob.ts`, so
       output is byte-identical whichever path a job takes. `handlePrint.ts` is
       now a thin HTTP wrapper over that executor and preserves the 400/502
       contract exactly.
     - Status is surfaced in Settings → Printer ("Printing From Phones &
       Tablets"), listing connected agents and their discovered printers.
- ⚠️ **KOT printing is agent-ready but not wired**: `POST /print/kot`,
  `renderKot`/`renderTsplKot` and `Tenant.kitchenPrinter` all exist, but no admin
  code sends a KOT yet (deferred — will hook into round-created events).

### 10. Optional tenant modules (the universal on/off) — printing & loyalty
Some features are whole **modules**, not preferences: a restaurant that bills
without a printer, or runs no points program, must not see that feature
*anywhere*. Half-hiding it is worse than not having it — staff click a dead
control and think the app is broken. `@amber/domain`'s `module.ts` is the single
source of truth (see the contract entry above); adding a module there wires up
every consumer at once. **The four rules:**
1. **One switch, one owner, always reachable.** Exactly one Settings page holds
   the toggle (`TENANT_MODULE_META[m].switchRoute` — `/settings/printer`,
   `/settings/loyalty`) and it is the module's ONLY surviving surface when off:
   its `SettingsPage` card stays listed but dimmed with an **"Off" chip**
   (`Card.module`), because hiding it would strand the tenant with no way back
   on. That page must NEVER carry `RequirePermission module=`.
2. **Hidden everywhere else, and unreachable — not greyed out.** `NavItem.module`
   (`lib/nav.ts`) drops the sidebar entry (`Shell`) *and* excludes it from
   `homeRouteFor`/`isNavItemVisible`; `RequirePermission module=` (`App.tsx`
   route) bounces a typed URL or stale bookmark to the user's home. Module and
   permission are **independent** gates: `loyalty.manage` says the person may
   run the program, the module says the restaurant *has* one.
3. **Wait for the real tenant before deciding.** `TenantThemeGate` renders
   children immediately against the **platform placeholder** (`defaultTenant`),
   which reports every optional module off — so `useTenantBrand().tenantResolved`
   gates any config-derived decision. Without it a deep link to `/loyalty`
   bounces in the split second before the tenant lands. (Theming itself doesn't
   care; the placeholder is the correct fallback for the login screen.)
4. **Hiding is presentational; money and data are guarded separately.** A saved
   toggle calls `applyTenant` (`useTenantBrand`, same channel as BrandingPage) so
   every surface updates with **no reload**. But switching a module off must
   never make history unreadable or break an in-flight request:
   - **Writes that move value are refused server-side** — `OrdersService.redeemPoints`
     and `PATCH /loyalty/accounts/:id/adjust` 400 when loyalty is off, so a stale
     Billing tab can't discount a live bill. ⚠️ Clearing an existing redemption
     (`points === 0`) stays allowed: it only ever puts money BACK on the bill.
   - **Reads stay open** (`GET /loyalty/accounts*`): balances are the guests'
     record, and 403-ing a GET turns a switched-off module into errors in any
     open tab instead of a clean disappearance.
   - **Amounts already applied keep rendering.** BillingPage still shows a
     "Loyalty discount (N pts)" line while off — a line subtracted from the
     amount due can't be hidden or the bill stops adding up. Same split in
     `OrderHistoryPage`: points **earned** disappears (a program benefit),
     points **redeemed** stays (it explains a lower total).
Loyalty deliberately has **no guest-facing surface at all** (the customer app
contains zero loyalty code), and super-admin's cross-tenant Customers directory
is *not* module-gated — different audience, read-only, platform-level.

## Conventions & gotchas
- Money is **integer cents** in the domain/API. The customer screens map to float
  dollars in `MenuContext` for display — keep `priceCents` for anything sent back.
- Add new color tokens in BOTH `packages/config/tailwind/tokens.cjs` and the baseline
  `packages/ui/src/tokens.css`; optionally expose them in `themeColorsSchema`.
- **Unfinished features kept on purpose** (don't "clean up" as dead code):
  restaurant-admin's `PlanBillingPage.tsx` + `lib/currency.ts` (billing UI, route
  removed) and `lib/auth.ts` + `ImpersonationBanner.tsx` + `BillingLockoutGate.tsx`
  (impersonation receiving side — super-admin already sends `?impersonationToken=`;
  wiring = mount the banner + point `lib/api.ts` at `getAuthToken`/`getActiveTenantSlug`).
- Build order matters: `@amber/domain` emits `dist/`; `ui`/`api-client` are consumed
  as source by Vite. Turbo's `^build` enforces dependency order.
