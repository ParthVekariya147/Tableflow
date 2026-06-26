# Platform Plan — Auth, Tenant Management & Subscriptions

> Architecture + phase plan for: (1) real auth, (2) super-admin managing every
> tenant's settings end-to-end, (3) subscription-based billing plans, and
> (4) a master-password "login as any tenant" path for support. Written so
> the work can be split across **multiple parallel Claude Code terminals**
> with minimal collisions. Companion to `apps/super-admin/SUPER_ADMIN.md`
> (which stays focused on the super-admin UI feature backlog) and `FEATURES.md`.

## What's being built (plain summary)
1. **Tenant settings live in the `Tenant` table** (already true) — super-admin
   gets a full editor for it: business info, theme, currency/tax, active flag —
   not just create+list.
2. **Subscription plans**: new `Plan` (tiers: price, limits) + `Subscription`
   (tenant ↔ plan, status, period) models. Super-admin assigns/changes/cancels
   a tenant's plan. `restaurant-admin` reflects that plan/status (and can be
   locked out if the subscription lapses).
3. **Super-admin is the single control plane**: every tenant, every setting,
   create new tenants, manage business details, manage subscriptions — one
   place to see/manage everything.
4. **Master-password impersonation**: a platform operator can log into *any*
   tenant's `restaurant-admin` ("anything cafe") using a secret from `.env`,
   without knowing that tenant's real credentials — for support. Logged.

## Feature priority (super-admin panel)

Ordered by value vs. effort — build top to bottom.

**Must-have (core control plane)**
- **Tenant directory** — list all restaurants with status (active/trial/past-due), plan, MRR contribution
- **Tenant editor** — full CRUD: business info, theme/branding, currency, tax rate, active/suspend toggle
- **Onboarding wizard** — create tenant + owner user + (optionally) seed starter menu/tables in one flow
- **Subscription management** — assign/change/cancel plan per tenant, view billing history/invoices
- **Plan catalog editor** — define tiers (price, table/order limits, features included)
- **Impersonate / login-as-tenant** — the master-password flow, for support

