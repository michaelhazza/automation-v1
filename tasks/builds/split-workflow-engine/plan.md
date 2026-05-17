---
status: LOCKED
locked_at: 2026-05-15T03:40:00Z
review_rounds: 4
total_findings_closed: 14
date: 2026-05-15
author: architect (claude opus 4.7)
scope_class: Significant
spec: tasks/builds/split-workflow-engine/spec.md
adopts_conventions_from: tasks/builds/feat-split-skillexecutor/spec.md § 5
---

# Plan — split workflowEngineService + WF1 RLS + WF5 perms

## Table of contents

1. Model-collapse check
2. Architecture notes
3. Risks & mitigations
4. Chunk-0 caller sweep — verified results (3a-3e)
5. Chunks
6. Dependency graph
7. Acceptance-criteria coverage matrix
8. Open questions for the operator
9. Self-consistency pass
10. References

## Model-collapse check

Asked the three questions:

1. *Decomposes into ingest → extract → transform → render?* No. This is a deterministic code-refactor + DDL migration + permission-seed migration. No LLM step. No data flowing through a pipeline.
2. *Each step doable by a frontier multimodal call?* No. Compiling a TypeScript barrel, running `CREATE POLICY` against Postgres, and inserting rows into `permissions` are deterministic operations that an LLM cannot perform in-process.
3. *Can the whole pipeline collapse to one model call?* No. There is no pipeline.

**Decision: reject collapse.** Mechanical refactor + database migrations. Frontier-model alternatives are not applicable. Proceeding with the chunk-driven build.

## 1. Architecture notes

### Decomposition rationale

The spec splits `workflowEngineService.ts` along its three pg-boss queue lifecycles — **tick**, **watchdog**, **agent-step**. That is the cleanest axis because the boundary already exists at runtime: each lifecycle is a separate pg-boss handler with its own retry/concurrency semantics. Splitting along the data model (per-table operations) would crisscross every queue; splitting along the layer (DB / business logic / dispatch) would erase the queue lifecycle that is the whole point of the engine.

One nuance not captured in the spec's §5.2 directory layout: ~1,100 LOC of step-completion / cancellation / replay / bulk-fan-out logic is called from MULTIPLE queue lifecycles AND from external services (`workflowRunService`, `workflowActionCallExecutor`). Those functions are NOT queue handlers, so putting them under `queueLifecycle/` is wrong. I add a sibling `stepLifecycle.ts` for them. This is consistent with spec §5.2's "architect may add files" allowance.

I also split `queueLifecycle/tick.ts` further: `tick.ts` (enqueueTick + tick handler body, ~410 LOC) plus `dispatch.ts` (dispatchStep + dispatch helpers, ~790 LOC). Keeping them in a single file is technically possible but it would land at ~1,650 LOC — over the 1,500 services soft cap (spec §8.9). Splitting is mandatory, not optional.

### Dependency direction inside `server/services/workflowEngine/`

```
                  workflowEngineService.ts (barrel — public surface)
                                  │
            ┌─────────────────────┼──────────────────────┐
            ▼                     ▼                      ▼
       constants.ts          types.ts             queueLifecycle/*
       (queue names,         (re-exports +              │
        timeouts, caps)       narrow helpers)           │
                                  │                     │
            ┌─────────────────────┼─────────────────────┘
            ▼                     ▼
       definitionHelpers   contextHelpers   readySet
            │                     │              │
            └─────────────────────┴──────────────┘
                                  │
                                  ▼
                       stepLifecycle.ts
                       (shared step-completion / replay / bulk machinery)
                                  │
                                  ▼
                       workflowEngineServicePure.ts
                       (pre-existing pure sibling — untouched)
```

Rules (extend spec §5.3):

- `queueLifecycle/*` may import from `stepLifecycle`, `definitionHelpers`, `contextHelpers`, `readySet`, `constants`, `types`. NEVER from the barrel. NEVER from each other (a watchdog handler does not import the tick handler).
- `stepLifecycle.ts` may import from `definitionHelpers`, `contextHelpers`, `readySet`, `constants`, `types`. NEVER from `queueLifecycle/*`. NEVER from the barrel.
- `definitionHelpers`, `contextHelpers`, `readySet` may import from `constants`, `types`. Downward imports to `db` and Drizzle schema are allowed when essential (e.g. `readySet.materialisePendingStepRuns` writes step-run rows). No upward imports.
- Barrel imports from sub-modules only. No business logic in the barrel.

### Barrel composition

The barrel composes the `WorkflowEngineService` object by importing the closure-bound functions from sub-modules and stitching them into the public-surface shape:

```typescript
// server/services/workflowEngineService.ts (target shape, < 250 LOC)
import { TICK_QUEUE, WATCHDOG_QUEUE } from './workflowEngine/constants.js';
import { enqueueTick, tick } from './workflowEngine/queueLifecycle/tick.js';
import { dispatchStep, resolveAgentForStep, findReusableOutputForStep, editStepOutput } from './workflowEngine/queueLifecycle/dispatch.js';
import { watchdogSweep } from './workflowEngine/queueLifecycle/watchdog.js';
import { onAgentRunCompleted, handleDecisionStepCompletion } from './workflowEngine/queueLifecycle/agentStep.js';
import {
  failStepRunInternal, completeStepRunInternal, completeStepRunFromReview,
  completeStepRun, failStepRun, resumeInvokeAutomationStep,
  replayDispatch, createReplayRun, handleBulkFanOut, checkBulkParentCompletion,
  estimateCascadeCostCents, computeCriticalPath, computeDownstreamSet,
} from './workflowEngine/stepLifecycle.js';
import { registerWorkers } from './workflowEngine/queueLifecycle/registerWorkers.js';

export const WorkflowEngineService = {
  TICK_QUEUE,
  WATCHDOG_QUEUE,
  enqueueTick,
  tick,
  dispatchStep,
  resolveAgentForStep,
  findReusableOutputForStep,
  resumeInvokeAutomationStep,
  failStepRunInternal,
  computeDownstreamSet,
  editStepOutput,
  handleBulkFanOut,
  checkBulkParentCompletion,
  replayDispatch,
  createReplayRun,
  estimateCascadeCostCents,
  computeCriticalPath,
  completeStepRunInternal,
  completeStepRunFromReview,
  completeStepRun,
  failStepRun,
  onAgentRunCompleted,
  handleDecisionStepCompletion,
  watchdogSweep,
  registerWorkers,
};
```

`AGENT_STEP_QUEUE` is currently an internal constant only — never reached `WorkflowEngineService.AGENT_STEP_QUEUE` because it is not re-exported on the object today (the actual `const` literal at lines 793-794 contains only `TICK_QUEUE` and `WATCHDOG_QUEUE`). Spec §4 says queue constants are "exposed via `WorkflowEngineService.TICK_QUEUE` etc." — that wording is loose. I treat the **current** object surface as the lock. See §7 open question 2.

### RLS strategy per table

Five FK-only tenant tables identified by the audit (see §3d below for full verification). Two patterns:

**Direct parent-EXISTS via `workflow_runs.organisation_id`**:

- `workflow_step_runs` — parent: `workflow_runs(id)` via `run_id`
- `workflow_step_reviews` — parent: `workflow_step_runs(id)` via `step_run_id`. Needs a TWO-LEVEL join: `workflow_step_reviews → workflow_step_runs → workflow_runs`. I encode the two-level join inside the policy rather than relying on the parent table's policy being live, because policy evaluation order across tables is not contractually guaranteed in this codebase.
- `workflow_run_event_sequences` — parent: `workflow_runs(id)` via `run_id`. One-level join.

**Via `users` (because no FK to `organisations` or `workflow_runs`)**:

- `workflow_studio_sessions` — parent: `users(id)` via `created_by_user_id`. Studio sessions today are gated by `requireSystemAdmin` at the route layer, so an RLS hole is partly mitigated, but per spec §1 goal 3 still needs Postgres-level isolation. Policy: `EXISTS (SELECT 1 FROM users u WHERE u.id = created_by_user_id AND u.organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid)`. Pre-condition: `users.organisation_id` exists as a column (verified during plan write).

**Legacy table from M1 rename**:

- `flow_step_outputs` — parent: `flow_runs(id)` via `flow_run_id`. `flow_runs` is currently RLS-deferred (manifest line 912-915 marks it as deferred). The policy on `flow_step_outputs` joins to `flow_runs.organisation_id` (column still exists even without a policy on the parent); this is defence-in-depth at the FK-only-table layer and does NOT depend on `flow_runs`'s own policy. Closing `flow_runs` itself is out of scope.

### Permission migration strategy

Spec §7 names three new perms (`WORKFLOW_RUNS_VIEW`, `WORKFLOW_RUNS_EXECUTE`, `WORKFLOW_RUNS_CANCEL`). The codebase ALREADY has `ORG_PERMISSIONS.WORKFLOW_RUNS_START` (`org.workflow_runs.start`) and a SUBACCOUNT-tier family (`WORKFLOW_RUNS_READ`, `WORKFLOW_RUNS_START`, `WORKFLOW_RUNS_CANCEL`, `WORKFLOW_RUNS_EDIT_OUTPUT`, `WORKFLOW_RUNS_APPROVE`). Reconciling:

- `WORKFLOW_RUNS_VIEW` = new org-tier perm `org.workflow_runs.view`. Maps to `GET /api/workflow-runs/:runId` (currently `AGENTS_VIEW`).
- `WORKFLOW_RUNS_EXECUTE` = **reuse existing `WORKFLOW_RUNS_START` (`org.workflow_runs.start`)**. The spec's `EXECUTE` name is conceptually identical to the existing `START`. Add no new key for EXECUTE; rename in routes from `AGENTS_EDIT` to `WORKFLOW_RUNS_START` on the replay endpoint (the route that "starts" a new run). See §7 open question 1.
- `WORKFLOW_RUNS_CANCEL` = new org-tier perm `org.workflow_runs.cancel`. Maps to `POST /api/workflow-runs/:runId/cancel` and the three task-scoped `pause`/`resume`/`stop` endpoints (since stop = cancel by another name; pause/resume are lifecycle-pause operations of a CANCEL family in spirit).
- **The step-input / output / approve routes need their own perm.** Spec §7's three perms (VIEW, EXECUTE, CANCEL) do NOT cover the THREE write endpoints (`POST /steps/:stepRunId/input`, `POST /steps/:stepRunId/output`, `POST /steps/:stepRunId/approve`). These are currently gated on `AGENTS_EDIT`. The subaccount tier has `WORKFLOW_RUNS_EDIT_OUTPUT` + `WORKFLOW_RUNS_APPROVE`. I propose: ADD `org.workflow_runs.edit_output` and `org.workflow_runs.approve` at org tier, mirroring the subaccount tier. **Total NEW org-tier perms = 4: `WORKFLOW_RUNS_VIEW`, `WORKFLOW_RUNS_CANCEL`, `WORKFLOW_RUNS_EDIT_OUTPUT`, `WORKFLOW_RUNS_APPROVE`. (EXECUTE reuses existing START.) This is a deviation from spec §7 which names exactly three perms — operator must accept or reject before Chunk 9.**

