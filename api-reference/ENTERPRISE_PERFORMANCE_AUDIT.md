# Enterprise Performance & Local-First Architecture Audit

**Date:** 2026-07-20
**Scope:** Full-stack audit — frontend (customer + restaurant-admin), backend (NestJS/Prisma),
build tooling, printing pipeline, local-first/offline architecture, horizontal-scaling readiness.
**Companion docs:** `PERFORMANCE_INVESTIGATION.md` (2026-07-01 diagnosis) + `PERFORMANCE_RESULTS.md`
(passes 0–5, closed 2026-07-17) already did the *backend query/connection-pool* audit in depth.
This document does **not** repeat that work — it verifies it's still holding, then covers
everything those docs didn't: React rendering, state architecture, bundle/PWA/local-first,
Node.js event-loop hygiene outside `orders.service.ts`, and multi-instance scaling.

---

## 0. Corrections to the brief

Three assumptions in the audit request don't match this codebase — flagging so the rest of
this report isn't read as contradicting the request:

| Assumed | Actual |
|---|---|
| MongoDB | **PostgreSQL via Prisma 6** (Supabase-hosted). Audited as Postgres below. |
| Zustand/Redux | **Hand-rolled React Context** (`AdminStore`, `MenuContext`, `SessionContext`, `BootContext`). No state library in any `package.json` in the workspace. |
| TanStack Query | **Not present, and not recommended here** — see §4.1. Server state is pushed live via SSE and mutated in place; Query's poll/refetch model would be a regression for the realtime paths. |

---

## 1. What's already solved — don't re-touch

`PERFORMANCE_RESULTS.md` closed these, verified still true as of this audit:

- Connection pooling: direct Postgres connection, `connection_limit=8`, no pool starvation.
- Auth/tenant DB tax: `tenant.service.ts` now has a 5-min `TtlCache` with invalidation
  (confirmed present at `services/api/src/tenant/tenant.service.ts:14-46`).
- N+1s in `addRound`/`updateItem`/`cancel`: collapsed into transactions + `relationJoins`.
- `Order(tenantId, createdAt)` and `OrderItem(tenantId, status)` indexes: **confirmed present**
  in `schema.prisma:541,585` with comments matching the original recommendation exactly.
- `admin.service.ts` platform analytics: **confirmed fixed** — `getPlatformAnalytics()` (line
  181) now uses `payment.aggregate`/`groupBy` for all-time totals and bounds the two `findMany`
  calls to 30/60-day windows (lines 193-200), not an unbounded scan.
- Analytics deep-include-and-sum-in-JS: fixed per pass 5.

**Remaining backend item, already tracked:** Mumbai (ap-south-1) region cutover — kit is ready,
blocked on infra creation (see `MUMBAI-CUTOVER.md`, [[mumbai-cutover-pending]] in memory). Not
re-litigated here.

---

## 2. New findings

### 2.1 Customer app (`apps/customer`)

| # | File:line | Issue | Fix | Impact |
|---|---|---|---|---|
| 1 | `context/MenuContext.jsx:76-84` | `welcome` filter/slice and the provider `value` object are rebuilt every render, no `useMemo` — the one context in the app that doesn't follow the pattern `BootContext`/`SessionContext` already use | `useMemo(() => ({ items, categories, welcome, loading, error }), [items, categories, welcome, loading, error])`, and memoize `welcome` itself keyed on `items` | Low-medium — re-renders every menu/welcome consumer on unrelated boot-state changes |
| 2 | `screens/MenuScreen.jsx:17-22,95` | Filtered lists recomputed inline every render; item rows aren't `React.memo`; inline `onClick={() => setSheetItem(item)}` per row | `useMemo` the filter; extract `MenuItemCard = React.memo(...)`; pass `id` + a stable callback | Low — item counts are small (dozens), hygiene fix not a measured bottleneck |
| 3 | **PWA claim is false** — no service worker, no manifest, no install prompt anywhere in `apps/customer` (`vite.config.js`, `public/`, `index.html`, `main.tsx` all checked) | Docs call this a "guest ordering PWA" but it has zero offline/installable capability | Either add `vite-plugin-pwa` + manifest + SW, or stop calling it a PWA in docs so expectations match reality | Correctness-of-claim, not a perf number |
| 4 | `App.jsx:10-16`, `vite.config.js` | No route-level code splitting anywhere — every screen is a static import; build output is one 382 KB JS bundle | Convert screen routes to `React.lazy` + `Suspense` (react-router-dom v7 supports lazy route modules) | Moderate — cuts first-paint bundle size; all screens sit behind the same boot gate so the win is bytes-on-first-load, not codepath elimination |
| 5 | Occupancy check historically loaded full `ROUND_INCLUDE` via `orders.list("open")` | **Already fixed** — both `BootContext.jsx:151` and `SessionContext.jsx:163` now call the dedicated lightweight `api.orders.openTableIds()` | `PERFORMANCE_INVESTIGATION.md` and `docs/qr-entry-flow.md` still describe the old heavy call — **update those docs**, they're stale relative to the code | Doc accuracy only |

