# TableFlow — Complete Production Readiness Audit

**Date:** 2026-07-01
**Scope:** Request loops, SSE lifecycle, React rendering, database, security, concurrency,
memory, webhooks, authentication, network, frontend architecture, and scalability —
across `services/api`, `apps/customer`, `apps/restaurant-admin`, `apps/super-admin`.
**Method:** Read-only investigation by 4 parallel focused reviews (customer app;
admin/super-admin apps; backend SSE/concurrency/memory; backend security) plus direct
verification of the highest-severity claims. **No code was changed as part of this
audit.**

**Ground rule for the eventual fix phase (per instruction):** no optimization or
refactor may change existing business behavior unless it is fixing a bug. High-risk
changes need a rollback plan and an explicit list of user flows to regression-test.

---

## Executive Summary

**Overall Health Score: 38 / 100** (up from the 32/100 baseline in
`PERFORMANCE_INVESTIGATION.md`, which this audit deliberately did not re-litigate —
see that file for the pure-latency findings already fixed).

The realtime plumbing (SSE emit/subscribe, event de-duplication, most cleanup logic)
is **well-engineered** — both backend agents independently traced the `@Sse` teardown
path and event-emission call sites and found no leaks or double-broadcasts. The system's
real problems are structural, not subtle:

1. **The entire `/admin/*` and `/billing/admin/*` surface has zero authentication.**
   Anyone with network access can reset any restaurant's Admin password, read every
   tenant's owner credentials, grant free subscriptions, and mint impersonation tokens.
2. **`menu/`, `tables/`, and `orders/` (including payment capture) are also fully
   unauthenticated** — not merely unpermissioned as CLAUDE.md documents, but reachable
   by anyone who knows or guesses a tenant slug (visible in every guest QR code).
3. **A confirmed privilege-escalation path**: a non-Admin `team.manage` holder can
   create a brand-new role with every permission (including `team.manage`) and assign
   it to themselves, sidestepping the documented Admin-tier guard entirely.
4. **Several lost-update races** in quantity/payment mutations, reachable *externally*
   because of (2) — not just a rare internal double-click.
5. **A guest-order-destroying bug**: a transient network blip during session resume is
   indistinguishable from "nothing to resume," silently wiping the guest's live order
   and reseating them at an unrelated table.
6. **One regression introduced by my own earlier caching work this session**: tenant
   suspension via the super-admin panel no longer takes effect for up to 30s, because
   `admin.service.updateTenant` writes directly via Prisma and bypasses the cache
   invalidation built into `TenantService.update()`.

None of this is architecturally hard to fix — the auth primitives
(`JwtAuthGuard`, `PermissionsGuard`, `SuperAdminGuard`) already exist and are used
correctly elsewhere. The gaps are places those primitives were never wired in.

### Top 10 Findings (ranked by exploitability × impact)

| # | Finding | Severity |
|---|---------|----------|
| 1 | `/admin/*` — password reset, credential listing, tenant CRUD — no auth guard | 🔴 Critical |
| 2 | `/billing/admin/*` — free plan grants, subscription tampering — no auth guard | 🔴 Critical |
| 3 | `menu/`, `tables/`, `orders/` (incl. payment capture) — no auth guard | 🔴 Critical |
| 4 | Guest session-resume failure silently destroys the live order | 🔴 Critical |
| 5 | Privilege escalation: `RolesService.create()` has no admin-tier check | 🟠 High |
| 6 | `JWT_SECRET` has an insecure hardcoded fallback, unenforced at boot | 🟠 High |
| 7 | Lost-update race on item quantity (`updateItem`/`addItem`, client-absolute writes) | 🟠 High |
| 8 | `bringIt`/`bringThese` have no double-tap guard → duplicate KDS tickets/bill lines | 🟠 High |
| 9 | KDS page opens 2 independent `/orders/stream` SSE connections (+1 relay) | 🟠 High |
| 10 | `capturePayment` double-capture race surfaces as an unhandled 500, not a clean 409 | 🟠 High |

---

## 🔴 Critical

