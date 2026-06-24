# Settings — Research & Design Gathering

> **✅ Implemented so far (auth + RBAC foundation + Team/Roles):**
> Email+password login → JWT → role/permission resolution (`auth/` module);
> custom per-tenant **Role** table + per-user permission overrides; **Team** and
> **Roles** management pages under `/settings` (Admin-only); nav/route gating
> (hide-not-grey-out). Seeded logins use password `demo1234`
> (`manager@amberandgrain.com` = Admin, `kitchen@…` = Kitchen-only).
> **Run `cd services/api && npx prisma db push && pnpm db:seed` to apply the
> schema** (the enum→table change). Still TODO: gate `menu/tables/orders` API
> routes with `@RequirePermission`; the other Settings modules (profile/branding/
> payments); online pay.



> **Status: DRAFT for review.** This is an information-gathering doc, *not* an
> implementation plan. It catalogs what a restaurant-admin **Settings** area
> could contain, draws the worth-stealing patterns from how Microsoft structures
> tenant/admin settings, and maps every proposed module to our **existing data
> model** vs. **net-new work**.
>
> **How to use this:** read it top to bottom, then in the "Your picks" section
> (or inline) mark what you actually want. We'll turn the chosen modules into a
> real build plan after that.

---

## 0. Where we are today

- The sidebar (`apps/restaurant-admin/src/components/Shell.tsx`) has a
  **Settings** link, but it's a dead `<a href="#">` — no route, no page.
- There is **no** `/settings` route in `App.tsx` and no `SettingsPage.tsx`.
- A tenant today is a single row (`Tenant` in `prisma/schema.prisma`,
  `tenantSchema` in `@amber/domain`) with only:
  `slug · name · currency · taxRate · theme(JSON) · active`.
- Identity exists but is **not surfaced anywhere in the UI**: `User`,
  `Membership` (roles `owner | manager | server | kitchen`), `User.isSuperAdmin`.
  Auth itself is **deferred** (no login token; routes are tenant-scoped only).
- Payments today are **cash | card only**, captured in-house. There is **no
  online payment provider** wired — `payment.ts` has no provider/gateway fields
  (CLAUDE.md explicitly lists "online-pay provider fields" as deferred).

So Settings is greenfield. Almost everything below is net-new; a few modules
just expose data we already store.

---

## 1. What Microsoft actually does (the patterns worth borrowing)

Microsoft's admin surfaces (Microsoft 365 Admin Center, Azure/Entra tenant
settings, Power Platform admin) are huge, but they're built from a small set of
**repeatable patterns**. We don't want their scale — we want their structure.

### 1.1 The mental model: **Org settings** vs. **User settings** vs. **Billing**
Microsoft cleanly separates three things, and never mixes them on one screen:
- **Org / Tenant settings** — facts about the *organization* (name, domains,
  branding, security defaults, data location). Changing these affects everyone.
- **People** — users, roles, groups, who-can-do-what.
- **Billing & licenses** — payment methods, subscriptions, invoices.

> **Borrow:** keep "about the restaurant", "people & roles", and "billing /
> payments" as three distinct top-level sections. Don't dump them on one page.

### 1.2 **Settings as a catalog of cards** ("Org settings" page)
M365's *Settings → Org settings* is a searchable list of feature cards
(Security & privacy / Services / Organization profile tabs). Each card opens a
focused right-hand panel with just that feature's controls.
> **Borrow:** a Settings landing page = grid of cards, each → a focused detail
> panel/page. Scales as we add modules without redesigning.

### 1.3 **Tabbed detail, "Save / Discard" footer, dirty-state guard**
Every Microsoft settings panel: tabs across the top, edits buffered locally, a
sticky **Save changes / Discard** bar, and a "you have unsaved changes" prompt
if you navigate away.
> **Borrow:** buffered edits + explicit Save/Discard (not autosave) for anything
> that affects guests or money. Matches our existing modal patterns
> (`ItemPanel.tsx`).

