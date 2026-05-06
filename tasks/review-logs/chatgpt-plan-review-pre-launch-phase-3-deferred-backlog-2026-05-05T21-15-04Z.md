# chatgpt-plan-review — pre-launch-phase-3-deferred-backlog

**Date:** 2026-05-05
**Plan:** tasks/builds/pre-launch-phase-3-deferred-backlog/plan.md
**Mode:** manual

---

## Round 1

**Operator feedback summary:** ChatGPT verdict ~95% ready to build. 4 required adjustments + 2 minor tightenings + 1 mechanical guard. One finding (D.6 advisory-lock scope) directionally contradicts operator-locked Open Question §8.2 — surfaced for approval.

**Findings:** 6 total (5 technical, 1 user-facing)

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---------|--------|----------|-----------|
| 1 | C.1 OAuth state — atomic CTE replaces SELECT-then-DELETE | technical | ACCEPT | Eliminates TOCTOU window already flagged in §7.3 risk; same observable behaviour, stronger correctness guarantee. Plan §6 C.1 contract + §7.3 risk rewritten to specify CTE-based single-query consume as the canonical implementation. |
| 2 | D.6 advisory lock — narrow critical section instead of wrapping full tick() | user-facing | PENDING OPERATOR | Directionally contradicts operator-locked decision in §8.2 (Option A: wrap full tick() body). ChatGPT recommends a narrower critical section that only covers lock-acquire + claim-next-work + enqueue-job. This is a scope-changing reversal — operator must explicitly re-decide §8.2. |
| 3 | D.5 migration — guard against missing provider_type='ghl' | technical | ACCEPT | Defensive DO $$ ... RAISE EXCEPTION block at top of migration prevents silent partial backfill if provider_type string differs (already flagged in §7.2 risk). Mechanical addition; no semantic change. |
| 4 | E.3 dedupe ordering — explicit doc statement | technical | ACCEPT | §8.7 already locked rate-limit FIRST. Adds explicit "dedupe is observability optimisation; rate limit is protection layer" rationale to E.3 doc + §7.5. No code change. |
| 5 | D.1 fail-open RL — tighten audit payload | technical | ACCEPT | Add `bucket`, `limit`, `windowSec` to fail-open audit event meta. Makes incidents diagnosable without code-spelunking. Pure additive change to the meta payload contract. |
| 6 | A.4 rename pass — mechanical guard | technical | ACCEPT | Add in-pass `git grep` check command to A.4 contract. Defence-in-depth alongside B.4 grep gate. Documentation-grade addition to the chunk's verification steps. |

### Changes applied

- **C.1 OAuth state consume — atomic CTE.** Plan §6 Chunk C.1 contract rewritten: replaced the SELECT-then-DELETE narrative with a canonical single-query CTE that classifies the nonce (not_found / expired / consumed) and conditionally DELETEs only when `expires_at > now()`. §7.3 risk re-headed `RESOLVED via CTE` — residual risk is now "none".
- **D.5 migration — provider_type guard.** Plan §6 Chunk D.5 migration contract: prepended a `DO $$ ... RAISE EXCEPTION` pre-flight that fails the migration if no `provider_type = 'ghl'` row exists in `connector_configs`. §7.2 risk mitigation updated to reference the guard; build-time verification step preserved.
- **E.3 dedupe ordering — explicit doc statement.** Plan §6 Chunk E.3 note rewritten: order is locked rate-limit FIRST, then dedupe; canonical layering rationale ("rate limit is protection layer; dedupe is observability optimisation") added inline. §7.5 risk re-headed `RESOLVED`.
- **D.1 fail-open RL — diagnosable audit payload.** Plan §6 Chunk D.1 fail-open pseudocode: extended `safeRateLimitCheck` signature to take `bucket: 'ip_email_short' | 'ip_email_long' | 'email_only'`; meta payload now carries `bucket`, `limit`, `windowSec` plus the existing `severity` / `reason` / `key`. Surrounding `Promise.all` pseudocode updated to pass bucket types per call.
- **A.4 rename pass — in-pass mechanical guard.** Plan §6 Chunk A.4 acceptance criteria: added an explicit "before committing" three-grep-check block (eventType raw strings, `as SecurityAuditEventName` casts, heuristic `auth.` outside `auditEvent` references). Documents the third check as defence-in-depth alongside B.4 gate enforcement.

### Pending operator decision (user-facing)

