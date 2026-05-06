# chatgpt-plan-review — pre-launch-phase-3-deferred-backlog

**Date:** 2026-05-05
**Plan:** tasks/builds/pre-launch-phase-3-deferred-backlog/plan.md
**Mode:** manual
**Build slug:** pre-launch-phase-3-deferred-backlog
**Branch:** claude/pre-launch-phase-3
**Spec at planning:** tasks/builds/pre-launch-phase-3-deferred-backlog/spec.md (APPROVED FINAL via 5 chatgpt-spec-review rounds + 3/5 spec-reviewer iterations)
**Plan size at session start:** 1021 lines / ~86kB

---

## Session info

- **Architect run:** inline (Task/Agent sub-agent tool unavailable in this Claude Code web session); plan written by feature-coordinator main thread following the architect playbook verbatim
- **Plan structure:** 11 sections — architecture notes, model-collapse check (rejected — not an ingest→render pipeline), primitives-reuse confirmation, file inventory cross-reference (3 corrections vs spec), contracts (TS-level signatures), chunk decomposition (A→B / A→C / A→D.3+D.5), per-chunk detail, risks (9), system invariants (20), self-consistency, executor notes
- **Chunk count:** 5 (A canonical types → B grep gates → C observability → D independent hardening → E cleanup)
- **New code primitives:** 2 (`AppError` class, `auditEvent` factory) — both explicitly justified per spec §5
- **Schema delta:** one column + one partial-unique index + one inline backfill UPDATE on `subaccounts` (migration `0285`)

---

## Round 1 — 2026-05-06

**ChatGPT verdict:** READY TO BUILD. No blockers. 6 high-impact refinements + 4 minor refinements.

### Findings disposition

| # | Category | Finding | Decision | Plan change |
|---|---|---|---|---|
| 1 | High | D.5 — job-level idempotency missing (pg-boss retries could re-emit progress events) | **APPLIED** | Added step 2 to D.5 per-job logic: query `security_audit_events` for existing `enrolProgress` row with same `(runId, connectionId, pageIndex)`; drop if found |
| 2 | High | D.5 — `totalLocationsProcessed` in-memory only; lost on worker restart | **APPLIED** | Added step 4 to D.5: re-derive cumulative totals from `security_audit_events` at job start (sum `locationsProcessedThisPage` across all prior `enrolProgress` rows for this chain) |
| 3 | High | D.3 — `null` principal is effectively an unconditional bypass path | **APPLIED** | Added `isSystemContext()` guard: `null` only allowed when `isSystemContext()` returns true (pg-boss worker ALS flag). New AppError throw + audit event if `null` outside system context. Updated §5.7 pseudo-shape and D.3 per-task detail |
| 4 | High | B.1 — assertActive gate too coarse; fires on aggregation/existence queries → CI noise | **APPLIED** | Tightened B.1 strategy: only fire on assigned `.findFirst`/`.findMany` results; escape hatch `// active-check-not-required: <reason>` comment |
| 5 | High | E.3 — LRU dedupe size-only eviction; memory creep on low-but-long-lived traffic | **APPLIED** | Added time-based eviction sweep on insert: iterate entries, delete any where `now - ts > windowMs` before size cap |
| 6 | High | D.5 — no explicit retry vs fatal error classification | **APPLIED** | Added `classifyError(e): 'fatal' \| 'retry'` helper in D.5 failure handling; 4xx + auth-revoked → fatal (emit enrolFailed); 5xx/network/unknown → retry (re-throw) |
| 7 | Minor | A.2 — `AppError` constructor misses `this.stack` | **APPLIED** | Added `this.stack = new Error().stack` to constructor |
| 8 | Minor | B.4 — indirect raw string (`const event = 'auth.login.failure'`) not caught | **APPLIED** | Added third pass to B.4 strategy detecting raw event-name string assignments in files that also call `recordSecurityEvent` |
| 9 | Minor | D.1 — rate-limit buckets short-circuit on single backend failure, losing signal | **APPLIED** | Added explicit requirement: all 4 buckets evaluated independently; backend error on one bucket emits `rateLimitTrip` and continues |
| 10 | Minor | E.5 — `setOrgGUC` has no guard against empty `orgId` | **APPLIED** | Added `if (!orgId) throw new Error('orgId required for setOrgGUC')` |