### 1.4 **Roles & RBAC as first-class** (admin roles, least privilege)
Microsoft leans hard on role-based access: granular admin roles, "who can see
what", an audit log of changes. We already have a `Role` enum — we just don't
expose or enforce it yet.
> **Borrow (lightly):** a People page that lists members + their role, with
> invite/remove. Full enforcement waits on the deferred auth layer, but the
> management UI can land first.

### 1.5 **Branding / "Organization profile"**
M365 lets an org upload a logo, set theme colors, a sign-in message — exactly our
multi-tenant theming engine, which today is only editable by hand-seeding JSON.
> **Borrow:** a Branding panel = a UI front-end for the `theme` JSON we already
> render (`TenantThemeProvider`).

### 1.6 **Billing: payment methods + invoices, provider-managed**
Microsoft never stores raw card data — it tokenizes via a payment provider and
shows masked methods + an invoice history. This is the model to copy for **online
payments**.
> **Borrow:** when we add online pay, store a **provider account reference +
> masked metadata**, never card data. (See §3.)

### What we deliberately **don't** copy
Data-residency regions, compliance centers, conditional-access policies,
multi-geo, license SKUs — all overkill for a single-restaurant tenant. We take
the *shape* (cards → panels, Save/Discard, roles, billing) not the *scale*.

---

## 2. Proposed Settings module catalog

Each module below lists: **what it is**, the **fields/controls**, and a
**data-status** tag:
- 🟢 **exists** — data already in our model, just needs UI.
- 🟡 **extend** — add fields to an existing model.
- 🔴 **new** — needs new model(s)/tables + API.

Grouped into three top-level sections (per §1.1).

---

### Section A — Restaurant (Org/Tenant settings)

**A1. Restaurant Profile** — 🟢 mostly exists
- Restaurant **name** 🟢 (`Tenant.name`)
- **Slug / URL** 🟢 (`Tenant.slug`) — show read-only or warn on change (it's in
  every QR code; rotating it breaks printed QRs, same hazard as table QR regen).
- Contact: **phone, email, address** 🔴 (not stored today)
- Logo 🟢 (`theme.logoUrl`) — overlaps Branding (A3).
- **Active / open for business** toggle 🟢 (`Tenant.active`).

**A2. Localization & Tax** — 🟢 / 🟡
- **Currency** 🟢 (`Tenant.currency`)
- **Tax rate** 🟢 (`Tenant.taxRate`) — single rate today.
- *(maybe)* multiple tax rates / tax label (e.g. "GST"/"VAT") 🟡
- Timezone, locale, date format 🔴 (not stored; analytics "today" currently
  uses server time — a tenant timezone would make day-scoping correct).

**A3. Branding & Theme** — 🟢 (UI for existing JSON)
- Brand **colors** (the `theme.colors` token overrides) 🟢
- **Typography** (sans/serif font stacks + font links) 🟢
- **Logo** upload 🟢 (reuse `POST /menu/upload` → Supabase, or a tenant variant)
- **Light/dark** baseline `theme.mode` 🟢
- Live preview would be the nice-to-have here.

**A4. Service / Ordering rules** — 🔴 new
Operational knobs the apps would read:
- **Service charge / gratuity** default (auto-add %, or suggested tip presets on
  the bill) 🔴 — note: `Payment.tip` exists but there's no *config* for defaults.
- **Tipping on/off**, suggested tip % presets 🔴
- **Order modes** allowed (dine-in only today; takeaway/pickup later) 🔴
- **Rounding** rule for cash 🔴
- Min/auto-gratuity for large parties 🔴

**A5. Hours & Availability** — 🔴 new
- Opening hours per day, holiday closures, "accepting orders" master switch.
- (Heavier; likely a later module.)

---

### Section B — People & Access (Role-Based Access Control)

