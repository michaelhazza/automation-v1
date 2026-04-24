# Spec Conformance Log — paperclip-hierarchy (whole-branch)

**Spec:** `docs/hierarchical-delegation-dev-spec.md`
**Plan:** `tasks/builds/paperclip-hierarchy/plan.md`
**Spec commit at check:** working tree (HEAD `8172608f`)
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Base:** `main`
**Scope:** whole spec / all four phases (progress.md and recent commits confirm Phase 4 finalized)
**Changed-code set:** 90+ files (committed only; staged/unstaged/untracked trees all empty)
**Run at:** 2026-04-23T23:05:56Z
**Commit at finish:** `2b092f4a`

Invoked as a caller-confirmed all-of-spec pass on a completed implementation (commit `8172608f` finalizes Phase 4). Each phase had its own per-chunk `spec-conformance` run during development; this pass catches anything that may have slipped through phase boundaries.

---

## Summary

- Requirements extracted:     67
- PASS:                       66
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 1 (WB-1)
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT — one INV-1 gap surfaced. The gap is architectural (cross-cutting, design call required on `parentRunId` semantics for handoff runs), so it is routed to `tasks/todo.md` rather than fixed in-session.

---

## The one gap — REQ #WB-1 (DIRECTIONAL)

**Spec quote:**
- §5.3: *"When `reassign_task` dispatches a handoff, the NEW run's `agent_runs.handoff_source_run_id` is set to the calling run's id (the run that invoked `reassign_task`)."*
- §10.6.2 INV-1 clause 2: *"`handoffSourceRunId` MUST equal the `SkillExecutionContext.runId` of the `reassign_task` call. Never null, never rewritten."*

**What's implemented vs what the spec requires:**

| Layer | State |
|-------|-------|
| Schema column `agent_runs.handoff_source_run_id` | present (`agentRuns.ts:211`, migration 0204) |
| Graph read path (`delegationGraphServicePure.ts:72-77`) | reads the column to emit handoff edges |
| Handoff-edge pure test (`delegationGraphServicePure.test.ts:101+`) | passes with synthetic rows |
| `AgentRunRequest` field | MISSING |
| `agent_runs` INSERT propagation (`agentExecutionService.ts:395-412`) | MISSING |
| Handoff worker plumbing (`agentScheduleService.ts:127`) | MISSING — `sourceRunId` is routed to `parentRunId` |

**Consequences (end-to-end):**
- In production, `agent_runs.handoffSourceRunId` is always NULL on handoff runs → the graph route's handoff-edge emission never fires → users see a disconnected or empty delegation graph for multi-agent Briefs that involved reassignment.
- Pure graph code also gates spawn-edge emission on `isSubAgent`, so a handoff run (`isSubAgent=false`) yields zero edges today even though `parentRunId` happens to be populated — a "disappears from the graph" footgun.
- INV-1.3 ("both pointers when both caused it") cannot be satisfied because `parentRunId` is currently reused for the handoff lineage, colliding with its spawn use.
- INV-1.4 telemetry alignment (`delegation_outcomes.runId === child.handoffSourceRunId` for handoffs) can't be checked — the RHS is null.

**Why DIRECTIONAL, not MECHANICAL:**
- Fix requires coordinated edits to ≥3 files (`AgentRunRequest` type, `agentExecutionService` INSERT, `agentScheduleService` worker, plus the `enqueueHandoff` payload) and a design call: keep `parentRunId` set for handoff runs (legacy code at `agentExecutionService.ts:1226-1232` and `agentActivityService.getRunChain` both read `parentRunId` for handoff-chain reconstruction) or migrate them to read `handoffSourceRunId`. Either choice has cross-cutting impact.
- Per Step 3 decision order: "Cross-cutting change (touches many files, affects contracts shared by other code)" → DIRECTIONAL. Not mechanical even though the spec explicitly names the column.

**Routed to:** `tasks/todo.md` → new dated section `## Deferred from spec-conformance review — paperclip-hierarchy (2026-04-23)`.

## Requirements verified (full checklist)

### Phase 1 — Observability foundations (PASS)