### C1. `/admin/*` has zero authentication
**File:** `services/api/src/admin/admin.controller.ts` (whole file, esp. `:70-78`
`resetOwnerPassword`, `:64-67` `getCredentials`)
**Root cause:** No `@UseGuards(...)` on the controller class or any handler;
`AdminModule` never registers a guard; `app.module.ts` only wires `ThrottlerGuard`
globally, not an auth guard.
**Evidence:**
```ts
@Controller("admin")
export class AdminController {
  @Post("tenants/:id/reset-owner-password")
  async resetOwnerPassword(@Param("id") id: string, @Body() body: unknown) {
    const dto = resetOwnerPasswordSchema.parse(body);
    await this.admin.resetOwnerPassword(id, dto.userId, dto.newPassword);
    return { ok: true };
  }
```
**Reproduction:** `curl -X POST http://<api>/admin/tenants/<any-id>/reset-owner-password
-d '{"userId":"<any>","newPassword":"pwned123"}'` — no headers, no token, works today.
**Impact:** Full platform takeover. `GET /admin/credentials` leaks every tenant's Admin
email; `reset-owner-password` overwrites it with an attacker-chosen password; `PATCH
/admin/tenants/:id` suspends/reactivates any restaurant; `POST /admin/impersonate`
mints a full-access token for any tenant.
**Recommended fix:** Apply the existing, already-implemented `SuperAdminGuard` to
`AdminController` (class-level `@UseGuards`).
**Estimated improvement:** Closes the single largest exposure in the system.
**Risk of the fix:** Low — the guard already exists and is used correctly elsewhere;
this is purely additive. Regression-test: super-admin login flow, tenant onboarding,
impersonation.

### C2. `/billing/admin/*` has zero authentication
**File:** `services/api/src/billing/billing.controller.ts:22-67` (only `billing/me`
at `:69` has `JwtAuthGuard`)
**Root cause:** Same class of gap as C1 — comment in the file even says "intentionally
unguarded for now."
**Impact:** Anyone can `POST /admin/tenants/:id/subscription` to grant free premium
plans, or tamper with a competitor's subscription status.
**Recommended fix:** Gate with `SuperAdminGuard`, same as C1.
**Risk of the fix:** Low.

### C3. `menu/`, `tables/`, `orders/` are fully unauthenticated (not just unpermissioned)
**File:** `services/api/src/menu/menu.controller.ts`, `tables/tables.controller.ts`,
`orders/orders.controller.ts` (entire files — confirmed via grep, zero `@UseGuards`
usages)
**Root cause:** These modules only require a resolvable `X-Tenant-Slug` header
(`TenantMiddleware`); CLAUDE.md documents this as "not yet permission-gated," but it's
more severe — there is no authentication check at all, staff or otherwise.
**Impact:** Anyone who knows a tenant slug (visible in the QR-encoded customer URL)
can, with zero credentials: edit/delete the menu, upload arbitrary images, regenerate
any table's QR (invalidating printed codes), cancel any order, and **capture arbitrary
payments** via `POST /orders/:id/payment`.
**Recommended fix:** Add `JwtAuthGuard`/`@RequirePermission` to staff-mutating routes
while carving out the genuinely public guest routes (`GET /menu`, `GET
/tables/qr/:token`, guest order/round creation — these are meant to stay
unauthenticated and device-id-bound by design).
**Risk of the fix:** Medium — needs care to not break the guest ordering flow, which
intentionally has no bearer token. Regression-test: full guest QR → order → pay flow,
plus every staff menu/table/order action.

### C4. Guest session-resume failure silently destroys the live order
**File:** `apps/customer/src/context/BootContext.jsx:70-77` (the `tryResume` catch)
and `:100-147` (the fallthrough)
**Root cause:** A transient failure while re-verifying a saved session (network blip,
5xx, timeout) is treated identically to "there was never a session to resume" —
both return a falsy result and fall through to the same code path.
**Evidence:**
```js
} catch (e) {
  if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
    markSessionEnded();
    return { status: "closed" };
  }
  return null; // transient — let the caller fall through
}
...
if (!parsed) {
  const resumed = await tryResume(api, saved);
  if (resumed) { ...; return; }
  // "Nothing to resume — dev fallback so the app stays runnable locally."
}
const tablePromise = parsed ? api.tables.byQrToken(parsed.qrToken)
  : api.tables.list().then((floor) => floor.find((t) => t.status === "free") ?? floor[0]);
...
clearSession();
```
**Reproduction:** A guest with a live order backgrounds the phone / loses signal
briefly, then reopens the app (the most common re-entry path). If the resume check
fails transiently, the code labeled "dev fallback" runs in production: `clearSession()`
wipes the real `orderId`, and the guest is silently reseated at an arbitrary free table.
**Impact:** Guest's live order becomes unreachable from their device; guest appears to
have started a fresh session at the wrong table; staff-side the original order is
orphaned (still open, no guest tracking it).
**Recommended fix:** Distinguish "no saved session" from "resume check failed
transiently" — retry or show a reconnect/error prompt in the transient case instead of
falling through to the free-table path.
**Risk of the fix:** Medium — touches the core boot state machine. Regression-test:
fresh QR scan, refresh mid-session, backgrounded-phone resume, genuinely-ended session,
and the no-QR local-dev fallback (must keep working for `pnpm dev`).