> **Confirmed requirement.** Just like Microsoft: the **Admin** can **add several
> users** into the app and **grant or revoke each user's permissions** at any
> time. So this is *admin-managed access*, not just three fixed role templates —
> roles are the starting point, and the Admin can fine-tune any user from there.

**B0. The core model (admin-managed permissions — the crux)**
- The **Admin** (restaurant-admin owner) is the **access manager**. From a
  Team/Users page they can:
  - **Add a user** to the restaurant (name, email → a `Membership`).
  - **Assign a role** (Admin / Manager / Kitchen) — this is just a **preset** that
    fills in a sensible default set of permissions.
  - **Grant or revoke individual permissions** on top of the role — flip any
    capability on/off per user (e.g. give *this* Manager Order History, take away
    Tables from *that* one). This is exactly the Microsoft model: role + per-user
    permission assignments.
  - **Deactivate / remove** a user.
- So a user's **effective access = role defaults ± per-user overrides**. The role
  is a convenience; the Admin always has the final per-user switches.
- **Permissions are a defined list of capability keys** (so the toggles are
  concrete). First-cut catalog, mapped to pages:
  | Permission key | Gates |
  |---|---|
  | `menu.manage` | Menu Management (`/menu`) |
  | `tables.manage` | Tables + sessions + billing (`/tables*`) |
  | `kds.use` | Kitchen Display (`/kds`, `/kds/display`) |
  | `orders.history` | Order History (`/history`) |
  | `analytics.view` | Sales Analytics (`/analytics`) |
  | `dashboard.view` | Dashboard (`/`) |
  | `settings.manage` | Settings (`/settings/*`) |
  | `team.manage` | Add/remove users & change permissions (Admin power) |
- **Roles = named bundles of these keys** — and the Admin **names them freely**
  (custom roles, Microsoft-style). We do **not** hardcode the role names. A role
  is just *"a label + a checklist of permission keys."* The Admin can create
  "Manager", "Staff", "Server", "Head Chef", "Cashier" — anything — and pick its
  permissions. The **only** fixed vocabulary is the permission-key catalog above
  (the app can only gate the things it actually has).
