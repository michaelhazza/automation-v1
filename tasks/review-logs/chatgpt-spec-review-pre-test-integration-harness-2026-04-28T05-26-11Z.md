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

