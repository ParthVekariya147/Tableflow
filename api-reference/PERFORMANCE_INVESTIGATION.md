# TableFlow — Complete Performance Investigation Report

**Date:** 2026-07-01
**Investigator:** Senior Staff Software Engineer (AI)
**Project:** Amber & Grain (Tableflow) — NestJS + Prisma + Supabase (PostgreSQL)
**Reported symptom:** API requests taking 15–20 seconds

---

## Executive Summary

**Overall Health Score: 32 / 100**

The platform is functional but has cascading performance problems. The 15–20 second response times are not caused by a single bug — they are caused by **four structural patterns that compound each other**:

1. A cloud database in Singapore with no local caching, hit 3–5 times per authenticated request with zero pooling headroom.
2. A 5-connection pool cap that serializes concurrent requests and can force 20-second waits.
3. A full 4-call refetch cycle after every admin mutation.
4. Analytics endpoints that load the entire dataset into Node.js memory instead of using SQL aggregation.

Under single-user load these produce 500ms–3s latency. Under concurrent use (2+ tabs open, or any SSE stream active alongside a mutation), the pool saturates and responses time out at exactly 20 seconds — the configured `pool_timeout`.

### Top 10 Bottlenecks (ranked by impact)

| # | Bottleneck | Est. Impact |
|---|-----------|-------------|
| 1 | Supabase connection pool capped at 5, `pool_timeout=20s` — queue starvation | 20s timeout under load |
| 2 | Supabase DB in Singapore (ap-southeast-1), ~80–150ms RTT from India per query | 3–5× additive per request |
| 3 | `JwtAuthGuard` re-resolves user from DB on every authenticated request (2 queries) | +160–300ms per request |
| 4 | `TenantMiddleware` hits DB for tenant on every request (no cache) | +80–150ms per request |
| 5 | `AdminStore.dispatch()` calls full `refresh()` (4 API calls) after every mutation | +800ms–3s per user action |
| 6 | `getAnalytics()` loads entire payment history with 6-level deep join, sequentially | 2–10s for any real data |
| 7 | `getPlatformAnalytics()` loads ALL payments with no `take` limit (unbounded scan) | Grows unboundedly |
| 8 | `updateItem()`/`requestBill()`/`addItem()` run 3–4 sequential DB queries each | +400–900ms per mutation |
| 9 | `SupabaseAuthGuard` makes an HTTP call to Supabase Auth API per super-admin request | +300–800ms per call |
| 10 | `addRound()` makes one DB lookup per item in the round (parallelized, but still N calls) | +80–150ms × N items |

---

## 1. Architecture Diagram — Request Lifecycle with Bottlenecks

```
Browser / React App
│
│  [A] Network call to NestJS on localhost:3001 (LAN hop, ~1ms)
│
▼
NestJS App (services/api)
│
│  [B] ThrottlerGuard — in-memory, free
│
│  [C] TenantMiddleware (EVERY request)
│      └─► prisma.tenant.findUnique(slug)
│           └─► [DB ROUND TRIP 1] ~80–150ms to Singapore
│           └─► No cache, runs every single request
│
│  [D] JwtAuthGuard (every authenticated request)
│      ├─► jwt.verifyAsync(token) — local, ~1ms
│      └─► auth.resolveAuthUser(tenantId, userId)
│           ├─► [DB ROUND TRIP 2] prisma.user.findUnique() ~80–150ms
│           └─► [DB ROUND TRIP 3] prisma.membership.findUnique(include: {role, tenant}) ~80–150ms
│
│  [E] Business Logic (service method)
│      └─► [DB ROUND TRIPS 4–7] actual queries, often sequential
│
│  [F] refreshAndEmit()  (after every mutation)
│      └─► [DB ROUND TRIP N] prisma.order.findFirst(ROUND_INCLUDE) — full nested load
│
▼
Supabase (pgBouncer pooler, Singapore)
│
│  [G] Pool: max 5 connections (connection_limit=5)
│      Request 6+ WAITS up to pool_timeout=20s
│      Under refetch storm + concurrent mutation: pool exhausted → 20s timeout
│      (corrected 2026-07-17: SSE streams do NOT hold slots — §2.1)
│
▼
Supabase PostgreSQL (Singapore region)
│
│  [H] Query execution + network return ~80–150ms RTT
│
▼
Back to NestJS → Client
```

**Minimum authenticated request overhead (before any business logic):**
- Middleware DB lookup: 80–150ms
- Auth guard DB lookups (×2): 160–300ms
- **Subtotal: 240–450ms baseline overhead per request**

---

## 2. Database Investigation

### 2.1 Connection Pool — CRITICAL

**File:** `services/api/.env:10`

```
DATABASE_URL="postgresql://...aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?connection_limit=5&pool_timeout=20"
```

**Problem:** The Prisma pool is limited to **5 connections**. Each request holds a connection for the duration of all its DB queries. Any concurrent request beyond the available slots must wait. Since `pool_timeout=20`, a queued request waits exactly 20 seconds before timing out — **explaining the observed 15–20 second hangs exactly**.

