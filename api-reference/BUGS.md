# Bug Log — TableFlow

> **Purpose:** a structured, machine-readable list of bugs found while using the app,
> so an AI (or a dev) can pick them up and fix them one by one. Add new bugs under
> "Open"; move them to "Fixed" with the commit/date when done.
>
> **How to use (for the AI):** each bug has a stable `ID`, the raw symptom as the user
> reported it, a repro, the expected behavior, a root-cause hypothesis, and the
> suspected files. Treat `Reported` as ground truth about what the user saw; treat
> `Analysis` as a hypothesis to verify before changing code. Don't fix until asked —
> this file is the backlog.

**Status legend:** 🔴 open · 🟡 investigating · 🟢 fixed · ⚪ won't-fix / by-design

**Severity:** S1 blocker · S2 major · S3 minor · S4 cosmetic

**App routing recap** (context for URL bugs): the guest QR URL is
`http://<host>:5173/<tenantSlug>/t/<qrToken>`. The table is resolved by
`api.tables.byQrToken(qrToken)` which is **scoped to the tenant** — the lookup is
`WHERE tenantId = <slug's tenant> AND qrToken = <qrToken>`. Seeded QR tokens are
`"<slug>-<tableLabel>"` (e.g. `amber-grain-t2`, `green-bowl-2`).

---

## Open

### BUG-005 — 3+ admin tabs in one Chrome saturate the HTTP/1.1 connection cap; every API call then hangs 🔴 S1
- **Reported:** found during perf pass 3 (2026-07-17): with dashboard + tables +
  KDS-display tabs open (plus one more), the customer app's boot fetches hung
  until the api-client's 15s timeout ("This code didn't work / We couldn't reach
  the restaurant") while the API answered curl in ~100ms the whole time.
- **Repro:** open 3–4 restaurant-admin tabs in one Chrome profile (any mix of
  routes), then load any page that calls the API from that same profile. Check
  `Get-NetTCPConnection -LocalPort 3001 -State Established` → exactly 6
  Chrome-owned connections; further fetches queue behind them indefinitely.
- **Expected:** any realistic number of panel tabs on a till PC keeps working.
- **Analysis (confirmed):** every admin tab holds TWO permanent SSE streams
  (`/orders/stream` + `/service-requests/stream` — `ServiceRequestsProvider` is
  mounted app-wide in `main.tsx`, so even chrome-free `/kds/display` carries the
  notification-bell stream it never renders). Chrome caps HTTP/1.1 at ~6
  concurrent connections **per host:port across all tabs of a profile**; SSE
  occupies a connection permanently, so 3 tabs ≈ the whole budget and the next
  fetch waits forever. Symptom is identical to the old BUG-003 pool starvation
  (multi-second hangs, healthy API) — diagnose with netstat before blaming the DB.
- **Suspected files:** `apps/restaurant-admin/src/main.tsx` (provider mount),
  `apps/restaurant-admin/src/notifications/useServiceRequests.tsx`,
  deploy infra (no HTTP/2 termination in front of the API).
- **Fix plan:** (1) **deploy requirement, non-negotiable for launch** — terminate
  HTTP/2 at the reverse proxy in front of the API (see DEPLOY-RUNBOOK.md step 2b);
  HTTP/2 multiplexes all streams over one connection and dissolves the cap.
  (2) client mitigation, separate scoped task — don't mount the service-requests
  stream on routes that don't render the bell (`/kds/display`), and/or share one
  stream across tabs via SharedWorker/BroadcastChannel.
- **Status:** 🔴 open — mechanism confirmed by connection counting; fix not started.

<!--
TEMPLATE for new bugs — copy this block:

### BUG-00N — <one-line title> <status emoji> <severity>
- **Reported:** <verbatim what the user saw>
- **Repro:** <steps / URL>
- **Expected:** <what should happen>
- **Analysis:** <root-cause hypothesis, to verify>
- **Suspected files:** <paths>
- **Status:** <emoji + note>
-->

## Fixed

### BUG-004 — Staff "Add Item" / Quick Sale save 403s: "This session belongs to another device" 🟢 S1
- **Reported:** found during a Quick Sale performance rework (batching qty-change
  calls) — clicking **Save & Charge** on a freshly-created counter order 403'd.
  Reproduced independently on the plain, untouched dine-in flow: open any table
  → **Add Item** → 403, every time, on the very first round.