1. `shared/types/delegation.ts` — DelegationScope + DelegationScopeSchema + DelegationDirection + error-code constants + HierarchyContext + DelegationOutcome + graph types. Present.
2. Migration `0204_agent_runs_delegation_telemetry.sql` — four columns + two CHECK constraints + two partial indexes. Exact match to spec §5.3.
3. Migration `0205_delegation_outcomes.sql` — six FKs + four CHECKs + three indexes + `ENABLE RLS` + `FORCE ROW LEVEL SECURITY` + policy with USING+WITH CHECK. Exact match to spec §5.4.
4. `server/db/schema/delegationOutcomes.ts` — Drizzle table matches migration.
5. `server/db/schema/agentRuns.ts:208-211` — four new columns with proper types.
6. `server/db/schema/index.ts:217` — exports delegationOutcomes.
7. `server/config/rlsProtectedTables.ts:461-466` — delegation_outcomes manifest entry.
8. `delegationOutcomeService.insertOutcomeSafe` — single-round-trip integrity check, swallows on failure, WARN tag `delegation_outcome_write_failed` at each exit path (shape-fail, actor-mismatch, DB-fail).
9. `delegationOutcomeService.recordOutcomeStrict` — throws, JSDoc warns skill handlers never to call it.
10. `delegationOutcomeService.list` — filters, `limit` clamp, `since` default 7d, ORDER BY created_at DESC.
11. `delegationOutcomeServicePure.assertDelegationOutcomeShape` — replicates all four DB CHECK constraints.
12. `delegationOutcomeServicePure.buildListQueryFilters` — clamps `limit` to 500, defaults `since` to 7 days ago, drops invalid enum values.
13. Workspace-health detector `subaccountMultipleRoots` — severity `critical`, registered in `ASYNC_DETECTORS`.
14. Workspace-health detector `subaccountNoRoot` — severity `info`, registered.
15. `server/routes/delegationOutcomes.ts` — authenticated + `requireOrgPermission('org.observability.view')`.
16. `server/lib/permissions.ts:90` — `ORG_OBSERVABILITY_VIEW` added to ALL_PERMISSIONS and the `org_admin` template (line 270).
17. Router mounted at `server/index.ts:349`.
18. Pure tests for all three Phase-1 detectors + delegationOutcomeServicePure present.

### Phase 2 — Root contract + routing + picker (PASS)

19. Migration `0202_subaccount_agents_root_unique.sql` — partial unique index present and Drizzle-reflected at `subaccountAgents.ts:115-117`.
20. `scripts/audit-subaccount-roots.ts` + pure helper + pure test present.
21. `hierarchyRouteResolverService.resolveRootForScope` — impure wrapper with short-circuit on `system`, selective org-link fetch, deterministic oldest-root pick.
22. `hierarchyRouteResolverServicePure.resolveRootForScopePure` — full decision tree including zero/one/many/null-subaccountId branches, `fallback` flag.
23. Pure tests for resolver present.
24. `orchestratorFromTaskJob` reads `payload.scope ?? 'subaccount'`, calls resolver, writes WARN on `fallback: 'org_root'`, writes conversation error artefact on null-system-scope result. `ORCHESTRATOR_AGENT_SLUG` retained in the resolver's org-level lookup.
25. `briefCreationService.ts:75-84` — enqueue call passes `{ scope: fastPathDecision.scope }` through.
26. `hierarchyTemplateService.apply()` — same-tx root rotation (deactivate prior active root before inserting new roots, lines 432-438, inside the transaction).
27. Seed manifest — `orchestrator` is the only `reportsTo: null`; `portfolio-health-agent` now has `reportsTo: "orchestrator"` (lines 15-18, 165-168).
28. `StartingTeamPicker.tsx` — controlled select, loads `/api/hierarchy-templates`, surfaces loading/error/empty states, description-on-select.
29. `AdminSubaccountsPage.tsx` — wires picker into create flow, calls `POST /api/hierarchy-templates/:id/apply` after `POST /api/subaccounts`, shows inline warning on apply failure, does NOT roll back the subaccount.