> ⚠️ **Correction (2026-07-17):** this section originally claimed each open SSE
> stream (`GET /orders/stream`) "occupies one pool slot continuously", leaving
> only 2 of 5 connections for requests. That is wrong — verified from
> `orders.controller.ts` `stream()`: an SSE connect runs exactly **one** Prisma
> snapshot query (whose connection returns to the pool when it resolves) and
> then merges the **in-process** rxjs Subject (`OrdersEvents`), which never
> touches the DB. An idle stream holds an HTTP socket, not a pool slot. The
> starvation (BUG-003) was real, but its drivers were the **4-call refetch
> storm after every mutation × multiple clients** (§5.1/§13.1) plus **3
> auth/tenant DB queries per request** (§3.1/§4) crammed into a 5-connection
> pool — both since fixed (perf passes 1–2, 2026-07-16). The same conflation of
> HTTP connections with DB connections appears in §5.2, §13.2, §14 and P4 #17;
> read those with this correction in mind.
>
> ⚠️ **Correction (2026-07-21) — superseding hypothesis for the P99 spikes.**
> The 2026-07-17 pass-3 config moved `DATABASE_URL` off this pooler entirely,
> to a **direct** connection (`connection_limit=8`, no `pool_timeout`, no
> pgbouncer). §3.1/§4's "3 auth/tenant DB queries per request" was also fixed
> (TTL caches with in-flight coalescing, `auth.service.ts`/`tenant.service.ts`).
> A follow-up investigation (2026-07-21) initially hypothesized the
> **auth-user cache's 5-minute TTL boundary** as the cause of remaining P99
> spikes (`GET /tables` 9.1s, `GET /orders/sales` 6.8s observed in one
> capture) — a real, naturally-occurring correlation, but **a controlled
> concurrent-load probe (N=4/8/12 simultaneous requests, no auth cache
> involved at all) reproduced the identical spike shape**, disproving auth-TTL
> as the cause. The actual mechanism, confirmed against Prisma's own
> connection-string defaults and the live Supabase project's session
> settings: Prisma's built-in pool closes a connection after
> `max_idle_connection_lifetime` (**default 300s** — the same period as the
> auth-cache TTL, hence the coincidental correlation) with no idle-session
> enforcement from the server side (`SHOW idle_session_timeout` on the live
> project returns `0`, i.e. disabled) — so the connection was reusable the
> whole time; Prisma's own client discarded it anyway. The next request after
> any ~5-minute quiet period pays a fresh TCP+TLS+auth handshake to Singapore
> (~1.2–1.5s observed per new connection in the N=8 burst, vs. ~200–350ms/query
> once warm). See `PERF_OPTIMIZATION_PROTOCOL.md`'s design-phase doc for the
> full evidence chain and candidate remedies (not yet implemented).

**Estimated cost:** Up to 20,000ms (timeout) when pool is saturated.
**Confidence:** CONFIRMED — the 20s timeout matches `pool_timeout=20`. (Mechanism re-attributed 2026-07-17, see correction above.)

### 2.2 Geographic Latency — HIGH

**File:** `services/api/.env:10`, `services/api/prisma/schema.prisma:19`

The Supabase project is in **ap-southeast-1 (Singapore)**. The developers are in India. Each DB round trip adds ~80–150ms of pure network latency (Singapore → India, ~6,000km).

With 3 DB queries per authenticated request (middleware + 2 auth) before business logic:
- Min overhead: 240ms (3 × 80ms)
- Max overhead: 450ms (3 × 150ms)

For a mutation that runs 4–5 additional queries, total DB time alone is **550–1,050ms**.

### 2.3 Missing Index: `Order(tenantId, createdAt)` — MEDIUM

**File:** `services/api/prisma/schema.prisma:360–364`

```prisma
model Order {
  @@index([tenantId])
  @@index([tenantId, status])
  @@index([tableId])
  @@index([serverId])
  // MISSING: @@index([tenantId, createdAt]) for analytics sorting
}
```

The `orders.service.ts:listSales()` runs:
```typescript
where: { tenantId, ...(ranged ? { createdAt } : {}) }
orderBy: { createdAt: "desc" }
```
Without a `(tenantId, createdAt)` composite index, this performs an index scan on tenantId then a sort on createdAt — expensive for large datasets. The `Payment` table has this index, but `Order` does not.

**Recommended index (not yet implemented):**
```sql
CREATE INDEX idx_order_tenant_createdat ON "Order"("tenantId", "createdAt" DESC);
```

### 2.4 N+1 Pattern in `addRound()` — HIGH

**File:** `services/api/src/orders/orders.service.ts:133–153`

```typescript
const lines = await Promise.all(
  dto.items.map(async (i) => ({
    modifiers: {
      create: await this.resolveItemModifiers(
        tenantId,
        i.menuItemId,  // ← one DB lookup PER item
        i.modifiers ?? [],
      ),
    },
  })),
);
```

