# TableFlow — Project Overview

> Internal codename "Amber" (packages are scoped `@amber/*`; "Amber & Grain" is the
> demo tenant). The product name in all user-facing copy is **TableFlow**.

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
│   ├── api/                   # @amber/api — NestJS + Prisma backend — port 3001
│   └── print-agent/           # @amber/print-agent — local HTTP→thermal-printer bridge, port 9200
├── tools/
│   ├── dev.mjs                # One-command dev orchestrator
│   ├── kds-relay.mjs          # In-memory KDS relay — port 4001
│   └── sync-lan-env.mjs       # Auto-writes LAN IP into .env.local files
├── CLAUDE.md / AGENTS.md      # Deep technical reference (kept as identical copies)
├── README.md                  # Project intro + quick start
├── docs/
│   ├── PROJECT.md             # This file
│   └── apps/                  # Per-app write-ups (customer / restaurant-admin / super-admin)
└── api-reference/             # BRAIN.md (compact cheatsheet), API-ENDPOINTS.md,
                               # FEATURES.md, MODIFIERS.md, PLATFORM_PLAN.md,
                               # PENDING_TASKS.md, CHANGES.md, PRINT_RECEIPT_PLAN.md,
                               # REALTIME-SYNC-PLAN.md, security reviews/audits
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
│   │   ├── SessionContext.jsx # Full guest session lifecycle + sendServiceRequest()
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
│   │   ├── TablesPage.tsx     # Floor view + QR codes + service-request badges
│   │   ├── TableSessionPage.tsx # Live session detail
│   │   ├── QuickSalePage.tsx  # Walk-in counter sale (virtual "Counter" table)
│   │   ├── BillingPage.tsx    # Cash numpad + payment capture + loyalty redeem
│   │   ├── BillingQueuePage.tsx # /billing — floor-wide sessions awaiting payment
│   │   ├── PaymentCompletePage.tsx # Receipt build + print (buildReceipt → print agent)
│   │   ├── OrderHistoryPage.tsx # Date-range sales list + .xlsx export
│   │   ├── AnalyticsPage.tsx  # Charts: revenue trend, category donut, etc.
│   │   ├── LoyaltyPage.tsx    # /loyalty — customer points directory + adjust
│   │   ├── LoginPage.tsx      # Email+password JWT login (+ tenant picker)
│   │   ├── ChangePasswordPage.tsx
│   │   ├── SettingsPage.tsx   # /settings card landing
│   │   ├── TeamPage.tsx       # /settings/team — members + per-user overrides
│   │   ├── RolesPage.tsx      # /settings/roles — custom-role CRUD
│   │   ├── BrandingPage.tsx   # /settings/branding — theme editor + live preview
│   │   ├── RestaurantProfilePage.tsx # /settings/profile — name/currency/tax/GST/FSSAI/address/phone
│   │   ├── PaymentsPage.tsx   # /settings/payments — UPI id/mobile for the bill QR
│   │   ├── PrinterPage.tsx    # /settings/printer — agent config + receipt layout + live preview
│   │   ├── LoyaltySettingsPage.tsx # /settings/loyalty — loyalty program config
│   │   └── PlanBillingPage.tsx # /settings/billing — subscription info (read-only)
│   ├── kds/
│   │   ├── KdsPage.tsx        # Board UI (3-column: New/Preparing/Ready)
│   │   ├── KdsColumn.tsx      # One column
│   │   ├── TicketCard.tsx     # Individual ticket card
│   │   ├── useKds.ts          # Board state + order-stream reconciliation
│   │   ├── useTick.ts         # Interval re-render for age timers
│   │   └── kdsClient.ts      # KdsTransport → relay
│   ├── notifications/
│   │   ├── useServiceRequests.tsx  # ServiceRequestsProvider — live bell state, mute toggle
│   │   └── sound.ts                # Synthesized notification chime (Web Audio API)
│   ├── components/
│   │   ├── Shell.tsx          # Sidebar + topbar layout + NotificationBell
│   │   ├── ItemPanel.tsx      # Full item editor modal + modifier builder
│   │   ├── RequirePermission.tsx # Route guard: anon → /login, lacking perm → homeRouteFor()
│   │   ├── DietaryMark.tsx
│   │   ├── Icon.tsx           # Material Symbols wrapper
│   │   └── Toggle.tsx
│   │   # ⚠️ BillingLockoutGate.tsx / ImpersonationBanner.tsx still exist but are
│   │   #   dead code (pre-RBAC leftovers) — not imported/rendered anywhere.
│   ├── context/
│   │   └── AuthContext.tsx    # JWT session (login/selectTenant/logout), can(permission)
│   ├── lib/
│   │   ├── api.ts             # Singleton ApiClient (getToken + getTenantSlug hooks)
│   │   ├── auth-token.ts      # Bearer token in localStorage
│   │   ├── auth-tenant.ts     # Logged-in tenant slug in localStorage
│   │   ├── nav.ts             # NAV_ITEMS + homeRouteFor(permissions)
│   │   ├── money.ts           # money(cents), timeAgo(epochMs)
│   │   └── tableQr.ts        # tableQrUrl(slug, qrToken)
│   │   # ⚠️ auth.ts / supabase.ts do not exist here — this app has no Supabase
│   │   #   dependency (see docs/apps/restaurant-admin.md § Authentication).
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
│   │   ├── tenant.controller.ts     # GET /tenant, PATCH /tenant (settings.manage), /tenants/:slug
│   │   ├── tenant.service.ts
│   │   ├── tenant.mapper.ts
│   │   ├── tenant.dto.ts             # updateTenantRequestSchema passthrough
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
│   │   ├── orders.controller.ts      # SSE stream + full order lifecycle + loyalty redeem
│   │   ├── orders.service.ts         # Core business logic + analytics aggregation
│   │   ├── orders.events.ts          # Per-tenant rxjs Subject (pub/sub)
│   │   ├── orders.export.ts          # GET /orders/export — .xlsx sales report
│   │   ├── order-stream.guard.ts     # SSE auth: ?token= (staff) / ?deviceId= (guest)
│   │   ├── orders.mapper.ts
│   │   └── orders.dto.ts
│   ├── service-requests/             # Guest "water/call staff/call manager" — NOT an Order
│   │   ├── service-requests.controller.ts  # SSE stream + create/list/updateStatus
│   │   ├── service-requests.service.ts     # Dedupe (1 pending per table+type) + status stamps
│   │   ├── service-requests.events.ts      # Per-tenant rxjs Subject (mirrors orders.events.ts)
│   │   ├── service-request-stream.guard.ts # SSE auth (mirrors order-stream.guard.ts)
│   │   ├── service-requests.mapper.ts
│   │   └── service-requests.dto.ts
│   ├── loyalty/                      # Staff-only points accounts — loyalty.manage-gated
│   │   ├── loyalty.controller.ts     # GET /loyalty/accounts(?search=), GET /:id, PATCH /:id/adjust
│   │   ├── loyalty.service.ts        # Account+ledger reads, manual adjust (earn/redeem live in OrdersService)
│   │   ├── loyalty.mapper.ts
│   │   └── loyalty.dto.ts
│   ├── admin/
│   │   ├── admin.controller.ts       # /admin/* cross-tenant endpoints
│   │   ├── admin.service.ts          # createTenant, updateTenant, platformAnalytics, auditLog
│   │   └── admin.dto.ts
│   ├── auth/                         # TWO parallel auth mechanisms — see docs/apps/restaurant-admin.md
│   │   ├── auth.controller.ts        # POST /auth/login, /auth/select-tenant, GET /auth/me,
│   │   │                             #   POST /auth/change-password (all JWT), POST /auth/sync-profile (Supabase)
│   │   ├── auth.service.ts           # bcrypt login, tenant-select tickets, JWT issue/verify, Supabase sync
│   │   ├── jwt-auth.guard.ts         # JwtAuthGuard — restaurant-admin staff (email+password → JWT)
│   │   ├── permissions.guard.ts      # PermissionsGuard + @RequirePermission() decorator (RBAC)
│   │   ├── auth.guard.ts             # SupabaseAuthGuard — super-admin platform ops only
│   │   ├── super-admin.guard.ts      # Guards /admin/* (Supabase + isSuperAdmin)
│   │   ├── current-user.decorator.ts # @CurrentUser() → AuthUser (JWT path)
│   │   ├── current-auth-claims.decorator.ts
│   │   ├── auth.dto.ts               # LoginDto, SelectTenantDto, ChangePasswordDto
│   │   └── auth-request.ts
│   ├── roles/                        # Custom per-tenant roles (RBAC) — team.manage-only
│   │   ├── roles.controller.ts       # GET/POST/PATCH/DELETE /roles
│   │   ├── roles.service.ts          # Protected-role + last-admin-lockout guards
│   │   └── roles.dto.ts
│   ├── members/                      # Team management (RBAC) — team.manage-only
│   │   ├── members.controller.ts     # GET/POST/PATCH/DELETE /members
│   │   ├── members.service.ts        # Add/role-change/permission-override, Admin-tier guard
│   │   └── members.dto.ts
│   ├── billing/
│   │   ├── billing.controller.ts     # GET /billing/me
│   │   ├── billing.service.ts        # Plans + subscriptions + audit log writes
│   │   ├── billing.mapper.ts
│   │   └── billing.dto.ts
│   ├── storage/
│   │   └── storage.service.ts        # Supabase Storage upload (menu-images bucket)
│   ├── health/
│   │   └── health.controller.ts      # GET /health — liveness probe
│   ├── common/
│   │   ├── http-exception.filter.ts
│   │   ├── ttl-cache.ts
│   │   └── timing-safe-equal.ts
│   └── prisma/
│       ├── prisma.service.ts         # Extends PrismaClient, global module
│       └── prisma.module.ts
├── prisma/
│   ├── schema.prisma          # Canonical DB schema
│   ├── seed.ts                # Idempotent seed: 3 tenants, full demo data
│   └── seed-super-admin.ts    # Seeds super-admin user
└── package.json
```

### `services/print-agent/`
```
services/print-agent/
├── src/
│   ├── index.ts                # Express bootstrap — port 9200, open CORS, GET /health (no auth)
│   ├── auth.ts                 # requireAgentSecret — 401s /print* when AGENT_SECRET is set
│   ├── handlePrint.ts          # Shared ESC/POS execute step (connect → render → send)
│   ├── routes/
│   │   ├── print.ts            # POST /print (receipt), POST /print/test — branch on shouldUseTspl
│   │   └── kot.ts              # POST /print/kot (kitchen ticket) — same TSPL/ESC-POS branch
│   └── printer/
│       ├── connect.ts          # PrinterSettings → node-thermal-printer interface string
│       ├── render.ts           # Receipt → node-thermal-printer draw calls (ESC/POS)
│       ├── renderKot.ts        # Kot → node-thermal-printer draw calls (ESC/POS)
│       ├── renderTspl.ts       # Receipt/Kot/test → raw TSPL buffer (TEXT/QRCODE/BITMAP;
│       │                       #   logo → 1-bit bitmap via pngjs; TSC DA310 etc.)
│       ├── rawPrint.ts         # Raw bytes out: network TCP :9100, or the OS queue
│       └── osPrintDriver.ts    # OS queue write — Windows winspool RAW (no printer
│                               #   sharing needed; queue matched by Name OR ShareName),
│                               #   macOS/Linux `lp -d <name> -o raw`
├── README.md                    # Install/run instructions, incl. setting AGENT_SECRET
└── package.json
```
Standalone local service — NOT deployed with the cloud API; it runs on-site (the
same PC as the browser, or another device near the printer) per restaurant. Text
layout (columns, wrapping, amount formatting) comes from `@amber/domain`'s
`print-format.ts`, shared with the admin's live preview. See
`api-reference/PRINT_RECEIPT_PLAN.md` for the architecture and CLAUDE.md flow 9
for the end-to-end path.

### `packages/`
```
packages/
├── domain/src/
│   ├── common.ts       # id, slug, money, timestamp primitives
│   ├── tenant.ts       # Tenant (+ statutory/UPI fields, printer/loyalty blobs), ThemeConfig
│   ├── menu.ts         # Menu, MenuItem, ModifierGroup, ModifierOption
│   ├── table.ts        # Table, FloorTable
│   ├── order.ts        # Order, Round, OrderItem — ItemStatus, helpers
│   ├── service-request.ts  # ServiceRequest, SERVICE_REQUEST_META (icon/label per type)
│   ├── payment.ts      # Payment, Sale
│   ├── analytics.ts    # AnalyticsSummary and sub-types
│   ├── auth.ts         # AuthUser, LoginResult (+ user.ts, role.ts)
│   ├── permission.ts   # PERMISSIONS fixed 9-key catalog + PERMISSION_LABELS + hasPermission
│   ├── loyalty.ts      # LoyaltyProgram, LoyaltyAccount, LoyaltyTransaction + earn/redeem math
│   ├── billing.ts      # Plan, Subscription, SubscriptionStatus
│   ├── printer.ts      # PrinterSettings, PAPER_WIDTH_PRESETS, mergeReceiptSections
│   ├── receipt.ts      # Receipt (tenant identity + guest contact + lines/totals/UPI)
│   ├── kot.ts          # Kot (kitchen ticket — no prices)
│   ├── print-format.ts # Shared text-layout engine (agent renderers + admin preview)
│   └── index.ts        # Re-exports all
├── domain/test/        # Vitest unit tests (money, loyalty, order, print-format)
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
Tenant  (theme / printer / kitchenPrinter / loyalty as JSON;
         statutory bill fields gstNumber/fssaiNumber/address/phone; UPI upiId/upiMobile)
  ├── Role (per-tenant, NOT a fixed enum — Admin-named, {name, permissions[], protected})
  │     └── Membership ──► User (roleId + optional per-user permissions[] override)
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
  ├── ServiceRequest (type: water|call_staff|call_manager; status: pending|acknowledged|resolved)
  │     └── optional orderId link to the table's live Order (best-effort, not required)
  ├── LoyaltyAccount (keyed tenant+phone)
  │     └── LoyaltyTransaction (earn/redeem/adjust ledger, optional orderId)
  ├── Subscription ──► Plan
  └── AuditLog
