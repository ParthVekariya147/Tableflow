# Pre-Launch Security Checklist — Tableflow

Single source of truth for getting from "5 of 8 findings fixed" to production.
Derived from `SECURITY-REVIEW.md` (findings) + `SECURITY-FIXES.md` (what changed).

**Status key:** ✅ Verified · 🔍 Needs your eyes (live DB / external) · ⛔ Blocker · ⏳ Conditional / scheduled

---

## ✅ Verified (fix applied AND behaviour confirmed)

- [x] **#1 fix — super-admin allowlist is fail-CLOSED.** `syncProfile` throws 403
  unless the Supabase email is in `SUPERADMIN_EMAILS`; an empty/unset list grants
  nobody (`[].includes(email) === false`). *Confirmed by reading
  `auth.service.ts:261-270`.*
- [x] **#3 fix — API refuses to boot without a secret off-dev.** Boot-tested both ways:
  - `NODE_ENV=staging`, no `JWT_SECRET`, no `ALLOW_INSECURE_DEV` → **throws at
    `assertProductionSecrets` before Nest initializes.** ✔ fail-closed.
  - `ALLOW_INSECURE_DEV=true` → boots past the secret gate (only failed at a
    deliberately-bogus DB URL). ✔ opt-in bypass works.
  - CORS is gated on the same `isInsecureDevAllowed()` check, so a forgotten
    `NODE_ENV` can no longer silently open CORS.
- [x] **#5 fix — master password scoped to super-admins.** `isMasterLogin =
  masterMatches && user.isSuperAdmin` reads the **target** account's flag; a
  non-super-admin target falls through to normal bcrypt verification and cannot
  be unlocked by the master password. Constant-time compare still always runs.
- [x] **#7 fix — walk-in device gate.** Traced all `assertOrder` callers: staff
  methods (`addItem`, `cancel`, payment/get via bearer token) pass `trusted=true`;
  guest routes (`addRound`, `requestBill`) run untrusted but guest orders always
  carry a `deviceId`. Untrusted callers can no longer act on a null-device order.
- [x] **#2 fix — vulnerable deps overridden.** `pnpm audit --prod`: 9 → 2 (multer
  4×high + qs + file-type cleared).
- [x] **Prisma client sanity.** No edits touched Prisma schema/types; the existing
  `@prisma/client` 6.19.3 initialized cleanly during the boot test, so `tsc`
  (exit 0) did not run against a stale client.

---

## 🔍 Needs your eyes before launch (I can't reach these from code)

- [ ] **#1 follow-up — audit EXISTING super-admin rows.** The code fix stops *new*
  grants; it does not undo rows already flagged by the old bug. Run against the
  live DB and confirm every result is expected (only `ops@amber.platform` is
  seeded):
  ```sql
  SELECT id, email, "supabaseId", "createdAt"
  FROM "User" WHERE "isSuperAdmin" = true;
  ```
  Revoke any unexpected row: `UPDATE "User" SET "isSuperAdmin"=false WHERE id='...';`
- [ ] **#1 follow-up — lock down Supabase self-signup.** In the Supabase dashboard,
  confirm email signups are disabled/restricted to your team domain. This is the
  external control the allowlist backstops — verify it regardless.
- [ ] **Set `SUPERADMIN_EMAILS`** in the real `.env` to your platform-ops email(s),
  or super-admin bootstrap via `/auth/sync-profile` will 403 for everyone.

---

## ⛔ Blockers (must resolve before production)

- [ ] **#4 — wire in the payment processor.** Guest "Pay Online" (card) currently
  closes an order as paid with no real charge. Until a provider is integrated,
  either disable the card path or treat "card" as pending + require staff
  confirmation (like cash). Revenue-integrity hole, not a code bug.
- [ ] **Set a real `JWT_SECRET`** (`openssl rand -base64 32`) and **do NOT** set
  `ALLOW_INSECURE_DEV` on any deployed host. Set `CORS_ORIGINS` to the real app
  origins.

---

## ⏳ Conditional / scheduled (do if the trigger applies)

- [ ] **#6 — Redis-back throttling** *if you run more than one API instance.*
  `loginAttempts` / `reclaimAttempts` / `ThrottlerGuard` are per-process today;
  multiple instances multiply the effective limit and reset on restart.
- [ ] **#8 — mandatory `AGENT_SECRET` (or localhost-bind)** *if the print-agent is
  ever networked.* It runs in open mode when `AGENT_SECRET` is unset.
- [ ] **2 remaining moderate vulns — schedule as a separate tested PR:**
  - `@nestjs/core` (patched in 11.1.18) → NestJS 10→11 major upgrade.
  - `uuid 8.3.2` via `exceljs` (patched in uuid ≥11.1.1) → bump `exceljs`; a raw
    uuid override risks breaking the xlsx export.

---

## Deploy-time env summary (services/api/.env)

| Var | Production value |
|-----|------------------|
| `JWT_SECRET` | required, random 32-byte |
| `ALLOW_INSECURE_DEV` | **unset** (never `true` on a deploy) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | comma-separated real app origins |
| `SUPERADMIN_EMAILS` | your platform-ops email(s) |
| `PLATFORM_MASTER_PASSWORD` | long/random/rotated, or unset if unused |
| `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | required, server-only |
