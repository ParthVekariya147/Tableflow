# TableFlow — Product Feature List (client-facing)

> Sales / marketing reference. Everything listed under "Shipped" is actually built and
> running in the product today. The "Roadmap" section at the end is what is NOT yet
> live — do not promise those to a client as available.
> Internal note: "Amber" appears in code and demo data as the platform/demo tenant
> codename. The product name for all customer-facing material is **TableFlow**.

---

## 1. One-line positioning

**TableFlow is a complete QR-based restaurant operating system — the guest orders from
their own phone, the kitchen sees it instantly, the counter bills it, and the owner sees
the money in real time. One system replaces the menu card, the order pad, the KOT slip,
the billing software and the sales register.**

---

## 2. Landing-page headline features (the 8 that sell it)

| # | Feature | One-line pitch |
|---|---------|----------------|
| 1 | **QR Code Ordering** | Guest scans the table QR, sees your live menu with photos, and orders — no app install, no download, no waiter needed to take the order. |
| 2 | **Live Kitchen Display (KDS)** | Orders land on the kitchen screen the second the guest taps order. Full-screen kitchen mode, no paper, no lost slips. |
| 3 | **Real-Time Everything** | Guest phone, kitchen screen, floor view and cashier stay in sync live. Cancel an item at the counter and the guest's phone updates instantly. |
| 4 | **Owner Dashboard & Analytics** | Today's revenue, live tables, orders in progress, best-selling items, peak hours, category split, and growth vs. the previous period. |
| 5 | **Billing & Quick Sale** | Full table billing with cash/card/UPI, plus a walk-in counter "Quick Sale" mode that works on any phone as an extra till. |
| 6 | **Thermal Bill & KOT Printing** | Prints GST-compliant bills on your existing thermal/label printer — including from phones and tablets, over the cloud relay. |
| 7 | **Your Brand, Not Ours** | Your name, logo, colours and fonts across the whole guest experience and admin panel. Guests see your restaurant, not a third-party app. |
| 8 | **Staff Roles & Permissions** | Owner, Manager, Cashier, Kitchen — you create the roles and decide exactly what each person can see and do. |

---

## 3. Full feature inventory (SHIPPED)

### 3.1 Guest ordering app (customer phone — no install required)

- **QR-to-table entry** — each table has its own QR code; scanning it identifies the
  restaurant AND the exact table automatically. No table number typing, no PIN.
- **Zero app install** — opens straight in the phone browser (works on Android and iOS).
- **Reserve the table** — guest enters name + phone to start the session (captured onto
  the bill/receipt and used for loyalty).
- **Live digital menu** — categories, item photos, descriptions, prices; always current,
  never a reprinted menu card. Sold-out items can be hidden instantly.
- **Item customisation (modifiers)** — spice level, size, add-ons, toppings, free-text
  cooking notes. Supports single-choice, multi-choice, on/off toggles and text, with
  required/min/max rules and per-option price changes. Price updates live as the guest
  chooses.
- **Two ordering modes** — "**Bring it**" (send this item now) and "**Bring these**"
  (send the whole selection together), so guests can order in rounds through the meal
  exactly like they would with a waiter.
- **Live order tracking** — the guest sees each item move through *Placed → Preparing →
  Ready → Served*, so "where is my food?" stops being a question staff has to answer.
- **Quick Actions row** — one-tap **Water / Call Staff / Call Manager**, plus up to 4
  fully custom buttons you define yourself (own label, icon and colour). These are staff
  notifications, not kitchen orders.
- **View bill / request bill** — running bill on the phone at all times; one tap to
  request the bill, which instantly flags the table at the counter.
- **Pay online or pay at counter** — card/online settles immediately and closes the
  table; cash shows a "pay at the counter" screen and closes only when staff actually
  take the money.
- **Refresh-safe, device-bound sessions** — the session survives a page refresh, a locked
  phone or a dropped network, and is tied to that guest's device so nobody else can open,
  read or add to their bill.
- **Fully branded** — the guest sees your logo, your colours and your fonts throughout.

### 3.2 Kitchen Display System (KDS)

- **Live ticket board** — every round appears the moment it is placed.
- **Two display modes** — inside the admin panel for managers, plus a chrome-free
  **full-screen kitchen mode** for a wall-mounted screen or tablet.
- **Stage advancing** — kitchen taps to move items Preparing → Ready → Served; the status
  reaches the guest's phone and the floor view immediately.
- **Self-cleaning board** — cancelled items and settled/cancelled orders disappear from
  the board automatically, so the kitchen never cooks a dead ticket.
- **Item-level control** — quantities, modifiers and cooking notes are printed on the
  ticket; no prices to distract the kitchen.

### 3.3 Floor & table management