`resolveItemModifiers()` (line 188) runs `prisma.menuItem.findFirst({ include: { modifierGroups: { include: { options: true } } } })` for **each item in the round**. A 3-item round = 3 parallel DB round trips to Singapore = 150ms minimum, 450ms maximum. While parallelized, each still costs a full round trip.

### 2.5 Sequential Queries in `updateItem()` — HIGH

**File:** `services/api/src/orders/orders.service.ts:377–411`

```typescript
// Query 1 (sequential)
const order = await this.prisma.order.findFirst({ select: { id, status } });
// Query 2 (sequential)
const item = await this.prisma.orderItem.findFirst({ select: { id } });
// Query 3 (sequential)
await this.prisma.orderItem.update({ where: { id: itemId }, data });
// Query 4 (sequential) — refreshAndEmit → get()
const row = await this.prisma.order.findFirst({ where: {id, tenantId}, include: ROUND_INCLUDE });
```

4 fully sequential DB calls, each ~80–150ms = **320–600ms** just for a KDS status advance. This is the most-called mutation (every time kitchen advances an item stage).

### 2.6 Sequential Queries in `requestBill()` — HIGH

**File:** `services/api/src/orders/orders.service.ts:276–286`

```typescript
await this.assertOrder(tenantId, orderId, deviceId);  // Query 1: order findFirst
await this.prisma.order.update({...});                  // Query 2: order update
return this.refreshAndEmit(tenantId, orderId, "updated");  // Query 3: order findFirst(ROUND_INCLUDE)
```

Loads the order **twice** (queries 1 + 3) sequentially. Query 1 is a lightweight existence check; query 3 loads the full deep include. They could be combined, but query 3's full include is always needed anyway, making query 1 redundant.

### 2.7 `getPlatformAnalytics()` Unbounded Full-Table Scan — HIGH

**File:** `services/api/src/admin/admin.service.ts:143–154`

```typescript
const [allPayments, payments30d, payments60d30d, activeSubs] = await Promise.all([
  this.prisma.payment.findMany({
    select: { total: true, method: true }
    // NO WHERE CLAUSE — loads ALL payments from ALL tenants EVER
  }),
  ...
]);
```

`allPayments` has **no `where` clause and no `take` limit**. As the platform scales, this becomes a full-table scan loading millions of rows into Node.js memory just to compute two sums (`totalGmvCents` + `methodSplit`). This should be a `payment.aggregate()` query.

Additionally, after the `Promise.all` resolves, there is a **second sequential query**:

```typescript
const activeSubRows = await this.prisma.subscription.findMany({...});  // ← sequential, after Promise.all
```

**Estimated cost:** 2s on a modest dataset, scales to 30s+ with thousands of payments.

### 2.8 Analytics — Deep Include + In-Memory Aggregation — HIGH

**File:** `services/api/src/orders/orders.service.ts:518–533`

```typescript
const payments = await this.prisma.payment.findMany({
  where: { tenantId, createdAt: { gte: from, lte: to } },
  include: {
    order: {
      include: {
        rounds: {
          include: {
            items: {
              include: {
                modifiers: true,
                menuItem: { include: { category: true } }   // 6 levels deep
              },
            },
          },
        },
      },
    },
  },
});
```

This loads the entire **payment → order → round → item → modifier + menuItem → category** graph into Node.js. For a 30-day analytics window with 200 payments × 4 rounds × 8 items, that's 6,400+ rows across multiple joins, serialized through pgBouncer and then deserialized in Node.js just to be summed in a for-loop.

Then immediately after (sequential):
```typescript
const prev = await this.prisma.payment.aggregate({...});  // ← runs AFTER the deep query
```

**Estimated cost:** 2–10s depending on date range. The analytics page is routinely the slowest endpoint in the system.

### 2.9 `addItem()` Sequential Queries — MEDIUM

**File:** `services/api/src/orders/orders.service.ts:304–368`

```typescript
const menuItem = await this.prisma.menuItem.findFirst({...});    // Q1
const rounds = await this.prisma.round.findMany({...});           // Q2 (sequential)
// then one of:
await this.prisma.orderItem.update / create / round.create({...}); // Q3 (sequential)
return this.refreshAndEmit(tenantId, orderId, "updated");          // Q4 (sequential)
```

Four sequential queries to add a single item to an order. Q1 and Q2 could be parallelized.

### 2.10 `assertOrder` Double-Loads the Order — MEDIUM

**File:** `services/api/src/orders/orders.service.ts:680–692`

```typescript
private async assertOrder(tenantId, orderId, deviceId) {
  const order = await this.prisma.order.findFirst({
    where: { id: orderId, tenantId },
    select: { id: true, deviceId: true },
  });
  ...
}
```

