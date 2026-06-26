# Super Admin App — `apps/super-admin`

> Platform control plane for tenant onboarding, billing management, and platform analytics. Framework: Vite + React 19, TypeScript. Port **5175**.

## Purpose
Used exclusively by platform operators (Amber & Grain staff). Provides a cross-tenant view: onboard new restaurants, manage their subscriptions/plans, impersonate their admin panel for support, and view platform-wide revenue metrics and audit logs.

## Entry & Routing

**`src/main.tsx`** — mounts `<App>` with Supabase context.

**`src/App.tsx`** — Route structure:
```
Shell-wrapped (RequireSession guard):
  /                  → DashboardPage  (platform GMV, MRR, top tenants)
  /tenants           → TenantsPage    (tenant table + impersonate)
  /tenants/:id       → TenantDetailPage
  /tenants/:id/edit  → TenantEditPage
  /onboarding        → OnboardingPage (create new tenant)
  /plans             → PlansPage      (plan catalog CRUD)
  /subscriptions     → SubscriptionsPage
  /audit-log         → AuditLogPage
  /settings          → SettingsPage

Full-screen:
  /login             → LoginPage
```

## API Client — `src/api.ts`

Creates `ApiClient` with **no tenant slug** (cross-tenant platform endpoints):
```ts
createApiClient({
  baseUrl: import.meta.env.VITE_API_URL,
  getToken: getCachedAccessToken,   // Supabase session token
})
```

All calls go to `/admin/*` routes which are guarded by `SuperAdminGuard` server-side (requires `User.isSuperAdmin = true`).

## Pages

### DashboardPage (`/`)
Platform-wide metrics from `api.admin.getPlatformAnalytics()`:
- Total GMV (all-time)
- MRR (monthly recurring revenue from active/trialing subscriptions)
- 30-day GMV + orders with period-over-period delta
- 30-day daily revenue series (line chart)
- Top 5 tenants by revenue
- Cash vs card payment split

### TenantsPage (`/tenants`)
Main tenant management view:
- Table of all tenants with columns: name, slug, plan, subscription status, active/suspended toggle
- Filter / search by name or slug
- **Impersonate button** per row:
  1. Opens confirm modal requesting the master password
  2. Calls `api.admin.impersonate({ tenantId, masterPassword })`
  3. API mints an impersonation JWT, writes `ImpersonationLog` + `AuditLog`
  4. Opens `<VITE_ADMIN_URL>?impersonationToken=<jwt>` in a new tab
  5. Restaurant admin reads the token, shows `ImpersonationBanner`
- **Activate / Suspend** toggle calls `api.admin.updateTenant({ active: true|false })`

### TenantDetailPage (`/tenants/:id`)
- Tenant info (name, slug, currency, tax rate, active status)
- Current subscription (plan name, status, period end)
- Payment history table (from `api.admin.getTenantPayments(tenantId)`)

### TenantEditPage (`/tenants/:id/edit`)
Edit form for: name, slug, currency, taxRate, active flag, theme colors (hex inputs per token).

### OnboardingPage (`/onboarding`)
Create new tenant. Fields: name, slug (auto-derived, editable), currency, taxRate. Calls `api.admin.createTenant(...)`.

### PlansPage (`/plans`)
Plan catalog CRUD:
- List all plans with name, price, billing interval, active status
- Create new plan (name, priceCents, interval: month|year, limits JSON, active)
- Edit existing plan

### SubscriptionsPage (`/subscriptions`)
All tenant subscriptions in one table:
- Tenant, plan, status, current period end, cancel-at-period-end flag
- Quick status overrides (cancel / reactivate) via `api.admin.updateSubscriptionStatus`

### AuditLogPage (`/audit-log`)
Paginated newest-first audit log from `api.admin.getAuditLog()`:
- Event types: `impersonation`, `tenant_created`, `tenant_updated`, `tenant_suspended`, `tenant_reactivated`, `plan_assigned`, `subscription_status_changed`
- Each row shows: timestamp, type, actor (email), tenant, metadata JSON preview

### LoginPage (`/login`)
Supabase email/password login. After successful login, redirects to `/`. No impersonation flow here — that lives in restaurant-admin.

## Authentication

**`src/lib/supabase.ts`** — Supabase client + `getCachedAccessToken()`.

**`src/components/RequireSession.tsx`** — redirects to `/login` if no active Supabase session.

Server-side, every `/admin/*` route requires:
1. Valid bearer token (Supabase JWT verified by `AuthGuard`)
2. `User.isSuperAdmin = true` (enforced by `SuperAdminGuard`)

## Components

### `src/components/Shell.tsx`
Sidebar + topbar layout. Navigation: Dashboard, Tenants, Onboarding, Plans, Subscriptions, Audit Log, Settings. Logout at bottom.

### `src/components/Modal.tsx`
Generic reusable modal wrapper. Used for impersonation confirm dialog.

### `src/components/StatusBadge.tsx`
Color-coded chip for subscription/tenant status:
- `trialing` → blue
- `active` → green
- `past_due` → amber
- `canceled` → red
- `suspended` → red

### `src/lib/tenantStatus.ts`
`tenantStatus(active: boolean, subscriptionStatus: SubscriptionStatus | null)` — derives a single display string from the two fields:
- `active=false` → `"Suspended"`
- `subscriptionStatus=past_due` → `"Past Due"`
- `subscriptionStatus=canceled` → `"Canceled"`
- `active=true, subscriptionStatus=active` → `"Active"`
- etc.

## Key Flows

### Creating a New Tenant
1. Fill out `OnboardingPage` form → `api.admin.createTenant(data)`
2. API creates `Tenant` row, writes `tenant_created` AuditLog entry
3. Returns new tenant → redirect to `TenantDetailPage`
4. Manually assign a plan via `SubscriptionsPage` or `TenantDetailPage`

### Impersonating a Tenant
1. `TenantsPage` → Impersonate button → confirm modal (master password)
2. `POST /admin/impersonate { tenantId, masterPassword }` (rate-limited: 5 attempts / 15 min)
3. API verifies master password with timing-safe compare → mints impersonation JWT (signed with `JWT_SECRET`, includes `tenantId`, `tenantSlug`, `exp`)
4. Writes `ImpersonationLog` + `AuditLog` entry
5. Super admin's browser opens `<VITE_ADMIN_URL>/<tenantSlug>?impersonationToken=<jwt>`
6. Restaurant admin's `auth.ts` → `captureImpersonationFromUrl()` stores token
7. `ImpersonationBanner` shown; all API calls from restaurant-admin use the impersonation JWT as bearer token
8. On exit → `clearImpersonation()` → page reload (returns to normal auth)

### Suspending a Tenant
1. Toggle `active=false` on TenantsPage
2. `PATCH /admin/tenants/:id { active: false }` → writes `tenant_suspended` AuditLog
3. Restaurant admin's `BillingLockoutGate` checks subscription status, not the `active` flag — suspension of `active` flag is at the tenant API level. (The two concepts are distinct: `active` = tenant onboarded/live; subscription status = billing state.)

## Environment Variables

```
VITE_API_URL          # default http://localhost:3001
VITE_ADMIN_URL        # restaurant-admin URL (for impersonation redirects)
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

## Known Issues / Deferred

- Platform analytics charts may need a real charting library (check `DashboardPage.tsx` for current implementation)
- Subscription assignment is manual (no payment provider integration — `Subscription.provider` is null for manually managed subs)
- No email notifications on tenant lifecycle events
- Audit log search/filter not implemented
- Plan limits (`limits` JSON field on `Plan`) — schema stored but no enforcement in the API yet
