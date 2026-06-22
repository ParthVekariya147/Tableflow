# Real-time Table-Session Sync — Plan & Open Questions

> **Status:** SLICE (a) DONE — admin + customer now sync in real time over the API
> SSE event bus. KDS still on its relay (deliberate, Q1=a). Open questions answered:
> Q1=(a) order sync first, Q3=per-tenant stream (customer filters client-side),
> Q4=keep low-freq polling fallback, Q5=match current auth model.
> **Remaining:** fold KDS onto the same stream + retire the relay (was Q1=b / step 5).
> Verify steps below still apply (DB reachable + API running). Transport: API SSE bus.

## The bug / goal
The **table session** (= one `Order` holding `Round`s + `OrderItem`s) is shared by
three clients, but there is **no shared live channel** — each is on its own clock,
so actions in one don't reflect in the others in real time. Example the user hit:
**cancel from restaurant-admin's table-session detail does NOT reflect on the
mobile customer app.**

Goal: a single source-of-truth "room" for each table session. Any action (KDS
fires *preparing*, staff cancels, guest adds a round, payment closes it…) updates
the one place and **pushes** to all three clients in real time, so admin, customer
and KDS always render the same up-to-date data.

## Current state (as found in code)
- **Customer** (`apps/customer/src/context/SessionContext.jsx`): background-polls
  `api.orders.get(orderId)` for *its own* order (detects staff cancel/pay/bill).
- **Restaurant-admin** (`apps/restaurant-admin/src/store/AdminStore.tsx`): polls
  `tables.list()` ~every 4s + refetch on window focus (`refresh()`), skips while a
  mutation is in flight. This is the floor-wide view.
- **KDS** (`apps/restaurant-admin/src/kds/*` + `tools/kds-relay.mjs`): separate
  in-memory SSE **relay** on :4001. After a recent fix, KDS stage advances now ALSO
  write through to the DB via `api.orders.updateItem(orderId, itemId, {status})`
  (ids are a shared space: round `rnd_…`, item `oi_…`, set by the customer on
  `addRound` and carried on the relay ticket as `orderId` + `roundId::orderItemId`).
- API mutations that change a session live in
  `services/api/src/orders/orders.service.ts`: `createForTable`, `addRound`,
  `addItem`, `updateItem` (qty/status), `requestBill`, `cancel`, `capturePayment`.
  Each currently returns the updated `Order` but **broadcasts nothing**.

## Transport decision — **DECIDED: API SSE event bus**
Add an **Orders event stream on the NestJS API** + an in-process event emitter.
Every order mutation broadcasts `{ type, orderId, order }`. Customer / admin / KDS
subscribe over SSE. No new infra, reuses the existing SSE pattern (the relay), works
on LAN, and becomes the path to **retire the relay**.

```
mutation -> OrdersService
   |  emits { type, orderId, order }
   v
  in-proc EventEmitter (per tenant)
   |
   v  GET /orders/stream  (SSE)
  +--------+--------+--------+
  | admin  |customer|  KDS   |
  +--------+--------+--------+
```

Rejected alternatives:
- **Supabase Realtime** — less API code but needs anon key + RLS policies, couples
  frontends to Supabase, KDS relay stays separate.
- **Tighter unified polling** — simplest, but not real-time and more load on the
  already-flaky DB.

## OPEN QUESTIONS (answer these on resume)
1. **Scope of first slice** — pick one:
   - (a) **Order sync first, KDS after**: wire admin + customer to the live Order
     stream now; keep KDS on its relay (it already writes status to the DB) and
     fold it onto the same stream in a follow-up. *(smaller, testable)*
   - (b) **Unify all three now**: migrate KDS off the relay onto the same stream in
     this pass and retire the relay. *(bigger, more to verify)*
   - **Leaning:** (a) first — but confirm.
2. **What "reflects instantly" must cover** — assumed set: cancel item / cancel
   session, add round/item, KDS status change (preparing/ready/served), request
   bill, payment/close, new session opened on a table. Confirm / add / exclude.
   (The user explicitly cares about **cancel-from-admin → phone**.)
