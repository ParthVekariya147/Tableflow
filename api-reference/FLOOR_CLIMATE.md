# The Floor's Climate — Reading the Room in Real Time

> **What this is:** an explainer for how restaurant-admin surfaces the *live
> temperature* of the dining floor — which tables are hot (need attention
> right now), which are calm, and which are quietly waiting on a bill —
> without anyone refreshing a page. Sibling of `FEATURES.md` / `MODIFIERS.md`;
> see `CLAUDE.md` flows 7 & 8 for the underlying SSE architecture this is
> built on.

## 1. Why a "climate" and not just a table list

A floor plan that only shows *which tables are occupied* is a snapshot. Staff
running a shift need something closer to weather: **what's changing right
now, and where**. Two tables both marked "occupied" are not equally
urgent — one is quietly finishing dessert, the other has had a hand in the
air for two minutes. The floor's climate is the layer of signals on top of
raw occupancy that makes that difference visible at a glance, from three
places in restaurant-admin:

- **`/tables`** (`TablesPage.tsx`) — the floor plan itself, one card per table.
- **The notification bell** (`Shell.tsx`'s `NotificationBell`) — a persistent,
  app-wide gauge, visible from every page.
- **`/` (`DashboardPage.tsx`)** — the shift-level rollup: capacity, tickets in
  flight, 86'd items, tables waiting on a check.

All three read from the same two live wires — the order stream and the
service-request stream (flow 7 / flow 8) — so nothing here is polled into
existence; it arrives as it happens.

## 2. Table temperature: status vs. urgency

Every table card carries two independent signals, and it's worth keeping
them separate because they answer different questions.

**Status — "where is this table in its lifecycle?"** Computed server-side
(`services/api/src/tables/tables.mapper.ts` `deriveStatus`) from the table's
active `Order`, never guessed on the client:

| Status | Meaning | Derived from |
|---|---|---|
| `free` | No active session | no active order |
| `seated` | Party seated, nothing ordered yet | active order, no non-cancelled items |
| `ordering` | Food/drink is in flight | active order with ≥1 non-cancelled item |
| `bill` ("Awaiting Bill") | Guest asked to pay | order is `billed` or `billRequestedAt` is set |

This is what the colored chip in the corner of each `TableCard` shows — calm,
factual, no animation.

**Urgency — "does this table need a human right now?"** This is the layer
that actually makes the floor feel alive, and it's new: a table with a
`pending` `ServiceRequest` — someone tapped Water, Call Staff, Call Manager,
or a custom quick-action button — gets a **pulsing red border**
(`.pulse-ready` in `index.css`, a 2s border/background cross-fade between the
tenant's primary and error colors) laid directly over the card, independent
of its status chip. A table can be quietly `ordering` and still pulse red
because a guest flagged staff down mid-meal. Underneath the badge row, each
open request renders as its own pill — tap a pending one to acknowledge it
inline, right from the floor, without opening the bell.

## 3. The notification bell: the floor's ambient gauge

The bell in the shell header is the one piece of climate information visible
from *every* screen, not just the floor. It shows a live badge count of
requests still awaiting a first look, and its dropdown lists every open
request with an Acknowledge / Resolve action. Two details make it trustworthy
rather than merely decorative:

- **It never applies a status change optimistically.** Clicking Acknowledge
  or Resolve calls the API and then waits for the stream to echo the change
  back before the UI updates — the same principle the rest of the realtime
  surface follows, so the bell can never show a state the server disagrees
  with.
- **A genuinely new request plays a chime** (`notifications/sound.ts`, a
  synthesized two-tone Web Audio beep, no audio asset) — but only on a
  `created` event, never on the `snapshot` a reconnect sends. Reconnecting
  after a dropped tab isn't a new request; it shouldn't sound like one. The
  chime is mutable via a speaker icon in the dropdown and persists across
  sessions in `localStorage`.

## 4. What's new: the floor now speaks in the tenant's own words

Until recently, every request on the floor was one of exactly three hardcoded
types — Water, Call Staff, Call Manager — so both the bell and the table
badges could look up a label/icon from one static map
(`SERVICE_REQUEST_META`). That's no longer the whole picture.

**Quick Actions are now per-tenant configurable**
(`packages/domain/src/quick-action.ts`, authored at
`/settings/quick-actions`). A restaurant can reorder or hide the three
built-ins and add up to `MAX_CUSTOM_QUICK_ACTIONS` (4) fully custom buttons —
its own label, one of a curated set of icons, one of a curated color
swatches — that behave exactly like Call Staff: a generic staff notification
with a tenant-chosen id as its `type`. That id is no longer a closed enum
either — `serviceRequestTypeSchema` was loosened from a 3-value `z.enum` to a
plain non-empty string, because the type on the wire can now be anything a
tenant named.

That loosening pushed the real guard **server-side**: `ServiceRequestsService
.create` takes the tenant's live `quickActions` config down from the
controller (already resolved by `@CurrentTenant()`, no extra fetch), runs it
through `mergeQuickActions`, and 400s unless the posted `type` names a
currently *enabled*, `service_request`-kind button. A disabled or
deleted button, or a made-up string, can't reach the database no matter what
a stale or tampered client sends — the dedupe-by-pending-type logic sits
right behind this same check, so a guest mashing a custom button still just
re-returns the same row instead of piling up duplicates.

On the reading side, both the `NotificationBell` and each `TableCard`'s badge
row had to learn a second lookup path: `SERVICE_REQUEST_META` only ever
covers the three built-ins by design (their label/icon are static and
shared with the guest-facing default row), so a custom button's label/icon
now falls back to the tenant's own `mergeQuickActions(tenant.quickActions)`
config keyed by id, with a generic "Request" pill as the last resort — for a
pending request whose custom button has since been deleted. The result:
staff scanning the floor see the *restaurant's own vocabulary* for a request
("Extra Napkins", "High Chair") rendered with the same urgency treatment as
Water or Call Staff, not a generic fallback.

## 5. The climate respects who's reading it

The floor's live wires aren't free to open — they carry the whole tenant's
occupancy and every guest's contact details, so they're gated behind
`tables.manage`. That used to mean a Kitchen-only user (permission: `kds.use`
only) would still *try* to open the order stream and the service-request
stream, get a 403 every time, and — because `EventSource` auto-reconnects
on error — sit in a silent, permanent reconnect loop spamming the console for
no functional gain (a role without `tables.manage` never received a live
event to begin with). Both `AdminStore` and `ServiceRequestsProvider` now
check `can("tables.manage")` *before* opening the connection at all and
skip it outright for a role that can't use it — one less noisy failure mode,
zero change in what that role could actually see. The floor's climate is
strictly a `tables.manage` surface; Kitchen still gets its own weather (the
KDS board, still on its own relay per flow 4), just not this one.

## 6. The shift-level rollup: Dashboard as a barometer

`DashboardPage.tsx` compresses the same live floor state into four numbers a
manager can read in one glance without visiting `/tables`:

- **Active Tables** — count of non-`free` tables, plus a computed `%
  Capacity` against the full floor.
- **Orders in Progress** — tables with at least one round holding an item
  that isn't yet `served` or `cancelled` (kitchen still has work to do).
- **86'd Items** — menu items currently marked unavailable, surfaced as a
  standing alert strip rather than buried in the menu editor.
- **Awaiting Bill** — every table sitting in `bill` status, with a direct
  link into the Billing Queue to resolve them.

None of this is a separate poll: it's derived on every render from the same
`state.tables` / `state.items` the floor page and the realtime sync already
maintain, so the dashboard's numbers and the floor's cards can never drift
out of sync with each other.

## 7. Where the signal still runs cold

- **KDS is not yet part of this climate.** Kitchen ticket status
  (`preparing`/`ready`/`served`) still rides its own relay (flow 4), separate
  from the order stream the floor/dashboard read. A ticket going `ready`
  doesn't (yet) raise any temperature on the floor card the way a service
  request does.
- **No historical view.** The climate is present-tense only — there's no
  "this table has been `bill` for 9 minutes" escalation or aging indicator
  yet, just the binary pulse.
- **Custom quick-action icons/colors are curated, not free-form** — a
  deliberate constraint (`QUICK_ACTION_ICONS` / `QUICK_ACTION_SWATCHES` are
  fixed enums) so the admin's picker stays a simple grid instead of an icon
  search box, at the cost of not every restaurant getting its exact desired
  icon.
