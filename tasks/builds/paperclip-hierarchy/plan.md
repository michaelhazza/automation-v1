# Paperclip Hierarchy — Implementation Plan

**Source spec:** `docs/hierarchical-delegation-dev-spec.md`
**Branch:** `claude/paperclip-agent-hierarchy-9VJyt`
**Classification:** Major — cross-cutting, architectural change, four-phase rollout.
**Testing posture:** `static_gates_primary` + `runtime_tests: pure_function_only` (per `docs/spec-context.md`).
**Rollout model:** `commit_and_revert`. No feature flags.
**Out of scope (hard):**
- Spec §3.2 out-of-scope list (seeded-company multi-tier reorg, mesh / dynamic-team patterns, role enum, RLS-layer delegation enforcement, cost rollups, broader upward-reassign).
- NCA routing for cross-subtree reassignment (`tasks/todo.md` line 314).
- Violation sampling / alerting tier above §17.3 rejection-rate metric (`tasks/todo.md` line 315).

---

## 1. System Invariants

Four named invariants. Every chunk that touches the hierarchy graph, a delegation skill, a telemetry write, or run-trace reconstruction MUST reference the relevant invariant by name in its acceptance criteria. These are paraphrased from the spec — not mere links — so a builder implementing a single chunk has the full invariant in view without needing to re-read the spec.

### INV-1 — runId continuity (spec §10.6)

Every delegation-spawned `agent_runs` row has a parent pointer equal to the `SkillExecutionContext.runId` of the dispatching skill call:

- **Spawn chain.** Sub-agent runs (`isSubAgent = true`) have `parentRunId = context.runId` of the `spawn_sub_agents` call. Set once at run creation; never null for a spawn row; never rewritten.
- **Handoff chain.** Handoff runs (created by `reassign_task` dispatch) have `handoffSourceRunId = context.runId` of the `reassign_task` call. Set once at run creation; never null for a handoff row; never rewritten.
- **Both pointers when both caused it.** A run that was spawned AND later reassigned has both pointers set, each immutable.
- **Telemetry alignment.** The corresponding `delegation_outcomes` row (accept or reject) for a delegation carries `runId = SkillExecutionContext.runId` — the SAME value as the parent pointer on the child run and the `context.runId` field on any `agent_execution_events` error row emitted by the same call. One correlated id threads the child run, the outcome row, and the error log.
- **Never regenerate, never read from elsewhere.** Every write site sources `runId` from `SkillExecutionContext.runId` directly. No reconciliation job, no back-fill path, no alternative source. A broken pointer is a bug, investigated — not auto-repaired.
- **Enforced at call-site, not via reconciliation.** Type system + pure-core unit tests (§12) must cover the call-site.

Consumers that depend on INV-1: the DAG traversal in `delegationGraphService` (Chunk 4d), the metric queries in spec §17, and the lossless-log backstop in `agent_execution_events`.

### INV-2 — Uniform error contract (spec §4.3)

Structured errors `delegation_out_of_scope`, `cross_subtree_not_permitted`, and `hierarchy_context_missing` returned by the delegation skills carry a stable `{ code, message, context }` shape:

- **`code`** is one of the three string literals. Enum is closed for v1 — adding a new code requires a spec update.
- **`message`** is human-readable, intended for the agent's prompt context. May include runtime identifiers; MUST NOT include spec-version numbers or other values that drift between revisions.
- **`context`** is an object with a mandatory minimum shape:
  - **Required for every code:** `runId` (from `SkillExecutionContext.runId`) and `callerAgentId` (from `SkillExecutionContext.agentId`).
  - **Per-code required identifiers when resolvable:** `targetAgentId` + `delegationScope` + `callerChildIds` for `delegation_out_of_scope`; `callerParentId` + `suggestedScope` for `cross_subtree_not_permitted`; `skillSlug` for `hierarchy_context_missing`.
  - **Additive-only evolution.** Extra diagnostic fields MAY be added by the skill handler without a spec update, but MUST be additive — never rename or remove a field that has already shipped.
  - **Size bound.** Serialised `context` ≤ 4 KiB.
  - **Array truncation.** Any array-valued diagnostic field (e.g. `callerChildIds`) truncates to the first 50 elements with a sibling `truncated: true` flag when the full list would breach the cap.
