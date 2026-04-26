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

