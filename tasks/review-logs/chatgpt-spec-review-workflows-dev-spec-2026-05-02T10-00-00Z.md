# ChatGPT Spec Review Session — workflows-dev-spec — 2026-05-02T10-00-00Z

## Session Info
- Spec: docs/workflows-dev-spec.md
- Branch: claude/workflows-brainstorm-LSdMm
- PR: #252 — https://github.com/michaelhazza/automation-v1/pull/252
- Mode: manual
- Started: 2026-05-02T10:00:00Z
- **Verdict:** APPROVED (4 rounds; 15 applied / 30 rejected / 10 deferred)

---

## Round 1 — 2026-05-02T10:00:00Z

### ChatGPT Feedback (raw)

Executive summary: The spec is very strong and buildable. 4 critical gaps, 6 medium risks.

🔴 Critical gaps (fix before build):
1. Event ordering contract is underspecified (task_sequence allocation under concurrency — allocation semantics, what happens on failed write after allocation)
2. Approval + Ask share gate table but lifecycle differs — /refresh-pool edge case for Ask: submitter in original pool, pool refreshed, submitter no longer in pool but submits after refresh
3. Cost tracking source of truth is ambiguous — existing cost-reservation table cited but actual cost source (event log? aggregation? reservation ledger?) not pinned; pause logic depends on exact accumulated cost; if cost write fails → step must fail, not be free
4. "Pause between steps" breaks long-running single steps — if a step runs 2h and cap = 1h, system cannot enforce cap; fix: either document as best-effort OR add heartbeat checkpoints

🟡 Medium risks (worth tightening):
5. Approval rejection dominance too blunt — single rejection trumps multiple approvals; suggest adding note it's intentional V1 and may evolve to quorum-based in V2
6. isCritical rejection has no recovery path — user accidentally rejects → entire run dead; suggest documenting future recovery path (manual resume with override)
7. Draft lifecycle can create orphan UX — draft discoverable only from same chat session; user closes tab and comes back later with no visible entry point
8. WebSocket replay assumes infinite retention — no retention policy defined; if events pruned → replay breaks; fix: event retention must exceed max session reconnect window; fallback to full task reload on gap
9. Ask auto-fill can create silent data errors — field renamed → wrong value silently applied; fix: if field key exists but type changed → do not auto-fill that field
10. Diff hunk identity may drift after edits — (from_version, hunk_index) unstable after subsequent edits; suggest content hash to validate identity before revert

