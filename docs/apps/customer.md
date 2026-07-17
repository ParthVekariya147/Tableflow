# Customer App — `apps/customer`

> Guest ordering PWA. Framework: Vite + React 19, `.jsx` (incremental TS migration). Port **5173**.

## Purpose
The guest-facing mobile web app. A customer scans a table QR code, reserves their seat (name + phone), browses the menu, sends rounds to the kitchen, tracks item status, and pays their bill — all without a native app install.

## Entry & Routing

**`src/main.tsx`** — mounts `<App>` inside `<BrowserRouter>` and `<BootProvider>`.

**`src/App.jsx`** — Route structure:
- `/:slug/t/:qrToken` and `/` → `SplashScreen` (reserve)
- `/welcome` → `WelcomeScreen`
- `/menu` → `MenuScreen`
- `/order` → `MyOrderScreen`
- `/status` → `StatusScreen`
- `/bill` → `BillScreen`

`SessionEndScreen` is rendered **above the router** when `sessionEnded || awaitingCash`. This prevents the Android back-button from popping history back into the order flow.

## Boot Flow (QR → Ready State)

**`src/context/BootContext.jsx`** is the entry gate. On mount:

1. Parse URL path → `{ slug, qrToken }` (falls back to `DEFAULT_SLUG="amber-grain"` for dev)
2. Build `ApiClient` via `createGuestApi(slug)` — attaches `X-Device-Id` header
3. **In parallel** (not a waterfall):
   - `api.tenant.bySlug(slug)` → tenant config → feeds `TenantThemeProvider`
   - `api.tables.byQrToken(qrToken)` → table id
   - `api.orders.list("open")` → occupancy check
   - `api.menu.get()` → menu prefetch (handed to `MenuContext` via `menuPromise`)
4. Determine boot state:
   - **Invalid QR** → no table found
   - **Table in use** (different device) → `TableInUse` screen
   - **This device's order** → resume flow (see Session Persistence)
   - **Free table** → render app, show `SplashScreen`

Boot screens live in **`src/screens/BootScreens.jsx`**: `BootSplash`, `InvalidQr`, `TableInUse`, `SessionClosed`.

## Session Lifecycle

**`src/context/SessionContext.jsx`** manages the entire session.

### Opening a session
`SplashScreen` collects name + phone → calls `startSession()`:
1. Re-checks occupancy (race guard)
2. `api.orders.createForTable(tableId, { customerName, customerPhone })` → Order `open`
3. Persists to `localStorage` via `session-store.js`

### Ordering
`addToOrder(item, modifiers)` → local cart state.

**"Bring it"** (`bringIt`) — instant round:
- `publishRound(instant, items)` → KDS relay (`tools/kds-relay.mjs` port 4001)
- `sendRoundToApi(instant, items)` → `api.orders.addRound`

**"Bring these"** (`bringThese`) — bundled round: same dual-write, clears cart.

Orders gate: `bringIt`/`bringThese`/`addToOrder` **no-op** if `!orderId || sessionEnded` — prevents phantom KDS tickets on stale sessions.

### Bill & Payment
`requestBill()` → `api.orders.requestBill` → Order status `billed`

`payBill("card")` → `api.orders.capturePayment` → immediate capture → session ends

`payBill("cash")` → does NOT capture → enters `awaitingCash` state → poll + SSE until staff capture in admin

### Real-time sync
Subscribes to `api.orders.stream` (SSE, filtered to own `orderId`):
- `closed` → staff cancelled → `sessionCancelled` terminal screen
- `paid` → staff captured cash → session ends
- `updated` → rehydrates rounds + bill status; cancelled items shown struck-through on Status and Bill screens

Low-frequency `api.orders.get` poll (every 12–15s) as self-heal fallback for dropped SSE.

## Session Persistence & Resume

**`src/session-store.js`** — `localStorage` operations:
- `writeSession({ slug, qrToken, tableId, orderId })` — on `startSession`
- `markSessionEnded()` → writes `{ ended: true }`
- `readSession()` / `clearSession()`

**Resume flow** (`BootContext.tryResume`):
1. Check `localStorage` for a saved session
2. `api.orders.get(orderId)` with `X-Device-Id` (device ownership proof)
3. If `open`/`billed` → resume (pass `resumeOrder` to `SessionContext`)
4. If settled/cancelled/403/404 → write ended marker → `SessionClosed` screen

**`SessionContext`** rehydrates `orderId`, `rounds`, `billRequested` from `resumeOrder`.

## Device Binding

**`src/device.js`** — mints a stable opaque id in `localStorage`:
```js
// Uses getRandomValues, NOT randomUUID (needs secure context the LAN HTTP origin lacks)
getDeviceId() → reads or creates 32-char hex string
```

This id is sent as `X-Device-Id` on every guest API call. The server (`orders.service.ts` `assertDevice`) 403s if a different device presents itself. `deviceId` is never returned to clients.

