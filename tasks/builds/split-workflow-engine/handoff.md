---
build_slug: split-workflow-engine
branch: claude/split-workflow-engine
spec: tasks/builds/split-workflow-engine/spec.md
plan: tasks/builds/split-workflow-engine/plan.md
progress: tasks/builds/split-workflow-engine/progress.md
phase_2_complete_at: 2026-05-15T04:03:50Z
---

# Handoff — split-workflow-engine

## Phase 2 (BUILD) — complete

**Branch:** `claude/split-workflow-engine` off `origin/main` @ `76377549`
**Completed:** 2026-05-15T04:03:50Z | **Task class:** Significant
**Plan locked:** 2026-05-15T03:40:00Z (4 review rounds, 14 findings closed)

### What was built

Decomposed `server/services/workflowEngineService.ts` (4,074 LOC) into a module tree under `server/services/workflowEngine/`: constants.ts, types.ts, definitionHelpers.ts, contextHelpers.ts, readySet.ts, stepLifecycle.ts, and queueLifecycle/{tick.ts, dispatch.ts, agentStep.ts, watchdog.ts, registerWorkers.ts}. Barrel thinned to ~52 LOC.

**Permissions (Chunk 9):** Migration `0359_workflow_runs_org_permissions.sql` adds 4 org-tier permissions. 9 route gates in `server/routes/workflowRuns.ts` migrated from `AGENTS_VIEW`/`AGENTS_EDIT` to specific `WORKFLOW_RUNS_*` permissions. Org Manager and Org Viewer templates updated.

**Doc-sync (Chunk 10):** `architecture.md` updated with workflowEngine sub-tree + dependency direction. `DEVELOPMENT_GUIDELINES.md` +1 Q4 convention. `KNOWLEDGE.md` +1 Q5 pattern (FK-scoped tenant data is not RLS-protected).
### Deferred chunks

**Chunk 7 (db scoping — WF3/WF4/WF6):** Migrating raw `db.*` to `getOrgScopedDb()` requires cross-tenant lookup via pooled `withAdminConnection`, manual `db.transaction()`, `SET LOCAL app.organisation_id`, `withOrgTx` wrapping, and a connection-pinned advisory lock helper (pg advisory locks are session-scoped; `withAdminConnection` uses pooled connections). Plus clearing 23 baseline entries from `guard-baselines.json` and adding 2 named-exception entries. Risk of breaking the working structural split too high. Deferred per plan escape hatch.

**Chunk 8 (RLS migration — WF1):** Hard dependency on Chunk 7. Workflow engine tables' RLS policies check `app.organisation_id` GUC. Tick/watchdog/agentStep workers run with `resolveOrgContext: () => null` (no GUC set), so RLS would deny all their DB operations if applied before Chunk 7 lands.

Both are targeted for a follow-up PR once the db-scoping semantic migration is complete.

**Migration numbering note:** Permissions landed as `0359_workflow_runs_org_permissions.sql`. The deferred RLS migration (Chunk 8 / WF1) cannot also use 0359. The follow-up builder must use the next available migration number at the time that PR is created (at minimum 0360, but check `migrations/` — `origin/main` may have advanced past that).
### Post-dev gate results

- `npm run lint`: PASS (0 errors, 888 pre-existing warnings)
- `npm run typecheck`: PASS (2 pre-existing `docx`/`mammoth` errors in unrelated untouched files)
- `npm run build:client`: PASS
- `npm run build:server`: same 2 pre-existing errors only

**Import path fixes:** All 8 workflowEngine sub-modules had import paths relative to `server/services/` instead of their actual depth (`server/services/workflowEngine/` or `server/services/workflowEngine/queueLifecycle/`). Fixed by adding one extra `../` level to all external imports (db, lib, shared, sibling services) across: types.ts, readySet.ts, stepLifecycle.ts, definitionHelpers.ts, contextHelpers.ts, constants.ts, and all 5 queueLifecycle files.
### Review posture

Task class: **Significant**. The branch-level review pass was NOT completed in Phase 2 (session ran out of context before the review step). All reviewers are pending for Phase 3.

