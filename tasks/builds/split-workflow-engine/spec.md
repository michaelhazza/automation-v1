---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: split-workflow-engine
output_location: tasks/builds/split-workflow-engine/spec.md
pattern_setter: tasks/builds/feat-split-skillexecutor/spec.md
companion: tasks/builds/feat-split-agentexecutionservice/spec.md
adopts_conventions_from: tasks/builds/feat-split-skillexecutor/spec.md § 5
---

# Wave 1 Env A — split workflowEngineService + WF1 RLS + WF5 perms

Combines three concerns under one Wave 1 spec because all three touch the workflow subsystem and need to land coherently before pre-v1 dev lockdown:

1. Decompose `server/services/workflowEngineService.ts` (4,074 LOC) into cohesive sub-modules.
2. Add Postgres RLS policies for the 5 workflow tables that currently have ZERO RLS coverage (Track A2 finding WF1).
3. Add a `WORKFLOW_RUNS_*` permission family and migrate workflow-run routes off the `AGENTS_VIEW` perm they incorrectly inherit (Track A2 finding WF5).

Adopts `§5 Module-Decomposition Conventions` of `tasks/builds/feat-split-skillexecutor/spec.md` by reference.

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Workflow Runtime |
| Capability owner | platform |
| Lifecycle state on launch | Mature |
| Risk surface | workflow runtime + tenant isolation (RLS) + permissions |
| Review cadence | on-incident-only |

`WorkflowEngineService` is already `Mature` on the asset register. This build refactors an existing capability; it does not register a new one.

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | S | No new capability acquired; reorganises existing code |
| Build | M-L | 4,074 LOC + RLS migration for 5 tables + perm family addition |
| Carry | S | Smaller modules reduce blast radius; RLS closes a current tenant-isolation hole |
| decommission | S | Barrel pattern decommissions cleanly |
## 1. Goals

1. Reduce `server/services/workflowEngineService.ts` from 4,074 LOC to a thin barrel (target < 250 LOC) re-exporting the public surface from sub-modules.
2. Decompose the file along its three natural queue lifecycles — **tick**, **watchdog**, **agent-step** — plus shared helpers (definition rehydration, ready-set computation, context management).
3. Add Postgres RLS policies for the five tenant-scoped workflow tables that currently have zero policy coverage. The exact table names are confirmed by the architect's chunk-0 sweep against `server/db/schema/` and the audit log; the five tables flagged in `tasks/todo.md` Track A2 WF1 are authoritative. Expected set: `workflow_runs`, `workflow_run_steps`, `workflow_step_runs`, `workflow_definitions`, `workflow_audit_events`.
4. Add table entries to `server/config/rlsProtectedTables.ts`. `verify-rls-coverage.sh` must continue to pass.
5. Add a `WORKFLOW_RUNS_VIEW`, `WORKFLOW_RUNS_EXECUTE`, `WORKFLOW_RUNS_CANCEL` permission family. Wire workflow-run routes to gate on these instead of `AGENTS_VIEW`.
6. Migrate raw `db` calls inside the workflow-engine to `getOrgScopedDb()` (closes Track A2 WF3: raw `db` 18x, `getOrgScopedDb` 0x).
7. Fix the tick worker's `resolveOrgContext: () => null` pattern (closes Track A2 WF4). Tick workers MUST resolve a real org context from the run row before opening DB transactions.
8. Fix `workflowAgentRunHook.ts:36-39` raw `db` to use `getOrgScopedDb()` (closes Track A2 WF6).
9. Preserve the public API exactly. Every caller named in §4 must compile without source edits beyond following barrel re-exports.

## 2. Non-Goals

- No behaviour change in workflow execution semantics.
- No new workflow features, no new step types, no new audit events.
- No changes to `WorkflowDefinition`, `WorkflowStep`, `WorkflowRun`, `WorkflowStepRun` type shapes beyond moving them into `types.ts` if they live inline today.
- No changes to queue names (`workflow-run-tick`, `workflow-watchdog`, `workflow-agent-step`) or job config keys.
- No drive-by lint cleanup, no unrelated refactors.
- No splitting of `server/jobs/workflowJob.ts` or any caller — out of scope.
- No re-shaping of the `pg_boss` integration patterns.

## 3. Framing Assumptions

- Repo is pre-production per `docs/spec-context.md`; testing posture is `static_gates_primary`. No new unit tests required for the split itself; if `*Pure.ts` extraction surfaces during decomposition, tests follow the pattern from the pattern-setter spec.
- `WorkflowEngineService` (line 792 in the current file) is the only external public-API entry point. Internal helper functions (`rehydrateDefinition`, `findStepInDefinition`, `computeReadySet`, `mergeStepOutputIntoContext`, etc.) are private to the module today and remain private after the split.
- The five RLS-uncovered tables hold tenant-private data; app-layer org filtering is currently the only defence. Postgres RLS policies must follow the canonical patterns documented in `architecture.md` (direct `organisation_id` column OR parent-EXISTS for FK-only tenant-scoped tables).
- Adding `WORKFLOW_RUNS_*` perms requires updating the central permission enum and adding seed data for default role grants. Default grants — operator confirms during plan phase:
  - `org-admin`: VIEW + EXECUTE + CANCEL
  - `operator`: VIEW + EXECUTE
  - `viewer`: VIEW only
