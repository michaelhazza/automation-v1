# ChatGPT Spec Review Session — phase-A-1-2-spec — 2026-04-26T01-28-32Z

## Session Info
- Spec: tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md
- Branch: claude/add-system-monitoring-BgLlY
- PR: #202 — https://github.com/michaelhazza/0/pull/202
- Started: 2026-04-26T01:28:32Z

---

## Round 1 — 2026-04-26T01-28-32Z

### ChatGPT Feedback (raw)

```
Executive Summary

You're very close to a production-grade spec. The structure, gating discipline, and failure-mode awareness are already at a high level. What's left is tightening enforcement guarantees, edge-case handling, and operational reality under load and multi-tenant conditions.

The main gap is not missing features, it's ensuring that what's defined actually holds under stress, concurrency, and partial failure.

1. What's Strong (Keep As-Is)
- Binary CI gates as Definition of Done
- Explicit rejection + defer tracking
- RLS + principal context discipline
- "No cross-item scope expansion" rule
- Explicit fallback contracts (e.g. regex → AST)

2. Gaps That Will Bite Later (High Priority Fixes)

2.1 Missing "Failure Mode Table" Per Critical Component
You describe constraints, but not always what happens when they fail. You need a lightweight table like:
Component: PrincipalContext propagation
Failure Mode | Detection Signal | System Behaviour
Missing context | RLS violation / empty result | Hard fail + ERROR log
Incorrect orgId | Cross-tenant read anomaly | Block + audit log
Partial propagation | Mixed scoped/unscoped queries | Reject request

2.2 No Explicit "Partial Success Contract"
You've got strong rules for success/failure, but not for: "What does the system return when 60% of the job succeeded?"
Need: Structured partial result shape: { status: "partial_success", completed: [...], failed: [...], skipped: [...] }
Rules for: Retry eligibility, UI rendering, Downstream agent consumption

2.3 Idempotency Is Implied, Not Enforced Everywhere
Need a global invariant: Every externally-triggerable action MUST be idempotent via a deterministic key.
Include: Job execution, Skill invocation, Webhook handling, Retry paths.
Define: Key format standard (e.g. agentId:taskId:stepId), Where it is stored, Expiry rules.

2.4 Concurrency + Race Conditions Not Fully Locked
Missing: Concurrent agent runs on same resource, Duplicate webhook delivery, Retry overlapping with original execution.
Need explicit rules: "Last-write-wins" vs "reject if stale", Advisory locks vs optimistic concurrency, Deduplication window definitions.

2.5 Observability Is Good, But Not Queryable Enough
Need: Structured, Queryable by orgId / agentId / jobId / runId.
Add a rule: Any log used as a metric MUST include queryable dimensions.

3. Medium Priority Improvements

3.1 Define "Stuck State" Detection Globally
Bake it into the spec: Max turns reached, Identical outputs across runs, Tool-only final message, Runtime > X threshold.
Define: Detection, Escalation path, Auto-recovery vs human intervention.

3.2 Enforce Output Contract Strictness
No free-form responses for system agents. Every agent output must match a schema. Include versioning for schemas.

3.3 Migration Safety Needs Rollback Path
Missing: What if migration succeeds but breaks runtime? Add: Rollback strategy, Data compatibility guarantees, Feature flag or shadow mode enforcement.

3.4 "Final Line Must Be [GATE]" Is Good, But Fragile
Improve with: Structured output field instead of relying purely on text position, Or dual validation (text + structured flag).

4. Low Priority / Polish
4.1 Terminology Locking — Add a one-page glossary with hard definitions for: Agent, Skill, Job, Run.
4.2 Remove Any Remaining "Implicit Behaviour" — Make it explicit, especially around: retries, failures, defaults.

5. What You Should NOT Add
Avoid: more modules, more abstraction layers, expanding scope into "future system ideas".

6. Final Verdict
Status: 90–95% production-ready. Before finalising, only require:
- Failure mode tables for critical systems
- Global idempotency rule + enforcement
- Partial success contract
- Concurrency + race condition rules
- Structured observability requirements
```

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| 2.1 Failure mode tables for critical components (PrincipalContext, recordIncident, sweep, baseline, triage) | technical | apply | auto (apply) | high | Strengthens internal contracts; spec lists detection + behaviour scattered across §4.3, §4.4, §9.2; consolidating per-component failure-mode tables clarifies what callers/operators do on each failure. Internal clarity, not user-visible. |
| 2.2 Structured partial-success contract for sweep + synthetic-checks tick | technical | apply | auto (apply) | medium | Sweep runs N heuristics across N candidates; synthetic-check tick runs 7 checks; a partial fail today isn't formally specified. Internal API/contract clarification — neither return type is user-visible. |
| 2.3 Global idempotency invariant + key format standard for triage / sweep / synthetic / feedback / baseline-refresh / recordIncident | technical | apply | auto (apply) | high | Spec already enforces idempotency in most places (§4.1, §8.1, §9.2, §9.3, §9.8, §10.4) but the key format is ad-hoc. A consolidated subsection that names the key-format conventions + storage + TTL across all externally-triggerable jobs is internal-only and high-value. |
| 2.4 Concurrency / race-condition rules: triage vs sweep on same incident, baseline refresh overlap, feedback double-submit, throttle map race | technical | apply | auto (apply) | high | Spec has pieces (§9.2 singletonKey, §9.3 idempotency keys, §10.4 409 on second feedback) but no consolidated "concurrency rules" section. Internal contract — non-user-facing. |
| 2.5 Structured-log dimensions invariant (correlationId / incidentId / entityKind / entityId / heuristicId on all metric-bearing log lines) | technical | apply | auto (apply) | medium | §12.3 already states this informally ("Required context keys per call: correlationId, incidentId, entityKind/entityId"). Promote it from "convention" to enforced invariant + name the queryable dimensions explicitly. Internal observability. |
| 3.1 Global stuck-state detection rule (max turns, identical outputs, tool-only final message, runtime threshold) for the system_monitor agent itself | technical | apply | auto (apply) | medium | Spec has heuristics that detect stuck states in OTHER agents (§9.5 max-turns-hit, repeated-skill-invocation, final-message-not-assistant) but doesn't apply the same detection to system_monitor's own agent run. Adding a "monitor-self stuck-state" gate is internal hardening — not user-facing. |
| 3.2 Output contract strictness + versioning for write_diagnosis / write_event payloads | technical | apply | auto (apply) | medium | Spec has shape contracts (§9.4, §9.8, §11.2 metadata) but no explicit schema-version stamp on the JSON payloads. Adding `schema_version: 'v1'` to agent_diagnosis JSON + investigate_prompt_outcome metadata is a low-cost forward-compat hedge. Internal schema decision. |
| 3.3 Migration runtime-rollback path / shadow-mode / feature-flag for new schema | technical-escalated ([missing-doc] — contradicts spec-context.md `staged_rollout: never_for_this_codebase_yet` + `migration_safety_tests: defer_until_live_data_exists` + `feature_flags: only_for_behaviour_modes`) | reject | reject | medium | docs/spec-context.md is authoritative: pre-production, commit_and_revert rollout, no feature flags for new migrations. The spec's existing forward-only-with-down-mate (§4.6) + additive-only schema posture is the agreed pattern. Adding shadow-mode / feature-flag wiring contradicts spec-context conventions. |
| 3.4 "Final line must be [GATE]" → structured output field / dual validation | technical | reject | auto (reject) | low | The spec does not use a text-position [GATE] line as its output contract. It uses tool-call-based writes (`write_diagnosis`) with explicit JSON payloads + a separate prompt-validation regex (§9.8). The finding misreads the spec; the structured-write pattern it asks for is already in place. |
| 4.1 One-page glossary (Agent, Skill, Job, Run, Heuristic, Synthetic Check, Sweep, Triage, Baseline, Fingerprint, Incident, Investigate-Fix Protocol) | technical | apply | auto (apply) | low | Pure clarity win. Spec uses these terms heavily and several have specific spec-internal meanings. A short glossary at the top is cheap and prevents reviewer/executor confusion. Internal clarity. |
| 4.2 Remove implicit behaviour — name retry counts / default timeouts / failure recovery for synthetic-check tick, baseline refresh, triage agent run | technical | apply | auto (apply) | low | Several places say "retry" or "fail and continue" without naming counts/timeouts (§8.1 "5s per check", §9.3 "skip and continue", §9.8 "max 2 retries"). Consolidating into explicit defaults table closes the gap. Internal. |