Per spec §7 "the legacy `AGENTS_VIEW` gate on workflow-run routes is REMOVED in the same chunk that adds the `WORKFLOW_RUNS_VIEW` gate — no overlap, no deprecation window". Implementation: in one PR, both the perm-seed migration and the route-file edits land together. Backfill SQL grants the new keys to any permission set that previously held `AGENTS_VIEW` (for `VIEW`) or `AGENTS_EDIT` (for the three write/cancel keys) — existing roles keep working without manual reassignment.

## 2. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Barrel circular-import: a sub-module under `workflowEngine/` accidentally imports `workflowEngineService.ts`, creating a cycle that resolves to `undefined` at module load. The current file has a self-import-via-cycle hazard because `workflowAgentRunHook.ts` imports the barrel and is called from `agentExecutionService` post-completion. | Spec §5.3 + the dependency-direction rules above explicitly ban any sub-module under `workflowEngine/**` from importing the barrel. Builder must verify with a **path-depth agnostic AND import-style agnostic grep** that catches static `from`-imports, dynamic `await import(...)` calls, and any quoted reference: `grep -rE "workflowEngineService(\.js)?['\"]" server/services/workflowEngine/` returns ZERO matches at the end of each chunk. (The earlier `from\s+['\"]\.\.\/` framing would miss BOTH `../../workflowEngineService` and `await import('../../workflowEngineService.js')` patterns.) Add this as a one-line grep verification command in every chunk's verification section. |
| R2 | Queue-lifecycle handler `this`-binding: the original `WorkflowEngineService.tick` is a method on a const object literal. Inside `tick`, calls like `this.dispatchStep(...)` work because `tick` is called as a method on the object. After the split, `tick` is a free function imported into the barrel. Any internal calls that previously used `this.dispatchStep` must rebind to `dispatchStep` directly. Missing one would silently throw `TypeError: undefined is not a function` at runtime — and ONLY at the dispatch path, which is impossible to trigger from a unit test. | Verbatim translation: every `this.X` reference inside the moved methods must rewrite to a direct named import. Use `grep -nE "this\.\w+" server/services/workflowEngine/` after each chunk; zero matches is the invariant. Confirm via `npm run build:server` — TypeScript catches the rebinding because the post-extraction context loses the object literal type. **Builder MUST run this check inside each chunk that moves a queue-lifecycle function.** |
| R3 | RLS policy evaluation order on FK-only tables. The `workflow_step_reviews → workflow_step_runs → workflow_runs` two-level join can hit the situation where the new `workflow_step_reviews` policy fires BEFORE `workflow_step_runs`'s own (also-new) policy. Postgres evaluates parent-row visibility under the parent's policies, so a chain works AS LONG AS the parent policies are set on the same connection. | All five RLS migrations land in ONE atomic migration (one transactional `.sql` file). Cross-table EXISTS evaluation happens within one statement, with all policies live, so order is not observable from outside. The down migration drops in reverse order. Pair the migration with manual smoke (`psql` SELECT inside a `withOrgTx`) on dev DB before merge. |
| R4 | Perm-migration race: while the perm migration is mid-flight (catalogue insert succeeded; backfill SQL still running), any in-flight HTTP request to a workflow-run route would hit a gate that's transitioning. With the same-chunk rule (legacy gate removed, new gate added in one PR), the deployment surface compresses to "between the migration commit and the server-restart". CI/CD typically restarts the API after migrations complete, so the window is sub-second. | Make the migration idempotent (uses `ON CONFLICT DO NOTHING`) and the backfill `NOT EXISTS`-guarded. The server boot reads the latest `permissions` catalogue. The route gate change ships in the same PR as the migration, so when the new server binary starts, the perms are already seeded. **Order in the chunk: (1) migration file, (2) `permissions.ts` enum update, (3) route edits.** Builder commits all three in one chunk; CI does not split them. |
| R5 | Raw-DB migration inside the new tree: `verify-with-org-tx-or-scoped-db.sh` has a baseline today that includes the existing ~22 raw-`db.*` sites in `workflowEngineService.ts`. After the split, those sites move into sub-modules but the gate may not re-evaluate the baseline correctly. | Two-part mitigation. (1) Land the structural split in Chunks 1-6 WITHOUT migrating raw `db.*` to `getOrgScopedDb()` — preserve the violations under the existing baseline. (2) Land the `db.* → getOrgScopedDb()` migration in Chunk 7 as a separate PR that REMOVES the baseline entries. This isolates the structural risk (split) from the semantic risk (DB scoping migration). The baseline file is `scripts/guard-baselines.json` or equivalent — builder confirms the baseline-update path BEFORE starting Chunk 7. If the baseline cannot be updated cleanly, Chunk 7 stays open as a follow-up; structural split still lands. |
| R6 | Tick-worker `resolveOrgContext: () => null` re-scoping (WF4). `tick()`, `watchdogSweep()`, and `onAgentRunCompleted()` all opt out of `createWorker`'s default org-context resolution because they enter from a runId / stepRunId / cross-tenant sweep rather than a known org. Adding `withOrgTx(orgId)` AFTER the org-resolution lookup breaks the existing transactional shape: the lookup happens on the pool connection; the writes happen inside a new tx. | Spec §1 goal 7 demands re-scoping. Use the same pattern as `agentExecutionService.resumeAgentRun` (per audit reference). Each queue entry point uses its own named org-resolution helper, all in `runLookup.ts`: tick → `loadRunForOrgResolution(runId)`; agent-step → `loadRunForStepRunOrgResolution(stepRunId)`; watchdog → `findTimedOutRunCandidates(asOf)` returning a per-org candidate list. Tick additionally wraps its body in `withRunAdvisoryLock(runId, fn)` (CONNECTION-PINNED critical-section helper that holds one admin client for the duration of the callback so acquire and release execute on the same Postgres session — separate acquire/release functions are forbidden because a pooled release on a different connection is a silent no-op and the lock would leak until session close). Watchdog iterates candidates one-by-one and opens a separate `withOrgTx(candidate.organisationId, ...)` per candidate; it never holds a transaction across orgs. Builder must NOT call `withAdminConnection`, bare `db.*`, `pg_try_advisory_lock` SQL, or invent ad-hoc cross-tenant lookups anywhere inside `workflowEngine/**` outside the two helper files (`runLookup.ts` and `advisoryLock.ts`). |
| R7 | Spec §1 goal 3 lists FIVE RLS tables that DO NOT EXIST as named: `workflow_run_steps`, `workflow_definitions`, `workflow_audit_events`. The actual five FK-only tables identified by the audit and confirmed in this plan's §3d sweep are different. | **Surface to operator.** The plan operates on the AUDIT-IDENTIFIED set: `workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs`. Update spec §1 goal 3 to match. This is a spec gap — flagged in the architect summary. |

## 3. Chunk-0 caller sweep — verified results

### 3a. Importers of `workflowEngineService`

Static imports — `from '<path>/workflowEngineService'`:

| Site | Symbol imported | Locked by spec §4? |
|---|---|---|
| `server/services/workflowAgentRunHook.ts:28` | `WorkflowEngineService` (named) — calls `.onAgentRunCompleted(stepRunId, result, agentRunId)` | YES (member of locked surface) |
| `server/services/workflowRunService.ts:35` | `WorkflowEngineService` (named) — calls `.enqueueTick`, `.completeStepRun`, `.editStepOutput`, `.failStepRun`, `.resumeInvokeAutomationStep` | YES (all members locked) |

Dynamic imports — `await import('<path>/workflowEngineService')`:

| Site | Symbol used | Locked by spec §4? |
|---|---|---|
| `server/index.ts:672-673` | `WorkflowEngineService.registerWorkers()` | YES |
| `server/routes/workflowRuns.ts:164-169` | `WorkflowEngineService.createReplayRun(orgId, runId, userId)` | YES |
| `server/services/workflowActionCallExecutor.ts:390` | `WorkflowEngineService.failStepRunInternal`, `.completeStepRunFromReview`, `.failStepRunInternal` | YES |

**Sole importer of `workflowEngineServicePure.ts` (Pure sibling, NOT in scope):** `server/services/workflowEngineService.ts:105` + test files (`invalidationRecheckPure.test.ts`, `workflowEngineServicePure.test.ts`). Spec §2 + §5.4 protect this file from modification.

**Re-exports:** none. **`vi.mock` against the barrel:** none.

**Total caller count:** 5 (matches spec §4 expected count: 5). No additional callers surfaced. No caller imports an internal helper not on the spec §4 lock list.

**Public-surface usage (all members called across all callers):**

`TICK_QUEUE`, `WATCHDOG_QUEUE`, `enqueueTick`, `tick`, `dispatchStep`, `resolveAgentForStep`, `findReusableOutputForStep`, `resumeInvokeAutomationStep`, `failStepRunInternal`, `computeDownstreamSet`, `editStepOutput`, `handleBulkFanOut`, `checkBulkParentCompletion`, `replayDispatch`, `createReplayRun`, `estimateCascadeCostCents`, `computeCriticalPath`, `completeStepRunInternal`, `completeStepRunFromReview`, `completeStepRun`, `failStepRun`, `onAgentRunCompleted`, `handleDecisionStepCompletion`, `watchdogSweep`, `registerWorkers`.

`AGENT_STEP_QUEUE` is NOT exposed on the `WorkflowEngineService` object today — it stays internal. Spec §4 wording ("`TICK_QUEUE`, `WATCHDOG_QUEUE`, `AGENT_STEP_QUEUE` constants exposed via `WorkflowEngineService.TICK_QUEUE` etc.") is loose; the actual literal at lines 793-794 exposes only TICK + WATCHDOG. Plan preserves current behaviour.

