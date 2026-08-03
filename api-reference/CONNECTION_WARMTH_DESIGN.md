# Connection-Warmth Design — Stage 2 (Design Phase, Not Implemented)

> Companion to `PERFORMANCE_INVESTIGATION.md`'s 2026-07-21 correction and
> `PERF_OPTIMIZATION_PROTOCOL.md`. This document is a **design artifact only**
> — no code or configuration has been changed as part of it. Every claim below
> is either sourced from Prisma's shipped type definitions / official docs, or
> measured directly against the live Supabase project via a read-only
> diagnostic script (run once, deleted immediately after).

---

## 1. Current understanding

The dominant P99 latency spikes (`GET /tables` 9.1s, `GET /orders/sales`
6.8s, and the reproduced N=8 burst pattern) are **not** caused by the
auth-user cache's TTL boundary. That was the working hypothesis after Phase A
and it is now **superseded** — a controlled concurrent-load probe with zero
auth-cache involvement reproduced the identical spike shape.

The actual mechanism: Prisma's built-in connection pool (used for our
**direct**, non-pgBouncer connection to Supabase, pass-3's 2026-07-17
decision) voluntarily closes a connection after `max_idle_connection_lifetime`
— **300 seconds by default** — even though the Postgres server itself has no
idle-session enforcement at all on this project (confirmed empirically, see
§2). The 300s figure is coincidentally identical to `AUTH_USER_CACHE_TTL_MS`;
the two are unrelated timers that happen to share a period, which is what
produced the misleading correlation in Phase A. Any ~5-minute-plus quiet
period — a real, ordinary shape for restaurant traffic (lull between orders,
then a burst) — causes the next request's connection to require a fresh
TCP+TLS+Postgres-auth handshake to Singapore, measured at ~1.2–1.5s per new
connection, vs. ~200–350ms once warm.

## 2. Evidence collected

**A. Prisma's own type definitions (installed version, `@prisma/client@6.19.3`,
read directly from the pnpm store, not assumed):**

`PrismaClientOptions` (`node_modules/.prisma/client/index.d.ts`) exposes only:
`datasources`/`datasourceUrl`, `errorFormat`, `log`, `transactionOptions`
(`maxWait`/`timeout`/`isolationLevel` — interactive-transaction behavior, not
pool sizing), `adapter` (driver-adapter escape hatch), `omit`. **No pool-size,
min-connections, or pre-warm option exists at the client-options level.**

**B. Prisma's documentation (fetched directly, `prisma.io/docs`) — connection
string parameters for a direct PostgreSQL datasource:**

| Parameter | Meaning | Default |
|---|---|---|
| `connection_limit` | Max pool size | `num_cpus * 2 + 1` |
| `pool_timeout` | Max wait for a free connection before erroring | 10s |
| `connect_timeout` | Max wait for a *new* connection handshake to succeed | 5s |
| `max_idle_connection_lifetime` | Close a connection after this much **idle** time | **300s** |
| `max_connection_lifetime` | Close a connection after this much **total** time, regardless of activity | 0 (no limit) |

**Minimum idle connections / pre-allocation / warm-up: not exposed by Prisma
at any level** — confirmed both in the type definitions and in the fetched
docs. The docs also note Prisma ORM v7 moves to driver adapters by default,
i.e. Prisma's own direction is *away* from its built-in pool.

**C. Driver adapters (`@prisma/adapter-pg`) + node-postgres (`pg`) —
researched because they're the "if Prisma doesn't expose it" escape hatch for
Question B:**

`@prisma/adapter-pg` passes `connectionTimeoutMillis`/`idleTimeoutMillis`
through to node-postgres's own `Pool`. node-postgres's `Pool` **does** have a
`min` option, but — directly from node-postgres's own docs — **"the pool will
not automatically create and connect new clients up to the min; it will only
not evict and close clients except those which exceed the min count."**
i.e. `min` prevents eviction, it does not proactively (re)establish
connections. node-postgres's own default `idleTimeoutMillis` is **10
seconds** — far more aggressive than Prisma's 300s default, so switching to
the driver-adapter path without also tuning this would make the cold-start
problem *worse*, not better, unless deliberately configured upward.