---

## 🟠 High

### H1. Privilege escalation via `RolesService.create()`
**File:** `services/api/src/roles/roles.service.ts:53-62` (contrast with the
admin-tier check that *does* exist in `update()`, `:64-102`)
**Root cause:** `create()` performs no check on the actor's tier before persisting a
new role with an arbitrary `permissions` array; the Admin-tier guard
(`assertCanManageProtected` in `members.service.ts`) only blocks acting on a role that
is already `protected` — a freshly-created role is never `protected`.
**Reproduction:** As a Manager (holds `team.manage`, not Admin-protected):
`POST /roles {"name":"Ghost Admin","permissions":["team.manage","settings.manage",...]}`
then `PATCH /members/:id {"roleId": "<new role>"}` on themselves.
**Impact:** Full bypass of the documented "only an Admin manages Admins" hierarchy.
**Recommended fix:** In `create()`, require the actor to be `roleProtected` (or
otherwise Admin-tier) whenever the requested permission set includes sensitive keys
(`team.manage`, `settings.manage`), mirroring the check already in `update()`.
**Risk of the fix:** Low. Regression-test: Manager creating a normal (non-sensitive)
role should still work; Admin creating any role should still work.

### H2. `JWT_SECRET` has an insecure hardcoded fallback
**File:** `services/api/src/auth/auth.module.ts:21`; the trust chain continues into
`jwt-auth.guard.ts:44-47` (impersonation tokens are trusted unconditionally, with no
DB/tenant cross-check — `resolveImpersonationUser`, `auth.service.ts:212-225`)
**Root cause:** `JwtModule.register({ secret: process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me" })`
— no startup assertion fails the process if the env var is unset in production.
**Impact:** If ever deployed with the fallback active, anyone can forge a JWT
(including an impersonation token with `imp:true`) granting full-permission access to
any tenant, with no server-side check that the claimed tenant/user even exists.
**Recommended fix:** Fail fast at boot if `JWT_SECRET` is unset outside local dev;
have the impersonation path verify the target tenant exists/is active.
**Risk of the fix:** Low. Note: could not verify from this repo alone whether the
actual deployed `.env` sets `JWT_SECRET` — that's an infra check, not a code check.

### H3. Lost-update race on order-item quantity
**File:** `services/api/src/orders/orders.service.ts:392-432` (`updateItem`, absolute
overwrite) and `:324-389` (`addItem`, read-then-write); client side:
`apps/restaurant-admin/src/store/AdminStore.tsx:446-459` (`CHANGE_QTY` computes the
new value from a locally-cached snapshot)
**Root cause:** The API's `qty` field is an absolute target value written with a plain
`prisma.orderItem.update({ data: { qty: dto.qty } })` — no optimistic-concurrency
check, no atomic increment. `addItem` has the same shape via
`existing.qty + dto.qty` computed in Node from a separately-fetched row.
**Reproduction:** Two rapid `+1` taps (double-click, or two staff devices on the same
table) both read qty=N, both compute/send N+1 — the second write clobbers the first;
one increment is silently lost.
**Impact:** Guest undercharged; no error surfaced to staff.
**Recommended fix:** Change the contract to a relative delta using Prisma's
`{ qty: { increment: delta } }` instead of a client-computed absolute value.
**Risk of the fix:** Medium — it's a contract change touching both the admin and
customer clients (which currently send absolute quantities). Regression-test: rapid
qty changes from one device, from two devices on the same table simultaneously, and
qty going to 0 (item removal).

