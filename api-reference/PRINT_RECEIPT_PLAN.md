# Print Receipt (Thermal Printer) — Architecture & Implementation Plan

> **Status 2026-07-16: implemented AND extended past this plan.** Since it shipped,
> printing gained: **TSPL support** for label printers (TSC DA310 etc. —
> `commandLanguage` auto/escpos/tspl on `PrinterSettings`, raw-byte path via
> `renderTspl.ts`/`rawPrint.ts`; Windows now prints through winspool RAW with no
> printer sharing required), a **shared text-layout engine**
> (`@amber/domain/print-format.ts`) used by both the agent renderers and the
> admin's live preview (character-for-character parity; plain amounts without a
> currency symbol), free-form **paper widths** (58/76/80/101 mm presets + custom
> 40–210 mm), statutory bill fields on the receipt header
> (address/phone/GSTIN/FSSAI) with CGST/SGST tax split, a **customerInfo**
> section (10 sections now, auto-appended to saved layouts via
> `mergeReceiptSections`), and an agent-side **KOT endpoint** (`POST /print/kot`
> + `Tenant.kitchenPrinter` — no admin caller yet). For the current end-to-end
> path see CLAUDE.md flow 9; the rest of this document is the original plan.
>
> Status: **implemented** (steps 1–9 of §8 complete, 2026-07-01). Written after reading
> `CLAUDE.md`, `docs/PROJECT.md`, `docs/apps/restaurant-admin.md`, `docs/apps/customer.md`,
> `FEATURES.md`, and the current `BillingPage.tsx` / `PaymentCompletePage.tsx` /
> `PaymentsPage.tsx` / `SettingsPage.tsx` / domain schemas / Prisma schema. Approved with two
> amendments folded in: **(1)** shared-secret auth on the print agent (§3, §5, §6.2), and **(2)**
> the post-payment receipt must survive a refresh, not just live in router state (§6.3). See §10
> for what shipped and one bug found/fixed during verification.

## 1. What exists today (baseline)

- **Stack**: pnpm/Turborepo monorepo. `apps/restaurant-admin` = Vite + React 19 + TS, talks to
  `services/api` (NestJS + Prisma + Postgres) via the typed `@amber/api-client`. Tenant/theme/
  billing config lives on the `Tenant` row (`services/api/prisma/schema.prisma`), validated by
  Zod schemas in `packages/domain/src`.
- **"Print Receipt" today is a stub**: `apps/restaurant-admin/src/pages/PaymentCompletePage.tsx:76`
  has a button that just calls `window.print()` — the browser print dialog on the *whole SPA page*.
  No ESC/POS, no thermal formatting, no printer targeting at all. This is the button we're
  replacing with a real flow.
- **No existing printer code or dependencies anywhere** in the repo (`grep -ri print` across
  `apps/*/src`, `services/api/src`, `packages` returns only that stub + unrelated "kitchen station/
  printer" TODO notes in `FEATURES.md` — routing to kitchen printers is explicitly out of scope
  today, not built).
- **Where a bill is finalized**: `BillingPage.tsx` (`/tables/:id/billing`, full-screen) shows the
  receipt panel (line items grouped by round, subtotal/tax/gratuity/total) and a payment-method
  selector (Cash / Card / UPI). On confirm it dispatches `COMPLETE_PAYMENT` →
  `api.orders.capturePayment` (server recomputes subtotal/tax and closes the `Order`), then
  navigates to `PaymentCompletePage.tsx` with `{ method, totalCents, tableLabel }` in router state.
  **This is the natural point to trigger a receipt print** — `BillingPage` already has every
  field a receipt needs (tenant name, GST number, line items with modifiers, tax rate, totals,
  tendered/change for cash), and `PaymentCompletePage` is the natural "print the receipt now
  that payment is captured" moment.
- **Existing settings pattern to reuse**: `/settings/payments` (`PaymentsPage.tsx`) is the closest
  precedent — a focused settings page that loads `api.tenant.current()`, edits a couple of fields,
  saves via `api.tenant.update({...})` (`PATCH /tenant`, `settings.manage`-gated), with a card in
  `SettingsPage.tsx`'s grid and a route in `App.tsx`. The new Printer settings page will follow
  this exact shape.