`assertOrder` runs before the actual mutation, which then calls `refreshAndEmit` → `get()` which loads the order **again** with the full `ROUND_INCLUDE`. The order is loaded twice sequentially. Methods affected: `addRound`, `requestBill`, `cancel`, `reclaimSession`.

### 2.11 Missing Composite Index: `OrderItem(tenantId, status)` — LOW

No index to filter active (non-cancelled) order items across a tenant. Currently uses `@@index([tenantId])` + `@@index([roundId])` only.

---

## 3. Authentication Performance

### 3.1 JWT Guard Re-Resolves User from DB Every Request — CRITICAL

**File:** `services/api/src/auth/jwt-auth.guard.ts:24–52`

```typescript
async canActivate(ctx: ExecutionContext): Promise<boolean> {
  // 1. Verify JWT — fast (local, ~1ms)
  payload = await this.jwt.verifyAsync<JwtPayload>(token);

  // 2. Re-resolve from DB on EVERY request — 2 DB queries
  req.authUser = await this.auth.resolveAuthUser(payload.tid, payload.sub);
  return true;
}
```

`resolveAuthUser()` (`auth.service.ts:216–245`) runs:
1. `prisma.user.findUnique({ where: { id: userId } })` — DB query 1
2. `prisma.membership.findUnique({ include: { role, tenant } })` — DB query 2

**Both are sequential**, adding 160–300ms to every authenticated request. The intent (permissions are re-read to pick up role changes immediately) is sound, but without caching it creates a permanent DB tax on every call.

**Affected endpoints:** All `roles/`, `members/`, and any route with `@UseGuards(JwtAuthGuard)`.

### 3.2 Supabase Auth API Call per Super-Admin Request — HIGH

**File:** `services/api/src/auth/auth.guard.ts:27–57`

```typescript
async canActivate(ctx: ExecutionContext): Promise<boolean> {
  const claims = await this.auth.verifySupabaseToken(token);
  // ↑ calls: admin.auth.getUser(token)
  // That's an HTTPS call to Supabase Auth API → ~200–500ms over internet

  const user = await this.prisma.user.findUnique({...});  // + another DB query
  return true;
}
```

Every super-admin request makes:
1. An HTTP call to Supabase Auth API (~200–500ms)
2. A DB query to Prisma (~80–150ms)

**Total: 280–650ms just for authentication** per super-admin request.

### 3.3 `GET /auth/me` — Always 2 DB Queries on Every App Load

**File:** `services/api/src/auth/auth.controller.ts:33–36`

```typescript
@Get("me")
@UseGuards(JwtAuthGuard)  // triggers resolveAuthUser() = 2 DB queries
me(@CurrentUser() user: AuthUser): AuthUser {
  return user;
}
```

The `me` endpoint itself does no DB work, but `JwtAuthGuard` already did 2 DB queries. On every app load (page refresh, `AuthContext` mount), this costs 160–300ms. Since `AuthContext.tsx:84` calls `api.auth.me()` on boot, this is the first thing users wait for.

---

## 4. Tenant Middleware — DB Hit on Every Request

**File:** `services/api/src/tenant/tenant.middleware.ts:29–31`

```typescript
req.tenant = await this.tenants.getBySlug(slug);
```

`getBySlug()` runs `prisma.tenant.findUnique({ where: { slug } })` on **every tenant-scoped request** with **no cache**. Tenants rarely change, but this DB call runs on every API hit.

Combined with the auth guard: **3 DB queries before any business logic starts on every authenticated call**.

**Estimated time per request:** 240–450ms overhead (3 queries × 80–150ms each).

---

## 5. Frontend Performance

### 5.1 AdminStore: Full Refresh After Every Mutation — CRITICAL

**File:** `apps/restaurant-admin/src/store/AdminStore.tsx:496–525`

```typescript
const dispatch = useCallback(async (action: Action): Promise<void> => {
  try {
    await apply(action);
  } finally {
    await refresh().catch(() => {});  // FULL REFRESH AFTER EVERY ACTION
  }
}, [apply, refresh]);
```

`refresh()` (lines 255–264) makes **4 parallel API calls**:
```typescript
const [tenant, menu, floor, sales] = await Promise.all([
  api.tenant.current(),  // TenantMiddleware + 1 DB query = 240–450ms
  api.menu.get(),        // TenantMiddleware + 2 DB queries = 320–600ms
  api.tables.list(),     // TenantMiddleware + 2 DB queries = 320–600ms
  api.orders.sales(),    // TenantMiddleware + 1 DB query = 240–450ms
]);
```

While these 4 calls are parallelized on the client, **each one runs TenantMiddleware (1 DB query) + its own business logic (1–2 DB queries)**. At Supabase latency:
- Each parallel call: 240–600ms
- Bottleneck = slowest call: ~600ms minimum
- At 5 pool connections with 4 calls competing: **pool contention** drives this to 800ms–2s

This happens for **every menu edit, table action, session action, and payment**. Toggling item availability runs 4 API calls afterwards just to refresh the UI.

