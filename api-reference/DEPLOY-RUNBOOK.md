# Deploy-Day Runbook — Tableflow API

An **ordered** walk of the two external checks + env hardening, meant to be run
top-to-bottom on the day you cut production. Companion to
`PRE-LAUNCH-CHECKLIST.md` (status board) and `SECURITY-FIXES.md` (what changed).

The ordering is deliberate: the **backward-looking** check (has the #1 bug already
been exploited?) comes first, because it's the only step that inspects existing
state rather than preventing future state. Everything after it is configuration.

---

## Step 0 — Backward-looking: audit existing super-admin rows  ⏱ ~2 min · DO FIRST

Finding #1 ran live in the codebase, so an unauthorized `isSuperAdmin=true` row
may already exist. The code fix cannot undo it. Query the production DB:

```sql
SELECT id, email, "supabaseId", "createdAt", "updatedAt"
FROM "User"
WHERE "isSuperAdmin" = true
ORDER BY "createdAt";
```

- **Expected:** only your seeded operator(s) — by default `ops@amber.platform`.
- **Any unexpected row** (unfamiliar email, a `supabaseId` you don't recognize,
  a `createdAt` around when the bug was live) → revoke immediately:
  ```sql
  UPDATE "User" SET "isSuperAdmin" = false WHERE id = '<row-id>';
  ```
- If you find one, treat it as a possible incident: check the audit log for
  `/admin/*` activity by that user before deciding it was harmless.

**Gate:** do not proceed until this returns a clean, fully-recognized list.

---

## Step 1 — Backward-looking: lock down Supabase self-signup  ⏱ ~2 min

The allowlist (`SUPERADMIN_EMAILS`) backstops this, but the external setting is
the real control. In the Supabase dashboard for the production project:

- **Authentication → Providers → Email:** confirm "Enable Sign Ups" is **off**,
  or that signups are restricted to your team domain.
- If it was open, re-run Step 0 afterward — an open window means the row audit is
  more than a formality.

---

## Step 2 — Set production env  ⏱ ~5 min

In the real `services/api/.env` (never commit it). Values, not placeholders:

| Var | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | |
| `ALLOW_INSECURE_DEV` | **unset** | never `true` on a deploy |
| `JWT_SECRET` | `openssl rand -base64 32` | forgeable staff/impersonation tokens if weak/shared |
| `CORS_ORIGINS` | real app origins, comma-separated | e.g. `https://admin.example.com,https://order.example.com` |
| `SUPERADMIN_EMAILS` | your platform-ops email(s) | else `/auth/sync-profile` 403s for everyone |
| `PLATFORM_MASTER_PASSWORD` | long/random/rotated, **or unset** | now super-admin-only; unset it if you don't use it |
| `SUPABASE_JWT_SECRET` | from dashboard | server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | from dashboard | server-only, never shipped to a browser |
| `DATABASE_URL` / `DIRECT_URL` | pooler / direct | `?connection_limit=…` on pooler; percent-encode `@` in password |

---

## Step 3 — Prove the deploy fails CLOSED  ⏱ ~3 min

The #3 fix only has value if it actually refuses a bad config. Before trusting
the box, confirm the negative path on the deploy host (or an identical staging):

```bash
# Temporarily unset the secret — the API must REFUSE to boot, not fall back.
NODE_ENV=production JWT_SECRET= ALLOW_INSECURE_DEV= node dist/main.js
# Expect: "JWT_SECRET must be set — refusing to boot…" and a non-zero exit.
```

Then restore the real env and confirm a clean boot. If it booted *without*
`JWT_SECRET`, stop — the env isn't being read the way you think.

---

## Step 4 — Smoke-test the guarded paths  ⏱ ~5 min

- **Super-admin bootstrap:** a non-allowlisted Supabase account calling
  `POST /auth/sync-profile` → **403**. An allowlisted one → succeeds.
- **CORS:** a browser request from an origin *not* in `CORS_ORIGINS` is blocked.
- **Master password:** logging in as a normal tenant user with
  `PLATFORM_MASTER_PASSWORD` → **fails** (only super-admin accounts accept it).
- **Guest session isolation:** a request to `GET /orders/:id` for a walk-in
  (null-device) order without a staff token → **403** ("belongs to another device").

---

## Step 5 — Dependency posture  ⏱ ~1 min

```bash
pnpm audit --prod   # expect 2 moderate (both deferred: @nestjs/core, uuid via exceljs)
```

Anything beyond those two = a new advisory since this pass; triage before launch.

---

## Blockers that live outside this runbook

- **#4 payment processor** — the card path closes orders as paid with no charge.
  Disable it or require staff confirmation until a provider is wired in.
- **#6 Redis throttling** — only if you run more than one API instance.
- **#8 print-agent `AGENT_SECRET`** — only if the agent is ever networked.

---

## One-line go/no-go

**Go** when: Step 0 clean · Supabase signup locked · env table filled · box proven
to fail-closed · #4 resolved-or-disabled. Everything else is scheduled, not gating.