3. **Stream scope** — plan: one **per-tenant** stream `GET /orders/stream` emitting
   `{type, orderId, order}`; customer filters to its own `orderId`, admin + KDS see
   the whole floor. OK, or do we want a tighter **per-table / per-order** stream for
   the customer (less data leakage, but more endpoints)?
   - Note: `Order.deviceId` is never serialized; confirm a tenant-wide stream is
     acceptable security-wise (it exposes other tables' order data to any tenant
     client — same as today's `orders.list`, but now pushed). Per-order stream is
     safer for the guest.
4. **Polling fallback** — keep current polling at a **low frequency** as a self-heal
   safety net behind SSE (recommended — SSE can drop on mobile background), or
   remove polling entirely?
5. **Auth** — still deferred. Stream is unauthenticated like the rest of the
   tenant-scoped API (only `X-Tenant-Slug`). Acceptable for now? (Per-order stream
   could additionally check `X-Device-Id` for the guest.)

## Implementation plan (vertical slice; do after Q1–Q5)
Order of work, smallest-risk first. **Verify needs the DB reachable** + relay running.

### 1. API: event emitter + SSE endpoint
- New `services/api/src/orders/orders.events.ts` (or a small `OrdersEvents`
  provider): an `EventEmitter`-backed pub/sub keyed by `tenantId`. Methods:
  `emit(tenantId, event)` and `stream(tenantId): Observable<MessageEvent>`.
- Event shape: `{ type: "order.created"|"order.updated"|"order.closed", orderId, order }`
  where `order` is the already-mapped domain `Order` (reuse `toDomainOrder`).
- `OrdersController`: add `@Sse("stream")` `GET /orders/stream` returning the
  tenant's observable (Nest has first-class SSE via `@Sse`). Scope via
  `@CurrentTenant()`. (If per-order: `GET /orders/:id/stream` + device check.)
- In `OrdersService`, after EACH successful mutation (`createForTable`, `addRound`,
  `addItem`, `updateItem`, `requestBill`, `cancel`, `capturePayment`), call
  `this.events.emit(tenant.id, { type, orderId, order })` with the fresh `Order`
  it already builds via `this.get(...)`. (One helper to DRY it.)
- ⚠️ The KDS write-through path (`updateItem` from the admin board) will naturally
  emit here too — so a KDS status change pushes to customer + admin for free.

### 2. api-client: subscribe helper
- `packages/api-client/src/index.ts` (or a new transport file): add
  `orders.stream(handler)` (and/or `orders.streamOrder(orderId, handler)`) that
  opens an `EventSource` to `/orders/stream` with the tenant header, parses
  `{type, orderId, order}` (validate `order` against `orderSchema`), returns an
  unsubscribe. Mirror `createHttpKdsTransport`'s EventSource handling.
- Note: `EventSource` can't set custom headers — tenant slug must go in the URL as
  a query param (`?tenant=slug`) for the stream, OR use the existing pattern. Check
  how the relay does it (it uses path only). Add `?tenant=` support on the Nest SSE
  route, read it in a small guard/middleware (TenantMiddleware reads header today —
  may need to also accept a query param for SSE). **This is the main gotcha.**

### 3. Customer: replace/augment its poll with the stream
- `SessionContext.jsx`: subscribe to the order stream (filter to `orderIdRef`).
  On `order.updated` → rehydrate rounds/billRequested via the existing
  `ordersToLocalRounds` + resume logic; on `order.closed`/cancel → drive the
  existing terminal screens (`sessionCancelled` / settled). Keep the low-freq poll
  as fallback (per Q4).

### 4. Restaurant-admin: replace/augment the floor poll
- `AdminStore.tsx`: subscribe to the tenant stream; on any event, either refetch
  `tables.list()` (cheap, simple) or merge the pushed `order` into the matching
  table's session (less load). Keep the visible-tab poll as low-freq fallback.
  Still skip applying remote events while a local mutation is in flight (existing
  `mutatingRef` guard) to avoid clobbering optimistic state.

### 5. (If Q1 = b) KDS onto the same stream
- Replace `kds/kdsClient.ts` relay transport with one that derives tickets from
  the order stream (`orders.list` snapshot + stream updates → flatten live
  `OrderItem`s into `KdsTicket`s, one per item, using `status` for the column).
  `setStage` becomes `api.orders.updateItem`. Then retire `tools/kds-relay.mjs`
  and `kitchen.js` publish path.

## Edge cases / gotchas to remember
- **EventSource + headers**: browsers can't send `X-Tenant-Slug`/`X-Device-Id` on
  EventSource. Need query-param tenant (and device) support on the SSE route. This
  is the #1 thing to solve.
- **Reconnect storms**: EventSource auto-reconnects; the relay sends a snapshot on
  connect — do the same so a reconnect re-syncs (mirrors the KDS fix we did).
- **Optimistic state**: admin already guards with `mutatingRef`; keep that so a
  pushed event doesn't clobber an in-flight local edit.
- **DB flakiness**: unrelated but ongoing — direct Supabase endpoint is IPv6-only
  and slow on cellular; switching `DATABASE_URL` to the Supabase **pooler** (IPv4)
  is recommended (see separate note / earlier work). A 15s client timeout was added
  in `packages/api-client/src/http.ts`.
- **Don't break device-binding**: `Order.deviceId` must stay unserialized; a
  per-order guest stream should verify the device id.
- **CORS**: API already `enableCors()`; SSE route must be reachable cross-origin
  (customer :5173, admin :5174). Fine on LAN with `0.0.0.0` binding.

## Files that will change (checklist)
- [x] `services/api/src/orders/orders.events.ts` (NEW — `OrdersEvents` rxjs Subject)
- [x] `services/api/src/orders/orders.controller.ts` (`@Sse("stream")` + snapshot)
- [x] `services/api/src/orders/orders.service.ts` (`refreshAndEmit` after each mutation)
- [x] `services/api/src/orders/orders.module.ts` (provide `OrdersEvents`)
- [x] `services/api/src/tenant/tenant.middleware.ts` (accept `?tenant=` for SSE)
- [x] `packages/api-client/src/index.ts` (`orders.stream` + `OrderStreamEvent` parse)
- [x] `apps/customer/src/context/SessionContext.jsx` (subscribe; polls → fallback)
- [x] `apps/restaurant-admin/src/store/AdminStore.tsx` (subscribe; `refreshFloor`; poll → 20s)
- [ ] (remaining) `apps/restaurant-admin/src/kds/kdsClient.ts` + retire relay
- [x] `CLAUDE.md` — realtime SSE notes (API §, api-client §, both apps, flow §7)

## How to verify on resume
1. Ensure DB reachable (`prisma db push` ok) + API running + relay running (if KDS
   still on relay).
2. Open admin floor + a customer session (scan/QR or dev fallback) on the same table.
3. Cancel an item / the session from admin's table-session detail → **customer phone
   updates instantly** (no manual refresh). Add a round on the phone → admin floor
   shows it instantly. Advance status on KDS → both update.