Additionally, the 20-second background poll (line 340) runs `refresh()` repeatedly:
```typescript
const POLL_MS = 20000;
const id = setInterval(syncNow, POLL_MS);
```
Even with SSE active, the poll still fires.

### 5.2 KDS Page Opens Two Concurrent Streams — MEDIUM

**File:** `apps/restaurant-admin/src/kds/useKds.ts:103–191`

```typescript
// Stream 1 — KDS relay (port 4001)
useEffect(() => {
  kdsClient.list().then(...);
  kdsClient.subscribe((event) => {...});
}, []);

// Stream 2 — API order stream (port 3001)
useEffect(() => {
  const unsub = api.orders.stream((event) => {...});
}, []);
```

The KDS page holds **two simultaneous connections**: one SSE to the API + one connection to the KDS relay. *(Corrected 2026-07-17: neither consumes a Prisma pool slot beyond the one-shot snapshot query — see §2.1 correction. The dual subscription is an architecture smell (flow 4's relay unification), not a pool cost.)*

### 5.3 Customer App Boot — Loads Full Order List for Occupancy Check

**File:** `apps/customer/src/context/BootContext.jsx:119–123`

```typescript
const [tenant, table, open] = await Promise.all([
  api.tenant.bySlug(slug),
  tablePromise,
  api.orders.list("open"),   // loads ALL open orders with full ROUND_INCLUDE
]);
```

`api.orders.list("open")` loads every open order with full round/item/modifier includes just to check whether one specific table is occupied. For a restaurant with 10 occupied tables and 5 items each, this returns 50+ order items with their modifiers just for an occupancy check. A `select: { tableId: true }` filter would suffice.

### 5.4 `startSession()` Redundant Occupancy Check — LOW

**File:** `apps/customer/src/context/SessionContext.jsx:153–155`

```typescript
const open = await api.orders.list("open");
if (open.some((o) => o.tableId === table.id)) {
  throw new Error("This table was just taken.");
}
```

Just before creating an order, the customer app loads ALL open orders (full ROUND_INCLUDE) again to check if the specific table was just taken. This duplicates the boot occupancy check and hits the same heavy endpoint.

---

## 6. Network Analysis

### 6.1 Outbound Network Requests Per Endpoint

| Request | Direction | Latency | Blocking | Notes |
|---------|-----------|---------|----------|-------|
| DB query (Supabase Singapore) | Server → Supabase | 80–150ms | Yes | Every request, 3–7 per call |
| Supabase Auth API (`getUser`) | Server → Supabase Auth | 200–500ms | Yes | Every super-admin request |
| Supabase Storage (upload) | Server → Supabase Storage | 500ms–3s | Yes | Image uploads only |
| Supabase Storage (bucket check) | Server → Supabase | 200–500ms | Yes (startup) | Once on module init |
| KDS relay (SSE) | Browser → :4001 | <1ms (local) | No | LAN only |

### 6.2 `StorageService` — HTTP Call on Every Module Init

**File:** `services/api/src/storage/storage.service.ts:45–69`

```typescript
async onModuleInit(): Promise<void> {
  const { data } = await this.client.storage.getBucket(this.bucket);
  if (!data) {
    const { error } = await this.client.storage.createBucket(...);
  }
}
```

Every time the NestJS process starts (including `nest --watch` hot-reloads), it makes a network call to Supabase Storage to verify/create the bucket. This adds 200–500ms to startup time and triggers on every dev file change.

### 6.3 `admin.impersonate` — Loads All Tenants to Find One — LOW

**File:** `services/api/src/admin/admin.controller.ts:93–96`

```typescript
const tenant = await this.billing
  .listTenantsWithSubscriptions()  // loads ALL tenants with subscriptions+plans
  .then((all) => all.find((t) => t.slug === tenantSlug));  // then filters in JS
```

`listTenantsWithSubscriptions()` loads every tenant in the system with their subscription and plan just to find one by slug. A `prisma.tenant.findUnique({ where: { slug } })` would be appropriate here.

---

## 7. Async Flow Analysis

### 7.1 Sequential Awaits in Service Methods

| Method | File | Line | Sequential Queries | Est. Time |
|--------|------|------|-------------------|-----------|
| `updateItem` | `orders.service.ts` | 377 | 4 sequential | 320–600ms |
| `requestBill` | `orders.service.ts` | 280 | 3 sequential | 240–450ms |
| `addItem` | `orders.service.ts` | 304 | 4 sequential | 320–600ms |
| `cancel` | `orders.service.ts` | 414 | 3 sequential | 240–450ms |
| `reclaimSession` | `orders.service.ts` | 650 | 3 sequential | 240–450ms |
| `createForTable` | `orders.service.ts` | 86 | 3 sequential | 240–450ms |
| `updateCategory` | `menu.service.ts` | 93 | 3 sequential | 240–450ms |
| `createItem` | `menu.service.ts` | 124 | 3 sequential | 240–450ms |
| `deleteCategory` | `menu.service.ts` | 111 | 3 sequential | 240–450ms |
| `members.update` | `members.service.ts` | 127 | 5 sequential | 400–750ms |

### 7.2 `getAnalytics` — Two Sequential Heavy Queries

**File:** `services/api/src/orders/orders.service.ts:518–540`

```typescript
// Q1: heavy deep include (500ms–5s)
const payments = await this.prisma.payment.findMany({
  include: { order: { include: { rounds: { include: { items: { include: { modifiers: true, menuItem: {...} } } } } } } }
});

// Q2: runs AFTER Q1 finishes (sequential!)
const prev = await this.prisma.payment.aggregate({...});
```

These two queries should run in `Promise.all`, but Q2 is currently sequential after Q1. For Q2 alone (~150ms), being sequential adds to the already multi-second Q1.

---

## 8. Database Schema Analysis

### 8.1 Complete Index Inventory

| Table | Existing Indexes | Gaps |
|-------|-----------------|------|
| `Tenant` | `@id`, `@unique(slug)` | None identified |
| `User` | `@id`, `@unique(email)`, `@unique(supabaseId)` | None |
| `Membership` | `@@unique([tenantId, userId])`, `@@index([tenantId])`, `@@index([userId])`, `@@index([roleId])` | None |
| `Order` | `@@index([tenantId])`, `@@index([tenantId, status])`, `@@index([tableId])`, `@@index([serverId])` | **Missing `@@index([tenantId, createdAt])`** |
| `OrderItem` | `@@index([tenantId])`, `@@index([roundId])`, `@@index([menuItemId])` | Missing `@@index([tenantId, status])` for active-item queries |
| `Payment` | `@@index([tenantId, createdAt])` | ✅ Good |
| `MenuItem` | `@@index([tenantId])`, `@@index([tenantId, categoryId])` | None |
| `ModifierGroup` | `@@index([tenantId])`, `@@index([menuItemId])` | None |

### 8.2 Deep Include Performance

`ROUND_INCLUDE` (defined in `orders.service.ts:30` and `tables.service.ts:13`):
```typescript
const ROUND_INCLUDE = {
  rounds: { include: { items: { include: { modifiers: true } } } },
} as const;
```

This join traverses: `Order → Round → OrderItem → OrderItemModifier` — 4 table joins. Used in `get()`, `list()`, `listFloor()`, and every `refreshAndEmit()` call. For an order with 3 rounds × 5 items × 2 modifiers = 30 modifier rows loaded on every status check.

---

## 9. Response Size Analysis

### 9.1 Heavy Payloads

| Endpoint | Payload Contents | Estimated Size |
|----------|-----------------|---------------|
| `GET /menu` | All categories + all items with full modifierGroups + options | 15–50 KB |
| `GET /tables` | All tables + all live orders with full ROUND_INCLUDE | 10–40 KB |
| `GET /orders/analytics` | Deep-joined payment/order/item/modifier/menuItem graph | 50–500 KB |
| `GET /orders/stream` (snapshot) | All live orders with ROUND_INCLUDE | 10–40 KB |
| `GET /admin/analytics` | All payments (no limit) | 1 MB+ at scale |

### 9.2 Client-Side Zod Validation on Large Payloads

**File:** `packages/api-client/src/http.ts:130`

```typescript
return opts.schema.parse(json);
```

Every API response is Zod-parsed. For `GET /orders/analytics`, this parses a deeply nested object. For `GET /orders` with 20 live orders each having rounds/items/modifiers, the `z.array(orderSchema).parse(orders)` traversal adds 10–50ms of CPU time on the client.

---

## 10. Caching Analysis

**Zero caching layers are present anywhere in the system.**

| Cache Type | Status | Impact |
|-----------|--------|--------|
| Tenant lookup cache (in-memory) | None | +80–150ms every request |
| Auth user/role cache | None | +160–300ms every authenticated request |
| Menu response cache | None | Menu fetched on every `refresh()` |
| Redis / Valkey | None | N/A |
| HTTP Cache-Control headers | None | No browser caching of any API response |
| ETags | None | N/A |
| Prisma query cache | None (not available in Prisma v6) | N/A |
| React Query / SWR | None | `api.orders.list()` re-fetched on every boot |

---

## 11. Logging

No excessive logging was found in service files. The `Logger` in `StorageService` is controlled (`warn` level). `main.ts` has a single `console.log` on startup. This is not a performance contributor.

---

## 12. Memory Usage

### 12.1 Analytics In-Memory Aggregation — HIGH RISK

**File:** `services/api/src/orders/orders.service.ts:557–579`

```typescript
for (const p of payments) {
  for (const round of p.order.rounds) {
    for (const it of round.items) {
      // aggregate in-memory
    }
  }
}
```

The full payment graph (50–500 KB) is loaded into Node.js heap and aggregated with triple nested loops. For 30-day analytics on a busy restaurant, this could allocate 5–20 MB of objects, triggering GC pauses which pause the entire Node.js event loop.

### 12.2 Platform Analytics Unbounded Allocation

**File:** `services/api/src/admin/admin.service.ts:143`

```typescript
this.prisma.payment.findMany({ select: { total: true, method: true } })
```

All payments for all time, for all tenants. At 10,000 payments = 10,000 objects × multiple fields in the JS heap. Will grow without bound.

---

## 13. Architecture Issues

### 13.1 `AdminStore.refresh()` Fetches Menu on Every Floor Change

**File:** `apps/restaurant-admin/src/store/AdminStore.tsx:255–264`

```typescript
const refresh = useCallback(async () => {
  const [tenant, menu, floor, sales] = await Promise.all([
    api.tenant.current(),  // rarely changes
    api.menu.get(),        // loaded even when only floor/orders changed
    api.tables.list(),
    api.orders.sales(),
  ]);
}, [api]);
```

Menu data is loaded on every `refresh()` call, including after order mutations that don't touch the menu. The `refreshFloor` function (lines 269–285) is lighter and is used by the SSE stream handler, but `dispatch()` always calls the full `refresh()`.

### 13.2 Dual Subscription Overhead in KDS

**File:** `apps/restaurant-admin/src/kds/useKds.ts:94–191`

The KDS page connects to **both the KDS relay and the API SSE stream simultaneously**. Each connection holds an HTTP socket and an rxjs subscription *(corrected 2026-07-17: not a Prisma pool slot — see §2.1 correction)*. With the restaurant-admin also having an SSE stream open (AdminStore), opening the KDS creates a third concurrent SSE connection.

### 13.3 `OPEN_SESSION` Discards Return Value and Re-fetches

**File:** `apps/restaurant-admin/src/store/AdminStore.tsx:424–426`

```typescript
case "OPEN_SESSION":
  await api.orders.createForTable(action.tableId);
  return;
// then dispatch() calls refresh() which loads floor (full orders) again
```

`createForTable` returns the new order, but `dispatch()` ignores the return value and calls `refresh()` to rebuild state. The fresh order data from the create call is discarded and re-fetched 500ms later.

---

## 14. Endpoint Performance Table

| Endpoint | DB Queries | Estimated Total Time | Risk Level | Priority |
|----------|-----------|---------------------|------------|----------|
| `POST /auth/login` | 2 sequential + bcrypt | 300–800ms | Medium | P3 |
| `GET /auth/me` | 2 sequential via JwtAuthGuard | 160–300ms | Medium | P3 |
| `GET /menu` | 2 parallel (categories + items with modifiers) | 240–450ms | Medium | P2 |
| `GET /tables` | 2 parallel (tables + live orders ROUND_INCLUDE) | 240–600ms | Medium | P2 |
| `GET /orders` | 1 (orders with ROUND_INCLUDE) | 160–450ms | Medium | P2 |
| `GET /orders/analytics` | 2 sequential (deep join + aggregate) | **2,000–10,000ms** | **Critical** | **P1** |
| `GET /orders/stream` (SSE) | 1 (snapshot only; no held pool slot — see §2.1 correction) | Ongoing | Medium | P3 |
| `POST /orders` | 3 sequential (table + occupancy + create) | 240–450ms | High | P2 |
| `POST /orders/:id/rounds` | 1 + N parallel (modifier lookup per item) + refresh | 320–800ms | High | P2 |
| `PATCH /orders/:id/items/:itemId` | 4 sequential | **320–600ms** | High | **P1** |
| `POST /orders/:id/bill` | 3 sequential | 240–450ms | High | P2 |
| `GET /orders/sales` | 1 (payments with order+table join, take 1000) | 160–600ms | Medium | P2 |
| `GET /admin/analytics` | 2+ (all payments unbounded + sequential sub query) | **1,000–30,000ms** | **Critical** | **P1** |
| `GET /admin/tenants` | 1 (all tenants with subscription+plan) | 160–450ms | Medium | P3 |
| `POST /admin/impersonate` | Lists all tenants to find one by slug | 160–600ms | Low | P4 |
| `GET /members` | 1 (all memberships with user+role) | 160–300ms | Low | P4 |
| Authenticated route overhead | 3 DB queries (middleware + guard) | **240–450ms** | **Critical** | **P1** |

---

## 15. Performance Priority List

### Critical (P1) — Fix First

| # | Issue | Root File | Est. Gain |
|---|-------|-----------|-----------|
| 1 | Pool starvation: 5 connections can't handle SSE + mutations concurrently | `services/api/.env` | Eliminates 20s timeouts |
| 2 | TenantMiddleware + JwtAuthGuard: 3 DB queries per request, no cache | `tenant.middleware.ts:30`, `jwt-auth.guard.ts:51` | −240–450ms per request |
| 3 | Analytics: deep join + sequential second query + in-memory aggregation | `orders.service.ts:518` | −1,500–9,000ms |
| 4 | AdminStore `dispatch` calls full `refresh()` for every action | `AdminStore.tsx:517` | −800–3,000ms per action |
| 5 | `updateItem` sequential 4-query chain (most-called mutation) | `orders.service.ts:377` | −200–400ms per KDS advance |

### High (P2)

| # | Issue | Root File | Est. Gain |
|---|-------|-----------|-----------|
| 6 | `getPlatformAnalytics()` unbounded `findMany` with no `take` limit | `admin.service.ts:143` | −500ms–30s at scale |
| 7 | `SupabaseAuthGuard` makes HTTP call to Supabase Auth on every super-admin request | `auth.guard.ts:37` | −200–500ms |
| 8 | `requestBill`/`cancel`/`addRound` sequential queries | `orders.service.ts:276,414,127` | −160–300ms per call |
| 9 | `api.orders.list("open")` fetches full ROUND_INCLUDE just for occupancy check | `BootContext.jsx:122`, `orders.service.ts:290` | −200–400ms per boot |
| 10 | Menu re-fetched on every `dispatch()` even for non-menu actions | `AdminStore.tsx:258` | −200–400ms per mutation |
| 11 | Missing `@@index([tenantId, createdAt])` on `Order` table | `schema.prisma` | Varies with data volume |

### Medium (P3)

| # | Issue | Est. Gain |
|---|-------|-----------|
| 12 | `admin.impersonate` loads all tenants to find one by slug | −100–400ms |
| 13 | `assertOrder` redundantly loads order before `refreshAndEmit` re-loads it | −80–150ms |
| 14 | Supabase Storage bucket check on every module init (startup latency) | −200–500ms startup |
| 15 | Background 20s poll runs `refresh()` even when SSE stream is active | Reduces background DB load |

### Low (P4)

| # | Issue | Est. Gain |
|---|-------|-----------|
| 16 | Zod parse of large analytics/menu responses on client | −10–50ms |
| 17 | KDS dual subscription (relay + API stream both open) | architecture cleanup only (no pool cost — §2.1 correction) |
| 18 | `members.update` extra role lookup inside sequential flow | −80–150ms |
| 19 | `admin/audit-log` runs `findMany` + `count` always, even for small results | Minimal |

---

## 16. Root Cause Analysis

### Why requests take 15–20 seconds

#### Cause A: Pool Starvation (explains exact 20s timeout)

**Evidence:** `services/api/.env:10`
```
connection_limit=5&pool_timeout=20
```

With 5 Prisma connections, a mutation that needs a DB connection must wait up to `pool_timeout=20` seconds if all slots are busy. **This is the exact mechanism producing 20-second timeouts.** *(Corrected 2026-07-17: SSE streams do NOT hold pool slots — see §2.1's correction. The slots were consumed by the per-mutation 4-call refetch storm across clients plus 3 auth/tenant queries per request, not by idle streams.)*

During a `dispatch()` call: the mutation uses connections, then `refresh()` fires 4 parallel API calls — each needing its own connection. With 4 calls competing for 2 connections, some queue. If the 20s timeout is reached before a connection frees, the request fails silently (the `refresh()` catch is `() => {}`).

#### Cause B: Geographic Latency Accumulation (explains 2–5s baseline)

**Evidence:** `services/api/.env:10` — `aws-1-ap-southeast-1.pooler.supabase.com`

India to Singapore RTT: 80–150ms. Per authenticated request:
- Tenant middleware: 1 DB query = +80–150ms
- JwtAuthGuard: 2 DB queries = +160–300ms
- Business logic: 1–4 DB queries = +80–600ms
- `refreshAndEmit()`: 1 DB query = +80–150ms

**Total: 400ms–1,200ms per simple mutation, before the `dispatch()` refresh cycle.**

#### Cause C: Analytics Endpoint (explains 5–15s on analytics page)

**Evidence:** `orders.service.ts:518–532`

The `GET /orders/analytics` endpoint loads the entire payment graph (6 table joins) into Node.js for a date range, then runs a second sequential aggregate query. For any non-trivial dataset:
- DB load time: 1–5s (deep join)
- Node.js aggregation: 100–500ms (triple loop, GC pressure)
- Sequential second query: +80–150ms
- **Total: 1.5–8s** — this is called by every analytics page load and on every Dashboard render.

#### Cause D: Dispatch Full-Refresh Loop (explains 3–5s per user action)

**Evidence:** `AdminStore.tsx:518–521`

Every admin action (menu toggle, table add, session cancel, payment) triggers a full `refresh()` calling 4 API endpoints simultaneously. Each endpoint:
- hits TenantMiddleware (+80–150ms DB)
- may hit JwtAuthGuard (+160–300ms DB)
- runs business logic (+80–300ms DB)

The 4 calls contend for pool connections. Under SSE overhead, they queue. **Every click in restaurant-admin costs 800ms–3s in refresh latency on top of the actual mutation.**

---

*Investigation complete. No code was modified. Awaiting approval before proposing or implementing any fixes.*