- **Repro:** Tables → Open Session on any free table → Add Item → pick anything →
  Add. Or: Quick Sale → Add Item → Save & Charge.
- **Expected:** staff can add items to any order they manage.
- **Analysis (confirmed):** `OrdersService.addRound` (`orders.service.ts:171`) calls
  `assertOrder(tenantId, orderId, deviceId)` with no `trusted` flag → defaults
  `false` → `assertDevice` requires the caller's `X-Device-Id` to match the order's
  stored `deviceId`. Staff (restaurant-admin) never sends `X-Device-Id`, so this
  100% of the time throws `ForbiddenException`, regardless of whether the order was
  guest-opened or staff walk-in-opened. The sibling `addItem` endpoint already
  handles this correctly (`orders.service.ts:433`, `assertOrder(..., undefined,
  true)`, commented "Staff route (JwtAuthGuard)"), and the controller already has
  a reusable `isStaff(authHeader, tenantId)` helper (verifies a bearer JWT,
  tenant-matched) used by `GET /orders/:id` and `POST /orders/:id/payment` — but
  `POST /orders/:id/rounds` was never wired to it. Likely introduced by the
  security-audit commit that added the device-binding guard (`f195e78`), which
  correctly closed the guest-session-hijack gap but missed that `addRound` is also
  the batched staff add-item path (`AdminStore`'s `ADD_ORDER_ITEMS`, one call for
  N items instead of N `addItem` POSTs — and now Quick Sale's batched save).
- **Suspected files:** `services/api/src/orders/orders.controller.ts` (`addRound`),
  `services/api/src/orders/orders.service.ts` (`addRound`, `assertOrder`).
- **Status:** 🟢 fixed 2026-07-06 — `addRound`'s controller now calls the existing
  `isStaff` helper (same pattern as `GET /orders/:id`) and threads the result
  through as `trusted` to `OrdersService.addRound` → `assertOrder`. A valid,
  tenant-matched staff bearer token now bypasses the device-binding check (as
  `addItem` already did); guests with no token still go through the strict
  device-id match. Verified against both the dine-in "Add Item" flow and Quick
  Sale's Save & Charge.

### BUG-001 — Cross-tenant QR URL doesn't resolve 🟢 S2
- **Reported:** `http://10.180.23.82:5173/amber-grain/t/green-bowl-2` does **not**
  work, but `http://10.180.23.82:5173/amber-grain/t/amber-grain-t2` **does**. Also
  noted: "one tenant table is booking only" — that table may behave differently.
- **Repro:** open each URL in a browser on the LAN.
- **Expected (user):** the `green-bowl-2` table page should load.
- **Analysis (hypothesis, verify before fixing):** the URL mixes a tenant and a QR
  token from **different tenants**. `green-bowl-2` is the QR token of a table owned by
  the **green-bowl** tenant, but the URL puts it under the **amber-grain** slug.
  `TablesService.byQrToken(tenantId, qrToken)` filters by *both* tenant and token
  (`services/api/src/tables/tables.service.ts:113`), so `amber-grain + green-bowl-2`
  matches no row → 404 → the customer app shows "Invalid QR". `amber-grain-t2` works
  because its token *does* belong to amber-grain. **This is arguably correct tenant
  isolation, not a code bug** — the working URL for that table is
  `http://10.180.23.82:5173/green-bowl/t/green-bowl-2`.
- **Open questions / to confirm with user:**
  1. Where did the `.../amber-grain/t/green-bowl-2` link come from? A real QR code, or
     hand-typed? If a printed/generated QR encodes the wrong tenant slug, the bug is in
     **QR generation** (`apps/restaurant-admin/src/lib/tableQr.ts` — it should bake the
     table's own tenant slug), not resolution.
  2. What does "booking only" mean for that table — a table type/status we don't model
     yet? (No `bookingOnly` field exists on `Table` today.) If tables can be
     "booking-only," that's a **separate feature/bug** to spec.
- **Suspected files:** `apps/customer/src/context/BootContext.jsx` (parses slug+token,
  renders "Invalid QR"), `apps/restaurant-admin/src/lib/tableQr.ts` (QR link builder),
  `services/api/src/tables/tables.service.ts` (`byQrToken`).
- **Status:** 🟢 fixed 2026-07-02 — **root cause confirmed: QR generation**, not
  resolution. `tableQrUrl` (`apps/restaurant-admin/src/lib/tableQr.ts`) hardcoded
  `defaultTenant.slug` (`amber-grain`) into *every* tenant's QR link, so a Green
  Bowl table's printed QR encoded `/amber-grain/t/green-bowl-2` — which the
  tenant-scoped `byQrToken` correctly 404s (tenant isolation is by design and was
  left untouched). Fix: `tableQrUrl` now reads the **logged-in tenant's slug** at
  call time (`getStoredTenantSlug()`, same source as the api-client), falling back
  to `defaultTenant.slug` only pre-login. ⚠️ Any QR printed for a non-amber-grain
  tenant before this fix encodes the wrong slug and must be re-downloaded/reprinted
  from `/tables`. ("Booking only" remains an open question — no such table state
  exists in the model; spec separately if it's a real need.)

### BUG-002 — App/platform name shows "amber-grain" instead of "Amber" 🟢 S3
- **Reported:** "the whole app name is **amber** not **amber-grain** — that needs to
  be changed."
- **Expected:** per the product model (see CLAUDE.md), the **SaaS platform is "Amber"**;
  individual restaurants are tenants named at onboarding (e.g. "Amber & Grain",
  "Green Bowl"). The platform/app chrome should say "Amber", never the raw slug
  "amber-grain".
- **Analysis (hypothesis):** somewhere the tenant **slug** (`amber-grain`) is being
  rendered as a display name instead of the platform name "Amber" or the tenant's
  proper `name`. Candidate spots: the pre-login default tenant
  (`apps/restaurant-admin/src/tenant/defaultTenant.ts`, should be `name: "Amber"`),
  the sidebar "Powered by Amber" line / tenant title in `Shell`, or the customer app
  title/theme. Need to see the exact screen where "amber-grain" appears.
- **To confirm with user:** which screen/app shows "amber-grain" (customer app,
  restaurant-admin sidebar, browser tab title)? A screenshot or the exact text pins it.
- **Suspected files:** `apps/restaurant-admin/src/tenant/defaultTenant.ts`,
  `apps/restaurant-admin/src/components/Shell.tsx`, `apps/customer` title/theme,
  `index.html` `<title>` in each app.
- **Status:** 🟢 fixed 2026-07-02 — audit found no raw slug rendered in UI chrome
  (Shell/Splash/etc. all use `tenant.name`; admin `defaultTenant.name` was already
  "Amber"). The naming bugs were the **browser tab titles**: the customer app's
  `<title>` was hardcoded "Amber & Grain" for *every* tenant, and neither app
  updated it dynamically. Fixed: customer `index.html` ships the platform fallback
  "Amber" and `App.jsx` sets `document.title = tenant.name` once boot resolves the
  scanned tenant; restaurant-admin's `TenantThemeGate` sets `"<Tenant> · Amber"`
  post-login and reverts to "Amber" pre-login/logout. Display names only — never
  the slug.

### BUG-003 — Saves in Settings (roles/team/profile) time out after 15s, esp. non-default tenants 🟢 S1
- **Reported:** On other tenants (e.g. **Green Bowl**), managing profiles / roles /
  team and saving data "takes lots of time and some fails too — `Request timed out
  after 15000ms`." Creating a role hangs on **"Saving…"** (see screenshot); the Roles
  page also shows **"No roles yet"** even though Green Bowl was seeded with roles —
  i.e. the `roles.list` GET is failing/timing out too, not just the write. Affects the
  roles/team and `settings/roles` APIs broadly.
- **Repro:** log in to a non-amber-grain tenant → Settings → Roles → New Role → Save.
  Intermittently hangs ~15s then errors.
- **Expected:** saves complete in well under a second; roles list loads.
- **Evidence gathered:**
  - The `15000ms` message is the **api-client's own per-request timeout**
    (`packages/api-client/src/http.ts:98,112`, default 15s). So the client aborts —
    the **backend is simply not responding within 15s**, not a frontend logic bug.
  - `RolesService.create/list` (`services/api/src/roles/roles.service.ts`) are trivial
    single queries — they can't take 15s unless the **DB connection itself is
    unavailable**.
  - DB is Supabase's **session-mode pooler in `ap-southeast-1` (Singapore)** with
    **`connection_limit=5&pool_timeout=20`** (`services/api/.env`). With only 5
    connections and `pool_timeout=20`, once all 5 are busy a new query **waits up to
    20s** for a free one — the client's 15s abort fires first → exactly this symptom.
  - **No connection leak in code:** only one `$transaction` and it's the non-interactive
    array form (released immediately, `orders.service.ts:539`); the SSE event bus uses a
    single shared rxjs `Subject` (no per-connection DB hold). So the pool isn't being
    *leaked* — it's just **small + saturated under bursts**.
- **Leading hypothesis (verify before fixing):** **DB connection-pool exhaustion /
  pooler latency.** Switching tenant / opening Settings fires a **burst of parallel
  requests** (AdminStore refetches menu + floor + sales, the Roles/Team pages fetch
  roles + members, SSE streams reconnect) — and every authenticated request also runs
  `resolveAuthUser` (up to 2 queries, only 30s-cached). That burst easily exceeds 5
  concurrent connections to a ~Singapore-distant pooler, so the tail requests queue past
  15s and abort. It *looks* tenant-specific because amber-grain is the warm default and
  a tenant-switch is the worst-case burst; the backend code path is the same for all
  tenants.
- **Diagnostics to confirm the cause:**
  1. Add Prisma slow-query logging (`log: ["query"]` or `PRISMA_LOG=query`) and watch for
     `Timed out fetching a new connection from the connection pool` errors in the API log
     during a hang — that string = pool exhaustion (confirms it directly).
  2. Reproduce with the API and DB co-located (or against a local Postgres) — if the
     timeouts vanish, it's latency/pool, not logic.
  3. Watch active connections in Supabase's dashboard while reproducing.
- **Candidate fixes (once confirmed), least-risky first:**
  1. **Trim the request burst on the client** — don't refetch everything on tenant
     switch / Settings open; the Roles page shouldn't block on unrelated floor/sales calls.
  2. **Raise `connection_limit`** modestly (e.g. 5 → 8–10) — still under the 15-client
     session cap, more headroom for bursts. (CLAUDE.md's warning is about staying <15.)
  3. **Switch to Supabase transaction-mode pooler (port 6543)** for runtime, which
     supports many more short-lived connections — better fit for this short-query
     workload than session mode 5432. (Verify Prisma compatibility; keep 5432 direct for
     migrations.)
  4. **Move the DB region** closer to where the API runs, or run the API in ap-southeast-1.
- **Suspected/relevant files:** `services/api/.env` (pool config),
  `services/api/src/prisma/prisma.service.ts`, `packages/api-client/src/http.ts`
  (timeout), `apps/restaurant-admin/src/store/AdminStore.tsx` (refetch bursts),
  `apps/restaurant-admin/src/pages/*Roles*`/`*Team*` (fetch-on-open),
  `services/api/src/auth/auth.service.ts` (`resolveAuthUser` per-request queries).
- **Status:** 🟢 fixed 2026-07-02 — two-part fix (candidate #2 + UI honesty):
  1. **Pool headroom** (the live `services/api/.env`, mirrored into `.env.example`):
     `connection_limit=5&pool_timeout=20` → **`connection_limit=10&pool_timeout=10`**.
     10 connections absorb the tenant-switch/Settings-open burst while staying
     under the pooler's 15-client session cap; `pool_timeout=10` makes a genuinely
     saturated pool fail fast *with a clear Prisma pool error* instead of hanging
     past the api-client's 15s abort (which produced the opaque
     "Request timed out after 15000ms"). Restart the API after changing `.env`.
  2. **UI: failed load ≠ empty list.** `RolesPage`/`TeamPage` rendered the
     "No roles yet." / "No team members yet." empty state whenever the GET failed
     (misreporting seeded tenants as empty) with no way to retry short of a page
     reload. Both now track load failure separately and render a
     "Couldn't load…" state with a **Retry** button; the error banner is also
     cleared on each reload attempt.
  Not done (deliberately): transaction-mode pooler (6543) and moving regions —
  bigger changes to take only if the symptom recurs; the request-burst trim is
  covered by the pool headroom for now.