**D. Supabase's pgBouncer (Candidate 4) — researched via Supabase's own docs:**

Transaction mode (port 6543) hands a connection back to the pool the instant
a transaction commits — this is the mode pass-3 already rejected for its
BEGIN/DEALLOCATE-ALL wrapping overhead (~80–100ms/query measured then).
Critically: **pgBouncer sitting between our app and Postgres does not change
the fact that *our client's own logical connection to whichever endpoint*
still needs its own TCP+TLS handshake from India to Singapore if that logical
connection was itself idle-reaped.** PgBouncer mainly reduces Postgres
*backend* process overhead server-side; it does not eliminate the
client-side RTT cost of re-establishing a dropped client→Supabase connection.

**E. Live-project verification (empirical, not assumed) — a disposable,
read-only diagnostic script run once via the already-installed
`@prisma/client` against the real `DATABASE_URL`, deleted immediately after:**

```
idle_session_timeout                 => 0        (disabled — server never closes an idle session)
idle_in_transaction_session_timeout  => 0        (disabled)
tcp_keepalives_idle                  => 1800     (30 min before a TCP keepalive probe even starts)
tcp_keepalives_interval              => 60
tcp_keepalives_count                 => 9        (so full keepalive failure detection ≈ 39 min)
statement_timeout                    => 2min     (caps long-running queries only, irrelevant here)
```