- **Money/tenant data available**: `Tenant` already carries `currency`, `taxRate`, `gstNumber`,
  plus `theme` stored as a Prisma `Json` column (`printer` config will follow the same pattern —
  see §3). `AdminStore`'s `state` already exposes `taxRate`, `gstNumber`, `tenantName`,
  `currencySymbol`, and a `money()` formatter that all pages share.

## 2. Why a local print agent (confirming your framing)

Confirmed by reading the code: this app has no direct hardware access path. Browsers can't hold
a persistent raw socket to `printerip:9100`, WebUSB requires a user gesture + explicit device
pairing every time and doesn't work for many thermal printer chipsets, and WebBluetooth's GATT
model doesn't map to the classic RFCOMM serial profile most receipt printers use. The standard,
reliable pattern (used by Square, Toast, most POS thermal-printing setups) is exactly what you
described: a small always-running **local agent process** that owns the printer connection, and
the browser talks to it over plain `http://` on the LAN/localhost.

## 3. Proposed architecture

```
┌─────────────────────────┐        ┌──────────────────────────┐
│ restaurant-admin (SPA)  │        │ services/api (NestJS)     │
│  BillingPage /          │◄──────►│  Tenant.printer  (JSON)   │  ← printer config,
│  PaymentCompletePage    │  HTTP  │  PATCH /tenant             │    same pattern as
│  Settings → Printer     │        │  (settings.manage-gated)   │    Tenant.theme
└───────────┬─────────────┘        └──────────────────────────┘
            │ fetch(agentUrl + "/print", { receipt, connection })
            │ (LAN or localhost — NOT through @amber/api-client;
            │  agentUrl is per-deployment, not the Amber API)
            ▼
┌──────────────────────────────────────────┐
│ Print Agent (services/print-agent)        │
│  Node.js + Express, runs on staff PC or   │
│  a small box near the printer             │
│  ── node-thermal-printer ──               │
│  POST /print       → format + send        │
│  POST /print/test  → 2-line test receipt  │
│  GET  /health       → {ok, version}       │
└───────────┬───────────┬───────────┬──────┘
            │ USB        │ Bluetooth  │ Network (TCP :9100)
            ▼            ▼            ▼
      Thermal printer (any of the three, per deployment)
```

**Key design decision: the agent is stateless.** It does not read a config file of its own.
Every `/print` request carries *both* the receipt content *and* the printer connection details
(`{ type: "usb"|"bluetooth"|"network", ... }`). The browser is what knows "this tenant's printer
is a network printer at 192.168.1.50:9100" — because that's tenant settings, already stored and
edited the same way `upiId`/`theme` are. This means:

**Auth: shared secret, off by default, on by default in the UI.** Since the printer can be on a
*different* device than the browser (not just the same PC — confirmed in the brief), an
unauthenticated `POST /print` on shared WiFi lets anyone spam-print or push garbage to the
printer. Every printer-settings record carries an optional `agentSecret`; when set, the browser
sends it as `X-Agent-Secret` on `/print` and `/print/test`, and the agent rejects (401) requests
missing or mismatching it. `GET /health` stays open — it returns no receipt data and needs to work
before a secret is even configured, as a basic "is anything listening here" check. If
`agentSecret` is empty, the agent runs in **open mode** (so a same-PC/dev setup isn't forced to
configure anything) but Settings → Printer shows a persistent warning in that state: *"No security
key set — only safe if the printer is on this same PC."* See §5 and §6.2 for the concrete wiring.

This means, overall:

- No config file to keep in sync on the printer machine; reinstalling/replacing the agent binary
  is trivial (it's pure compute, no state).
- One agent binary works for every tenant/deployment — differences are all in what the browser
  sends it.
- Setting up a new restaurant = same "fill in Settings → Printer" flow you already have for UPI,
  not a separate provisioning step on the print PC.

The only thing that must be configured *at* the agent's location is where it runs (`agentUrl`,
which itself is a Settings field, defaulting to `http://localhost:9200`) — because *that* really is
a property of the deployment topology (same PC as the browser vs. a separate box), not something
the browser can discover.

## 4. Settings data model

New Zod schema, `packages/domain/src/printer.ts` (mirrors the shape of `theme` on `Tenant`):

