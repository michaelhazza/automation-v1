# ChatGPT Spec Review Session — pre-test-integration-harness — 2026-04-28T05-26-11Z

## Session Info
- Spec: docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md
- Branch: claude/review-todo-items-S9JrI
- PR: #221 — https://github.com/michaelhazza/automation-v1/pull/221
- Started: 2026-04-28T05:26:11Z

---

## Round 1 — 2026-04-28T05-26-11Z

### ChatGPT Feedback (raw)

Executive summary: Strong, well-scoped spec. No fundamental blockers. Main gaps are operational sharp edges: DB isolation, race determinism, registry safety, hidden coupling assumptions.

What's solid: scope discipline (§0.3), sequencing, test philosophy, option defaults.

Key risks and required tightenings:
1. (RED) DB isolation underspecified — tests rely on "unique runId + cleanup in afterEach", which is necessary but not sufficient. Parallel tests can collide on shared tables (cost_aggregates), leak rows on cleanup failure, interfere via global constraints/triggers. Failed test poisons subsequent runs. Fix: invariant — wrap DB writes in tx that rolls back at end, OR use per-test schema/namespace. If tx not viable: hard scoping key on all queries + pre-test cleanup guard. Add AC: running suite twice in same DB without manual reset produces identical results.
2. (RED) Provider registry leakage risk — "tests must use distinct provider keys OR run sequentially" is a smell. Shared global registry = hidden coupling; parallel tests can override silently. Fix: invariant — registry registration MUST be scoped and reversible with no reliance on unique keys. registerProviderAdapter stores previous adapter, restore() restores exactly that, tests always restore in finally. AC: two tests using SAME provider key sequentially or in parallel do not interfere.
3. (RED) Approval double-race test assumption needs hardening — relies on UPDATE-based race resolution but missing one guard: if both calls hit before DB commit boundary, can still get double dispatch depending on isolation level. Fix: add assertion to Test 2 — verify dispatch side-effect uniqueness at DB level, not just webhook (e.g. one row in dispatch log / event table with dispatch_source='approval_resume'). Protects against webhook retries, duplicate dispatch before HTTP layer.
4. (ORANGE) Webhook harness realism gap — captures requests + returns configurable response. Missing: real systems may retry on non-200, timeout mid-flight. Fix: add setDropConnection(boolean) — close socket without response. Enables timeout path testing later, avoids needing another harness.
5. (ORANGE) LAEL test ordering assertion needs explicit invariant — asserts requested → completed with N / N+1, but missing: if sequence generation changes later, test may still pass incorrectly. Fix: add explicit invariant — no other llm.* events exist between requested and completed for the same runId.
6. (ORANGE) Failure-path decision (§1.5) missing one edge case — Option A is correct but missing case: partial provider response (e.g. streaming interrupted). Fix: clarify — response: null only when no usable provider output exists; if partial output exists → persist it. AC: partial responses MUST be persisted if structurally valid.
7. (ORANGE) Error shape (§1.6) needs one constraint — added status?: string and context?: Record<string, unknown>. Problem: unbounded string + unknown = entropy. Fix: add soft constraint — status values MUST be namespaced (e.g. missing_connection, rate_limited) and treated as stable identifiers, not free text.

Minor tightenings:
1. Cleanup verification — make explicit: add helper assertNoRowsForRunId(runId). Prevents copy-paste query drift.
2. Test flake detection — already require 5 reruns. Add: fail fast on first flake, do not average results.
3. HMAC assertion — good call not duplicating logic. Add: test must fail if header missing, not just mismatch.

Final verdict: Ready with minor tightening (no redesign required). High-quality spec; risks all execution-layer, not conceptual. If fix only 3: DB isolation contract, provider registry restore safety, double-approve test adds DB-side uniqueness assertion.