- **Finding 2 — D.6 advisory-lock scope.** ChatGPT recommends a *narrow critical section* (lock-acquire + claim-next-work + enqueue-job, ~10–20 lines inside a single transaction) instead of the operator-locked Option A from §8.2 (wrap the full ~1000-line `tick()` body in `db.transaction(...)`). This is a directional reversal of an already-decided open question. Surfaced for explicit operator approval — see operator-approval section below.

### Round 1 close-out

**Decision timestamp:** 2026-05-05T21:22:34Z

**Finding 2 — D.6 advisory-lock scope: DEFER.**

Operator decision: route ChatGPT's narrowed-scope advisory-lock proposal to `tasks/todo.md` as a Phase 4 follow-up. Plan §8.2 stays locked as Option A (wrap full `tick()` body in `db.transaction(...)` while holding `pg_advisory_xact_lock`). No edit to plan §8.2.

Rationale: ChatGPT's narrow critical section is structurally a claim-then-execute refactor (Option C / claim-pattern), not a tightening of Option A. Adopting it now would expand D.6's scope from "add a lock" to "refactor `tick()` into claim and execute halves with durable claim state, lease semantics, and crash-recovery for claimed-but-not-executed jobs" — a separate spec. It would also re-introduce the split-brain risk Option A was selected to eliminate (between lock-release and job-execution, a second worker can claim the same window without durable claim-state). Keep Option A for this build; surface the heavy long-held-lock concern in Phase 4 with a dedicated spec.

Routed to: `tasks/todo.md` § Phase 4 — System Consistency, top entry "D.6 advisory-lock — narrowed critical-section refactor (claim-pattern)."

**Round 1 status:** CLOSED. 5 technical findings auto-applied to plan; 1 user-facing finding deferred to Phase 4 backlog. Plan §8.2 unchanged.

---

## Round 2

**Operator feedback summary:** ChatGPT verdict APPROVED — READY TO BUILD. 5 final-round findings, all flagged as optional refinements ("only apply if you want maximum robustness"). 4 technical (C.1 always-return-row, D.1 emission throttle, B.4 namespace-prefix gate extension, D.6 invariant docstring); 1 user-facing (D.5 partial index on `security_audit_events` adds new migration scope).

**Findings:** 5 total (4 technical, 1 user-facing)

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---------|--------|----------|-----------|
| 1 | C.1 OAuth CTE — always-return-row via `UNION ALL` synthetic branch | technical | ACCEPT | Unifies the caller's classification surface — the row carries `was_not_found` instead of the caller having to interpret "no rows" as "not found". Same atomicity properties; semantically equivalent refinement. Plan §6 C.1 contract + §7.3 risk updated. |
| 2 | D.5 chain-closure performance — add partial index on `security_audit_events` | user-facing | PENDING OPERATOR | Adds a NEW migration scope (partial index on the audit table) on top of the existing 0285 migration. Goes beyond ChatGPT's "optional refinement" framing. Operator approval needed: accept the scope addition, defer to Phase 4, or accept Option B's lighter form only. |
| 3 | D.1 fail-open RL — throttle audit emission per-bucket (30s window) | technical | ACCEPT | Pure correctness improvement: prevents log flood during sustained backend outage. In-process Map keyed by `RlBucketType`; emits at most one event per bucket per 30s. Best-effort observability semantics intact. Plan §6 D.1 contract + acceptance criteria + test surface updated. |
| 4 | A.4 → B.4 — extend namespace-prefix grep to a permanent CI gate | technical | ACCEPT | The single-quote-anchored pattern (`'(auth\|oauth\|security\|data\|job)\.`) is sufficiently specific that it does NOT false-positive on property paths (those are unquoted). Strengthens B.4 from a 2-pattern gate to a 3-pattern gate; catches stray namespace strings that escape the eventType-anchored Pattern 1. Plan §6 B.4 contract + acceptance criteria updated; A.4 in-pass guard remains as defence-in-depth. |
| 5 | D.6 invariant — "no external side effects before enqueue inside `tick()`" | technical | ACCEPT | Pure documentation addition to the operator-locked Option A. Codifies the contract that makes Option A correct (dispatch-and-DB are one atomic unit; no external side effect may run between partial DB write and enqueue). Lands as code comment + acceptance criterion. Plan §6 D.6 updated. |

### Changes applied

