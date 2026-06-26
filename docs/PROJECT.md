# Amber & Grain — Project Overview

## What It Is
A **multi-tenant restaurant ordering platform**. One codebase serves many restaurant tenants. Each restaurant is a database row; the same app code loads one tenant's config at runtime and renders that brand's experience — no code is forked per restaurant.

## Repository Tree

```
D:\Tableflow\
├── apps/
│   ├── customer/              # Guest ordering PWA — port 5173
│   ├── restaurant-admin/      # Manager cockpit (KDS + menu + billing) — port 5174
│   └── super-admin/           # Platform control plane — port 5175
├── packages/
│   ├── domain/                # @amber/domain — Zod schemas + types (the contract)
│   ├── api-client/            # @amber/api-client — typed HTTP client
│   ├── ui/                    # @amber/ui — TenantThemeProvider + CSS token engine
│   └── config/                # @amber/config — Tailwind preset, tsconfig bases, ESLint
├── services/
│   └── api/                   # @amber/api — NestJS + Prisma backend — port 3001
├── tools/
│   ├── dev.mjs                # One-command dev orchestrator
│   ├── kds-relay.mjs          # In-memory KDS relay — port 4001
│   └── sync-lan-env.mjs       # Auto-writes LAN IP into .env.local files
├── BRAIN.md                   # Compact cheatsheet — read first
├── CLAUDE.md                  # Deep technical reference
├── FEATURES.md                # Feature inventory per app
├── MODIFIERS.md               # Modifier system documentation
├── PLATFORM_PLAN.md           # Platform architecture + phased rollout
├── PENDING_TASKS.md           # Outstanding work
├── CHANGES.md                 # Changelog
└── REALTIME-SYNC-PLAN.md      # Plan for unifying KDS onto SSE stream
```

## Detailed Directory Trees

### `apps/customer/`
```
apps/customer/
├── src/
│   ├── main.tsx               # Entry: BrowserRouter + BootProvider
│   ├── App.jsx                # Routes + SessionEndScreen above-router guard
│   ├── api.js                 # createGuestApi(slug) with X-Device-Id
│   ├── device.js              # Stable per-device ID in localStorage
│   ├── kitchen.js             # KdsTransport to relay
│   ├── session-store.js       # localStorage session persistence
│   ├── context/
│   │   ├── BootContext.jsx    # QR parse → tenant/table/occupancy resolution
│   │   ├── SessionContext.jsx # Full guest session lifecycle
│   │   └── MenuContext.jsx    # Menu load from boot prefetch
│   ├── screens/
│   │   ├── SplashScreen.jsx   # Reserve form (name + phone)
│   │   ├── WelcomeScreen.jsx  # Post-reserve landing
│   │   ├── MenuScreen.jsx     # Item browsing + add to cart
│   │   ├── MyOrderScreen.jsx  # Cart view
│   │   ├── StatusScreen.jsx   # Per-item kitchen status
│   │   ├── BillScreen.jsx     # Bill + payment
│   │   ├── SessionEndScreen.jsx # Terminal screen (above router)
│   │   └── BootScreens.jsx    # InvalidQr / TableInUse / SessionClosed
│   ├── components/
│   │   ├── BottomNav.jsx      # Tab bar (hidden when terminal)
│   │   ├── ItemSheet.jsx      # Modifier groups + live price compute
│   │   ├── FoodImage.jsx      # imageUrl with icon/swatch fallback
│   │   ├── DietaryMark.jsx    # Veg/non-veg/jain badge
│   │   ├── Toast.jsx          # Transient notification
│   │   └── KDS.jsx            # Legacy empty stub
│   ├── tenant/
│   │   └── defaultTenant.ts   # Fallback config for no-QR dev mode
│   └── data/
│       └── menu.json          # Legacy static menu — unused
├── vite.config.ts
└── package.json
```