Meta insight: spec is formalising external side-effects as verifiable contracts (LLM calls → LAEL events + payload rows; approvals → exactly-one dispatch). Tests become system invariants.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | DB isolation contract — add invariant for tx rollback OR hard scoping key + pre-test cleanup guard; AC: idempotent suite re-runs | technical | apply | auto (apply) | high | Real flake-risk class; addresses the existing §1.3/§1.4 step-4 gap; mechanical addition of an internal contract with no user-visible impact |
| 2 | Provider registry safety — register stores previous adapter; restore restores exactly that; finally-restore mandatory; AC: same-key sequential + parallel non-interference | technical | apply | auto (apply) | high | Tightens §1.2 step 3 internal contract; auto-applies — internal adapter-registry mechanics, not user-visible |
| 3 | Double-approve test — add DB-side uniqueness assertion (one row in dispatch log / event with dispatch_source='approval_resume'), not just webhook callCount | technical | apply | auto (apply) | high | Protects against webhook-layer false-pass; mechanical addition to existing Test 2 assertions; internal observability detail |
| 4 | Webhook harness — add setDropConnection(boolean) | technical | apply | auto (apply) | medium | Small surface addition (one method on a test fixture); avoids future harness churn; internal test-fixture surface, not user-visible |
| 5 | LAEL test — explicit invariant: no other llm.* events between requested and completed for same runId | technical | apply | auto (apply) | medium | Strengthens existing assertion; mechanical addition to internal test contract |
| 6 | Failure-path decision (§1.5) — partial provider response edge case: persist if structurally valid | technical | apply | auto (apply) | medium | Resolves an edge-case gap in the §1.5 Option A contract; the internal payload-row semantics on partial response are an internal contract decision, not visible to end users |
| 7 | Error shape (§1.6) — status values namespaced and stable; not free text | technical | apply | auto (apply) | medium | Tightens §1.6 Option A contract for internal type discipline; not user-visible (these errors flow into AutomationStepError consumed by internal handlers, not displayed verbatim) |
| M1 | Cleanup verification — assertNoRowsForRunId(runId) helper | technical | apply | auto (apply) | low | Mechanical test-helper addition; reduces query drift; internal test infra |
| M2 | Test flake detection — fail fast on first flake, do not average | technical | apply | auto (apply) | low | Strengthens existing 5-rerun acceptance criterion; internal test discipline |
| M3 | HMAC assertion — test fails if header missing, not just mismatch | technical | apply | auto (apply) | low | Mechanical assertion strengthening in §1.4 Test 1; internal test contract |

All findings triaged technical — they all concern internal test-harness mechanics, internal contracts (DB isolation, registry behaviour, payload-row shape on edge cases, error-shape vocabulary discipline), and internal test-assertion strengthening. No finding changes how a user, customer, or admin would describe or experience the product. No escalation carveouts triggered: all are apply (no defers), none are critical, none contradict CLAUDE.md / architecture.md / spec-context.md, none change cross-spec contracts in user-visible ways, and I am confident in each fix.

### Applied (auto-applied technical)

- [auto] §0.2 Testing posture: added DB-isolation invariant (per-test tx rollback OR hard-scoping-key + pre-test cleanup guard) plus suite-rerun idempotency invariant
- [auto] §1.2 Approach step 3: tightened registry contract — register stores previous adapter, restore restores exactly that, finally-restore mandatory; AC strengthened to cover same-key sequential + parallel non-interference
- [auto] §1.4 Test 2: added DB-side uniqueness assertion alongside receiver.callCount === 1
- [auto] §1.1 Approach + AC: added setDropConnection(boolean) method on FakeWebhookReceiver
- [auto] §1.3 Test 1: added explicit no-interleaving invariant — no other llm.* events for the same runId between requested and completed
- [auto] §1.5 Option A: added partial-response semantics — response is null only when no usable provider output exists; partial output is persisted if structurally valid
- [auto] §1.6 Option A: status values must be namespaced stable identifiers, not free text
- [auto] §1.3/§1.4: assertNoRowsForRunId(runId) helper convention added; cleanup queries route through it
- [auto] §2 pre-merge gates: fail-fast-on-first-flake added; do not average across 5 reruns
- [auto] §1.4 Test 1: HMAC assertion fails if header missing AND if header mismatches

---

## Round 2 — 2026-04-28T06-30-00Z

### ChatGPT Feedback (raw)

Executive summary: Round 1 improvements landed exactly where they should have. The spec has crossed the threshold from "tests exist" to "tests are hard to lie to." No blockers. Edge-case correctness gaps and future-fragility traps remain — none requiring scope expansion, but tightening them now will prevent subtle false-passes and long-tail flakiness.