**REVIEW_GAP entries:**
```
REVIEW_GAP: chunk-7 | task-class: Significant | reason: db-scoping semantic migration deferred; baseline update complexity exceeds session risk threshold | operator-override: no | remediation: land as follow-up PR after rls-coverage and with-org-tx gates verified against the new sub-module tree
REVIEW_GAP: chunk-8 | task-class: Significant | reason: RLS migration deferred with chunk-7; engine must use getOrgScopedDb before RLS policies enforce or tick breaks | operator-override: no | remediation: land in same follow-up PR as chunk-7 once db-scoping complete
REVIEW_GAP: spec-conformance | task-class: Significant | reason: not run in Phase 2 (session ran out of context before branch-level review pass) | operator-override: no | remediation: run spec-conformance before chatgpt-pr-review in Phase 3
REVIEW_GAP: pr-reviewer | task-class: Significant | reason: not run in Phase 2 (session ran out of context) | operator-override: no | remediation: run pr-reviewer before chatgpt-pr-review in Phase 3
REVIEW_GAP: reality-checker | task-class: Significant | reason: not run in Phase 2 | operator-override: no | remediation: run after pr-reviewer in Phase 3
REVIEW_GAP: dual-reviewer | task-class: Significant | reason: not run in Phase 2 (Codex CLI unavailable + session ran out of context) | operator-override: no | remediation: run if Codex available; otherwise chatgpt-pr-review serves as primary second-opinion
```
### Spec deviations

**D1** — Spec §1.3 named the 5 tables as `workflow_runs`, `workflow_run_steps`, `workflow_step_runs`, `workflow_definitions`, `workflow_audit_events`. Architect chunk-0 sweep confirmed the actual table names differ: `workflow_run_steps`, `workflow_definitions`, `workflow_audit_events` do not exist. Audit-correct five FK-scoped tables lacking RLS (per WF1 in `tasks/todo.md`): `workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs`. These are the authoritative targets for the Chunk 8 / WF1 follow-up PR.

**D2** — Spec §1.6 / §4.3 referenced `AGENT_STEP_QUEUE` exposure. Plan decision: `AGENT_STEP_QUEUE` is NOT exported from the barrel (internal implementation detail).

**D3** — Spec §1.5 implied 3 permission keys. Plan revised to 4 keys based on route analysis: `WORKFLOW_RUNS_VIEW`, `WORKFLOW_RUNS_START` (replay), `WORKFLOW_RUNS_CANCEL`, `WORKFLOW_RUNS_EDIT_OUTPUT`, `WORKFLOW_RUNS_APPROVE`.

spec_deviations: D1 (table names), D2 (AGENT_STEP_QUEUE not exposed), D3 (permission count 3→4+1=5 including START)
### WF todo item status

| Item | Status |
|---|---|
| WF1 (RLS for 5 tables) | open — chunk-8 deferred |
| WF2 (structural split) | closure-pending-merge:slug:split-workflow-engine |
| WF3 (raw db→getOrgScopedDb) | open — chunk-7 deferred |
| WF4 (tick resolveOrgContext null fix) | open — chunk-7 deferred |
| WF5 (WORKFLOW_RUNS_* permissions) | closure-pending-merge:slug:split-workflow-engine |
| WF6 (workflowAgentRunHook raw db) | open — chunk-7 deferred |
| WF8 (API route permission gates) | closure-pending-merge:slug:split-workflow-engine |
### Key files changed

New: `server/services/workflowEngine/{constants,types,definitionHelpers,contextHelpers,readySet,stepLifecycle}.ts`, `server/services/workflowEngine/queueLifecycle/{tick,dispatch,agentStep,watchdog,registerWorkers}.ts`, `migrations/0359_workflow_runs_org_permissions.{sql,down.sql}`

Modified: `server/services/workflowEngineService.ts` (barrel), `server/lib/permissions.ts`, `server/routes/workflowRuns.ts`, `tasks/todo.md`, `architecture.md`, `DEVELOPMENT_GUIDELINES.md`, `KNOWLEDGE.md`