(Round 1: 11 findings — 9 auto-apply, 1 auto-reject, 1 escalated as `[missing-doc]` reject. Zero user-facing. Per protocol: technical findings auto-execute. The escalated `[missing-doc]` reject is surfaced below for transparency but does not require user gate because the rationale is grounded in spec-context.md.)

### Escalated for visibility (no user input required — surfaced for audit)

- **3.3 Migration runtime-rollback / feature-flag** — auto-rejected with `[missing-doc]` rationale. docs/spec-context.md framing locks this out (`staged_rollout: never_for_this_codebase_yet`, `feature_flags: only_for_behaviour_modes`, `migration_safety_tests: defer_until_live_data_exists`). The spec's additive-only / forward-only-with-down-mate posture (§4.6) is the agreed pattern.

### Applied (auto-applied technical findings)

- [auto] Added §0A Glossary (12 terms) — finding 4.1.
- [auto] Added §4.7 Failure mode tables (PrincipalContext, recordIncident, sweep, baseline, triage, synthetic-check tick) — finding 2.1.
- [auto] Added §4.8 Global idempotency invariant + key-format conventions — finding 2.3.
- [auto] Added §4.9 Concurrency + race-condition rules (8 named scenarios) — finding 2.4.
- [auto] Added partial-success contract block in §9.3 — finding 2.2.
- [auto] Added §9.11 Stuck-state detection for the monitor agent itself — finding 3.1.
- [auto] Added schema_version field to write_diagnosis JSON + event metadata in §9.8 + §12.1 — finding 3.2.
- [auto] Added queryable-dimensions invariant block in §12.3 — finding 2.5.
- [auto] Added §12.4 Explicit defaults table (retries, timeouts, failure recovery) — finding 4.2.

