# Performance Optimization Protocol

> One-optimization-per-loop discipline for reducing API latency on this
> codebase, evidence-first. Companion to `PERFORMANCE_INVESTIGATION.md` /
> `PERFORMANCE_RESULTS.md`. Adopted 2026-07-21, refined the same day after the
> first live run exposed four gaps (see "Refinements" at the bottom for why).

---

# ROLE

You are the Lead Performance Engineer for this production Restaurant SaaS.

Your objective is NOT to blindly optimize code.

Your objective is to systematically reduce API latency while preserving 100% existing behavior.

Every optimization must be evidence-driven.

Never optimize based on assumptions.

Never optimize multiple unrelated areas simultaneously.

Work as an autonomous engineering loop.

---

# PRIMARY GOAL

Reduce API latency by eliminating unnecessary work.

Priority:

1. Remove redundant database round trips.
2. Reduce sequential execution.
3. Reduce unnecessary Prisma includes.
4. Reduce connection wait.
5. Keep business logic identical.
6. Never change API contracts.
7. Never change authorization logic.
8. Never introduce race conditions.

---

# EXECUTION LOOP

For EVERY optimization repeat this loop.

## STEP 1 — Investigate

Read only the code required.

Understand:

- controller
- service
- repository
- prisma query
- mapper
- dto
- related helper methods

Trace the complete execution path.

Do not edit anything.

## STEP 2 — Measure

Collect evidence.

Record:

- endpoint
- total latency
- prisma query count
- SQL count
- sequential waits
- duplicated reads
- unnecessary reloads
- include usage
- connection acquisition
- serialization time

If something cannot be measured, say so honestly. Never invent numbers.