**Local-first verdict for this app (§5 below has the full reasoning): do not build an
IndexedDB/outbox queue for ordering.** Dine-in ordering requires a server-verified, device-bound,
occupancy-checked session — queuing writes offline would either silently fail to reach the
kitchen or replay against a session that's since closed. The one legitimate local-first win is
read-only menu caching (menu changes a few times a day; currently re-fetched fresh every boot).

### 2.2 Restaurant-admin app (`apps/restaurant-admin`)

| # | File:line | Issue | Fix | Impact |
|---|---|---|---|---|
| 1 | `store/AdminStore.tsx:293-320,354,905-921` | **Monolithic context** — one `useState<AdminState>` covers menu+floor+sales+tenant; one `useMemo`'d context value keyed on the whole `state`. 12 files call `useAdmin()`. A KDS/floor SSE tick (`applyTables`, lines 383-386) creates a new `state` object → re-renders **every** mounted consumer, including `Shell.tsx`'s always-mounted `SideNav` and whatever page is open, regardless of whether it reads floor data | Split `AdminState` into 3 independent `useState` slices (menu / floor / sales) inside the same provider, expose 3 separately-memoized sub-values (`menuValue`, `floorValue`, `salesValue`) instead of one combined object. Keep the provider as the single SSE-subscription owner — don't introduce TanStack Query, it would fight the existing SSE-push + optimistic-mutate model | **2-4x fewer unrelated-page re-renders** during busy service — every order event currently touches all mounted consumers instead of just the floor slice |
| 2 | `kds/KdsPage.tsx:103`, `TicketCard.tsx`, `KdsColumn.tsx` | Per-column `.filter()` done inline 3x per render (new array each time); neither component is `React.memo` | `React.memo` on both, `useMemo(() => groupByStage(tickets), [tickets])` in `KdsPage` | Low-medium — good already (per-card `useTick` isolation, no virtualization needed at realistic ticket counts) |
| 3 | `TablesPage.tsx:32-37,78` | `requests.filter(r => r.tableId === t.id)` computed **inside** the table `.map()` — O(n·m) every render; `TableCard` not memoized | Build a `Map<tableId, requests[]>` once via `useMemo`, `React.memo(TableCard)` | Low — table counts are small, but the O(n·m) pattern is worth fixing on principle |
| 4 | `MenuPage.tsx:35,61-73,474,591` | Derived lists (`itemsInCat`, `countFor`, etc.) recomputed inline; `ItemCard`/`ItemRow` not memoized | `useMemo` the derivations, `React.memo` the row components | Low-medium — a single price edit currently re-renders the whole visible grid |
| 5 | `OrderHistoryPage.tsx:190-192` | No pagination on "All time" range; renders all `sales` rows unvirtualized | Add a page/date-window limit server-side before ever considering virtualization | Low today, will matter once tenants accumulate months of history |
| 6 | Routing/code-splitting | **Already correct** — every page except `LoginPage`/`ChangePasswordPage` is `React.lazy`-loaded (`App.tsx:12-74`), `vite.config.ts` has a vendor + qrcode.react chunk split | No action | — |
| 7 | SSE/realtime duplication | **Already correct, not duplicated** — `AdminStore` owns the one `/orders/stream` connection; `useKds` consumes it via `subscribeOrderEvents` rather than opening a second stream; `useServiceRequests` is a genuinely separate data domain on its own stream. Debouncing (`refreshSalesSoon` 200ms, focus-poll 150ms) already in place | No action | — |

### 2.3 Backend — areas outside the original DB/pool audit

