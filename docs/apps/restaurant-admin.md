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

## Authentication & Authorization

**`src/components/RequireSession.tsx`** — route guard; redirects to `/login` if no Supabase session.

**`src/lib/supabase.ts`** — Supabase client, `getCachedAccessToken()`, `signOut()`.

**`src/lib/auth.ts`** — Impersonation support:
- `captureImpersonationFromUrl()` — reads `?impersonationToken=` on boot, stores in `localStorage`
- `getAuthToken()` — returns impersonation token OR Supabase access token
- `getActiveTenantSlug()` — from impersonation JWT payload or `defaultTenant.slug`
- `isImpersonating()` / `clearImpersonation()`

**`src/components/ImpersonationBanner.tsx`** — orange banner when `isImpersonating()`. Shows acting tenant name and an "Exit" button (clears token + reloads).

**`src/components/BillingLockoutGate.tsx`** — wraps shell content. When subscription status is `past_due` or `canceled`, blocks all pages except `/settings/billing`.

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

The store uses the singleton from **`src/lib/api.ts`** — same client instance shared with individual pages that make direct API calls (OrderHistoryPage, AnalyticsPage, PlanBillingPage). All calls use `getAuthToken()` from `src/lib/auth.ts`.

## Local View-Model Types — `src/data/types.ts`

These mirror `@amber/domain` but add UI-specific fields (`icon`, `swatch`, `priceCents`). Used internally by the store and page components. The store's mapper functions convert between domain types and view-model types.

## Environment Variables

```
VITE_API_URL       # default http://localhost:3001
VITE_KDS_URL       # default http://localhost:4001
VITE_CUSTOMER_URL  # default http://localhost:5173 — baked into QR URLs
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

## Known Issues / Deferred

- KDS is still relay-based — not yet unified onto the API order stream
- `/kds` board tickets do not support multi-station routing
- 86'd items (unavailable) count on Dashboard is derived from menu state only
- Real-time KDS stage changes don't yet reflect on the guest Status screen
- Full RBAC (role-based access by membership role) is deferred; any logged-in user sees everything