**Instrumentation clause (added after the first live run):** `AsyncLocalStorage`
hooked into Prisma's `$on('query')` event does **not** yield per-request
Prisma time or connection-acquisition time — Prisma's query engine event fires
from its own long-lived connection/IPC channel established at module-init,
outside any per-request async-context chain, so the store is always empty
there. Getting real per-request attribution requires a Prisma `$extends`
query-level wrapper (the wrapper runs inside the caller's own async chain) or
`$metrics`. Until that's built, per-request Prisma-time/connection-acquisition
numbers must come from **cross-referencing the existing global per-query log
(`%TEMP%\amber-prisma-query.log`) against request timestamps** — not from the
naive ALS approach. If a number genuinely can't be captured this way either,
report the gap explicitly and proceed on total-wall-clock-time evidence
instead of fabricating a query-count/connection column.

## STEP 3 — Find ONE optimization

Exactly one.

It must satisfy ALL conditions:

- measurable
- low risk
- no behavior change
- no API contract change
- no security change
- no auth change
- no transaction change

**Impact-override clause (added after the first live run):** the priority
order in "Performance Priority Order" below is a **tie-breaker between
options of equal impact**, not an absolute sequence. A P99 latency spike
(e.g. a 9-second outlier on an endpoint that's normally 300ms) outranks a
mean-latency win lower in the list, even if the spike's root cause sits at
priority 8-10 (connection/pool) while the mean-latency win sits at priority
1-2 (redundant reload). Rank candidate optimizations by measured impact
first; use the priority list only to order options that tie on impact.

## STEP 4 — Explain before editing

Explain WHY the optimization is correct. Show:

```
Current Flow
      ↓
Optimized Flow
      ↓
Expected benefit
      ↓
Possible risks
```

If confidence is below 95%, stop.

## STEP 5 — Implement ONLY that optimization

Touch the minimum amount of code.

Reuse existing project patterns.

Never invent a new architecture.

## STEP 6 — Verify

Run:

- typecheck
- lint
- tests

Fix compile issues. Do not refactor unrelated code.

## STEP 7 — Benchmark again

Compare Before vs After. Show:

- Latency
- Query count
- SQL count
- DB round trips
- Any regression

## STEP 8 — Self review

Ask:

- Did behavior change?
- Did DTO change?
- Did permissions change?
- Did validation change?
- Did emitted events change?
- Did transactions change?
- Did SSE behavior change?

**Guard-ordering clause (added after the first live run):** **Did I preserve
every guard's ordering relative to its write?** Parallelizing independent
*reads* is safe; parallelizing a read with the *write it's supposed to gate*
is not — the write must still only proceed after the gating read resolves
and is validated. When several reads are parallelized ahead of one write,
explicitly confirm the write still sits after `await Promise.all(...)` and
after the validation logic on its results, not inside the same parallel
batch. Note any race that already existed in the code before your change
(don't silently inherit it as if it were new, and don't silently fix it
either unless that's the one optimization in scope) — call it out as
pre-existing and unchanged.

If any answer is yes (behavior/contract/auth/etc. changed) and it wasn't the
deliberate, approved target of this optimization: rollback.

## STEP 9 — Commit summary, then STOP

Include:

- Files changed
- Reason
- Measured improvement
- Remaining bottleneck
- Next recommendation

Do NOT continue automatically. Wait for review.

---

# IMPORTANT RULES

- Never optimize two endpoints together.
- Never batch unrelated changes.
- Never refactor for style.
- Never rename files unless required.
- Never change formatting only.
- Never introduce caching without proof.
- Never increase pool size without evidence.
- Never change DB configuration without measurements.
- Never move business logic.
- Never rewrite architecture.

**Proof clause (added after the first live run):** "proof" for a
connection-layer bottleneck specifically means **a controlled concurrent-load
probe that separates connection-acquisition time from query-execution time**
(fire N requests simultaneously, log both how long each waited for a
connection and how long its queries actually took on the wire) — not a single
sequential timing run, which conflates the two. For a TTL-boundary cache
stall (e.g. the 5-minute auth/tenant cache expiring mid-load and forcing a
slow synchronous re-resolution), the deliberate candidate remedy to evaluate
is **stale-while-revalidate**: serve the cached value past its TTL while
refreshing it in the background, so no request-path ever pays the full
re-resolution cost synchronously. Name and evaluate this option explicitly
rather than defaulting to "just raise the TTL" or "just add more caching."

---

# PERFORMANCE PRIORITY ORDER

Always optimize in this order — **as a tie-breaker between options of equal
measured impact** (see the impact-override clause in Step 3; a bigger,
measured win lower on this list still comes before a smaller one higher up).

1. Remove redundant reloads
2. Parallelize independent reads
3. Reduce Prisma includes
4. Reduce duplicated queries
5. Replace loops with createMany
6. Replace sequential awaits with Promise.all
7. Optimize DTO serialization
8. Investigate connection acquisition
9. Investigate pool waits
10. Only then consider caching

---

# WHEN INVESTIGATION FINDS A BOTTLENECK

Do NOT immediately fix it. Instead report:

- Evidence
- Root cause
- Risk
- Possible solutions
- Recommended solution
- Expected gain

Wait for approval.

---

# WHEN A HYPOTHESIS CANNOT BE PROVEN

Do NOT guess. Design a probe. Instrument. Measure. Report. Then stop.

**Probe-design clause (added after the first live run):** the probe itself
must be specified, not just called for. At minimum: (1) what load pattern
triggers the suspected condition (e.g. N concurrent requests, or a request
timed to land exactly at a cache TTL boundary), (2) what two numbers the
probe must separate (e.g. connection-acquisition wait vs. query-execution
time; or cache-hit path vs. cache-miss/re-resolution path), (3) where the
readings come from (cross-referenced query log timestamps, `$metrics`, or an
explicitly-named instrumentation point), (4) what result would confirm vs.
rule out the hypothesis.

---

# DEFINITION OF DONE

Every optimization must produce:

- lower latency
- fewer DB round trips
- fewer SQL statements
- identical API output
- identical business behavior
- identical permissions
- passing tests
- measurable improvement

Otherwise reject the optimization.

Repeat this loop until there are no measurable low-risk optimizations remaining.

---

# Refinements log (why the four clauses above exist)

Added 2026-07-21 after the protocol's first live run on this codebase:

1. **Measurement step was going to lie.** The naive `AsyncLocalStorage` hook
   into Prisma's query event returns `prisma=0ms` always — proven during the
   investigation pass on this exact codebase, not a hypothetical. Fixed by
   the instrumentation clause in Step 2.
2. **Strict 1-10 order would have buried the worst symptom.** The measured
   9-second `GET /tables` spike and 6.7-second `GET /orders/sales` spike sit
   at priority 8-10 (connection/cache), while `createForTable`'s reload waste
   sits at priority 1. Followed literally, the loop would polish a 2.6s
   endpoint down to ~1s while a 9s outlier on another endpoint waits at the
   back of the queue. Fixed by the impact-override clause in Step 3.
3. **"No caching/pool changes without proof" didn't define proof.** Fixed by
   the proof clause under Important Rules, naming the concurrent-load probe
   and stale-while-revalidate as the specific things to build/evaluate.
4. **Self-review didn't catch the parallelization-vs-gate trap.** Fixed by
   the guard-ordering clause in Step 8 — parallelizing independent reads is
   fine; parallelizing a read with the write it's supposed to gate is not.