- **C.1 OAuth CTE — always-return-row guarantee.** Plan §6 C.1 contract: rewrote the CTE pseudocode to add a `UNION ALL` synthetic-row branch guarded by `WHERE NOT EXISTS (SELECT 1 FROM target)`. The query now returns exactly one row in all three classification cases; the row carries three mutually-exclusive booleans (`was_consumed` / `was_expired` / `was_not_found`). Test surface extended with an explicit always-return-row assertion. Acceptance criteria gained "the CTE always returns exactly one row per call". §7.3 risk re-headed to reference the always-return-row refinement.
- **D.1 fail-open emission throttle.** Plan §6 D.1 fail-open pseudocode: added a process-local `Map<RlBucketType, number>` and a `shouldEmitRateLimitTrip(bucket)` gate that suppresses emission when last emit < 30s ago. Inline comment documents why process-local is acceptable (best-effort observability; multi-process emits at most ~3 events/30s/bucket — still ~3 orders of magnitude below an unsuppressed flood). Test surface gained: 5-call rapid burst asserts exactly ONE event; clock-advance asserts a second event after 30s; different buckets throttled independently. Acceptance criteria gained: "Fail-open emission is throttled per bucket to at most one event per 30s".
- **B.4 namespace-prefix gate (Pattern 3).** Plan §6 B.4 contract: extended from 2 patterns to 3 patterns. New Pattern 3 is `'(auth\|oauth\|security\|data\|job)\.` (single-quote anchored, only matches inside string literals; property paths are unquoted and not flagged) filtered through `grep -v auditEvent` to drop legitimate factory call sites. Inline rationale explains why this does NOT false-positive on property access. Known-bad fixture extended (`logger.info('oauth.stateConsumed', ...)` trips Pattern 3). Known-good fixture added (`auditEvent.auth.loginFailed.name` line — silent). Acceptance criteria gained corresponding rows. A.4 in-pass guard remains as defence-in-depth.
- **D.6 invariant docstring.** Plan §6 D.6: added a load-bearing invariant block — "No external side effects before enqueue inside `tick()`" — to be documented as a code comment at the top of the wrapped `db.transaction(async (tx) => { ... })` body. Body explains the contract: every effect that must NOT happen on rollback lives inside the transaction; pg-boss dispatch is the canonical example; non-transactional side effects (HTTP calls, external APIs) MUST run after commit OR be idempotent. Acceptance criteria gained "The invariant is documented as a code comment ... and verified by code inspection".

### Pending operator decision (user-facing)

- **Finding 2 — D.5 partial index on `security_audit_events`.** ChatGPT proposes Option A (a new `ghl_enrol_runs` derived-state table — preferred but heavier) or Option B (a partial index on `security_audit_events` filtered by `event_type IN ('oauth.enrol.completed', 'oauth.enrol.failed', 'oauth.enrol.partial')` and indexed on `(meta->>'connectionId', meta->>'runId')`). The current plan's `isChainClosed()` scans the audit stream — fine at low volume, may degrade at scale. This is a NEW migration not specified in the spec; adopting it expands D.5 scope. Surfaced for explicit operator approval — see operator-approval section below.

### Operator approval needed

**Finding 2 — D.5 chain-closure performance optimisation.**

**ChatGPT's recommendation:** Add a partial index on `security_audit_events` to make `isChainClosed()` O(log n) instead of a full scan, OR add a derived `ghl_enrol_runs` table maintained on terminal events.

**Three options:**

1. **ACCEPT (Option B partial index).** Add a new migration `0286_security_audit_events_enrol_terminal_idx.sql` that creates the partial index. Updates the spec posture from "scan audit stream" to "indexed lookup on terminal events". Cost: ~10 lines of migration + ~1 doc note. Benefit: prevents latent post-launch performance issue.

2. **ACCEPT (Option A derived-state table).** Heavier change — adds `ghl_enrol_runs` table, schema, RLS, and write-paths from terminal-event emitters. Out of scope for Phase 3 in current form.

3. **DEFER.** Route to `tasks/todo.md` Phase 4. Phase 3 ships with the audit-stream scan. Pre-launch volume is zero; the performance concern is post-launch.

**Architect recommendation:** DEFER. The plan is currently APPROVED — READY TO BUILD. Pre-launch user volume is zero, so the scan is fine until post-launch traffic exists. Adding a new migration here, even a small one, expands D.5's commit footprint and re-opens migration-numbering coordination with any other in-flight work. Phase 4 has explicit room for performance optimisations once we have real traffic shape data to size the index properly. ChatGPT itself flagged this as "only apply if you want maximum robustness" — the build can ship without it.