| # | File:line | Issue | Fix | Difficulty | Impact |
|---|---|---|---|---|---|
| 1 | `loyalty/loyalty.service.ts:89` (`list()`) → `backfillLoyaltyAccountsFromOrders` (lines 20-57) | Runs on **every single call to the loyalty directory** (every page load / keystroke-search), including a sequential `for` loop doing `upsert` + `updateMany` (2 round trips, unbatched) per orphaned phone number found | Run backfill once — on loyalty-program enable or as an idempotency-guarded background step — not inline in `list()`. If it must stay inline, `Promise.all` the per-account writes instead of the sequential loop | Low-medium | Medium — real N+1 the original audit never saw (postdates it); worst on tenants with large pre-existing order history who just enabled loyalty |
| 2 | `auth/auth.service.ts:118,223,227`, `admin/admin.service.ts:102,339`, `members/members.service.ts:107` | `bcryptjs` (pure-JS) at cost factor 10 — reasonable cost, but pure-JS hashing runs on the main thread instead of libuv's thread pool | Swap to native `bcrypt` or `@node-rs/bcrypt` — drop-in API-compatible | Low (needs a native build step in deploy) | Low-medium — only under concurrent auth bursts, not normal order-flow traffic |
| 3 | Print pipeline (`services/print-agent`) | **Confirmed already fully decoupled** from the checkout request — `PaymentCompletePage.tsx` calls the agent from a manual button handler, never inside `capturePayment`. All physical I/O is async (`net.Socket` with 8s timeout, `execFile` not `execFileSync`). PNG logo processing is synchronous but bounded (`LOGO_MAX_HEIGHT_DOTS=240`) — sub-millisecond, not a real hazard | No action needed on decoupling | — | — |
| 4 | `services/print-agent/src/index.ts` | **No print-job queue/mutex per printer.** Two near-simultaneous requests to the same physical network printer (e.g. a KOT + a receipt reprint) open independent sockets with no serialization — could interleave/corrupt output on a single-connection ESC/POS printer | Add an in-memory per-printer-id promise chain (`.then()`) in the agent before dispatch | Low | Low-medium — only matters once KOT printing is wired (see next row) and two jobs land close together |
| 5 | KOT printing | **Confirmed still unwired** — `POST /print/kot` and all its renderers exist, but zero callers anywhere in `restaurant-admin` or `services/api`. This is a documented gap (CLAUDE.md flow 9), not a regression | Wire it as **fire-and-forget from the browser**, triggered off the existing `type:"updated"` order SSE event (same trust model as receipts — build the `Kot` payload client-side, call the agent directly, don't await it before letting the UI proceed). **Do not** add it inside `addRound`/`capturePayment` on the API — that would reintroduce a synchronous cross-service dependency on till/printer reachability that the DB-side audit spent 5 passes removing | Medium (new feature, not a fix) | High — this is the last unimplemented core flow in the printing story |
| 6 | `turbo.json` | Task-level caching (`outputs`) is configured; **no remote cache** (`remoteCache` block absent, no `TURBO_TOKEN`/`TURBO_TEAM`) | `turbo login && turbo link`, or a self-hosted cache server, for CI | Low | Build-time only, not runtime |
| 7 | `packages/domain` build | Plain `tsc` → unminified per-file ESM `dist/` | **Confirmed fine, not a bug** — consuming apps tree-shake/minify at the Vite/Rollup layer when bundling; no double-bundling | — | — |

### 2.4 Structural finding: the SSE event bus doesn't survive horizontal scaling

Not covered by any prior doc — this is new. `OrdersEvents` (`services/api/src/orders/orders.events.ts`)
and `ServiceRequestsEvents` are **in-process rxjs `Subject`s**:

```ts
@Injectable()
export class OrdersEvents {
  private readonly subject = new Subject<TenantEvent>();
  emit(tenantId: string, event: OrderEvent): void {
    this.subject.next({ tenantId, event });
  }
  stream(tenantId: string): Observable<...> { ... }
}
```

This works perfectly for a **single API process** (today's deployment — there's no
`Dockerfile`/`docker-compose`/`ecosystem.config` anywhere in the repo, confirming single-instance
is the current and only deployment shape). It silently breaks the moment the API is scaled
horizontally: a mutation handled by instance A never reaches a client whose SSE connection landed
on instance B. Staff on one App Engine/ECS/PM2-cluster worker wouldn't see orders mutated via
another — indistinguishable from a random dropped realtime update, exactly the kind of bug that's
hard to reproduce and easy to misattribute to the network.

**This is the single most important item for "scales to thousands of restaurants."** Options,
in order of effort:
1. **Sticky sessions** at the load balancer (route each tenant/client to the same instance) — zero
   code change, but caps effective capacity per instance and complicates zero-downtime deploys.
2. **Postgres `LISTEN`/`NOTIFY`** as the cross-instance bus — no new infra (already on Postgres),
   modest payload-size limit (~8KB per notification, fine for order-event payloads), each instance
   keeps one dedicated `LISTEN` connection outside the main pool.
3. **Redis pub/sub** — standard, well-understood, adds one new piece of infra.

Given the project has zero infra beyond Postgres today, **option 2 (Postgres LISTEN/NOTIFY)** is
the right fit: no new service to operate, and the event payloads (`OrderEvent`/`ServiceRequestEvent`)
are already small JSON. This becomes load-bearing the moment a second API instance is deployed —
worth deciding *before* that happens, not after a customer reports "orders don't show up sometimes."

---

## 3. API categorization (sync tiers)

| Tier | Endpoints | Current behavior | Verdict |
|---|---|---|---|
| **Critical — must sync immediately** | `POST /orders`, `/:id/rounds`, `PATCH /:id/items/:itemId`, `/:id/cancel`, `/:id/payment`, `/:id/bill`; `POST /service-requests` + status updates; KDS item-status advances | Already synchronous + SSE-broadcast, correctly optimistic on the admin side (`AdminStore` applies stream events directly, no refetch) | **No change** — this tier is already built correctly |
| **Medium — seconds is fine** | Menu CRUD, table CRUD, roles/members, tenant/branding/printer/profile settings, loyalty account adjustments | All synchronous request/response, no SSE needed (low mutation frequency, single-actor-at-a-time in practice) | Fine as-is; not worth adding async infra for admin-only, low-frequency writes |
| **Low — batch every 15-60 min** | `GET /orders/analytics`, `GET /admin/analytics` (platform), `GET /orders/sales` for large ranges, `AuditLog` reads, **loyalty backfill** (§2.3 #1) | Analytics already SQL-aggregated (pass 5); loyalty backfill is the one item in this tier still running inline on a hot path instead of batched | Move loyalty backfill off the request path (see §2.3 #1); everything else in this tier is already appropriately shaped (on-demand aggregation, not a live stream) |

No endpoint in this system needs a message queue / background-job system in the traditional
sense — the mutation volume per tenant (a single restaurant's order flow) doesn't justify one, and
introducing one would add an operational dependency for no measurable latency win. The one
legitimate "background work" candidate is the loyalty backfill and the not-yet-wired KOT print
job, both fire-and-forget by nature, not queue-worthy at this scale.

---

## 4. Local-first architecture audit

### 4.1 Where NOT to do it (and why)

The customer app is **dine-in ordering**, not a true offline app: every write depends on a
server-verified, occupancy-checked, device-bound session, and the guest's mental model is "the
kitchen sees this now." An outbox queue for `addRound`/service-requests would let the UI claim
success while the kitchen never receives the ticket (silent failure, worse than today's
fire-and-forget-with-toast) or replay a stale write against a session that's since closed
(correctness bug). **Recommendation: don't build this.**

Similarly, on the admin side, replacing the SSE-push + optimistic-context-mutate pattern in
`AdminStore` with TanStack Query would be a regression — Query's model is poll/refetch-on-focus,
and this app already has a strictly better mechanism (server-pushed events applied directly to
state). Don't introduce it.

### 4.2 Where it genuinely helps

| Screen/data | Recommendation | Why |
|---|---|---|
| Customer menu (`MenuContext`) | Cache the `GET /menu` response in `localStorage` keyed by tenant slug, serve-stale-then-revalidate in the background | Menu changes a few times a day; today it's a full network fetch on every boot/refresh. Read-only, no correctness risk. |
| Nothing else in either app | — | Every other piece of client state is either already realtime (SSE) or inherently short-lived (cart, in-session UI state) — there's no other screen where "instant from cache, reconcile later" beats "instant from a live push." |

### 4.3 PWA/offline claim

There is **no service worker, no manifest, no install capability** anywhere in `apps/customer`
today (§2.1 #3). If offline/installable behavior is an actual product goal, it's a from-scratch
build (`vite-plugin-pwa` + manifest + SW), not a tuning task. If it isn't a goal, the "PWA" label
in `CLAUDE.md` and elsewhere should be corrected — it currently overpromises relative to the code.

---

## 5. Performance Report

### Performance Score: **78 / 100**

| Layer | Score | Basis |
|---|---|---|
| Database / query layer | 92 | 5 completed optimization passes, indexes verified current, RTT floor reached; only the Mumbai region move remains, and that's an infra step, not code |
| API/backend service layer | 85 | Auth/tenant caching, transaction collapsing, bounded analytics all confirmed fixed; loyalty backfill N+1 and bcryptjs threading are the only real gaps found |
| Realtime/SSE architecture (single-instance) | 90 | Well-designed, no duplicate connections, correctly coalesced on the client |
| **Realtime/SSE architecture (multi-instance readiness)** | **35** | In-process pub/sub has no cross-instance path — this is the actual ceiling on "thousands of restaurants" today |
| Frontend — customer app | 72 | Good context hygiene in 2/3 contexts, zero code-splitting, false PWA claim, one un-memoized context |
| Frontend — restaurant-admin app | 70 | Excellent routing/lazy-loading/SSE architecture, undercut by one monolithic state context causing broad unrelated re-renders |
| Printing pipeline | 88 | Correctly decoupled from checkout, async I/O throughout; missing a print-job mutex and the KOT wire-up |
| Build tooling | 80 | Good chunk splitting already in place; no remote cache |

The blended score reflects a system where the **hard, latency-critical work (DB/query path) is
genuinely done well** — this is not a system full of naive bottlenecks. What's left is (a) one
structural scaling gap that only bites at multi-instance deployment, and (b) ordinary React
hygiene debt (missing memoization, one monolithic context) that costs re-renders, not seconds.

### Critical Issues
- **SSE event bus is single-instance-only** (§2.4) — must be resolved before horizontal scaling, not after.

### High Priority Issues
- KOT printing unwired (§2.3 #5) — last incomplete core flow.
- `AdminStore` monolithic context causing 2-4x unnecessary re-renders app-wide on every order event (§2.2 #1).
- Loyalty directory backfill running inline per-request with a sequential N+1 loop (§2.3 #1).

### Medium Issues
- Customer app has zero code-splitting, one 382 KB monolithic bundle (§2.1 #4).
- `bcryptjs` on the main thread instead of native/thread-pooled bcrypt (§2.3 #2).
- No print-job mutex per physical printer (§2.3 #4).
- KDS/Menu/Tables pages missing `React.memo` on row components + inline derived-list recompute (§2.2 #2-4).

### Low Issues
- `MenuContext` missing `useMemo` on its provider value (§2.1 #1).
- `OrderHistoryPage` unbounded "All time" range with no pagination (§2.2 #5).
- No Turbo remote cache (§2.3 #6) — CI/build-time only.
- Stale docs referencing the already-fixed heavy occupancy check (§2.1 #5).
- Customer app mislabeled as a PWA with no actual offline/installable capability (§4.3).

### Quick Wins (<30 minutes each)
- `useMemo` the `MenuContext` provider value and `welcome` derivation.
- `React.memo` on `TicketCard`, `KdsColumn`, `ItemCard`/`ItemRow` (customer + admin), `TableCard`.
- Add per-printer promise-chain mutex in the print agent.

### Medium Improvements (<1 day each)
- Move loyalty backfill out of the `list()` request path.
- Swap `bcryptjs` → native `bcrypt`/`@node-rs/bcrypt`.
- Route-level code-splitting for the customer app's screens.
- Menu response caching in `localStorage` with background revalidation.
- `turbo link` for remote build caching.

### Major Improvements (<1 week)
- Split `AdminStore`'s `AdminState` into 3 memoized slices (menu/floor/sales) without changing its
  SSE-push/optimistic-mutate model.
- Wire KOT printing off the existing order-event stream, fire-and-forget from the browser.

### Enterprise Improvements
- **Replace the in-process `OrdersEvents`/`ServiceRequestsEvents` Subjects with Postgres
  `LISTEN`/`NOTIFY`** (or Redis pub/sub) so realtime survives horizontal scaling — this is the one
  change that gates going from "one API process" to "many."
- Once multi-instance, re-verify the direct-Postgres connection math in `PERFORMANCE_RESULTS.md`
  (`instances × connection_limit` against Postgres' ~60-client cap) — today's `connection_limit=8`
  assumes a single instance.

### Estimated gains
- **Performance gain:** Frontend fixes: roughly 2-4x fewer re-renders during busy admin service
  (context split) plus a smaller, faster-loading customer bundle. Backend fixes are narrow
  (loyalty directory, auth-burst throughput) — the big backend win (Mumbai RTT) is already
  quantified in `PERFORMANCE_RESULTS.md` (~8-10x on `addRound`, not restated here).
- **API reduction:** None of the client-side findings here reduce API *call count* — that work
  (refetch-storm elimination, coalesced polling) is already done per `PERFORMANCE_RESULTS.md` pass 0.
- **Render reduction:** ~2-4x on `restaurant-admin` during live order activity (context split);
  modest on customer app (list memoization touches dozens of nodes, not hundreds).
- **Memory savings:** Minor — no leaks found; `useKds`'s existing stale-ticket sweep already
  bounds KDS board memory over a long shift.
- **Network savings:** One round-trip per customer-app boot if menu caching is added; negligible
  elsewhere (client is already lean).
- **Database savings:** None outstanding — closed by the prior audit passes.

---

## 6. Refactoring roadmap, ordered by impact

### 1. Decide the cross-instance realtime strategy (Postgres LISTEN/NOTIFY)
**Difficulty:** Medium · **Risk:** Medium (touches every SSE emit path) · **Expected improvement:**
Unblocks horizontal scaling; without it, scaling API instances silently breaks realtime for a
fraction of clients · **Files:** `services/api/src/orders/orders.events.ts`,
`services/api/src/service-requests/service-requests.events.ts`, both `*.controller.ts` `@Sse`
routes · **Estimated time:** 2-3 days including load-test verification.
*Do this before, not after, provisioning a second API instance — it's much easier to design in
now than to retrofit once multi-instance is live and dropping events in production.*

### 2. Wire KOT printing off the order-event stream
**Difficulty:** Medium · **Risk:** Low (additive, fire-and-forget, mirrors the existing
receipt-print trust model) · **Expected improvement:** Closes the last incomplete core flow ·
**Files:** new `printKot()` in `apps/restaurant-admin/src/lib/printAgent.ts`, a subscriber in the
KDS/order view keyed off `type:"updated"` events, `services/print-agent` routes already exist ·
**Estimated time:** 1-2 days.

### 3. Split `AdminStore`'s state into memoized slices
**Difficulty:** Medium · **Risk:** Medium (12 call sites of `useAdmin()` to verify) · **Expected
improvement:** 2-4x fewer unrelated re-renders app-wide during live service · **Files:**
`apps/restaurant-admin/src/store/AdminStore.tsx` · **Estimated time:** 1 day including a pass over
all 12 consumers to confirm no one relies on getting a single combined object.

### 4. Move loyalty backfill off the request path
**Difficulty:** Low-medium · **Risk:** Low · **Expected improvement:** Removes an unbatched N+1
loop from every loyalty-directory read · **Files:**
`services/api/src/loyalty/loyalty.service.ts:20-57,89` · **Estimated time:** Half a day.

### 5. Print-job mutex per printer + native bcrypt swap
**Difficulty:** Low · **Risk:** Low · **Expected improvement:** Prevents interleaved output once
KOT printing goes live; frees the main thread under concurrent auth bursts · **Files:**
`services/print-agent/src/index.ts` (new queue), `services/api/src/auth/auth.service.ts` +
`admin.service.ts` + `members.service.ts` (bcrypt import swap) · **Estimated time:** Half a day combined.

### 6. Customer-app code splitting + menu caching
**Difficulty:** Low · **Risk:** Low · **Expected improvement:** Smaller first-load bundle; one
fewer network round-trip on repeat visits · **Files:** `apps/customer/src/App.jsx`,
`apps/customer/src/context/MenuContext.jsx` · **Estimated time:** Half a day.

### 7. React.memo / useMemo pass (KDS, Menu, Tables, MenuContext)
**Difficulty:** Low · **Risk:** Low · **Expected improvement:** Incremental re-render reduction on
top of item 3; mostly hygiene · **Files:** listed per-finding in §2.1/§2.2 · **Estimated time:** 1 day.

### 8. Turbo remote cache
**Difficulty:** Low · **Risk:** None · **Expected improvement:** Faster CI/cold builds only, no
runtime effect · **Files:** `turbo.json`, CI config · **Estimated time:** 1-2 hours.

### 9. Decide the PWA question and correct the label either way
**Difficulty:** N/A (decision, not code) · **Risk:** None · **Files:** `CLAUDE.md`, product docs,
optionally `apps/customer` if offline is actually wanted · **Estimated time:** N/A — a product
decision, flagged here so it doesn't get built on a false premise.