### 3b. AGENTS_VIEW / AGENTS_EDIT gates on workflow-run resources

Nine gate sites in `server/routes/workflowRuns.ts`:

| Line | Route | Current gate | Target gate (proposed) |
|---|---|---|---|
| 100 | `GET /api/workflow-runs/:runId` | `AGENTS_VIEW` | **`WORKFLOW_RUNS_VIEW`** (NEW) |
| 152 | `POST /api/workflow-runs/:runId/cancel` | `AGENTS_EDIT` | **`WORKFLOW_RUNS_CANCEL`** (NEW) |
| 162 | `POST /api/workflow-runs/:runId/replay` | `AGENTS_EDIT` | **`WORKFLOW_RUNS_START`** (existing — reused as EXECUTE) |
| 177 | `POST /api/workflow-runs/:runId/steps/:stepRunId/input` | `AGENTS_EDIT` | **`WORKFLOW_RUNS_EDIT_OUTPUT`** (NEW org-tier) |
| 203 | `POST /api/workflow-runs/:runId/steps/:stepRunId/output` | `AGENTS_EDIT` | **`WORKFLOW_RUNS_EDIT_OUTPUT`** (NEW org-tier) |
| 247 | `POST /api/workflow-runs/:runId/steps/:stepRunId/approve` | `AGENTS_EDIT` | **`WORKFLOW_RUNS_APPROVE`** (NEW org-tier) |
| 291 | `POST /api/tasks/:taskId/run/pause` | `AGENTS_EDIT` | **`WORKFLOW_RUNS_CANCEL`** |
| 311 | `POST /api/tasks/:taskId/run/resume` | `AGENTS_EDIT` | **`WORKFLOW_RUNS_CANCEL`** |
| 345 | `POST /api/tasks/:taskId/run/stop` | `AGENTS_EDIT` | **`WORKFLOW_RUNS_CANCEL`** |

**Out-of-scope (template/draft/gate routes — not workflow-run resources per spec):**

- `server/routes/workflowStudio.ts:230, 258` — workflow TEMPLATE routes (`/api/admin/workflows/:id` etc.). Use `WORKFLOW_TEMPLATES_*` perms in a separate cleanup.
- `server/routes/workflowDrafts.ts:26, 81` — workflow DRAFT routes. Workflow drafts are template-authoring upstream. Out of WF5 scope.
- `server/routes/workflowGates.ts:38, 81` — workflow GATE routes. Adjacent to runs but a separate concept. Out of WF5 scope unless operator says otherwise.

**Frontend gates:** No `client/src/**/Workflow*` page checks `org.agents.view` or `org.agents.edit` directly. The `App.tsx:196` reference and `sidebar.ts` references are for the AGENTS page, not workflow-run UI. **No client-side changes required for the perm flip.**

### 3c. Raw `db.*` sites on workflow tables

`server/services/workflowEngineService.ts` — 22 sites (audit said 18; count is 22 by direct grep; close enough — audit was approximate):

```
151:  const [sr] = await db.select({ status: workflowStepRuns.status })   → workflow_step_runs
604:  await db.insert(workflowStepRuns).values({                         → workflow_step_runs
629:  await db.insert(workflowStepRuns).values({                         → workflow_step_runs
677:  const result = await db.execute(                                   → workflow_runs / step runs
775:  await db.insert(workflowStepRuns).values({                         → workflow_step_runs
785:  await db.execute(sql`INSERT INTO workflow_run_event_sequences ...`)→ workflow_run_event_sequences
849:  const lockResult = await db.execute(sql`SELECT pg_try_advisory ...`)→ advisory lock; not tenant
858:  const [run] = await db.select().from(workflowRuns).where(eq(...))   → workflow_runs
1102: const capCheckResult = await db.execute(                           → workflow_runs (cost cap)
1159: const latestCostResult = await db.execute(                         → workflow_runs (cost accumulator)
1705: const [preActionCheck] = await db.select({ status: workflowStep…)  → workflow_step_runs
1890: const [preAgentCheck] = await db.select({ status: workflowStep…)   → workflow_step_runs
1957: const [preInvokeCheck] = await db.select({ status: workflowStep…)  → workflow_step_runs
2511: await db.transaction(async (tx) => { … })                          → workflow_step_runs (editStepOutput)
2971: await db.transaction(async (tx) => { … })                          → workflow_runs / step_runs (createReplayRun)
3088: const [run] = await db.select().from(workflowRuns).where(eq(...))   → workflow_runs
3145: await db.transaction(async (tx) => { … })                          → workflow_step_runs / runs (completeStepRunInternal)
3312: const [parentRun] = await db.select({ subaccountId: workflowRuns…) → workflow_runs (failStepRun)
3384: const [run] = await db.select().from(workflowRuns).where(eq(...))   → workflow_runs (handleDecisionStepCompletion)
3571: await db.transaction(async (tx) => { … })                          → workflow_step_runs / runs (decision completion)
3760: await db.transaction(async (tx) => { … })                          → workflow_step_runs / runs (decision default branch)
```

`server/services/workflowAgentRunHook.ts:36-39` — 1 site:

```
36-39: const [run] = await db.select({ workflowStepRunId: agentRuns.workflowStepRunId })
         .from(agentRuns).where(eq(agentRuns.id, agentRunId));    → agent_runs (no org filter — WF6)
```

**Tick-worker bypass (WF4):** `registerWorkers()` at line 3891 creates workers with `resolveOrgContext: () => null` so the tick handler runs cross-tenant; the actual `createWorker` calls are around lines 3895-3940.

### 3d. RLS-uncovered workflow tables — RE-VERIFIED

**SPEC §1 GOAL 3 LISTS THE WRONG TABLES.** The spec names `workflow_runs`, `workflow_run_steps`, `workflow_step_runs`, `workflow_definitions`, `workflow_audit_events`. The actual situation:

- `workflow_runs` — **DOES have a policy** since migration `0245_all_tenant_tables_rls.sql:583`. Already in `rlsProtectedTables.ts:906` (manifest references the wrong migration `0076_playbooks.sql` — possible pre-existing manifest drift, not introduced by this build).
- `workflow_run_steps` — **DOES NOT EXIST.** No table with this name in `server/db/schema/`. No CREATE TABLE in any migration.
- `workflow_definitions` — **DOES NOT EXIST.** No table with this name (the `definitionJson` is a JSONB column on `workflow_template_versions`, not a standalone table).
- `workflow_audit_events` — **DOES NOT EXIST.** No table with this name.

The **actual five RLS-uncovered tables** that the audit (WF1) and this plan target:

| Table | Schema file | FK chain | Policy pattern | `organisation_id` column? |
|---|---|---|---|---|
| `workflow_step_runs` | `server/db/schema/workflowRuns.ts:170` | `run_id → workflow_runs.id → organisations.id` | parent-EXISTS via `workflow_runs` | NO — FK-only |
| `workflow_step_reviews` | `server/db/schema/workflowRuns.ts:218` | `step_run_id → workflow_step_runs.id → workflow_runs.id → organisations.id` | two-level parent-EXISTS (join through `workflow_step_runs` to `workflow_runs.organisation_id`) | NO — FK-only |
| `workflow_studio_sessions` | `server/db/schema/workflowRuns.ts:253` | `created_by_user_id → users.id → organisations.id` | parent-EXISTS via `users` (NOT via workflow_runs — sessions have no FK to runs) | NO — FK-only |
| `workflow_run_event_sequences` | `server/db/schema/workflowRuns.ts:130` | `run_id → workflow_runs.id → organisations.id` | parent-EXISTS via `workflow_runs` | NO — FK-only |
| `flow_step_outputs` | (legacy, no Drizzle schema file; migration 0037 originally created `workflow_step_outputs`, renamed by 0219) | `flow_run_id → flow_runs.id → organisations.id` | parent-EXISTS via `flow_runs` (note: `flow_runs` itself is RLS-deferred; the policy on `flow_step_outputs` joins to `flow_runs.organisation_id` which exists as a column even without a policy on the parent) | NO — FK-only |

All five join through a parent that does carry `organisation_id`. None has its own `organisation_id` column. All policies use the FK-EXISTS parent-join pattern (canonical example: `migrations/0213_fix_cached_context_rls.sql:67-86` for `reference_document_versions → reference_documents`).

`flow_step_outputs` is part of the LEGACY workflow engine path (`flowExecutorService.ts`), not the workflow engine being split here. It is in scope ONLY because the audit lumped it with the WF1 finding. Excluding it would leave a known security gap; including it does not require any code changes (only the migration). Plan keeps it in. See §7 open question 3.

### 3e. Other plumbing

**Central permission enum:** `server/lib/permissions.ts:11-127` defines `ORG_PERMISSIONS`. The plan adds 4 keys to `ORG_PERMISSIONS` (operator may pare to 3 — see §1 above): `WORKFLOW_RUNS_VIEW`, `WORKFLOW_RUNS_CANCEL`, `WORKFLOW_RUNS_EDIT_OUTPUT`, `WORKFLOW_RUNS_APPROVE`. Reuse existing `WORKFLOW_RUNS_START` for EXECUTE semantics. Also adds 4 corresponding entries to the `ALL_PERMISSIONS` array (`permissions.ts:220-404`) for DB seeding.

**Permission seed pattern:** Mirror `migrations/0201_universal_brief_permissions.sql` and `migrations/0257_workspace_permissions.sql`. Steps in the new migration:

1. `INSERT INTO permissions (key, description, group_name) VALUES (...) ON CONFLICT (key) DO NOTHING`.
2. Backfill into permission sets that already hold `org.agents.view` (gain `org.workflow_runs.view`) or `org.agents.edit` (gain `cancel`, `edit_output`, `approve`).

**Default role grants:** `DEFAULT_PERMISSION_SET_TEMPLATES` in `permissions.ts:408-534` lists the default templates. Update the `Org Admin` (gets ALL `WORKFLOW_RUNS_*` automatically via `...Object.values(ORG_PERMISSIONS)`), `Org Manager` (gets VIEW + CANCEL + EDIT_OUTPUT + APPROVE per spec §3 framing — operator confirms), and `Org Viewer` (gets VIEW only). The migration backfills are for ALREADY-DEPLOYED orgs; the template update is for NEW orgs.