- **Visual floor view** — every table with live status: free, occupied, awaiting bill.
- **Per-table QR codes** — generated in-app, downloadable as PNG or copyable as a link,
  ready to print and place on the table.
- **QR regeneration** — rotate a table's code (behind a confirmation) if a printed QR
  leaks or a sticker is damaged.
- **Add / edit / delete tables**, with rooms/sections and custom ordering; deletion is
  blocked while a table is occupied or holds history.
- **Table session view** — everything the table has ordered, per round, with live status,
  plus the ability for staff to add items, cancel items or cancel the whole session.
- **Single-occupancy protection** — one live session per table, enforced on the server, so
  two guests or a stale phone can never open duplicate bills on the same table.
- **Service-request alerts** — a live notification bell with count and sound chime when a
  guest asks for water/staff/manager, PLUS a pulsing badge on that table's card on the
  floor view. Acknowledge or resolve in one tap.

### 3.4 Billing & payments

- **Billing queue** — a single floor-wide list of every table waiting to pay.
- **Full checkout** — subtotal, tax, tip, total computed on the server (never trusted from
  the phone), with cancelled items excluded automatically.
- **Cash, Card and UPI** tenders, with cash-tendered / change-due calculation.
- **Accepted-methods control** — turn any tender on or off for your restaurant; it
  disappears from every checkout screen and the guest's phone instantly.
- **UPI payment QR on the bill** — your UPI ID/mobile printed as a scannable QR on
  unsettled bills.
- **Remembers the cashier's last-used payment method** for faster repeat billing.
- **Quick Sale (walk-in counter mode)** — ring up takeaway/counter sales without a table.
  The cart lives on that device only, so **several phones or tills can bill in parallel**
  with no cross-device mix-up, and a refresh, app close or short offline spell loses
  nothing.
- **Payment safety guarantees** — a sale is reported successful **only** when the server
  confirms the payment record, and Quick Sale carries an idempotency key so a retry or a
  lost response can never double-charge a customer or create a duplicate sale.

### 3.5 Menu management

- **Categories and items** — create, edit, reorder, delete; deletion of a category in use
  is blocked.
- **Photo upload per item** — images hosted in cloud storage, shown on the guest's phone.
- **Modifier group builder** — build add-on/variant groups per item with input type,
  required flags, min/max selections and price deltas, all in one modal.
- **Price and availability control** — change a price or 86 an item and it is live on
  every guest phone immediately. No reprinting, no version drift.

### 3.6 Dashboard & analytics

- **Owner dashboard** — today's revenue with growth vs. the previous period, active
  tables, orders in progress, 86'd items, tables awaiting bill, and a live activity feed.
- **Sales analytics page** with range selector (Today / Yesterday / 7 Days / 30 Days):
  - Revenue trend line
  - Orders count and average ticket size
  - Period-over-period growth deltas on every KPI
  - **Top-selling items** table
  - **Category split** donut
  - **Peak hours** chart — see exactly when your rush is
- **Order history** — completed and paid sales for any date range (Today / Yesterday /
  Last 7 days / All), with revenue and count summary and expandable rows showing exactly
  what each table ordered.
- All figures are computed from real payment and order records — nothing is estimated.

### 3.7 Loyalty programme

- **Configurable points programme** per restaurant (earn rate, redemption rules).
- **Customer directory** keyed by phone number, searchable.
- **Points ledger** per customer — every earn and redemption with the linked orders.
- **Manual adjustment** for goodwill/corrections, staff-gated.
- Points are earned automatically on payment capture; guests never touch the system
  directly.

### 3.8 Printing (bills, receipts, kitchen tickets)

- **Works with your existing printer** — thermal receipt printers (ESC/POS) and label
  printers (TSPL, e.g. TSC DA310), over USB, Bluetooth or network.
- **GST-ready bill layout** — restaurant name, address, phone, GST number, FSSAI licence,
  guest name/phone, itemised lines, CGST/SGST split when GST-registered.
- **Live on-screen preview that matches the paper character-for-character** — what you
  design is what prints.
- **Configurable receipt sections** — reorder and switch individual blocks on/off.
- **Paper width presets** (58 / 76 / 80 / 101 mm) plus custom widths, print margins, and
  **auto-detection of paper size and DPI from the printer driver**.
- **Test print** button before you go live.
- **Print from phones and tablets (cloud relay)** — a secure outbound connection from the
  print agent means staff can print from an installed phone/tablet app with **no router
  configuration, no fixed IP, no certificates and no per-device setup**. Works on Android
  and iOS.
- **Master on/off switch** — restaurants that bill without a printer turn the entire
  module off in one click.
- Clear error reporting: unreachable agent vs. configuration problem vs. printer fault.

### 3.9 Staff, roles & security