```ts
printerConnectionTypeSchema = z.enum(["usb", "bluetooth", "network"]);

printerSettingsSchema = z.object({
  agentUrl: z.string().url().default("http://localhost:9200"),
  // Shared secret sent as `X-Agent-Secret`. Empty/unset → agent runs in open
  // mode (fine for same-PC setups); Settings UI warns when this is empty.
  agentSecret: z.string().optional(),
  connectionType: printerConnectionTypeSchema.default("network"),
  // USB: OS-level printer/device identifier (e.g. "printer:POS-80" or a device path)
  usbPath: z.string().optional(),
  // Bluetooth: printers are paired at the OS level and exposed as a virtual
  // serial/COM port (e.g. "COM5" on Windows, "/dev/rfcomm0" on Linux/Pi) —
  // node-thermal-printer talks to that port, not a raw MAC/RFCOMM socket.
  bluetoothPort: z.string().optional(),
  // Network: printer's own IP + ESC/POS port (9100 is the near-universal default)
  networkHost: z.string().optional(),
  networkPort: z.number().int().positive().default(9100),
  paperWidth: z.enum(["58mm", "80mm"]).default("80mm"),
}).partial(); // all-optional at rest; UI enforces "required for the chosen type" before save
```

Changes to existing files:
- `packages/domain/src/tenant.ts`: add `printer: printerSettingsSchema.default({})` to
  `tenantSchema`, and `printer: printerSettingsSchema.optional()` to `updateTenantRequestSchema`
  (same treatment `theme` already gets).
- `services/api/prisma/schema.prisma`: add `printer Json?` to `model Tenant` (same style as the
  existing `theme Json` column) → `pnpm db:generate` + `prisma db push`.
- `services/api/src/tenant/tenant.mapper.ts` / `tenant.service.ts`: pass `printer` through on
  read and on `PATCH /tenant`, same as `theme`/`upiId` today. No new endpoint needed — this rides
  the existing `GET /tenant` / `PATCH /tenant` (`settings.manage`-gated) pair.
- `packages/api-client/src/index.ts`: no new resource method needed — `tenant.current()` /
  `tenant.update()` already round-trip whatever fields the schema has.

## 5. Print Agent service (`services/print-agent`)

New workspace package (pnpm already globs `services/*`), structured like a slim sibling of
`services/api` — but it is **not deployed to the cloud**; it's downloaded/run locally per
restaurant, same spirit as `tools/kds-relay.mjs` being a local dev process, except this one is
meant to run in production on-site.

```
services/print-agent/
├── src/
│   ├── index.ts            # Express app, CORS (open — LAN-only trust model), port from env
│   ├── auth.ts              # requireAgentSecret middleware — 401s /print + /print/test
│   │                        #   when AGENT_SECRET env is set and X-Agent-Secret is missing/wrong;
│   │                        #   no-op (open mode) when AGENT_SECRET is unset
│   ├── routes/
│   │   └── print.ts        # POST /print, POST /print/test (both behind auth.ts), GET /health (open)
│   ├── printer/
│   │   ├── connect.ts      # (connectionConfig) → configured node-thermal-printer instance
│   │   │                   #   usb      → interface: `printer:${usbPath}`
│   │   │                   #   bluetooth→ interface: `serial:${bluetoothPort}` (paired OS-side)
│   │   │                   #   network  → interface: `tcp://${host}:${port}`
│   │   └── render.ts       # (ReceiptPayload) → sequence of node-thermal-printer calls
│   │                       #   (alignCenter/bold/println/drawLine/cut, from the shared schema)
│   └── receipt-schema.ts   # re-exports @amber/domain's receipt schema for request validation
├── package.json             # deps: express, node-thermal-printer, zod, cors
└── README.md                 # "how to install & run this on the printer's machine" (Windows
                               # service / pm2 / just `node dist/index.js` — packaging is a
                               # later decision, see §8 open questions)
```

**Endpoints:**
- `GET /health` → `{ ok: true, version }`. Used by Settings → Printer's "Test Connection" button
  to confirm the *agent itself* is reachable, independent of the printer.
- `POST /print/test` → body `{ connection: PrinterConnection }`. Prints a short fixed test slip
  ("Test print · <tenant-agnostic> · timestamp"). Used by the "Print Test Receipt" button in
  Settings, so staff can verify the exact connection config before relying on it at checkout.
- `POST /print` → body `{ connection: PrinterConnection, receipt: ReceiptPayload }`. Formats and
  sends the real receipt. Returns `{ success: true }` or `{ success: false, error: string }` with
  an appropriate HTTP status (200 vs 4xx/5xx) so the browser can distinguish agent-level rejection
  (bad payload) from printer-level failure (offline/unreachable — caught around the
  node-thermal-printer call).

**Why `node-thermal-printer` specifically**: it already has drivers for `printer:` (OS/USB print
queue), `tcp://` (network ESC/POS), and generic serial interfaces (covers the paired-Bluetooth-as-
COM-port case) behind one `execute()`/builder API, and supports both EPSON and STAR command sets —
matches "one library, three connection types" from your brief.

