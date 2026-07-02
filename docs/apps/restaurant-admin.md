# Restaurant Admin App — `apps/restaurant-admin`

> Manager cockpit: floor management, KDS board, menu CRUD, billing, analytics. Framework: Vite + React 19, TypeScript. Port **5174**.

## Purpose
The staff-facing application. Restaurant owners/managers use it to manage the menu, view the live floor, run the kitchen display board, take payments, and review sales analytics. Accessible in-browser and on tablets.

## Entry & Routing

**`src/main.tsx`** — wraps in `TenantThemeProvider`, `AdminStoreProvider`, `BrowserRouter`.

**`src/App.tsx`** — Route structure:
```
Shell-wrapped (RequireSession guard):
  /              → DashboardPage
  /menu          → MenuPage
  /tables        → TablesPage
  /tables/:id    → TableSessionPage
  /history       → OrderHistoryPage
  /analytics     → AnalyticsPage
  /settings/billing → PlanBillingPage
  /settings/printer → PrinterPage
  /kds           → KdsPage (in-shell, manager view)

Full-screen (no shell):
  /login              → LoginPage
  /tables/:id/billing → BillingPage
  /tables/:id/complete → PaymentCompletePage
  /kds/display        → KdsPage (chrome-free, kitchen staff)
```

## Central Store — `src/store/AdminStore.tsx`

The single source of truth for the admin app. All pages read from `useAdmin()`.

### Initial load (on mount)
Four parallel calls:
1. `api.tenant.current()` → tenant config + theme
2. `api.menu.get()` → menu categories + items
3. `api.tables.list()` → floor with live session status
4. `api.orders.sales()` → recent completed sales

### `dispatch(Action)` — async action handler
Maps each `Action` type to an `@amber/api-client` call, then refetches. Key actions:

| Action | API Call | Refetch |
|---|---|---|
| `ADD_ITEM` | `menu.addItem(...)` | menu |
| `UPDATE_ITEM` | `menu.updateItem(...)` | menu |
| `DELETE_ITEM` | `menu.deleteItem(...)` | menu |
| `ADD_CATEGORY` | `menu.addCategory(...)` | menu |
| `UPDATE_CATEGORY` | `menu.updateCategory(...)` | menu |
| `DELETE_CATEGORY` | `menu.deleteCategory(...)` | menu |
| `ADD_TABLE` | `tables.create(...)` | floor |
| `UPDATE_TABLE` | `tables.update(...)` | floor |
| `DELETE_TABLE` | `tables.remove(...)` | floor |
| `REGEN_QR` | `tables.regenerateQr(...)` | floor |
| `OPEN_SESSION` | (UI nav only, awaited) | floor |
| `CANCEL_ITEM` | `orders.updateItem(status:cancelled)` + relay `removeTicket` | floor |
| `CANCEL_ORDER` | `orders.cancel(...)` + relay `cancelOrder` | floor |
| `COMPLETE_PAYMENT` | `orders.capturePayment(...)` | floor + sales |

### Realtime sync
Subscribes to `api.orders.stream` (SSE):
- Any event → coalesced `refreshFloor()` (tables + sales only)
- `mutatingRef` guard: skips the push during an in-flight local mutation to prevent clobbering optimistic state
- `closed` event also calls `kdsClient.cancelOrder(orderId)` to clear dead KDS tickets

### Self-heal fallback
- Poll every ~20s (background tab awareness)
- Refetch on `visibilitychange` and `focus` events
- `OPEN_SESSION` and `BillingPage`/`TableSessionPage` call `refresh()` on open

### Selectors exposed
- `sessionSubtotal(tableId)` — sum of non-cancelled items for a table session
- `sessionItemCount(tableId)` — count of non-cancelled items
- `billTotals(tableId)` — `{ subtotal, tax, tip, total }` using `tenant.taxRate`

## Pages