🟢 Minor clarifications:
M1. Define max approver pool size (UI + performance guard)
M2. Define max Ask fields per step
M3. Define max files per task before grouping becomes mandatory
M4. Define timeout for /run/resume race window (optional)

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1: Event ordering — task_sequence allocation atomicity | technical | apply | apply (user, "as recommended") | critical | Real contract gap: fan-out + multiple workers → race on sequence allocation. Spec says "extends existing per-run claim pattern" but doesn't specify atomic-allocation invariant, gap-free guarantee, or failed-write behaviour. Replay bugs under load. Escalated due to critical severity. |
| F2: Approval/Ask gate pool refresh eligibility edge case | user-facing | apply | apply (user, "as recommended") | high | Spec explicitly says "/refresh-pool has no effect on existing reviews" for Approval but does NOT define what happens for Ask when original submitter submits after pool refresh removes them. Visible behaviour gap. |
| F3: Cost tracking source of truth | technical | apply | apply (user, "as recommended") | critical | §7.4 cites "existing cost-reservation table (architect verifies)" but doesn't pin: which table is the authoritative accumulator, what happens if the cost write fails (is the step considered free?). Pause logic depends on this. Escalated due to critical severity. |
| F4: Pause between steps — long-running single step exceeds cap | user-facing | apply (Option A) | apply Option A (user, "as recommended") | critical | §7.4 explicitly says pause is "between-step, not mid-step" — this is the right design, but the spec doesn't call out the consequence: a step exceeding the cap is not interruptible. Users setting a 1h cap for a 2h step will be surprised. Option A documents the limitation; consistent with the spec's already-made design choice. |
| F5: Approval rejection dominance note | technical | reject | auto (reject) | medium | §5.1 already says "V1 simplification; V2 may add 'rejection requires N rejecters'". Spec already has the V2 note. Finding is redundant. |
| F6: isCritical rejection — no recovery path | user-facing | apply | apply (user, "as recommended") | medium | §5.2 says "operator's only recovery path is Stop". Spec now documents intent to add a future override/resume path (consistent with the pattern used for other V1 simplifications). |
| F7: Draft lifecycle — orphan UX discoverability | user-facing | apply Option A | apply Option A (user, confirmed after disambiguation) | medium | §10.6 ties draft re-entry to the same chat session (via the "Open in Studio" card). User confirmed Option A (chat session only) on disambiguation — matches brief §3.0 strategic test ("describe intent, don't build systems") and frontend-design-principles "default to hidden". A "Continue from draft" Studio surface lands in a follow-up spec if discoverability becomes a real pain point in production. |
| F8: WebSocket replay — no retention policy | technical | apply | auto (apply) | medium | Genuine missing contract. Replay query `WHERE task_sequence > $lastEventId` will silently return zero rows if events are pruned before the client reconnects. Must define: retention must exceed reconnect window; client must fall back to full task reload on gap detection. |
| F9: Ask auto-fill — type-change silent corruption | user-facing | apply | apply (user, "as recommended") | medium | §11.5 + spec-time decision #10 explicitly chose "no warning on schema change, pre-fill matching keys". ChatGPT's refinement is narrower: if a key exists in both schemas but the TYPE changed (e.g., text → number), pre-filling would silently apply incompatible data. The fix (skip auto-fill for type-mismatched keys) is lightweight, does not add UX friction, and prevents silent corruption. |
| F10: Diff hunk identity drift | technical | reject | auto (reject) | medium | §12.4 already has a concurrency guard: `version_check` (`current_version == from_version + 1`) blocks revert-against-stale-base and returns `409 {base_version_changed}`. Any hunk drift caused by subsequent edits is already caught by this guard. Content hash would be defence-in-depth (YAGNI pre-production). |
| M1: Max approver pool size | technical | defer | defer (user, "as recommended") | low | Valid limit to define. Architect should pick at decomposition. Not a blocking spec gap. Routes to tasks/todo.md. |
| M2: Max Ask fields per step | technical | defer | defer (user, "as recommended") | low | Valid limit to define. Architect should pick at decomposition. Routes to tasks/todo.md. |
| M3: Max files per task before grouping mandatory | technical | defer | defer (user, "as recommended") | low | UI threshold. Architect to pick based on performance profiling. Routes to tasks/todo.md. |
| M4: Timeout for /run/resume race window | technical | defer | defer (user, "as recommended") | low | §19 already captures open extension-cap parameters. Architect-time. Routes to tasks/todo.md. |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] Added event retention invariant to §8.1 — client fallback to full task reload on gap detection (F8)
- [user] Added `task_sequence` allocation invariant to §8.1 — atomic + gap-free per task_id; failed write surfaces `event_log_corrupted` (F1)
- [user] Added Ask vs Approval pool-refresh asymmetry note to §5.1.2 — Ask submits use current snapshot, Approval keeps prior decisions (F2)
- [user] Added cost source of truth + cap-best-effort notes to §7.4 — ledger sum, failed cost-write fails the step, long steps may exceed cap (F3, F4)
- [user] Added V2 isCritical recovery path note to §5.2 — privileged manual resume with override reason (F6)
- [user] Added V1 chat-session-only discoverability note to §10.6 — no Studio "Recent drafts" surface in V1 (F7)
- [user] Amended §11.5 step 3 — pre-fill only when key AND type match; type-mismatched keys treated as new fields (F9)

### Deferred to backlog (routed at finalisation)

- M1: define max approver pool size — architect-time
- M2: define max Ask fields per step — architect-time
- M3: define max files per task before grouping mandatory — architect-time
- M4: timeout for /run/resume race window — already in §19 open items