```

## API Route Map

```
Tenant-scoped (X-Tenant-Slug or ?tenant=):
  GET  /tenant                     current tenant
  PATCH /tenant                    update own settings (settings.manage) — profile/theme/UPI/printer/loyalty
  GET  /tenants/:slug              by slug
  GET  /menu                       full menu
  POST /menu/categories
  PATCH/DELETE /menu/categories/:id
  POST /menu/items
  PATCH/DELETE /menu/items/:id
  POST /menu/upload                image upload → Supabase Storage
  GET  /tables                     floor list + live status
  GET  /tables/qr/:token           by QR token
  GET  /tables/counter             find-or-create the virtual "Counter Sale" table (quick sale)
  POST /tables
  PATCH /tables/:id
  POST  /tables/:id/qr             regenerate token
  DELETE /tables/:id
  GET  /orders                     live list (optional ?status=) — staff (tables.manage)
  GET  /orders/open-table-ids      lean occupancy check for guest boot (public)
  GET  /orders/sales               completed sales (optional ?from=&to=) — orders.history
  GET  /orders/analytics           aggregated analytics (?from=&to=) — analytics.view|dashboard.view
  GET  /orders/export              .xlsx sales report (?from=&to=) — orders.history|analytics.view
  GET  /orders/stream              SSE event bus (?token= staff / ?deviceId= guest)
  GET  /orders/:id                 guest (device-bound) or staff (token)
  GET  /orders/:id/payment         captured Payment for an order, or null (receipt reprints)
  POST /orders                     create (409 if table occupied)
  POST /orders/reclaim             re-bind an open session to a new device (phone-number proof)
  POST /orders/:id/rounds          add round (modifier validation server-side)
  POST /orders/:id/items           add item — staff only
  PATCH /orders/:id/items/:itemId  update qty/status (409 if order closed/paid)
  POST /orders/:id/bill            request bill (guest, device-bound)
  POST /orders/:id/cancel          staff only (tables.manage)
  POST /orders/:id/payment         capture payment (guest card / staff cash)
  POST /orders/:id/loyalty/redeem  apply/clear a points redemption pre-capture (loyalty.manage)
  GET  /loyalty/accounts           search points accounts (loyalty.manage)
  GET  /loyalty/accounts/:id       account + transaction ledger + order summaries
  PATCH /loyalty/accounts/:id/adjust  manual points adjustment
  POST /service-requests           guest creates (water/call staff/call manager); dedupes pending
  GET  /service-requests           staff list (tables.manage), optional ?status=
  PATCH /service-requests/:id      staff acknowledge/resolve (tables.manage)
  GET  /service-requests/stream    SSE event bus (separate from /orders/stream)
  GET  /billing/me                 tenant subscription
  GET/POST/PATCH/DELETE /roles     custom-role CRUD (JwtAuthGuard + team.manage)
  GET/POST/PATCH/DELETE /members   team management (JwtAuthGuard + team.manage)

Auth (email-first login, NOT tenant-scoped — excluded from TenantMiddleware):
  POST /auth/login                 bcrypt by email → JWT (or a tenant-picker ticket)
  POST /auth/select-tenant         redeem ticket → JWT (step 2 of a multi-tenant login)
  GET  /auth/me                    JwtAuthGuard — current AuthUser from the token
  POST /auth/change-password       JwtAuthGuard — self-service password change
  POST /auth/sync-profile          SupabaseAuthGuard — super-admin first-login bootstrap only

Admin (cross-tenant, SuperAdmin guard):
  GET/POST    /admin/tenants
  GET/PATCH   /admin/tenants/:id
  GET/POST    /admin/plans
  PATCH       /admin/plans/:id
  POST        /admin/tenants/:id/subscription
  PATCH       /admin/tenants/:id/subscription
  GET         /admin/tenants/:id/subscription
  GET         /admin/tenants/:id/payments
  POST        /admin/tenants/:id/reset-owner-password
  GET         /admin/credentials
  POST        /admin/impersonate
  GET         /admin/analytics
  GET         /admin/audit-log
  GET         /admin/loyalty/accounts
  GET         /admin/loyalty/accounts/:id

Unscoped:
  GET  /health                     liveness probe
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
