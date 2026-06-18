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
  Item `status`: `placed → preparing → served` (+`cancelled`). Helpers:
  `ITEM_STATUS_FLOW`, `orderSubtotal`, `formatMoney`.
- `common.ts` — id/money/timestamp/slug primitives.

## API — `services/api` (NestJS + Prisma)
- `prisma/schema.prisma` — Tenant (theme as JSON) + Table, MenuCategory, MenuItem,
  Order, Round, OrderItem. Every non-tenant row has `tenantId`.
- **Tenant scoping:** `TenantMiddleware` reads `X-Tenant-Slug`, resolves the tenant,
  attaches it to the request; `@CurrentTenant()` injects it into handlers; services
  scope every query by `tenant.id`. `/admin/*` is excluded (cross-tenant, super-admin).
- Modules: `tenant/` (resolve + `GET /tenant`, `/tenants/:slug`), `menu/` (`GET /menu`),
  `orders/` (`GET /orders/:id`, `POST /orders`, `/:id/rounds`, `/:id/bill`),
  `admin/` (`GET|POST /admin/tenants`). `prisma/` is a global module.
- DTO validation via Zod (`*.dto.ts`). Mappers convert Prisma rows ↔ domain types.
- `prisma/seed.ts` seeds 3 tenants (amber-grain, green-bowl, bella-pizza) with
  distinct themes — proves one codebase, many brands.
- ⚠️ `@prisma/client` types require `pnpm db:generate` (offline, schema-only) before
  the API typechecks/builds. `/admin/*` still needs an auth guard (TODO).

## The typed client — `@amber/api-client` (`packages/api-client/src/`)
`createApiClient({ baseUrl, tenantSlug?, getToken?, fetch? })` → resource methods
(`tenant`, `menu`, `tables`, `orders`, `admin`). Central `request()` (`http.ts`)
attaches `X-Tenant-Slug` + bearer token and **validates responses against domain
schemas**. `withTenant(client, slug)` clones for a different tenant. `ApiError` for non-2xx.

## Apps
- **customer** (`apps/customer`) — the original ordering app, now wired:
  `main.tsx` imports `@amber/ui/tokens.css`, wraps `App` in `TenantThemeProvider`
  with `src/tenant/defaultTenant.ts` (standalone fallback; swap for `api.tenant.bySlug`).
  Screens (`SplashScreen`, `WelcomeScreen`, `MenuScreen`, `MyOrderScreen`,
  `StatusScreen`, `BillScreen`) + `SessionContext` are still `.jsx` — **incremental
  TS migration pending**; they still read `src/data/menu.json` (should move to `api.menu.get()`).
  Routing is in-memory (`MemoryRouter`).
- **restaurant-admin** / **super-admin** — TS shells wired to `@amber/ui` + `@amber/api-client`,
  ready to build out (KDS board; tenant onboarding/analytics).

## Conventions & gotchas
- Money is **integer cents** in the domain/API. The legacy customer screens still
  use float dollars from `menu.json` — reconcile when migrating to the API.
- Add new color tokens in BOTH `packages/config/tailwind/tokens.cjs` and the baseline
  `packages/ui/src/tokens.css`; optionally expose them in `themeColorsSchema`.
- `apps/customer/src/components/KDS.jsx` is an empty legacy stub; the real KDS lives in `apps/restaurant-admin`.
- Build order matters: `@amber/domain` emits `dist/`; `ui`/`api-client` are consumed
  as source by Vite. Turbo's `^build` enforces dependency order.