### H4. `bringIt`/`bringThese` have no double-tap guard
**File:** `apps/customer/src/context/SessionContext.jsx:269-299`; called unguarded
from `components/ItemSheet.jsx:68-77`, `screens/MyOrderScreen.jsx:12-15`,
`screens/MenuScreen.jsx:136-141`, `screens/WelcomeScreen.jsx:167-170`
**Root cause:** No re-entrancy/in-flight guard, unlike `BillScreen.jsx`, which
correctly uses a `processing` flag + disabled button for the equivalent payment action.
**Reproduction:** Double-tap "Bring it" (or a touch+click synthetic double-fire on
some mobile browsers).
**Impact:** Two independent rounds created, each separately published to the KDS and
persisted server-side — duplicate kitchen tickets, inflated bill total (nothing dedupes
rounds server- or client-side for this path).
**Recommended fix:** Add the same `processing`-style guard already proven in
`BillScreen.jsx` to `bringIt`/`bringThese` (or disable the calling buttons while
in-flight).
**Risk of the fix:** Low — purely additive guard state, mirrors an existing pattern.

### H5. KDS page opens two independent `/orders/stream` SSE connections
**File:** `apps/restaurant-admin/src/store/AdminStore.tsx:305-327` (opens its own
`api.orders.stream()`) + `apps/restaurant-admin/src/kds/useKds.ts:131-191` (opens a
*second*, independent `api.orders.stream()` via a different api-client instance) +
still-running legacy `kds/kdsClient.ts` relay connection
**Root cause:** `AdminStoreProvider` wraps the whole app and always subscribes; `useKds`
(mounted on `/kds` and `/kds/display`) subscribes again rather than reading from the
subscription `AdminStore` already owns.
**Impact:** Every open KDS tab holds 3 simultaneous live connections (2× `/orders/stream`
+ 1× KDS relay), doubling server-side SSE listener count per tab and double-processing
every order event client-side.
**Recommended fix:** Have `useKds` consume order events from `AdminStore`'s existing
subscription (exposed via context) instead of opening its own.
**Risk of the fix:** Medium — touches the KDS/AdminStore boundary that CLAUDE.md
already flags as mid-migration ("unifying KDS onto the order stream is the next step").

### H6. `capturePayment` double-capture race surfaces as an unhandled 500
**File:** `services/api/src/orders/orders.service.ts:445-495`
**Root cause:** `Payment.orderId` is `@unique` in the schema (a real safety net), but
there's no `try/catch` around the transaction, and no global exception filter exists
anywhere in `src/` (verified via grep — zero `@Catch`/`APP_FILTER` usages) to translate
a Prisma `P2002` unique-constraint violation into a clean response.
**Reproduction:** Two near-simultaneous capture calls for the same order (double-tap
"Pay", or a stale guest retry racing a staff cash-capture) both pass the status guards,
both attempt the transaction.
**Impact:** The losing request gets a generic, uncorrelated 500 instead of a clean 409
— confusing UX, and (compounded by C3's missing auth) reachable from an unauthenticated
retry.
**Recommended fix:** Catch the P2002 violation and translate it to a `ConflictException`.
**Risk of the fix:** Low.

### H7. Duplicate `/tenant` fetch + duplicate `syncProfile` call on every login
**File:** `apps/restaurant-admin/src/context/TenantThemeGate.tsx:41-60` (independently
calls `api.tenant.current()`) duplicating `AdminStore.tsx:255-298`'s own
`api.tenant.current()` call on the same `status === "authed"` trigger; separately,
`apps/super-admin/src/components/RequireSession.tsx:12-21` calls
`api.auth.syncProfile()` from both the initial `getSession()` resolution AND the
`onAuthStateChange` callback (which Supabase fires immediately on subscribe, in
addition to future changes) — a guaranteed double-call on every load.
**Impact:** Wasted round trips, not incorrect — but exactly the "duplicate request on
login" pattern to close before scale.
**Recommended fix:** Let `TenantThemeGate` consume the tenant `AdminStore` already
fetched; gate `RequireSession`'s two call sites so only one fires the initial sync.
**Risk of the fix:** Low-Medium (couples two currently-independent providers in the
admin app).

---

## 🟡 Medium

### M1. Regression from this session's own caching work — tenant suspension isn't immediate
**File:** `services/api/src/admin/admin.service.ts:120-135` (`updateTenant`) vs.
`services/api/src/tenant/tenant.service.ts` (the `bySlugCache` + invalidation I added
earlier this session)
**Root cause:** `admin.service.ts`'s `updateTenant` (used by the super-admin panel to
suspend/reactivate a tenant) writes via `prisma.tenant.update` directly, bypassing
`TenantService.update()` — so it never calls the cache invalidation I built into that
method. A just-suspended tenant can still resolve (and fully operate) for up to the
30s cache TTL.
**Also:** `auth.service.ts`'s `resolveAuthUser` (`:238-273`) never checks
`membership.tenant.active` at all — it's saved from this today only because
`TenantMiddleware` independently 404s on an inactive tenant, but that's incidental,
not a designed-in guarantee.
**Recommended fix:** Route `admin.service.updateTenant` through `TenantService`'s
cache-invalidating path (or export a shared invalidation hook both can call); add an
explicit `membership.tenant.active` check to `resolveAuthUser` so this isn't reliant on
a side effect of a different module.
**Risk of the fix:** Low. I'm flagging this against my own earlier work in this
session for transparency — it wasn't present before the TTL-cache change.

