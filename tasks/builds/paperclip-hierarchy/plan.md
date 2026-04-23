# Paperclip Hierarchy — Implementation Plan

**Source spec:** `docs/hierarchical-delegation-dev-spec.md`
**Branch:** `claude/paperclip-agent-hierarchy-9VJyt`
**Classification:** Major — cross-cutting, architectural change, four-phase rollout.
**Testing posture:** `static_gates_primary` + `runtime_tests: pure_function_only` (per `docs/spec-context.md`).
**Rollout model:** `commit_and_revert`. No feature flags.
**Plan authored:** 2026-04-23.

## Out of scope (hard — do not include in any chunk)

- Spec §3.2 out-of-scope list (seeded-company multi-tier reorg, mesh / dynamic-team patterns, role enum, per-subaccount-agent `delegation_authority` override, RLS-layer delegation enforcement, cost rollups, broader upward-reassign beyond §6.4 step-2 special case, heartbeat-scheduling changes for managers, capability-aware routing redesign).
- NCA routing for cross-subtree reassignment (`tasks/todo.md` line 314).
- Violation sampling / alerting tier above §17.3 rejection-rate metric (`tasks/todo.md` line 315).
- Full `ORCHESTRATOR_AGENT_SLUG` deletion (retained for org-scope fallback per §6.6 case 2 + §13).
- Deactivation audit columns (`deactivatedAt` / `deactivatedReason` / `deactivatedByUserId`) — spec §6.8 verdict is use `isActive` only.

If a builder encounters a real architectural gap, route it to `tasks/todo.md § PR Review deferred items / ### paperclip-hierarchy` — do not edit the spec.

---

## Table of contents

1. System Invariants
2. Architecture notes
3. Phase overview
4. Phase 1 — Observability foundations (Chunks 1a / 1b / 1c)
5. Phase 2 — Root contract + scope-aware routing + template picker (Chunks 2.0 / 2a / 2b / 2c)
6. Phase 3 — Hierarchy context + visibility layer (Chunks 3a / 3b)
7. Phase 4 — Execution enforcement + derived skill resolution + trace graph (Chunks 4a / 4b / 4c / 4d)
8. File inventory cross-reference (spec §14.1–§14.4)
9. Phase dependency check (forward-only)
10. Risks
11. Architecture docs update (Phase 4 exit)

---

## 1. System Invariants

Four named invariants. Every chunk that touches the hierarchy graph, a delegation skill, a telemetry write, or run-trace reconstruction MUST reference the relevant invariant(s) by name in its acceptance criteria. These are paraphrased from the spec — not mere links — so a builder implementing a single chunk has the full invariant in view without re-reading the spec.

### INV-1 — runId continuity (spec §10.6)

Every delegation-spawned `agent_runs` row has a parent pointer equal to the `SkillExecutionContext.runId` of the dispatching skill call.

- **Spawn chain.** Sub-agent runs (`isSubAgent = true`) have `parentRunId = context.runId` of the `spawn_sub_agents` call. Set once at run creation; never null for a spawn row; never rewritten.
- **Handoff chain.** Handoff runs (created by `reassign_task` dispatch) have `handoffSourceRunId = context.runId` of the `reassign_task` call. Set once at run creation; never null for a handoff row; never rewritten.
- **Both pointers when both caused it.** A run that was spawned AND later reassigned has both pointers set, each immutable.
- **Telemetry alignment.** The corresponding `delegation_outcomes` row carries `runId = SkillExecutionContext.runId` — the SAME value as the parent pointer on the child run and the `context.runId` field on any `agent_execution_events` error row emitted by the same call. One correlated id threads the child run, the outcome row, and the error log.
- **Never regenerate; never read from elsewhere.** Every write site sources `runId` from `SkillExecutionContext.runId` directly. No reconciliation job, no back-fill path, no alternative source.
- **Enforced at call-site, not via reconciliation.** Type system + pure-core unit tests must cover the call-site.

Consumers that depend on INV-1: the DAG traversal in `delegationGraphService` (Chunk 4d), the metric queries in spec §17, the lossless-log backstop in `agent_execution_events`.

### INV-2 — Uniform error contract (spec §4.3)

Structured errors `delegation_out_of_scope`, `cross_subtree_not_permitted`, and `hierarchy_context_missing` returned by the delegation skills carry a stable `{ code, message, context }` shape.