### Integrity check

Integrity check: 2 issues found this round (auto: 2, escalated: 0).

- [auto] Missing `## 1. Summary` heading — the glossary edit accidentally swallowed the §1 heading; restored as a mechanical fix (broken structural reference, technical class).
- [auto] §12.1 event-type metadata table did not list new triage-skipped/triage-failed reasons (`self_stuck`) introduced by §9.11; added inline + propagated `schema_version: 'v1'` to the listed metadata columns for `agent_diagnosis_added`, `agent_triage_skipped`, `agent_triage_failed`, `prompt_generated` (consistent with §9.8 schema-version field).

Post-integrity sanity (4c): re-scanned heading list — all top-level sections (§0–§19) present and correctly numbered. No empty sections produced. No broken cross-references introduced. Pass.

---

## Round 2 — 2026-04-26T (resumed session)

### ChatGPT Feedback (raw)

```
Executive Summary

Round 1 landed exactly the right set of fixes. You've closed the major structural risks I called out: failure modes, idempotency, concurrency, partial success, and observability are now explicitly defined. The spec has crossed from "well-structured" to system-defensive.

Round 2 is now about tightening interaction boundaries between those systems, not adding new ones.

Round 2 — Targeted Gaps & Refinements

1. Cross-System Interaction Contracts (High Priority)
You've defined each layer well. What's still implicit is how they behave when combined. Add a short section (~25 lines) §4.10 Cross-Invariant Interaction Rules:
- Idempotency + Retry: Retries MUST reuse the same idempotency key. New key = new logical operation only.
- Concurrency + Idempotency: Concurrent identical requests MUST collapse to one execution. Others return cached/in-progress result.
- Partial Success + Retry: Retry MUST only execute failed components. Completed components MUST NOT re-run.
- Failure Mode + Idempotency: Failed executions MUST still persist idempotency record. Prevents infinite retry loops.
Prevents subtle system drift under real usage.

2. Idempotency Storage + Lifecycle (High Priority)
You defined the invariant and key format. Missing: Where it lives, how long it lives, how it is cleaned up. Add:
- Storage: Table or cache (must be explicit)
- TTL: e.g. 24h default, overrideable by job type
- Cleanup: Background sweep or TTL expiry
- Collision handling: What happens if key already exists but payload differs?
Without this, idempotency becomes unreliable under scale.

3. "In-Progress" State Semantics (High Priority)
You defined success/failure/partial. Missing: What happens while something is running? Add explicit state:
- status: 'in_progress'
- Required metadata: startedAt, lastHeartbeatAt, progress (optional but defined)
- Behaviour: Duplicate requests during in-progress → return current state, do NOT re-execute

4. Heartbeat + Liveness Contract (High Priority)
You mentioned stuck detection, but not how liveness is proven. Add:
- Heartbeat interval rule (e.g. every N seconds or per step)
- Timeout rule (No heartbeat for X = considered stalled)
- Recovery: Mark as status: 'stalled', Eligible for retry or manual intervention

5. Schema Evolution Rules (Medium Priority)
You added schema_version. Now define:
- Backward compatibility: v1 readers MUST tolerate unknown fields
- Forward compatibility: New versions MUST NOT remove required fields without version bump
- Migration rule: Old records must remain readable without transformation

6. Log Volume / Cost Guardrails (Medium Priority)
You require queryable logs (good). Missing: What prevents this from exploding cost or noise? Add:
- Sampling rules for INFO logs and high-frequency events
- Always log: ERROR, WARN, State transitions
- Optional: DEBUG gated by environment

7. Monitor Agent Escalation Path (Medium Priority)
You added stuck detection for the monitor itself. Now define what it actually DOES when something is wrong. Add:
- Severity levels: INFO, WARN, CRITICAL
- Actions: WARN → log + surface in dashboard. CRITICAL → trigger alert / block downstream execution
- Optional: Auto-remediation rules (if simple and deterministic)

8. Deterministic Ordering Guarantees (Low-Medium Priority)
In multi-agent + concurrent systems, one rule:
- When order matters: Must be explicitly defined (e.g. FIFO, timestamp order)
- When it doesn't: System MUST treat operations as commutative

9. "No Silent Fallback" Rule (Low Priority but High Value)
Tighten with one invariant:
- Any fallback MUST emit a structured log with reason.
```

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| 1. Cross-system interaction contracts (Idempotency × Retry, Concurrency × Idempotency, Partial Success × Retry, Failure Mode × Idempotency) — new §4.10 | technical | apply | auto (apply) | high | Internal contract consolidation across §4.7/§4.8/§4.9/§9.3. Genuine gap — each axis is defined alone, the interactions are implicit. New §4.10 names them explicitly. |
| 2. Idempotency storage + lifecycle + cleanup + collision handling | technical | apply | auto (apply) | high | §4.1 + §4.8 define LRU + key format but not the per-layer storage / lifecycle / collision matrix. Extending §4.8 with an explicit storage-and-collision sub-table closes the gap. Internal contract. |
| 3. In-progress state semantics — duplicate-request behaviour while work in flight | technical | apply (scoped — handler-level only, no new DB column) | auto (apply) | high | Spec covers this implicitly via singleton-key dedup (§4.9.1, §4.9.5); making it explicit as §4.10.6 In-flight duplicate-request semantics ties it to the existing primitives. Explicit "no new DB status column" callout — adding one would be a user-facing surface change (operator UI) and create dual-source-of-truth with `triage_attempt_count` / `agent_diagnosis`. Scoped technical. |
| 4. Heartbeat + liveness contract — interval, timeout, recovery | technical | apply (name existing primitives, no new heartbeat column) | auto (apply) | high | Pg-boss provides job-level heartbeat; `agent_runs.runtime_ms` provides run-level liveness; §9.11 already provides semantic-stuck detection. New §4.10.5 names the three layers explicitly + the stalled-state recovery path. No new primitive added. Internal contract. |
| 5. Schema evolution rules — backward / forward compat + old-record readability | technical | apply | auto (apply) | medium | §9.8 introduced `schema_version: 'v1'` last round; this round formalises the compat contract (readers tolerate unknown, writers don't drop required fields without bump, old rows readable indefinitely). Internal JSON-payload contract. |
| 6. Log volume / cost guardrails — sampling rules + always-on tiers | technical | apply | auto (apply) | medium | §12.3 had a volume estimate but no sampling rule. Adding the always-on-tier table + the high-frequency-info sampling posture closes the cost-guardrail gap. Internal observability. |
| 7. Monitor agent escalation path — severity levels + actions + (optional) auto-remediation | technical | partial-apply (severity ladder) + reject (auto-remediation) | auto (mixed) | medium | Severity ladder (single-run = WARN; cross-run pattern = CRITICAL via existing synthetic check) is a clarification of existing graduated response — apply. Auto-remediation contradicts §9.11's explicit "No auto-recovery" decision and would cross into Phase 3 scope (§19.2 auto-remediation is the Phase 3 deliverable). Reject the auto-remediation portion; explain inline. Internal architecture defence. |
| 8. Deterministic ordering guarantees — declare per-path FIFO vs commutative | technical | apply | auto (apply) | medium | Adds §4.9.9 Deterministic ordering guarantees with per-path table. Closes a hidden assumption surface — every new path must declare its bucket. Internal. |
| 9. No silent fallback rule — every fallback emits structured log with reason | technical | apply | auto (apply) | low | One-paragraph invariant in §12.3 with concrete enforcement points already in §4.7 failure-mode tables. Internal observability invariant. |

(Round 2: 9 findings — 9 auto-apply, 0 reject, 0 deferred, 1 partial-mixed [severity ladder applied + auto-remediation portion rejected]. Zero user-facing. Zero `[missing-doc]` escalations.)

### Applied (auto-applied technical findings)

- [auto] Added §4.10 Cross-invariant interaction rules — six subsections (§4.10.1–§4.10.6) covering Idempotency × Retry, Concurrency × Idempotency, Partial Success × Retry, Failure Mode × Idempotency, Heartbeat × Liveness × Stalled-state, In-flight duplicate-request semantics — finding 1, 3, 4.
- [auto] Extended §4.8 with Storage / Lifecycle / Cleanup / Collision-handling table per idempotency layer + explicit "no persistent idempotency store" rationale + Schema evolution rules (backward / forward compat + old-record readability + version-bump trigger) — findings 2, 5.
- [auto] Added §4.9.9 Deterministic ordering guarantees per-path table — finding 8.
- [auto] Extended §9.11 with severity ladder for self-stuck signals (single-run WARN tier vs cross-run CRITICAL tier) + explicit "no auto-remediation" rationale (Phase 3 scope) — finding 7 (apply portion). Auto-remediation portion of finding 7 rejected: contradicts §9.11's existing "No auto-recovery" architectural decision; would cross into Phase 3 scope.
- [auto] Extended §12.3 with log-level + sampling rules table (errors/warns/state-transitions never sampled; high-frequency info sampled at first + every-Nth; debug gated by env) + No-silent-fallback invariant with concrete enforcement points referencing §4.7 failure-mode tables — findings 6, 9.

### Integrity check

Integrity check: 1 issue found this round (auto: 1, escalated: 0).

- [auto] Off-by-count in §4.10's closing rule line — said "the **four** interaction rules above" but I added six (§4.10.1–§4.10.6). Fixed to "six interaction rules." Mechanical structural fix.

Post-integrity sanity (4c): re-scanned cross-references — §4.7.2 / §4.7.4 / §4.7.5 / §4.7.6 (referenced in §12.3 fallback enforcement points) all present. §4.9.1 / §4.9.2 / §4.9.5 (referenced in §4.10) all present. §4.10.1 (referenced from §4.10.5) present. §9.11 / §10.3 / §19.2 (referenced from §9.11 severity-ladder edit) all present. No empty sections produced. Headings well-formed. Pass.

---

## Round 3 — 2026-04-26T (resumed session, round 3)

### ChatGPT Feedback (raw)

```
Executive Summary

Round 2 is strong. You've now closed the system interaction layer, which is where most real-world failures actually occur. At this point, the spec is no longer just well-defined, it is operationally resilient under concurrency, retries, and scale.

Round 3 is not about adding more systems. It's about eliminating ambiguity in execution boundaries and enforceability.

Round 3 — Final Precision Pass

1. Idempotency Key Scope Enforcement (High Priority)
You defined formats and lifecycle well. One remaining ambiguity: What guarantees that different operations don't accidentally share a key?
Add a strict invariant: Idempotency keys MUST include: operation_type, scope, unique input fingerprint.
Explicit rule: Same key across different operation types = INVALID. Collision behaviour: Same key + different payload → MUST throw (not reuse).

2. Input Fingerprinting Definition (High Priority)
You reference idempotency + retries, but not: How is "same request" actually determined?
Add: Canonical fingerprint rule (deterministic serialization, sorted keys, no null noise). Hash function: implementation-agnostic, but must be stable. Explicit exclusions: timestamps, request_ids, transient metadata.

3. Retry Budget + Termination Rules (High Priority)
You define retry behaviour, but not limits. Add: Max retry count OR time-based budget. Backoff strategy: exponential or fixed, but explicitly stated. Terminal state: status: 'failed_permanent'. Rule: After terminal state, system MUST NOT retry automatically.

4. Partial Success Data Contract Tightening (High Priority)
You added partial success. Now enforce structure. Required fields: status, succeeded, failed, retryable, non_retryable.
Rule: Every failure MUST be classified as retryable or non-retryable.

5. "Single Source of Truth" Clarification (Medium Priority)
Multiple layers storing state: idempotency, work-product, logs. Add one rule — which one is authoritative?
Work-product rows = source of truth for outcome. Logs = diagnostic only. Idempotency store = execution control only.

6. Time Semantics Standardisation (Medium Priority)
All timestamps MUST be UTC, ISO 8601. Ordering rule: server-generated timestamps only; never trust client time.

7. "At-Least-Once vs Exactly-Once" Explicit Model (Medium Priority)
Execution model = at-least-once delivery. Outcome guarantee = effectively exactly-once via idempotency.

8. Backpressure / Load Shedding Rule (Medium Priority)
If system exceeds queue depth OR latency threshold, then MUST: reject new work OR defer with explicit status: 'rejected_over_capacity'.

9. Versioned Contract for Monitor Outputs (Low-Medium Priority)
Monitor output MUST include schema_version: 'v1'. Rule: Consumers MUST branch on version if changed.

10. CI Enforceability Hook (Low Priority, High Leverage)
Add one line per major invariant category: "This invariant MUST have a corresponding CI test or gate."

What to Watch For (Subtle Risk)
You are now approaching over-specification risk. Signs to avoid: duplicating the same rule in multiple sections, introducing alternative wording for the same invariant, adding "just in case" clauses. If something is already defined once, reference it, don't restate it.

Final Verdict
After Round 3, you'll have a spec that is extremely difficult to break in practice. Recommended Next Step: Run Round 3. After that, do a consistency + deduplication pass only, then lock the spec and move to implementation.
```

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| 1. Idempotency key scope enforcement (operation_type + scope + identity component; cross-operation collision INVALID; same-key-different-payload MUST throw) | technical | partial-apply (structural rule) + reject (per-action restatement) | auto (mixed) | high | Per-action key formats already in §4.8 table embed operation_type + scope (`system`) + identity (e.g. `synthetic:<check_id>:<resourceId>:<bucketKey>`). Collision behaviour already spelled out in §4.8 storage table. The structural invariant — that this composition is the rule, not a coincidence — is implicit and worth naming once. Apply as one paragraph; do not duplicate the table. |
| 2. Input fingerprinting via canonical JSON serialisation + stable hash (exclude timestamps / request_ids) | technical | reject | auto (reject) | medium | Already covered, structurally. §4.8 keys are constructed from named structured inputs (`incidentId`, `candidateId`, `bucketKey`); there is no "serialize the payload + hash" step because the components themselves are canonical. Adding JSON-canonicalisation would be a new failure surface (sort-order bugs, transient-field exclusion bugs) for zero benefit on the surface area this spec defines. The §4.8 structural-rule paragraph (finding 1) makes this explicit by stating "no payload-hash step." |
| 3. Retry budget + termination rules (max retry count, backoff strategy, terminal state, no-auto-retry-after-terminal) | technical | reject | auto (reject) | medium | Already covered in §12.4 (pg-boss retry count = 3, exponential backoff inherited, "no retry past the documented count" rule, DLQ as terminal) + §9.8 (max 2 retries for prompt validation) + §9.9 (rate-limit cap = 2/fingerprint/24h as terminal for triage) + §4.7.5 (`agent_triage_failed` event written at terminal). Adding a `failed_permanent` status would duplicate `agent_triage_failed` (which already encodes terminal-failure with a `reason` field). Per ChatGPT's own over-specification warning, this is a restatement. |
| 4. Partial-success contract — explicit `succeeded` / `failed` / `retryable` / `non_retryable` fields | technical | partial-apply (clarifying note) + reject (per-pair retryable field) | auto (mixed) | medium | §9.3's `SweepResult` already has `fired` (succeeded), `errored` (failed), `suppressed`, `insufficient_data`, `capped`. Adding per-pair `retryable`/`non_retryable` would be misleading because every errored pair is structurally retryable on the next 5-min tick (overlapping window). Apply: a clarifying paragraph in §9.3 stating the structural retryability rule + naming the upstream guardrails (rate limit, throttle, audit-row dedup) that bound retries. Reject: introducing the per-pair classification field. |
| 5. Single source of truth clarification (work-product / logs / idempotency rank) | technical | apply | auto (apply) | medium | Genuine gap — the spec has all three layers but doesn't name the authoritative ranking. Adding §4.10.7 with the four-layer hierarchy (work-product / events / idempotency / logs) closes the "where do I read X from?" decision per-caller. Internal contract. |
| 6. Time semantics — UTC, ISO 8601, server-generated only | technical | apply | auto (apply) | medium | The codebase already follows the convention (Postgres `NOW()`, server-issued sequence numbers per §4.9.9), but it's not stated in this spec. Restating once + applying to new paths in this spec prevents drift (e.g. a client-supplied `resolved_at` accidentally passing through). Adding §4.10.8. Internal convention. |
| 7. At-least-once vs exactly-once delivery/outcome model | technical | apply | auto (apply) | medium | Spec mentions "at-least-once" once (§4.9.7 webhooks) but doesn't name the overall model. Naming both halves explicitly — at-least-once delivery, effectively-exactly-once outcome via idempotency — anchors the operational model. Adding §4.10.9. Internal contract. |
| 8. Backpressure / load shedding rule (`rejected_over_capacity` status under overload) | technical | partial-apply (cap-signal table) + reject (`rejected_over_capacity` status) | auto (mixed) | medium | Spec already has caps + signals: sweep_capped (§9.3), triage_rate_limited (§9.9), throttle/idempotency-LRU evictions (§4.7.2), pg-boss-queue-stalled / dlq-not-drained (§8.2). The cap-signal events ARE the load-shedding mechanism. Apply: §4.10.10 names the existing caps + signals + the cross-cutting rule "no silent drop under load." Reject: introducing a `rejected_over_capacity` status — would create a third source of truth (per §4.10.7) that duplicates the existing cap-signal events. |
| 9. Versioned contract for monitor outputs — schema_version + version-branching | technical | reject | auto (reject) | low | Already covered in §9.8 (`schema_version: 'v1'` on all agent-emitted JSON), §12.1 metadata column (every event row carries `schema_version: 'v1'`), §4.8 schema-evolution rules added in Round 2 (readers tolerate unknown / dispatch on version / old rows readable indefinitely). Restating would be the over-specification ChatGPT warned about. |
| 10. CI enforceability hook — "this invariant MUST have a CI test or gate" tag per major invariant | technical | reject | auto (reject) | low | Contradicts §12.3 explicit posture: "No CI gate enforces dimension presence (the static-gates posture per spec-context.md does not extend to log-format linting). The convention is documented + reviewed in PRs." Per spec-context.md `runtime_tests: pure_function_only` + `testing_posture: static_gates_primary`, the spec already names CI gates where they apply (§4.7.1 RLS gate, §4.8 idempotency-key gate, §14 static gates). A blanket "every invariant must have a gate" tag would either be ignored (most invariants are documented conventions) or force test-infrastructure work that contradicts spec-context's deferral posture. |

(Round 3: 10 findings — 4 auto-apply [1 partial, 1 partial, 1 full, 1 full + 2 partials = 4 distinct application actions], 4 auto-reject, 0 deferred, 0 user-facing, 0 escalations. Per ChatGPT's own over-specification warning, the reject ratio is high by design — most findings restated already-covered rules.)

### Applied (auto-applied technical findings)

- [auto] Added structural-rule paragraph + cross-operation-collision rule + same-key-different-payload rule + "why no payload fingerprinting" rationale to §4.8 — finding 1 (apply portion). Findings 2 (reject) is referenced inline in the new "no payload-hash step" rationale.
- [auto] Added §4.10.7 Source-of-truth hierarchy (4-layer ranking: work-product / events / idempotency / logs) + cross-cutting rule "when two layers disagree, work-product wins" — finding 5.
- [auto] Added §4.10.8 Time semantics (UTC, ISO 8601, server-generated, never trust client time, applied to DB / logs / events / API responses) — finding 6.
- [auto] Added §4.10.9 Delivery vs outcome model (at-least-once delivery + effectively-exactly-once outcome via idempotency, with the "no exactly-once delivery attempts" callout) — finding 7.
- [auto] Added §4.10.10 Backpressure / load-shedding (table of existing caps + their signal events + cross-cutting "no silent drop under load" rule + "why no rejected_over_capacity status" rationale referencing §4.10.7 source-of-truth hierarchy) — finding 8 (apply portion).
- [auto] Added per-pair-retryability clarification paragraph to §9.3 partial-success contract (errored pairs retry implicitly via next tick; no per-pair `retryable`/`non_retryable` field; upstream guardrails are the actual retry bounds) — finding 4 (apply portion).
- [auto] Updated §4.10 opener (subsection-roadmap line "ten subsections cover...") + closing rule line ("ten interaction rules" replacing prior "six") — count update consequent to the four new subsections.

### Integrity check

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

Cross-references introduced this round: §4.10.7 (referenced from §4.10.10 "rejected_over_capacity" rationale) — present. §4.7.2 / §9.3 / §9.9 / §8.2 / §4.1 / §4.2 / §12.1 (referenced in §4.10.10 cap table) — all pre-existing, all present. §4.6 / §4.8 inherited fingerprint reference (in §4.8 structural-rule paragraph) — present. §11.2 `metadata.resolved_at` reference (in §4.10.8) — present. §4.9.7 (in §4.10.9) — present. §12.3 no-silent-fallback rule (in §4.10.10) — present. §12.4 retry counts (in finding 3 rationale, not in spec body) — present. §9.8 schema-version (in finding 9 rationale) — present. §12.1 schema_version metadata (in finding 9 rationale) — present.

Post-integrity sanity (4c): re-scanned section structure — §4.10 now has ten subsections (§4.10.1-§4.10.10), opener and closing rule both reference "ten" consistently, no empty subsections, no broken cross-references. §4.8 structural rule paragraph is additive (no removal of prior content), key-format table preserved. §9.3 retryability paragraph is additive (no removal of prior partial-success contract). Pass.