### M2. `TtlCache` grows without bound over the process lifetime
**File:** `services/api/src/common/ttl-cache.ts:8-38`
**Root cause:** Eviction only happens lazily on `get()` (or explicit `delete`); there's
no background sweep and no max-size cap. A `(tenantId,userId)` or slug key that's
looked up exactly once (a user who logs in and never returns, a stale bookmark) sits in
the `Map` at its expired value forever — never re-read (so never swept), never
explicitly invalidated (no write touches it again).
**Impact:** Slow, unbounded memory growth proportional to *total distinct keys ever
seen*, not steady-state active load. Immaterial at today's scale; becomes a real
concern at hundreds-to-thousands of tenants/users on a long-lived process.
**Recommended fix:** Add a periodic sweep or a max-size/LRU cap to `TtlCache`.
**Risk of the fix:** Low.

### M3. Storage upload: SVG XSS risk + unsanitized extension fallback
**File:** `services/api/src/storage/storage.service.ts:11-19, 75-99`;
`services/api/src/menu/menu.controller.ts:47` (mimetype check)
**Root cause:** `image/svg+xml` is an accepted upload type (SVGs can carry
`<script>`/event-handler payloads, served back from the public bucket with the
client-supplied content-type); separately, the stored object's extension falls back to
an unsanitized slice of `file.originalname` when the mimetype isn't one of the six
known types, and the controller only checks `mimetype.startsWith("image/")` — not an
exact allow-list — so a crafted mimetype+filename could inject path segments into the
`<tenantId>/<uuid>.<ext>` storage key.
**Note (verified, corrects an initial hypothesis):** the 5 MB size cap *is* genuinely
enforced at the Multer interceptor level (`FileInterceptor("file", { limits: {
fileSize: 5*1024*1024 } })`) — not just documented.
**Recommended fix:** Drop `image/svg+xml` from accepted types (or sanitize/rasterize
on upload); whitelist a fixed extension set instead of falling back to
client-supplied `originalname`.
**Risk of the fix:** Low.

### M4. No per-account login throttle; default member password never forced to change
**File:** `services/api/src/auth/auth.controller.ts:19-23`,
`services/api/src/auth/auth.service.ts:67-80`; `services/api/src/members/members.service.ts:22,107`
**Root cause:** Only the global `ThrottlerGuard` (120 req/60s per IP) applies to
`/auth/login` — no per-email/per-account limiter, and no lockout after repeated
failures (including against the `PLATFORM_MASTER_PASSWORD` bypass path). Separately,
every new team member gets the fixed password `changeme123` with no
`mustChangePassword` flag and no self-service change-password endpoint anywhere in the
codebase.
**Impact:** A determined attacker sharing the generous per-IP budget (or distributing
across IPs) faces no account-level friction; combined with a guessable staff email
convention (as seeded in `CREDENTIALS.md`) and an indefinitely-live default password,
this is a realistic account-takeover path for any tenant whose admin never manually
rotates a new hire's password.
**Recommended fix:** Add a per-email(+IP) throttle/lockout on `/auth/login`
independent of the global limit; add a self-service change-password endpoint and/or
force-reset-on-first-login flag.
**Risk of the fix:** Low (throttle) / Medium (new endpoint + client UI).

### M5. `reclaimSession` — unthrottled phone-guess session hijack
**File:** `services/api/src/orders/orders.service.ts:674-702`,
`orders.controller.ts:117-128`
**Root cause:** The only proof of ownership is a plain string-equality check on the
last 10 digits of a phone number; no per-order/per-IP attempt limiter beyond the
global throttle. Also inside the C3 "no auth guard" surface.
**Impact:** An attacker at or near a restaurant who knows a table is occupied could
attempt to take over that guest's live session/bill by guessing the phone number.
**Recommended fix:** Add a per-order or per-IP attempt limit / short lockout on
repeated failed reclaim attempts.
**Risk of the fix:** Low.