- Callers using `AGENTS_VIEW` for workflow-run access must migrate to `WORKFLOW_RUNS_VIEW`. Each is identified by the architect's chunk-0 caller sweep.
- TypeScript strict mode is on. The existing tsconfig path mapping is immutable for this build.
- Five callers import from `workflowEngineService.ts` (confirmed via `grep -r "from.*workflowEngineService"`). The architect's plan must include a full caller sweep to confirm the list.
## 4. Public-Surface Lock

These exports of `server/services/workflowEngineService.ts` MUST remain importable from `server/services/workflowEngineService.js` at the end of the migration with identical types and runtime semantics:

| Export | Kind | Notes |
|---|---|---|
| `WorkflowEngineService` | object (const at line 792 today) with `enqueueTick`, tick handler, watchdog handler, agent-step handler, plus queue-name re-exports | Locked surface. Architect enumerates each method on the object during chunk-0 caller sweep. |
| `TICK_QUEUE`, `WATCHDOG_QUEUE`, `AGENT_STEP_QUEUE` | constants exposed via `WorkflowEngineService.TICK_QUEUE` etc. | Locked. Move to `constants.ts` inside the new module directory; re-export through the barrel. |
| Any types exported alongside the service (likely `WorkflowDefinition`, `WorkflowStep`, `WorkflowRun`, `WorkflowStepRun`, `RunContext`) | exported types | Architect confirms exact list during chunk 0. Locked if exported today. |

5 confirmed callers (architect runs a full sweep at chunk 0 for completeness):
- `server/jobs/workflowJob.ts`
- `server/services/workflowAgentRunHook.ts`
- `server/routes/workflows.ts` (or equivalent — confirm)
- `server/services/agentExecutionService/**` (likely via the workflow-spawning path)
- One additional caller — architect identifies

## 5. Module-Decomposition Conventions

### 5.1. Reference to pattern-setter

Adopts §5.1 (naming conventions), §5.4 (Pure / impure separation rules), §5.5 (Module-level state rules), and §5.6 (Test-collocation rule) from `tasks/builds/feat-split-skillexecutor/spec.md` verbatim.

This build does NOT introduce a §5.2.1-style "stub / thin-dispatcher placement rule" — `workflowEngineService.ts` has no handler registry equivalent. The three queue handlers are bespoke functions; decomposition is by queue lifecycle, not enumerable handler set.

### 5.2. Directory layout

The barrel (`workflowEngineService.ts`) stays at `server/services/workflowEngineService.ts`. Split contents live at `server/services/workflowEngine/` (directory drops the "Service" suffix — matches the `agentExecutionService/` precedent).

```
server/services/
  workflowEngineService.ts              ← barrel only (target < 250 LOC)
  workflowEngineServicePure.ts          ← pre-existing, untouched
  workflowEngine/
    constants.ts                        ← queue names, parallelism caps, timeout defaults
    types.ts                            ← RunContext + inline types lifted out
    definitionHelpers.ts                ← rehydrateDefinition, findStepInDefinition
    contextHelpers.ts                   ← assertContextSize, mergeStepOutputIntoContext, deleteStepOutputFromContext
    readySet.ts                         ← computeReadySet + suppressWebSocket helper
    queueLifecycle/
      tick.ts                           ← enqueueTick + tick handler body
      watchdog.ts                       ← watchdog handler body
      agentStep.ts                      ← agent-step handler body
```

Seams derive from the file's existing internal structure: line 132+ pure helpers, line 552 ready-set, line 701-760 context helpers, line 792+ the service object with three queue methods.

### 5.3. Dependency direction

- `queueLifecycle/*` may import from `definitionHelpers`, `contextHelpers`, `readySet`, `constants`, `types` (downward only).
- `definitionHelpers`, `contextHelpers`, `readySet` may import from `constants`, `types` only.
- No upward imports. No `queueLifecycle/*` imports from the barrel.
- The barrel imports from sub-modules and re-exports the `WorkflowEngineService` object composed from queue-lifecycle functions.

### 5.4. Existing Pure sibling — untouched

`server/services/workflowEngineServicePure.ts` already exists. This build does NOT modify it. Any new pure-helper extraction surfaced during a chunk is deferred to a follow-up build (origin tag: `WORKFLOW-SPLIT-DEF-*`).
## 6. RLS Migration Scope (WF1)

Migration filename: next sequential under `migrations/` (architect numbers during plan phase).

Migration content:

1. `ENABLE ROW LEVEL SECURITY` on each of the 5 confirmed workflow tables.
2. For tables with a direct `organisation_id` column: `CREATE POLICY <table>_org_isolation ON <table> FOR ALL USING (organisation_id = current_setting('app.org_id')::uuid)`.
3. For FK-only tenant-scoped tables (`workflow_run_steps`, `workflow_step_runs`, `workflow_audit_events` likely fall here): parent-EXISTS pattern — `CREATE POLICY ... USING (EXISTS (SELECT 1 FROM workflow_runs wr WHERE wr.id = <table>.workflow_run_id AND wr.organisation_id = current_setting('app.org_id')::uuid))`.
4. Add allowlist entries to `server/config/rlsProtectedTables.ts` for each table.
5. `verify-rls-coverage.sh` and `verify-rls-protected-tables.sh` must pass against the migration.

Pair with a `*.down.sql` for reversibility. Use `IF EXISTS` guards per existing convention.

## 7. Permission Migration Scope (WF5)

Add new permissions:
- `WORKFLOW_RUNS_VIEW` — view workflow runs and run history
- `WORKFLOW_RUNS_EXECUTE` — trigger a workflow run manually
- `WORKFLOW_RUNS_CANCEL` — cancel a running workflow

Default role grants (confirmed during plan phase):
- `org-admin`: all three
- `operator`: VIEW + EXECUTE
- `viewer`: VIEW only

Migration touchpoints:
- Central permission enum (architect confirms the exact file)
- Permission seed migration (new SQL file)
- Workflow-run route handlers (architect's caller sweep enumerates the route file set)
- Frontend `Can` / `usePermission` checks gated on `AGENTS_VIEW` for workflow-run UI must migrate

The legacy `AGENTS_VIEW` gate on workflow-run routes is REMOVED in the same chunk that adds the `WORKFLOW_RUNS_VIEW` gate — no overlap, no deprecation window.
## 8. Acceptance Criteria

A build is complete when ALL of the following hold:

1. `server/services/workflowEngineService.ts` is < 250 LOC, re-exports only.
2. Directory tree under `server/services/workflowEngine/` matches §5.2 (architect may add files but not remove the named ones).
3. `npm run build:server` exits 0.
4. `npm run lint` exits 0.
5. Five RLS migrations land. `verify-rls-coverage.sh` + `verify-rls-protected-tables.sh` pass.
6. `rlsProtectedTables.ts` allowlist contains the five new entries.
7. `verify-with-org-tx-or-scoped-db.sh` does not introduce new baseline entries inside `server/services/workflowEngine/**`.
8. `verify-canonical-retry.sh` baseline honoured (no new occurrences in new code).
9. `verify-loc-cap.sh` passes — no file in the new tree exceeds the 1,500 LOC services soft cap; barrel under 250 LOC.
10. `WORKFLOW_RUNS_*` perm family exists, default-granted to named roles, all workflow-run routes gate on it.
11. No route file uses `AGENTS_VIEW` for workflow-run access after this build.
12. All 5 callers in §4 plus any additional callers found in the architect's sweep compile against the new barrel without source-code modifications.
13. `tasks/todo.md` items WF1, WF2, WF3, WF4, WF5, WF6, WF8 marked `[status:closed:pr:<num>]` in the merge commit.

## 9. Chunks (high-level)

Architect refines during plan phase. Expected shape:

- **Chunk 0**: caller sweep + locked-surface confirmation + plan write
- **Chunk 1**: extract `constants.ts` + `types.ts` (lowest-risk move)
- **Chunk 2**: extract `definitionHelpers.ts` + `contextHelpers.ts` + `readySet.ts`
- **Chunk 3**: extract `queueLifecycle/tick.ts`
- **Chunk 4**: extract `queueLifecycle/watchdog.ts`
- **Chunk 5**: extract `queueLifecycle/agentStep.ts`
- **Chunk 6**: barrel re-export + caller verification
- **Chunk 7**: migrate raw `db` to `getOrgScopedDb` inside new tree (WF3, WF4, WF6)
- **Chunk 8**: RLS migration for the five workflow tables (WF1) + allowlist update
- **Chunk 9**: `WORKFLOW_RUNS_*` perm family + route migration (WF5)
- **Chunk 10**: caller sweep + spec-conformance + final review pass

Chunks 7-9 may be reordered or interleaved by the architect; chunk 0 produces the final ordering.

## 10. Caller Sweep — Architect Responsibility

The architect's plan must include a full caller sweep at chunk 0 covering:

- Every file importing from `workflowEngineService` (start with the 5 known callers; verify completeness).
- Every file gating on `AGENTS_VIEW` AND touching a workflow-run resource (route handlers, frontend permission checks, hooks, services).
- Every file calling `db.<verb>(workflowRuns | workflowRunSteps | workflowStepRuns | workflowDefinitions | workflowAuditEvents | ...)` to flag any raw-db site needing migration to `getOrgScopedDb`.

The sweep result is recorded in the plan and verified during spec-conformance review post-build.