What materially improved: DB isolation now correctly enforced; registry safety properly scoped (parallel-safe, not just sequential); double-approve invariant truly protected by HTTP-layer + DB-layer combination; failure-path payload decision complete (null vs partial); error-typing discipline strong enough (KNOWN_AUTOMATION_STEP_ERROR_STATUSES is the right compromise).

Round 2 findings (all technical, all optional but high leverage):
1. Missing transaction boundary assertion. Asserts rows exist + ordering correct, but never atomicity. A future regression could write payload but fail before event write — tests still pass depending on query order. Tighten §1.3 Test 1: assert `count(payload rows for runId) === 1`, that row referenced by event, AND no orphan payload rows exist for this runId.
2. Sequence invariant slightly under-specified. "No interleaving llm.* events" misses non-llm.* events inserted between them. Tighten: "exactly two rows in sequence window — llm.requested followed immediately by llm.completed."
3. Webhook receiver missing header normalisation. Node HTTP headers are case-insensitive and sometimes arrays. Tests may become brittle (X-Signature vs x-signature). Specify: "Headers MUST be normalised to lowercase keys, multi-value headers joined with `,`."
4. Drop-connection behaviour needs one clarification. Edge: what if body hasn't fully streamed yet? Specify: "Request body MUST be fully read before recording the call OR before dropping the connection."
5. Provider adapter latency-semantics ambiguity. Is latency before call? after? includes error? Define: "Latency applied before resolving or rejecting; applies equally to success and error paths."
6. Parallel test guarantee implied, not asserted. Add explicit invariant: harness self-test MUST include a parallel execution case where two adapters are registered, invoked, and restored concurrently and each adapter observes only its own calls.
7. Cleanup helper silent-delete risk. A bug could match too broadly and delete unrelated rows — test still passes. Add: helper MUST assert all deleted rows match provided runId AND throw if rows outside scope would be affected.
8. Approval Test 3 (reject) missing negative dispatch assertion. Risk: dispatch happens but fails before HTTP → not visible. Add: also assert no DB dispatch row exists for this stepRunId. Symmetry with Test 2.
9. Failure-path token-semantics edge case. Provider returns usage metadata but no content. Clarify: token counts MUST reflect provider-reported usage even if no assistant content present.
10. Suite-rerun "identical results" ambiguous. Define explicitly: all tests pass + row counts per table identical + no residual rows for prior runIds.

Final verdict: Ready to commit after minor tightening. Spec is moving from "tests that check behaviour" to "tests that enforce invariants across layers." Strategic observation: this spec is quietly establishing a testing standard for the system — external dependency harnesses, DB-backed invariants, dual-layer assertions (event + side-effect), failure-path observability. Reusing this pattern consistently produces a system where regressions are structurally hard to hide.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | §1.3 Test 1 atomicity (count=1, referenced, no orphans) | technical | apply | auto (apply) | medium | Closes the "rows exist + ordered" → "rows committed atomically" gap; makes the §1.5 Option A "ledger and payload commit together OR roll back together" claim actually testable; no user-visible impact |
| 2 | Sequence invariant strengthened — exactly two rows in window, no other event_types | technical | apply | auto (apply) | medium | Closes a future-leakage class; same internal contract scope as round 1's interleaving invariant |
| 3 | Webhook header normalisation (lowercase keys, multi-value join) | technical | apply | auto (apply) | medium | Removes a brittleness class in HMAC assertions; internal harness contract |
| 4 | Drop-connection: body fully read before record/drop | technical | apply | auto (apply) | medium | Eliminates "partial body recorded → assertions later silently pass" failure mode; internal harness invariant |
| 5 | Provider adapter latency applies before resolve/reject and equally to success+error | technical | apply | auto (apply) | low | Locks down ambiguous timing semantics; tightens internal harness contract |
| 6 | Mandate parallel-execution adapter registry self-test (not optional) | technical | apply | auto (apply) | low | Makes the parallel non-interference guarantee a test, not a spec sentence — consistent with round 1's "tests enforce invariants" direction |
| 7 | Cleanup helper scope-safety: assert all deletes match scoping key, throw on out-of-scope | technical | apply | auto (apply) | medium | Defends against silent broadened-predicate regressions in the cleanup helper that would mask test failures behind DB corruption; internal test infra |
| 8 | §1.4 Test 3 reject — also assert no DB dispatch row | technical | apply | auto (apply) | medium | Symmetric with Test 2's positive-dispatch assertion; closes the "dispatch attempted then crashed" failure mode for the reject path |
| 9 | Failure-path tokens reflect provider-reported usage even when content empty | technical | apply | auto (apply) | low | Prevents a "free regression" where empty-content failures silently record zero cost; extends §1.5 Option A acceptance text + adds a fourth pure-test case |
| 10 | Suite-rerun "identical results" defined as 3-part check (pass + counts + zero residuals) | technical | apply | auto (apply) | medium | Removes interpretation drift on a load-bearing acceptance criterion; same internal-contract scope |

