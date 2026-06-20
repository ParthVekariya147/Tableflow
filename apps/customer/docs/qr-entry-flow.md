# Customer QR entry flow

> Design reference for how a guest goes from **scanning a table QR** to a live
> ordering session. Drives the bootstrap/reserve work. Keep in sync with the
> customer section of the repo-root `CLAUDE.md`.

## Goal

One codebase serves many restaurant tenants. The scanned QR must:

1. Take the guest to the **correct tenant** (so the right brand theme loads), and
2. Seat them at the **correct table** (encoded in the QR), then
3. Capture **name + phone**, and start a real session (Order) for that table.

No code is forked per restaurant — the QR's `{slug}` selects the tenant; the
same screens re-theme from that tenant's config.

## QR encoding (decided)

Path-encoded so URLs are clean and human-readable:

```
https://order.app/{tenantSlug}/t/{qrToken}
e.g.   https://order.app/amber-grain/t/3f9c1a2b-...uuid
```

- `{tenantSlug}` → resolves the tenant + theme (`api.tenant.bySlug`).
- `{qrToken}` → resolves the table (`api.tables.byQrToken`, scoped to the tenant).
- Requires **`BrowserRouter`** (replacing the current `MemoryRouter`) or an
  equivalent boot-time `pathname` parse. In-app screens (`/welcome`, `/menu`, …)
  stay relative once bootstrapped.

## Flow

```
  Guest scans QR  ──►  order.app/{slug}/t/{qrToken}
        │
        ▼
┌──────────────────────── BOOTSTRAP ────────────────────────────────┐
│ 1. Parse pathname → { slug, qrToken }   (BrowserRouter)            │
│ 2. api = createApiClient({ tenantSlug: slug })                    │
│ 3. tenant = api.tenant.bySlug(slug)       → 404 ⇒ "Invalid QR"    │
│ 4. table  = api.tables.byQrToken(qrToken) → 404 ⇒ "Invalid QR"   │
│ 5. OCCUPANCY CHECK: api.orders.list("open") for this table.id     │
│        ├─ open order exists ──►  "Table in use" screen · STOP      │
│        │                         (ask staff — dead end)            │
│        └─ free ─────────────────► continue                         │
└──────────────────────────────┬────────────────────────────────────┘
        ▼
 TenantThemeProvider tenant={tenant}    ← dynamic per-restaurant brand
        ▼
┌──────────── Reserve screen (this brand's theme) ──────────┐
│  Table {table.label}                                       │
│  [ Name   _________ ]  *required                           │
│  [ Phone  _________ ]  *required                           │
│  + honeypot (hidden) · client + server Zod validation      │
│  [  Reserve this table → ]                                 │
└───────────────────────────┬────────────────────────────────┘
        ▼  (server re-checks occupancy on submit — race guard)
 startSession({ tableId, customerName, customerPhone })
   └─ api.orders.createForTable(tableId, { customerName, customerPhone })
        ▼
 WelcomeScreen "/welcome" → menu / order / status / bill   (unchanged)
```

## Decisions

| Question | Decision |
|---|---|
| QR encoding | **Path** `/{slug}/t/{qrToken}` (switch to `BrowserRouter`) |
| Table already has an open session | **Block / ask staff** — show "Table in use" and stop |
| Name + phone | **Both required** (client validation + server DTO enforcement) |

## Security posture

The API is header-tenant + **unauthenticated, no session cookies**, so classic
cookie-CSRF is not the live threat. Protections that actually matter here:

- **`qrToken` is the capability** — an unguessable UUID proving the guest is at
  that physical table. Server-validated (already is).
- **Server-side Zod validation** of name/phone in the create-order DTO
  (non-empty, length, phone format) — the real trust boundary.
- **Occupancy re-check on submit** closes the two-guests-scan-at-once race.
- **Rate-limit** order creation per table/IP — blunts a leaked QR being spammed.
- **Honeypot field** (+ optional short-lived form nonce) — cheap bot/replay friction.

A full CSRF-token dance is deferred until there are auth cookies to protect.

## What this requires (build slices)

Backend mostly exists (`tenant.bySlug`, `tables.byQrToken`, `createForTable(guest)`).

1. **Bootstrap + router swap** — `MemoryRouter` → `BrowserRouter`; parse
   `{slug, qrToken}`; build api-client from the slug; resolve tenant + table;
   loading + "Invalid QR" states. *(Everything else builds on this.)*
2. **Dynamic theme** — feed the resolved tenant into `TenantThemeProvider`
   (replace the static `tenant/defaultTenant.ts`).
3. **Occupancy guard** — step 5 above + "Table in use" screen.
4. **Reserve form** — required name/phone + honeypot on the splash/landing
   screen; pass them into `startSession` → `createForTable(guest)`.
5. **DTO tightening** — make `customerName`/`customerPhone` required on the
   guest create-order path (currently optional).

## Status — implemented

All five slices are built:

| Slice | Where |
|---|---|
| 1. Bootstrap + router swap | `context/BootContext.jsx` (`BootProvider` parses `/{slug}/t/{qrToken}`, resolves tenant + table); `App.jsx` now uses `BrowserRouter`; `src/api.js` exposes `createGuestApi(slug)` |
| 2. Dynamic theme | `App.jsx` `BootedApp` feeds the resolved tenant into `TenantThemeProvider` (`main.tsx` no longer wraps a static one) |
| 3. Occupancy guard | `BootProvider` checks `api.orders.list("open")` for `table.id`; `screens/BootScreens.jsx` renders **Table in use** / **Invalid QR** / loading |
| 4. Reserve form | `screens/SplashScreen.jsx` — required name/phone + honeypot; `startSession` re-checks occupancy then `createForTable(tableId, { customerName, customerPhone })` |
| 5. DTO tightening | `services/api/src/orders/orders.dto.ts` — name/phone **format** enforced server-side; kept optional so staff walk-in open-session still works (guest *required* is client-side) |

**No-QR fallback:** visiting without a QR path (local dev / direct hit) falls back
to `DEFAULT_SLUG` + the first free table, so the app stays runnable.

**Still deferred:** server-side **rate-limit** on order creation; production SPA
host fallback so deep links like `/{slug}/t/{qrToken}` serve `index.html`.