- **Email + password login** with secure token-based sessions.
- **Custom roles** — create your own roles (Owner, Manager, Cashier, Kitchen, Captain…),
  name them what you want, and pick their exact permissions from a 9-permission catalog:
  Dashboard, Menu, Tables & Sessions, Kitchen Display, Order History, Analytics, Settings,
  Team & Roles, Loyalty.
- **Per-user permission overrides** — give one specific person an exception without
  creating a whole new role.
- **Menu adapts to the person** — a kitchen user only sees the kitchen display; they never
  even see revenue or settings.
- **Owner-tier protection** — a manager with team access still cannot edit, remove or
  promote anyone into the Owner/Admin role.
- **Last-admin lockout guard** — the system refuses to remove or downgrade your only
  remaining administrator.
- **Multi-restaurant accounts** — one login can belong to several outlets and picks the
  restaurant at sign-in.
- **Platform hardening** — request rate limiting, server-side validation of every input,
  guest sessions bound to their device, and staff-only routes permission-checked on the
  server (not just hidden in the UI).

### 3.10 Branding & restaurant settings

- **Branding page** — brand colours, font pairing and logo upload, with a **live preview
  across the whole panel** before you save.
- **Restaurant profile** — name, currency, tax rate, GST number, FSSAI licence number
  (validated), address and phone — the statutory fields that print on every bill.
- **Payments settings** — UPI ID/mobile and accepted tenders.
- **Quick Actions settings** — drag to reorder, toggle on/off, and add your own custom
  guest buttons.
- **Printer settings**, **Loyalty settings**, **Team**, **Roles** — all self-service.
- **True multi-tenancy** — every restaurant is fully isolated data-wise while running on
  one maintained platform, so you get updates without migrations or reinstalls.

### 3.11 Platform & reliability

- **Installable app (PWA)** — staff install TableFlow on a phone or tablet from the
  browser; it opens full-screen like a native app with shortcuts to Quick Sale, Kitchen
  Display and Tables.
- **Live sync architecture** — a real-time event stream keeps every screen current, with
  automatic self-healing fallback if a phone drops network or is backgrounded.
- **Cloud-hosted database** with automated backups; no server to run at the restaurant.
- **Works on any device** — phone, tablet, laptop, wall screen. Fully responsive typography
  and layout.

---

## 4. Pricing-page feature checklist (copy-paste ready)

Group as you like; this is the full tick-list.

**Guest experience**
- ✅ QR code ordering (no app install)
- ✅ Digital menu with photos
- ✅ Item customisation & add-ons
- ✅ Order in rounds ("bring it" / "bring these")
- ✅ Live order status tracking
- ✅ Call staff / water / manager buttons + custom buttons
- ✅ View & request bill from the phone
- ✅ Online or counter payment
- ✅ Your branding on the guest app

**Operations**
- ✅ Kitchen Display System + full-screen kitchen mode
- ✅ Live floor / table view
- ✅ Per-table QR generation, download & rotation
- ✅ Table session management (add/cancel items, cancel session)
- ✅ Guest service-request alerts with sound
- ✅ Billing queue
- ✅ Cash / Card / UPI billing with change calculation
- ✅ Quick Sale walk-in counter mode (multi-till)
- ✅ Menu management with photo upload
- ✅ Modifier / variant builder