---

## Round 2 — 2026-05-02T10:30:00Z

### ChatGPT Feedback (raw)

15 new findings: 5 high-impact (F11–F15), 5 medium refinements (F16–F20), 5 small (F21–F25).

🔴 High-impact:
F11. Resume endpoint not fully idempotent under partial success — CAS per task, scan for paused tasks, ignore already-running.
F12. Race: approval arrives exactly as step completes — must be accepted only if gate pending + step not transitioned; otherwise STEP_ALREADY_RESOLVED.
F13. Gate timeout / expiry not defined — either define expires_at semantics OR explicitly state "No expiry in V1 (intentional)".
F14. No invariant for "single active step per task" — at most one active step; transitions atomic.
F15. Parallel fan-out lacks failure aggregation rule — must pick A (fail-fast) / B (partial success) / C (configurable).

🟡 Medium:
F16. Cost extension approval race — cap update must persist before resume; otherwise re-pause loops.
F17. "Stop workflow" consistency — must explicitly state: cancel all immediately OR allow in-flight to finish.
F18. WebSocket ordering guarantee not explicit — client must apply events strictly in sequence; buffer out-of-order.
F19. Snapshot isolation for gate evaluation — all decisions must use the same snapshot version, not live org state.
F20. Studio publish → execution race — publish must persist + return version_id; execution must reference version_id explicitly.