**Rejected / deferred:** none. All 10 findings accepted.

**Plan size after round 1:** ~1070 lines.

---

## Round 2 — 2026-05-06

**ChatGPT verdict:** PRODUCTION-GRADE. No structural issues, no missing invariants, no hidden coupling risks. Clear to build. Final surgical review — 6 polish notes only.

### Findings disposition

| # | Category | Finding | Decision | Plan change |
|---|---|---|---|---|
| 1 | Polish | D.5 idempotency query may become slow at audit scale — no index on JSON meta fields | **APPLIED** | Added future-proofing note to step 2 of D.5 per-job logic: documents partial index DDL to add if audit volume grows |
| 2 | Polish | D.5 totals recomputation is O(n) per page for large chains | **APPLIED** | Added scaling note to step 4: documents last-row-only optimization for chains exceeding ~1k pages |
| 3 | Polish | D.3 `await recordSecurityEvent` before throw adds latency — risk of future "optimisation" converting it to fire-and-forget | **APPLIED** | Added explicit "security-boundary audit events are synchronous by design" note in D.3 per-task detail |
| 4 | Polish | B.4 pass 3 does not catch dynamic string construction (template literals) | **APPLIED** | Added "scope limitation (intentional)" note to pass 3: dynamic strings are out of scope; rely on code review |
| 5 | Polish | E.3 LRU concurrency assumption not documented | **APPLIED** | Added note: LRU is process-local, relies on Node single-thread; do not replace with shared Redis store |
| 6 | Polish | Migration 0285 backfill join criterion could be wrong → silent partial backfill before index creation | **APPLIED** | Added mandatory `DO $$ ... RAISE EXCEPTION` backfill safety check to migration file spec; fails loudly if any `external_id IS NOT NULL AND external_id_namespace IS NULL` rows remain after the UPDATE |

**Rejected:** none. All 6 polish items accepted.

**Items ChatGPT explicitly said NOT to change:** (a) do not move idempotency out of audit events into a separate table; (b) do not introduce distributed locks for pagination; (c) do not over-optimise audit queries now. Current design is simple, observable, and correct under failure — right pre-launch trade-off.

**Plan size after round 2:** ~1100 lines.

**Review complete. Proceed to build.**

---

## Round 3 — 2026-05-06

**ChatGPT verdict:** APPROVED. Build with confidence. No findings. Final sign-off.

### Findings disposition

None. Zero changes required to the plan.

### Final assessment (verbatim summary)

- Determinism under failure — retries, restarts, and partial chains all covered.
- Security boundary integrity — D.3 `null` outside `isSystemContext()` is now explicit, observable, and non-bypassable without intent.
- Observability correctness — audit events are structured, namespace-enforced by CI, and causality is carried by identifiers not timestamps.
- CI gate balance — precise enough to avoid noise, strict enough to enforce invariants.
- Migration safety — `DO $$ RAISE EXCEPTION` backfill check fails loudly before index creation.

### What to expect during build (implementation friction, not design flaws)

- Naming mismatches (ALS accessor in `withPrincipalContext`, Drizzle type nuances) — mechanical.
- Minor integration friction (pg-boss worker bootstrap context wiring, migration ordering) — execution detail.
- CI gate tuning (B.1 edge cases, B.4 indirect strings) — escape hatches already built in.

### Recommended post-build chaos validation (operator action, not spec work)

Simulate: worker crash mid-pagination; repeated pg-boss retries; rate-limit backend failure; token refresh with missing ALS context. Validate: idempotency holds; no duplicate audit events; no cross-tenant leakage; no chain resurrection after terminal.

**Session closed. Plan LOCKED.**

---