**High-value (operational visibility)**
- **Platform-wide analytics** — total GMV, active tenants, churn, growth trend across all restaurants (not per-tenant)
- **Usage dashboard per tenant** — orders/month, active tables, against their plan limits (flags who's near/over limit)
- **Activity/audit log** — impersonation events, tenant created/suspended, plan changes — who did what, when

**Nice-to-have (later)**
- Support ticket/notes per tenant
- Tenant health score (login frequency, order volume trend) to flag churn risk
- Bulk actions (e.g. suspend all past-due tenants)

**Build order recommendation:** Tenant directory + editor → Onboarding wizard
→ Plan/Subscription management → Impersonate → platform analytics. That
sequence produces a usable control plane fastest, with billing and
impersonation (the two most-requested pieces) landing before the
nice-to-have analytics polish. Maps onto Phase 2 Track C below.

## Current reality (don't re-derive each session)
- `Tenant`, `User`, `Membership`, `Role` already exist in
  `services/api/prisma/schema.prisma`. `User.isSuperAdmin` is already modeled.
- **No real auth anywhere.** `restaurant-admin/src/pages/LoginPage.tsx` just
  navigates in on submit. `super-admin/src/api.ts` reads a token from
  `localStorage["amber.adminToken"]` but nothing issues or checks it.
- `/admin/*` (super-admin's backend routes) has **zero guard** — open today.
- No `Plan`/`Subscription`/`Invoice` models exist at all.
- `services/api` is NestJS + Prisma; DTOs are Zod (`@amber/domain` / per-module
  `*.dto.ts`); every tenant-scoped table already carries `tenantId`.
- `@amber/api-client` `admin` resource currently only has
  `listTenants`/`createTenant` (`packages/api-client/src/index.ts:411`).

## Architecture decisions (so parallel tracks don't diverge)
- **Auth = Supabase Auth, not a hand-rolled JWT.** Supabase's `auth.users` is
  the credential source of truth — email/password **and** Google OAuth both
  go through `supabase-js` (`signInWithPassword` / `signInWithOAuth({provider:
  "google"})`) on the frontend. The client gets back a Supabase session JWT
  (`access_token`, short-lived + auto-refreshed by `supabase-js`) and sends it
  as the bearer token to the Nest API. There is **no `POST /auth/login`
  endpoint on our API** — login happens entirely against Supabase; our backend
  only ever *verifies* the resulting token.
  - **Nest side**: `AuthGuard` verifies the incoming Supabase JWT (via
    Supabase's JWKS endpoint / `SUPABASE_JWT_SECRET`, project-specific —
    confirm which during Phase 0) and extracts `sub` (= Supabase
    `auth.uid()`). It then loads the matching Prisma `User` row and attaches
    `req.user = { id, email, isSuperAdmin, memberships }`. A `@CurrentUser()`
    decorator mirrors the existing `@CurrentTenant()` pattern.
  - **Prisma `User`** keeps its role/profile fields (`isSuperAdmin`,
    `Membership`s) but is now keyed by the Supabase user id (rename/repurpose
    the existing id column to store `auth.uid()`, or add a `supabaseId`
    unique column — decide in Phase 0) and **drops `passwordHash`** (Supabase
    owns credentials now; no local password storage). A Postgres trigger or a
    one-time backend `POST /auth/sync-profile` call (first authenticated
    request after signup) creates the matching `User` row — decide which in
    Phase 0, since `prisma/seed.ts`'s super-admin seed needs to create both
    the Supabase user (via the Supabase Admin API, service-role key) and the
    Prisma row in lockstep.
  - Token storage stays client-side via `supabase-js`'s own storage adapter
    (replaces the old `localStorage["amber.adminToken"]` convention) —
    `supabase-js` handles refresh automatically, which the old plan's hand
    rolled JWT did not.
- **Super-admin auth** = same Supabase user / Prisma `User` row,
  `isSuperAdmin: true`, no memberships needed. `/admin/*` guard requires
  `isSuperAdmin` on the resolved `User`.
- **Restaurant-admin auth** = Supabase user + Prisma `User` + `Membership` for
  the resolved tenant; guard checks a membership exists for `X-Tenant-Slug`
  and is `active`.
- **Subscriptions are platform-level, not tenant-self-service.** Only
  `/admin/*` (super-admin) can create/change a `Subscription`. `restaurant-admin`
  only ever *reads* its own tenant's subscription (`GET /tenant` extended, or a
  new `GET /billing/me`).
- **Master-password impersonation still applies on top of Supabase Auth**, as
  a *separate* env-gated escalation (not a backdoor baked into normal login).
  Since Supabase has no native "impersonate another user" primitive for our
  use case, impersonation mints our own short-lived custom JWT rather than a
  Supabase session:
  - New env var `PLATFORM_MASTER_PASSWORD` (services/api `.env`, never committed).
  - `POST /admin/impersonate { tenantSlug, masterPassword }` — requires the
    caller already hold a **valid Supabase session** that resolves to a
    super-admin `User` (so it's "escalate", not "bypass everything") **plus**
    the master password. On success mints a short-lived (e.g. 30 min)
    *custom* JWT (signed with our own `JWT_SECRET`, separate from Supabase's)
    scoped to that tenant with an `impersonated: true` claim and the
    operator's `userId` for audit.
  - `AuthGuard` therefore accepts **two** token shapes: a Supabase-issued JWT
    (normal sessions) or our own impersonation JWT (checked first by issuer/
    structure) — keep this dispatch explicit and well-commented since it's
    the one place two auth systems meet.
  - Every impersonation mints an `ImpersonationLog` row (`userId`, `tenantId`,
    `createdAt`) — non-negotiable, this is the trade-off for the convenience
    of a master key.
  - `restaurant-admin` shows a persistent banner ("Viewing as platform support —
    <tenant>") whenever the active token has `impersonated: true`, so no one
    mistakes it for a normal session.
  - ⚠️ Treat the master password like a root credential: long random value,
    rotated periodically, never logged, never sent to the frontend except as
    a password the operator types once.

## Phase plan

Each phase lists **tracks** that can run in **separate Claude Code terminals**
in parallel once their inputs are ready. Tracks within a phase don't touch the
same files, so they shouldn't conflict; coordinate merges at phase boundaries.

---

### Phase 0 — Contracts & Schema (single terminal, blocking)
Everything else reads these shapes, so do this first and merge before
fanning out.
- `packages/domain/src/`:
  - `auth.ts` (new): `AuthUser` (`{id,email,name,isSuperAdmin}`), the
    impersonation JWT payload shape (`{userId,tenantId,impersonated:true}`).
    No `loginSchema` — login itself is a Supabase `supabase-js` call on the
    frontend (email/password or `signInWithOAuth({provider:"google"})|"apple"`),
    not a request our API validates.
  - `billing.ts` (new): `Plan` (`{id, name, priceCents, interval: "month"|"year",
    limits: {maxTables?, maxOrdersPerMonth?}, active}`), `Subscription`
    (`{id, tenantId, planId, status: "trialing"|"active"|"past_due"|"canceled",
    currentPeriodEnd, createdAt}`).
  - Extend `tenant.ts`'s exported types only if needed for business-info fields
    (e.g. `contactEmail`, `contactPhone`, `address`) — confirm with whoever owns
    Phase 2 Track C before adding fields, since the editor UI consumes them.
- `services/api/prisma/schema.prisma`:
  - `Plan` model, `Subscription` model (`@@unique([tenantId])` — one active
    sub per tenant), `ImpersonationLog` model.
  - `User`: **drop `passwordHash`** (Supabase owns credentials), add a unique
    `supabaseId` column (stores `auth.uid()`) used by `AuthGuard` to resolve
    `req.user`. Existing `id`/`isSuperAdmin`/`Membership` relations stay as-is.
  - Run `pnpm db:generate` + `npx prisma db push` (against `DIRECT_URL`) and
    commit the schema diff before Phase 1 starts.
- Output: a short contracts note (which fields, which enums) posted back so
  Phase 1/2 tracks don't guess.

---

### Phase 1 — Backend (2 parallel tracks, after Phase 0 merges)

**Track A — Auth backend** (`services/api/src/auth/` new module)
- Install `@supabase/supabase-js` (server-side, service-role key) in
  `services/api` — needed for admin-API calls (creating the seed super-admin
  user) and optionally for JWT verification helpers.
- `AuthGuard`: verifies the Supabase-issued bearer JWT (against
  `SUPABASE_JWT_SECRET`, or via Supabase's JWKS if using asymmetric keys —
  confirm which the project uses), resolves `sub` → Prisma `User.supabaseId`,
  attaches `req.user`. Falls through to verifying an **impersonation** JWT
  (our own `JWT_SECRET`, `impersonated:true` claim) if the Supabase
  verification doesn't match — see the two-token-shape note above.
- `@CurrentUser()` decorator; apply the guard to `/admin/*` (require
  `isSuperAdmin`) and to `restaurant-admin`-facing routes that need a real
  session.
- `POST /auth/sync-profile` (new, called once by the frontend right after a
  successful Supabase signup/first login) — upserts the Prisma `User` row
  for `req.user.sub` so a Supabase-only signup gets a profile row before it
  can be assigned `isSuperAdmin`/memberships.
- `POST /admin/impersonate` (the master-password flow above) +
  `ImpersonationLog` write.
- Seed a super-admin user in `prisma/seed.ts`: create the Supabase user via
  the Supabase Admin API (`supabase.auth.admin.createUser`, service-role key,
  env-driven email/password — not hardcoded), then create the matching
  Prisma `User` row (`isSuperAdmin: true`, `supabaseId` = the returned id) so
  there's a login on day one via both email/password and (once added to the
  Supabase project) Google.
- **Supabase project setup** (one-time, outside the repo): enable the Google
  provider in the Supabase dashboard (Auth → Providers), register OAuth
  redirect URLs for `restaurant-admin`/`super-admin` dev + prod origins.

**Track B — Subscription backend** (`services/api/src/billing/` new module,
under `/admin/*` for writes)
- `GET /admin/plans`, `POST /admin/plans`, `PATCH /admin/plans/:id` (CRUD the
  catalog of plan tiers — small, rarely-changing list).
- `POST /admin/tenants/:id/subscription` (assign/change plan),
  `PATCH /admin/tenants/:id/subscription` (cancel/reactivate/change status).
- `GET /admin/tenants` — extend the existing list to include each tenant's
  current `Subscription`+`Plan` (join), so the super-admin tenant table can
  show plan/status without N+1 calls.
- `GET /billing/me` (tenant-scoped, for `restaurant-admin`) — current plan +
  status + limits, read-only.
- Also: `PATCH /admin/tenants/:id` for full tenant edit (business info, theme,
  active flag) — the missing update endpoint `SUPER_ADMIN.md` already flags.

*Tracks A and B both touch `services/api/src/app.module.ts` (registering the
new module) — that's the one file likely to conflict; whoever merges second
does a trivial rebase.*

---

### Phase 2 — Frontend (2 parallel tracks, can start as soon as Phase 0
contracts exist — stub against mock data, then swap to live Phase 1 endpoints
when ready)

**Track C — Super-admin panel** (`apps/super-admin/`)
- Install `@supabase/supabase-js` (browser client, anon key). Add
  `react-router` shell: `Login` (email/password form + "Continue with
  Google" button → `supabase.auth.signInWithOAuth`), `Tenants` (list + full
  editor: business info, theme, currency/tax, active toggle), `Plans`
  (manage the catalog), `Tenants/:id/Subscription` (assign plan,
  view/cancel), `Impersonate` action per tenant row (prompts for master
  password, opens `restaurant-admin` in a new tab with the minted
  impersonation token).
- On login success, call `POST /auth/sync-profile` once so the Prisma
  `User` row exists, then redirect into the panel.
- `@amber/api-client` `admin` resource: add `updateTenant`,
  `listPlans`/`createPlan`/`updatePlan`, `getSubscription`/`setSubscription`,
  `impersonate`, `syncProfile`. (No `login` method — that's a direct
  `supabase-js` call, not routed through our api-client.) `request()` needs
  a `getToken` that reads the current Supabase session's `access_token`
  (`supabase.auth.getSession()`), not `localStorage["amber.adminToken"]`.
- This is the "see/manage everything" home screen the request asks for —
  it's the biggest UI surface, expect this to be the longest-running track.

**Track D — Restaurant-admin integration** (`apps/restaurant-admin/`)
- Install `@supabase/supabase-js` (browser client, anon key). Wire
  `LoginPage.tsx` to `supabase.auth.signInWithPassword` / `signInWithOAuth
  ({provider:"google"})`; on success call `POST /auth/sync-profile`, then
  send the Supabase session's `access_token` as bearer on all API calls
  (same `getToken` pattern as Track C). If the active session is an
  impersonation token instead (opened via the super-admin "Impersonate"
  link), use that as the bearer directly — it's already a complete JWT, no
  Supabase session involved.
- New "Plan & Billing" read-only settings page: calls `GET /billing/me`, shows
  plan name/limits/status/renewal date.
- Lockout state: if subscription status is `past_due`/`canceled`, show a
  blocking banner/screen (don't silently keep working — that's the point of
  having a subscription at all).
- Impersonation banner: if the active token has `impersonated: true`, render
  a persistent strip across the shell.

---

### Phase 3 — Integration & hardening (single terminal, after 1+2 land)
- End-to-end pass: create tenant in super-admin → assign plan → log in via
  master password as that tenant → confirm restaurant-admin reflects plan +
  shows the impersonation banner → cancel subscription → confirm lockout.
- Close the long-standing gap: add the auth guard to **all** existing
  tenant-scoped restaurant-admin-facing routes that assumed `X-Tenant-Slug`
  alone was enough (see `CLAUDE.md`'s repeated "auth deferred" notes) — this
  is the point where that deferral finally gets paid off.
- Rotate `PLATFORM_MASTER_PASSWORD` out of any shared `.env.example` (it should
  only ever exist in real, untracked `.env` files) and double check
  `ImpersonationLog` actually gets written on every impersonated session.

## Suggested terminal split (for "build fast with multiple Claude Code terminals")
1. **Terminal 1**: Phase 0 (solo), then becomes Track A (Phase 1).
2. **Terminal 2**: idle until Phase 0 merges, then Track B (Phase 1).
3. **Terminal 3**: Track C (Phase 2) — can start immediately against Phase 0
   contracts with mocked responses, swap to live API once Track A/B land.
4. **Terminal 4**: Track D (Phase 2) — same as above.
5. Converge to one terminal for Phase 3.

This caps real parallelism at ~3 concurrent terminals (Phase 0 is serial by
nature; Phase 1's two tracks share one file lightly; Phase 2's two tracks are
fully independent of each other and only need Phase 0's contracts to start).

## Environment variables needed

All added to `services/api/.env` (copy into `.env.example` **without real
values**, per the rotation note in Phase 3):
| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | Track A | already used by `storage/StorageService`; reused for auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Track A | already in `.env` for storage; reused to create the seed super-admin via Supabase Admin API |
| `SUPABASE_JWT_SECRET` | Track A (`AuthGuard`) | verifies Supabase-issued session JWTs server-side — get from Supabase dashboard → Settings → API |
| `JWT_SECRET` | Track A (impersonate only) | signs/verifies our *own* short-lived impersonation token — separate from Supabase's signing key |
| `JWT_EXPIRES_IN` | Track A (impersonate only) | e.g. `30m` for impersonation tokens |
| `PLATFORM_MASTER_PASSWORD` | Track A (impersonate) | long random value; real secret only in untracked `.env` |
| `SUPER_ADMIN_SEED_EMAIL` / `SUPER_ADMIN_SEED_PASSWORD` | `prisma/seed.ts` | passed to `supabase.auth.admin.createUser` to bootstrap the first super-admin login; not hardcoded in seed source |

`apps/super-admin/.env.local` and `apps/restaurant-admin/.env.local` each need
two **new** vars: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (the
browser-side `supabase-js` client uses the anon key, never the service-role
key) — in addition to the existing `VITE_API_URL`.

## Definition of done per phase
- **Phase 0**: `pnpm db:generate` succeeds; new Zod schemas exported from
  `@amber/domain`'s index; schema diff committed; contracts note shared.
- **Phase 1**: a Supabase email/password login AND a Google OAuth login both
  resolve through `AuthGuard` to the correct Prisma `User` (super-admin and
  tenant-membership cases both verified); `/admin/*` 401s without a valid
  super-admin session; `POST /admin/impersonate` writes an `ImpersonationLog`
  row and returns a tenant-scoped impersonation token that `AuthGuard` also
  accepts; subscription CRUD round-trips through Postgres (verified via
  `prisma studio` or a quick script, not just reading the code).
- **Phase 2**: Track C — every "must-have" feature above is clickable end to
  end against live Phase 1 endpoints (no more mocks). Track D — login works,
  billing page renders real data, lockout banner appears when a seeded
  tenant's subscription is `past_due`.
- **Phase 3**: the full end-to-end script in Phase 3 passes manually once;
  no tenant-scoped route in `restaurant-admin`'s controllers is reachable
  without a valid session; `.env.example` contains no real secret values.

## Open risks / things to confirm before/while building
- **Business-info fields on `Tenant`** (`contactEmail`, `address`, etc.) —
  not yet decided; Phase 0 explicitly defers this to whoever builds the
  tenant editor (Track C) so the schema isn't guessed at twice.
- **Supabase JWT verification method** — confirm in Phase 0 whether the
  Supabase project signs sessions with a shared secret (`SUPABASE_JWT_SECRET`,
  simple HMAC verify) or asymmetric keys (JWKS, needs a small caching
  verifier) — check the project's Auth settings before writing `AuthGuard`.
- **Profile sync timing** — decide whether `User` rows are created via a
  Postgres trigger on `auth.users` insert, or lazily via
  `POST /auth/sync-profile` on first authenticated call. The trigger is more
  robust (works even if the frontend never calls sync) but requires DB-level
  Supabase config; the endpoint is simpler and keeps everything in
  application code. Lean toward the endpoint unless trigger setup is trivial.
- **Apple Sign-In is deferred** — only email/password + Google ship in this
  phase; Apple needs a paid Apple Developer account, a Services ID, and a
  private key uploaded to Supabase, so it's a separate follow-up once the
  Google path is proven.
- **Plan limit enforcement** — this plan defines `Plan.limits` but doesn't
  yet specify *where* limits are enforced (e.g. blocking table #21 on a
  20-table plan). Decide in Phase 1 Track B whether enforcement is
  server-side (reject the mutating call) or just surfaced as a soft warning
  in the dashboards — these have very different implementation costs.
- **Token storage** — localStorage (matching the existing `amber.adminToken`
  convention) is XSS-exposed; acceptable for now given auth is currently
  *fully absent*, but worth revisiting (httpOnly cookies) once this is more
  than an internal tool.
- **Seed data for subscriptions** — `prisma/seed.ts` currently seeds 3
  tenants with no subscription; Phase 0/1 should decide whether seeded
  tenants get a default `active` subscription so the rest of the app doesn't
  immediately hit lockout states in dev.