🟢 Small:
F21. Max recursion / loop guard — define max step count per run (e.g. 10k).
F22. Explicit retry policy for steps — max_retries + retry_backoff per step.
F23. Deterministic ordering for parallel results — fan-in aggregation order based on task_sequence or creation order.
F24. Permission drift during execution — snapshot at run start OR live checks (must choose).
F25. Versioning for step schemas — schema_version per step type for long-running workflows.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F11: Resume endpoint not idempotent under partial success | technical | reject | auto (reject) | high | Misreads `/run/resume` as a bulk operation. §7.5 contract is per-run (`POST /api/tasks/:taskId/run/resume`) with an atomic CAS predicate (`UPDATE workflow_runs SET status = 'running' WHERE status = 'paused' AND id = $1`). Single-run idempotency is already correct. There is no "scan all paused tasks" semantics in V1. |
| F12: Race: approval arrives as step completes | technical | apply | auto (apply) | medium | §5.1.1 covers approve/reject racing on a `review_required` gate via the step-level CAS predicate, but DOES NOT handle the case where the step has been transitioned to a non-decision state (e.g., the run was Stopped, mid-flight). Today the API would return "successful idempotent hit" with no real winning decision — that's a ghost log. Add: if the predicate fails AND the step is no longer `review_required`, return `409 { error: 'step_already_resolved', current_status }`. |
| F13: Gate timeout / expiry not defined | technical | reject | auto (reject) | medium | §5.3 already explicitly states this: "**No timeout.** The task does not auto-fail." The spec also names notification cadence (24h / 72h / 7d) and explicitly defers `escalateAfterHours` to V2. Finding is redundant — spec is intentional. |
| F14: No invariant for "single active step per task" | technical | reject | auto (reject) | high | Directly contradicts §4.3 ("Fan-out: a step has multiple `next` arrows; engine dispatches in parallel") and §4.4 (Approval-on-reject loops). Multiple steps can be active simultaneously by design. Adding the proposed invariant would break the engine's parallel semantics. |
| F15: Parallel fan-out lacks failure aggregation rule | user-facing | apply (Option A) | apply Option A (user, "as recommended") | high | Genuine gap. §4.3 defines fan-out/fan-in but not what happens when one branch fails. Recommend Option A (fail-fast: any branch fails → fan-out fails immediately, in-flight branches best-effort cancelled per §7.3). Matches the spec's safety + visibility stance; V2 may add per-step configurability. |
| F16: Cost extension approval race | technical | reject | auto (reject) | medium | §7.5 already uses a single atomic UPDATE that updates the cap AND the status in one transaction (`UPDATE workflow_runs SET status = 'running', effective_cost_ceiling_cents = ..., extension_count = extension_count + 1 WHERE status = 'paused' AND id = $1`). Cap is persisted before any resume can observe `running`. No re-pause loop is possible. |
| F17: "Stop workflow" consistency across tasks | technical | reject | auto (reject) | medium | §7.3 already says: "Cleanup runs for any outstanding skill / Action calls (best-effort cancel; some external calls may have already fired and are not reversible)." The state machine in §7.5 forbids `failed → *` so no new steps dispatch. ChatGPT wants a binary "complete OR cancel" — the spec's actual answer is "best-effort cancel, may have fired" which is more honest. |
| F18: WebSocket ordering guarantee not explicit | technical | apply | auto (apply) | medium | §8.1 + §8.2 use a monotonic `task_sequence` but don't state the client invariant: events MUST be applied in `task_sequence` order; out-of-order arrivals MUST be buffered and applied when the gap fills (or trigger replay if the gap doesn't fill within a small window). Adding the explicit client invariant prevents UI flicker / state corruption. |
| F19: Snapshot isolation for gate evaluation | technical | reject | auto (reject) | medium | The spec ALREADY uses snapshot-based evaluation throughout: §3.3 `workflow_step_gates.approver_pool_snapshot`, §5.1 step 1 ("Verifies the deciding user is in the snapshotted pool"), §5.1.2 `/refresh-pool` is the only way to mutate the snapshot. Live org state is never read for gate decisions. Finding is a re-statement of existing design. |
| F20: Studio publish → execution race | technical | apply | auto (apply) | medium | The spec implies this through `workflow_template_versions` + `pinned_template_version_id` (§3.1) + start-version pinning (§4.6) but never explicitly pins the publish API contract or the dispatch-time version selection. Worth a small clarification: publish persists + returns `version_id`; new runs reference the latest published `version_id` at dispatch time AND pin to it for the run's lifetime. Removes ambiguity for architect. |
| F21: Max recursion / loop guard — max step count per run | technical | defer | escalated (defer) | low | Runtime quota; architect-time. §4.4 prevents structural infinite loops at validation, but Approval-on-reject at runtime could in theory cycle. A simple `max_steps_per_run` quota (e.g., 10k) is the right fix; pick at decomposition. Routes to backlog. |
| F22: Explicit retry policy for steps | technical | reject | auto (reject) | medium | §4.4 already says "Action retries (`retryPolicy`) are engine-level and not validated as a 'loop.'" The retry primitive is engine-level (existing infrastructure per spec-context.md `accepted_primitives` — `withBackoff`). The spec doesn't need to redefine. |
| F23: Deterministic ordering for parallel results | technical | defer | escalated (defer) | low | Real architect-time question (depends on engine fan-in semantics; the spec at §4.3 doesn't address result aggregation order). Routes to backlog with a note: the right answer is "by `task_sequence` of the producing event" so downstream LLM inputs are deterministic. Architect to confirm during decomposition. |
| F24: Permission drift during execution | technical | defer | escalated (defer) | medium | The spec already has a consistent split (snapshot for gates per §5.1; live for real-time controls per §7.5). The general "permission drift" question deserves a one-line statement of this split, but it's not a blocking gap — architect-time clarification. Routes to backlog. |
| F25: Versioning for step schemas | technical | reject | auto (reject) | medium | Already addressed by template-level versioning (§3.5 `workflow_template_versions`) + start-version pinning (§4.6 "running tasks are pinned to their start version"). A long-running task uses the schema bundle from its start version; mid-run schema drift is impossible. Per-step schema_version would be redundant. |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] §5.1.1 — race resolution clarification: API returns `409 { error: 'step_already_resolved', current_status }` when CAS fails AND step is no longer `review_required` (F12)
- [auto] §8.1 — explicit client ordering invariant: events MUST be applied in `task_sequence` order; out-of-order arrivals buffered (F18)
- [auto] §10.5 — publish API contract: persists + returns `version_id`; new runs reference the version_id at dispatch time and pin to it for the run's lifetime (F20)
- [user] §4.3 — fan-out failure aggregation = fail-fast (V1): any branch fails → fan-out fails; siblings best-effort cancelled; `failed` with reason `parallel_branch_failed`; V2 may add per-step configurability (F15)

