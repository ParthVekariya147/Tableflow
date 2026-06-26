# Super Admin — Build Reference

> Working doc for building out `apps/super-admin` (platform operator panel).
> Pulls together what already exists (API, domain, client) vs what's still a
> stub, so features can be built without re-deriving context each time.
> Keep in sync with `FEATURES.md` §3 (S1–S5) and `CLAUDE.md` as this lands.

## Current state (as of this doc)
`apps/super-admin` now has a **routing shell with Supabase auth wired in**,
but most page bodies are intentionally left as TODOs — see `PENDING_TASKS.md`
§2b for the exact build-out list. Files:
```
apps/super-admin/src/
├── lib/supabase.ts          — Supabase client, cached access-token getter,
│                              signInWithPassword/signInWithGoogle/signOut
├── api.ts                   — createApiClient({ baseUrl, getToken }), no
│                              tenantSlug (cross-tenant); getToken reads the
│                              cached Supabase session token
├── components/
│   ├── Shell.tsx             — sidebar (Tenants, Plans) + Outlet
│   └── RequireSession.tsx    — redirects to /login with no session
├── pages/
│   ├── LoginPage.tsx          — email/password + Google, direct supabase-js
│   ├── TenantsPage.tsx        — live list + plan/status + Impersonate action
│   ├── TenantEditPage.tsx     — loads tenant; editor form is TODO
│   ├── TenantSubscriptionPage.tsx — loads sub+plans; assign/cancel is TODO
│   └── PlansPage.tsx          — live plan cards; create/edit form is TODO
├── App.tsx    — routes: /login, / , /tenants/:id/edit,
│                /tenants/:id/subscription, /plans
├── main.tsx   — wraps App in BrowserRouter
└── index.css
```
Port **5175**. Env (`.env.example`): `VITE_API_URL`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_RESTAURANT_ADMIN_URL`.

## What already exists on the backend

### `/admin/*` routes (`services/api/src/admin/`)
- `GET /admin/tenants` → `Tenant[]` — works today.
- `POST /admin/tenants` → create one (`createTenantSchema`: `slug`, `name`,
  `currency` default `USD`, `taxRate` default `0`, `theme` default `{}`) — works
  today, **no UI yet**.
- `/admin/*` is excluded from `TenantMiddleware` (cross-tenant by design).
- ⚠️ **No auth guard on `/admin/*` at all.** `api.ts`'s `getToken` reads
  `localStorage["amber.adminToken"]` but nothing on the server checks it. Any
  caller can list/create tenants. This must be closed before any real deploy
  (see `CLAUDE.md` Auth TODO).
- Only `create` + `list` exist — **no update/delete tenant endpoint.**

### `@amber/api-client` admin resource (`packages/api-client/src/index.ts:411`)
```ts
admin: {
  listTenants(): Promise<Tenant[]>
  createTenant(input: CreateTenantInput): Promise<Tenant>
}
```
That's the entire surface today. A theme-editor or billing page will need new
client methods + matching API routes (see Gaps below).

### The `Tenant` contract (`@amber/domain` `tenant.ts`)
```ts
Tenant = {
  id, slug, name,
  currency: string (ISO-4217, default "USD"),
  taxRate: number (0..1),
  theme: ThemeConfig,
  active: boolean,
}
ThemeConfig = {
  colors: Partial<ThemeColors>,   // ~20 named hex tokens, see themeColorsSchema
  typography: { sans, serif, fontLinks[] },
  logoUrl?: string,
  mode: "light" | "dark",
}
```
`themeColorsSchema` token list lives in `packages/domain/src/tenant.ts` and
must mirror `packages/config/tailwind/tokens.cjs` — any theme editor UI should
drive its color pickers off that same token list, not hardcode swatches.

## Feature backlog (mirrors `FEATURES.md` §3)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| S1 | Tenant list | ✅ done | `App.tsx` — name, slug, primary swatch |
| S2 | Onboarding wizard | ⛔ API exists, no UI | `POST /admin/tenants` works; needs a form. Also: onboarding today does **not** create an owner `User`/`Membership` or seed rooms/tables/menu — decide if it should |
| S3 | Live theme editor | ⛔ nothing | needs `PATCH /admin/tenants/:id` (doesn't exist yet) + a color-token-driven UI reusing `TenantThemeProvider`'s `hexToRgbChannels` for live preview |
| S4 | Per-tenant billing (SaaS) | ⛔ nothing modeled | no `Subscription`/`Plan`/`Invoice`/usage-metrics tables in Prisma at all — this is a schema task before it's a UI task |
| S5 | Cross-tenant analytics | ⛔ nothing | needs an aggregate query across all tenants' `Payment`/`Order` (restaurant-admin's `GET /orders/analytics` is **tenant-scoped**, won't work as-is for a platform-wide view) |

## Build order (recommended, vertical per slice — same pattern as the rest of the codebase)

1. **Routing shell first.** Add `react-router` (admin app already uses it),
   a sidebar (`Tenants`, `Billing`, `Analytics`), and move the current list
   into a `TenantsPage`.
2. **S2 Onboarding wizard** — pure frontend since the API already works:
   form → `api.admin.createTenant({ slug, name, currency, taxRate, theme })`.
   Decide first whether it should also provision an owner user (needs new
   backend work) or stay tenant-only for now.
3. **S3 Theme editor** — needs new backend: add `PATCH /admin/tenants/:id`
   (`admin.controller.ts` + `admin.service.ts`, mirrors `createTenant`) before
   the UI can save anything. Reuse `themeColorsSchema`'s key list to render
   color inputs; live-preview with `TenantThemeProvider` (`packages/ui/src/theme/`).
4. **S5 Cross-tenant analytics** — backend-heavy: a new `/admin/analytics`
   endpoint that aggregates `Payment`+`Order` across tenants (no `tenantId`
   filter, unlike `orders.service.ts`'s existing analytics query — that one is
   the template to copy *and* remove the tenant scope from).
5. **S4 Billing** — biggest lift: needs new Prisma models (`Subscription`,
   `Plan`, `Invoice`) + a payment-processor integration before any UI is
   meaningful. Treat as its own project, not a quick add.
6. **Auth** — `/admin/*` has zero protection right now. Should land before
   this app is exposed anywhere reachable, even internally.

## Known gaps / decisions to make before building
- **No admin auth.** `api.ts` already wires a bearer token slot
  (`amber.adminToken`) — the server side (a guard checking `User.isSuperAdmin`)
  doesn't exist. Don't ship past localhost without it.
- **No tenant update/delete/deactivate endpoint** — only create+list. `active`
  field exists on the schema but nothing flips it.
- **Onboarding doesn't seed anything** — a brand-new tenant has no rooms,
  tables, menu, or owner login. Either the wizard or a follow-up "setup
  checklist" page needs to drive that.
- **Cross-tenant analytics has no backend path yet** — don't assume
  `orders.analytics` can just be reused; it's intentionally tenant-scoped.
