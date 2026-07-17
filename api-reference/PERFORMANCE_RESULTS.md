# Performance Results — pass-by-pass record

> Companion to `PERFORMANCE_INVESTIGATION.md` (2026-07-01, the diagnosis).
> This is the **evidence log of what was actually done and measured**, so these
> decisions never need re-litigating. Method for every pass: dev-only Prisma
> query log (`<tmpdir>/amber-prisma-query.log`, commit `fba7dcb`) with `#### MARK`
> lines bracketing each measured request → per-endpoint round-trip counts +
> per-query durations; wall times from a Node harness against `localhost:3001`;
> test artifacts stamped (`measure-*` device ids / test-marked guest names) and
> deleted by a `WHERE` clause after every run. All measurements from India
> against Supabase **ap-southeast-1 (Singapore)**, warm caches unless noted.
> Single-writer rule: one session drives `.env`/API/DB at a time.

## Where it started (2026-07-01)

Reported symptom: **15–20 s hangs**; analytics 2–10 s; every admin click ~1–3 s.
Root causes (see the investigation doc): session-mode pgBouncer with
`connection_limit=5` + `pool_timeout=20` starving under SSE + bursts (BUG-003 —
the exact 20 s timeouts), ~100 ms India↔Singapore RTT multiplied by 3–7
sequential queries per request, an auth/tenant DB tax on every call, and a
4-endpoint client refetch storm after every mutation.

## The passes

| Pass | Commit | Change | Headline (before → after) |
|---|---|---|---|
| 0 · client | `e1c2698` | Admin applies SSE events directly to floor state; refetch-per-event removed; sales fetch debounced; self-heal polls relaxed to true fallback cadence (60 s admin / 30–45 s customer) | Idle admin tab: continuous polling → **zero requests**; stream events: 2–4 refetches → 0 |
| 1 · caching | `969eaf6` | Auth + tenant caches actually cover steady state: TTL 30 s → 5 min (write-path invalidation is the correctness mechanism), in-flight dedup kills the boot-burst stampede | Staff GET pair ~4 s → ~1.2 s; idle poll blocks: 8 auth queries → **0**; addRound ~4.9 s → ~4.3 s |
| 2 · transactions | `48b2b95` | addRound collapsed into ONE `$transaction` (assert + validation + inserts + reload-as-emit-payload); menu items batched (1 query per round, not per line); SSE emit strictly after commit | addRound **22 RT / 4.27 s → 13 RT / 2.70 s** (txn-mode pooler) |
| 3 · direct connection | `da0e55d` | `DATABASE_URL` → direct Postgres 5432, `connection_limit=8` (txn-mode pgBouncer kept as documented fallback). Killed the wrapper tax: BEGIN + DEALLOCATE ALL + COMMIT around every query + no prepared statements | Warm query ~180–200 ms → **~100 ms (RTT floor)**; open-table-ids 460 → 100 ms; staff GET ~1.0 s → ~420 ms; addRound 2.70 → **1.71 s**. Burst (6 concurrent addRounds + 4 SSE streams): max 3.7 s, no query > 242 ms, **no 5xx/P2024** — BUG-003 conditions gone |
| 4 · guarded writes | `3613cbc` | updateItem/cancel guards moved into the write's own WHERE (extended-where-unique `update`/`delete`; **NOT `updateMany` — Prisma wraps it in an implicit BEGIN…COMMIT, +2 RT, measured to erase the gain**). Sad path = P2025 → one diagnostic read, same 404/409 semantics. capturePayment close guarded on live statuses **inside** the txn | updateItem 7 → 5 queries (~625 ms); cancel 6 → 5 (~677 ms); **money-integrity fix**: staff cancel racing a capture now 409s + rolls the payment back instead of resurrecting a cancelled session into a paid sale |
| 5 · relationJoins | `f4c1f5c` | `relationJoins` preview (Prisma **pinned 6.19.3**): `ROUND_INCLUDE`'s 4 sequential queries → ONE LATERAL-join query. ⚠️ The flag flips the **global default** (verified: addRound's untouched in-tx reload dropped 14→10 queries); the per-callsite args are declarative pins. Joined query costs ~96–103 ms server-side — same as a plain read at this data shape | staff GET /orders **4 → 1 queries, ~420 → ~110 ms**; updateItem **→ 2 queries, ~320 ms**; cancel ~332 ms; capturePayment 11 → 8 queries ~1.4 s; addRound 13 → 10 RT, ~1.71 → **~1.06 s**. Heavy reads spot-checked under the global default: menu 258 ms, tables 235 ms, sales 348 ms, analytics 7d 295–420 ms (deepest joined query 279 ms) — all improved or held. Burst re-run: no engine panic (prisma#26827 fixed upstream; open #28058 is driver-adapters-only), max 2.6 s |

## The addRound trajectory (the canary endpoint)

```
4.9 s → 4.3 s → 2.7 s → 1.7 s → 1.06 s        (≈ 4.6× so far)
 base   pass 1  pass 2  pass 3   pass 5
```

KDS status advance (most-called mutation): ~1.0 s → **~320 ms**.
Staff floor list / SSE snapshot: ~1.0 s → **~110 ms**.

## Standing constraints these passes established

- **Direct-connection discipline** (`.env` note): a `$transaction` holds its
  pool connection BEGIN→COMMIT — transaction duration IS pool occupancy.
  DB-only work inside transactions; SSE emits strictly after commit. Keep
  (instances × connection_limit) well under Postgres' ~60-client cap.
- **Prisma landmines** (in code comments where they bite):
  `updateMany`/`deleteMany` always pay an implicit BEGIN…COMMIT (+2 RT) — use
  extended-where-unique `update`/`delete` for guarded single-row writes.
  `relationJoins` changes the global default strategy, not just annotated
  callsites — any Prisma upgrade from the pinned 6.19.3 is a deliberate
  re-verification of the order paths + heavy reads.
- **BUG-005 / deploy**: 3+ admin tabs saturate Chrome's ~6-connection HTTP/1.1
  cap with SSE streams — symptom identical to BUG-003 with a healthy API.
  **HTTP/2 at the reverse proxy is a launch requirement** (runbook step 2b).

## What's left

1. **Mumbai region move** (final step before launch; kit ready — see
   `MUMBAI-CUTOVER.md`, blocked only on creating the ap-south-1 project).
   Measured RTT from the dev desk: ~48 ms median (vs ~100 ms Singapore). The
   closing row has **two columns**: *dev-from-desk* — reads ~50–60 ms,
   mutations ~120–160 ms, addRound ~500–600 ms (~8–10× from the 4.9 s start) —
   and *production-co-located* — with the API deployed in/near ap-south-1 the
   API↔DB RTT is ~1–5 ms, landing addRound **~150–250 ms** and reads in the
   tens of ms. **API region choice is a performance decision**: deploying the
   API outside ap-south-1 forfeits most of the migration.
2. Optional residue, in Mumbai's shadow: capturePayment's loyalty writes
   (~3 statements) could batch; addRound's per-connection statement re-prepare
   (~200 ms outliers) shrinks proportionally with RTT; analytics' joined query
   re-checked at production data volume.
