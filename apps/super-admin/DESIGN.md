---
name: Amber & Grain Super Admin
colors:
  surface: '#f7f5f0'
  surface-dim: '#ece8df'
  surface-bright: '#fdfcf9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f9f7f2'
  surface-container: '#f1ede4'
  surface-container-high: '#eae5d9'
  surface-container-highest: '#e2dccc'
  on-surface: '#262220'
  on-surface-variant: '#5c5550'
  inverse-surface: '#33302c'
  inverse-on-surface: '#f7f3ec'
  outline: '#8a8178'
  outline-variant: '#ddd5c6'
  surface-tint: '#cc785c'
  primary: '#cc785c'
  on-primary: '#ffffff'
  primary-container: '#f4d9cd'
  on-primary-container: '#5c2a17'
  inverse-primary: '#ffb59a'
  secondary: '#34655f'
  on-secondary: '#ffffff'
  secondary-container: '#cde6e0'
  on-secondary-container: '#0f2a26'
  tertiary: '#7a6a2e'
  on-tertiary: '#ffffff'
  tertiary-container: '#ece1ae'
  on-tertiary-container: '#262000'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  warning: '#9a6500'
  warning-container: '#ffe1ab'
  success: '#2e7d5b'
  success-container: '#c3ecd6'
  primary-fixed: '#ffdbcc'
  primary-fixed-dim: '#ffb59a'
  on-primary-fixed: '#3a0d00'
  on-primary-fixed-variant: '#a85a3f'
  background: '#f7f5f0'
  on-background: '#262220'
  surface-variant: '#e2dccc'
typography:
  display-lg:
    fontFamily: Fraunces
    fontSize: 38px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Fraunces
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Fraunces
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-bold:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.02em
  mono-sm:
    fontFamily: 'JetBrains Mono'
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.375rem
  DEFAULT: 0.625rem
  md: 0.875rem
  lg: 1.25rem
  xl: 1.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin: 24px
  card-padding: 20px
breakpoints:
  sm: 640px
  md: 768px
  lg: 1024px
  xl: 1280px
  2xl: 1536px
---

## Brand & Style

The super-admin panel is the **platform operator's control plane** — one
screen for every tenant, every subscription, every billing decision across
the whole Amber & Grain network. It is not a restaurant-facing surface, so it
does not borrow the KDS's high-pressure kitchen styling; instead it adopts a
**Claude-inspired editorial calm**: warm cream surfaces, a single confident
terracotta accent, generous whitespace, and serif headlines over a clean
geometric sans for data. The feeling is "a trustworthy ops console," not "a
SaaS dashboard template" — quiet enough for long sessions auditing tenants,
but with unmistakable, high-contrast affordances for the handful of actions
that matter most: **toggling a subscription, suspending a tenant, or
impersonating into one.**

The design style is **Calm Authority**. Structural chrome (sidebar, top bar,
table headers) stays neutral and low-contrast; color is spent deliberately —
terracotta for primary actions and "active" states, sage-green for healthy
subscriptions, amber for at-risk/past-due, and a desaturated red reserved
*only* for destructive or suspended states. Nothing on this screen should ever
make the operator guess whether a tenant is paying.

## Colors