All 10 findings triaged technical — all concern internal test-harness mechanics, internal observability contracts, and internal test-assertion strengthening. None change how a user, customer, or admin would describe or experience the product. No escalation carveouts: all are apply (no defers), none are critical/high (round 2 themes are edge cases on round 1's structural fixes), none contradict CLAUDE.md / architecture.md / spec-context.md, none change cross-spec contracts in user-visible ways. Confident in each fix.

### Applied (auto-applied technical)

- [auto] §1.3 Test 1: added atomicity invariant — `count(payload rows) === 1` for runId AND row referenced by event AND no orphan payload rows
- [auto] §1.3 Test 1: strengthened no-interleaving invariant — no event of ANY event_type in the [N, N+1] sequence window (was: no other llm.* events)
- [auto] §1.1 FakeWebhookCall: header-normalisation rule documented on the type (lowercase keys, multi-value joined with `, `)
- [auto] §1.1 Implementation: body-fully-read invariant — body read to completion before record-or-drop decision
- [auto] §1.1 AC + self-test: header-normalisation and body-fully-read added as load-bearing AC items
- [auto] §1.2 AC: latency semantics — applied before resolve/reject, equally to success and error paths; added latency-on-error self-test
- [auto] §1.2 AC: same-key non-interference now mandates BOTH sequential AND parallel self-test variants (parallel is required, not optional)
- [auto] §1.2 self-test step 6: includes setError+setLatencyMs combination test, sequential and parallel non-interference tests
- [auto] §1.3 step 4a (assertNoRowsForRunId): scope-safety invariant — pre-flight SELECT verifies all matched rows match scoping key, post-flight asserts DELETE row count matches SELECT count, throws on out-of-scope match
- [auto] §1.4 Test 3: added DB-side negative-dispatch assertion (zero rows in dispatch audit channel for this stepRunId), symmetric with Test 2
- [auto] §1.5 Option A: added usage-without-content edge case — token counts reflect provider-reported usage even when assistant content is empty; extended AC + added pure test case 4
- [auto] §0.2: defined "identical results" as a three-part check — (1) all tests pass on both runs, (2) row counts per affected table identical between run 1 and run 2 end-states, (3) zero residual rows for either run's scoping keys
- [auto] §2 pre-merge gate: suite-rerun idempotency now points at the §0.2 explicit definition

### Integrity check

Integrity check: 0 issues found this round. Verified:
- §1.3 step 4a's scope-safety language is internally consistent with the helper's documented behaviour in §1.3 (Cleanup) and §1.4 step 4 / step 5 (cleanup reuse).
- §1.5 Option A acceptance criteria (4 bullets) and the §1.5 Tests block (4 cases) are 1:1 — every AC has a corresponding pure test case.
- §1.1 acceptance criteria mention header normalisation + body-fully-read; the Implementation block defines them; the self-test exercises them — three-way consistent.
- §1.2 acceptance criteria mention parallel non-interference as mandatory; the self-test step lists the parallel variant; the registration contract in step 3 explains how prior-state capture makes it work — consistent.
- §1.4 Test 3 DB-side assertion references "the dispatch audit channel used in Test 2" — Test 2 still defines that channel; reference resolves.
- §0.2 "identical results" 3-part definition is referenced by §2 pre-merge gate — both blocks now use the same definition.
- Round 1's KNOWN_AUTOMATION_STEP_ERROR_STATUSES tuple, namespaced-status discipline, partial-response semantics, fail-fast-on-flake gate, and assertNoRowsForRunId helper are all still present and unbroken by round 2 edits.
- Round 2's parallel self-test mandate (§1.2) and the parallel registration concurrency-safety language in step 4 are consistent (step 4 retains the rationale; AC + self-test now require the test).