### DashboardPage (`/`)
- **Today's revenue** — `api.orders.analytics({ from: startOfDay })` with period delta
- **Active tables** count from live floor state
- **Orders in progress** — open rounds not yet served
- **Awaiting bill** — tables with `billRequestedAt` set
- **Live activity feed** — recent events from `state.sales`
- Re-fetches analytics when `state.sales.length` changes (new payment came in)

### MenuPage (`/menu`)
- Category rail (left) + item grid (right)
- Item actions: toggle availability, open `ItemPanel` for full edit, delete
- Category actions: add, rename, delete (blocked if has items)
- "Crafting…" optimistic skeleton while an item save is in flight

### TablesPage (`/tables`)
- Table cards with status chips: Free / Occupied / Awaiting Bill
- Filter by status
- Add / Edit table (name, room, seats)
- Delete table (blocked while occupied or has order history → 409 from API)
- **QR code** per table: `QRCodeCanvas` from `qrcode.react`, encodes `tableQrUrl(slug, qrToken)` using `VITE_CUSTOMER_URL`
  - Copy link button
  - Download PNG button
  - **Regenerate** — behind a confirm/warn modal (rotating token invalidates printed codes)
- **Service-request badges** — reads `useServiceRequests()` filtered to the card's `tableId`; each open request (water/call staff/call manager) renders as a small pill (tap a `pending` one to acknowledge inline), and the whole card **pulses** (reusing the KDS `pulse-ready` animation) while any request on that table is still `pending` — so staff scanning the floor grid see it without opening the bell.

### TableSessionPage (`/tables/:id`)
- Shows live order items grouped by round
- Staff can: add an item, cancel an item, cancel the whole order, navigate to billing
- Calls `refresh()` on mount (fresh state, not cached)

### BillingPage (`/tables/:id/billing`) — full screen
- Line items with quantities and modifiers
- Subtotal / tax / tip / total computed from `billTotals()`
- Method selector: Cash vs Card
- Cash: numpad for tendered amount, shows change due
- Dispatches `COMPLETE_PAYMENT` → `api.orders.capturePayment`

### OrderHistoryPage (`/history`)
- Date-range selector: Today / Yesterday / Last 7 Days / All
- Calls `api.orders.sales({ from, to })` directly (not via store dispatch)
- Expandable rows: lazy-loads each order's items via `api.orders.get(id)` on expand
- Revenue summary + order count at top

### AnalyticsPage (`/analytics`)
- Date-range selector (Today / Yesterday / 7 Days / 30 Days)
- Calls `api.orders.analytics({ from, to })` on selector change
- Charts rendered using (check `AnalyticsPage.tsx` for chart library):
  - Revenue trend (line)
  - Category split (donut)
  - Top items (table)
  - Peak hours (bar)
- Period-over-period KPI deltas shown on cards

### PlanBillingPage (`/settings/billing`)
- Shows current plan name, price, billing interval
- Shows subscription status (`trialing | active | past_due | canceled`)
- Calls `api.billing.me()`

### PrinterPage (`/settings/printer`)
Configures receipt printing — see `PRINT_RECEIPT_PLAN.md` for the full architecture.
Loads/saves `Tenant.printer` via `api.tenant.current()` / `api.tenant.update({ printer })`,
same shape as `PaymentsPage`. Fields: print-agent URL, an optional security key
(`agentSecret`, sent as `X-Agent-Secret` — a "Generate" button fills a random
default; an inline warning shows while it's empty, since open mode is only
safe when the agent and printer stay on the browser's own PC), connection
type (network/USB/Bluetooth) with the fields relevant to each, and paper
width. **Test Connection** hits the agent's `GET /health` (no secret needed).
**Print Test Receipt** calls `printTestReceipt()` (`lib/printAgent.ts`) to
verify the exact connection before relying on it at checkout.

Printing itself happens elsewhere: `BillingPage`'s `complete()` navigates to
`PaymentCompletePage` with the paid order's id in the URL (`?order=`, so it
survives a refresh — router state is only a fast-path hint). `PaymentCompletePage`
rebuilds the receipt from `api.orders.get(id)` (line items) +
`api.orders.getPayment(id)` (method/tax/tip/tendered breakdown — a new
endpoint) + the tenant's printer settings, then calls
`printReceipt()`/`printAgent.printReceipt(...)`, replacing the old bare
`window.print()` stub. A persistent "Print Again" button covers reprints and
paper jams alike; failures are surfaced distinctly (agent unreachable /
wrong security key / printer offline / not configured).

