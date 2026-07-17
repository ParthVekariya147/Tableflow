# Amber & Grain — Brain File
> Ultra-compact cheatsheet. Read this first. See `docs/` for deep-dives.

## What this is
Multi-tenant restaurant ordering platform. One codebase, many branded tenants. Each tenant = a row in `tenants` table; theme/config loaded at runtime via CSS vars.

## Stack
- **Monorepo:** pnpm 9 + Turborepo 2, TypeScript everywhere
- **Frontend:** Vite + React 19 (apps), `@amber/ui` (theme engine), `@amber/api-client` (typed HTTP client)
- **Backend:** NestJS 10 + Prisma 6 + PostgreSQL (Supabase)
- **Validation:** Zod in `@amber/domain` (shared contract for API + clients)
- **Realtime:** SSE (`GET /orders/stream`, `GET /service-requests/stream`) via rxjs `Subject` per tenant
- **Auth:** two separate systems. restaurant-admin = email+password → JWT + custom per-tenant RBAC roles (`auth/`, `roles/`, `members/` modules). super-admin (platform) = Supabase session + impersonation. Staff routes are `@RequirePermission(...)`-gated server-side (`menu/`, `tables/`, `orders/`, `tenant/`, `loyalty/`, `billing/`, staff side of `service-requests/`); guest routes stay unauthenticated by design (device-id bound); global per-IP throttle (120 req/60s).

## Packages (internal `@amber/*`)
| Package | Path | Role |
|---|---|---|
| `@amber/domain` | `packages/domain/src/` | Zod schemas + TS types — the contract |
| `@amber/api-client` | `packages/api-client/src/` | One typed client for all apps |
| `@amber/ui` | `packages/ui/src/` | `TenantThemeProvider` + CSS token engine |
| `@amber/config` | `packages/config/` | Tailwind preset, tsconfig bases, ESLint |

## Apps
| App | Port | Entry | Docs |
|---|---|---|---|
| Customer PWA | 5173 | `apps/customer/src/App.jsx` | `docs/apps/customer.md` |
| Restaurant Admin | 5174 | `apps/restaurant-admin/src/App.tsx` | `docs/apps/restaurant-admin.md` |
| Super Admin | 5175 | `apps/super-admin/src/App.tsx` | `docs/apps/super-admin.md` |
| API | 3001 | `services/api/src/main.ts` | `docs/PROJECT.md` |
| KDS Relay | 4001 | `tools/kds-relay.mjs` | (in-memory, dev-only) |
| Print Agent | 9200 | `services/print-agent/src/index.ts` | `services/print-agent/README.md` |

## Commands
```bash
pnpm install                    # install workspace
pnpm dev                        # start all (via tools/dev.mjs)
pnpm build / lint / typecheck / test   # fan out via Turbo (Vitest tests in packages/domain/test/)
pnpm db:generate                # prisma generate (required after schema change)
pnpm db:migrate                 # prisma db push
pnpm db:seed                    # seed 3 tenants (idempotent)
pnpm --filter @amber/customer dev   # per-app
```

## Key Architecture Patterns

**Multi-tenancy:** `TenantMiddleware` reads `X-Tenant-Slug` header (or `?tenant=` for SSE EventSource). Every service method scopes by `tenant.id`. Theming = `TenantThemeProvider` converts `tenant.theme.colors` hex → `--ag-*` CSS vars at runtime.

**Money:** Integer cents (minor units) everywhere in domain + API. Legacy customer screens still use float dollars — reconcile on migration.

**Realtime SSE flow:**
1. Any order mutation → `refreshAndEmit` in `orders.service.ts`
2. `OrdersEvents` (rxjs Subject, per tenant) broadcasts `{ type, orderId, order }`
3. `GET /orders/stream` streams to subscribers; prefixes with `snapshot`
4. `api.orders.stream(handler)` in api-client opens EventSource
5. Admin + Customer subscribe; KDS board is still on a separate relay

**Guest service requests (water / call staff / call manager):** a parallel,
lightweight SSE channel — deliberately NOT an Order/Round/OrderItem, so it
never touches the kitchen. `ServiceRequest` (`packages/domain/src/
service-request.ts`) → `services/api/src/service-requests/` (same
controller/service/events/mapper shape as `orders/`) → `GET
/service-requests/stream`. Guest taps a Quick Action on `WelcomeScreen.jsx` →
`api.serviceRequests.create({tableId, type})` (server dedupes: one `pending`
request per table+type). Admin's `notifications/useServiceRequests.tsx`
subscribes and drives: a live badge/dropdown on `Shell.tsx`'s bell (with a
synthesized chime + mute toggle, `notifications/sound.ts`), AND a pulsing
badge directly on the matching table's card in `TablesPage.tsx` — so staff see
it on the floor grid, not just the bell.