**Operator: yes / no / defer?**

### Round 2 close-out

**Decision timestamp:** 2026-05-05T21:38:02Z

**Finding 2 — D.5 partial index on `security_audit_events`: DEFER.**

Operator decision: route ChatGPT's partial-index proposal to `tasks/todo.md` Phase 4. Plan §6 D.5 stays unchanged — `isChainClosed()` continues to scan the audit stream for terminal events as currently specified. No edit to plan.

Rationale: pre-launch user volume is zero, so the scan-vs-indexed-lookup performance difference is unobservable. Adding a new migration here would expand D.5's commit footprint and force migration-numbering coordination with any other in-flight work (the partial-index migration would have to take the next available number, racing with whatever the next backlog migration claims). Index sizing also benefits from real traffic shape data — the `WHERE event_type IN (...)` predicate is sensible today, but the actual selectivity profile only emerges once locations are flowing. Architect-recommended; ChatGPT itself flagged the finding as "only apply if you want maximum robustness".

Routed to: `tasks/todo.md` § Phase 4 — System Consistency, second entry "D.5 chain-closure performance — partial index on `security_audit_events`."

**Round 2 status:** CLOSED. 4 technical findings auto-applied to plan (C.1 always-return-row, D.1 30s `shouldEmitRateLimitTrip(bucket)` suppression, B.4 namespace-prefix gate Pattern 3, D.6 invariant docstring); 1 user-facing finding deferred to Phase 4 backlog. Plan §6 D.5 unchanged.

---

## Round 3

**Operator feedback summary:** ChatGPT verdict APPROVED — BUILD WITH CONFIDENCE. 4 final-round refinements ("low-effort but high-leverage improvements around correctness, performance, and future-proofing"). All flagged as no blockers; refinements only. Triage: 3 technical (with adaptations on 2), 1 already-deferred re-surfacing.

**Findings:** 4 total (3 technical applied with adaptations; 1 already-deferred from Round 2)

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---------|--------|----------|-----------|
| 1 | C.1 — codify "exactly one row" invariant in code (assertion + comment-block contract) | technical | ACCEPT | Pure correctness lockdown. Adds a runtime `if (result.rows.length !== 1) throw …` guard against silent SQL regressions in the always-return-row CTE landed in Round 2. Mechanical addition; same observable behaviour on the happy path; loud failure on any future regression. Plan §6 C.1 contract + test surface + acceptance criteria updated. |
| 2 | D.5 — partial index on `security_audit_events` for indexed `isChainClosed()` lookup | already-deferred | ALREADY_DEFERRED (Round 2 Finding 2) | This is the SAME proposal already deferred in Round 2 (operator decision 2026-05-05T21:38:02Z) — ChatGPT brought it back unchanged. Per operator pre-triage: do not re-surface, do not re-apply. Pointer to Round 2 close-out and `tasks/todo.md` Phase 4 entry recorded; no plan edit. |
| 3 | D.1 fail-open RL — refine suppression key from `bucket` alone to `bucket + identity` | technical (with adaptation) | ACCEPT (with adaptation) | ChatGPT proposed `bucket + orgId` (or `bucket + hash(key)`). Operator-noted constraint: orgId is NOT available on the fail-open path — that's the whole point (backend down means no auth/lookup completed). Adapted: key suppression on `${bucket}:${rlKey}` where `rlKey` is the rate-limit key string already passed to `safeRateLimitCheck` (already a stable hash of (ip, email) or (email) per bucket type). Same shape as ChatGPT's `hash(key)` alternative; uses the existing key directly to avoid a redundant hash. Map signature updated `Map<RlBucketType, number>` → `Map<string, number>`; cross-identity regression-guard test added. Plan §6 D.1 contract + test surface + acceptance criteria updated. |
| 4 | D.6 — structural guard against external side effects inside `tick()` transaction | technical (with adaptation) | ACCEPT (lighter alternative ChatGPT itself offered) | ChatGPT proposed two options: (a) heavyweight runtime `hasExternalSideEffects` flag mutated by a `markExternalEffect()` helper, throwing pre-commit if set, OR (b) a clearly-named `EXTERNAL SIDE EFFECTS` comment-block marker. Operator pre-triage selected (b): the runtime guard adds runtime weight to enforce a static contributor-discipline rule, and contributors who don't know the rule won't know to call `markExternalEffect()` either. The comment-block marker addresses the exact failure mode (a contributor pasting `await fetch(...)` mid-transaction): a reviewer or the contributor themselves sees the marker and knows where the boundary is. Cheap, durable, no runtime cost. Plan §6 D.6 contract extended with full pseudocode showing the marker placement; acceptance criterion gained "marker is present, REQUIRED even if no post-commit work ships today". |