**Receipt Layout designer**: also on this page, a draggable (native HTML5
DnD, no added dependency), toggle-able ordered list of 9 receipt sections
(logo, name/GST, table/check info, line items, totals, payment method, UPI
payment QR, "rate us" QR, footer message) — order in the array is print
order. Persisted as `printer.sections` (falls back to
`DEFAULT_RECEIPT_SECTIONS` if unset). Logo/UPI-ID/review-link aren't edited
here — they're owned by Branding/Payments/Profile — this only controls
whether and where they print; a row shows an inline hint + link to the
relevant settings page when it's toggled on but its data isn't configured. A
live preview (real `QRCodeCanvas` for the QR sections, the tenant's actual
name/logo/GST, sample line items) re-renders instantly next to the form as
sections are toggled/reordered — the real "Print Test Receipt" button
remains the way to verify actual hardware output. See `PRINT_RECEIPT_PLAN.md`
§11.

## KDS — Kitchen Display System

### `src/kds/KdsPage.tsx`
Three-column layout: **New** / **Preparing** / **Ready**. Live clock and ticket count.

Available at two routes:
- `/kds` — in-shell (manager can see it alongside other navigation)
- `/kds/display` — full-screen, chrome-free (mounted on kitchen screens)

### `src/kds/useKds.ts` — board state hook
1. Subscribes to KDS relay (via `kdsClient.ts` → `createHttpKdsTransport`) for ticket snapshots + events
2. **Also** subscribes to `api.orders.stream` (same SSE the store uses)
3. Maintains a `activeItemIds` map per order (order live + item not cancelled)
4. **Reconciliation:** only renders tickets whose item is still active — stale relay tickets (cancelled item, dead order) are hidden and removed via `removeTicket`
5. `advance(ticketId)` → `api.orders.updateItem(status: next)` → on 409, drops ticket from board + relay

### `src/kds/kdsClient.ts`
Creates `KdsTransport` pointed at `VITE_KDS_URL` (default `:4001`). Change this one line to point at a real API endpoint when the relay is retired.

## Notification Bell — Guest Service Requests

`components/Shell.tsx`'s `NotificationBell` (`tables.manage`-gated) replaces
what used to be a purely decorative bell (a hardcoded static red dot wired to
nothing). It's backed by `notifications/useServiceRequests.tsx`
(`ServiceRequestsProvider`, mounted in `main.tsx` alongside
`AdminStoreProvider`), which:

- Subscribes to `api.serviceRequests.stream` (its own SSE connection,
  separate from `/orders/stream`) via the shared `lib/api.ts` client.