### M6. AdminStore's focus + visibilitychange listeners can race
**File:** `apps/restaurant-admin/src/store/AdminStore.tsx:334-349`
**Root cause:** Both listeners call `syncNow` independently, guarded only by
`mutatingRef` (tracks user mutations, not background refreshes) — no dedupe between
the two, and no request sequencing/`AbortController`.
**Reproduction:** Switching back to a backgrounded tab commonly fires both events
within the same tick, launching two concurrent `refresh()` calls; if the earlier
request resolves after the later one (normal network jitter), the stale response wins
and silently reverts newer floor/sales data.
**Recommended fix:** Coalesce both listeners behind one guarded/debounced trigger
(mirroring the SSE handler's existing 150ms debounce), and/or drop out-of-order
responses via a request counter.
**Risk of the fix:** Low.

### M7. KDS board (`/kds/display`) — unbounded ticket/Set growth on a screen meant to run for days
**File:** `apps/restaurant-admin/src/kds/useKds.ts:82-89, 166-169, 207-227`
**Root cause:** `closedOrderIds`/`cancelledItemIds` are Sets that only grow by
explicit design ("only grows → never hides new ones"), and closed-order tickets are
never removed from the `tickets` array — only filtered out at render time.
**Impact:** `/kds/display` is documented to run chrome-free and unattended for a
whole shift or longer; both Sets and stale ticket entries grow without bound for the
lifetime of the tab — a slow, real memory leak on exactly the screen most likely to
stay open for days without a refresh.
**Recommended fix:** Prune entries once an order has been closed for a grace period
(e.g. drop on the next snapshot), or cap with age/LRU-based eviction.
**Risk of the fix:** Medium — must not race with the "only grows" guarantee that
prevents a stale relay frame from resurrecting a dead ticket.

### M8. No graceful shutdown / connection draining
**File:** `services/api/src/main.ts` (whole file), `services/api/src/prisma/prisma.service.ts:1-10`
**Root cause:** `app.enableShutdownHooks()` is never called; `PrismaService` defines
`onModuleInit`/`$connect()` but no `onModuleDestroy`/`$disconnect()`.
**Impact:** On `SIGTERM`/`SIGINT` (container restart, rolling deploy), in-flight
requests can be cut mid-query and pooled connections left dangling against
pgBouncer's 15-client session-mode cap, starving the next instance's warm-up.
**Recommended fix:** Call `app.enableShutdownHooks()`; add `onModuleDestroy` to
`PrismaService`.
**Risk of the fix:** Low.

---

## 🟢 Low

| # | Finding | File | Fix direction |
|---|---------|------|----------------|
| L1 | `SessionContext`/`BootContext` provider `value` objects rebuilt every render (unnecessary re-renders of every consumer) | `apps/customer/src/context/SessionContext.jsx:516-528`, `BootContext.jsx:192-206` | Wrap in `useMemo` |
| L2 | `showToast`'s dismiss timer isn't tracked/cleared — a second toast within 2.8s cuts the first short | `apps/customer/src/context/SessionContext.jsx:174-177` | Track timeout id in a ref, clear on re-trigger |
| L3 | "sent ✓" reset timer for quick actions has no unmount cleanup | `apps/customer/src/screens/WelcomeScreen.jsx:160-164` | Clear on unmount via ref |
| L4 | `useTick(1000)` re-renders the whole KDS ticket derivation every second just for a clock; `visibleTickets` not memoized | `apps/restaurant-admin/src/kds/useTick.ts`, `KdsPage.tsx:23`, `useKds.ts:208-213` | Isolate clock into its own component; `useMemo` the filter |
| L5 | No `/health` endpoint anywhere in the API | `services/api/src/main.ts` / `app.module.ts` | Add an unauthenticated `GET /health`, excluded from `TenantMiddleware` |
| L6 | No global exception filter / structured error tracking — unhandled errors fall through to Nest's bare default handler | whole `src/` tree | Add an `APP_FILTER`-registered exception filter with request/tenant context logging |
| L7 | `CREDENTIALS.md` untracked at repo root, documents the `changeme123` default-password pattern (ties into M4) | repo root | Not a live secret (demo password `demo1234`), but should be gitignored rather than left untracked before it's accidentally committed |

---

## Verified Clean (checked, not just assumed)

- **SSE teardown**: traced Nest's `@Sse` handling (installed `@nestjs/core@10.4.15`
  source) — client disconnect does call `request.on('close', () => subscription.unsubscribe())`,
  so the RxJS chain through `merge`/`filter`/`map` down to the shared `Subject` is torn
  down correctly. No accumulating dead subscribers.
