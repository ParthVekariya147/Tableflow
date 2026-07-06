# Security Fixes — Tableflow API

Applied 2026-07-05. Companion to `SECURITY-REVIEW.md` (2026-07-02), which
enumerated the findings. This file records what was actually changed. All
changes are in `services/api` + the root `package.json`; the API typechecks
clean (`tsc --noEmit`, exit 0) and `pnpm audit --prod` dropped from **9
vulnerabilities (4 high, 5 moderate) → 2 moderate** (both deferred, see below).

---

## Fixed

### #1 (Critical) — Super-admin escalation via `POST /auth/sync-profile`
`auth.service.ts syncProfile()` previously set `isSuperAdmin: true` for **any**
user with a valid Supabase session. Now gated on an explicit allowlist:

- New env var **`SUPERADMIN_EMAILS`** (comma-separated). The Supabase user's
  email must be on it, otherwise the request is rejected with **403**.
- An empty/unset allowlist forbids all self-bootstrap (fail-closed) — the seed
  script provisions the first operator directly.
- `auth.service.ts` — added `ForbiddenException` import + the allowlist check
  before the `user.upsert`. Documented in `services/api/.env.example`.

### #2 (High) — Vulnerable dependencies
Added `pnpm.overrides` to the root `package.json`:

| Package | Was | Now | Advisories closed |
|---------|-----|-----|-------------------|
| `multer` | 2.0.2 | `>=2.2.0` | 4 × high (DoS) |
| `qs` | 6.14.2 | `>=6.15.2` | 1 × moderate (DoS) |
| `file-type` | <21.3.2 | `>=21.3.2` | 2 × moderate (DoS) |

`multer` (reachable via the image-upload endpoint) was the material one.

### #3 (High) — Fail-open JWT secret + CORS off-production
`main.ts` keyed both the JWT-secret assertion and open CORS off
`NODE_ENV === "production"`, so a deploy that merely forgot to set
`NODE_ENV=production` silently ran the public dev secret **and** wide-open CORS.

- New helper `isInsecureDevAllowed()` — insecure fallbacks are permitted **only**
  when explicitly opted in (`NODE_ENV=development` **or** `ALLOW_INSECURE_DEV=true`).
- `assertProductionSecrets()` now refuses to boot without `JWT_SECRET` in every
  case except explicit dev (fails **closed** on staging / unset NODE_ENV).
- CORS is open only under the same explicit dev check; otherwise restricted to
  `CORS_ORIGINS`. New env vars `CORS_ORIGINS` + `ALLOW_INSECURE_DEV` documented.

### #5 (Medium) — Master-password login was a skeleton key
`auth.service.ts login()` accepted `PLATFORM_MASTER_PASSWORD` in place of **any**
user's password. Now scoped: `isMasterLogin = masterMatches && user.isSuperAdmin`.
The constant-time compare still always runs (no timing oracle on `isSuperAdmin`),
but the effect is limited to super-admin accounts — routine tenant support must
use the audited `POST /admin/impersonate` flow. Audit-logging is unchanged.

### #7 (Low) — Device gate bypassed for walk-in (null-device) orders
`orders.service.ts assertDevice()` returned "pass" for any caller when the
order's `deviceId` was `null` (staff walk-ins). Now an **untrusted** caller must
both present a device id **and** match it; a null-device order is no longer a
free pass. Staff (`trusted=true` via bearer-token resolution) and internal
server-side reloads are unaffected — guest sessions always carry a `deviceId`,
so no legitimate guest path regresses.

---

## Deferred (documented, not fixed)

- **#4 (High, revenue integrity)** — Guest "Pay Online" (card) closes an order
  as paid with no real payment processor. By design until a provider is
  integrated; the fix is to only close on a verified webhook/charge id. No code
  change made — it's a product decision + integration, not a bug fix.
- **`@nestjs/core` (moderate)** — patched only in **11.1.18**; the project is on
  NestJS **10.x**. Requires a framework major upgrade (10→11), out of scope for
  a security patch pass.
- **`uuid 8.3.2` via `exceljs` (moderate)** — patched in uuid **>=11.1.1**;
  `exceljs@4.4.0` pins uuid v8 and a forced v8→v11 override risks breaking the
  xlsx export. Upgrade with an `exceljs` bump instead.
- **#6 (Medium) — in-memory throttling** — `loginAttempts`/`reclaimAttempts`/
  `ThrottlerGuard` are per-process; back with Redis when scaling horizontally.
- **#8 (Low) — print-agent open mode** — `/print` accepts any caller when
  `AGENT_SECRET` is unset. Documented tradeoff (agent co-located with the
  browser); set `AGENT_SECRET` on any networked deployment.

---

## Verification run
- `pnpm install` — overrides applied.
- `pnpm audit --prod` — 9 → 2 (both deferred, need parent major bumps).
- `cd services/api && npx tsc --noEmit` — exit 0.