**Frontend mirror:** None. Client uses string literals (e.g. `'org.agents.view'`). The plan does NOT touch any client-side permission check because no workflow-run UI gates on `org.agents.view` today.

**Migration numbering:** Highest existing prefix is `0358`. Two new migrations:

- `0359_workflow_tables_rls.sql` (+ `.down.sql`) — five FK-EXISTS policies + manifest update.
- `0360_workflow_runs_org_permissions.sql` (+ `.down.sql`) — perm catalogue inserts + backfill.

**`server/config/rlsProtectedTables.ts`** — add five new entries. The existing entry for `workflow_runs:906` should also have its `policyMigration` corrected from `0076_playbooks.sql` → `0245_all_tenant_tables_rls.sql` (one-line drift fix). Surface this as a corrective-edit; not a blocking change. See §7 open question 4.

**Gate scripts:** CI runs `verify-rls-coverage.sh`, `verify-rls-protected-tables.sh`, `verify-rls-session-var-canon.sh`. They are CI-only per the executor note. Builder authors no new gate scripts in this build (the Q1/Q2 prevention proposals from the audit are out of scope for the Wave 1 RLS-closure build).

## 4. Chunks

### Chunk 0 — Caller sweep + plan write

- **name:** `chunk-0-caller-sweep`
- **spec_sections:** §10, §4, §1 (verification of the goal-3 table list)
- **files:** `tasks/builds/split-workflow-engine/plan.md` (this file)
- **contracts:** plan document exists with §3a-3e verified; surfaces the spec §1 goal-3 table-name gap; surfaces the spec §7 perm-count gap.
- **error_handling_strategy:** N/A (documentation chunk).
- **dependencies:** none.
- **verification:** plan exists; operator reviews and confirms scope before Chunk 1 starts. Operator answers four open questions (§7) before Chunks 8/9 begin.
- **DONE in this PR.**

### Chunk 1 — Constants + types module (foundation)

- **name:** `chunk-1-constants-types`
- **spec_sections:** §5.2 (directory layout), §5.3 (dependency direction), §4 (queue constants on locked surface)
- **files:**
  - CREATE `server/services/workflowEngine/constants.ts`
  - CREATE `server/services/workflowEngine/types.ts`
  - MODIFY `server/services/workflowEngineService.ts` (delete moved declarations; add re-exports from new modules)
- **contracts:**
  - `constants.ts` exports: `TICK_QUEUE`, `WATCHDOG_QUEUE`, `AGENT_STEP_QUEUE` (string constants), `MAX_PARALLEL_STEPS_DEFAULT`, `MAX_CONTEXT_BYTES_SOFT`, `MAX_CONTEXT_BYTES_HARD`, `STEP_RUN_TIMEOUT_DEFAULT_MS`, `WATCHDOG_INTERVAL_SECONDS`.
  - `types.ts` exports: `requireSubaccountId(run: WorkflowRun): string`. Re-exports `WorkflowRun`, `WorkflowStepRun`, `WorkflowDefinition`, `WorkflowStep`, `RunContext`, `AgentDecisionStep`, `ActionCallStep`, `InvokeAutomationStep`, `WorkflowRunMode` (all from existing sources — `db/schema` + `lib/workflow/types`). NO new type declarations.
  - Barrel preserves `WorkflowEngineService.TICK_QUEUE` and `WorkflowEngineService.WATCHDOG_QUEUE` via the import-then-compose pattern.
- **error_handling_strategy:** Pure module — no errors raised. `requireSubaccountId` throws on null (existing behaviour preserved verbatim).
- **dependencies:** none (foundation chunk).
- **verification:** `npm run lint`, `npm run typecheck` (clean). `npm run build:server` (clean). `grep -n "TICK_QUEUE\|WATCHDOG_QUEUE\|requireSubaccountId" server/services/workflowEngineService.ts` shows ONLY re-exports, not declarations.

### Chunk 2 — Definition + context + ready-set helpers

- **name:** `chunk-2-helpers`
- **spec_sections:** §5.2, §5.3
- **files:**
  - CREATE `server/services/workflowEngine/definitionHelpers.ts`
  - CREATE `server/services/workflowEngine/contextHelpers.ts`
  - CREATE `server/services/workflowEngine/readySet.ts`
  - MODIFY `server/services/workflowEngineService.ts` (delete moved functions; switch internal call sites to imports from the new modules)
- **contracts:**
  - `definitionHelpers.ts` exports: `rehydrateDefinition(stored: Record<string, unknown>): WorkflowDefinition`, `loadDefinitionForRun(run: WorkflowRun): Promise<WorkflowDefinition | null>`, `findStepInDefinition(def: WorkflowDefinition, stepId: string): WorkflowStep | undefined`, `resolveWorkflowSlugForRun(run: WorkflowRun): Promise<string | null>`, `hasPriorSuccessfulRunForSlug(orgId: string, subaccountId: string | null, slug: string, excludeRunId: string): Promise<boolean>`, `createStepRunsForNewRun(runId: string, definition: WorkflowDefinition): Promise<void>`.
  - `contextHelpers.ts` exports: `withInvalidationGuard<T>(stepRunId, externalWork): Promise<T | null>`, `assertContextSize(bytes: number, runId: string): void`, `mergeStepOutputIntoContext(context: RunContext, stepId: string, output: unknown): RunContext`, `deleteStepOutputFromContext(context: RunContext, stepId: string): RunContext`, `shouldSuppressWebSocket(runMode: string | null | undefined): boolean`.
  - `readySet.ts` exports: `computeReadySet(def, stepRuns): WorkflowStep[]`, `materialisePendingStepRuns(runId, def, liveStepRuns): Promise<void>`, `emitWorkflowEvent(runId, subaccountId, type, payload, options?): Promise<void>`, `finaliseRunKnowledgeBindings(run, def, liveStepRuns): Promise<void>`, `finaliseBaselineArtefactCapture(runId, subaccountId, organisationId, userId, liveStepRuns): Promise<void>`.
- **error_handling_strategy:** Helpers throw `Error` directly for invariant violations (matches current behaviour). No service-error mapping at this layer.
- **dependencies:** Chunk 1 (uses `constants` + `types`).
- **verification:** Lint + typecheck + build:server. `grep -n "rehydrateDefinition\|computeReadySet\|withInvalidationGuard\|assertContextSize" server/services/workflowEngineService.ts` shows zero declarations remain.

### Chunk 3 — Step-lifecycle module (shared completion/cancel/replay/bulk)

- **name:** `chunk-3-step-lifecycle`
- **spec_sections:** §5.2 (architect may add files), §5.3, §4
- **files:**
  - CREATE `server/services/workflowEngine/stepLifecycle.ts`
  - MODIFY `server/services/workflowEngineService.ts`
- **contracts:** `stepLifecycle.ts` exports as free functions: `failStepRunInternal(sr, reason)`, `computeDownstreamSet(def, seedStepId)`, `handleBulkFanOut(run, def)`, `checkBulkParentCompletion(run)`, `replayDispatch(run, sr, step)`, `createReplayRun(orgId, runId, userId)`, `estimateCascadeCostCents(...)`, `computeCriticalPath(def, stepIds)`, `completeStepRunInternal(sr, output, options?)`, `completeStepRunFromReview(stepRunId, output, options?)`, `completeStepRun(stepRunId, options)`, `failStepRun(stepRunId, reason, userId?)`, `resumeInvokeAutomationStep(stepRunId)`. **Signatures match the current method signatures verbatim** — caller compatibility is the lock.
- **error_handling_strategy:** Functions throw `Error` for invariants; `failStepRunInternal` swallows + logs (preserves current best-effort semantics). No new error shapes.
- **dependencies:** Chunk 2 (uses `definitionHelpers`, `contextHelpers`, `readySet`).
- **verification:** Lint, typecheck, build:server. `grep -nE "this\.\w+" server/services/workflowEngine/stepLifecycle.ts` returns zero (catches missed `this` rebinding). Manually verify no member of stepLifecycle imports from `queueLifecycle/*` (one-way dep): `grep -n "from\s+['\"]\./queueLifecycle" server/services/workflowEngine/stepLifecycle.ts` returns zero.

### Chunk 4 — queueLifecycle/tick + dispatch

- **name:** `chunk-4-queue-tick-dispatch`
- **spec_sections:** §5.2, §5.3
- **files:**
  - CREATE `server/services/workflowEngine/queueLifecycle/tick.ts`
  - CREATE `server/services/workflowEngine/queueLifecycle/dispatch.ts`
  - MODIFY `server/services/workflowEngineService.ts`
- **contracts:**
  - `tick.ts` exports: `enqueueTick(runId: string): Promise<void>`, `tick(runId: string): Promise<void>`.
  - `dispatch.ts` exports: `dispatchStep(run, def, step, liveStepRuns)`, `resolveAgentForStep(run, step)`, `findReusableOutputForStep(...)`, `editStepOutput(...)`.
  - All four `dispatch.ts` functions are called by `tick.ts` directly (function imports, not method calls). `computeDownstreamSet` stays in `stepLifecycle.ts` (Chunk 3) and is imported by `dispatch.ts`.
- **error_handling_strategy:** Tick handler swallows + logs on advisory-lock contention (existing behaviour). Dispatch raises `Error` on missing-step invariants; raises typed `ActionTimeoutError` for action-call timeouts (re-exported from `workflowActionCallExecutor`).
- **dependencies:** Chunks 1, 2, 3. **DO NOT extract registerWorkers in this chunk** — registerWorkers stays in the barrel until Chunk 6.
- **verification:** Lint, typecheck, build:server. `grep -nE "this\.\w+" server/services/workflowEngine/queueLifecycle/{tick,dispatch}.ts` returns zero. `wc -l` on `tick.ts` < 500 LOC; `dispatch.ts` < 900 LOC (both well under the 1,500 services soft cap).

### Chunk 5 — queueLifecycle/watchdog + agentStep

- **name:** `chunk-5-queue-watchdog-agentstep`
- **spec_sections:** §5.2, §5.3
- **files:**
  - CREATE `server/services/workflowEngine/queueLifecycle/watchdog.ts`
  - CREATE `server/services/workflowEngine/queueLifecycle/agentStep.ts`
  - MODIFY `server/services/workflowEngineService.ts`