### Deferred to backlog (routed at finalisation)

- F21: max step count per run runtime quota — architect-time
- F23: fan-in result ordering by `task_sequence` of producing event — architect-time
- F24: permission drift policy (snapshot for gates, live for controls — explicit one-liner) — architect-time

---

## Round 3 — 2026-05-02T11:00:00Z

### ChatGPT Feedback (raw)

15 final clarifications: 5 critical (F26–F30), 5 medium (F31–F35), 5 polish (F36–F40). ChatGPT explicitly flagged diminishing returns: "Another review pass will give diminishing returns. The remaining value comes from enforcing these as code-level invariants."

🔴 Critical: F26 atomic state transitions (single tx for completion + dispatch); F27 exactly-once vs at-least-once execution model declaration; F28 idempotency key scope (per-step deterministic key); F29 run completion invariant (all steps terminal AND no active/pending); F30 cancellation propagation (run → tasks → steps).

🟡 Medium: F31 ordering for task creation (monotonic); F32 Ask response schema validation (server-side); F33 gate resolution immutable; F34 retry vs resume separation (resume not auto-retry); F35 time source consistency (single source).

🟢 Polish: F36 correlation ID per execution attempt; F37 dead-letter handling for failed steps; F38 backpressure / max concurrent steps per run/org; F39 schema evolution safety (immutable workflow + step schema versions); F40 hard upper bounds (max tasks per run, max steps per task, max runtime).

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F26: Atomic state transitions | technical | reject | auto (reject) | high | Spec already uses CAS-predicate-within-transaction discipline throughout (§5.1.1, §11.4.1, §7.5, §3.3, §10.5). The proposed invariant — "step completion + next step activation in a single transaction" — is over-prescriptive and conflicts with the standard outbox / at-least-once-dispatch pattern. The right discipline is the one the spec already uses (CAS predicates). Severity escalation override: user memory says repeats / over-prescriptive findings auto-apply per recommendation. |
| F27: Execution model declaration (at-least-once vs exactly-once) | technical | apply | apply (user, "continue as recommended") | high | Genuine missing top-level contract. The spec consistently uses state-based idempotency per endpoint, which implies at-least-once with idempotent handlers, but never declares the V1 execution model at the top level. Added §4.0 Execution model framing subsection to anchor all the per-endpoint idempotency declarations. |
| F28: Idempotency key scope | technical | reject | auto (reject) | medium | The spec uses per-endpoint state-based idempotency posture (per spec-authoring-checklist §10), which is more flexible and covers more cases than a single global `(run_id, task_id, step_id, attempt)` key. Per-endpoint posture is already declared at §5.1.1, §5.1.2, §11.4.1, §11.4.2, §7.5 (resume + stop), §10.5, §12.4. |
| F29: Run completion invariant | technical | apply | auto (apply) | medium | Genuine small gap. §7.5 state machine names `succeeded` as a status but doesn't define the entry condition. Add a one-line invariant: `running → succeeded` requires all steps in terminal status AND no pending steps. Prevents phantom "completed" runs. |
| F30: Cancellation propagation rule | technical | reject | auto (reject) | medium | The proposed run → tasks → steps hierarchy doesn't match the spec's structure — a workflow Task has one Run; cancellation is run-level (§7.3 Stop). The spec already says "best-effort cancel; some external calls may have already fired and are not reversible." That's the honest answer; restating it as "cancellation propagates" hierarchy mismatches the data model. |
| F31: Task creation ordering (monotonic task_sequence) | technical | reject | auto (reject) | medium | Conflates `task_sequence` (per-task event ordering, §3.1 + §8.1) with task creation order across tasks. Tasks are independent units; cross-task ordering isn't a contract this spec needs. The per-task event sequence is the right granularity. |
| F32: Ask response schema validation (server-side) | technical | reject | auto (reject) | medium | §11.3 explicitly states V1 is client-side validation, V2 is server-side. Spec is intentional. Per user memory: spec already addressed → auto-reject. |
| F33: Gate resolution immutable | technical | reject | auto (reject) | medium | §5.1.1 state machine already declares: "Forbidden: `approved/rejected → *` (terminal). Adding a new review status requires a spec amendment." Immutability is already in the contract. Per user memory: repeat → auto-reject. |
| F34: Retry vs resume separation | technical | apply | auto (apply) | medium | Genuine small clarification. §7.5 Resume API says the run transitions to `running` but doesn't explicitly say "resume continues from the next pending step; it does NOT re-execute completed steps; step retries are independent of resume." Worth one-line addition. |
| F35: Time source consistency | technical | reject | auto (reject) | medium | Spec already uses `now()` defaults in column definitions (§3.1, §3.3); time discipline is implicit in the database-time pattern. Architect-level convention; not a spec contract. |
| F36: Correlation ID per execution attempt | technical | reject | auto (reject) | low | §8.2 event envelope already includes `event_id` (monotonic per task) + `task_id`; existing `agent_execution_events` infrastructure provides correlation. `run_id` / `step_id` flow through `entity_refs[]` and payload as relevant. Adding a separate `correlation_id` would duplicate `event_id`'s role. |
| F37: Dead-letter handling for failed steps | technical | reject | auto (reject) | low | Engine-level concern (existing infrastructure per spec-context.md `accepted_primitives` — `withBackoff`, `TripWire`, `failure()` + `FailureReason` enum). Not a V1 spec contract. |
| F38: Backpressure / max concurrent steps quota | technical | defer | auto (defer, no surface) | low | Same family as F21 (max step count per run) — runtime quota / safety rail. Per user memory: repeat-family auto-defer without re-surfacing. Routes to backlog. |
| F39: Schema evolution safety (immutable workflow + step schema versions) | technical | reject | auto (reject) | medium | Direct repeat of F25 (rejected round 2) — already covered by template-level versioning + start-version pinning per §4.6. Per user memory: repeat → auto-reject without re-surfacing. |
| F40: Hard upper bounds (max tasks per run, max steps per task, max runtime) | technical | defer | auto (defer, no surface) | low | Same family as F21 + M1–M3 (architect-time quotas already deferred). Per user memory: repeat-family auto-defer without re-surfacing. Routes to backlog. |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] §7.5 — run completion invariant: `running → succeeded` requires all steps in terminal status AND no pending/queued steps remain (F29)
- [auto] §7.5 — explicit retry/resume separation: resume continues from next pending step; does NOT re-execute completed steps; step retries are independent of resume (F34)
- [user] §4.0 (NEW subsection) — Execution model: at-least-once dispatch with idempotent handlers; state-based CAS predicates as primary idempotency mechanism; foundational framing for all per-endpoint posture declarations across the spec (F27)