**Money & insight**
- ✅ Owner dashboard (today's revenue, live tables, growth)
- ✅ Sales analytics: revenue trend, top items, category split, peak hours
- ✅ Period-over-period comparison
- ✅ Order history with date ranges & item-level drill-down
- ✅ Loyalty points programme + customer directory

**Printing**
- ✅ Thermal & label printer support (USB / Bluetooth / Network)
- ✅ GST-compliant bill with CGST/SGST split, FSSAI & GSTIN
- ✅ Configurable receipt layout with exact live preview
- ✅ Paper size & DPI auto-detection
- ✅ Print from phones/tablets with no network setup

**Admin & security**
- ✅ Custom roles & granular permissions
- ✅ Per-user permission overrides
- ✅ Multi-outlet accounts
- ✅ Branding editor (colours, fonts, logo)
- ✅ Restaurant profile & statutory settings
- ✅ Installable staff app (PWA)
- ✅ Real-time sync across all devices
- ✅ Double-charge protection & payment-safety guarantees

### Suggested plan split (a suggestion only — commercials are yours)

| | **Starter** | **Growth** | **Pro / Multi-outlet** |
|---|---|---|---|
| QR ordering + digital menu | ✅ | ✅ | ✅ |
| Kitchen Display | ✅ | ✅ | ✅ |
| Table & floor management | ✅ | ✅ | ✅ |
| Billing (cash/card/UPI) | ✅ | ✅ | ✅ |
| Dashboard (today's numbers) | ✅ | ✅ | ✅ |
| Full analytics & order history | — | ✅ | ✅ |
| Quick Sale multi-till | — | ✅ | ✅ |
| Thermal printing + phone printing | — | ✅ | ✅ |
| Loyalty programme | — | ✅ | ✅ |
| Custom roles & permissions | Basic | ✅ | ✅ |
| Custom branding (logo/colours/fonts) | — | ✅ | ✅ |
| Multi-outlet, one login | — | — | ✅ |
| Priority support / onboarding | — | — | ✅ |

---

## 5. Why this beats a "simple" system

### 5.1 vs. paper menu + order pad + manual register

| Old way | TableFlow | What the owner actually gains |
|---|---|---|
| Waiter takes the order on paper, walks it to the kitchen | Guest orders from their own phone; kitchen sees it in ~1 second | Fewer waiters needed per table; faster table turnover |
| Handwritten KOT — misread, lost, duplicated | Digital ticket with exact quantities, add-ons and notes | Wrong-dish wastage and remakes drop sharply |
| Menu reprint every time a price changes | Edit once, live on every table instantly | Zero printing cost; never sell at yesterday's price |
| Sold-out item discovered after the guest orders it | 86 the item and it disappears from every phone | No refunds, no disappointed guests |
| "Where is my order?" — waiter has to go and check | Guest watches Placed → Preparing → Ready on their phone | Far fewer interruptions for staff |
| Guest waves for water / for the bill | One tap; the counter gets an alert with a sound and the table number | Faster service, higher tips, better reviews |
| Bill written by hand, totals mis-added | Server-calculated bill with tax, GST split and statutory fields | No arithmetic leakage, GST-ready from day one |
| Sales counted at closing from a cash box | Live revenue, item-level sales, peak hours | You know today's number at 3 PM, not at midnight |
| Owner has to be present to know anything | Dashboard on the owner's phone from anywhere | Run the outlet without living in it |

### 5.2 vs. an ordinary billing/POS software

| Ordinary POS | TableFlow |
|---|---|
| Only bills — the guest still orders through a waiter | Guest self-orders; the order *is* the bill, entered once with zero re-typing |
| Installed on one Windows machine; a second till is a second licence and a second install | Runs in the browser on any phone/tablet/laptop; add a till by opening a page |
| Kitchen still gets a printed slip | Live kitchen screen, with paper printing still available if you want both |
| Screens go stale — refresh to see changes | Every screen live-syncs; cancel at the counter and the guest's phone updates instantly |
| Data lives on the shop PC — one hard-disk failure loses your history | Cloud database with backups; the shop PC is disposable |
| Reports are end-of-day exports | Real-time dashboard + analytics with period-over-period growth |
| "Payment failed?" — staff guess, sometimes charge twice | A sale is confirmed only against a real server payment record; retries are idempotent, so double-charging is structurally prevented |
| Generic vendor branding shown to your guests | Your logo, colours and fonts — guests experience *your* brand |
| One outlet per install; a chain means separate systems | Multi-outlet from one login on one platform |
| Roles are fixed (Admin/User) | You create roles and pick permissions per role, plus per-person exceptions |
| Updates mean a technician visit | Updates ship centrally; the restaurant just reloads |

### 5.3 The three arguments that close the deal

1. **Labour** — guests place their own orders, so the same floor staff covers more tables,
   and order-entry mistakes (the expensive kind) largely disappear.
2. **Speed** — order reaches the kitchen the instant the guest taps, not after a walk
   across the floor. Faster kitchen start = faster table turn = more covers per night.
3. **Visibility** — the owner gets real numbers live (revenue, top items, peak hours)
   instead of a guess at closing time, and can act on them the same week.

---

## 6. Roadmap — NOT yet available (do not sell as live)

Be straight with the client about these; they are all planned, none are blockers for
daily operation:

- **Automatic kitchen KOT printing** — the printing engine and kitchen-printer settings
  are built, but tickets are not yet auto-sent to a kitchen printer. The kitchen display
  covers this today.
- **Online payment gateway integration** — "pay online" currently records a card
  settlement; a live payment-gateway provider (Razorpay/Stripe-class) is not integrated.
- **Guest review submission** — review display exists in the data model; the guest-facing
  submit flow is not built.
- **Kitchen station routing** (separate screens for tandoor/Chinese/bar) — planned.
- **Audit log** of staff actions — planned.
- **Super-admin portal** (self-serve tenant onboarding, platform billing) — partially
  built; onboarding is currently done by your team.
- **Menu category drag-reorder** and curated menu placements — partially available.
- **In-session outlet switching** for multi-outlet users — today you log out and back in.

---

*Document generated from the shipped codebase. Re-verify before a major release.*