- **contracts:**
  - `watchdog.ts` exports: `watchdogSweep(): Promise<void>`.
  - `agentStep.ts` exports: `onAgentRunCompleted(stepRunId, result, agentRunId)`, `handleDecisionStepCompletion(sr, agentRunId, output, options?)`.
- **error_handling_strategy:** watchdog swallows + logs per-iteration errors (preserves cross-tenant sweep semantics). agentStep raises on invariant violations.
- **dependencies:** Chunks 1, 2, 3.
- **verification:** Lint, typecheck, build:server. `grep -n "this\." server/services/workflowEngine/queueLifecycle/{watchdog,agentStep}.ts` returns zero. Confirm no `agentStep.ts → tick.ts` import (peer-handler isolation): `grep -n "from\s+['\"]\./tick" server/services/workflowEngine/queueLifecycle/agentStep.ts` returns zero.

### Chunk 6 — registerWorkers + barrel thinning

- **name:** `chunk-6-register-workers-and-barrel`
- **spec_sections:** §5.7 (re-export shape, barrel target < 250 LOC), §1 goal 1, §8.1, §8.2, §8.9
- **files:**
  - CREATE `server/services/workflowEngine/queueLifecycle/registerWorkers.ts`
  - MODIFY `server/services/workflowEngineService.ts` (FINAL barrel form — < 250 LOC; only imports + the composed `WorkflowEngineService` object literal + a single `export type` re-export block for any type that was previously surfaced from the barrel)
- **contracts:**
  - `registerWorkers.ts` exports: `registerWorkers(): Promise<void>`. The function continues to register THREE pg-boss workers (`TICK_QUEUE`, `WATCHDOG_QUEUE`, `AGENT_STEP_QUEUE`) using `createWorker` from `lib/createWorker.js`, with `resolveOrgContext` overrides that match the current behaviour. **DO NOT change the worker registration semantics in this chunk** — re-org of WF4 belongs to Chunk 7.
  - Barrel exports verbatim: `export const WorkflowEngineService = { ... }` composing the named imports from sub-modules. Plus any types from `types.ts` that are surfaced today.
- **error_handling_strategy:** Barrel has no business logic; cannot raise. registerWorkers preserves current logging.
- **dependencies:** Chunks 1–5. This is the **keystone commit** — after it lands the old monolith is gone and all 5 callers compile against the new barrel.
- **verification:** Lint, typecheck, build:server. `wc -l server/services/workflowEngineService.ts` reports < 250. `grep -nE "this\.\w+" server/services/workflowEngine/queueLifecycle/registerWorkers.ts` returns zero. `npm run build:client` (smoke that no transitive import broke). Manually verify all 5 callers (3a list) still type-check — TypeScript will surface any drift; no separate verification needed beyond `npm run typecheck`.

### Chunk 7 — Raw db → getOrgScopedDb migration inside new tree

- **name:** `chunk-7-org-scoped-db`
- **spec_sections:** §1 goals 6, 7, 8 (WF3, WF4, WF6)
- **files:**
  - CREATE `server/services/workflowEngine/queueLifecycle/runLookup.ts` (named cross-tenant org-resolution exception — exports THREE helpers, one per queue entry point, all internally using `withAdminConnection`): (a) `loadRunForOrgResolution(runId)` → `{ id, organisationId, status, ... } | null` for tick handlers that start from `runId`; (b) `loadRunForStepRunOrgResolution(stepRunId)` → `{ runId, organisationId, stepRunRow } | null` for agent-step handlers that start from `stepRunId` (joins `workflow_step_runs` → `workflow_runs` → `organisations.id`); (c) `findTimedOutRunCandidates(asOf: Date)` → `Array<{ runId, organisationId, ...minimal sweep fields }>` for the watchdog cross-tenant sweep (returns the candidate list grouped by organisationId so the watchdog can iterate and process each candidate inside a per-org `withOrgTx`).
  - CREATE `server/services/workflowEngine/queueLifecycle/advisoryLock.ts` (named advisory-lock exception — exports a SINGLE connection-pinned helper `withRunAdvisoryLock(runId, fn)` that checks out one client from the admin pool, runs `SELECT pg_try_advisory_lock($1)` on that client, runs `fn()` if the lock was acquired, and runs `SELECT pg_advisory_unlock($1)` on the SAME client in a `finally` block before releasing it back to the pool. **Acquire and release MUST execute on the same physical Postgres connection** — pg advisory locks are session-scoped (per the Postgres docs); a release issued on a different pooled connection is a no-op and the lock pins to whichever session acquired it until that session closes. The helper returns `null` if the lock cannot be acquired (do-not-block contention path) and the result of `fn()` otherwise.)
  - MODIFY `server/services/workflowEngine/queueLifecycle/tick.ts`
  - MODIFY `server/services/workflowEngine/queueLifecycle/dispatch.ts`
  - MODIFY `server/services/workflowEngine/queueLifecycle/watchdog.ts`
  - MODIFY `server/services/workflowEngine/queueLifecycle/agentStep.ts`
  - MODIFY `server/services/workflowEngine/queueLifecycle/registerWorkers.ts`
  - MODIFY `server/services/workflowEngine/stepLifecycle.ts`
  - MODIFY `server/services/workflowEngine/definitionHelpers.ts`
  - MODIFY `server/services/workflowEngine/readySet.ts`
  - MODIFY `server/services/workflowAgentRunHook.ts` (WF6 — line 36 raw `db.select` becomes `getOrgScopedDb`)
  - MODIFY `scripts/guard-baselines.json` (or equivalent baseline file for `verify-with-org-tx-or-scoped-db.sh`) — REMOVE the 22 workflowEngineService.ts entries and the 1 workflowAgentRunHook.ts entry; ADD two allowlist entries for `server/services/workflowEngine/queueLifecycle/runLookup.ts` (annotated `cross-tenant initial run lookup`) and `server/services/workflowEngine/queueLifecycle/advisoryLock.ts` (annotated `session-scoped pg advisory lock, not tenant-scoped`).
- **contracts:** Every `db.select|insert|update|delete|transaction|execute` call against `workflow_runs`, `workflow_step_runs`, `workflow_step_reviews`, `workflow_run_event_sequences`, `workflow_templates`, `workflow_template_versions`, `system_workflow_templates`, `system_workflow_template_versions`, `workflow_studio_sessions`, `agent_runs` (the hook call) becomes `const tx = getOrgScopedDb('workflowEngine.<callsite>'); await tx.X(...)`. Two named exception FILES allowed inside `server/services/workflowEngine/**`, nowhere else:

  **(1) Cross-tenant org-resolution** — three named helpers in `runLookup.ts`, one per queue entry point:
  - `loadRunForOrgResolution(runId)` — tick handler pattern. Loads the run by id (cross-tenant), returns minimal `{ id, organisationId, status, ... }` (or null if missing). Tick handler then calls `withOrgTx(run.organisationId, ...)` for the rest of its work.
  - `loadRunForStepRunOrgResolution(stepRunId)` — agent-step handler pattern (entry from `onAgentRunCompleted(stepRunId, result, agentRunId)`). Joins `workflow_step_runs.id = stepRunId` → `workflow_runs.id = step_run.workflow_run_id` and returns `{ runId, organisationId, stepRunRow }`. Agent-step handler then calls `withOrgTx(organisationId, ...)`.
  - `findTimedOutRunCandidates(asOf: Date)` — watchdog sweep pattern. Returns `Array<{ runId, organisationId, ...minimal fields needed for the sweep decision }>` across all orgs. Watchdog handler iterates the array and processes each candidate inside its own `withOrgTx(candidate.organisationId, async () => { ... })`. The watchdog does NOT hold a transaction across orgs.

  All three helpers internally use `withAdminConnection` (single named `withAdminConnection` site in the tree, inside `runLookup.ts`). All three return the minimal shape the caller needs — no business logic in the helpers. Builder MUST NOT invent ad-hoc cross-tenant lookups; if a queue entry point needs an additional org-resolution shape not on this list, escalate to plan revision before writing code.

  **(2) Session-scoped pg advisory lock** — `pg_try_advisory_lock(runId)` / `pg_advisory_unlock(runId)` are session-level locks; acquire and release MUST run on the same physical connection. Goes through the connection-pinned `withRunAdvisoryLock(runId, fn)` helper in `advisoryLock.ts`. The helper checks out one admin client, acquires the lock, runs `fn()` if acquired (returning its result), releases the lock in a `finally` block on the SAME client, then returns the client to the pool. Pattern: `await withRunAdvisoryLock(runId, async () => { ...handler body... })`. Free `tryAcquire` / `release` functions are FORBIDDEN — pool churn would silently leak locks.

  Session-var-set GUC reads STAY on the bare connection (out of grep scope; not `db.select|insert|update|delete|transaction|execute`).
- **error_handling_strategy:** `getOrgScopedDb()` throws `failure('missing_org_context')` when called outside `withOrgTx` — this becomes a hard error on the affected handlers. Builder MUST re-wrap each handler entry point in `withOrgTx(run.organisationId, ...)` AFTER the named-exception calls complete. Three handler patterns, one per queue entry point:

  - **Tick** (`tick(runId)`): `await withRunAdvisoryLock(runId, async () => { const run = await loadRunForOrgResolution(runId); if (!run) return; await withOrgTx(run.organisationId, async () => { ...tick body... }); });`. The `withRunAdvisoryLock` helper returns `null` and skips `fn` if the lock is contended (do-not-block semantics, matching current behaviour).
  - **Agent-step** (`onAgentRunCompleted(stepRunId, result, agentRunId)`): `const ctx = await loadRunForStepRunOrgResolution(stepRunId); if (!ctx) return; await withOrgTx(ctx.organisationId, async () => { ...completion body using ctx.runId + ctx.stepRunRow... });`. No advisory lock required — agent-step completion is its own queue job and does not contend with tick on the same runId.
  - **Watchdog** (`watchdogSweep()`): `const candidates = await findTimedOutRunCandidates(new Date()); for (const c of candidates) { await withOrgTx(c.organisationId, async () => { ...timeout-handling body for this candidate... }); }`. The candidate discovery is cross-tenant; each candidate's handling is per-org. The watchdog MUST NOT hold a transaction across orgs and MUST NOT open `withOrgTx` before `findTimedOutRunCandidates` returns.

  Connections: advisory lock acquire + release stay on the same physical connection inside `withRunAdvisoryLock`; org-resolution lookups use a separate admin connection (cross-tenant); body tenant operations use a third connection inside `withOrgTx`. The handler MUST NOT call bare `db.*`, `withAdminConnection`, or `pg_try_advisory_lock` directly anywhere — only the named helpers in `runLookup.ts` and `advisoryLock.ts`.
- **dependencies:** Chunks 1-6 (the split must be done; this migrates the bodies).
- **verification:** Lint, typecheck, build:server. `grep -nE "db\.(select|insert|update|delete|transaction|execute)" server/services/workflowEngine/` returns matches ONLY inside `server/services/workflowEngine/queueLifecycle/advisoryLock.ts` (the named pg-advisory-lock exception); every other file in the tree returns zero. `grep -nE "withAdminConnection" server/services/workflowEngine/` returns matches ONLY inside `server/services/workflowEngine/queueLifecycle/runLookup.ts` (the named cross-tenant-resolution exception); `withAdminConnection` appears at most THREE times in the tree (one per org-resolution helper: `loadRunForOrgResolution`, `loadRunForStepRunOrgResolution`, `findTimedOutRunCandidates`), all inside `runLookup.ts`; call sites use the named helpers and never call `withAdminConnection` directly. `grep -nE "pg_(try_)?advisory_(un)?lock" server/services/workflowEngine/` returns matches ONLY inside `server/services/workflowEngine/queueLifecycle/advisoryLock.ts`; no caller may issue raw advisory-lock SQL. `grep -nE "tryAcquireRunAdvisoryLock|releaseRunAdvisoryLock" server/services/workflowEngine/` returns ZERO matches (free acquire/release helpers are forbidden; only the connection-pinned `withRunAdvisoryLock` wrapper is exported). `grep -nE "export (const|function|async function) (loadRunForOrgResolution|loadRunForStepRunOrgResolution|findTimedOutRunCandidates)" server/services/workflowEngine/queueLifecycle/runLookup.ts` shows EXACTLY three matches (one per named org-resolution helper); no other org-resolution exports exist in the tree. `npx vitest run server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts` if such a test exists locally and remains targeted. **Critical:** `verify-with-org-tx-or-scoped-db.sh` baseline has exactly TWO entries inside `server/services/workflowEngine/**`: one for `runLookup.ts` (covering all three named org-resolution helpers in a single file) and one for `advisoryLock.ts`; nothing else. CI-only check; builder removes the 23 legacy entries and adds the two named-exception entries in this chunk.

### Chunk 8 — RLS migration for the five FK-only workflow tables (WF1)

- **name:** `chunk-8-rls-migration`
- **spec_sections:** §6, §1 goal 3, §1 goal 4, §8.5, §8.6
- **files:**
  - CREATE `migrations/0359_workflow_tables_rls.sql`
  - CREATE `migrations/0359_workflow_tables_rls.down.sql`
  - MODIFY `server/config/rlsProtectedTables.ts` (add 5 entries; correct the existing `workflow_runs:906` migration reference per §7 open question 4)
- **contracts:**
  - SQL: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` for each of:
    - `workflow_step_runs` — EXISTS via `workflow_runs.organisation_id` (one-level join through `run_id`).
    - `workflow_step_reviews` — EXISTS via `workflow_runs.organisation_id` (two-level join: `step_run_id → workflow_step_runs → workflow_runs`).
    - `workflow_studio_sessions` — EXISTS via `users.organisation_id` (join `created_by_user_id → users.id`).
    - `workflow_run_event_sequences` — EXISTS via `workflow_runs.organisation_id` (one-level join through `run_id`).
    - `flow_step_outputs` — EXISTS via `flow_runs.organisation_id` (one-level join through `flow_run_id`).
  - All policies use the canonical guard shape from `migrations/0213_fix_cached_context_rls.sql:67-86`: `current_setting('app.organisation_id', true) IS NOT NULL AND current_setting('app.organisation_id', true) <> '' AND EXISTS (...)` for both `USING` and `WITH CHECK`. **Inside the EXISTS predicate, every `::uuid` cast wraps the GUC read in `NULLIF(...)`** so the cast cannot throw if Postgres re-orders the AND chain or evaluates the EXISTS independently: `EXISTS (SELECT 1 FROM workflow_runs wr WHERE wr.id = <table>.workflow_run_id AND wr.organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid)`. `NULL::uuid` is well-defined (returns NULL); empty-string-to-uuid is not.
  - `DROP POLICY IF EXISTS` for each policy name (safe re-run pattern).
  - Down migration: `DROP POLICY`, `ALTER TABLE NO FORCE ROW LEVEL SECURITY`, `ALTER TABLE DISABLE ROW LEVEL SECURITY` in reverse order.
  - `rlsProtectedTables.ts` adds 5 entries with `policyMigration: '0359_workflow_tables_rls.sql'` and an honest rationale (cite the data class held by each: agent outputs / HITL decisions / chat candidate file contents / event-sequence counters / step outputs).
- **error_handling_strategy:** SQL errors surface from the migration runner. No application-code error paths in this chunk.
- **dependencies:** Chunks 1-7 (so the engine code in the new tree is using `getOrgScopedDb` BEFORE the policies start enforcing — otherwise the engine would break on first deploy).
- **verification:** Lint (skipped — SQL only), `npm run db:generate` reports no schema drift (the migration is hand-authored DDL, not Drizzle-generated). Manual `psql` smoke against dev DB: open a `withOrgTx`, attempt a cross-tenant SELECT, confirm 0 rows. CI runs `verify-rls-coverage.sh`, `verify-rls-protected-tables.sh`, `verify-rls-session-var-canon.sh` — out of scope for local execution per executor note.

### Chunk 9 — WORKFLOW_RUNS_* permission family + route migration (WF5)

- **name:** `chunk-9-perm-family-and-routes`
- **spec_sections:** §7, §1 goal 5, §8.10, §8.11
- **files:**
  - CREATE `migrations/0360_workflow_runs_org_permissions.sql`
  - CREATE `migrations/0360_workflow_runs_org_permissions.down.sql`
  - MODIFY `server/lib/permissions.ts` (add 4 keys to `ORG_PERMISSIONS`, 4 entries to `ALL_PERMISSIONS`; update `DEFAULT_PERMISSION_SET_TEMPLATES` for Org Admin / Org Manager / Org Viewer)
  - MODIFY `server/routes/workflowRuns.ts` (9 gate sites — see §3b table)
- **contracts:**
  - SQL inserts:
    ```sql
    INSERT INTO permissions (key, description, group_name) VALUES
      ('org.workflow_runs.view',          'View Workflow runs at the org level',                        'org.workflows'),
      ('org.workflow_runs.cancel',        'Cancel running Workflows at the org level',                  'org.workflows'),
      ('org.workflow_runs.edit_output',   'Edit completed step outputs and submit form inputs (org)',   'org.workflows'),
      ('org.workflow_runs.approve',       'Decide on Workflow approval gates (org)',                    'org.workflows')
    ON CONFLICT (key) DO NOTHING;
    ```
  - Backfill: grant `org.workflow_runs.view` to sets holding `org.agents.view`; grant the other three to sets holding `org.agents.edit`. Use the `NOT EXISTS` guard pattern from `0201_universal_brief_permissions.sql:39-43`.
  - `permissions.ts`: `WORKFLOW_RUNS_VIEW: 'org.workflow_runs.view'`, `WORKFLOW_RUNS_CANCEL: 'org.workflow_runs.cancel'`, `WORKFLOW_RUNS_EDIT_OUTPUT: 'org.workflow_runs.edit_output'`, `WORKFLOW_RUNS_APPROVE: 'org.workflow_runs.approve'`. Add to `ALL_PERMISSIONS` array next to existing workflow rows (around line 271-276).
  - `DEFAULT_PERMISSION_SET_TEMPLATES.Org Admin` already gets all `Object.values(ORG_PERMISSIONS)` — no edit needed. `Org Manager` gets VIEW + CANCEL + EDIT_OUTPUT + APPROVE per spec §3. `Org Viewer` gets VIEW only.
  - `workflowRuns.ts` route edits: replace `AGENTS_VIEW` → `WORKFLOW_RUNS_VIEW` at line 100; replace `AGENTS_EDIT` → `WORKFLOW_RUNS_CANCEL` at lines 152, 291, 311, 345; replace `AGENTS_EDIT` → `WORKFLOW_RUNS_START` at line 162; replace `AGENTS_EDIT` → `WORKFLOW_RUNS_EDIT_OUTPUT` at lines 177, 203; replace `AGENTS_EDIT` → `WORKFLOW_RUNS_APPROVE` at line 247.
- **error_handling_strategy:** Route gates throw 403 on missing perm via the `requireOrgPermission` middleware. No new error paths.
- **dependencies:** Technically independent of Chunks 1-8 — no source code or schema dependency. Plan sequences Chunk 9 AFTER Chunk 8 for release-hygiene reasons (one release window covering both perm and RLS migration; matching migration-prefix block reduces operator audit churn) but the ordering is a preference, not a hard constraint. §5 dependency graph reflects this preferred ordering, not a hard dep.
- **verification:** Lint, typecheck, build:server, build:client. Manual `grep -n "AGENTS_VIEW\|AGENTS_EDIT" server/routes/workflowRuns.ts` returns ZERO matches. Manual `grep -n "WORKFLOW_RUNS_" server/lib/permissions.ts` shows 4 new keys in `ORG_PERMISSIONS` plus the existing `WORKFLOW_RUNS_START`. `npm run db:generate` reports no schema drift.

### Chunk 10 — Final sweep + doc-sync + tasks/todo.md closure

- **name:** `chunk-10-final-sweep`
- **spec_sections:** §10, §8.13, §11 (Docs Stay In Sync — CLAUDE.md global rule)
- **files:**
  - MODIFY `architecture.md` (one-paragraph description of the new `workflowEngine/` directory; update §Workflows section's "Services" table; add Q3 FK-EXISTS pattern note if not already covered)
  - MODIFY `tasks/todo.md` (mark WF1, WF2, WF3, WF4, WF5, WF6, WF8 with the `closure-pending-merge` shape — see contract below). **Do NOT write placeholder `<num>`.** Concrete PR-number substitution is owned by the Phase 3 `finalisation-coordinator` step, which knows the merge commit and the PR number. Chunk 10 inside Phase 2 leaves the marker in a finalisation-ready shape; finalisation does the literal text swap in the merge commit.
  - MODIFY `KNOWLEDGE.md` (Q5 pattern entry — "FK-scoped tenant data ≠ RLS-protected"; optional — operator may already have entries)
  - MODIFY `DEVELOPMENT_GUIDELINES.md` (Q4 convention — "A pg-boss worker that sets `resolveOrgContext: () => null` MUST re-open `withOrgTx` after loading the run's organisation"; optional — operator confirms)
- **contracts:** Doc updates per file. No code changes. `tasks/todo.md` closure-pending-merge shape — replace `[status:open]` with `[status:closure-pending-merge:slug:split-workflow-engine]` on each WF item. Finalisation in Phase 3 will swap that token to `[status:closed:pr:<num>]` after the squash-merge produces a concrete PR number.
- **error_handling_strategy:** N/A.
- **dependencies:** Chunks 1-9 (this is the post-merge sweep that captures lessons).
- **verification:** No automated checks. `pr-reviewer` confirms doc-sync via the canonical checklist in `docs/doc-sync.md`. `spec-conformance` confirms the spec's §8 acceptance criteria are met.

**Executor notes:** Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

## 5. Dependency graph

```
Chunk 0 (sweep + plan)
   │
   ▼