- Shows a live badge count (`pendingCount`) + dropdown of open requests
  (table, type icon/label from `@amber/domain`'s `SERVICE_REQUEST_META`, "Xm
  ago"), with Acknowledge/Resolve buttons calling
  `api.serviceRequests.updateStatus`. The list only updates from the SSE echo
  — no local optimistic state.
- Plays a synthesized two-tone chime (`notifications/sound.ts`, Web Audio
  API — no audio asset) on every genuinely **new** request (a `created`
  event, never on a reconnect's `snapshot`). Mute/unmute via a speaker icon in
  the dropdown header, persisted to `localStorage`.
- The same live state also drives per-table badges on `TablesPage` (see
  below) — the bell and the floor grid share one subscription/provider.

## Authentication & Authorization (RBAC)

This app is **not** Supabase-session-based — it's email+password → JWT, with
custom per-tenant roles (Microsoft-style RBAC). The old Supabase-session flow
(`RequireSession.tsx`, `lib/supabase.ts`) has been fully removed.

**`src/context/AuthContext.tsx`** (`useAuth()`) owns the session:
- `login(email, password)` → `POST /auth/login`. Resolves to either
  `{kind:"authenticated", user}` (the account has one restaurant — token +
  user are persisted and the session is established) or
  `{kind:"select_tenant", ticket, tenants}` (several restaurants — `LoginPage`
  renders a tenant picker instead of navigating).
- `selectTenant(ticket, tenantId)` → `POST /auth/select-tenant` — step two of
  a multi-tenant login, redeems the short-lived ticket for a real token.
- Session restore on mount: a persisted bearer token (`lib/auth-token.ts`,
  `localStorage` key `amber-admin-token`) is verified via `GET /auth/me`; an
  invalid/expired token (401/403) is cleared and the user is bounced to
  `anon`. Also handles `?impersonationToken=` in the URL (from super-admin's
  "impersonate" action) by decoding the JWT client-side (no verification
  needed — the API verifies it) and establishing the session from it, then
  stripping the param from the URL/history.
- `can(permission)` — `!!user?.permissions.includes(permission)` — the single
  source of truth for every permission check in this app (nav filtering,
  route guards). `AuthUser.permissions` is the user's fully-resolved effective
  set (role permissions merged with any per-user override), computed
  server-side on every request.
- The active **tenant slug** is persisted separately (`lib/auth-tenant.ts`,
  `localStorage` key `amber-admin-tenant`) and read by both api-clients
  (`lib/api.ts` + `store/AdminStore.tsx`) via a `getTenantSlug` hook, so the
  whole app follows whichever tenant the logged-in user belongs to — there's
  no hardcoded tenant.

**`src/components/RequirePermission.tsx`** — wraps every route in `App.tsx`.
Anonymous → redirect to `/login` (preserving the attempted location).
Authenticated but lacking the route's permission → redirected to the user's
own home route (`homeRouteFor`, `lib/nav.ts` — their highest-priority allowed
nav item, e.g. a Kitchen-only user always lands on `/kds`) rather than shown
the page — **hide, don't tease**. No allowed destination at all → a neutral
"you don't have access" screen (no redirect loop).

**`src/components/Shell.tsx`**'s `SideNav` filters `NAV_ITEMS` (`lib/nav.ts`)
through `can()` the same way — a user only ever sees the sidebar entries they
can open.

**Permission catalog** (`@amber/domain`'s `PERMISSIONS` — a closed set):
`dashboard.view`, `menu.manage`, `tables.manage`, `kds.use`, `orders.history`,
`analytics.view`, `settings.manage`, `team.manage`. Roles are NOT a fixed
enum — Admins create/rename/edit custom roles bundling these keys
(`/settings/roles` → `RolesPage.tsx`, `team.manage`-gated) and manage team
members' role + per-user permission overrides (`/settings/team` →
`TeamPage.tsx`, `components/PermissionChecklist.tsx`).

**Admin-tier guard:** a `protected` role (the seeded Admin role) can't be
deleted or edited by a non-protected actor, and a non-Admin with
`team.manage` (e.g. a Manager) can't add/edit/remove a member on a protected
role or promote anyone into one. `TeamPage`/`RolesPage` mirror this
client-side via `useAuth().user.roleProtected` (showing a lock/Admin chip
instead of edit controls); the API enforces the same rule server-side
regardless.

**Forced password change:** while `AuthUser.mustChangePassword` is true (a
member still on the seeded default `changeme123`), `App.tsx` renders
`ChangePasswordPage` in place of the whole router — no route or permission
combination can bypass it.

⚠️ **Dead code, not wired into the app:** `src/lib/auth.ts`,
`src/components/ImpersonationBanner.tsx`, and
`src/components/BillingLockoutGate.tsx` still exist as files (leftovers from
before the JWT/RBAC rewrite — the old impersonation-banner / Supabase-driven
billing lockout) but are no longer imported or rendered anywhere.
Impersonation is now handled directly inside `AuthContext.tsx`'s mount effect
instead. Safe to delete; kept only because nobody has cleaned them up yet.

**Two separate auth systems on the API side** (`services/api/src/auth/`):
this app's staff routes use `JwtAuthGuard` + `PermissionsGuard`
(`@RequirePermission(...)`); the platform's `/admin/*` (super-admin app, not
this one) uses a completely different `SupabaseAuthGuard` +
`super-admin.guard.ts` pair. `POST /auth/sync-profile` (Supabase-gated) exists
only for that super-admin bootstrap path, not for restaurant-admin logins.

## Item Editor — `src/components/ItemPanel.tsx`

Full modal (centered, not a slide-over) for creating/editing menu items.

**Fields:** name, description, price (in rupees, converted to cents for API), category, icon, swatch, image upload, dietary flag, jain flag, availability toggle.

**Image upload:**
- Calls `api.menu.uploadImage(file)` → `POST /menu/upload` → Supabase Storage
- Returns `{ url }` → stored as `MenuItem.imageUrl`

**Modifier group builder:**
- Add groups with an `inputType`: `single` (radio), `multiple` (checkbox), `toggle` (switches), `text` (free text)
- Per group: name, required toggle, min/maxSelect
- Per option: name, price delta (can be negative), availability
- Entire group set is **replace-on-save** — the API transactionally replaces all groups + options for the item

See `MODIFIERS.md` for full modifier system spec.

## API Client Usage

The store uses the singleton from **`src/lib/api.ts`** — same client instance shared with individual pages that make direct API calls (OrderHistoryPage, AnalyticsPage, PaymentsPage). Both this client and `store/AdminStore.tsx`'s own client use `getToken: getStoredToken` (`lib/auth-token.ts`) and `getTenantSlug: getStoredTenantSlug` (`lib/auth-tenant.ts`) — read at call time, so a long-lived client follows whichever tenant/user is currently logged in without being recreated.

## Local View-Model Types — `src/data/types.ts`

These mirror `@amber/domain` but add UI-specific fields (`icon`, `swatch`, `priceCents`). Used internally by the store and page components. The store's mapper functions convert between domain types and view-model types.

## Environment Variables

```
VITE_API_URL       # default http://localhost:3001
VITE_KDS_URL       # default http://localhost:4001
VITE_CUSTOMER_URL  # default http://localhost:5173 — baked into QR URLs
```
No Supabase env vars — this app has no Supabase dependency at all (that was
the old auth flow; see Authentication & Authorization above). Only the
super-admin app still talks to Supabase.

## Known Issues / Deferred

- KDS is still relay-based — not yet unified onto the API order stream
- `/kds` board tickets do not support multi-station routing
- 86'd items (unavailable) count on Dashboard is derived from menu state only
- Real-time KDS stage changes don't yet reflect on the guest Status screen
- RBAC is enforced **client-side** here for nav/route gating; the API already
  enforces it on `roles`/`members` (incl. the Admin-tier guard) — `menu/`,
  `tables/`, `orders/`, `service-requests/` routes are not yet
  `@RequirePermission`-annotated server-side (still rely on `X-Tenant-Slug`
  only), though the guard/decorator already exist and are proven elsewhere.
- Receipt printing supports one printer per tenant (no kitchen-station
  routing — see `FEATURES.md`) and only prints from `PaymentCompletePage`
  post-payment; a pre-payment "print a copy" button on `BillingPage` was
  scoped out of the initial cut (see `PRINT_RECEIPT_PLAN.md` §6.3).