- We ship a few **starter roles** (so the app isn't empty) which the Admin can
  rename, edit, duplicate, or delete:
  - **Admin** → *all* keys (incl. `team.manage`, `settings.manage`).
  - **Manager** → `menu.manage`, `tables.manage`, `dashboard.view`
    (+ `orders.history` grantable). **No** `analytics.view`.
  - **Kitchen** → `kds.use` only.
- ⚠️ Implication for the data model: this means moving off the fixed Prisma
  `Role` **enum** to a **per-tenant `Role` table** (`{ id, tenantId, name,
  permissions[] }`), with `Membership` referencing a role row. (See §5.) One
  role — the all-powerful Admin/`team.manage` one — is **protected/undeletable**
  so a tenant can't lock itself out.
- ⚠️ Only an Admin can change permissions, and an Admin **can't strip the last
  Admin's `team.manage`** (lockout guard — Microsoft enforces the same "can't
  remove the last global admin").

**B1. The starter roles (seeded; renamable/editable by the Admin)**

These are *defaults we seed*, not a fixed list — per B0 the Admin can rename,
edit, add, or delete them (except the protected Admin role).

| Starter role | Permission bundle | Scope |
|---|---|---|
| **Admin** | all keys | **Whole platform** — every page + Settings + team management. *(protected — can't be deleted)* |
| **Manager** | `menu.manage`, `tables.manage`, `dashboard.view` (+ `orders.history` optional) | **Menu + Tables.** **No Sales Analytics.** Order History grantable. |
| **Kitchen** | `kds.use` | **KDS only** — advance items `placed → preparing → ready → served`. |

- Since roles are now **custom/named by the Admin**, the old fixed enum value
  **`server`** is moot — if a tenant wants a "Server" role, they just create one.
  We can still **seed** a "Server" starter role if useful. (§6 Q updated.)

**B2. Permission matrix** (what each role can reach)

| Page / Route | Admin | Manager | Kitchen |
|---|:---:|:---:|:---:|
| Dashboard (`/`) | ✅ | ⚠️ *needs decision* | ❌ |
| Menu Management (`/menu`) | ✅ | ✅ | ❌ |
| Tables (`/tables`, sessions, billing) | ✅ | ✅ | ❌ |
| Kitchen Display (`/kds`, `/kds/display`) | ✅ | ⚠️ *needs decision* | ✅ (only) |
| Order History (`/history`) | ✅ | 🔓 **grantable** | ❌ |
| Sales Analytics (`/analytics`) | ✅ | ❌ | ❌ |
| Settings (`/settings/*`) | ✅ | ❌ | ❌ |
| Team / role management | ✅ | ❌ | ❌ |

Legend: ✅ allowed · ❌ blocked · 🔓 off by default, Admin can grant ·
⚠️ I need your call (see §6 Q's).

> The 🔓 "grantable" cell (Order History for Manager) is just one example of the
> general rule from **B0**: every cell in this matrix is an **Admin-flippable
> per-user switch**. The role only sets the *defaults*; the Admin can grant or
> revoke any permission for any user. So this table shows the **role presets**,
> not a hard ceiling.

**B3. How access is enforced (three layers)**
1. **Navigation** — `Shell.tsx` `NAV` array is filtered by the current role, so
   a Kitchen user literally only sees "Kitchen Display". (Cosmetic; not security.)
2. **Routing** — `App.tsx` route guards redirect a disallowed role away (e.g.
   Kitchen → `/kds`). Prevents URL-typing into a forbidden page.
3. **API** — the real trust boundary: endpoints check the caller's role.
   ⚠️ **This needs the deferred auth layer** — right now there is *no* login
   token, so the server can't know who's calling. So:
   - **Phase 1 (now):** ship roles + the nav/route gating client-side. It's a
     real UX/role-separation win, but **not yet a security boundary** (same
     caveat already true for the whole app — auth is deferred platform-wide).
   - **Phase 2 (with auth):** enforce on the API. Same staged approach CLAUDE.md
     already uses everywhere else.

**B4. Team / Users management UI (the Admin's control panel)** — 🟢 data / 🔴 UI+API
The centerpiece of this whole section. Admin-only page (`team.manage`):
- **List users** (`Membership`s): name, email, role badge, active state.
- **Add user** → creates a `Membership` (role preset).
- **Edit a user** → change role, **and a checklist of permission toggles**
  (the `B0` capability keys) so the Admin grants/revokes individual access.
  Toggles default from the role preset; flipping any creates a per-user override.
- **Deactivate / remove** user.
- Lockout guard (can't remove the last Admin / strip own `team.manage`).
- **Data model:** `Membership` exists 🟢 but needs a place for per-user
  overrides 🔴 — e.g. a JSON `permissions` column (the effective key list, or a
  diff vs. role). New endpoints: `GET/POST/PATCH/DELETE` members + set
  permissions. Full **invite-by-email** waits on the auth/email layer — start as
  manual add + role/permission assignment.

**B5. "Current role" wiring (before real auth)**
To build & demo RBAC *before* the auth layer exists, we need a source of truth
for "who is logged in." Options (decide in §6):
- a) A simple **role picker on the existing `LoginPage`** (pick Admin/Manager/
  Kitchen, stored client-side) — fastest, demo-grade.
- b) Wait for real auth and build RBAC on top of it.
> Recommend (a) so the role-gating UI is real and testable now, then swap the
> source of "current user" to real auth in Phase 2 without changing the gating.

---

### Section C — Billing & Payments

> This is the section you specifically called out (online payment). Here's the
> honest state + the Microsoft-style approach.

**C1. Payment acceptance (in-restaurant)** — 🟡
- Today: **cash + card**, captured by staff in `BillingPage`.
- Config we *don't* have but could add: which methods are enabled, default
  method, whether guests may "Pay Online" vs. "Pay at counter" 🟡.

**C2. Online payments (provider integration)** — 🔴 **biggest new piece**
This is the Microsoft/Stripe-style model:
- **Connect a payment provider** (e.g. Stripe / Razorpay / Square). Store a
  **provider account id + masked status**, *never* card data. 🔴
- OAuth/"Connect account" button → store `providerAccountId`, `chargesEnabled`,
  publishable key; secret key server-only (like our `SUPABASE_SERVICE_ROLE_KEY`
  pattern). 🔴
- Then the customer "Pay Online (card)" flow would actually charge through the
  provider instead of just marking `paid`. 🔴 (Today card capture is a no-op
  flip to `paid` — see CLAUDE.md flow 1, step 7.)
- **Payout/bank** details, currency, statement descriptor 🔴.
- ⚠️ This touches `payment.ts` (provider fields), the API capture path, and the
  customer pay screen — it's a vertical slice, not just a settings panel.

**C3. SaaS billing (platform → restaurant)** — 🔴 (likely super-admin, not here)
- The restaurant's *own* subscription to **our** platform (plan, invoices).
  CLAUDE.md lists "SaaS billing" as deferred and it conceptually belongs in
  **super-admin**, not restaurant-admin. Flagging so we don't conflate "the
  restaurant charging guests" (C2) with "us charging the restaurant" (C3).

**C4. Receipts / invoices** — 🟡 / 🔴
- Receipt header/footer text, logo on receipt, tax-id line, email-receipt
  toggle. Some overlaps branding; the data is new.

---

### Section D — Notifications & Integrations (likely later)

- 🔴 **Notifications**: where order/bill events go (sound, email, etc.) —
  CLAUDE.md lists notifications as deferred.
- 🔴 **Integrations**: KDS relay config, future POS/accounting exports.
- 🔴 **Data export / audit log**: Microsoft-style change log of who changed what.

---

## 3. Online payments — the detail (since you flagged it)

The Microsoft/Stripe pattern, concretely, so we can decide scope:

1. **Never store card numbers.** Tokenize via a provider. We store only a
   reference + masked metadata. (Mirrors how MS shows "Visa ••1234".)
2. **Provider account on the tenant** — new fields (sketch, not final):
   ```
   PaymentProvider (new model or JSON on Tenant)
     provider          stripe | razorpay | square | none
     providerAccountId string        // from the provider
     publishableKey     string        // safe for client
     secretKeyRef       string        // server-only env/secret ref, NOT in DB plaintext
     chargesEnabled     boolean       // can we actually charge yet
     currency           string
     connectedAt        datetime
   ```
3. **Connect flow** in Settings → Billing: "Connect Stripe" button → OAuth →
   store the account id + status badge ("Connected / Action needed / Not
   connected").
4. **Charge path** (separate from settings): the customer "Pay Online" flow
   calls the provider, and `capturePayment` records the real charge + adds a
   `providerPaymentId` to `Payment`. 🔴
5. **Open question:** which provider(s)? Stripe is the cleanest dev story and has
   "Connect" for multi-tenant marketplaces (each restaurant = a connected
   account). Razorpay/Square if region/market dictates.

> Decision needed from you: is online pay **part of this Settings effort**, or do
> we build the Settings shell first and slot online-pay in as its own later
> slice? (It's the one module that's a full vertical, not just a config screen.)

---

## 4. Proposed information architecture (layout)

Microsoft-style **landing page of cards → focused detail**, fitted to our shell:

```
/settings                         (landing — grid of cards, grouped A/B/C/D)
  ├── /settings/profile           A1  Restaurant profile
  ├── /settings/localization      A2  Currency / tax / timezone
  ├── /settings/branding          A3  Colors / fonts / logo  (theme JSON UI)
  ├── /settings/service           A4  Service charge / tipping / order modes
  ├── /settings/team              B1  Members & roles
  ├── /settings/payments          C1+C2  Methods + online provider
  └── /settings/receipts          C4  Receipt/invoice config
```
- Each detail page: buffered edits + sticky **Save / Discard** + unsaved-changes
  guard (§1.3).
- Reuse existing primitives: `Shell` (sidebar), `Toggle`, modal/panel patterns
  from `ItemPanel.tsx`, and the `AdminStore` `dispatch`/refetch pattern.
- Wire the dead sidebar link → `/settings`; add the route group in `App.tsx`.

---

## 5. Data-model & API impact summary

| Module | Data status | Touches |
|---|---|---|
| A1 Profile | 🟢 name/slug/active; 🔴 contact fields | `Tenant` (+ new contact cols), `tenant` API PATCH |
| A2 Localization | 🟢 currency/tax; 🔴 timezone | `Tenant` (+ timezone) |
| A3 Branding | 🟢 | `Tenant.theme` JSON, upload endpoint |
| A4 Service rules | 🔴 | new config (JSON on Tenant or new table) |
| B Custom roles + RBAC | 🔴 | **new per-tenant `Role` table** (`name`+`permissions[]`) replacing the `Role` enum; `Membership` → role ref + per-user `permissions` override; new `roles` + `members` endpoints; nav/route guards |
| C1 Methods | 🟡 | small config |
| C2 Online pay | 🔴 | new provider model + `Payment` fields + capture path + customer app |
| C4 Receipts | 🔴 | new config |

**Net:** the cheapest, highest-value first slice is almost certainly
**A1 + A2 + A3** (profile / localization / branding) because the data largely
exists and there's **no existing `PATCH /tenant`** — adding tenant self-edit is
the foundational backend piece everything else builds on. Online pay (C2) is the
biggest and most independent.

---

## 6. Open questions for you (decide, then we plan)

1. **Scope of v1** — just the shell + a couple of cheap modules (A1/A2/A3), or do
   you want online payments (C2) in scope now?
2. **Online payment provider** — Stripe / Razorpay / Square / undecided? (Region?)
3. **RBAC (now confirmed, see §B)** — sub-decisions:
   - a. ✅ *Resolved:* roles are **custom/named by the Admin** (B0/B1) — the fixed
     `server` enum value goes away; seed a "Server" starter role only if you want one.
   - b. Can **Manager** see the **Dashboard**? And open the **KDS**? (⚠️ cells in §B2.)
   - c. ✅ *Resolved:* general **per-user grant/revoke** system (Admin manages
     every permission per user, Microsoft-style — see B0/B4).
   - d. "Current user/role" before real auth: **role picker on LoginPage** (demo
     now) or wait for auth? (§B5)
   - e. OK that Phase 1 RBAC is **UI/nav gating only** (real API enforcement
     lands with the deferred auth layer)?
4. **Autosave vs. Save/Discard** — confirm we go with explicit Save/Discard
   (recommended).
5. **Service charge / tipping (A4)** — is configurable tipping something you want
   guests to see on the bill?
6. **SaaS billing (C3)** — confirm that belongs in **super-admin**, out of scope
   here.

---

## 7. Your picks (fill this in)

> Mark which modules you want, in what order, and any specifics. I'll convert the
> chosen set into a concrete, vertical-slice build plan (domain → API →
> api-client → page).

- [ ] A1 Restaurant Profile
- [ ] A2 Localization & Tax
- [ ] A3 Branding & Theme
- [ ] A4 Service / Ordering rules
- [ ] B  RBAC — role-gated access (Admin / Manager / Kitchen) + nav/route guards
- [ ] B4 Team members & roles management UI (admin-only)
- [ ] C1 Payment methods
- [ ] C2 Online payments (provider)
- [ ] C4 Receipts / invoices
- [ ] D Notifications / Integrations / Audit
- Notes:
