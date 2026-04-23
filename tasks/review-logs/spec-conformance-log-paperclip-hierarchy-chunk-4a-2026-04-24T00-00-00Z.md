# Spec Conformance Log

**Spec:** `docs/hierarchical-delegation-dev-spec.md` + `tasks/builds/paperclip-hierarchy/plan.md` (Chunk 4a, lines 567–625)
**Spec commit at check:** `e639337aa4872d000ad3f2369380599b35bf53a7`
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Base:** `399f3864b5187d2be99ca9f9807793699560ece7`
**Scope:** Chunk 4a — Migration 0203 + `spawn_sub_agents` + `reassign_task` validation + telemetry dual-writes
**Changed-code set:** 8 Chunk 4a files
**Run at:** 2026-04-23T00:00:00Z

---

## Summary

- Requirements extracted:     19
- PASS:                       13
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 6
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (6 directional gaps — see `tasks/todo.md` under "Deferred from spec-conformance review — paperclip-hierarchy-chunk-4a")

---

## Requirements extracted (full checklist)

### New files

| REQ | Category | Spec section | Requirement | Verdict |
|-----|----------|--------------|-------------|---------|
| REQ #1 | file/migration | plan.md:572 | `migrations/0203_tasks_delegation_direction.sql` — `ALTER TABLE tasks ADD COLUMN delegation_direction text` + CHECK `IN ('down','up','lateral')` | PASS |
| REQ #2 | file/test | plan.md:573; spec §12.2 | `skillExecutor.spawnSubAgents.test.ts` covers: all-children-accepted; one-out-of-scope rejects all; subaccount scope → `cross_subtree_not_permitted`; `MAX_HANDOFF_DEPTH` exceeded; `context.hierarchy` undefined → `hierarchy_context_missing`; adaptive default (no children → subaccount → reject) | PARTIAL — DIRECTIONAL_GAP (see C4a-1..C4a-4) |
| REQ #3 | file/test | plan.md:574; spec §12.2 | `skillExecutor.reassignTask.test.ts` covers: direction computation; upward-escalation special case; subaccount+root → accepted; subaccount+non-root → `cross_subtree_not_permitted`; `context.hierarchy` undefined → `hierarchy_context_missing`; special-case ordering | PARTIAL — DIRECTIONAL_GAP (see C4a-5) |

### Modified files

| REQ | Category | Spec section | Requirement | Verdict |
|-----|----------|--------------|-------------|---------|
| REQ #4 | schema | plan.md:577 | `server/db/schema/tasks.ts` — add `delegationDirection: text('delegation_direction')` | PASS (typed via `$type<DelegationDirection>()`) |
| REQ #5 | export | plan.md:593; spec §15.8 | `agentExecutionEventService.ts` — export `insertExecutionEventSafe(input)`; on failure WARN tag `delegation_event_write_failed`; fire-and-forget | PASS |
| REQ #6 | behavior | plan.md:579–584; spec §6.3 | `spawn_sub_agents`: requires `context.hierarchy`; `subaccount` scope → rejects; classifies targets; any-out-of-scope → rejects entire batch with rows for out-of-scope targets only; depth check; nesting block removed | PASS (core behaviour) |
| REQ #7 | behavior | plan.md:585–592; spec §6.4 | `reassign_task`: requires `context.hierarchy`; upward-escalation check BEFORE scope validation; non-root + subaccount → `cross_subtree_not_permitted`; writes `tasks.delegation_direction`; dual-writes on rejection | PASS |
| REQ #8 | docs | plan.md:594 | `server/skills/spawn_sub_agents.md` — `delegationScope` parameter documented | PASS |
| REQ #9 | docs | plan.md:595 | `server/skills/reassign_task.md` — `delegationScope` parameter + upward-escalation note | PASS |

### Invariants

| REQ | Category | Spec section | Requirement | Verdict |
|-----|----------|--------------|-------------|---------|
| REQ #10 | INV-1 | plan.md:606; spec §10.6 | Every write site sources `runId` from `context.runId` | PASS |
| REQ #11 | INV-2 | plan.md:607; spec §4.3 | Error envelope `{ code, message, context }` with `runId` + `callerAgentId` | PARTIAL — telemetry events PASS; skill return value returns flat `error: <string>` instead of nested object (DIRECTIONAL_GAP C4a-6) |
| REQ #12 | INV-2 subfield | spec §4.3 | `delegation_out_of_scope` context: `targetAgentId + delegationScope + callerChildIds` with 50-element truncation + `truncated: true` | PASS (skillExecutor.ts:3579, 3847) |
| REQ #13 | INV-2 subfield | spec §4.3 | `cross_subtree_not_permitted` context: `callerParentId + suggestedScope` | PASS (skillExecutor.ts:3578, 3717–3722) |
| REQ #14 | INV-2 subfield | spec §4.3 | `hierarchy_context_missing` context: `skillSlug` | PASS (skillExecutor.ts:3444, 3683) |
| REQ #15 | INV-3 | plan.md:608; spec §15.6 / §15.8 | Both `insertOutcomeSafe` + `insertExecutionEventSafe` fire-and-forget; distinct WARN tags; never inside a transaction | PASS (`void` at call sites; distinct tags `delegation_outcome_write_failed` vs `delegation_event_write_failed`) |
| REQ #16 | behavior | plan.md:584; spec §2.2 line 784 | `isSubAgent` nesting-block hard-guard at line ~3415 DELETED — multi-level fan-out allowed up to `MAX_HANDOFF_DEPTH` | PASS (no guard-block found; `isSubAgent` remains only as input param + marker field on child runs) |
| REQ #17 | behavior | spec §6.3 step 2 | `cross_subtree_not_permitted` on spawn writes one rejection row per proposed target | PASS (loop at skillExecutor.ts:3723–3735) |
| REQ #18 | behavior | spec §6.3 step 4 | `delegation_out_of_scope` on spawn writes rejection rows for out-of-scope targets ONLY (not in-scope siblings) | PASS (filter at skillExecutor.ts:3825; loop at 3826–3838) |
| REQ #19 | behavior | plan.md:590 | `reassign_task` writes `tasks.delegation_direction` on critical path (must succeed) | PASS (skillExecutor.ts:3611–3618; non-void await inside outer try/catch) |

**Accepted per user invocation (out-of-scope for verification):**
- `callerAgentId` / `targetAgentId` in `insertOutcomeSafe` use `subaccount_agents.id` values — accepted
- New `tool.error` event type in `AgentExecutionEventType` — accepted

---

## Mechanical fixes applied

None. All gaps are DIRECTIONAL — either (a) require a new test-architecture pattern, or (b) involve a return-shape contract change that needs an architect decision.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

| REQ | Gap | Routed to |
|-----|-----|-----------|
| C4a-1 | `spawn_sub_agents` test: `effectiveScope === 'subaccount'` → `cross_subtree_not_permitted` | `tasks/todo.md` § *Deferred from spec-conformance review — paperclip-hierarchy-chunk-4a* |
| C4a-2 | `spawn_sub_agents` test: depth-limit → `max_handoff_depth_exceeded` | same |
| C4a-3 | `spawn_sub_agents` test: `context.hierarchy` undefined → `hierarchy_context_missing` | same |
| C4a-4 | `spawn_sub_agents` test: adaptive-default-no-children → subaccount → reject (end-to-end chain) | same |
| C4a-5 | `reassign_task` test: `context.hierarchy` undefined → `hierarchy_context_missing` | same |
| C4a-6 | Skill-handler return shape: flat `error: <string>` vs. spec §4.3's nested `error: { code, message, context }` | same |

### Reasoning

**Test-coverage gaps (C4a-1..C4a-5) are DIRECTIONAL.**
The existing test files are pure-helper tests — they import `classifySpawnTargets`, `resolveWriteSkillScope`, `computeReassignDirection`, `validateReassignScope` from `skillExecutorDelegationPure.ts` and exercise them in isolation. The missing spec scenarios all live in the outer `executeSpawnSubAgents` / `executeReassignTask` handler functions, which require `SkillExecutionContext` fixtures, DB mocks, and logger/event-writer mocks. Adding those tests requires a design choice: (a) extract each handler gate into more pure helpers (consistent with existing pattern), or (b) introduce a new integration-test architecture. Either approach is valid; picking one is a design decision for the main session.

**Return-shape gap (C4a-6) is DIRECTIONAL.**
Spec §4.3 mandates `{ success: false, error: { code, message, context } }`. Current return shape is `{ success: false, error: <flat code string>, context: <ctx> }`. The telemetry event payloads (`insertExecutionEventSafe` calls) use the correct nested envelope, so the divergence is in the skill return value only. Fixing it would cascade to (a) the LLM tool-result JSON serialization, (b) `executeWithActionAudit` wrapper, and (c) inconsistency vs. dozens of other skills in the same file that still return `error` as a string. This needs an architect decision on whether §4.3 is new-delegation-skills-only or whether skillExecutor as a whole should migrate.

**What PASSED is load-bearing.**
The critical enforcement paths — hierarchy-missing fail-closed, subaccount-scope reject, out-of-scope classification with rejection rows for out-of-scope targets only, upward-escalation special case running before scope validation, `tasks.delegation_direction` write on the critical path, nesting-block removal, runId continuity, dual-write fire-and-forget semantics, distinct WARN tags — all pass.

---

## Files modified by this run

- `tasks/todo.md` — appended `## Deferred from spec-conformance review — paperclip-hierarchy-chunk-4a (2026-04-23)` section with 6 items

No code files were modified.

---

## Next step

**NON_CONFORMANT — 6 directional gaps must be triaged by the main session before `pr-reviewer`.**

Per the `CLAUDE.md` contract for processing `spec-conformance` NON_CONFORMANT findings:

1. **REQ #C4a-1 through #C4a-5** (test gaps) — non-architectural. Triage whether to (a) expand `skillExecutorDelegationPure.ts` with more pure helpers and extend the existing pure-test files, or (b) add a behavioural/mocked integration test file. Pick one, implement in-session, then re-invoke `spec-conformance` to confirm closure. Max 2 re-invocations.

2. **REQ #C4a-6** (return-shape contract) — architectural (contract change with cross-skill ripple). Leave in the dated `## Deferred from spec-conformance review` section AND promote into `## PR Review deferred items / ### paperclip-hierarchy` so it survives review cycles. Do not re-invoke `spec-conformance` for this item — escalate to architect/user.

Do not proceed to `pr-reviewer` until REQ #C4a-1 through #C4a-5 are resolved or explicitly deferred by the user.
