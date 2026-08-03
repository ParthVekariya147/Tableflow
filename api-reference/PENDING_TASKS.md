# Pending Tasks — Auth, Tenant Management & Subscriptions

> Working checklist mirroring `PLATFORM_PLAN.md`'s phase plan. Update
> checkboxes as items land; re-verify against the actual code before trusting
> a ✅ if this drifts. Last refreshed: 2026-07-16.
>
> ⚠️ **Track D below is historical.** Restaurant-admin has since moved OFF the
> Supabase-session flow it describes to email+password → JWT with custom
> per-tenant RBAC roles (`auth/`, `roles/`, `members/`; see
> `docs/apps/restaurant-admin.md`). Its Supabase artifacts (`lib/auth.ts`,
> `ImpersonationBanner`, `BillingLockoutGate`, `PlanBillingPage`) are now
> unrouted dead code. Supabase auth remains only for the super-admin platform
> panel (Track C).

## Phase 0 — Contracts & Schema
✅ **Done.**
- [x] `services/api/prisma/schema.prisma`: `User.supabaseId` (unique, no more
      `passwordHash`), `Plan`, `Subscription`, `ImpersonationLog` models all
      present.
- [x] `packages/domain/src/auth.ts` — `AuthUser`, `ImpersonationToken`,
      `impersonateSchema`, `impersonationLogSchema`.
- [x] `packages/domain/src/billing.ts` — `Plan`, `Subscription`,
      `SubscriptionWithPlan`, `TenantWithSubscription`, plan/subscription DTOs.
- [ ] Confirm `pnpm db:generate` + `npx prisma db push` (against `DIRECT_URL`)
      has actually run against the real Supabase DB, then commit the schema
      diff — it's still sitting as an uncommitted working-tree change.

## Phase 1 — Backend

### Track A — Auth backend (`services/api/src/auth/`)
✅ **Done.**
- [x] `AuthGuard` — verifies a Supabase session JWT (HS256 or JWKS/ES256/RS256,
      auto-detected from the token header) **or** our own impersonation JWT
      (`JWT_SECRET`), picked by peeking at the unverified payload's `impersonated`
      claim (`auth.guard.ts`).
- [x] `SuperAdminGuard` — requires `user.isSuperAdmin`; explicitly rejects
      impersonation tokens so impersonating a tenant can never escalate into
      admin-panel access (`super-admin.guard.ts`).
- [x] `@CurrentUser()` / `@CurrentAuthClaims()` decorators.
- [x] `POST /auth/sync-profile` — upserts the Prisma `User` row from verified
      Supabase claims (`auth.controller.ts` / `auth.service.ts`).
- [x] `POST /admin/impersonate { tenantSlug, masterPassword }` —
      `AdminController.impersonate` checks `PLATFORM_MASTER_PASSWORD`, mints a
      30m (`JWT_EXPIRES_IN`) impersonation JWT, writes an `ImpersonationLog`
      row (`auth.service.ts` `impersonate()`).
- [x] `/admin/*` and `/admin/plans`, `/admin/tenants/:id/subscription` all now
      carry `@UseGuards(AuthGuard, SuperAdminGuard)`.
- [x] `GET /billing/me` now carries `@UseGuards(AuthGuard)` (tenant-scoped,
      requires a valid Supabase or impersonation token). The `BillingLockoutGate`
      sends `getAuthToken()` so it keeps working in both normal and impersonation
      sessions; unauthenticated callers get 401 which the gate handles gracefully.
- [x] `services/api/.env.example` has `SUPABASE_JWT_SECRET`, `JWT_SECRET`,
      `JWT_EXPIRES_IN`, `PLATFORM_MASTER_PASSWORD`,
      `SUPER_ADMIN_SEED_EMAIL`/`SUPER_ADMIN_SEED_PASSWORD`.