**Auth mechanics**: the agent is stateless about *tenant/printer config*, but it does need exactly
one local secret to compare against — set via an `AGENT_SECRET` environment variable at process
start (documented in the README as "set this to the same value you enter in Settings → Printer").
`auth.ts`'s middleware runs before `/print` and `/print/test`: if `AGENT_SECRET` is unset, it's a
no-op (open mode); if set, it 401s any request whose `X-Agent-Secret` header doesn't match.
`GET /health` never checks it, so Settings → Printer's "Test Connection" works even before the
secret is configured on either side.

## 6. Web app integration

### 6.1 New: `apps/restaurant-admin/src/lib/printAgent.ts`
A small standalone fetch wrapper — deliberately **not** routed through `@amber/api-client`,
because the agent isn't the Amber API: it's a per-deployment host with no tenant-slug header, no
auth token, no domain-schema response validation against the Amber contract. Responsibilities:
- `printReceipt(settings: PrinterSettings, receipt: ReceiptPayload): Promise<PrintResult>`
- `printTestReceipt(settings: PrinterSettings): Promise<PrintResult>`
- `checkAgentHealth(agentUrl: string): Promise<boolean>`
- Every call wrapped with an `AbortController` timeout (~8s) so a hung/offline agent doesn't
  freeze the UI, and a try/catch that classifies the failure (see §7).

### 6.2 New: `apps/restaurant-admin/src/pages/PrinterPage.tsx` (`/settings/printer`)
Same shape as `PaymentsPage.tsx`: load `api.tenant.current()` on mount, form for `agentUrl` +
connection-type selector + the fields relevant to the selected type, Save → `api.tenant.update({
printer: {...} })`. Adds:
- **Security key** field (`agentSecret`) — a "Generate" button fills it with a random value
  (e.g. `crypto.randomUUID()`) as the default, but it stays a plain editable text input so it can
  be copied to the agent's `AGENT_SECRET` env var, or cleared to disable auth entirely. While
  empty, the page shows a persistent inline warning: *"No security key set — only safe if the
  printer is on this same PC."* The field is masked (password-style) with a reveal toggle, same
  treatment as any credential field.
- **Test Connection** button → `checkAgentHealth()` → green/red status chip (hits `/health`, no
  secret needed).
- **Print Test Receipt** button → `printTestReceipt()` (sends the secret if set) → surfaces
  success/failure inline, including a distinct "wrong security key" message on a 401.
- Add a card to `SettingsPage.tsx`'s `CARDS` array ("Printer" / `print` icon / "Configure your
  receipt printer connection.") and a guarded route in `App.tsx` next to `/settings/payments`.

### 6.3 Trigger points — and surviving a refresh