- **`code`** is one of the three string literals. Enum is closed for v1 — adding a new code requires a spec update.
- **`message`** is human-readable, intended for the agent's prompt. May include runtime identifiers; MUST NOT include spec-version numbers or other values that drift between revisions.
- **`context`** is an object with a mandatory minimum:
  - **Required for every code:** `runId` (from `SkillExecutionContext.runId`) and `callerAgentId` (from `SkillExecutionContext.agentId`).
  - **Per-code required identifiers when resolvable:** `targetAgentId` + `delegationScope` + `callerChildIds` for `delegation_out_of_scope`; `callerParentId` + `suggestedScope` for `cross_subtree_not_permitted`; `skillSlug` for `hierarchy_context_missing`.
  - **Additive-only evolution.** Extra diagnostic fields MAY be added without a spec update; never rename or remove a field that has shipped.
  - **Size bound.** Serialised `context` ≤ 4 KiB.
  - **Array truncation.** Any array-valued diagnostic field (e.g. `callerChildIds`) truncates to the first 50 elements with a sibling `truncated: true` flag when the full list would breach the cap.
- Every error emitted by these skills is ALSO written to `agent_execution_events` with the same `{ code, context }` payload — lossless backstop for when `delegation_outcomes` writes are dropped (INV-3).

Consumers that depend on INV-2: the agent's prompt (re-plans on next turn), the Live Execution Log viewer, rejection-rate metrics (spec §17.3).

### INV-3 — Best-effort dual-writes (spec §10.3, §15.6, §15.8)

Telemetry writes for delegation decisions — one row to `delegation_outcomes`, one event to `agent_execution_events` — use distinct detached try/catch entry points and NEVER propagate failure to the skill caller.

- **`insertOutcomeSafe`** — single entry point on `delegationOutcomeService` for skill handlers. Single INSERT, no transaction. Runs AFTER the parent skill's core mutation has committed. On failure: logs WARN under tag `delegation_outcome_write_failed` and swallows. Does not re-throw.
- **`insertExecutionEventSafe`** — single entry point on the existing `agentExecutionEventService` for the delegation-error dual-write. Same detached-try/catch mechanism. On failure: logs WARN under tag `delegation_event_write_failed` and swallows. **Distinct tag from the outcome-write failure tag** so dashboards can distinguish shared-infra outage from single-path bugs.
- **Never inside the skill's critical-path transaction.** Both writes are explicitly sequenced AFTER the core mutation commits.
- **Strict variant exists for tests / backfills only.** `recordOutcomeStrict` throws on failure. Skill handlers MUST NEVER call the strict variant.
- **Degenerate-case contract.** If both writes drop, the error is STILL returned to the caller (agent prompt) with the full `{ code, message, context }`. Telemetry surfaces are telemetry, not enforcement.

Consumers that depend on INV-3: Chunks 1b, 4b, 4c (every telemetry write site); dashboards reading the failure tags; the lossless-log contract in INV-2.

### INV-4 — Immutable hierarchy snapshot (spec §4.1, §15.3)

`SkillExecutionContext.hierarchy` is a per-run read-only snapshot, built once at run start by `hierarchyContextBuilderService.buildForRun()`.

- **Type is `Readonly<HierarchyContext>`.** TypeScript-level immutability.
- **Runtime frozen.** The impure wrapper returns `Object.freeze(pureResult)`; mutation attempts throw in strict mode.
- **Skill handlers MUST NOT:** mutate any field, re-query the roster mid-run, reinterpret the snapshot, or store a parallel copy.
- **Graph changes apply at next run.** If roster changes mid-run, the run completes with stale context; the next run of the agent reads fresh state.
- **Fail fast on stale-context errors.** A delegation targeted at a since-deleted child fails via the existing target-not-found error class. Bounded by existing run-cost breakers + timeouts.
- **Never lazy-initialised.** Built exactly once per run in `agentExecutionService` BEFORE the skill resolver runs. The resolver consumes the already-built snapshot; it does not re-invoke the builder.
- **Write skills fail closed on missing `context.hierarchy`.** `spawn_sub_agents` and `reassign_task` emit `hierarchy_context_missing` (INV-2). Read skills (three list skills) fall through to `subaccount`-wide results with a WARN log.

Consumers that depend on INV-4: Chunks 3a (builder), 3b (list skills), 4b (write skills), 4c (resolver union).

---

## 2. Architecture notes

### 2.1 Key decisions (problem → pattern → rejected alternative)

**Pure + impure service split for every new service.** Spec §12 pins `runtime_tests: pure_function_only`, so pure cores get unit-tested; impure wrappers handle DB/IO and are not tested directly. Applies to all four new services: `hierarchyContextBuilderService`, `hierarchyRouteResolverService`, `delegationOutcomeService`, `delegationGraphService`.
- *Problem:* keeps correctness logic testable without DB fixtures; mirrors the rest of the repo (see spec-context `accepted_primitives`).
- *Pattern:* composition — pure function composed under an impure wrapper.
- *Rejected:* single-file service with IO mocked via interface injection — drifts from repo convention and bloats tests.