- [x] `prisma/seed.ts` creates a real super-admin via the Supabase Admin API
      when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPER_ADMIN_SEED_PASSWORD`
      are set, falling back to a placeholder (can't log in) otherwise.
- [ ] One-time **manual** Supabase dashboard setup: enable the Google
      provider, register OAuth redirect URLs for both super-admin and
      restaurant-admin origins. Not code — just needs doing once per
      environment.

### Track B — Subscription backend (`services/api/src/billing/`)
✅ **Done.**
- [x] `GET/POST /admin/plans`, `PATCH /admin/plans/:id`, `POST/PATCH/GET
      /admin/tenants/:id/subscription`, `GET /billing/me` (tenant-scoped read,
      now guarded with `AuthGuard`).
- [x] `PATCH /admin/tenants/:id` (full edit) + `GET /admin/tenants` returning
      `TenantWithSubscription[]` (joined, no N+1).
- [x] All `/admin/*` writes now guarded (see Track A above).

## Phase 2 — Frontend

### Track C — Super-admin panel (`apps/super-admin/`)
✅ **Done.**
- [x] `react-router` shell: `LoginPage`, `Shell` (sidebar: Dashboard, Tenants,
      Plans, Subscriptions, Audit log, Settings), `RequireSession` guard
      (redirects to `/login` with no Supabase session; calls `syncProfile` when
      a session is detected, covering Google OAuth redirects).
- [x] Routes: `/login`, `/` (`DashboardPage`), `/tenants` (`TenantsPage`),
      `/tenants/:id` (`TenantDetailPage`), `/tenants/:id/edit` (`TenantEditPage`),
      `/onboarding` (`OnboardingPage`), `/plans` (`PlansPage`),
      `/subscriptions` (`SubscriptionsPage`), `/audit-log` (`AuditLogPage`),
      `/settings` (`SettingsPage`).
- [x] `src/lib/supabase.ts` — Supabase client, cached access-token getter
      (`getCachedAccessToken`, refreshed via `onAuthStateChange`),
      `signInWithPassword`/`signInWithGoogle`/`signOut`.
- [x] `src/api.ts` reads `getCachedAccessToken` for `getToken`.
- [x] `LoginPage` — email/password + Google OAuth; calls `api.auth.syncProfile()`
      after `signInWithPassword` to ensure the Prisma `User` row exists.
- [x] `RequireSession` — calls `api.auth.syncProfile()` when a session is
      detected (covers Google OAuth callback round-trip + tab refresh).
- [x] `TenantsPage` — live tenant+plan+status table, search/filter, Impersonate
      action (prompts master password → calls `api.admin.impersonate` → opens
      `VITE_RESTAURANT_ADMIN_URL?impersonationToken=…` in a new tab), inline
      active/suspend toggle.
- [x] `TenantDetailPage` — full detail view: subscription card + plan limits,
      Change Plan modal (radio-picker → `api.admin.setSubscription`), Impersonate
      button, Suspend/Reactivate flow.
- [x] `TenantEditPage` — business info form (name, currency, tax rate, active
      toggle) + theme color pickers → `api.admin.updateTenant`.
- [x] `OnboardingPage` — 4-step wizard (Business info → Theme → Plan → Review)
      → `api.admin.createTenant` + `api.admin.setSubscription`.
- [x] `PlansPage` — live plan cards + create/edit modal (name, price, interval,
      limits, active flag) → `api.admin.createPlan`/`updatePlan`.
- [x] `SubscriptionsPage` — billing-focused table with inline active toggle.
- [x] `DashboardPage` — live KPI cards (MRR, active tenants, churn, total)
      computed from `listTenants()` join; honest empty states for revenue trend
      and activity feed (need a `/admin/analytics` endpoint first).
- [x] `AuditLogPage` — honest empty state (no `GET /admin/audit-log` endpoint yet).
- [x] `SettingsPage` — real profile card (`api.auth.syncProfile()`), read-only
      policy panel.
- [x] Super-admin design system (`DESIGN.md`, warm cream/terracotta palette,
      `Modal`, `StatusBadge`, `Toggle` components).
- [x] `@amber/api-client` `admin` resource covers all Track C needs.

### Track D — Restaurant-admin integration (`apps/restaurant-admin/`)
✅ **Done.**
- [x] `@supabase/supabase-js` added to `package.json`.
- [x] `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `.env.example`.
- [x] `src/lib/supabase.ts` — browser client + cached access-token getter,
      mirrors super-admin's.
- [x] `src/lib/auth.ts` — impersonation token capture from URL (`?impersonationToken=`
      on boot → stored in `localStorage`, cleaned from URL via `history.replaceState`),
      `isImpersonating()`, `clearImpersonation()`, `getAuthToken()` (impersonation
      takes precedence over Supabase session), `getActiveTenantSlug()` (decoded
      from impersonation token when active).
- [x] `src/lib/api.ts` — uses `getActiveTenantSlug()` + `getAuthToken()` so
      both normal sessions and impersonation sessions are transparently handled.
- [x] `src/pages/LoginPage.tsx` — `signInWithPassword` + Google OAuth +
      `api.auth.syncProfile()` + navigate on success.
- [x] `src/components/RequireSession.tsx` — passes if a valid Supabase session
      OR a live impersonation token is present; calls `api.auth.syncProfile()`
      on session detected; redirects to `/login` otherwise.
- [x] `src/pages/PlanBillingPage.tsx` — read-only Plan & Billing page at
      `/settings/billing` → `api.billing.me()`; shows plan name, price, interval,
      renewal date, limits, cancel-at-period-end notice.
- [x] `src/components/BillingLockoutGate.tsx` — wraps all Shell content; blocks
      behind a full-screen notice when subscription status is `past_due` or
      `canceled`; `/settings/billing` stays reachable so staff can see why.
- [x] `src/components/ImpersonationBanner.tsx` — fixed strip at the top when
      `isImpersonating()` is true: "Viewing as platform support — `<tenantSlug>`".
- [x] `src/components/Shell.tsx` — integrates `ImpersonationBanner` +
      `BillingLockoutGate`; logout calls `clearImpersonation()` + `supabase.auth.signOut()`.
- [x] `/settings/billing` route wired in `App.tsx`.

## Phase 3 — Integration & hardening
🔄 **In progress.**

### Completed
- [x] `GET /admin/analytics` — platform GMV, MRR, revenue trend (30-day daily
      series), top-5 tenants by all-time GMV, payment-method split, active
      subscription count. (`admin.service.ts` `getPlatformAnalytics()`)
- [x] `GET /admin/audit-log?limit=&offset=` — structured audit feed, newest
      first, with actor+tenant joins. Paginated. (`admin.service.ts` `getAuditLog()`)
- [x] `GET /admin/tenants/:id/payments` — last 50 order payments for a tenant
      with table label, guest name, method, and amounts.
- [x] `AuditLog` Prisma model + `AuditEventType` enum added to schema. Back-refs
      on `User` and `Tenant` with SetNull on delete (audit row survives deletion).
      ⚠️ **Run `npx prisma db push` + `pnpm db:generate` to apply to Supabase.**
- [x] Audit writes from: `createTenant`, `updateTenant` (detect suspend/reactivate
      from active flag diff), `setSubscription`, `updateSubscriptionStatus`,
      `impersonate` (also keeps ImpersonationLog for backwards compat).
- [x] `actorId` passed through controller → service on all super-admin writes.
- [x] Timing-safe master password comparison via `createHmac('sha256', key)` +
      `crypto.timingSafeEqual` (replaces `!==` which leaks timing info).
- [x] In-memory rate limiter on `POST /admin/impersonate`: 5 attempts per 15
      minutes per operator ID, returns 429 with remaining-time message.
- [x] CORS hardened: `enableCors()` wildcard replaced with origin whitelist from
      `CORS_ORIGINS` env var (comma-separated); defaults to localhost:5173/74/75.
- [x] `DashboardPage.tsx` wired to real `/admin/analytics`: real GMV cards with
      period-over-period deltas, 30-day CSS bar chart, top-tenants list,
      method split, MRR.
- [x] `AuditLogPage.tsx` wired to `GET /admin/audit-log`: paginated table with
      event-type badges, actor names, tenant links, metadata summaries.
- [x] `TenantDetailPage.tsx` billing history wired to `GET /admin/tenants/:id/payments`.
- [x] `@amber/api-client` new typed methods: `getPlatformAnalytics()`,
      `getAuditLog({ limit, offset })`, `getTenantPayments(tenantId)` — each
      with inline Zod response schemas.

### Remaining
- [ ] **DB migration** — run `npx prisma db push` (direct Supabase URL) then
      `pnpm db:generate` to apply the AuditLog schema and regenerate the client.
      Until done, `auditLog.*` calls will fail at runtime.
- [ ] End-to-end manual pass: create tenant → assign plan → impersonate → confirm
      restaurant-admin banner → cancel → confirm lockout → check audit log shows
      all events.
- [x] ~~Add `AuthGuard` to every remaining tenant-scoped route~~ **Done** (via
      the JWT RBAC rewrite, not Supabase `AuthGuard`): `menu/`, `tables/`,
      `orders/`, `tenant/`, `loyalty/`, `billing/` and the staff side of
      `service-requests/` all carry `JwtAuthGuard` + `@RequirePermission(...)`;
      guest routes stay device-id-bound by design; global per-IP throttler
      (120 req/60s) added.
- [ ] Rotate `PLATFORM_MASTER_PASSWORD` to a long random value
      (`openssl rand -base64 32`) — never in a committed file.

## Launch gates & post-perf residuals (added 2026-07-17)

Carried from the performance thread (`PERFORMANCE_RESULTS.md`) so they survive
its closure:

- [ ] **Mumbai cutover** — the last perf pass. RTT measured (~38–48 ms vs
      ~100 ms), baseline migration created + drift-checked, copy script +
      checklist ready (`api-reference/MUMBAI-CUTOVER.md`,
      `tools/mumbai-cutover.mjs`). Blocked only on creating the ap-south-1
      project in the dashboard (human step 0).
- [ ] **HTTP/2 at the reverse proxy** — REQUIRED for launch
      (DEPLOY-RUNBOOK.md step 2b, BUGS.md BUG-005). Becomes real at deploy time.
- [ ] **Analytics at production volume** — pass 5's joined analytics query was
      measured at seed scale (~280 ms). **Trigger: re-measure
      `GET /orders/analytics` when any tenant passes ~10k orders**; if it
      regresses, consider `relationLoadStrategy: "query"` on that one call or
      SQL-side aggregation.
- [ ] **KDS relay retirement** — fold the KDS board onto the API order stream
      (client-side; scoped before the server perf work began, see CLAUDE.md
      flow 4).
- [ ] **BUG-005 client stream-thinning** — don't mount the service-requests
      stream on routes that don't render the bell (`/kds/display`); or share
      one stream across tabs (SharedWorker/BroadcastChannel). Secondary to
      HTTP/2, still worth doing.

## Quick status board

| Phase | Track | Status |
|---|---|---|
| 0 | Contracts & schema | ✅ done (AuditLog schema added; push pending) |
| 1 | A — Auth backend | ✅ done + timing-safe + rate-limit |
| 1 | B — Subscription backend | ✅ done + audit writes |
| 2 | C — Super-admin panel | ✅ done + analytics/audit/payments wired |
| 2 | D — Restaurant-admin integration | ✅ done |
| 3 | Security hardening | ✅ CORS + timing-safe + rate-limit done |
| 3 | Analytics & audit endpoints | ✅ done |
| 3 | Integration pass & auth guard | ✅ auth guards done (JWT RBAC); manual e2e pass still 🔲 |

**Critical path now:** the end-to-end manual integration pass (create tenant →
plan → impersonate → lockout → audit log). Tenant-scoped route guarding is done
via the JWT RBAC rewrite.

## Ops backlog

- [ ] **Stale empty session cleanup.** An `open` Order with zero items can be
      orphaned when whatever created it loses track of it (seen 2026-07-16: an
      unnamed, empty, open order held table T2 "occupied" for 19+ hours — a
      miniature of `PRODUCTION_READINESS_AUDIT.md` C4's lost-session failure
      mode; real service will produce these too, not just test harnesses).
      Add a staff "force-close stale session" affordance on the admin floor
      view and/or auto-expire `open` orders with zero items after N hours.
- [ ] **Occupancy check-then-insert race on `POST /orders`.** Named during the
      2026-07-21 latency pass (`orders.service.ts` `createForTable`): the
      occupancy read (`Order.findFirst` for an open/billed row on the table)
      and the `Order.create` insert are not atomic — two guests scanning the
      same table's QR within the same window can both pass the occupancy
      check and both insert, landing two live orders on one table. Pre-dates
      the perf pass (unchanged by it, not introduced). Candidate fix: a
      partial unique index — `CREATE UNIQUE INDEX ... ON "Order"("tableId")
      WHERE status IN ('open','billed')` — so the second insert fails at the
      DB layer instead of racing past a plain SELECT, then map that constraint
      violation to the existing `ConflictException` in `createForTable`.