**KDS Seam:** `KdsTransport` interface in `packages/api-client/src/kds.ts` decouples the board UI from data source. Today = `tools/kds-relay.mjs` (in-memory). Swap → change one line in `apps/restaurant-admin/src/kds/kdsClient.ts`.

**Device binding:** Guest sends `X-Device-Id` (minted via `crypto.getRandomValues` in `apps/customer/src/device.js`). Stored on `Order.deviceId`. `assertDevice()` in `orders.service.ts` 403s mismatched devices. Never returned to clients.

**Session persistence:** `apps/customer/src/session-store.js` — persists `{slug, qrToken, tableId, orderId}` in localStorage. Resume on refresh via `BootContext`. Terminal = `{ended:true}` → locked to `SessionClosed` screen.

## Key Files Quick Reference

### API (`services/api/src/`)
- `app.module.ts` — root imports + middleware
- `orders/orders.service.ts` — core business logic, all order mutations
- `orders/orders.events.ts` — per-tenant rxjs pub/sub
- `orders/orders.controller.ts` — SSE stream endpoint
- `service-requests/service-requests.service.ts` — guest service requests (water/call staff/call manager), dedupe + SSE, decoupled from orders
- `admin/admin.service.ts` — platform analytics + tenant mgmt
- `auth/auth.service.ts` — JWT verify, impersonation, rate-limit
- `billing/billing.service.ts` — plans + subscriptions
- `prisma/schema.prisma` — source of truth for DB shape

### Domain (`packages/domain/src/`)
- `order.ts` — Order, Round, OrderItem, ItemStatus, helpers
- `service-request.ts` — ServiceRequest, SERVICE_REQUEST_META (icon/label per type)
- `menu.ts` — MenuItem, ModifierGroup, ModifierOption
- `billing.ts` — Plan, Subscription, SubscriptionStatus
- `auth.ts` — AuthUser, Membership, Role, ImpersonationToken
- `permission.ts` — PERMISSIONS (fixed 9-key catalog incl. loyalty.manage) + hasPermission
- `loyalty.ts` — LoyaltyProgram, LoyaltyAccount, LoyaltyTransaction + earn/redeem math
- `printer.ts` / `receipt.ts` / `kot.ts` — printing contract (PrinterSettings, Receipt, Kot)
- `print-format.ts` — shared text-layout engine (print agent renderers + admin live preview)
- `analytics.ts` — AnalyticsSummary shape

### Admin (`apps/restaurant-admin/src/`)
- `store/AdminStore.tsx` — central API-backed store + SSE subscription
- `context/AuthContext.tsx` — JWT session (login/selectTenant/logout), `can(permission)`
- `lib/auth-token.ts` / `lib/auth-tenant.ts` — persisted bearer token / tenant slug
- `components/RequirePermission.tsx` — route guard (anon → `/login`; no perm → `homeRouteFor()`)
- `kds/useKds.ts` — board state + order-stream reconciliation
- `notifications/useServiceRequests.tsx` — service-request stream, mute-able chime
- `notifications/sound.ts` — synthesized notification chime (Web Audio API)

### Customer (`apps/customer/src/`)
- `context/BootContext.jsx` — QR parse + tenant/table/occupancy resolution
- `context/SessionContext.jsx` — full guest session lifecycle
- `context/MenuContext.jsx` — menu loading from boot prefetch

## Known Gaps / Deferred
- **KDS unification:** KDS relay (`tools/kds-relay.mjs`) is separate from the order SSE stream. Folding KDS onto the API stream = next major step.
- **KOT printing:** agent-side ready (`POST /print/kot`, `Tenant.kitchenPrinter`) but no admin caller sends KOTs yet.
- **Category reorder:** Edit/delete done. Reorder endpoint not yet built.
- **Menu placements:** Schema exists (`MenuPlacement`), API not wired.
- **SPA host fallback:** Deep QR links need server fallback for direct hits.
- (Fixed since earlier revisions: staff data routes are now `@RequirePermission`-gated server-side, and a global per-IP throttler covers order creation.)

## Env vars required
```
services/api/.env:
  DATABASE_URL        # Supabase pooler URL
  DIRECT_URL          # Supabase direct URL (for migrations)
  SUPABASE_URL        # for storage
  SUPABASE_SERVICE_ROLE_KEY
  JWT_SECRET          # for impersonation tokens
  MASTER_PASSWORD     # super-admin impersonation gate

apps/restaurant-admin/.env:
  VITE_API_URL        # default :3001
  VITE_KDS_URL        # default :4001
  VITE_CUSTOMER_URL   # default :5173 (baked into QR codes)

# LAN testing — machine-specific, git-ignored:
# each app's .env.local overrides VITE_*_URL with LAN IP
# tools/sync-lan-env.mjs auto-writes these
```

## Prisma DB Connection
Two URLs required: `DATABASE_URL` = pooler (pgBouncer, for runtime), `DIRECT_URL` = direct (for `db push`/migrations). If DB password contains `@`, percent-encode it as `%40`.