## Menu & Modifiers

**`src/context/MenuContext.jsx`** — consumes `useBoot().menuPromise` (the prefetched menu). Maps cents → display dollars, enriches with category names.

**`src/components/ItemSheet.jsx`** — bottom-sheet item detail:
- Renders modifier groups by `inputType`:
  - `single` → radio buttons
  - `multiple` → checkboxes
  - `toggle` → switches
  - `text` → free-text input
- Live-recomputes unit price = base + Σ selected `priceDelta`s
- **Blocks add** until all `required` groups are satisfied
- Carries chosen modifiers through cart → round → `addRound` payload

See `api-reference/MODIFIERS.md` for full modifier spec.

## Guest Service Requests (Quick Actions)

`WelcomeScreen.jsx`'s Quick Actions — **Water**, **Call Staff**, **Manager** —
are guest **service requests**, deliberately NOT menu items or kitchen orders:

- Labels/icons come from `@amber/domain`'s `SERVICE_REQUEST_META` (one source
  of truth shared with the admin's notification bell), mapped over
  `SERVICE_REQUEST_TYPES` (`water` | `call_staff` | `call_manager`).
- Tapping one calls `sendServiceRequest(type)` (`SessionContext.jsx`) →
  `api.serviceRequests.create({ tableId, type })` → `POST /service-requests`.
  This never calls `bringIt`/`bringThese` and never creates a Round/OrderItem —
  it's a separate SSE channel (`GET /service-requests/stream`) straight to
  restaurant-admin's notification bell + a per-table badge on `/tables`.
- The server dedupes: a table can only have one `pending` request of a given
  type at a time, so re-tapping is safe. The client keeps a 4s "Sent ✓"
  cooldown on top of that purely as a UX debounce.
- Previously these were faked as zero-price `MenuItem`s routed through
  `bringIt`, which both mis-modeled them as kitchen orders (they showed up as
  KDS tickets and session bill lines) and hit `bringIt`'s hardcoded
  `local_shipping` (delivery-truck) toast icon for every "bring it" tap,
  including Water. Splitting them into their own model fixed both.

## KDS Status

**`src/screens/StatusScreen.jsx`** — per-item kitchen status (`placed → preparing → ready → served`). Driven by the KDS relay SSE subscription (via `src/kitchen.js`).

⚠️ Status updates from the KDS relay do NOT yet write back to the Order API. Only admin advances via `useKds.advance()` in `apps/restaurant-admin` write to the DB.

## Multi-Tenancy on the Client

Once booted, `TenantThemeProvider` (from `@amber/ui`) injects the tenant's brand:
- Converts `theme.colors` (partial hex map) to `--ag-*` CSS variables on `<html>`
- Sets font vars and loads Google Fonts `<link>` elements
- All components use Tailwind tokens (`bg-primary`, `text-surface-on`, etc.) → auto-adapt

## Key Files Quick Reference

| File | What it does |
|---|---|
| `src/context/BootContext.jsx` | QR parse, parallel boot calls, resume logic |
| `src/context/SessionContext.jsx` | Order lifecycle, round sending, bill/pay, SSE, `sendServiceRequest()` |
| `src/screens/WelcomeScreen.jsx` | Quick Actions (guest service requests) + drink/bite carousels |
| `src/context/MenuContext.jsx` | Menu load from boot prefetch |
| `src/screens/SplashScreen.jsx` | Reserve form + occupancy race guard |
| `src/screens/SessionEndScreen.jsx` | Terminal screen (above router) |
| `src/screens/BillScreen.jsx` | Bill display, pay by card/cash |
| `src/screens/StatusScreen.jsx` | Per-item KDS status |
| `src/components/ItemSheet.jsx` | Modifier picker + price recompute |
| `src/api.js` | `createGuestApi(slug)` with device id config |
| `src/device.js` | Stable per-device localStorage ID |
| `src/session-store.js` | Session persistence + ended marker |
| `src/kitchen.js` | KdsTransport to relay |

## Environment Variables

```
VITE_API_URL      # default http://localhost:3001
VITE_KDS_URL      # default http://localhost:4001
```

For LAN/phone testing, create `.env.local` (git-ignored) with LAN IP. `tools/sync-lan-env.mjs` auto-writes this.

## Known Issues / Deferred

- KDS board status is relay-based, not API-backed — status doesn't survive relay restart
- `crypto.randomUUID` needs a secure context (HTTPS) — falls back to `getRandomValues` for LAN dev
- ~~Rate-limit on order creation is client-side only~~ — a global per-IP rate
  limit now covers all routes server-side (`@nestjs/throttler`, 120 req/60s;
  the SSE stream endpoints opt out via `@SkipThrottle()`)
- SPA host fallback needed for direct deep QR link hits in production
- `src/data/menu.json` is unused (legacy); `src/components/KDS.jsx` is an empty legacy stub