### Phase 3 — Hierarchy context + visibility (PASS)

30. `hierarchyContextBuilderServicePure.buildHierarchyContextPure` — pure roster walk, deterministic `childIds` sort, depth cap at MAX_HIERARCHY_DEPTH, cycle detection, throws `HierarchyContextBuildError` with three typed codes.
31. `hierarchyContextBuilderService.buildForRun` — single indexed query + `Object.freeze` on both result and `childIds` (deep freeze).
32. Pure tests for builder present.
33. `SkillExecutionContext.hierarchy?: Readonly<HierarchyContext>` at `skillExecutor.ts:190`.
34. `agentExecutionService.executeRun` builds hierarchy BEFORE skill resolution (lines 625-656), logs WARN `hierarchy_not_built_for_run` on `HierarchyContextBuildError`, persists `hierarchy_depth` on the run row, falls through with undefined hierarchy on failure.
35. `configSkillHandlers.executeConfigListAgents` — adaptive default via `resolveEffectiveScope`, WARN `hierarchy_missing_read_skill_fallthrough` when context is missing, descendants walk via pure helper.
36. `executeConfigListSubaccounts` / `executeConfigListLinks` — scope accepted for signature consistency, no filter effect (documented in skill markdown files).
37. `configSkillHandlersPure.ts` — pure helpers (`computeDescendantIds`, `mapSubaccountAgentIdsToAgentIds`, `resolveEffectiveScope`).
38. Pure tests for config skill handlers present.
39. Skill markdown files — `config_list_agents.md`, `config_list_subaccounts.md`, `config_list_links.md` all document the `scope` parameter; `spawn_sub_agents.md` documents `delegationScope` with the `subaccount`-rejected note; `reassign_task.md` documents `delegationScope` with the upward-escalation special-case note.

### Phase 4 — Execution enforcement + derived skills + trace graph (PASS except WB-1)