**Refresh-safety fix (approved amendment):** router state alone (`useLocation().state`) doesn't
survive a page refresh or a direct link open, so a receipt built only from router state would be
unprintable/unreprintable after a reload. Fix, mirroring how the rest of this app treats router
state as a *fast path* with a server-backed *fallback* (see `CLAUDE.md`'s session-resume pattern):

- `BillingPage.tsx`'s `complete()` already knows the order id (`activeTable.session.orderId`).
  Put it in the **URL**, not just router state: navigate to
  `/tables/${id}/complete?order=${orderId}` (query params survive refresh; router state doesn't).
  Router state still carries `{ method, totalCents, tableLabel }` as today, purely as a fast-path
  hint to avoid a refetch flash on the happy path.
- `PaymentCompletePage.tsx` reads `orderId` from the query string (`useSearchParams`). If router
  state is present (fresh navigation), render immediately from it. Regardless, kick off a
  **rebuild-from-API** in the background (or immediately, if router state is absent — reload/
  direct-link case): `api.orders.get(orderId)` for line items/modifiers (already validated against
  `orderSchema`, includes cancelled-item filtering the same way `BillingPage` does it) + tenant
  fields already sitting in `AdminStore`'s `state` (`tenantName`, `gstNumber`, `currency`,
  `taxRate`) + **payment breakdown** (see below). The "Print Receipt" button always prints from
  this rebuilt data, never from stale router state alone — so both the immediate print and any
  later reprint use the same code path.
- **Gap found while tracing this**: `GET /orders/:id` (`orderSchema`) has no `Payment` fields —
  no `method`, `tip`, `tendered`, or the snapshotted `tax`. `GET /orders/sales` (`Sale[]`) has
  `method` + `total` but not the subtotal/tax/tendered breakdown a receipt needs. **A new
  endpoint is required**: `GET /orders/:id/payment` → `Payment | null` (staff-only, `JwtAuthGuard`,
  same shape `capturePayment` already returns — `orders.service.ts` just needs
  `prisma.payment.findUnique({ where: { orderId } })` + the existing `toDomainPayment` mapper).
  Add `orders.getPayment(id): Promise<Payment | null>` to `@amber/api-client`. This is the one
  new backend surface this feature needs beyond the `Tenant.printer` field.
- **Second gap found while tracing this**: `BillingPage.tsx`'s `complete()` computes `tendered`/
  `change` locally for cash but never sends `tendered` through `COMPLETE_PAYMENT` → the API's
  `capturePaymentSchema` already accepts an optional `tendered` field and `capturePayment(...)`
  already persists it — the DTO/service need no changes, only the frontend call is missing it.
  Without this, a *reprint* (which must read `tendered` back from `GET /orders/:id/payment`) would
  show total but no change-due for cash, even though the original *immediate* print (built from
  local state) would have it — an inconsistency between first print and reprint. **Fix (approved,
  in scope)**: thread `tendered` (cents) through the `COMPLETE_PAYMENT` action in
  `AdminStore.tsx` and the `api.orders.capturePayment(...)` call in `BillingPage.tsx`'s
  `complete()`, cash only.
- **`PaymentCompletePage.tsx`**: replace the `window.print()` handler with
  `printAgent.printReceipt(tenantPrinterSettings, receipt)` where `receipt` comes from the
  rebuilt-from-API data above. Show a toast/banner for the print result (success / "printer
  offline, retry?" with a retry button — a failed print shouldn't block "Back to Tables"), and
  always keep a "Print Again" button available (covers reprints and paper jams alike).
- **`BillingPage.tsx`**: optionally add a "Print" affordance on the receipt panel itself (useful
  for a pre-payment kitchen/customer copy) — lower priority than the post-payment print, worth
  confirming you want it; not required for the refresh-safety fix since that page always has live
  order state already.

## 7. Receipt content & failure handling

### 7.1 Receipt payload (shared schema)
New `packages/domain/src/receipt.ts` — a `receiptSchema` the web app builds and the agent
validates, so both sides share one contract (matches this repo's "Zod is the contract" convention):

```ts
receiptLineSchema = z.object({
  name: z.string(),
  qty: z.number().int().positive(),
  unitPrice: moneyMinorSchema,     // includes modifier deltas, matches orderItemUnitPrice()
  modifiers: z.array(z.string()).default([]), // flattened display strings, e.g. "Spice: Hot"
});

receiptSchema = z.object({
  tenantName: z.string(),
  gstNumber: z.string().optional(),
  tableLabel: z.string(),
  checkNumber: z.string(),          // derived from order/table id, as today's UI does
  createdAt: isoTimestampSchema,
  lines: z.array(receiptLineSchema),
  subtotal: moneyMinorSchema,
  taxRate: z.number(),
  tax: moneyMinorSchema,
  gratuity: moneyMinorSchema.optional(),
  total: moneyMinorSchema,
  method: paymentMethodSchema,      // reuse from payment.ts
  tendered: moneyMinorSchema.optional(),
  change: moneyMinorSchema.optional(),
  currency: z.string().length(3),
  footerMessage: z.string().optional(), // e.g. "Thank you for dining with us!"
});
```

Everything in this payload is already present on the `BillingPage`/`AdminStore` state — no new
backend data is required, this is purely reshaping existing values.

### 7.2 Formatting → ESC/POS
Formatting logic lives **only** in the agent (`printer/render.ts`), not the browser — the browser
never needs to know ESC/POS. The agent walks the `receiptSchema` payload and calls
`node-thermal-printer`'s builder methods (`alignCenter().bold(true).println(tenantName)`, a table
layout per line item, `drawLine()`, totals block right-aligned, `cut()`). Paper width
(`58mm`/`80mm`) from printer settings adjusts column widths.

### 7.3 Failure states (surfaced distinctly, not one generic "print failed")
| Failure | Detection | UI message |
|---|---|---|
| Agent unreachable | `fetch` throws / times out before response | "Can't reach the print agent at `<agentUrl>`. Is it running?" |
| Wrong agent URL/CORS | `fetch` throws (network-level) | same as above — indistinguishable from offline at the browser layer, message says "check Settings → Printer" |
| Printer offline/unreachable from agent | Agent returns `{success:false, error}` after its own connect attempt fails | Show the agent's `error` string (e.g. "Network printer 192.168.1.50:9100 timed out") |
| Bad/incomplete printer config | Agent validates `connection` before attempting hardware, 400s | "Printer isn't configured — finish setup in Settings → Printer" |
| Wrong/missing security key | Agent's `auth.ts` middleware 401s | "Security key doesn't match — check Settings → Printer" (distinct from "agent unreachable") |
| Print succeeded, staff wants another copy | N/A | Always show a "Print Again" affordance, not just on first failure |

## 8. Step-by-step implementation plan

1. **Domain**: add `packages/domain/src/printer.ts` (`printerSettingsSchema`, incl. `agentSecret`)
   and `packages/domain/src/receipt.ts` (`receiptSchema`); export both from `index.ts`; extend
   `tenantSchema` / `updateTenantRequestSchema` in `tenant.ts` with `printer`.
2. **API — tenant printer config**: add `printer Json?` to `Tenant` in `schema.prisma`;
   `pnpm db:generate` + `prisma db push`; thread `printer` through `tenant.mapper.ts` and the
   update path in `tenant.service.ts` (mirrors how `theme`/`upiId` are already handled).
3. **API — payment lookup endpoint (new)**: add `GET /orders/:id/payment` to
   `orders.controller.ts` (`JwtAuthGuard`) → `orders.service.ts` `getPayment(tenantId, orderId)`
   (`prisma.payment.findUnique` + `toDomainPayment`) → `Payment | null`; add
   `orders.getPayment(id)` to `@amber/api-client`.
4. **API/web — tendered wiring fix**: pass `tendered` (cents, cash only) through
   `AdminStore.tsx`'s `COMPLETE_PAYMENT` action into `api.orders.capturePayment(...)` from
   `BillingPage.tsx`'s `complete()`. No DTO/service changes needed — `capturePaymentSchema`
   already accepts it.
5. **Print agent**: scaffold `services/print-agent` (`package.json`, `tsconfig` extending
   `@amber/config`), add `express` + `node-thermal-printer` deps, implement `auth.ts`
   (`AGENT_SECRET` env → `X-Agent-Secret` check), `connect.ts` (connection-type → interface
   string), `render.ts` (receiptSchema → print commands), `routes/print.ts` (`/health` open,
   `/print`+`/print/test` behind `auth.ts`), `index.ts` bootstrap (`PRINT_AGENT_PORT`, default
   9200, `0.0.0.0` bind, open CORS).
6. **Web app — settings**: `lib/printAgent.ts` (fetch wrapper, sends `X-Agent-Secret`, timeout +
   error classification incl. 401), `pages/PrinterPage.tsx` (form incl. security-key field +
   generate/reveal + "no key" warning, Test Connection, Print Test Receipt), card in
   `SettingsPage.tsx`, route in `App.tsx` (`settings.manage`-gated, alongside
   `/settings/payments`).
7. **Web app — trigger wiring**: `BillingPage.tsx`'s `complete()` navigates with `orderId` in the
   query string (`/tables/:id/complete?order=...`) plus the existing router-state fast path;
   `PaymentCompletePage.tsx` rebuilds the receipt from `api.orders.get(id)` +
   `api.orders.getPayment(id)` + `AdminStore` tenant fields, replaces `window.print()` with
   `printAgent.printReceipt(...)`, adds result toast/retry + a persistent "Print Again" button.
   Optionally add a print button on `BillingPage.tsx` itself.
8. **Docs**: update `docs/apps/restaurant-admin.md` (new Printer settings section + the new
   `GET /orders/:id/payment` route in `docs/PROJECT.md`'s route map) and `CLAUDE.md`'s
   per-instruction "keep this updated" note once the flow is real, plus a short
   `services/print-agent/README.md` for on-site install/run instructions (incl. setting
   `AGENT_SECRET` to match Settings → Printer).
9. **Manual verification**: at minimum, a Network-type printer (or a TCP mock listening on 9100
   that just logs bytes) end-to-end through Settings → Test Connection → Print Test Receipt →
   a real `BillingPage` checkout → `PaymentCompletePage` print, including a page refresh between
   checkout and print to prove the refetch path works, and one run with a wrong security key to
   prove the 401 path surfaces correctly. USB/Bluetooth verified against whatever hardware you
   have on hand.

## 9. Open questions (non-blocking)

- **Packaging of the agent for non-technical restaurant staff**: run via `node` from source (dev-
  style), or eventually package as a standalone executable (`pkg`/`nexe`) or an installable
  Windows service so it survives a PC reboot without someone manually starting it? Doesn't block
  building the agent itself; affects the README/ops story only.
- **Multiple printers per tenant** (e.g. one at the counter, one in the kitchen): out of scope per
  your brief (this is guest receipt printing, not kitchen-station routing, which `FEATURES.md`
  already flags as a separate deferred feature) — single-printer-per-tenant for v1.

## 10. What shipped

All nine steps in §8 are done: domain schemas (`printer.ts`, `receipt.ts`), `Tenant.printer`
column + `PATCH /tenant` wiring, the new `GET /orders/:id/payment` endpoint +
`api.orders.getPayment()`, `tendered` now flows through `COMPLETE_PAYMENT`,
`services/print-agent` (scaffolded, built, and smoke-tested — health check, missing-config 400,
missing/wrong-secret 401, unreachable-printer 502 all verified against a running instance),
`lib/printAgent.ts`, `PrinterPage.tsx` + its `SettingsPage.tsx` card + `App.tsx` route, and
`PaymentCompletePage.tsx`'s rebuild-from-API receipt flow with `window.print()` replaced by the
real agent call. The optional pre-payment print button on `BillingPage.tsx` (§6.3, flagged as
lower-priority/unconfirmed) was **not** added — everything else was.

**Bug found and fixed during verification**: NestJS sends an **empty response body** — not the
JSON literal `null` — when a controller handler's return value is `null`/`undefined`
(`RouterResponseController` treats both as "no body"). The api-client's
`paymentSchema.nullable()` can't parse an empty string, so `GET /orders/:id/payment` on an unpaid
order threw a `ZodError` instead of resolving to `null`. Fixed in `orders.controller.ts`'s
`getPayment` by taking over the response with `@Res() res: Response` and calling `res.json(payment)`
directly, which serializes `null` correctly (bypassing Nest's automatic handling for this one
route only). Note this same bare-`| null`-return pattern already exists on
`billing.controller.ts`'s `getMine`/`getSubscription` — not touched here (out of scope), but
worth knowing if either is ever seen returning an unparseable empty body.

**Verified end-to-end at the API/agent layer** (via `curl` against the running dev API with a
seeded login, and against a locally built/run agent instance): `GET /tenant` defaults
`printer` to `{}`; `PATCH /tenant {printer:{...}}` persists and round-trips through `GET /tenant`
with the tenant cache correctly invalidated; `GET /orders/:id/payment` returns the right
`Payment` shape for a paid seeded order and literal `null` for an unpaid one; the agent's
`/health`, `/print/test` (config-error → 400, wrong-secret → 401, unreachable-printer → 502) all
behaved as designed. **Not verified**: an actual click-through of the restaurant-admin UI (login →
checkout → `PaymentCompletePage` → Print Receipt → mid-flow refresh → reprint) — no browser
automation tool was available in this session. `pnpm turbo run typecheck` passes clean across all
10 workspace packages including the new `@amber/print-agent`.

## 11. Follow-up: Receipt Layout designer (logo, UPI/review QR, drag-reorder + live preview)

Added after the initial cut, in response to a follow-up request: connect a real printer, make the
receipt content editable (name/logo already existed elsewhere — Restaurant Profile / Branding —
this is about whether/where they *appear on the receipt*), and print QR codes for UPI payment and
for the review link. Confirmed with the user: **toggle + drag-to-reorder** (not toggle-only), and
**both** a live on-screen preview *and* the existing real "Print Test Receipt" stay available.

**Domain** (`packages/domain/src/printer.ts`, `receipt.ts`, `payment.ts`):
- `receiptSectionTypeSchema` — 9 fixed section types: `logo`, `header` (name+GST),
  `orderInfo` (table/check/timestamp), `lineItems`, `totals`, `paymentMethod`
  (incl. tendered/change), `upiQr`, `reviewQr`, `footer`. `lineItems`/`totals` stay atomic blocks
  (their internal math can't be scrambled) — only these 9 blocks are toggle/reorderable, not
  individual fields within them.
- `printerSettingsSchema` gains `sections: ReceiptSection[]` (an **ordered array** doubles as the
  reorder mechanism — no separate position field) and `footerMessage: string`.
  `DEFAULT_RECEIPT_SECTIONS` is the fallback when a tenant hasn't customized layout yet (QR
  sections default **off** since they need UPI/review-link config elsewhere to have content).
- `receiptSchema` gains `logoUrl`, `upiPaymentUrl` (precomputed deep link), `reviewUrl`, and
  `sections` — the browser resolves all of this from tenant data (`theme.logoUrl`, `upiId`,
  `theme.reviewLink` — all pre-existing fields, no new data entry needed) and hands the agent a
  fully-resolved payload, keeping the agent stateless per the original design.
- `buildUpiPaymentUrl()` relocated from a private helper in `BillingPage.tsx` into
  `payment.ts` so the live checkout QR and the printed receipt's QR share one implementation
  (`pa=` must stay un-encoded or UPI apps reject the QR — a subtlety worth not duplicating).

**Print agent** (`printer/render.ts`): rewritten from a fixed sequence into a
`Record<ReceiptSectionType, SectionRenderer>` dispatch, looping over `receipt.sections` (falling
back to `DEFAULT_RECEIPT_SECTIONS`). New capabilities used directly from `node-thermal-printer`:
`printQR()` for the UPI/review sections, `printImageBuffer()` for the logo (fetched over HTTP by
the agent, not the browser). **Constraint**: `node-thermal-printer`'s image backend is `pngjs` —
**PNG only**. A non-PNG logo or an unreachable URL fails soft (the `try/catch` in `renderLogo`
skips the section) rather than failing the whole receipt — verified by smoke test (fed a
guaranteed-unreachable logo URL + real QR data through the full `/print` pipeline against an
unreachable printer; every section rendered/skipped correctly, only the final `printer.execute()`
threw, and the agent process stayed healthy afterward).

**restaurant-admin**: `PrinterPage.tsx` gained a "Receipt Layout" section — a **native HTML5
drag-and-drop** reorderable list (no new dependency; 9 rows doesn't justify pulling in a DnD
library) with a `Toggle` per row and an inline hint when a QR/logo row is enabled but its backing
data (UPI ID / review link / logo) isn't configured yet, linking to the settings page that owns
it. A `footerMessage` text input is disabled unless the `footer` row is enabled. The page is now a
two-column layout (`PaymentsPage.tsx`'s aside pattern) with a **live preview** — a mocked
strip-of-paper rendering (real `QRCodeCanvas` for the QR sections, sample line items, the tenant's
actual name/logo/GST) that re-renders instantly as sections are toggled/reordered, no round trip
to the agent. The real "Print Test Receipt" button is unchanged and still the way to verify actual
hardware output. `PaymentCompletePage.tsx`'s `buildReceipt()` now also resolves `logoUrl` /
`upiPaymentUrl` / `reviewUrl` / `sections` from the tenant so real receipts follow whatever layout
was configured.

**Verified**: full monorepo typecheck (11/11 packages); `PATCH /tenant` persisting and
round-tripping a custom `sections` order + `footerMessage` through `GET /tenant` (including a
non-default order, to prove reordering actually round-trips, not just toggling); the print-agent's
section dispatch handling logo failure + real QR generation without crashing, verified against a
running instance. **Not verified**: the drag-and-drop interaction itself and the live preview
UI in an actual browser (no browser automation tool available), and no physical printer/logo was
available to confirm real paper output.
