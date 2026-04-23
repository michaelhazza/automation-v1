# Spec Conformance Log

**Spec:** `tasks/builds/paperclip-hierarchy/plan.md` (Chunk 4c, lines 663–699) + `docs/hierarchical-delegation-dev-spec.md` §7.2, §8.2
**Spec commit at check:** `7332ba4d`
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Base:** `399f3864`
**Scope:** Chunk 4c — Delegation graph route + service + DelegationGraphView
**Changed-code set:** 7 files (as provided by caller)
**Run at:** 2026-04-23T22:05:43Z
**Commit at finish:** `3d6b5681`

---

## Summary

- Requirements extracted:     22
- PASS:                       18
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 3
- AMBIGUOUS → deferred:       1
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (4 non-blocking deferred items — all UI-rendering / spec-vs-reality divergences in `DelegationGraphView.tsx` + `RunTraceViewerPage.tsx`. Backend & pure-function implementation is fully conformant.)

---

## Requirements extracted (full checklist)

| # | Category | Spec section | Requirement | Verdict |
|---|----------|--------------|-------------|---------|
| C4c-1 | file | plan.md:668 | `server/services/delegationGraphService.ts` exports `buildForRun(runId, orgId): Promise<DelegationGraphResponse>` | PASS |
| C4c-2 | behavior | plan.md:668, spec §7.2 | Single `orgScopedDb` lookup of opened run; 404 if not visible | PASS |
| C4c-3 | behavior | plan.md:668, spec §7.2 | Recursive walk on `parentRunId === current.id OR handoff_source_run_id === current.id`, bounded by `MAX_HANDOFF_DEPTH + 1 = 6` | PASS |
| C4c-4 | behavior | plan.md:668 | Denormalise agent name at node assembly (join to `agents`/`subaccount_agents`) | PASS |
| C4c-5 | file | plan.md:669 | `server/services/delegationGraphServicePure.ts` exports `assembleGraphPure({ rootRunId, rows })` returning `{ rootRunId, nodes, edges }` | PASS |
| C4c-6 | behavior | plan.md:669 | Dedup nodes by runId; one spawn edge per `parentRunId`; one handoff edge per `handoff_source_run_id`; direction from child's `delegation_direction` | PASS |
| C4c-7 | test | plan.md:670 | Pure test covers: depth-bound, both edge types, dual-parent → 2 edges, direction preserved, dedup, no-inbound-root | PASS |
| C4c-8 | file | plan.md:671 | `client/src/components/run-trace/DelegationGraphView.tsx` consumes `GET /api/agent-runs/:id/delegation-graph` | PASS |
| C4c-9 | behavior | plan.md:671 | Renders nodes with agent name, status badge, scope chip (if non-null), hierarchyDepth badge | PASS |
| C4c-10 | behavior | plan.md:671, spec §8.2 | Edges: spawn solid, handoff distinct. Direction-colour: down green solid, up amber dashed, lateral amber dotted | DIRECTIONAL_GAP |
| C4c-11 | behavior | plan.md:671, spec §8.2 | Click node → navigate to that run's trace tab (in-place, preserves graph selection) | DIRECTIONAL_GAP |
| C4c-12 | behavior | plan.md:671 | Root expanded by default; descendants collapsed; refresh button triggers refetch; no WebSocket | DIRECTIONAL_GAP |
| C4c-13 | test | plan.md:671 | No test file for `DelegationGraphView.tsx` | PASS |
| C4c-14 | file | plan.md:674 | `server/routes/agentRuns.ts` mounts `GET /api/agent-runs/:id/delegation-graph` with `authenticate` + service-layer org check | PASS |
| C4c-15 | file | plan.md:675 | `RunTraceViewerPage.tsx` adds a "third tab" labelled "Delegation graph" that renders `<DelegationGraphView />`; existing Trace + Payload tabs unchanged | AMBIGUOUS |
| C4c-16 | contract | plan.md:681 | Truncation branch: flag on response when fan-out exceeds 6 levels | PASS |
| C4c-17 | contract | plan.md:680, spec §7.2 | `direction` / `scope` read from each node's own `agent_runs` row (null for opened root iff not dispatched by a skill) | PASS |
| C4c-18 | contract | spec §7.2 | `DelegationGraphResponse` shape: `{ rootRunId, nodes, edges }` | PASS |
| C4c-19 | contract | spec §7.2 | `DelegationGraphNode` has 10 named fields (runId, agentId, agentName, isSubAgent, delegationScope, hierarchyDepth, delegationDirection, status, startedAt, completedAt) | PASS |
| C4c-20 | contract | spec §7.2 | `DelegationGraphEdge` has `parentRunId`, `childRunId`, `kind` | PASS |
| C4c-21 | behavior | plan.md:696 | Cross-org access rejected (404) via `orgScopedDb` RLS | PASS |
| C4c-22 | validation | plan.md:688–692 | Static gates pass: typecheck (no new errors), lint, client build, pure test (9/9) | PASS |

---

## Mechanical fixes applied

None. No MECHANICAL_GAP findings in this run.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

- REQ #C4c-10 — Direction colour/style applied to text badge beside the node name, not to the edge/arrow connecting parent to child. Spec §8.2 explicitly says "Arrow colour / icon coding by delegationDirection". The implementation's text-only `→ spawn` / `⇢ handoff` lines between nodes are visually distinguishable but do not carry direction colour.
- REQ #C4c-11 — Node-click navigation remounts `RunTraceViewerPage` and resets the active tab to "trace", losing the graph-tab selection. Spec §8.2 says "in-place, preserves the graph selection".
- REQ #C4c-12 — Initial collapse state uses `useState(depth > 1)`, which expands root AND depth-1 direct children. Spec says "descendants collapsed" (i.e. only root node expanded).
- REQ #C4c-15 — Plan says "add a third tab ... Existing tabs (Trace, Payload) unchanged", but the pre-chunk `RunTraceViewerPage.tsx` had no tabs at all. Implementation introduced a two-tab surface (Trace + Delegation Graph). This is a spec-vs-reality contradiction, not an implementation defect — needs a human call on whether a Payload tab should be (re-)introduced as a separate tab or whether the two-tab surface is the final intended shape.

All four items appended to `tasks/todo.md` under a new dated section.

---

## Files modified by this run

None. No mechanical fixes were applied. Only this log file and `tasks/todo.md` were written.

---

## Next step

NON_CONFORMANT — 3 directional gaps and 1 ambiguous item routed to `tasks/todo.md`. None are architectural (all are UI polish + one spec/reality contradiction on tab count). The caller should:

1. Resolve C4c-10 / C4c-11 / C4c-12 in-session (UI adjustments, no contract changes) and re-invoke `spec-conformance` to confirm closure.
2. Get a human call on C4c-15 (was the "third tab" language a typo in the plan? Is Payload a separate tab, a sidebar pane, or out-of-scope?). If this is confirmed as "two-tab surface is fine", mark C4c-15 closed in `tasks/todo.md` without a re-invocation.

Backend & pure-function implementation are fully conformant — the route, service, pure helper, types, and tests all match the spec exactly.
