---
status: DRAFT
date: 2026-05-15
author: spec-coordinator (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: feat-split-agentexecutionservice
output_location: tasks/builds/feat-split-agentexecutionservice/spec.md
companion_spec: tasks/builds/feat-split-skillexecutor/spec.md
---

# feat/split-agentexecutionservice — Module Decomposition Spec

Split `server/services/agentExecutionService.ts` (2,807 LOC) into cohesive sub-modules along lifecycle phases. Preserve the public API. No behaviour change. **This spec adopts the §5 module-decomposition conventions from `tasks/builds/feat-split-skillexecutor/spec.md` by reference.** Where this build differs from the pattern-setter, the difference is called out explicitly in §5.

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Agent Runtime |
| Capability owner | platform |
| Lifecycle state on launch | Mature |
| Risk surface | agent runtime |
| Review cadence | on-incident-only |

Note: same launch-state caveat as the companion spec — the capability "Agent Runtime / agentExecutionService" is already in `Mature` on the Asset Register. This build refactors an existing capability; it does not register a new one. The `Lifecycle state on launch` field reflects the pre-existing state.

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | S | No new capability acquired; reorganises code that already exists |
| Build | M | 2,807 LOC across one giant function and a small ring of helpers; smaller than the companion build and benefits from its pattern-setting |
| Carry | S | Each phase module is smaller and cheaper to read, test, and modify than the monolith; the existing `*Pure.ts` and `*Loop.ts` extractions already paid down most of the carry cost — this build finishes the job |
| decommission | S | Single barrel file is decommissioned as a unit by deleting in-place content and leaving only re-exports |

## 1. Goals

1. Reduce `server/services/agentExecutionService.ts` from 2,807 LOC to a thin barrel (target < 250 LOC) that re-exports the public surface and composes phase modules.
2. Decompose the 1,936-line `executeRun` method into cohesive phase functions along real execution-lifecycle boundaries (validation → persistence → configuration → preparation → dispatch → completion). NOT arbitrary LOC cuts.
3. Adopt the §5 conventions from the pattern-setter spec (`tasks/builds/feat-split-skillexecutor/spec.md`). Where this build differs, the difference is justified in §5.
4. Preserve the public API. Every caller named in §4 below must compile without source edits beyond following barrel re-exports.
5. Preserve test coverage. No existing test loses an assertion. No new test files are authored by this build (per §13 and `docs/spec-context.md` `runtime_tests: pure_function_only`). Existing tests stay; their import paths may shift but their assertions do not.
6. Leverage the existing `agentExecutionServicePure.ts`, `agentExecutionLoop.ts`, `agentExecutionTypes.ts`, and `executionBackends/*` extractions by importing from them — do not duplicate their contents. This build does NOT modify any of those four siblings (see §2 and §5.4); any new pure-helper extraction that surfaces during a chunk is deferred to a follow-up build (`AGENTEXEC-SPLIT-DEF-*`).

## 2. Non-Goals

- No behaviour change. The same run requests produce the same `agent_runs` rows, the same `agent_execution_events` sequence numbers, the same trigger events, the same backend dispatches, the same completion records.
- No new features, no new run statuses, no new event types, no new metrics.
- No public-surface changes — `agentExecutionService.executeRun`, `agentExecutionService.startRunAsync`, `AgentRunRequest`, `AgentRunResult`, `resumeAgentRun`, `ResumeAgentRunOptions`, `ResumeAgentRunResult`, and the `LoopParams` / `LoopResult` re-exports retain identical types and call signatures.
- No changes to the `ExecutionBackend` adapter contract or any backend adapter under `server/services/executionBackends/**`.
- No changes to `agentExecutionLoop.ts` (the agentic loop body — already extracted in a prior build).
- No changes to `agentExecutionServicePure.ts` (the pure helpers — already extracted).
- No changes to `agentExecutionTypes.ts` (the neutral `LoopResult` type — already extracted).
- No commingling with unrelated refactors. No drive-by lint cleanup. No schema changes.

## 3. Framing Assumptions

- Repo is pre-production per `docs/spec-context.md`; testing posture is `static_gates_primary` — CI gates are the success signal, not local test runs.
- `agentExecutionService.executeRun()` is the main entry point for autonomous agent execution. Callers include routes, jobs, workflows, and the skill executor's `spawn_sub_agents` handler.
- Caller imports use the codebase's `.js` import-extension convention; re-exports must preserve this.
- The 1,936-line `executeRun` body is a strict sequential pipeline: each phase reads the output of earlier phases and writes inputs the next phase consumes. There are no cycles within `executeRun`. The phases are amenable to extraction as pure-ish helper functions that thread a context object through.
- `ExecutionClosureContext` (lines 138-158) and `buildBackendOptionsForMode` (lines 172-265) are already factored as a discrete concern inside the file. Moving them to a sibling module is a mechanical extraction.
- Prompt-builder helpers (`buildTeamRoster`, `buildSmartBoardContext`, `buildTaskContext`, `buildTaskOverviewContext`, `buildAutonomousInstructions`) are already factored as standalone functions inside the file. Moving them to a sibling module is a mechanical extraction.
- `resumeAgentRun` (lines 2442-2590) is a separate exported function from a different sprint. It can move to its own module independently.
- TypeScript strict mode is on. `noImplicitAny`, `strictNullChecks`, and the existing tsconfig path mapping are immutable for this build.
- The companion spec (`feat-split-skillexecutor/spec.md`) is the pattern-setter and is expected to land first or in parallel. The conventions in its §5 are stable enough to cite by reference.

## 4. Public-Surface Lock

These exports of `server/services/agentExecutionService.ts` MUST remain importable from `server/services/agentExecutionService.js` at the end of the migration with identical types and runtime semantics. The barrel re-exports them.

| Export | Kind | Consumers (representative — full caller list in §10) |
|---|---|---|
| `agentExecutionService` | object — `{ executeRun(request: AgentRunRequest): Promise<AgentRunResult>; startRunAsync(request: AgentRunRequest): Promise<{ runId: string; status: 'running' \| AgentRunResult['status']; isExisting?: true }> }`. BOTH methods are part of the locked public surface; the barrel-exported `agentExecutionService` object MUST contain both with identical signatures and semantics. | `routes/agentRuns.ts`, `routes/agents.ts`, `routes/subaccountAgents.ts`, `routes/skills.ts`, `routes/subaccountSkills.ts`, `jobs/orchestratorFromTaskJob.ts`, `services/scheduledTaskService.ts`, `services/agentScheduleService.ts`, `services/subtaskWakeupService.ts`, `services/skillExecutor.ts`, `tools/internal/assignTask.ts` |
| `AgentRunRequest` | exported interface | `routes/*`, `jobs/*`, `services/*`, `tools/*` |
| `AgentRunResult` | exported interface | same as `AgentRunRequest` |
| `resumeAgentRun` | exported async function | Sprint 3B integration (not yet wired to an HTTP endpoint; library entry only — but the export is locked) |
| `ResumeAgentRunOptions` | exported interface | callers of `resumeAgentRun` |
| `ResumeAgentRunResult` | exported interface | callers of `resumeAgentRun` |
| `LoopParams` | re-exported `import type { LoopParams }` from `agentExecutionLoop.ts` | `services/middleware/types.ts`, `services/executionBackends/*` |
| `LoopResult` | re-exported `import type { LoopResult }` from `agentExecutionTypes.ts` | external consumers that follow the historical import path |

The argument-shape interfaces `ExecutionClosureContext` (private), `TaskWithAgent` (private) are NOT public surface — they may move to internal modules without re-export.

If a consumer imports any other symbol from `agentExecutionService.ts` not in this table, that import path is locked too. The §10 caller sweep covers it; missing callers are spec gaps.

## 5. Module-Decomposition Conventions — Adoption

### 5.1. Reference to pattern-setter

This spec adopts §5.1 (naming conventions), §5.4 (Pure / impure separation rules), §5.5 (Module-level state rules) and §5.6 (Test-collocation rule) from `tasks/builds/feat-split-skillexecutor/spec.md` verbatim. The two specs share these conventions so future audits and tools (and future agents reading both at once) see the same shape.

The §5.2 (directory layout), §5.3 (dependency direction) and §5.7 (barrel re-export shape) sections of the pattern-setter are adapted to this build's specifics below.

This build does NOT introduce a §5.2.1-style "stub / thin-dispatcher placement rule" — `agentExecutionService.ts` has no handler registry equivalent. Phase functions are bespoke, not enumerable, so the placement rule does not apply.

### 5.2. Directory layout for this build

The barrel (`agentExecutionService.ts`) stays at `server/services/agentExecutionService.ts`. The split contents live in a sibling directory at `server/services/agentExecutionService/`. Pre-existing siblings (`agentExecutionServicePure.ts`, `agentExecutionLoop.ts`, `agentExecutionTypes.ts`) stay at their current paths — this build does NOT move them, and the spec is explicit on the boundary.

```
server/services/
  agentExecutionService.ts        ← barrel only (target < 250 LOC)
  agentExecutionServicePure.ts    ← pre-existing, untouched
  agentExecutionLoop.ts           ← pre-existing, untouched
  agentExecutionTypes.ts          ← pre-existing, untouched
  executionBackends/              ← pre-existing directory, untouched
  agentExecutionService/
    types.ts                      ← AgentRunRequest, AgentRunResult, TaskWithAgent, ExecutionClosureContext, RunExecutionContext (internal)
    backendDispatch.ts            ← ExecutionClosureContext consumer + buildBackendOptionsForMode + the registry.resolve(mode).dispatch(input) call wrapper
    promptBuilders.ts             ← buildTeamRoster, buildSmartBoardContext, buildTaskContext, buildTaskOverviewContext, buildAutonomousInstructions
    runLifecycle/
      validate.ts                 ← Phase A (source phases 0a-0d): subaccountId/subaccountAgentId validation, org kill switch, org-subaccount detection, idempotency lookup. Pure-as-possible: takes request, returns either an early-exit result or { proceed: true, idempotencyLookupKeys, isOrgSubaccountRun }
      persistRun.ts               ← Phase B (source phases 1-2): controller-style resolution, agent_runs INSERT, emit run.started (awaited — sequence 1 invariant), foundation.controller_style.derived, orchestrator.routing_decided (if applicable), org_subaccount_run metric
      configure.ts                ← Phase C (source phases 2-load-agent through 2d): load agent + saLink, derive limits, snapshot config (config_hash), workspace-limit check, DEC hash snapshot + iteration count, policy envelope resolve + persist + emit, executionMode allow-list gate
      loadContext.ts              ← Phase D1 (source phases 3, 3.5, 4, 4.5): run-context data load, auto-knowledge retrieval, org-processes load, immutable hierarchy snapshot build
      prepare.ts                  ← Phase D2 (source phases 5, 5a, 5b, 6, 7): skill→tool resolution, auto-inject read_data_source, MCP tool resolution, task context build (team roster + smart board), 3-layer system-prompt assembly, conversation-thread prepending, context_sources_snapshot write, prompt-assembly persistence + emission
      dispatch.ts                 ← Phase E (source phase 8): backend-dispatch orchestration wrapper consuming backendDispatch.ts. Optional — see Q3; may be merged into Chunk 3 and removed from this layout if Q3 resolves that way.
      complete.ts                 ← Phase F (source phases 9, 10, 11, 12): final agent_runs UPDATE with status/summary/totals/durationMs/completedAt, run.completed / run.failed / run.timeout Live-log emissions, websocket agent:run:completed emission, insights extraction for workspace memory + entities, non-blocking agent_completed trigger firing, guaranteed MCP cleanup (preserved inside the existing try/finally control flow)
    resume.ts                     ← resumeAgentRun + ResumeAgentRunOptions + ResumeAgentRunResult + checkpoint reading + configSnapshot equality validation
```

Note: Phase E (backend dispatch) — the bulk of the work — lives in `backendDispatch.ts` at the top level of `agentExecutionService/` (not inside `runLifecycle/`) because it is consumed by `executeRun` AND would be reasonable to consume from a future Sprint 3B resume path. The optional `runLifecycle/dispatch.ts` (Chunk 8) is a thin orchestration wrapper around `backendDispatch.ts`; if Q3 resolves to "merge Chunk 8 into Chunk 3" then `runLifecycle/dispatch.ts` is not created and this node is removed from the layout.

### 5.3. Dependency direction (DAG, no cycles)

```
                  ┌────────────────────────────┐
                  │ agentExecutionService.ts   │  (barrel — public surface)
                  └─────────────┬──────────────┘
                                │ re-exports
        ┌───────────────────────┼──────────────────────────┐
        ▼                       ▼                          ▼
    types.ts             agentExecutionService          resume.ts
    (type-only)          impl: executeRun is here       (resumeAgentRun)
                         OR moved to a single
                         orchestrator module
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        runLifecycle/             backendDispatch.ts    promptBuilders.ts
         ├ validate.ts    (A)      (Phase E core)        (helpers used by D2)
         ├ persistRun.ts  (B)             │
         ├ configure.ts   (C)             ▼
         ├ loadContext.ts (D1)       executionBackends/registry.ts
         ├ prepare.ts     (D2)       (pre-existing — unchanged)
         ├ dispatch.ts    (E opt — Q3)
         └ complete.ts    (F)
              │
              ▼
        agentExecutionServicePure.ts (pre-existing) + DB / drizzle / sibling services
```

Concrete rules:
- The barrel `agentExecutionService.ts` imports from `agentExecutionService/types`, the `agentExecutionService` constant's home (decided at architect time per §11.Q1), and `agentExecutionService/resume`. The barrel re-exports the public surface listed in §4. NOTHING else.
- `types.ts` is a leaf — `import type {...}` (type-only) from `db/schema`, `shared/types/**`, the named pre-existing siblings (e.g. `LoopParams` from `agentExecutionLoop.ts`), and external libs. NO runtime imports from `db`, no imports of any kind from sibling service modules under `server/services/` other than `import type` from the named pre-existing siblings, and no imports from sibling sub-modules under `agentExecutionService/`.
- Each `runLifecycle/<phase>.ts` is a function module exporting one or more phase functions. They import `types.ts` for shape, `db` / drizzle helpers / schema tables / agent services / event emitters / observability primitives as needed for their phase. They do NOT import each other (each phase consumes data passed in via the orchestrator, not from a peer phase). The one permitted exception: `runLifecycle/dispatch.ts` (if Chunk 8 keeps it) MAY import `backendDispatch.ts` — that import is the whole point of the wrapper.
- `backendDispatch.ts` imports `types.ts`, `executionBackends/registry.ts`, `executionBackends/options.ts`, `executionBackends/types.ts`, and `agentExecutionLoop.ts` (`LoopParams` type-only). It does NOT import `runLifecycle/*`.
- `promptBuilders.ts` is leaf-ish: imports `db`, drizzle helpers, schema tables, `agentExecutionServicePure.ts` (for `assembleVoiceBlock`). It does NOT import any `runLifecycle/*` or `backendDispatch.ts`.
- `resume.ts` imports `types.ts`, `db`, the message service (`streamAgentRunMessages`), `toolCallsLogProjectionService.project`, `agentExecutionServicePure.buildResumeContext`, `middleware/types.MiddlewareContext`, and the schema tables it reads from. It does NOT import `runLifecycle/*` (the resume path is orthogonal to the forward-execution phases until Sprint 3B integration, which is out of scope here).
- No file under `agentExecutionService/` may import the barrel `agentExecutionService.ts`.

### 5.4. Pre-existing extractions (do not duplicate)

This file has already had four extractions performed in prior builds. The split MUST respect their boundaries:

| Pre-existing sibling | What lives there | This build's relationship |
|---|---|---|
| `agentExecutionServicePure.ts` | `buildResumeContext`, `computeRunResultStatus`, `assembleVoiceBlock` (pure logic) | Imported by `runLifecycle/*` and `resume.ts`. NOT modified. |
| `agentExecutionLoop.ts` | `runAgenticLoop`, `LoopParams` (the agentic loop body) | Imported by `backendDispatch.ts` and `executionBackends/*`. NOT modified. |
| `agentExecutionTypes.ts` | `LoopResult` (neutral type) | Re-exported from the barrel. NOT modified. |
| `executionBackends/*` | Backend adapter registry + per-backend dispatch modules | Used by `backendDispatch.ts`. NOT modified. |

The pre-existing `agentExecutionServicePure.ts` is the canonical home for FUTURE pure-helper extractions surfaced by this refactor. This build does NOT append to it (`agentExecutionServicePure.ts` is in §2 Non-Goals and §5.4's "NOT modified" column). Any pure-helper opportunity discovered during a chunk is logged to `tasks/todo.md` under `AGENTEXEC-SPLIT-DEF-*` and deferred to a follow-up build. The spec is explicit on this boundary so a chunk PR that touches `agentExecutionServicePure.ts` is caught at review.

### 5.5. Module-level state rules

`agentExecutionService.ts` has NO module-level mutable state today (verified by grep). The split MUST NOT introduce any.

This is a contrast with `skillExecutor.ts`, which has two module-level state sites (the processor registry and the pg-boss sender). Phase functions in this build are stateless — they take a context object as input and return a (possibly updated) context object plus side-effect results.

### 5.6. Barrel re-export shape

```typescript
// server/services/agentExecutionService.ts (target shape)
export { agentExecutionService } from './agentExecutionService/index.js';
// OR: the `agentExecutionService` constant is defined in the barrel itself with
// executeRun calling the phase modules in order. Decided at architect time.
export type {
  AgentRunRequest,
  AgentRunResult,
} from './agentExecutionService/types.js';
export {
  resumeAgentRun,
} from './agentExecutionService/resume.js';
export type {
  ResumeAgentRunOptions,
  ResumeAgentRunResult,
} from './agentExecutionService/resume.js';
export type { LoopParams } from './agentExecutionLoop.js';
export type { LoopResult } from './agentExecutionTypes.js';
```

The `agentExecutionService` constant's body (the object literal containing `executeRun` as the orchestrator that calls phase functions in order, AND `startRunAsync` as a sibling method that calls `this.executeRun(...)`) either lives in the barrel itself or in an `agentExecutionService/index.ts`. The architect plan decides — default is "in the barrel" so both methods are grep-discoverable by future readers at the canonical path. CRITICAL: `executeRun` and `startRunAsync` MUST remain methods on the same object literal regardless of Q1's outcome — `startRunAsync`'s `void this.executeRun(request).catch(...)` line depends on the `this` binding. Splitting them would break the fire-and-forget detachment.

## 6. Current State (Brief)

`server/services/agentExecutionService.ts` is 2,807 LOC organised across five concerns:

1. **Backend-dispatch closure** (lines 91-265): `ExecutionClosureContext` interface, `buildBackendOptionsForMode` function. Already factored as a discrete concern inside the file; clean extraction candidate.
2. **Public types** (lines 267-447): `AgentRunRequest` (137 lines including all the historical field comments), `AgentRunResult`, `TaskWithAgent` (private).
3. **`agentExecutionService` object methods** (lines 453-2388): two async methods on the exported `agentExecutionService` constant.
   - **`executeRun`** (lines ~457-2302, ~1,850 LOC): the sequential lifecycle pipeline. Numbered phases inside the method, in source order: 0a-0d (validate / kill switch / org-subaccount detection / idempotency), 1 (resolve controller style), 2 (create run record), 2 (load agent config — second use of label "2" at line 675), 2a (snapshot config), 2b (workspace-limit check), 2c (DEC hash snapshot), 2d (policy envelope), 3 (load run context data), 3.5 (auto-knowledge retrieval — spec §8 Chunk 4B), 4 (load org processes), 4.5 (build immutable hierarchy snapshot — INV-4), 5 (resolve skills → tools + instructions), 5a (auto-inject read_data_source), 5b (MCP tool resolution), 6 (build task context with smart offloading), 7 (build full system prompt — 3-layer assembly), 8 (execute — dispatch through executionBackendRegistry), 9 (finalise the run), 10 (extract insights for workspace memory + entities), 11 (fire agent_completed triggers — non-blocking), 12 (MCP cleanup — guaranteed).
   - **`startRunAsync`** (lines ~2304-2388): a fire-and-forget shape that inserts the `agent_runs` row, returns `{ runId, status: 'running' }` immediately, and detaches `this.executeRun(request)` via `void`+`.catch(...)`. Carries the existing `PLAN_GAP` comment (lines 2376-2380) marking the non-durable detachment.
4. **`resumeAgentRun`** (lines 2389-2590): Sprint 3A library entry point. Reads run + checkpoint + messages; validates configVersion against current configSnapshot (unless `useLatestConfig: true`); returns hydrated `MiddlewareContext`.
5. **Prompt-builder helpers** (lines 2615-2806): `buildTeamRoster`, `buildSmartBoardContext`, `buildTaskContext`, `buildTaskOverviewContext`, `buildAutonomousInstructions`.

The five concerns map to the §5.2 module tree. The ~1,850-line `executeRun` is the load-bearing extraction work: it threads ~30 named local variables (`run`, `agent`, `saLink`, `tokenBudget`, `maxToolCalls`, `timeoutMs`, `configSkillSlugs`, `configCustomInstructions`, `resolvedControllerStyle`, `controllerStyleSource`, `isOrgSubaccountRun`, `pipeline`, `mcpClients`, `mcpLazyRegistry`, `runContextData`, `agentDomain`, `configVersion`, `hierarchyContext`, `orgProcesses`, etc.) through the phase pipeline. The split factors these into a `RunExecutionContext` value object that phase functions accept and return.

The §7 chunk plan introduces `RunExecutionContext` only as an internal type in `agentExecutionService/types.ts`. It is NOT public surface. The architect plan pins its exact shape — likely a single mutable record passed by reference for the cohesive in-method state today, or a series of immutable input/output records per phase. Both are acceptable; behaviour must not change.

## 7. Chunked Migration Plan

Each chunk is a complete, independently-mergeable PR (squashable into the integration branch). Builders execute one chunk at a time; G1 runs after each. The order is dependency-driven — early chunks land foundation pieces that later chunks consume.

### Chunk 1 — Scaffold + types

- Create `server/services/agentExecutionService/` directory.
- Create `agentExecutionService/types.ts` and move `AgentRunRequest`, `AgentRunResult`, `TaskWithAgent`, `ExecutionClosureContext` into it.
- Author the (still-empty) `RunExecutionContext` interface that subsequent chunks populate. Architect plan pins exact shape at chunk authoring; if the shape is uncertain at this chunk, declare `interface RunExecutionContext { /* extended in Chunks 4-9 as each phase lands */ }` and revisit.
- Update barrel to re-export `AgentRunRequest`, `AgentRunResult` from `types.ts`. Public surface preserved.
- G1: lint, typecheck, build:server. No behaviour change.

### Chunk 2 — Prompt-builder helpers

- Create `agentExecutionService/promptBuilders.ts` containing: `buildTeamRoster`, `buildSmartBoardContext`, `buildTaskContext`, `buildTaskOverviewContext`, `buildAutonomousInstructions`.
- Update in-file callers (`executeRun`) to import from the new path.
- G1: lint, typecheck, build:server.

### Chunk 3 — Backend-dispatch closure module

- Create `agentExecutionService/backendDispatch.ts` containing `buildBackendOptionsForMode` and any backend-dispatch helper logic that today lives inline around the `executionBackendRegistry.resolve(mode).dispatch(input)` call.
- `ExecutionClosureContext` already moved to `types.ts` in Chunk 1; `backendDispatch.ts` imports it from there.
- Update in-file caller (`executeRun`'s backend-dispatch site) to use the new module.
- G1: lint, typecheck, build:server. Functional: verify a synthetic run against each `executionMode` value still dispatches to the correct adapter (CI gate covers this; no new local test).

### Chunk 4 — Phase A: validation / idempotency / kill switch

- Create `agentExecutionService/runLifecycle/validate.ts` containing a `validateAndPrepare(request)` function that performs the steps inside `executeRun` 0a-0d:
  - subaccountId + subaccountAgentId presence validation (throws `Error` with `statusCode: 400` + `errorCode` per current shape)
  - org-execution kill switch check (DB read; returns "early exit" record when disabled)
  - isOrgSubaccount detection (DB read)
  - idempotencyCandidateKeys/idempotencyKey resolution + early-exit return when a duplicate is found
- Update `executeRun` to call `validateAndPrepare` and branch on its return shape.
- G1: lint, typecheck, build:server. Existing tests that exercise the validate / idempotency paths (e.g. `__tests__/agentExecutionService.middlewareContext.test.ts`) must still pass without assertion changes.

### Chunk 5 — Phase B: run persistence + run-started observability

- Create `agentExecutionService/runLifecycle/persistRun.ts` containing a `persistAndAnnounce(request, validated)` function that performs:
  - controller-style resolution via `deriveControllerStyle`
  - `agent_runs` INSERT with all current fields
  - websocket emissions `agent:run:started`, `live:agent_started`
  - awaited `run.started` Live-log emission (critical bookend — sequence-number invariant)
  - `foundation.controller_style.derived` fire-and-forget emission
  - `orchestrator.routing_decided` emission when `request.orchestratorDispatch` is present
  - `org_subaccount_run` observability metric when `isOrgSubaccountRun: true`
- Update `executeRun` to call `persistAndAnnounce` and consume its returned `run` row.
- G1: lint, typecheck, build:server. Sequence-number invariant is the load-bearing assertion — the `run.started` emission MUST stay awaited.

### Chunk 6 — Phase C: config + workspace-limit + DEC snapshot + policy envelope

- Create `agentExecutionService/runLifecycle/configure.ts` containing a `configureRun(run, request)` function that performs:
  - agent load via `agentService.getAgent`
  - saLink load from `subaccountAgents` (the new single-config path post-migration 0106)
  - config-snapshot construction + configHash + UPDATE to `agent_runs`
  - workspace-limit check via `checkWorkspaceLimits` (early-exit with failed run + UPDATE on `false`)
  - DEC hash snapshot + iteration count (with `triggerContext.executionSnapshot` write)
  - policy-envelope resolution + persistence + `foundation.policy_envelope.resolved` emission + `allowedEnvironments` enforcement (`ExecutionModeNotAllowedForAgentError`)
- Update `executeRun` to call `configureRun` and consume the returned context.
- G1: lint, typecheck, build:server. CI gate `verify-policy-envelope-*` etc. cover policy-envelope contract preservation.

### Chunk 7a — Phase D1: load run context + knowledge + org processes + hierarchy

Covers source-order phases 3, 3.5, 4, 4.5 (lines ~890-976). Create `agentExecutionService/runLifecycle/loadContext.ts` containing a `loadRunContextAndHierarchy(run, context)` function that, in source order:

- Phase 3: invokes `loadRunContextData` (from `runContextLoader.ts`) and builds the `dataSourceContents` projection used downstream.
- Phase 3.5: invokes `assembleKnowledgeForRun` (from `retrievalService.ts`) and appends the loaded chunks to the knowledge base. Fail-open semantics preserved (degraded result → empty `loaded`).
- Phase 4: invokes `getOrgProcessesForTools` for the `trigger_process` skill.
- Phase 4.5: invokes `buildHierarchyForRun` for the immutable hierarchy snapshot (INV-4) and persists `hierarchy_depth` on the run row via the existing fire-and-forget `db.update(...).catch(...)` shape. `HierarchyContextBuildError` is logged as a warning, not rethrown.

Update `executeRun` to call `loadRunContextAndHierarchy` and consume its returned context. G1: lint, typecheck, build:server. Existing tests that depend on the run-context / hierarchy paths must still pass.

### Chunk 7b — Phase D2: skill + tool resolution + task context + system prompt assembly

Covers source-order phases 5, 5a, 5b, 6, 7 (lines ~977-1538). Create `agentExecutionService/runLifecycle/prepare.ts` containing a `prepareRun(run, context)` function that, in source order:

- Phase 5: 3-layer skill → tool + instruction resolution (`resolveAgentSkillsToTools` / equivalent).
- Phase 5a: auto-inject `read_data_source` (spec §8.4) when the resolver result requires it.
- Phase 5b: MCP tool resolution (lazy + eager).
- Phase 6: build task context via `buildSmartBoardContext` / `buildTaskContext` / `buildTaskOverviewContext` (all from `promptBuilders.ts`). `buildTeamRoster` is called here (it feeds the task-context block).
- Phase 7: 3-layer system-prompt assembly via `buildSystemPrompt`. Uses `buildAutonomousInstructions` (from `promptBuilders.ts`) + `assembleVoiceBlock` (from `agentExecutionServicePure.ts` — pre-existing). Conversation thread context is read via `buildThreadContextReadModel` and prepended via `prependThreadContextToBasePrompt`. `context_sources_snapshot` is written. Prompt assembly is persisted via `persistAssembly` and emitted.

Update `executeRun` to call `prepareRun`. G1: lint, typecheck, build:server.

### Chunk 8 — Phase E: backend dispatch (consume Chunk 3)

- The backend dispatch site in `executeRun` already uses `buildBackendOptionsForMode` (moved in Chunk 3). This chunk extracts the surrounding orchestration into `runLifecycle/dispatch.ts` (a small file calling `backendDispatch.ts` and consuming the `BackendDispatchResult`).
- The split here is small — most of the heavy lifting was in Chunk 3.
- Update `executeRun` to call the new dispatch wrapper.
- G1: lint, typecheck, build:server. Functional: backend dispatch contract preserved (verified by CI gates on each adapter).
- Note: if Q3 resolves to "merge Chunk 8 into Chunk 3", `runLifecycle/dispatch.ts` is not created — the §5.2 directory layout and §5.3 DAG also drop that node. See Q3 in §11.

### Chunk 9 — Phase F: completion + insights + triggers + MCP cleanup

Covers source-order phases 9, 10, 11, 12 (lines ~1677-2300). Create `agentExecutionService/runLifecycle/complete.ts` containing a `finalizeRun(run, dispatchResult, request, context)` function that, in source order:

- Phase 9 (finalise the run): status / summary / totals derivation (via `computeRunResultStatus` from the pre-existing `agentExecutionServicePure.ts`); final `agent_runs` UPDATE with status, summary, totals, durationMs, completedAt; `run.completed` / `run.failed` / `run.timeout` Live-log emission; websocket `agent:run:completed` emission.
- Phase 10 (extract insights for workspace memory + entities): existing insight-extraction call(s) preserved with current ordering and current fire-and-forget vs awaited semantics. Existing `tryEmitAgentEvent` paths stay fire-and-forget. Memory-block scoring + injected-memory scoring calls retained.
- Phase 11 (fire `agent_completed` triggers — non-blocking): existing non-blocking trigger firing preserved exactly.
- Phase 12 (MCP cleanup — guaranteed): the existing `finally`-style MCP cleanup contract is preserved verbatim. The `finalizeRun` extraction MUST keep the cleanup site inside the same try/finally control flow that protects it today — phase ordering, error-suppression behaviour, and cleanup guarantee are load-bearing and cannot be relaxed during the extraction.

Returns the public `AgentRunResult`. Update `executeRun` to call `finalizeRun`. G1: lint, typecheck, build:server.

### Chunk 10 — resumeAgentRun extraction

- Create `agentExecutionService/resume.ts` containing `resumeAgentRun`, `ResumeAgentRunOptions`, `ResumeAgentRunResult`.
- Update barrel to re-export from the new location.
- This is a clean extraction — `resumeAgentRun` has no overlap with `executeRun` and minimal cross-imports.
- G1: lint, typecheck, build:server. Existing `resumeAgentRun` test (if any) must still pass without assertion change.

### Chunk 11 — Barrel thinning + caller sweep + doc sync

- Trim `agentExecutionService.ts` to the §5.6 barrel shape.
- **`startRunAsync` placement (locked acceptance criterion):** `startRunAsync` ships in the SAME module that holds the `agentExecutionService` constant (per Q1 default: inline in the barrel; or inside `agentExecutionService/index.ts` if Q1 chooses (b)). It MUST remain a method on the same object literal as `executeRun` so that the existing `void this.executeRun(request).catch(...)` call resolves `this` against the live object. If Q1 chooses (b) and the orchestrator moves to `agentExecutionService/index.ts`, both methods move together and the barrel re-exports the resulting constant. Under no Q1 outcome may `startRunAsync` be split from `executeRun` — the `this`-binding is load-bearing for the existing fire-and-forget detachment and the locked public surface in §4.
- Sweep callers (§10 list). Where a caller imports a type that has moved to `types.ts` or `resume.ts`, optionally update the caller to point at the new canonical path; otherwise leave the caller on the barrel re-export. **Hard boundary:** pre-existing siblings declared untouched in §2 and §5.4 — `agentExecutionServicePure.ts`, `agentExecutionLoop.ts`, `agentExecutionTypes.ts`, and `executionBackends/*` (including `executionBackends/options.ts`) — are NEVER modified by this sweep even though they appear in §10. Their imports stay on the barrel re-export; if a chunk would touch their import lines, that chunk is out of scope.
- Update `architecture.md § Agent Execution Middleware Pipeline` to point at the new module tree (one short paragraph + pointer to the directory).
- Update `docs/doc-sync.md` if needed.
- G2 final: lint, typecheck, build:server, build:client.

### Anti-chunks (NOT in scope)

- No renames of any public-surface symbol.
- No changes to `agentExecutionLoop.ts`, `agentExecutionServicePure.ts`, `agentExecutionTypes.ts`, `executionBackends/*`.
- No changes to the `ExecutionBackend` adapter contract.
- No changes to the agentic-loop body.
- No new sequencing of any DB write.
- No new event types.
- No client-side changes (this is server-only).
- No new `*Pure.ts` extractions. `agentExecutionServicePure.ts` is untouched (§2, §5.4). If a natural pure-helper surfaces during a chunk, log it to `tasks/todo.md` under `AGENTEXEC-SPLIT-DEF-*` and defer to a follow-up build.

## 8. Verification Strategy

### 8.1. Per-chunk (G1)

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run build:server` — clean
- Targeted re-run of any EXISTING test file that touches the chunk's surface (e.g. `npx vitest run server/services/__tests__/agentExecutionService.middlewareContext.test.ts`) — must pass without assertion changes. No new test files are authored by this build (per §13 and the test-collocation rule in §5.6 of the companion spec).

### 8.2. End-of-build (G2)

- `npm run lint` + `npm run typecheck` + `npm run build:server` + `npm run build:client` — all green
- CI runs the full gate suite. CI is the success signal per `DEVELOPMENT_GUIDELINES §5` and `references/test-gate-policy.md`.

### 8.3. Behaviour-preservation evidence

This refactor MUST be a no-op functionally. Evidence:
- `agent_runs` row shape (columns written, default values, INSERT order) is identical before and after every chunk.
- `agent_execution_events` sequence-number invariants hold: `run.started` claims sequence 1 (load-bearing `await emitAgentEvent` per Chunk 5).
- `agent_run_snapshots` checkpoint shape unchanged.
- `agent_run_messages` write path unchanged.
- The order of side effects within `executeRun` is preserved across the split (validate → persist → emit → configure → prepare → dispatch → finalize).
- Existing tests pass without assertion changes: `__tests__/agentExecutionService.middlewareContext.test.ts`, any policy-envelope test, any resume-path test.
- No new fire-and-forget paths introduced; existing fire-and-forget paths (`tryEmitAgentEvent`) preserved exactly.
- The `PLAN_GAP` comment at the existing `startRunAsync` fire-and-forget call site is preserved verbatim — this is an existing technical-debt marker, not a finding for this build.

### 8.4. Bisect-friendly chunking

Each chunk is independently revertible. If a regression is detected in CI on chunk N+1, reverting chunk N+1 puts the codebase back into a working state with chunks 1..N preserved. The barrel guarantees public-surface stability at every chunk boundary.

## 9. Deferred Items

These items surfaced during scoping but are explicitly OUT of this build's scope. Routed to `tasks/todo.md` under tag `AGENTEXEC-SPLIT-DEF-*`:

- `AGENTEXEC-SPLIT-DEF-1`: `startRunAsync` fire-and-forget path (the `PLAN_GAP` comment at lines 2376-2380 of the current file). It bypasses pg-boss durability; orphan runs are tolerable today but a future audit may route this through the durable queue. Out of scope here.
- `AGENTEXEC-SPLIT-DEF-2`: `RunExecutionContext` shape consolidation. Today the in-method state is ~30 named locals threaded through phase boundaries. Chunk 1 authors the placeholder interface; Chunks 4-9 extend it as each phase function consumes / returns the running context. A follow-up build can normalise the shape after the split lands.
- `AGENTEXEC-SPLIT-DEF-3`: `validateAndPrepare` (Chunk 4 validate.ts) is mostly pure logic plus two DB reads. The DB reads could be hoisted out via a "fetcher" parameter so the validation logic itself becomes a `*Pure.ts` extraction. Deferred to keep this build minimal.
- `AGENTEXEC-SPLIT-DEF-4`: The `configure.ts` phase does five things (config snapshot, workspace limit, DEC snapshot, policy envelope, executionMode gate). It may be too coarse — a future build could split each into its own phase function with cleaner boundaries. Deferred.
- `AGENTEXEC-SPLIT-DEF-5`: `resumeAgentRun` (Chunk 10) is currently a single 150-line function. Once the runtime path of Sprint 3B lands, the function naturally splits into a "read checkpoint" + "validate config version" + "hydrate middleware context" trio. Defer until Sprint 3B integration adds the runtime caller.

## 10. Caller Sweep

The following 16 files genuinely `import` from `server/services/agentExecutionService` (verified at spec time by `grep -rE "from ['\"][^'\"]*\\/agentExecutionService(\\.js)?['\"]"` — filename-mentions in code/comments were excluded):

**Routes (preserve via barrel):**

- `server/routes/agentRuns.ts` — imports `agentExecutionService`
- `server/routes/agents.ts` — imports `agentExecutionService`
- `server/routes/subaccountAgents.ts` — imports `agentExecutionService`
- `server/routes/skills.ts` — imports `agentExecutionService` (`.executeRun` for skill test runs)
- `server/routes/subaccountSkills.ts` — imports `agentExecutionService` (`.executeRun` for skill test runs)

**Jobs (preserve via barrel):**

- `server/jobs/orchestratorFromTaskJob.ts` — `agentExecutionService.executeRun` (orchestrator → agent dispatch)

**Services (preserve via barrel):**

- `server/services/scheduledTaskService.ts` — `agentExecutionService.executeRun`
- `server/services/agentScheduleService.ts` — `agentExecutionService` (schedule-driven dispatch)
- `server/services/agentExecutionServicePure.ts` — type-only `AgentRunRequest`
- `server/services/agentExecutionLoop.ts` — type-only `AgentRunRequest`
- `server/services/executionBackends/options.ts` — type-only `AgentRunRequest`
- `server/services/subtaskWakeupService.ts` — `agentExecutionService.executeRun`
- `server/services/middleware/types.ts` — type-only (`AgentRunRequest`)
- `server/services/skillExecutor.ts` — `agentExecutionService` (for `spawn_sub_agents` handler dispatch)

**Tools (preserve via barrel):**

- `server/tools/internal/assignTask.ts` — `agentExecutionService.executeRun`

**Tests (preserve via barrel):**

- `server/services/__tests__/agentExecutionService.middlewareContext.test.ts`

Excluded from this list (re-checked at spec time — these files name `agentExecutionService` only in comments, strings, or docstrings, NOT in an `import` statement): `server/routes/webLoginConnections.ts`, `server/services/workflowEngineService.ts`, `server/services/agentExecutionEventService.ts`, `server/services/agentExecutionEventServicePure.ts`, `server/services/runtimeCheckService.ts`, `server/services/__tests__/registerOptimiserSchedulePure.test.ts`, `server/lib/testRunIdempotency.ts`. If a Chunk-11 sweep surfaces a real `import` from any of these, add it back.

Any caller not in this list, surfaced during the Chunk-11 sweep, MUST be added to this section and re-validated.

## 11. Open Questions

1. **Q1 — where does the `agentExecutionService` constant body live post-split?** Two options: (a) inline in the barrel `agentExecutionService.ts` (the orchestrator that calls phase functions in order — `executeRun` body stays grep-discoverable at the canonical path); (b) in `agentExecutionService/index.ts` (cleaner directory model, but adds one indirection). Default: (a) inline in the barrel. Architect plan re-confirms.
2. **Q2 — `RunExecutionContext` shape.** Single mutable record threaded through phases, or per-phase input/output records? Single mutable is simpler and matches the current in-method state shape; per-phase records are cleaner for future extraction. Default: single mutable for this build. Architect plan re-confirms.
3. **Q3 — does Chunk 8 (Phase E dispatch wrapper) add value over Chunks 3 + the existing dispatch site?** The dispatch site after Chunk 3 is already ~10 lines (build options → call registry → return result). Chunk 8 may be redundant. Default: keep Chunk 8 as a placeholder for future cohesion (returning a small `runLifecycle/dispatch.ts`), but the architect plan may merge it into Chunk 3.
4. **Q4 — does `resume.ts` (Chunk 10) really need its own module, or could it sit alongside the orchestrator?** It exports a public function (`resumeAgentRun`) plus two public types and is orthogonal to the forward-execution pipeline. Default: its own module. Architect plan re-confirms.

## 12. Self-Consistency Pass Result

- §4 public-surface table matches §5.6 barrel-re-export shape: ✓
- §5.2 directory layout matches §5.3 DAG: ✓
- §7 chunked plan covers every concern enumerated in §6: ✓
- §10 caller sweep covers the 16 files surfaced by import-grep at spec time (filename-only mentions excluded): ✓
- Public surface preserved at every chunk boundary: ✓
- No new module-level state introduced (§5.5): ✓
- No new external API call: ✓
- No new test file required (collocation rule): ✓
- Pre-existing `agentExecutionServicePure.ts`, `agentExecutionLoop.ts`, `agentExecutionTypes.ts`, `executionBackends/*` untouched: ✓
- Anti-chunks list excludes drive-by cleanup and refactor scope-creep: ✓

## 13. Testing Posture Statement

Per `docs/spec-context.md`: testing posture is `static_gates_primary`. Verification is CI gates + lint + typecheck + build. No new runtime test files added by this build. Existing tests stay; their import paths may shift but their assertions do not.

## 14. Execution-Safety Contracts

This build changes no write-path semantics, ordering, column set, or awaited/fire-and-forget behaviour. The code that performs each write moves into phase modules, but the write itself — its SQL, its columns, its sequence position relative to other side effects, and its awaited-vs-fire-and-forget shape — is byte-for-byte preserved. Existing contracts are preserved exactly:

- Idempotency-key resolution: same lookup set, same INSERT key.
- `agent_runs` INSERT order and column set: identical.
- `agent_execution_events` sequence-number invariants: `run.started` MUST claim sequence 1 via awaited emission (load-bearing — Chunk 5 preserves the `await` on `emitAgentEvent`).
- Controller-style resolution: same `deriveControllerStyle` call, same allow-list enforcement.
- Policy-envelope resolution: same `resolvePolicyEnvelope` + `persist` sequence, same `allowedEnvironments` gate, same emit-then-throw error path.
- Fire-and-forget paths: `tryEmitAgentEvent` calls remain fire-and-forget. The single `void this.executeRun(...).catch(...)` in `startRunAsync` (lines 2376-2380) stays as-is — the existing `PLAN_GAP` comment is preserved verbatim.

If a chunk would change any write-path semantic (SQL shape, column set, ordering, awaited-vs-fire-and-forget posture, error-suppression behaviour), that chunk is out of scope and the spec must be revised before it lands.

## 15. References

- Source file: `server/services/agentExecutionService.ts`
- Pre-existing siblings (untouched): `server/services/agentExecutionServicePure.ts`, `server/services/agentExecutionLoop.ts`, `server/services/agentExecutionTypes.ts`
- Backend adapter contract (untouched): `server/services/executionBackends/*`
- Pattern-setter spec (conventions adopted by reference): `tasks/builds/feat-split-skillexecutor/spec.md` §5
- Public-surface contracts: `architecture.md § Agent Execution Middleware Pipeline`
- Service-layer rules: `DEVELOPMENT_GUIDELINES.md §2`
- Testing posture: `DEVELOPMENT_GUIDELINES.md §7` and `docs/testing-conventions.md`
- Sprint 3 resume-path background: comments at lines 2389-2411 of the source file