- **Background (#F7F5F0):** Warm cream canvas — softer than pure white,
  reduces glare across long operator sessions.
- **Primary / Terracotta (#CC785C):** Claude's signature accent. Reserved for
  primary buttons, active nav items, focus rings, and the "On" state of the
  subscription toggle.
- **Secondary / Deep Teal (#34655F):** Used sparingly for secondary metrics
  and the impersonate action — distinct enough from terracotta to never be
  confused with a destructive or primary action.
- **Success / Sage (#2E7D5B):** Active subscriptions, healthy usage, "paid"
  invoice rows.
- **Warning / Amber (#9A6500):** Trialing, past-due, near plan-limit states.
- **Error (#BA1A1A):** Canceled subscriptions, suspended tenants, destructive
  confirmations only — never used for routine UI.
- **Outline (#DDD5C6):** Card borders and dividers — visible but quiet.

## Typography

**Fraunces** (serif) carries page titles, tenant names in detail headers, and
big KPI numbers on the analytics dashboard — it gives operational data an
editorial, "report" feel that reads as authoritative rather than clinical.

**Inter** (geometric sans) handles every table, form, label, and button —
optimized for dense data scanning across a tenant directory that may run into
the hundreds of rows.

**JetBrains Mono** is used narrowly for IDs, tokens, and API keys (tenant
slug, `qrToken`, impersonation JWT preview) so machine values are visually
distinct from human-authored text.

- **KPI numbers** (MRR, active tenants, churn %): `display-lg`, Fraunces.
- **Table headers**: `label-sm`, uppercase, `on-surface-variant`.
- **Tenant slug / IDs**: `mono-sm`.

## Layout & Spacing

A **fixed left sidebar + fluid content** shell, matching the rest of the
monorepo's admin apps but denser:

- **Sidebar (240px, collapses to icon rail at `md`):** Dashboard, Tenants,
  Plans, Subscriptions, Audit Log, Settings. Active route gets a terracotta
  left-indicator bar + tinted background, not a full-color fill — keeps the
  rail calm at a glance.
- **Content max-width:** 1440px, centered, with a 24px margin; tables and
  cards go full-width within that.
- **Grid:** KPI cards on Dashboard use a 4-column grid at `xl`, 2-column at
  `md`, 1-column below `sm`. The tenant directory is a table at `lg`+ and
  collapses to stacked cards (one per tenant) below `md` — every column
  becomes a labeled row inside the card rather than horizontal scroll.
- **Responsive rule of thumb:** nothing below `md` should require horizontal
  scrolling to read a primary value; secondary columns (e.g. "Created at")
  may be hidden behind a "show more" toggle on a tenant card instead of
  cramming the table.

## Elevation & Depth

- **Base layer:** `#F7F5F0` background, sidebar one shade lower
  (`surface-container`) so it visually recedes behind content.
- **Cards:** `#FFFFFF` surface, 1px `outline-variant` border, soft shadow
  (`0 1px 3px rgba(38,34,32,0.06), 0 1px 2px rgba(38,34,32,0.04)`) — lift is
  subtle; this is a data tool, not a marketing page.
- **Modals (impersonate, plan editor, suspend confirm):** deeper shadow
  (`0 12px 32px rgba(38,34,32,0.18)`) with a 40% `on-surface` scrim behind —
  deliberately heavier than card elevation since these gate irreversible or
  sensitive actions (master-password entry, tenant suspension).
- **Sticky table header:** stays at `surface-container-lowest` with a 1px
  bottom border while the body scrolls beneath it — directory and audit log
  both run long.

## Shapes

- **Cards & panels:** 16px (`rounded-lg`) corners.
- **Buttons:** 10px (`rounded-md`) corners — softer than pill, signals "tool"
  rather than "consumer app," while staying friendly.
- **Subscription toggle:** fully rounded pill track, circular thumb — the one
  place a pill shape is used, so the on/off control reads instantly as a
  switch among square-ish UI.
- **Status badges:** small pill (`rounded-full`), colored fill at 12%
  opacity of the status color with full-opacity text of the same hue.
- **Avatars / tenant logos:** circular, 32px in tables, 64px in the tenant
  detail header.

## Components

### Sidebar Nav
240px fixed column, `surface-container` background. Each item: icon + label
(`body-md`), 12px vertical padding, 12px horizontal. Active item: terracotta
3px left bar, `primary-container` background tint, `on-primary-container`
text. Collapses to a 64px icon-only rail below `md` with labels in a
tooltip-on-hover/long-press.

### KPI Cards (Dashboard)
White card, `headline-sm` label, `display-lg` value in Fraunces, a small
delta chip (`▲ 12% vs last period`) colored sage (good) or amber (bad). Grid
of 4 on the platform dashboard: **MRR, Active Tenants, Churn, GMV**.

### Tenant Directory Table / Card
Columns: logo+name, slug (`mono-sm`), plan badge, subscription status badge,
MRR contribution, created date, row actions (Edit · Subscription ·
Impersonate · ⋯). Status badge colors: `active`=sage, `trialing`=amber,
`past_due`=amber-deep, `canceled`/`suspended`=error. Below `md`, each row
becomes a card: name + status badge on top row, remaining fields as
label/value pairs beneath, actions as a bottom button row.

### Subscription Toggle (the core control)
A labeled pill switch — **not** a checkbox — sized large enough to be an
unambiguous, deliberate click: 44×24px track, terracotta when "On" (active
subscription), `outline-variant` track with a muted thumb when "Off"
(suspended/canceled). Always paired with the current plan name and a
secondary "Change plan" link so the operator never flips the switch without
seeing what's being toggled. Flipping **Off** opens a confirm modal stating
the consequence ("This locks {tenant} out of restaurant-admin immediately")
before committing — this control gates real lockout, so it never fires on a
single accidental click.

### Plan Cards (Plan Catalog)
Pricing-page-style cards in a horizontal row: plan name (`headline-sm`),
price (`display-lg`, smaller scale), billing interval, a bullet list of
limits/features, and an "Edit" ghost button. The currently-most-subscribed
plan gets a thin terracotta border to flag it at a glance.

### Impersonate Action
Secondary (teal) button, always paired with a small lock/eye icon, opens a
modal requiring the master password — styled distinctly from every other
modal (darker header bar, "Platform Support Access" label) so it's
unmistakably a higher-trust action. On success, opens `restaurant-admin` in a
new tab; the action itself logs to the Audit Log table immediately.

### Audit / Activity Log
A dense, monospace-leaning table (timestamps + IDs in `mono-sm`, action
description in `body-md`): impersonation events, tenant created/suspended,
plan/subscription changes — who, what, when, filterable by tenant and action
type.

### Buttons
- **Primary:** `rounded-md`, terracotta fill, white text — save, assign plan,
  confirm.
- **Secondary:** `rounded-md`, teal fill, white text — impersonate, export.
- **Destructive:** `rounded-md`, error fill, white text — suspend tenant,
  cancel subscription. Always behind a confirm modal.
- **Ghost:** `rounded-md`, 1px `outline-variant` border, `on-surface` text —
  edit, view, secondary navigation within a panel.

### Forms (Onboarding Wizard, Tenant Editor, Plan Editor)
Stepper-style for the onboarding wizard (Business info → Theme → Plan →
Review), single scrollable form with grouped sections for the tenant editor.
Inputs: `rounded` (10px) corners, `surface-container-lowest` fill,
`outline-variant` border, terracotta focus ring (2px). Color-token fields in
the theme editor render as a swatch grid pulled live from
`themeColorsSchema`, not hardcoded swatches — each swatch opens a native color
picker and live-previews via `TenantThemeProvider`.

### Status Badges
Pill, 12%-opacity fill of the status color, full-opacity text, `label-sm`
uppercase. Used for subscription status, tenant `active` flag, and plan
limit warnings ("Near limit" in amber).

## Responsive Behavior Summary
- **`xl`+ (≥1280px):** full sidebar, 4-col KPI grid, full tenant table with
  all columns.
- **`lg`–`xl` (1024–1279px):** full sidebar, 2-col KPI grid, tenant table
  drops the "Created at" column behind a row expander.
- **`md`–`lg` (768–1023px):** icon-only sidebar rail, 2-col KPI grid, tenant
  table becomes stacked cards.
- **below `md` (<768px):** sidebar collapses to a bottom-sheet/hamburger
  drawer, 1-col KPI stack, all tables are cards, modals go full-screen
  instead of centered — this is an internal tool but operators do check
  tenant status from a phone, so the lockout/impersonate flows must remain
  fully usable at this width.