- **Event emission**: all 11 `events.emit`/`refreshAndEmit` call sites in
  `orders.service.ts` checked — each mutation path emits exactly once. No
  double-broadcast path found.
- **Within-tenant BOLA**: `menu.service.ts`, `tables.service.ts`, `orders.service.ts`,
  `members.service.ts`, `roles.service.ts` all correctly scope every lookup by
  `tenantId` before acting on an `:id` (the *cross-tenant* auth gaps above are about
  missing authentication, not missing tenant-scoping within an authenticated request).
- **Injection**: no `$queryRaw`/`$executeRaw`/string-concatenated SQL, `eval`, or
  shell/`exec` usage anywhere in `services/api/src`.
- **Secrets in source**: no hardcoded API keys found via grep; secrets are correctly
  sourced from `process.env` (aside from the JWT fallback in H2).
- **CORS**: correctly locked to `CORS_ORIGINS` in production, intentionally open only
  in dev, as documented.
- **Webhooks**: none exist in this codebase yet (payment-provider integration is
  deliberately deferred per CLAUDE.md) — webhook idempotency/replay is not yet
  applicable.
- **api-client memoization**: checked for the "new `createApiClient()` on every
  render → fresh EventSource per render" anti-pattern in both frontend apps — not
  present; all client instances are properly memoized or module-level singletons.
- **KDS relay transport**: reference-counted singleton, closes on last unsubscribe,
  reopens cleanly — no leak under normal navigation.
- **`AdminStore`'s `refresh()`/`refreshFloor()` split** (added earlier this session):
  re-verified line-by-line — every action type is routed to the correct refetch
  scope, and the optimistic "crafting" placeholder is cleaned up unconditionally.
  Sound as written.

---

## Scalability Sketch

*(Current, correct pool config: `connection_limit=10`, `pool_timeout=10`, per the
tuning already applied this session — one reviewing agent read the stale
`.env.example` template, which still shows the pre-tuning `5`/`20` and should be
updated to match.)*

- **~10 tenants**: comfortable. The connection pool has headroom; the auth/security
  gaps above are latent, not yet under real hostile load.
- **~100 tenants**: the per-tenant in-process `Subject` and `TtlCache`s scale fine in
  memory. The pooled DB connections become the first real constraint under bursty
  traffic (e.g. simultaneous lunch-rush analytics calls). The **unauthenticated
  surface (C1-C3) stops being latent here** — anyone hammering a guessed slug adds to
  the same shared pool as legitimate tenants.
- **~1,000 tenants**: pgBouncer's session-mode cap (15 clients total, shared across
  every API instance) becomes the hard wall regardless of app-level fixes — this
  requires moving to transaction-mode pooling or a larger tier before anything else
  matters. `TtlCache`'s unbounded growth (M2) and the open `/admin/*` surface (C1)
  go from "someday" problems to immediate operational/security risk at this scale.
- **~10,000 tenants**: out of scope for the current single-region, single-pooler
  architecture without a broader infrastructure redesign (connection pooling
  strategy, possibly read replicas, geographic distribution) — not a code-level fix.

---

## Suggested Remediation Order

This is a recommendation for sequencing, not an instruction to proceed — nothing here
has been implemented.

1. **C1 + C2 + C3** (auth guards) — same fix shape, can land together; this is the
   single highest-leverage change in the whole audit.
2. **C4** (guest session-resume data loss) — independent of the auth work, equally
   urgent from a guest-trust standpoint.
3. **H1** (privilege escalation) — small, isolated, high-value.
4. **H2** (JWT secret fail-fast) — small, isolated.
5. **H3 + H6** (quantity/payment races) — bundle since both are "absolute write →
   atomic operation" fixes in the same service file.
6. **H4, H5, H7, M1, M6, M7** — frontend reliability/dedup cleanup, can be batched.
7. **M2-M5, M8, L-tier** — lower urgency, safe to schedule after the above.

Each of these should get its own before/after regression-test pass against the user
flows called out in its "Risk of the fix" note before merging, per the ground rule
above.