### `apps/restaurant-admin/`
```
apps/restaurant-admin/
├── src/
│   ├── main.tsx               # Entry: TenantThemeProvider + AdminStoreProvider
│   ├── App.tsx                # Routes (shell-wrapped + full-screen)
│   ├── store/
│   │   └── AdminStore.tsx     # API-backed store + SSE subscription
│   ├── pages/
│   │   ├── DashboardPage.tsx  # Today's revenue + live floor summary
│   │   ├── MenuPage.tsx       # Category + item CRUD
│   │   ├── TablesPage.tsx     # Floor view + QR codes
│   │   ├── TableSessionPage.tsx # Live session detail
│   │   ├── BillingPage.tsx    # Cash numpad + payment capture
│   │   ├── PaymentCompletePage.tsx
│   │   ├── OrderHistoryPage.tsx # Date-range sales list
│   │   ├── AnalyticsPage.tsx  # Charts: revenue trend, category donut, etc.
│   │   ├── LoginPage.tsx      # Supabase login
│   │   └── PlanBillingPage.tsx # Subscription info
│   ├── kds/
│   │   ├── KdsPage.tsx        # Board UI (3-column: New/Preparing/Ready)
│   │   ├── KdsColumn.tsx      # One column
│   │   ├── TicketCard.tsx     # Individual ticket card
│   │   ├── useKds.ts          # Board state + order-stream reconciliation
│   │   ├── useTick.ts         # Interval re-render for age timers
│   │   └── kdsClient.ts      # KdsTransport → relay
│   ├── components/
│   │   ├── Shell.tsx          # Sidebar + topbar layout
│   │   ├── ItemPanel.tsx      # Full item editor modal + modifier builder
│   │   ├── BillingLockoutGate.tsx # Block when subscription past_due/canceled
│   │   ├── ImpersonationBanner.tsx # Orange banner for impersonated sessions
│   │   ├── RequireSession.tsx # Route guard → /login
│   │   ├── DietaryMark.tsx
│   │   ├── Icon.tsx           # Material Symbols wrapper
│   │   └── Toggle.tsx
│   ├── lib/
│   │   ├── api.ts             # Singleton ApiClient
│   │   ├── auth.ts            # Impersonation token management
│   │   ├── supabase.ts        # Supabase client + signOut
│   │   ├── money.ts           # money(cents), timeAgo(epochMs)
│   │   └── tableQr.ts        # tableQrUrl(slug, qrToken)
│   ├── data/
│   │   └── types.ts           # Local view-model types (MenuItem, Table, etc.)
│   └── tenant/
│       └── defaultTenant.ts   # amber-grain slug + theme
├── prototype/                 # Static HTML mockups (reference only)
├── DESIGN.md
└── package.json
```

### `apps/super-admin/`
```
apps/super-admin/
├── src/
│   ├── main.tsx               # Entry
│   ├── App.tsx                # Routes (shell-wrapped)
│   ├── api.ts                 # ApiClient (no tenant slug, cross-tenant)
│   ├── pages/
│   │   ├── DashboardPage.tsx  # GMV, MRR, top tenants
│   │   ├── TenantsPage.tsx    # Tenant table + impersonate button
│   │   ├── TenantDetailPage.tsx
│   │   ├── TenantEditPage.tsx
│   │   ├── OnboardingPage.tsx # Create new tenant
│   │   ├── PlansPage.tsx      # Plan catalog CRUD
│   │   ├── SubscriptionsPage.tsx
│   │   ├── AuditLogPage.tsx   # Paginated audit log
│   │   ├── LoginPage.tsx      # Supabase login
│   │   └── SettingsPage.tsx
│   ├── components/
│   │   ├── Shell.tsx
│   │   ├── RequireSession.tsx
│   │   ├── Modal.tsx
│   │   ├── StatusBadge.tsx    # Subscription status chip
│   │   └── Toggle.tsx
│   └── lib/
│       ├── supabase.ts
│       └── tenantStatus.ts    # tenantStatus(active, subscriptionStatus)
├── DESIGN.md
├── SUPER_ADMIN.md
└── package.json
```