- Every error emitted by these skills is ALSO written to `agent_execution_events` with the same `{ code, context }` payload — this is the lossless backstop for when `delegation_outcomes` writes are dropped (see INV-3). The event-log write is itself best-effort (INV-3 mechanism).

Consumers that depend on INV-2: the agent's prompt (re-plans on next turn), the Live Execution Log viewer, rejection-rate metrics (spec §17.3).

### INV-3 — Best-effort dual-writes (spec §10.3, §15.6, §15.8)

Telemetry writes for delegation decisions — one row to `delegation_outcomes`, one event to `agent_execution_events` — use distinct detached try/catch entry points and NEVER propagate failure to the skill caller:

- **`insertOutcomeSafe`** — single entry point on `delegationOutcomeService` for skill handlers. Single INSERT, no transaction. Runs AFTER the parent skill's core mutation has committed. On failure: logs WARN under tag `delegation_outcome_write_failed` and swallows. Does not re-throw.
- **`insertExecutionEventSafe`** — single entry point on the existing `agentExecutionEventService` for the delegation-error dual-write. Same mechanism (detached try/catch). On failure: logs WARN under tag `delegation_event_write_failed` and swallows. Distinct tag from the outcome-write failure tag so dashboards can distinguish shared-infra outage from single-path bugs.
- **Never inside the skill's critical-path transaction.** Both writes are explicitly sequenced AFTER the core mutation commits, so a telemetry DB hiccup cannot roll back user work.
- **Strict variant exists for tests / backfills only.** `recordOutcomeStrict` (and a parallel strict event path, if added) throws on failure. Skill handlers MUST NEVER call the strict variant.
- **Degenerate-case contract.** In the worst case where both writes drop, the error is STILL returned to the caller (agent prompt) with the full `{ code, message, context }` payload. Telemetry surfaces are telemetry, not enforcement.

Consumers that depend on INV-3: Chunks 1b, 4b, and 4c (every telemetry write site); dashboards reading the failure tags; the lossless-log contract in INV-2.

### INV-4 — Immutable hierarchy snapshot (spec §4.1, §15.3)

`SkillExecutionContext.hierarchy` is a per-run read-only snapshot, built once at run start by `hierarchyContextBuilderService.buildForRun()`:

- **Type is `Readonly<HierarchyContext>`.** TypeScript-level immutability.
- **Runtime frozen.** The impure wrapper returns `Object.freeze(pureResult)` so mutation attempts throw in strict mode.
- **Skill handlers MUST NOT:** mutate any field, re-query the roster mid-run, or reinterpret the snapshot.
- **Graph changes apply at next run.** If roster changes mid-run, the run completes with stale context and the next run of the agent reads fresh state. This is the design, not a bug.
- **Fail fast on stale-context errors.** If a delegation targets a since-deleted child, the validator rejects with the existing "target not found" class of error. Bounded by existing run-cost breakers and timeouts.
- **Never lazy-initialised.** Built exactly once per run in `agentExecutionService` BEFORE the skill resolver runs. The skill resolver consumes the already-built snapshot; it does not re-invoke the builder.
- **Write skills fail closed on missing `context.hierarchy`.** `spawn_sub_agents` and `reassign_task` emit `hierarchy_context_missing` (INV-2) if invoked without it. Read skills (the three list skills) fall through to `subaccount`-wide results with a WARN log.

Consumers that depend on INV-4: Chunks 3a (builder), 3b (list skills), 4b (write skills), 4c (resolver union).

---

## Table of contents

1. System Invariants (reference for every chunk)
2. Phase overview
3. Phase 1 — Observability foundations
4. Phase 2 — Root contract + scope-aware routing + template picker
5. Phase 3 — Hierarchy context + visibility layer
6. Phase 4 — Execution enforcement + derived skill resolution + trace graph
7. File inventory cross-reference
8. Phase dependency check (forward-only)
9. Risks
10. Architecture notes (non-obvious decisions)

---
