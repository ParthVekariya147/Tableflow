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
│   ├── restaurant-admin/  # KDS + menu/table mgmt (shell; spec in DESIGN.md + kds.html)
│   └── super-admin/       # tenant onboarding / billing / analytics (shell)
├── packages/
│   ├── config/            # shared tsconfig bases, eslint presets, Tailwind preset
│   ├── domain/            # @amber/domain — Zod schemas + types (the contract)
│   ├── ui/                # @amber/ui — TenantThemeProvider + tokens + components
│   └── api-client/        # @amber/api-client — one typed client (no hand-written fetch)
├── services/
│   └── api/               # @amber/api — NestJS + Prisma (Postgres), source of truth
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
- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck` — fan out via Turbo
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
- See **`FEATURES.md`** (repo root) for the full per-app feature → data-requirement
  inventory that drives the schema.

## API — `services/api` (NestJS + Prisma)
- `prisma/schema.prisma` — root `Tenant` (theme as JSON) + identity (`User`,
  `Membership` w/ `Role` owner|manager|server|kitchen; platform staff are
  `User.isSuperAdmin`), floor (`Room`, `Table` w/ `sortOrder`), menu
  (`MenuCategory`, `MenuItem`, optional `ModifierGroup`/`ModifierOption`),
  curated `MenuPlacement` (`PlacementKind` featured|welcome — fast lookup for the
  customer Welcome carousels + Menu hero), session (`Order`, `Round`, `OrderItem`
  w/ per-stage timestamps `preparingAt/readyAt/servedAt/cancelledAt`,
  `OrderItemModifier`), `Payment` (one per order, `method`, snapshot
  subtotal/tax/tip/total, `tendered`), and `Review` (guest stars + comment).
  Every non-tenant row carries `tenantId` (RLS-ready). `Order.billRequestedAt`
  powers the bill-request flow; `Order.customerName/customerPhone` (both optional)
  hold guest contact for the bill/receipt. ⚠️ Auth tokens, online-pay provider fields,
  kitchen-station routing, audit log, notifications and SaaS billing are
  **deliberately deferred** (see `FEATURES.md` §5).
- **Tenant scoping:** `TenantMiddleware` reads `X-Tenant-Slug`, resolves the tenant,
  attaches it to the request; `@CurrentTenant()` injects it into handlers; services
  scope every query by `tenant.id`. `/admin/*` is excluded (cross-tenant, super-admin).
- Modules: `tenant/` (resolve + `GET /tenant`, `/tenants/:slug`),
  `menu/` (`GET /menu`, `POST /menu/categories`, `PATCH /menu/categories/:id`
  rename/reorder, `DELETE /menu/categories/:id` (blocked while it holds items),
  `POST /menu/items`, `PATCH /menu/items/:id`, `DELETE /menu/items/:id`,
  `POST /menu/upload` multipart item-photo upload → `{ url }`),
  `tables/` (`GET /tables` floor list + status + live session, `GET /tables/qr/:token`,
  `POST /tables`, `PATCH /tables/:id`, `POST /tables/:id/qr` regen, `DELETE /tables/:id`),
  `orders/` (`GET /orders?status=` live list, `GET /orders/sales`, `GET /orders/:id`,
  `POST /orders`, `/:id/rounds`, `/:id/items` add, `PATCH /:id/items/:itemId` qty/status,
  `/:id/bill`, `/:id/cancel`, `/:id/payment` capture),
  `admin/` (`GET|POST /admin/tenants`). `prisma/` is a global module.
  Item-status PATCH stamps the per-stage timestamps; payment recomputes
  subtotal/tax (from `tenant.taxRate`)/total server-side and closes the order.
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
  menu + tables to prove multi-tenancy.
- ⚠️ `@prisma/client` types require `pnpm db:generate` (offline, schema-only) before
  the API typechecks/builds. `/admin/*` still needs an auth guard (TODO). **All
  tenant-scoped routes above are currently unauthenticated** (auth deferred) — they
  rely only on `X-Tenant-Slug`.
- The DB runs on **Supabase** (cloud Postgres); `services/api/.env` `DATABASE_URL`
  points at it. Schema is synced with `npx prisma db push` (no `migrations/` dir).
- ⚠️ **Still missing** (see `FEATURES.md`): category reorder (edit/delete done), analytics
  aggregates (dashboard/analytics pages still derive from the sales feed client-side),
  menu placements, and review submit. **Build order is vertical per slice:** domain
  schema/DTO → Nest controller+service → api-client method → rewire the frontend page.
  Verifying a slice needs the DB reachable (`prisma db push` + `pnpm db:seed`).

## The typed client — `@amber/api-client` (`packages/api-client/src/`)
`createApiClient({ baseUrl, tenantSlug?, getToken?, fetch? })` → resource methods
(`tenant`, `menu`, `tables`, `orders`, `admin`). Central `request()` (`http.ts`)
attaches `X-Tenant-Slug` + bearer token and **validates responses against domain
schemas**. `withTenant(client, slug)` clones for a different tenant. `ApiError` for non-2xx.
- Resource methods now cover menu CRUD (`menu.addCategory/updateCategory/deleteCategory/
  addItem/updateItem/deleteItem`, plus `menu.uploadImage(file)` → multipart `FormData`
  POST returning `{ url }`; `request()` passes a `FormData` body through untouched),
  the floor (`tables.list/create/update/regenerateQr/remove/byQrToken`), and the full
  session lifecycle (`orders.list/sales/get/createForTable/addRound/addItem/updateItem/
  requestBill/cancel/capturePayment`). `tables.byQrToken` hits `GET /tables/qr/:token`.

## Apps
- **customer** (`apps/customer`) — the guest ordering app, **wired to the live API
  with QR-based tenant/table resolution** (see `apps/customer/docs/qr-entry-flow.md`).
  `context/MenuContext.jsx` (`MenuProvider`) loads `api.menu.get()` and maps it to the
  screens' shape (cents→dollars, `category` name, `priceCents`+`id` kept for ordering);
  Welcome carousels are derived from the live menu. `context/SessionContext.jsx` opens a
  real **Order** on `startSession({ customerName, customerPhone })` for the scanned table
  via `api.orders.createForTable` and **persists each round** via `api.orders.addRound`,
  so guest orders appear in restaurant-admin's floor/sessions.
  Seed items have no photos, so `components/FoodImage.jsx` falls back to an icon stand-in.
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
  and the table via `api.tables.byQrToken`, then checks occupancy via
  `api.orders.list("open")`. Boot renders its own loading / **"Invalid QR"** /
  **"Table in use"** screens (`screens/BootScreens.jsx`); only a free table renders the
  app. `screens/SplashScreen.jsx` is the **reserve form**: required name + phone
  (client validation + honeypot) → `startSession` **re-checks occupancy** (race guard)
  → `createForTable(tableId, { customerName, customerPhone })`. Security: `qrToken` is
  the capability; the create-order DTO (`services/api/src/orders/orders.dto.ts`)
  enforces name/phone **format** server-side (the trust boundary) — kept optional so
  staff walk-in open-session still works, with *required* enforced client-side for
  guests. ⚠️ Still deferred: server-side **rate-limit** on order creation; SPA host
  fallback for deep QR links in production.
- **restaurant-admin** (`apps/restaurant-admin`) — **wired to the live API.**
  `store/AdminStore.tsx` is now API-backed: it loads menu + floor (`tables.list`) +
  sales on mount, maps the domain shapes to the local `data/types.ts` view model
  (kept for low page churn), and exposes an **async `dispatch`** that translates each
  UI action (menu edit, add table, open/run/cancel session, take payment) into the
  matching `@amber/api-client` call, then refetches. Pages (`MenuPage`, `TablesPage`,
  `TableSessionPage`, `BillingPage`, `DashboardPage`, `AnalyticsPage`) read the same
  `{ state, dispatch }` from `useAdmin()`. `TablesPage` supports add / edit / **delete**
  (delete blocked while occupied / with order history) and renders a **real scannable
  QR** per table (`QRCodeCanvas` from `qrcode.react`) encoding
  `<VITE_CUSTOMER_URL>/<slug>/t/<qrToken>` via `lib/tableQr.ts` — with copy-link +
  download-PNG + **regenerate behind a confirm/warn step** (rotating the token via
  `REGEN_QR` invalidates any already-printed QR, so it must be reprinted; the modal
  re-renders the new code on confirm). Adding a table mints a fresh `qrToken`
  server-side.
  ⚠️ The `kds/` board still runs on its own
  `KdsTransport` seam (not yet pointed at `orders.list`); Dashboard/Analytics totals
  still derive client-side from the sales feed. `tenant/defaultTenant.ts` supplies the
  slug (`amber-grain`) + theme; base URL via `VITE_API_URL` (default `:3001`),
  customer PWA origin via `VITE_CUSTOMER_URL` (default `:5173`, for QR links).
- **super-admin** — TS shell wired to `@amber/ui` + `@amber/api-client`, ready to
  build out (tenant onboarding/analytics).

## Conventions & gotchas
- Money is **integer cents** in the domain/API. The legacy customer screens still
  use float dollars from `menu.json` — reconcile when migrating to the API.
- Add new color tokens in BOTH `packages/config/tailwind/tokens.cjs` and the baseline
  `packages/ui/src/tokens.css`; optionally expose them in `themeColorsSchema`.
- `apps/customer/src/components/KDS.jsx` is an empty legacy stub; the real KDS lives in `apps/restaurant-admin`.
- Build order matters: `@amber/domain` emits `dist/`; `ui`/`api-client` are consumed
  as source by Vite. Turbo's `^build` enforces dependency order.