### `services/api/`
```
services/api/
├── src/
│   ├── main.ts                # Bootstrap: CORS, 0.0.0.0:3001
│   ├── app.module.ts          # Root module + TenantMiddleware
│   ├── tenant/
│   │   ├── tenant.middleware.ts      # X-Tenant-Slug / ?tenant= → req.tenant
│   │   ├── tenant.controller.ts     # GET /tenant, /tenants/:slug
│   │   ├── tenant.service.ts
│   │   ├── tenant.mapper.ts
│   │   └── current-tenant.decorator.ts
│   ├── menu/
│   │   ├── menu.controller.ts        # GET /menu, CRUD /menu/categories, /menu/items, POST /menu/upload
│   │   ├── menu.service.ts           # Full menu CRUD, replace-on-save for modifiers
│   │   ├── menu.mapper.ts
│   │   └── menu.dto.ts
│   ├── tables/
│   │   ├── tables.controller.ts      # GET /tables, /tables/qr/:token, CRUD
│   │   ├── tables.service.ts         # listFloor, create (mints qrToken), regen, remove
│   │   ├── tables.mapper.ts
│   │   └── tables.dto.ts
│   ├── orders/
│   │   ├── orders.controller.ts      # SSE stream + full order lifecycle
│   │   ├── orders.service.ts         # Core business logic + analytics aggregation
│   │   ├── orders.events.ts          # Per-tenant rxjs Subject (pub/sub)
│   │   ├── orders.mapper.ts
│   │   └── orders.dto.ts
│   ├── admin/
│   │   ├── admin.controller.ts       # /admin/* cross-tenant endpoints
│   │   ├── admin.service.ts          # createTenant, updateTenant, platformAnalytics, auditLog
│   │   └── admin.dto.ts
│   ├── auth/
│   │   ├── auth.controller.ts        # POST /auth/sync-profile
│   │   ├── auth.service.ts           # JWT verify, impersonation, rate-limit
│   │   ├── auth.guard.ts             # AuthGuard (bearer token)
│   │   ├── super-admin.guard.ts      # Guards /admin/*
│   │   ├── current-user.decorator.ts
│   │   ├── current-auth-claims.decorator.ts
│   │   └── auth-request.ts
│   ├── billing/
│   │   ├── billing.controller.ts     # GET /billing/me
│   │   ├── billing.service.ts        # Plans + subscriptions + audit log writes
│   │   ├── billing.mapper.ts
│   │   └── billing.dto.ts
│   ├── storage/
│   │   └── storage.service.ts        # Supabase Storage upload (menu-images bucket)
│   └── prisma/
│       ├── prisma.service.ts         # Extends PrismaClient, global module
│       └── prisma.module.ts
├── prisma/
│   ├── schema.prisma          # Canonical DB schema
│   ├── seed.ts                # Idempotent seed: 3 tenants, full demo data
│   └── seed-super-admin.ts    # Seeds super-admin user
└── package.json
```

### `packages/`
```
packages/
├── domain/src/
│   ├── common.ts       # id, slug, money, timestamp primitives
│   ├── tenant.ts       # Tenant, ThemeConfig, ThemeColors
│   ├── menu.ts         # Menu, MenuItem, ModifierGroup, ModifierOption
│   ├── table.ts        # Table, FloorTable
│   ├── order.ts        # Order, Round, OrderItem — ItemStatus, helpers
│   ├── payment.ts      # Payment, Sale
│   ├── analytics.ts    # AnalyticsSummary and sub-types
│   ├── auth.ts         # AuthUser, Membership, Role, ImpersonationToken
│   ├── billing.ts      # Plan, Subscription, SubscriptionStatus
│   └── index.ts        # Re-exports all
│
├── api-client/src/
│   ├── http.ts         # ApiClientConfig, ApiError, central request() fn
│   ├── index.ts        # createApiClient() — all resource methods
│   ├── kds.ts          # KdsTransport interface + types
│   └── transports/
│       ├── http-kds.ts       # createHttpKdsTransport (→ relay)
│       └── static-kds.ts     # createStaticKdsTransport (tests)
│
├── ui/src/
│   ├── theme/
│   │   ├── tokens.css              # Baseline --ag-* CSS vars (RGB channels)
│   │   ├── TenantThemeProvider.tsx # Runtime brand injection
│   │   └── colors.ts              # hexToRgbChannels, themeColorsToCssVars
│   ├── components/
│   │   ├── Button.tsx
│   │   └── MaterialIcon.tsx
│   └── index.ts
│
└── config/
    ├── tsconfig/
    │   ├── base.json         # strict, ES2022, bundler resolution
    │   ├── react-app.json    # + React JSX transform
    │   ├── react-library.json
    │   └── nest.json         # + decorators, emitDecoratorMetadata
    ├── tailwind/
    │   ├── tokens.cjs        # TOKENS array, buildColors() — maps to --ag-* vars
    │   └── preset.cjs        # Tailwind preset (colors + spacing + fonts)
    └── eslint/
        ├── base.mjs
        └── react.mjs
```

## Data Flow Summary