**This is the single most important finding.** The Postgres server would
happily keep a connection open indefinitely — it enforces nothing. The
connection is being closed **entirely client-side, voluntarily, by Prisma's
own 300s default.** Nothing on the server or the network stack (TCP
keepalive doesn't even start probing until 30 minutes) is forcing this.
That reframes the whole design question: this isn't "how do we fight the
server/network into keeping connections alive," it's "why is our own client
throwing away connections the server was never going to take from us."

## 3. Design options

**Option 1 — Application-level keep-alive (periodic ping).** A scheduled
lightweight query (e.g. `SELECT 1`) fired often enough to keep N connections
from ever going idle past `max_idle_connection_lifetime`. Works regardless of
which connection layer is used; doesn't require changing `max_idle_connection_lifetime`
at all (though it interacts with it — see §5).

**Option 2 — Driver / Prisma configuration (raise `max_idle_connection_lifetime`).**
Since the server enforces nothing (§2E), simply raising this connection-string
value (or a driver-adapter equivalent) removes the reason connections get
discarded, with no new code, no new dependency, no new moving part. This is
the option §2's evidence points at most directly.

**Option 3 — Database-side keep-alive.** N/A here in the useful sense — the
DB side already has nothing to configure (`idle_session_timeout=0` already).
The only DB-side lever available is *lowering* keepalive-related settings,
which doesn't help. Included for completeness per the candidate list, but
the evidence shows there's no server-side lever to pull.

**Option 4 — Supabase pooler (pgBouncer) reintroduction.** Changes where the
"warm connection" problem lives (client→pgBouncer instead of client→direct
Postgres) but doesn't remove the client-side RTT-to-establish cost, and
reintroduces the previously-measured ~80–100ms/query transaction-mode
overhead. Session mode avoids that overhead but session mode still means a
client-held connection that can itself go idle and get reaped by *something*
(pgBouncer's own idle settings, which we have not queried — see §8).

**Option 5 — OS/TCP keepalive tuning.** Would only matter if connections were
dying from silent network-level drops (NAT/firewall/load-balancer). §2E shows
`tcp_keepalives_idle=1800`s — TCP keepalive isn't even the active mechanism
here; the connection is being closed by Prisma's own application-level logic
long before any TCP-level keepalive would ever fire. This candidate solves a
problem we don't currently have evidence of having.

## 4. Tradeoff matrix

| Candidate | Solves root cause? | New code/deps | Config change | Ops complexity | Evidence strength |
|---|---|---|---|---|---|
| 1. App-level keep-alive | Yes, indirectly (prevents idle window from ever being reached) | Yes — new scheduled task, lifecycle-managed | None required | Medium (needs failure handling, shutdown handling) | Medium — standard pattern, not project-specific evidence |
| 2. Raise `max_idle_connection_lifetime` | **Yes, directly** — removes the actual cause | None | Yes (connection string) | **Low** — one value | **High** — directly matches §2E's finding |
| 3. DB-side keep-alive | N/A — nothing to configure | None | N/A | N/A | High (confirms there's nothing to do here) |
| 4. Supabase pooler | Partial — trades one overhead for another | None (revert to existing config shape) | Yes (connection mode) | Medium (mode choice, re-verify pass-3's measurements) | Medium — solves a different axis (backend fanout), not confirmed to solve this one |
| 5. TCP keepalive tuning | No — not the active mechanism per §2E | None | Yes (Postgres/OS params) | Low | Low — no evidence this is where connections are dying |

## 5. Recommended design (for review — not yet built)

**Primary: Option 2 (raise `max_idle_connection_lifetime`), evaluated together
with Option 1 (keep-alive) as a belt-and-suspenders pair, not a choice
between them:**

- Raising `max_idle_connection_lifetime` removes the *self-inflicted* part of
  the problem for free — Postgres was never going to reap the connection, so
  there is no reason Prisma should either, up to some sane outer bound (still
  worth keeping *some* finite value, not `0`/unlimited, as a hygiene backstop
  against a genuinely dead/stale connection lingering forever — see §7).
- A lightweight keep-alive (Option 1) is a smaller, complementary addition
  worth designing *only if* the raised lifetime alone doesn't fully close the
  gap in the benchmark (§6) — e.g. if the DB pool is co-located behind
  infrastructure with its own timeout we haven't observed yet (§8). It should
  not be built first; it should be evaluated as a fallback once §6's warm
  benchmark either confirms or fails to confirm Option 2 alone is sufficient.
- Options 3 and 5 are not recommended — the evidence in §2E shows there is
  nothing to configure on those axes for this specific symptom.
  Option 4 is not recommended as a primary fix — it addresses a different
  problem (backend connection fanout) at a real, previously-measured cost,
  and doesn't have direct evidence of solving *this* mechanism.

**Answering Question C directly:** an idle-but-not-yet-reaped connection sits
in Prisma's pool available for immediate reuse; it is not mid-query and not
mid-transaction, so it holds no lock, no transaction state, and blocks
nothing. Pool "capacity" (per pass-3's "transaction duration IS pool
occupancy" rule) is about how many connections are *busy* at once, capped by
`connection_limit` — an idle connection is the *opposite* of occupied
capacity, it's spare capacity sitting ready. Raising the idle lifetime changes
*when a connection gets discarded*, not *how many can be busy simultaneously*
— `connection_limit=8` is untouched by this design. The one real capacity
question is Option 1's keep-alive, if built: a keep-alive ping **does**
briefly occupy one connection for the duration of its own trivial query
(sub-50ms), which is why §6's burst benchmark must include a keep-alive
variant to confirm it never coincides with real traffic in a way that adds
queueing — this is exactly the kind of claim that must be measured, not
assumed, before Option 1 is built.

## 6. Measurement plan (design only — to run once a design is approved)

All benchmarks reuse the existing `$extends`-based per-request Prisma-time
instrumentation (confirmed working, §2 of the prior probe) plus the raw
per-query log, run against the CURRENT (unmodified) config first to get a
fresh baseline, then repeated against each candidate config change in
isolation.

| Benchmark | Requests | Idle gap before firing | Measures | Success criteria |
|---|---|---|---|---|
| **Cold start** | 1 | Fresh process start (no prior queries) | First-request latency, connection count established | Establishes the absolute worst case baseline |
| **Idle** | 1 | 6 minutes (past the current 300s default) | Whether the next request pays the cold-connection tax | Baseline: yes (current); target after fix: no |
| **Burst** | N = 4, 8, 12 (fired truly concurrently) | 6 minutes idle immediately before | Per-request total, per-request prisma-time, count of fresh `SELECT 1` handshakes in the raw query log | Baseline: bimodal/escalating pattern (already captured); target: uniform, all requests near the warm-path number |
| **Warm** | 1 | 0 (immediately after prior traffic) | Per-query time when nothing has gone idle | Should already be fast in both baseline and candidate — a control, not a target |
| **Steady-state** | Continuous light traffic (e.g. 1 req/30s) for 20+ minutes | N/A (no gap by design) | Whether steady-state behavior changes at all under the candidate config | Must show **no regression** — a keep-alive or raised lifetime must not add measurable overhead to normal traffic |

Each run reports: total wall time, summed Prisma operation time, query
count, and count of `SELECT 1` connection-probe lines in the raw log for that
window — the same evidence shape already used in the prior probe, so
before/after is directly comparable.

## 7. Risks

**Option 2 (raise `max_idle_connection_lifetime`):**
- *Operational:* a connection that goes stale for a reason outside Postgres's
  control (e.g. a network path change, Supabase-side infra maintenance) could
  sit in the pool looking idle-but-valid until an actual query fails against
  it — Prisma has retry/error-surfacing for a dead connection on next use, but
  this needs confirming in the benchmark, not assumed. Recommend a large but
  still *finite* value (not literal `0`/unlimited) so a genuinely wedged
  connection doesn't linger forever.
- *Memory/CPU:* negligible — this doesn't add connections, just changes when
  existing ones are dropped.
- *Database impact:* Supabase's project already shows no server-side
  enforcement (§2E) — the DB is not being asked to do anything new; if
  anything this reduces DB-side connection churn (fewer new-backend spins).
- *Failure modes:* if Supabase (unbeknownst to us) has its own infra-level
  idle disconnect not visible via `SHOW` (e.g. a load balancer in front of
  the direct-connection endpoint), a raised client-side value could produce
  "connection appears open, first query on it fails" errors instead of
  today's silent-but-slow reconnect. This is exactly what the idle benchmark
  (§6) is designed to catch before rollout.
- *Rollback:* trivial — it's one connection-string value; revert the number.

**Option 1 (keep-alive), if it ends up needed:**
- *Operational:* another scheduled task to own, monitor, and shut down
  cleanly — more moving parts than Option 2.
- *Memory/CPU:* negligible per-ping, but needs its own error handling (a
  failed keep-alive ping must not crash the process or spam logs).
- *Database impact:* one trivial query per interval, per warm connection
  maintained — needs to be measured to confirm it doesn't add queueing under
  real concurrent load (§6 steady-state benchmark).
- *Failure modes:* if the ping itself starts failing (e.g. during a real DB
  outage), it must not mask the outage or retry-storm.
- *Deployment complexity:* needs correct `onModuleInit`/`onModuleDestroy`
  wiring (already an established pattern in `prisma.service.ts`) so it starts
  and stops with the app cleanly.
- *Rollback:* remove the scheduled task; no persistent state to unwind.

**Option 4 (pooler), noted for completeness though not recommended primary:**
- Reintroduces a previously-measured, real per-query cost (~80–100ms) that
  pass-3 explicitly moved away from — any revisit needs its own full
  before/after measurement pass, not a partial one.

## 8. Questions still unanswered

- Does Supabase have any **infra-level** (load balancer / proxy in front of
  the direct-connection endpoint) idle-disconnect policy that wouldn't show
  up in a Postgres `SHOW` command? Not verifiable from inside Postgres itself
  — would need either Supabase support/docs specific to the project's plan
  tier, or empirical evidence from the idle benchmark (§6) at a longer gap
  than 6 minutes (e.g. 15–30 min) to see if something *else* eventually kills
  the connection even with `max_idle_connection_lifetime` raised.
- What's the actual real-world *idle gap distribution* in production traffic
  (not this dev session's artificial gaps)? The design should ideally be
  informed by how long a typical lull between orders actually is at a live
  restaurant, to pick a `max_idle_connection_lifetime` value that's generous
  enough without being effectively unlimited for no reason.
- If Option 1 (keep-alive) is eventually built: what's the right interval?
  It needs to run more often than whatever idle threshold is in effect, but
  the exact number is a tuning question the steady-state benchmark should
  answer empirically, not a guess.
- Does raising the idle lifetime interact at all with Supabase's own billing/
  connection-count metrics in a way worth knowing about ahead of time (e.g.
  more simultaneously-open-but-idle connections showing up in a dashboard)?
  Not measured — a reasonable question for whoever reviews this design before
  approval, not something this investigation can answer from the outside.