### Changes applied

- **C.1 always-return-row invariant assertion (Finding 1).** Plan §6 C.1 contract: extended the inline pseudocode comment block with an `INVARIANT — first-class contract` section that codifies the exactly-one-row guarantee as a runtime check (`if (result.rows.length !== 1) throw new Error('oauth_state_consume: invariant violation — expected exactly one row, got ${result.rows.length}')`). Includes "why a hard throw rather than a soft fallback" rationale (silent regressions corrupt downstream telemetry; loud throw makes the regression diagnosable). Test surface gained an "Invariant-violation test" stubbing `db.execute` to return `rows.length === 0` (or `=== 2`) and asserting the throw shape. Acceptance criteria gained a row referencing the runtime invariant + test pin.
- **D.1 per-(bucket, identity) suppression keying (Finding 3, adapted).** Plan §6 D.1 contract: rewrote the in-process throttle Map's signature from `Map<RlBucketType, number>` to `Map<string, number>` keyed by `${bucket}:${rlKey}`. `shouldEmitRateLimitTrip` signature changed from `(bucket)` to `(bucket, rlKey)`. Inline rationale block expanded with three new paragraphs: (1) "Identity key" — explains why orgId is unavailable on the fail-open path and why `rlKey` is the natural identity. (2) "Why per-(bucket, identity) instead of per-bucket" — explains the cross-user suppression bug that bucket-only keying would create during a partial outage. (3) Updated multi-process semantics — emit count is now `(process-count)` events per 30s window per `(bucket, identity)`, not per bucket. Test surface gained a "Cross-identity test (regression guard for bucket-only suppression bug)" — two distinct keys in the same bucket, both must emit. Acceptance criteria updated to reflect per-(bucket, identity) throttling and the no-orgId-required constraint.
- **D.6 EXTERNAL SIDE EFFECTS comment-block marker (Finding 4, adapted).** Plan §6 D.6: appended a new "Structural enforcement — `EXTERNAL SIDE EFFECTS` section marker" subsection AFTER the existing invariant docstring. Includes a complete TypeScript pseudocode block showing the marker's exact placement: a leading comment block at the top of the `db.transaction(async (tx) => { ... })` body restating the invariant, and a separate `// EXTERNAL SIDE EFFECTS (must run AFTER transaction commit)` comment block placed AFTER the transaction closure. Inline rationale block ("Why a comment marker rather than a runtime guard") explains the rejection of the heavyweight `hasExternalSideEffects` flag option. Acceptance criteria gained: "An `EXTERNAL SIDE EFFECTS (must run AFTER transaction commit)` comment-block marker is present in the file, placed AFTER the `db.transaction(...)` block, separating transactional work from post-commit work. Required even if no post-commit work ships today — pre-positions the contract for future additions. Verified by code inspection."

### Re-surfaced findings (no plan edit)

- **Finding 2 — D.5 partial index on `security_audit_events`: ALREADY_DEFERRED.** ChatGPT re-surfaced the same proposal already decided in Round 2 (Finding 2; deferred 2026-05-05T21:38:02Z). Per operator pre-triage, this is recorded but not re-applied and not re-surfaced for fresh approval. Pointer: Round 2 close-out (above) + `tasks/todo.md` § Phase 4 — System Consistency, "D.5 chain-closure performance — partial index on `security_audit_events`". The deferral rationale stands: pre-launch volume is zero, no migration-numbering coordination cost worth paying today, index sizing benefits from real traffic shape.

### Round 3 close-out

**Decision timestamp:** 2026-05-05T21:38:02Z

**Round 3 status:** CLOSED pending operator continue/done. 3 technical findings auto-applied to plan (C.1 invariant assertion, D.1 per-(bucket, identity) suppression keying, D.6 EXTERNAL SIDE EFFECTS comment-block marker); 1 finding ALREADY_DEFERRED from Round 2 (no edit, no fresh approval needed). Plan posture remains APPROVED — BUILD WITH CONFIDENCE.

---