```
Guest phone  ──scan QR──►  BootContext (parse slug/qrToken)
                                │
                    ┌───────────┴──────────┐
                    │  api.tenant.bySlug   │  api.tables.byQrToken
                    │  api.orders.list     │  api.menu.get  (prefetch)
                    └───────────┬──────────┘
                                │ parallel
                                ▼
                         TenantThemeProvider (brand)
                         SplashScreen (reserve)
                                │
                    api.orders.createForTable
                                │
                    ┌───────────┴──────────────┐
                    │  Round submitted          │
                    │  publishRound → KDS relay │ (legacy)
                    │  addRound → API           │ (persisted)
                    └───────────┬──────────────┘
                                │
                    api.orders.stream (SSE)
                    ◄───────────────────────── OrdersEvents rxjs Subject
                                               (fired on every mutation)
                                │
                    Staff actions via restaurant-admin
                    (AdminStore subscribes to same SSE)
                                │
                    requestBill → capturePayment → Order closed
```

## Prisma Schema Key Relationships

```
Tenant
  ├── User (via Membership, role: owner|manager|server|kitchen)
  ├── Room ──► Table (qrToken UUID)
  ├── MenuCategory ──► MenuItem
  │                        └── ModifierGroup ──► ModifierOption
  ├── MenuPlacement (featured|welcome)
  ├── Order (status: open|billed|paid|closed)
  │     ├── Round (instant|bundled)
  │     │     └── OrderItem (placed→preparing→ready→served|cancelled)
  │     │               └── OrderItemModifier (snapshots group/name/priceDelta)
  │     ├── Payment (cash|card — one per order)
  │     └── Review
  ├── Subscription ──► Plan
  └── AuditLog
```

## API Route Map

```
Tenant-scoped (X-Tenant-Slug or ?tenant=):
  GET  /tenant                     current tenant
  GET  /tenants/:slug              by slug
  GET  /menu                       full menu
  POST /menu/categories
  PATCH/DELETE /menu/categories/:id
  POST /menu/items
  PATCH/DELETE /menu/items/:id
  POST /menu/upload                image upload → Supabase Storage
  GET  /tables                     floor list + live status
  GET  /tables/qr/:token           by QR token
  POST /tables
  PATCH /tables/:id
  POST  /tables/:id/qr             regenerate token
  DELETE /tables/:id
  GET  /orders                     live list (optional ?status=)
  GET  /orders/sales               completed sales (optional ?from=&to=)
  GET  /orders/analytics           aggregated analytics (?from=&to=)
  GET  /orders/stream              SSE event bus
  GET  /orders/:id
  POST /orders                     create (409 if table occupied)
  POST /orders/:id/rounds          add round (modifier validation server-side)
  POST /orders/:id/items           add item
  PATCH /orders/:id/items/:itemId  update qty/status
  POST /orders/:id/bill            request bill
  POST /orders/:id/cancel
  POST /orders/:id/payment         capture payment
  GET  /billing/me                 tenant subscription

Auth (no tenant scope):
  POST /auth/sync-profile

Admin (cross-tenant, SuperAdmin guard):
  GET/POST    /admin/tenants
  PATCH       /admin/tenants/:id
  GET/POST    /admin/plans
  PATCH       /admin/plans/:id
  POST        /admin/tenants/:id/subscription
  PATCH       /admin/tenants/:id/subscription
  GET         /admin/tenants/:id/subscription
  POST        /admin/impersonate
  GET         /admin/analytics
  GET         /admin/audit-log
  GET         /admin/tenants/:id/payments
```

## Tech Decisions & Why

| Decision | Reason |
|---|---|
| Zod in `@amber/domain` | Single schema definition used by API (Nest DTOs), api-client (response validation), and frontend (type inference). One source of truth. |
| Integer cents | Avoids floating-point rounding in billing and tax calculations. |
| CSS vars with RGB channels | Enables Tailwind opacity modifiers (`bg-primary/50`) per-tenant without forking classes. |
| Replace-on-save for modifier groups | Simpler than a diff-patch UI; the ItemPanel always sends the full set. |
| SSE over WebSockets | SSE is a simple HTTP keep-alive; no upgrade or separate WS server needed. Auto-reconnects natively. |
| pgBouncer pooler URL | Keeps connection overhead low on Supabase free tier (~150ms vs ~340ms cold). |
| `DIRECT_URL` separate from `DATABASE_URL` | pgBouncer doesn't support the DDL statements Prisma migrations use; migrations need the direct connection. |
| KDS relay separate from API | Incremental approach — unify on the order stream when the API side is stable. |