Chunk 1 (constants + types)
   │
   ▼
Chunk 2 (helpers: definition, context, readySet)
   │
   ▼
Chunk 3 (stepLifecycle)
   │
   ▼
Chunk 4 (queueLifecycle/tick + dispatch)        Chunk 5 (queueLifecycle/watchdog + agentStep)
   │                                                  │
   └────────────────────┬─────────────────────────────┘
                        ▼
                  Chunk 6 (registerWorkers + barrel) ◄─── KEYSTONE
                        │
                        ▼
                  Chunk 7 (db → getOrgScopedDb + WF4/WF6)
                        │
                        ▼
                  Chunk 8 (RLS migration)   ╌╌╌╌╌╌►   Chunk 9 (perm family + routes)
                                              (release-hygiene preference, not hard dep)
                        │                                  │
                        └──────────────┬───────────────────┘
                                       ▼
                                Chunk 10 (doc-sync, todo closure)
```

Chunks 4 and 5 can land in either order or as a single combined PR — both depend only on Chunks 1-3. Chunks 8 and 9 are independent of each other but both depend on Chunks 1-7. Chunk 10 is post-merge sweep.

The barrel commit (**Chunk 6**) is the keystone: after it lands, the old monolith is gone and all 5 callers compile against the new barrel. Reverting any earlier chunk requires reverting Chunk 6 first.

## 6. Acceptance-criteria coverage matrix

| # | Spec §8 criterion | Chunk(s) that satisfy it |
|---|---|---|
| 1 | `workflowEngineService.ts` < 250 LOC, re-exports only | Chunk 6 (final barrel) |
| 2 | Directory tree under `workflowEngine/` matches §5.2 (architect may add files) | Chunks 1-6; architect adds `queueLifecycle/dispatch.ts`, `queueLifecycle/registerWorkers.ts`, `stepLifecycle.ts` (justified in §1) |
| 3 | `npm run build:server` exits 0 | Every chunk's verification step |
| 4 | `npm run lint` exits 0 | Every chunk's verification step |
| 5 | Five RLS migrations land; `verify-rls-coverage.sh` + `verify-rls-protected-tables.sh` pass | Chunk 8 (one combined migration; gate scripts are CI-only per executor note) |
| 6 | `rlsProtectedTables.ts` allowlist contains the five new entries | Chunk 8 |
| 7 | `verify-with-org-tx-or-scoped-db.sh` does not introduce new baseline entries inside `server/services/workflowEngine/**` | Chunk 7 (removes the 23 legacy entries; permits ONLY the two named cross-cutting exceptions — `runLookup.ts` for initial cross-tenant run lookup and `advisoryLock.ts` for session-scoped pg advisory locks — and no other `workflowEngine` baseline entries) |
| 8 | `verify-canonical-retry.sh` baseline honoured (no new occurrences in new code) | Implicit — no new retry logic introduced anywhere |
| 9 | `verify-loc-cap.sh` passes — no file in new tree exceeds 1,500 LOC services soft cap; barrel < 250 LOC | Chunk 6 (barrel); Chunks 1-6 (sub-modules sized in advance, see §1 LOC estimates) |
| 10 | `WORKFLOW_RUNS_*` perm family exists, default-granted, all workflow-run routes gate on it | Chunk 9 |
| 11 | No route file uses `AGENTS_VIEW` for workflow-run access after this build | Chunk 9 (verification: `grep AGENTS_VIEW server/routes/workflowRuns.ts` returns zero) |
| 12 | All 5 callers in §4 compile against the new barrel without source modifications | Chunk 6 (final barrel preserves the locked surface) |
| 13 | `tasks/todo.md` WF1, WF2, WF3, WF4, WF5, WF6, WF8 marked `[status:closed:pr:<num>]` | Chunk 10 (Phase 2) writes the `[status:closure-pending-merge:slug:split-workflow-engine]` token; Phase 3 `finalisation-coordinator` swaps the token to `[status:closed:pr:<num>]` in the merge commit once the concrete PR number exists |

All 13 criteria mapped. **WF2 (god-file persists)** is closed structurally by Chunks 1-6 (LOC drops from 4,074 to < 250). **WF7 was already closed in the audit pass 2** — not in this build's scope.

## 7. Open questions for the operator

These four questions affect chunk content. Operator must answer before Chunk 8 / Chunk 9 starts.

1. **Permission count.** Spec §7 names three new perms (VIEW, EXECUTE, CANCEL). My §3b sweep found NINE route sites that need migration, requiring FOUR new perms (VIEW, CANCEL, EDIT_OUTPUT, APPROVE) + reuse of existing `WORKFLOW_RUNS_START` for EXECUTE. Accept the four-perm scope or insist on three (and document the route-vs-perm mismatch)?
2. **AGENT_STEP_QUEUE export.** Spec §4 implies `WorkflowEngineService.AGENT_STEP_QUEUE` is part of the locked surface; the actual code today does NOT expose it. Treat current behaviour as canonical (only TICK + WATCHDOG on the object), or add AGENT_STEP_QUEUE to the object during Chunk 6 (no caller uses it today; pure speculative addition)?
3. **`flow_step_outputs` inclusion.** The audit lumped this legacy-engine table with the WF1 finding. It is OUT of the spec-headlined "workflow engine being split" scope but IN the WF1-headlined "five RLS-uncovered workflow tables" scope. Include in Chunk 8's migration (one extra policy, ~20 LOC) or defer?
4. **`workflow_runs` manifest correction.** `rlsProtectedTables.ts:908` references `policyMigration: '0076_playbooks.sql'` but the actual policy was created in `0245_all_tenant_tables_rls.sql`. One-line drift correction inside Chunk 8 — operator confirms?

### Operator decisions (2026-05-15T02:48:40Z)

1. **Permission count:** **4 perms + reuse START.** Plan §3b and Chunk 9 already encode this. WF5 closes cleanly.
2. **AGENT_STEP_QUEUE:** **Keep current behaviour (do not expose).** Public surface in Chunk 6 is `TICK_QUEUE`, `WATCHDOG_QUEUE`, and the methods listed in §1 Barrel composition. Spec §4 wording is a documented deviation (see also §3d table-name correction); no caller uses `AGENT_STEP_QUEUE` today.
3. **`flow_step_outputs`:** **Include in Chunk 8.** Closes WF1 cleanly. Adds one parent-EXISTS policy (chain via `flow_runs.organisation_id`).
4. **Manifest drift:** **Fix in Chunk 8.** One-line correction in `rlsProtectedTables.ts:908` (`0076_playbooks.sql` → `0245_all_tenant_tables_rls.sql`).

### Documented spec deviations (will propagate to handoff.md)

- **D1.** Spec §1 goal 3 names tables that do not exist (`workflow_run_steps`, `workflow_definitions`, `workflow_audit_events`) and lists `workflow_runs` which already has RLS coverage. The audit-correct set used by this plan: `workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs`. The plan operates on the audit-correct set.
- **D2.** Spec §4 wording implies `AGENT_STEP_QUEUE` is exposed on `WorkflowEngineService`; in fact only `TICK_QUEUE` and `WATCHDOG_QUEUE` are exposed today. Operator decision keeps current behaviour.
- **D3.** Spec §7 names 3 new perms; the actual route surface needs 4 + reuse of `WORKFLOW_RUNS_START`. Operator decision accepts the 4-perm scope.

### Plan-review log

**Round 1 — operator manual review (2026-05-15T02:55:00Z):** APPROVE with 4 should-fix + 2 tightenings, all applied to this plan in-place:

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| F1 | Should-fix | Barrel target shape imports `computeDownstreamSet` from `dispatch.js`, but Chunk 3 contract + Chunk 4 verification both say `computeDownstreamSet` lives in `stepLifecycle.ts` (imported by `dispatch.ts`). Compile-time mismatch if followed literally. | Moved `computeDownstreamSet` from the `dispatch.js` import to the `stepLifecycle.js` import group in §1 Barrel composition. |
| F2 | Should-fix | Chunk 7 verification "ZERO raw db.\* matches" contradicts the contract requiring the advisory lock + run-row load to happen BEFORE `withOrgTx` opens. Either the grep fails or the builder writes unsafe cross-tenant bare-db access. | Named the exception: new `runLookup.ts` exporting `loadRunForOrgResolution(runId)` that wraps `withAdminConnection`. Updated Chunk 7 verification grep + baseline allowlist to permit this one helper path only. Updated error_handling_strategy to make the pattern explicit. |
| F3 | Should-fix | Circular-import grep `\.\.\/workflowEngineService` only catches one-level-up imports. Files under `queueLifecycle/` would import as `../../workflowEngineService`, bypassing the gate. | Replaced with path-depth agnostic regex `([./]+)workflowEngineService(\.js)?` in §2 R1 mitigation. |
| F4 | Should-fix | RLS guard chain in Chunk 8 relies on AND short-circuit to prevent empty-string-to-uuid cast. Postgres can re-order AND clauses; the cast could throw instead of denying. | Wrapped every `::uuid` cast inside the EXISTS predicates with `NULLIF(current_setting('app.organisation_id', true), '')::uuid`. Updated §1 RLS-strategy per-table example for `workflow_studio_sessions` and §4 Chunk 8 canonical guard-shape text. |
| T1 | Tightening | §5 dependency graph shows Chunk 8 → Chunk 9 arrow, but Chunk 9 text says it is technically independent of Chunks 1-8. | Reworded Chunk 9 `dependencies` to say "technically independent; sequenced after Chunk 8 for release-hygiene preference, not hard dep" and softened the graph arrow with annotation. |
| T2 | Tightening | Chunk 10 instructs writing `[status:closed:pr:<num>]` to `tasks/todo.md`. The PR number does not exist until Phase 3 finalisation. | Renamed to `closure-pending-merge` shape; Phase 2 writes `[status:closure-pending-merge:slug:split-workflow-engine]`; Phase 3 finalisation does the literal swap to `[status:closed:pr:<num>]` in the merge commit. |

All six fixes applied 2026-05-15T02:55:00Z. The only true build-breaker was F1; F2 was the highest-risk implementation ambiguity for WF4/WF6 isolation work and is now explicit.

**Round 2 — operator manual review (2026-05-15T03:10:00Z):** APPROVE with 3 should-fix + 1 tightening. All applied. Round 1's `runLookup.ts` exception was correct but created secondary inconsistencies; Round 2 closes them.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| R2-F1 | Should-fix | Chunk 7 still says raw `db.*` grep returns zero, but the advisory-lock query in `tick.ts` is explicitly kept on the bare connection — that would fail the grep. | Named the second exception: new `advisoryLock.ts` exporting `tryAcquireRunAdvisoryLock(runId)` and `releaseRunAdvisoryLock(runId)`, which call bare `db.execute(sql\`SELECT pg_try_advisory_lock(...)\`)` (advisory locks are session-scoped, not tenant-scoped, so they correctly bypass `getOrgScopedDb`). Updated Chunk 7 file list, contract, verification grep, baseline allowlist, and error_handling_strategy to reflect both named exceptions. |
| R2-F2 | Should-fix | Acceptance criterion #7 still said "the new tree has zero baseline entries", which contradicts the runLookup allowlist entry from Round 1 (and now the advisoryLock entry from R2-F1). | Rewrote criterion #7: "removes the 23 legacy entries; permits ONLY the two named cross-cutting exceptions (`runLookup.ts` and `advisoryLock.ts`) and no other workflowEngine baseline entries." |
| R2-F3 | Should-fix | Chunk 7 verification said `withAdminConnection` count must equal the number of cross-tenant lookup call sites. Wrong — `withAdminConnection` lives inside `runLookup.ts` and is called by the helper once per resolution; call sites invoke `loadRunForOrgResolution`, not `withAdminConnection` directly. | Verification text now says `withAdminConnection` appears EXACTLY ONCE inside `runLookup.ts`, regardless of how many handlers call `loadRunForOrgResolution`. |
| R2-T1 | Tightening | R6 mitigation still said "keep the initial lookup on the bare pool" and "advisory lock is fine on the bare connection", which contradicts the Round 1 + R2-F1 named-helper approach. | Updated R6 mitigation to route both exceptions through their named helpers explicitly: `loadRunForOrgResolution` (cross-tenant lookup) and `tryAcquireRunAdvisoryLock` / `releaseRunAdvisoryLock` (advisory lock). |

All four fixes applied 2026-05-15T03:10:00Z. No new architectural blocker. Plan is now internally consistent across the §1 architecture notes, §2 risk mitigations, §4 Chunk 7 contract, and §6 acceptance-criteria matrix.

**Round 3 — operator manual review (2026-05-15T03:25:00Z):** NOT-READY → APPROVE after fixes. 2 should-fix + 1 tightening. The advisory-lock helper introduced in Round 2 had a connection-pinning bug; this round closes it.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| R3-F1 | Should-fix (architectural) | `advisoryLock.ts` shape from Round 2 used two free functions (`tryAcquireRunAdvisoryLock` + `releaseRunAdvisoryLock`) on a pooled connection. pg advisory locks are session-scoped — acquire and release MUST run on the same physical Postgres connection. With pooling, the release could land on a different connection, silently no-op, and leak the lock until session close. | Replaced the two free functions with a single connection-pinned helper `withRunAdvisoryLock(runId, fn)`. The helper checks out one admin client, acquires the lock on that client, runs `fn()` if acquired, releases the lock in a `finally` block on the SAME client, then returns the client to the pool. Free `tryAcquire` / `release` exports are FORBIDDEN. Updated Chunk 7 file definition, contract, verification grep (now also catches raw `pg_(try_)?advisory_(un)?lock` SQL outside the helper and forbids any export named `tryAcquireRunAdvisoryLock` / `releaseRunAdvisoryLock`), error_handling_strategy (handler pattern is now `await withRunAdvisoryLock(runId, async () => { ... })`), and R6 mitigation (explicit connection-pinning rationale). |
| R3-F2 | Should-fix | Acceptance criterion #13 still cited the `[status:closed:pr:<num>]` token, contradicting Round 1's T2 fix (Chunk 10 writes `[status:closure-pending-merge:...]` in Phase 2). | Criterion #13 rewritten: Chunk 10 (Phase 2) writes the closure-pending token; Phase 3 `finalisation-coordinator` swaps it to `[status:closed:pr:<num>]` in the merge commit. |
| R3-T1 | Tightening | R1 circular-import grep was anchored on `from\s+`, missing dynamic `await import('../../workflowEngineService.js')` patterns. Codebase already uses dynamic imports for the barrel elsewhere, so a future copy-paste could slip past the gate. | R1 grep replaced with the path-depth AND import-style agnostic form: `grep -rE "workflowEngineService(\.js)?['\"]" server/services/workflowEngine/` returns zero. Catches static `from`, dynamic `import()`, and any quoted reference. |

All three fixes applied 2026-05-15T03:25:00Z. R3-F1 is the architectural one — pg advisory locks are now correctly pinned to a single connection for their entire lifetime. R3-F2 and R3-T1 are wording / regex tightenings.

**Round 4 — operator manual review (2026-05-15T03:40:00Z):** NOT-READY → APPROVE after fixes. 1 should-fix. The connection-pinned advisory-lock helper from Round 3 was correct; the remaining gap was org-resolution coverage for the three queue entry points.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| R4-F1 | Should-fix | `loadRunForOrgResolution(runId)` was too narrow. Tick enters from `runId` and the helper fits; but agent-step enters from `stepRunId` (`onAgentRunCompleted(stepRunId, result, agentRunId)`) so it needs a stepRunId-keyed helper; and `watchdogSweep()` is a cross-tenant batch sweep that needs candidate-discovery + per-org iteration, not a single-run helper. Without explicit shapes for all three, the builder might invent ad-hoc cross-tenant lookups or misuse the runId helper. | Expanded `runLookup.ts` to export THREE named helpers, one per queue entry point: `loadRunForOrgResolution(runId)` for tick; `loadRunForStepRunOrgResolution(stepRunId)` for agent-step (joins `workflow_step_runs.id → workflow_runs.id → organisations`); `findTimedOutRunCandidates(asOf)` for watchdog (returns per-org candidate list; watchdog iterates and opens a separate `withOrgTx` per candidate, never holding a tx across orgs). Updated Chunk 7 contract, error_handling_strategy (three explicit handler patterns), verification grep (asserts the three helper exports exist and no others), and R6 mitigation (covers all three entry points). The baseline still has exactly two entries because all three helpers live in one file. |

Fix applied 2026-05-15T03:40:00Z. Each queue entry point has an explicit, named, grep-able org-resolution shape. No ad-hoc cross-tenant lookups permitted. Plan is **LOCKED FOR EXECUTION** as of this round.

## 8. Self-consistency pass

- §1 architecture notes match §4 chunk inventory: ✓ (every architectural rule is operationalised by a chunk; every chunk respects every rule).
- §3 caller sweep covers all importers, all gates, all raw-db sites, all RLS tables, all plumbing: ✓ (operator may add to the sweep — none expected).
- §4 chunk plan covers every spec §8 acceptance criterion: ✓ (see §6 matrix).
- §5 dependency graph is forward-only: ✓ (no chunk imports work from a later chunk).
- §6 acceptance-criteria mapping is exhaustive: ✓ (all 13 spec §8 items mapped).
- §7 open questions surface every place where spec wording was loose or contradicted reality: ✓ (four questions).
- No file in the new tree exceeds the 1,500 services soft cap: ✓ (largest: dispatch.ts at ~790 LOC; everything else < 600 LOC).
- Public surface preserved at every chunk boundary: ✓ (Chunks 1-5 leave the old file as an intermediate stop; Chunk 6 swaps in the final barrel; types/imports stay reachable from the same paths the 5 callers use today).
- No new module-level state introduced: ✓ (no new globals; existing queue-name constants move to `constants.ts` as immutable `const` exports).
- No drive-by cleanup: ✓ (the `workflow_runs:908` manifest drift correction is justified by spec §6 "Add allowlist entries… `verify-rls-coverage.sh` must continue to pass" and is one line; not classified as drive-by). The `flow_step_outputs` policy is justified by the audit; not drive-by.
- Test gates are CI-only: ✓ (executor note included; no chunk runs `npm run test:gates` or equivalent).

## 9. References

- Source file: `server/services/workflowEngineService.ts` (4,074 LOC)
- Pre-existing pure sibling: `server/services/workflowEngineServicePure.ts` (untouched per spec §5.4)
- Pattern-setter spec: `tasks/builds/feat-split-skillexecutor/spec.md` §5
- Canonical FK-EXISTS policy template: `migrations/0213_fix_cached_context_rls.sql:67-86`
- Canonical perm-seed migration template: `migrations/0201_universal_brief_permissions.sql`, `migrations/0257_workspace_permissions.sql`
- Canonical org-isolation policy template: `architecture.md` § Row-Level Security → Canonical org-isolation policy template
- Audit log (source of WF1-WF8): `tasks/review-logs/codebase-audit-log-workflow-engine-2026-05-14T16-30-31Z.md`
- TODO entries: `tasks/todo.md` lines 1577-1601
- Central permission enum: `server/lib/permissions.ts`
- RLS manifest: `server/config/rlsProtectedTables.ts`
- pg-boss worker wrapper: `server/lib/createWorker.ts`
- Org-scoped DB helper: `server/lib/orgScopedDb.ts`