40. Migration `0203_tasks_delegation_direction.sql` — column + CHECK.
41. `tasks.delegation_direction` Drizzle reflection present.
42. `spawn_sub_agents` handler (`skillExecutor.ts:3677+`) — all validation branches: `hierarchy_context_missing` fail-closed (3710-3720), `max_handoff_depth_exceeded` (3721-3723), `cross_subtree_not_permitted` on `subaccount` scope regardless of caller role with per-target rejection rows + tool.error (3724-3752), out-of-scope classification via pure helper with rejection rows only for out-of-scope targets (3830-3863), accepted path writes `delegation_direction='down'` + `delegation_scope=effectiveScope` onto each child `agent_runs` row via `executeRun({ delegationScope, delegationDirection })` (3915-3916), accepted delegation_outcomes rows via `insertOutcomeSafe` (3943-3953). Nesting block removed.
43. `reassign_task` handler (`skillExecutor.ts:3437+`) — `hierarchy_context_missing` fail-closed (3441-3457), upward-escalation special case BEFORE generic scope validation (3545-3556), `cross_subtree_not_permitted` when subaccount-scope caller is not root (via pure helper's `isCallerRoot` gate), `delegation_out_of_scope` for out-of-scope non-upward targets, `tasks.delegation_direction` written in the critical-path update (3614-3621), fire-and-forget `delegation_outcomes` rows for accepted + rejected, spec-minimum error `context` with `callerChildIds` truncated at 50 and `truncated: true` flag.
44. `skillServicePure.computeDerivedSkills` — returns the three delegation slugs when `childIds.length > 0`, empty otherwise.
45. `skillServicePure.shouldWarnMissingHierarchy` — WARN predicate extracted as pure.
46. `skillService.resolveSkillsForAgent` — unions derived slugs, logs WARN `hierarchy_missing_at_resolver_time`.
47. Pure test for resolver present.
48. `agentExecutionEventService.insertExecutionEventSafe` — swallow contract, WARN tag `delegation_event_write_failed` (distinct from outcome-write tag per spec §15.8).
49. `delegationGraphService.buildForRun` — orgScopedDb, 404 on missing run, BFS bounded to `MAX_DEPTH_BOUND=6`, one-query-per-level with `or(inArray(parentRunId), inArray(handoffSourceRunId))`, denormalised `agentName` via innerJoin.
50. `delegationGraphServicePure.assembleGraphPure` — dedup nodes by runId, two edge kinds (spawn + handoff), skips inbound edge for root. Pure test covers all cases.
51. `server/routes/agentRuns.ts:173-183` — `GET /api/agent-runs/:id/delegation-graph` mounted.
52. `DelegationGraphView.tsx` — renders nodes, status badge, scope chip, direction arrow/colour, navigate-in-place with state preservation, refresh button, no WebSocket.
53. `RunTraceViewerPage.tsx` — "Delegation Graph" tab mounted; `activeTab` initialiser reads `location.state.initialTab` to preserve the selection across child-run clicks.
54. `explicitDelegationSkillsWithoutChildren` detector — severity `info`, registered in Phase 4 only. Pure helper + test present.
55. `architecture.md` line 3033 — new "Hierarchical Agent Delegation" section covering hierarchy context + error codes + related contract surfaces.
56. Pure tests for `delegationGraphServicePure`, `skillExecutor.spawnSubAgents`, `skillExecutor.reassignTask` present.

### Cross-cutting invariants

57. INV-1 clause 1 (spawn: `parentRunId = context.runId`) — PASS.
58. INV-1 clause 2 (handoff: `handoffSourceRunId = context.runId`) — **FAIL** → REQ #WB-1.
59. INV-1 clause 4 (telemetry alignment) — PASS for spawns; impacted by WB-1 for handoffs.
60. INV-2 (uniform `{ code, message, context }` envelope, size bound 4 KiB, array truncation at 50, additive-only evolution) — PASS.
61. INV-3 (detached dual-writes with distinct WARN tags, strict variant for tests/backfills, post-commit sequencing) — PASS.
62. INV-4 (immutable hierarchy snapshot — `Readonly<>` + `Object.freeze` of both the object and `childIds`, built-once-per-run in `agentExecutionService`, no mid-run rebuild in `skillService`) — PASS.
63. Seed manifest dual-root cleanup pre-migration 0202 — PASS (one `reportsTo: null` remaining).
64. `verify-rls-coverage.sh` prerequisite (`delegation_outcomes` in manifest + migration in same commit history) — PASS.
65. `ORCHESTRATOR_AGENT_SLUG` retained for org-scope fallback only — PASS (resolver uses it in `resolveOrgLevelLink`).
66. Partial-slug-removal completed for subaccount-scope routing — PASS.
67. No backfill of `hierarchy_depth` / `delegation_scope` on historical `agent_runs` rows — PASS (nullable schema + no migration backfill).

## Mechanical fixes applied

None.

## Directional / ambiguous gaps (routed)

- **REQ #WB-1** → `tasks/todo.md` § *Deferred from spec-conformance review — paperclip-hierarchy (2026-04-23)*.

## Files modified by this run

None in-session. Only this log + an append to `tasks/todo.md` + the scratch file.

## Next step

**NON_CONFORMANT** — 1 directional gap (REQ #WB-1) must be addressed by the main session before `pr-reviewer` on the whole branch. The gap is architectural: it requires a design call on `parentRunId` vs `handoffSourceRunId` semantics across the run-chain reconstruction code, so it is routed to `tasks/todo.md` rather than patched in-session. The caller should process the dated todo.md section per CLAUDE.md's "Processing spec-conformance NON_CONFORMANT findings — standalone contract" rule (architectural gap → escalate to the user, do NOT re-invoke spec-conformance for closure).

All other spec requirements are met. Per-chunk spec-conformance runs for chunks 3a / 3b / 4a / 4b / 4c / 4d had already reached CONFORMANT or CONFORMANT_AFTER_FIXES; this whole-branch pass confirms their closures and surfaces the one cross-phase gap that escaped per-chunk scoping (the bug lives at the intersection of `agentExecutionService`, `agentScheduleService`, and the delegation-graph read path — each of which was reviewed in a different chunk).
