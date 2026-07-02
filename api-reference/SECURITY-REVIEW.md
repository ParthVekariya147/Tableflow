# Security Review — TableFlow API

Audit of `services/api` (NestJS). Scope: authN/authZ, tenant isolation, the
guest device-bound session trust boundary, and infra hardening. Date: 2026-07-02.

## TL;DR

The API is **well-hardened** at the framework level — helmet, gzip, 1 MB body cap,
per-IP throttling (120/60s), a prod-secret boot assertion, restricted CORS in prod,
Zod DTOs on every write, a JWT tenant-isolation guard, per-device guest binding,
per-email login lockout, and timing-safe secret comparisons. The `menu`/`tables`/
`orders` routes CLAUDE.md described as "ungated" **are now permission-gated** (the
"fix 6 vulnerabilities" commit did this).

The remaining risk is concentrated in two places: **(1)** a Supabase-token →
super-admin escalation that leans entirely on external Supabase config, and
**(2)** the deliberately-unauthenticated guest order flow, where "payment" is an
honor-system state change with no real processor.

Severity key: 🔴 High · 🟠 Medium · 🟡 Low / by-design-but-worth-knowing.

---

## 🔴 H1 — Any valid Supabase account becomes a platform super-admin
`auth/auth.service.ts` `syncProfile()` (called by `POST /auth/sync-profile`, guarded
only by `SupabaseAuthGuard`) does:

```ts
this.prisma.user.upsert({ ..., update:{ isSuperAdmin:true }, create:{ ..., isSuperAdmin:true } })
```

It sets `isSuperAdmin: true` for **any** user who presents a valid token for the
configured Supabase project — there is no allowlist, domain check, or invite gate.
Once that row exists, the account passes `SuperAdminGuard` and can call every
`/admin/*` and `/admin/plans` / subscription route (create/suspend tenants, read all
payments, reset owner passwords, impersonate, read the audit log).

**The only thing standing between "a stranger" and "platform god" is whether the
Supabase project allows self-signup.** If email signups are open (Supabase default
on many projects), this is a full platform compromise.

- **Fix:** gate super-admin on an explicit allowlist (env `SUPERADMIN_EMAILS`, or a
  pre-seeded `isSuperAdmin` row that `syncProfile` *matches* rather than *creates*).
  Never derive `isSuperAdmin` from "has a valid Supabase session."
- **Verify now:** confirm the Supabase project has signups disabled / restricted to
  your team domain. That's the current de-facto control and it's off-codebase.

## 🟠 M1 — Guest "payment" closes an order as paid with no real payment
`POST /orders/:id/payment` (`orders.service.ts capturePayment`) marks the order
`paid`/`closed` and writes a `Payment` row. There is **no payment-provider
integration** (deferred): for `method:"card"` ("Pay Online") the server just trusts
the call. A guest holding their own device id can settle their own bill without any
money changing hands.

- Server *does* recompute subtotal/tax/total, so the **amount** can't be forged — but
  the **fact of payment** can. This is by-design given no provider, but it's a
  revenue-integrity hole, not just a theoretical one.
- **Fix (when provider lands):** only close on a verified provider webhook/charge id;
  until then, treat "card" as "pending" and require staff confirmation like cash.

## 🟠 M2 — Dev JWT secret + open CORS both hinge on `NODE_ENV==="production"`
`auth.module.ts` falls back to a hardcoded `"dev-only-insecure-secret-change-me"`
when `JWT_SECRET` is unset; `main.ts` only *refuses to boot* on that when
`NODE_ENV === "production"`. CORS is likewise `origin: true` (fully open, with
`credentials:true`) unless `NODE_ENV === "production"`.

A deployment that forgets to set `NODE_ENV=production` (staging, a quick VPS, a
container missing the env) silently runs with a **publicly-known JWT secret** — so
anyone can forge a staff or `imp:true` impersonation token for any tenant — **and**
wide-open CORS.

- **Fix:** key these off an explicit `APP_ENV`/positive check, and assert
  `JWT_SECRET` is present whenever the host isn't localhost — don't let "not
  production" mean "insecure but running."

## 🟠 M3 — Master-password login is a single key to every account
`login()` accepts `PLATFORM_MASTER_PASSWORD` in place of *any* user's password
(timing-safe compared, audit-logged). Powerful and legitimately useful for support,
but it's one env var that unlocks every tenant user. Leakage = total compromise.

- **Mitigations present:** constant-time compare, audit-log entry per use.
- **Fix/harden:** scope it (super-admins only), rotate regularly, and alert on any
  `via:"master-password-login"` audit entry.

## 🟡 L1 — Device gate is bypassed for staff-opened (walk-in) orders
`assertDevice()` returns "pass" when the order's `deviceId` is `null` (staff walk-in
sessions). So `GET/POST /orders/:id*` on a walk-in order accept **any** caller (no
device id needed) — a caller who learns/guesses such an order id could read the
customer's name+phone or add rounds / capture payment on it.

- **Mitigating:** order ids are cuids (not enumerable) and `deviceId` is never
  serialized back, so ids don't leak from the public list. Real but low-likelihood.
- **Fix:** require *authenticated staff* (not merely "no device binding") to act on
  a `deviceId:null` order via the shared public routes.

## 🟡 L2 — Public pre-auth endpoints leak floor/menu/occupancy
By design the guest boot needs these without a login: `GET /menu`,
`GET /tenants/:slug`, `GET /tables/qr/:token`, `GET /orders/open-table-ids`,
`POST /service-requests`. Anyone with the tenant slug can enumerate the full menu,
table occupancy, and spam (deduped) service requests. Acceptable for a QR-ordering
product; just be aware slug = read access to this surface.

## 🟡 L3 — Login lockout & reclaim throttle are in-memory / per-instance
`loginAttempts` and `reclaimAttempts` are `TtlCache` (per-process). Multiple API
instances each keep their own counter and both reset on restart; the per-IP
`ThrottlerGuard` is the only cross-instance backstop. Fine for single-instance,
weakens under horizontal scale. **Fix:** back these with Redis if you scale out.

---

## What's solid (reviewed, no action)
- **Tenant isolation:** `JwtAuthGuard` rejects a token whose `tid` ≠ the
  `X-Tenant-Slug`-resolved tenant, so a valid user of tenant A can't act on tenant B.
  `OrderStreamGuard` enforces the same for SSE and scopes guests to their own device.
- **Every write DTO is Zod-validated** server-side; money/tax/totals are recomputed
  server-side (client numbers ignored) in rounds and payment.
- **Prisma** parameterizes all queries (no raw SQL) → no SQLi.
- **Bearer-token auth in headers (not cookies)** → CSRF is N/A.
- **Impersonation** tokens are time-boxed (30m), audit-logged, re-validate the tenant
  on use, and are explicitly barred from `/admin/*` by `SuperAdminGuard`.
- **Exception filter** returns a generic 500 (no stack leak to clients) and logs
  server-side with tenant/user correlation.
- **Upload** endpoint enforces image mimetype + 5 MB and uses the service-role key
  server-side only.

## Suggested priority
1. **H1** — verify Supabase signup is locked down *today*, then fix the code to use an
   allowlist. This is the one that could be catastrophic and depends on external config.
2. **M2** — make the insecure-secret/open-CORS fallback fail closed off localhost.
3. **M1** — gate order closure on real payment before launch.
4. M3, L1 — harden when convenient / before horizontal scaling.