### Deferred to backlog (routed at finalisation, no user surfacing per memory)

- F38: max concurrent steps per run / per org — runtime quota; same family as F21 — architect-time
- F40: max tasks per run / max steps per task / max runtime duration — same family as F21 + M1–M3 — architect-time

---

## Round 4 — 2026-05-02T11:30:00Z

### ChatGPT Feedback (raw)

11 final tightenings: F41–F50 + F51 meta. ChatGPT closes with: "There are no more meaningful design gaps. Anything further would be: implementation detail, or premature optimisation."

🔴 Final edge-of-production: F41 explicit concurrency control (SELECT … FOR UPDATE SKIP LOCKED / advisory lock); F42 visibility timeout / stuck execution recovery; F43 partial side-effect failure model (write-ahead intent); F44 deterministic retry backoff (exp + jitter); F45 schema validation boundary for LLM outputs; F46 event ordering totally ordered per run; F47 replay/rehydration contract (state derivable from event log); F48 version skew (workers vs schema); F49 no hidden writes rule; F50 terminal state final.

🟢 Meta: F51 invariant enforcement location (DB constraint / tx boundary / central guard).

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F41: Concurrency control strategy (worker contention) | technical | reject | auto (reject) | medium | Already covered by §4.0 Execution model — state-based CAS predicates ensure exactly one worker wins the `UPDATE ... WHERE status = 'queued'` transition. The proposed `SELECT FOR UPDATE SKIP LOCKED` / advisory lock is one valid implementation; the spec's CAS approach is equivalent and is consistent across §5.1.1, §11.4.1, §7.5, §10.5. |
| F42: Visibility timeout / stuck execution recovery | technical | defer | auto (defer, no surface) | medium | Engine / worker-level concern. Existing engine primitives (`createWorker()`, `withBackoff` per spec-context.md `accepted_primitives`) handle worker death. Architect to confirm during decomposition. Routes to backlog. |
| F43: Partial side-effect failure model | technical | reject | auto (reject) | medium | §4.0 already addresses: "an external API call without a deduplicating key must surface that constraint upstream rather than silently retry." The architectural pattern (write-ahead intent vs reconciliation) is engine-level and out of scope for this spec. |
| F44: Deterministic retry backoff | technical | reject | auto (reject) | medium | Direct repeat of F22 (rejected round 2) — retry policy is engine-level via existing `withBackoff` primitive. Per user memory: repeat → auto-reject. |
| F45: Schema validation boundary for LLM outputs | technical | reject | auto (reject) | medium | LLM output validation is agent-layer concern, broader than this workflow spec's scope. The agent layer's existing validation handles this. Out of scope for V1 workflow spec. |
| F46: Event ordering totally ordered per run | technical | reject | auto (reject) | medium | Direct repeat of F1 (round 1, applied) + F18 (round 2, applied) — §8.1 already has the `task_sequence` allocation invariant + client ordering invariant. Per user memory: repeat → auto-reject. |
| F47: Replay/rehydration contract (state derivable from event log) | technical | reject | auto (reject) | medium | The spec uses a hybrid event-log + relational-state model intentionally (events for replay/UI, tables for state). Full event sourcing as a top-level invariant would be a major architectural change and is out of scope for V1. |
| F48: Version skew handling (workers vs schema) | technical | reject | auto (reject) | low | Workflow versioning is already pinned per run (§4.6 start-version pinning). Worker code skew during deploys is engine-level deployment concern, not workflow spec contract. |
| F49: Strict "no hidden writes" rule | technical | reject | auto (reject) | low | Implementation discipline rule, not a spec contract. The spec lists every write surface (§3, §5, §7, §10, §11, §12); enforcement is via code review. |
| F50: Terminal state is final | technical | reject | auto (reject) | medium | Direct repeat of F33 (rejected round 3) — §5.1.1 state machine already says "Forbidden: approved/rejected → * (terminal)". §7.5 forbids "succeeded → *" / "failed → running/paused". Per user memory: repeat → auto-reject. |
| F51: Invariant enforcement location (DB / tx / central guard) | technical | reject | auto (reject) | low | Meta-statement; the spec already uses all three enforcement mechanisms (DB constraints — UNIQUE on `(gate_id, deciding_user_id)`, FK on `gate_id`; transactional CAS predicates throughout; central validator at publish per §4). Architect-time guidance, not new spec contract. |