**Telemetry writes outside the critical-path transaction.** Both `insertOutcomeSafe` (new, on `delegationOutcomeService`) and `insertExecutionEventSafe` (new, added to the existing `agentExecutionEventService`) run as detached try/catch AFTER the parent skill's mutation commits. Distinct WARN tags (`delegation_outcome_write_failed` vs `delegation_event_write_failed`) so dashboards distinguish failure modes.
- *Problem:* a telemetry DB hiccup must not fail user-facing delegation work (INV-3).
- *Pattern:* adapter — the "safe" entry point adapts a strict insert to a fire-and-forget contract.
- *Rejected:* pg-boss job for outcome writes (over-engineered for row volume per spec §10.3); generic post-commit hook abstraction (plain detached call is enough).

**pg-boss job payload carries scope, not a new `tasks` column.** `briefCreationService.enqueueOrchestratorRoutingIfEligible(task, { scope })` widens the enqueue signature; `orchestratorFromTaskJob` reads `job.data.scope ?? 'subaccount'`. No `tasks.triggerContext` column (spec §6.7 rationale).
- *Problem:* scope is transient dispatch metadata, not durable task state. Schema migration would add row cost for no read-path benefit.
- *Pattern:* message-carried context — the queue payload is the natural carrier.
- *Rejected:* new `tasks.triggerContext` column (spec explicitly rejects it).

**Resolver replaces hardcoded slug ONLY for `scope === 'subaccount'`.** `ORCHESTRATOR_AGENT_SLUG` constant stays in `orchestratorFromTaskJob.ts` for the org-scope fallback path (§6.6 case 2). Full slug removal waits for a second org-level root candidate (deferred per §13).
- *Problem:* one clean slice; no half-implemented org-scope resolver.
- *Rejected:* delete the slug in Phase 2 (would force org-scope resolver work that's explicitly deferred).

**Graph-not-tree for `/api/agent-runs/:id/delegation-graph`.** A run can have both `parentRunId` (spawn parent) and `handoffSourceRunId` (handoff parent). Returning a tree would force picking one parent as canonical and discarding information; returning `{ nodes, edges }` is lossless (spec §7.2).
- *Problem:* trace explainability for the post-Phase-4 adjustment period.
- *Pattern:* discriminated-edge response (`DelegationEdgeKind = 'spawn' | 'handoff'`).
- *Rejected:* tree with handoff-as-annotation — loses information at the response layer.

**Narrow special case for upward reassign (§6.4 step 2, option b).** Any agent may `reassign_task` to `context.hierarchy.parentId`; marked `delegationDirection: 'up'`. Special-case check runs BEFORE generic scope validation.
- *Problem:* brief commits to "upward escalation allowed, logged" without introducing a role system.
- *Rejected:* `delegationScope: 'parent'` (vocabulary for a single-target case); separate `escalate_upward` skill (platform surface bloat); drop it (contradicts brief).

### 2.2 Patterns NOT applied

Spec §3.4 names primitives that could have been invented and weren't. This plan adds exactly:

- Four new services (all pure+impure pairs).
- One new table (`delegation_outcomes`).
- Two new routes (both list/read endpoints).
- One new permission key (`org.observability.view`).
- Three new health detectors (two Phase 1, one Phase 4).
- One new client component (`StartingTeamPicker`), one new view (`DelegationGraphView`), one optional admin page (`AdminDelegationOutcomesPage`).

No new retry/backoff primitive, no new RLS layer, no new queue, no new skill system, no role enum. `DelegationScope` is defined once in `shared/types/delegation.ts` and reused everywhere.

---

## 3. Phase overview

Four phases per spec §11, plus a Phase 2 pre-flight (Chunk 2.0) that is non-code — it resolves the seed-manifest dual-root before migration 0202 can apply.

| Phase | Chunks | Ships | User-visible? |
|---|---|---|---|
| 1 — Observability foundations | 1a, 1b, 1c | Migrations 0204 + 0205; `delegationOutcomeService`; list route; two detectors; optional admin page | No (no behaviour change) |
| 2 — Root contract + routing + picker | 2.0, 2a, 2b, 2c | Manifest re-seed → migration 0202; resolver service; job + brief + template rotation; picker UI | Yes (per-subaccount CEO routing) |
| 3 — Hierarchy context + visibility | 3a, 3b | Builder service; `SkillExecutionContext.hierarchy`; scope param on three list skills | Partial (adaptive defaults on list skills) |
| 4 — Execution enforcement + derived skills + trace graph | 4a, 4b, 4c, 4d | Migration 0203; `spawn_sub_agents` / `reassign_task` validation; derived delegation skills; third detector; graph route + trace tab | Yes (enforcement + trace UI) |

Forward-only dependency: Phase N never references primitives first introduced in Phase N+k. Three intentional early-introductions are called out in §9 Phase dependency check.

---
