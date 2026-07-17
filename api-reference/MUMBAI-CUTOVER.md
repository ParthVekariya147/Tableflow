# Mumbai Cutover — ap-southeast-1 → ap-south-1

> The final performance pass (see `PERFORMANCE_RESULTS.md`). A migration, not
> a code change — discipline is this checklist, not log diffs. Data is tiny
> (~450 rows, 3 tenants, a handful of storage objects), so the write-freeze
> window is minutes.

## Measured basis (2026-07-17)

TCP RTT from the dev machine (6 samples each):

| Endpoint | min | median |
|---|---|---|
| **Mumbai** `aws-1-ap-south-1.pooler.supabase.com:5432` | **38 ms** | **48 ms** |
| Singapore pooler (current) | 91 ms | 101 ms |
| Singapore direct (current runtime DB) | 96 ms | 109 ms |

≈ 2.2–2.5× cut on every round trip. Projection at ~40–50 ms/query:
mutations (2 RT) ~120–160 ms · reads ~50–60 ms · addRound (10 RT) ~500–600 ms.

## Pre-migration inventory (what lives beyond Postgres)

- **Auth users: 1** — the platform super-admin (`SUPER_ADMIN_SEED_EMAIL`).
  Auth user ids do NOT survive a project move → `User.supabaseId` must be
  re-linked (the cutover script does this).
- **Storage:** bucket `menu-images`, 3 tenant folders; **4 `MenuItem.imageUrl`
  rows embed the old project host** and need rewriting after the object copy
  (script does both; it also sweeps `Tenant.theme` JSON for logo URLs).
- **Project-level settings that CHANGE with the project** (new values needed in
  env files): project ref/URL, DB password, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_JWT_SECRET`, anon key (super-admin + restaurant-admin `.env.local`).
- **Migration history now exists**: `services/api/prisma/migrations/`
  (`20260717000000_init`, baselined 2026-07-17; drift check vs the live
  Singapore DB came back EMPTY — the migration reproduces production exactly).

## Cutover sequence

**Step 0 — manual, dashboard (the only human-required step):** create the new
Supabase project in **ap-south-1 (Mumbai)**, same org. Note: project ref, DB
password (avoid `@`, else %-encode), service-role key, JWT secret, anon key.

**Step 1 — schema (before any freeze):**
```bash
cd services/api
DATABASE_URL="<mumbai-direct-url>" DIRECT_URL="<mumbai-direct-url>" \
  npx prisma migrate deploy        # NOT db push — exercises the migration history
```

**Step 2 — RTT sanity check against the actual project** (`SELECT 1` timing —
expect ~40–50 ms):
```bash
node tools/rtt-probe-db.mjs "<mumbai-direct-url>"   # or any psql/SELECT 1 timing
```

**Step 3 — freeze writes** (stop the API / tell the other dev; window is minutes).

**Step 4 — copy everything** (idempotent; refuses a non-empty target):
```bash
OLD_DB_URL=... NEW_DB_URL=... \
OLD_SUPABASE_URL=https://<old-ref>.supabase.co OLD_SERVICE_KEY=... \
NEW_SUPABASE_URL=https://<new-ref>.supabase.co NEW_SERVICE_KEY=... \
SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... \
  node tools/mumbai-cutover.mjs
```
It copies all tables in FK order, copies the storage bucket, rewrites
`imageUrl`/`theme` hosts, re-creates the super-admin auth user + re-links
`User.supabaseId`, then prints an old-vs-new row-count table (`--verify-only`
re-runs just the comparison).

**Step 5 — swap env + restart:**
- `services/api/.env`: `DATABASE_URL` (Mumbai direct, keep
  `?connection_limit=8`), `DIRECT_URL`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`. Keep the pass-3 comment
  block; append the Mumbai date.
- `apps/restaurant-admin/.env.local` + super-admin env: `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`.
- Restart the API (env is read at process start). Staff JWTs (`JWT_SECRET`)
  are ours, not Supabase's — existing staff logins survive.

**Step 6 — verify + close the trajectory:**
- Sad-path matrix + endpoint bench + burst harness once against Mumbai.
- Append the closing row to `PERFORMANCE_RESULTS.md` (the pass-6 numbers).

**Step 7 — rollback + retirement:** keep the Singapore project **paused for
one week** as the rollback (rollback = swap the env values back). Then delete
it. ⚠️ After deletion the old storage URLs die — confirm step 4's URL rewrite
covered everything first (`SELECT ... WHERE "imageUrl" LIKE '%<old-ref>%'`).

## Post-cutover residuals (tracked in PENDING_TASKS.md §Launch gates)

HTTP/2 at the reverse proxy (runbook 2b) · analytics re-measure at ~10k orders
· KDS relay retirement · BUG-005 client stream-thinning.