### Applied (this round)

- (none — all findings auto-resolved as reject or defer-no-surface per user memory)

### Deferred to backlog (this round, no user surfacing per memory)

- F42: visibility timeout / stuck execution recovery — engine/worker primitive (existing `createWorker()` / `withBackoff`) — architect-time

---

## Final Summary

- **Verdict:** APPROVED — spec is implementation-ready. Top-level execution model declared (§4.0); all per-endpoint idempotency posture grounded; no unresolved forward references; all directional product calls landed.
- **Rounds:** 4 (round 4 was diminishing returns per ChatGPT's own closing assessment: "no more meaningful design gaps").
- **Auto-accepted (technical):** 6 applied | 30 rejected | 3 deferred
- **User-decided:** 9 applied | 0 rejected | 7 deferred
- **Total findings:** 55 (F1–F51 + M1–M4)
- **Index write failures:** 0 (clean)

### Cumulative Applied (15)

- §3.1 + §8.1 — `task_sequence` per-task event sequence with atomic + gap-free allocation invariant; failed write surfaces `event_log_corrupted` (F1)
- §5.1.2 — Ask vs Approval pool-refresh asymmetry (F2)
- §7.4 — cost source of truth = ledger sum; failed cost-write fails the step (F3)
- §7.4 — cap enforcement best-effort for long-running steps (F4, Option A)
- §5.2 — V2 isCritical recovery path note (F6)
- §10.6 — V1 chat-session-only draft discoverability (F7, Option A)
- §8.1 — event retention invariant + client gap-detection fallback (F8)
- §11.5 — type-match guard on auto-fill (F9)
- §5.1.1 — race resolution: 409 step_already_resolved when CAS fails AND step is no longer review_required (F12)
- §4.3 — fan-out failure aggregation = fail-fast (V1) with parallel_branch_failed (F15, Option A)
- §8.1 — explicit client ordering invariant (events applied in task_sequence order; buffer gaps; replay if gap doesn't fill) (F18)
- §10.5 — publish API contract returns version_id; new runs reference it at dispatch time and pin for lifetime (F20)
- §4.0 (NEW) — Execution model: at-least-once dispatch with idempotent handlers; state-based CAS predicates as primary mechanism (F27)
- §7.5 — run completion invariant: running → succeeded requires all steps in terminal status AND no pending/queued (F29)
- §7.5 — retry/resume separation: resume continues from next pending step; does NOT re-execute completed; step retries independent of resume (F34)

### Deferred to tasks/todo.md § Spec Review deferred items / workflows-dev-spec

- [user] M1: define max approver pool size — UI guard + perf cap, architect-time
- [user] M2: define max Ask fields per step — schema validator rule + UX cap, architect-time
- [user] M3: define max files per task before grouping mandatory — UI threshold, architect-time
- [user] M4: timeout for /run/resume race window — confirm against §19 open items, architect-time
- [user] F21: max step count per run runtime quota (e.g. 10k) — runtime safety guard, architect-time
- [user] F23: fan-in result ordering by `task_sequence` of producing event — depends on engine fan-in semantics, architect-time
- [user] F24: permission drift policy — explicit one-line statement of "snapshot for gates, live for controls" pattern in §14, architect-time
- [auto] F38: max concurrent steps per run / per org — same family as F21, architect-time
- [auto] F40: max tasks per run / max steps per task / max runtime duration upper bounds — same family as F21+M1-M3, architect-time
- [auto] F42: visibility timeout / stuck execution recovery — engine/worker concern using existing `createWorker()` primitive, architect-time

### Doc sync sweep (per `docs/doc-sync.md`)

- KNOWLEDGE.md updated: yes (3 entries — engine execution model, gate-snapshot pattern, race-vs-external-transition gotcha)
- architecture.md updated: n/a — spec is upstream of the architecture changes; new tables (`workflow_drafts`, `workflow_step_gates`) and the per-task event-sequence extension will surface in `architecture.md` when the implementation lands
- capabilities.md updated: n/a — workflow capability already exists; no add/remove/rename in this session
- integration-reference.md updated: n/a — no integration changes
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a — no convention changes; no `[missing-doc]` reasons surfaced
- spec-context.md updated: n/a — spec uses existing primitives (`agent_execution_events`, `agentExecutionEventService`, `withBackoff`, `createWorker()`); no framing assumption changed
- frontend-design-principles.md updated: n/a — F7 referenced this doc to justify Option A but did not propose a new principle

### PR

PR: #252 — spec changes ready at https://github.com/michaelhazza/automation-v1/pull/252





---
