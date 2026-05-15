---
status: READY_FOR_BUILD
date: 2026-05-15
author: architect (claude opus 4.7)
spec: tasks/builds/feat-split-agentexecutionservice/spec.md
build_slug: feat-split-agentexecutionservice
branch: feat/split-agentexecutionservice
scope_class: Significant
chunks: 11
---

# feat/split-agentexecutionservice — Implementation Plan

Mechanical decomposition of `server/services/agentExecutionService.ts` (2,807 LOC) into a thin barrel plus a sibling directory of phase / helper modules. Public API preserved. No behaviour change. Each chunk is independently mergeable; G1 gates run after each.

The spec (`tasks/builds/feat-split-agentexecutionservice/spec.md`) is the source of truth for goals, non-goals, and the §10 caller sweep. This plan provides per-chunk implementation detail beyond the spec: exact files, exact line ranges in the source file, exact phase-function signatures, and forward-only chunk dependencies.

## Model-collapse check

This is a structural refactor of an existing 2,807 LOC service file with the explicit non-goal of behaviour change. There is no ingest → extract → transform → render pipeline to collapse, and no LLM call surface in scope. Reject collapse: the work is mechanical code reorganisation, not a multi-step inference pipeline.

## Architecture Notes

**Decision 1 — `agentExecutionService` constant body placement (resolves spec §11 Q1).**
The `agentExecutionService` object literal (containing both `executeRun` as the orchestrator that calls phase functions, AND `startRunAsync` as a sibling method) lives **inline in the barrel** `server/services/agentExecutionService.ts`. Rationale: `executeRun` and `startRunAsync` stay grep-discoverable at the canonical path; one fewer indirection; matches spec §11 Q1 default. The `this`-binding inside `startRunAsync` (`void this.executeRun(request).catch(...)`, source L2381) is preserved because both methods remain on the same object literal. Rejected alternative: moving the constant to `agentExecutionService/index.ts` — adds a hop and obscures the public entry point for future readers.

**Decision 2 — `RunExecutionContext` shape (resolves spec §11 Q2).**
A **single mutable record** is threaded through phase functions, populated incrementally as each phase completes. Each phase function accepts `(request, ctx)` and mutates `ctx` in-place where the source code today mutates the local-variable scope. Rationale: matches the current in-method state shape; minimises diff; avoids inventing new immutable copies of ~30 fields per phase. Per-phase input/output records are a future refactor (`AGENTEXEC-SPLIT-DEF-2`).

**Decision 3 — Chunk 8 (Phase E dispatch wrapper) kept (resolves spec §11 Q3).**
`runLifecycle/dispatch.ts` is created as a thin orchestration wrapper around `backendDispatch.ts`. Rationale: completes the lifecycle directory shape (every numbered phase has a peer module under `runLifecycle/`); preserves the option for a future Sprint 3B resume path to call the same wrapper without going through the orchestrator. Cost: ~30 LOC of indirection. Acceptable.

**Decision 4 — `resume.ts` is its own module (resolves spec §11 Q4).** Confirms spec §11 Q4 default. `resumeAgentRun` is orthogonal to the forward-execution pipeline and exports public types — its own module keeps the `runLifecycle/*` phase modules focused.

**Decision 5 — Phase F (`complete.ts`) MUST preserve the try/finally enclosing scope.**
Phase 12 (MCP cleanup, source L2210-2302) is inside a `finally` block that wraps Phases 9-11. When `finalizeRun` is extracted, the try/finally control flow stays in the orchestrator (`executeRun` body in the barrel). `finalizeRun` is invoked from inside the existing `try {}` and the existing `finally {}` keeps the MCP cleanup call. Rationale: spec §14 + §7 Chunk 9 lock the cleanup-guarantee invariant; relaxing the try/finally would change error-suppression semantics.

**No patterns applied beyond extract-to-sibling-module.** This is intentionally mechanical. Spec §5 forbids any other pattern introduction.

## Source-file line-range map (authoritative for line moves)

| Source range | Content | Destination |
|---|---|---|
| 1-122 | Imports + `export type { LoopParams }` | Barrel keeps a subset; helper / phase modules import the rest fresh |
| 138-158 | `ExecutionClosureContext` interface | `agentExecutionService/types.ts` (Chunk 1) |
| 172-265 | `buildBackendOptionsForMode` function | `agentExecutionService/backendDispatch.ts` (Chunk 3) |
| 271-407 | `AgentRunRequest` interface | `agentExecutionService/types.ts` (Chunk 1) |
| 409-432 | `AgentRunResult` interface | `agentExecutionService/types.ts` (Chunk 1) |
| 434-447 | `TaskWithAgent` interface | `agentExecutionService/types.ts` (Chunk 1) |
| 453-456, 2303, 2387 | `agentExecutionService` const wrapping braces | Stay in barrel (Chunk 11 trim) |
| 457-473 | Phase 0a body | `runLifecycle/validate.ts` (Chunk 4) |
| 475-493 | Phase 0b body | `runLifecycle/validate.ts` (Chunk 4) |
| 495-501 | Phase 0c body | `runLifecycle/validate.ts` (Chunk 4) |
| 503-532 | Phase 0d body | `runLifecycle/validate.ts` (Chunk 4) |
| 534-556 | Phase 1 body | `runLifecycle/persistRun.ts` (Chunk 5) |
| 558-674 | Phase 2 INSERT + emissions | `runLifecycle/persistRun.ts` (Chunk 5) |
| 675-706 | Load agent + saLink | `runLifecycle/configure.ts` (Chunk 6) |
| 707-725 | Phase 2a snapshot | `runLifecycle/configure.ts` (Chunk 6) |
| 726-756 | Phase 2b workspace limit | `runLifecycle/configure.ts` (Chunk 6) |
| 757-790 | Phase 2c DEC snapshot | `runLifecycle/configure.ts` (Chunk 6) |
| 791-889 | Phase 2d policy envelope | `runLifecycle/configure.ts` (Chunk 6) |
| 890-920 | Phase 3 run-context | `runLifecycle/loadContext.ts` (Chunk 7a) |
| 921-936 | Phase 3.5 knowledge | `runLifecycle/loadContext.ts` (Chunk 7a) |
| 937-939 | Phase 4 org-processes | `runLifecycle/loadContext.ts` (Chunk 7a) |
| 940-976 | Phase 4.5 hierarchy | `runLifecycle/loadContext.ts` (Chunk 7a) |
| 977-1030 | Phase 5 skill→tool | `runLifecycle/prepare.ts` (Chunk 7b) |
| 1031-1051 | Phase 5a auto-inject | `runLifecycle/prepare.ts` (Chunk 7b) |
| 1052-1078 | Phase 5b MCP | `runLifecycle/prepare.ts` (Chunk 7b) |
| 1079-1094 | Phase 6 task context | `runLifecycle/prepare.ts` (Chunk 7b) |
| 1095-1538 | Phase 7 system prompt + thread + memory/beliefs/briefing | `runLifecycle/prepare.ts` (Chunk 7b) |
| 1539-1676 | Phase 8 dispatch | `runLifecycle/dispatch.ts` (Chunk 8, consuming Chunk 3) |
| 1677-1973 | Phase 9 finalise | `runLifecycle/complete.ts` (Chunk 9) |
| 1974-2190 | Phase 10 insights / memory scoring | `runLifecycle/complete.ts` (Chunk 9) |
| 2191-2209 | Phase 11 triggers | `runLifecycle/complete.ts` (Chunk 9) |
| 2210-2302 | Phase 12 MCP cleanup (inside try/finally) | Stays in barrel orchestrator's `finally` block; calls into `complete.ts` cleanup helper |
| 2304-2386 | `startRunAsync` body | Stays in barrel (Chunk 11) |
| 2389-2411 | Resume-path header comment | Moves with `resume.ts` (Chunk 10) |
| 2413-2421 | `ResumeAgentRunOptions` | `agentExecutionService/resume.ts` (Chunk 10) |
| 2423-2440 | `ResumeAgentRunResult` | `agentExecutionService/resume.ts` (Chunk 10) |
| 2442-2590 | `resumeAgentRun` body | `agentExecutionService/resume.ts` (Chunk 10) |
| 2592-2611 | `LoopResult` re-export block | Stays in barrel |
| 2615-2644 | `buildTeamRoster` | `agentExecutionService/promptBuilders.ts` (Chunk 2) |
| 2649-2713 | `buildSmartBoardContext` | `agentExecutionService/promptBuilders.ts` (Chunk 2) |
| 2715-2744 | `buildTaskContext` | `agentExecutionService/promptBuilders.ts` (Chunk 2) |
| 2746-2766 | `buildTaskOverviewContext` | `agentExecutionService/promptBuilders.ts` (Chunk 2) |
| 2768-2805 | `buildAutonomousInstructions` | `agentExecutionService/promptBuilders.ts` (Chunk 2) |

When a chunk moves a range, the chunk also (a) deletes the range from the barrel and (b) replaces the in-`executeRun` body with a call to the extracted function. Range boundaries above are approximate to the line-level; exact deletions follow the source's brace/comment structure.

## Cross-chunk dependency graph (forward-only)

```
Chunk 1 (types)            ─┐
Chunk 2 (promptBuilders)   ─┤
Chunk 3 (backendDispatch)  ─┤ (independent foundation)
                            │
Chunk 4 (validate)         ─┤ (depends on 1)
Chunk 5 (persistRun)       ─┤ (depends on 1, 4)
Chunk 6 (configure)        ─┤ (depends on 1, 5)
Chunk 7a (loadContext)     ─┤ (depends on 1, 6)
Chunk 7b (prepare)         ─┤ (depends on 1, 2, 7a)
Chunk 8 (dispatch wrapper) ─┤ (depends on 1, 3, 7b)
Chunk 9 (complete)         ─┤ (depends on 1, 8)
Chunk 10 (resume)          ─┤ (depends on 1; orthogonal to 4-9)
Chunk 11 (barrel thin)     ─┘ (depends on ALL prior chunks; finalises barrel)
```

Each arrow is a HARD dependency: the source-file line range moved by the earlier chunk must already be gone (and the call-site already redirected) before the later chunk runs. Reverting any chunk N leaves Chunks 1..N-1 in a working state — spec §8.4 bisect-friendly chunking is preserved.

## Chunk 1 — Scaffold + types

**Scope:** Create the `agentExecutionService/` sibling directory and the leaf types module. No phase functions yet; no logic moves. Public types re-exported through the barrel.

**Files created:**
- `server/services/agentExecutionService/types.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — replace inline type declarations with re-exports from `./agentExecutionService/types.js`

**Source moves (delete from barrel, add to `types.ts`):**
- Lines 138-158 — `interface ExecutionClosureContext` (currently private; export as `ExecutionClosureContext` for `backendDispatch.ts` consumption in Chunk 3)
- Lines 271-407 — `export interface AgentRunRequest`
- Lines 409-432 — `export interface AgentRunResult`
- Lines 434-447 — `interface TaskWithAgent` (export for `promptBuilders.ts` consumption in Chunk 2)

**Authored in `types.ts` (new):**
- `interface RunExecutionContext` — placeholder per spec §9 `AGENTEXEC-SPLIT-DEF-2`. Declared as an open-shape interface that Chunks 4-9 extend in-place as each phase function lands. Initial shape:
  ```ts
  export interface RunExecutionContext {
    startTime: number;
    isOrgSubaccountRun: boolean;
    idempotencyLookupKeys: string[];
    // Extended by Chunks 5-9 — see DEFERRED AGENTEXEC-SPLIT-DEF-2 for shape consolidation.
  }
  ```
- `interface ValidatePrepareResult` — discriminated union returned by Chunk 4's `validateAndPrepare`:
  ```ts
  export type ValidatePrepareResult =
    | { kind: 'early_exit'; result: AgentRunResult }
    | { kind: 'proceed'; ctx: RunExecutionContext };
  ```

**Imports added to `types.ts`:**
- `import type { LoopParams } from '../agentExecutionLoop.js';` (for the `ExecutionClosureContext` field types — they re-use `LoopParams` shape)

**Barrel updates:**
- Add `export type { AgentRunRequest, AgentRunResult } from './agentExecutionService/types.js';`
- Keep `LoopResult` re-export block at L2592-2611 unchanged.
- DELETE the moved type declarations from the barrel body.

**Module shape:**
- *Public interface this chunk exposes:* `AgentRunRequest`, `AgentRunResult` (re-exported from barrel, identical shape). `ExecutionClosureContext`, `TaskWithAgent`, `RunExecutionContext`, `ValidatePrepareResult` are NEW exports from `types.ts` but are NOT public surface (not re-exported by the barrel).
- *What stays hidden behind it:* nothing yet — this is a foundation chunk. The placeholder `RunExecutionContext` is intentionally open-shape.

**Error handling:** N/A — pure type moves.

**Test considerations:**
- Existing test `server/services/__tests__/agentExecutionService.middlewareContext.test.ts` may import `AgentRunRequest` from the barrel; barrel re-export preserves the import path.
- No new test files authored (spec §13, testing posture `static_gates_primary`).

**Dependencies:** None (foundation chunk).

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- All four type declarations (lines 138-158, 271-407, 409-432, 434-447) deleted from `agentExecutionService.ts`.
- New file `agentExecutionService/types.ts` contains them.
- Barrel re-exports `AgentRunRequest`, `AgentRunResult` such that `import { type AgentRunRequest } from '../services/agentExecutionService.js'` continues to resolve at every §10 caller site.
- `npm run typecheck` is clean with zero errors.

## Chunk 2 — Prompt-builder helpers

**Scope:** Move the five standalone prompt-builder helpers to a sibling module. No signatures change. Call sites inside `executeRun` (still in the barrel at this point) are redirected to the new import path.

**Files created:**
- `server/services/agentExecutionService/promptBuilders.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete moved functions; add `import { ... } from './agentExecutionService/promptBuilders.js'`; redirect in-`executeRun` call sites.

**Source moves (delete from barrel, add to `promptBuilders.ts`):**
- Lines 2615-2644 — `async function buildTeamRoster(subaccountId: string, currentAgentId: string): Promise<string | null>`
- Lines 2649-2713 — `async function buildSmartBoardContext(organisationId: string, subaccountId: string, agentId: string): Promise<string>`
- Lines 2715-2744 — `function buildTaskContext(item: Record<string, unknown>): string`
- Lines 2746-2766 — `function buildTaskOverviewContext(items: TaskWithAgent[]): string`
- Lines 2768-2805 — `function buildAutonomousInstructions(request: AgentRunRequest, targetItem: Record<string, unknown> | null): string`

**Imports added to `promptBuilders.ts`:**
- `import { db } from '../../db/index.js';`
- `import { eq, and } from 'drizzle-orm';`
- `import { isActive } from '../../lib/queryHelpers.js';`
- `import { agents, subaccountAgents } from '../../db/schema/index.js';`
- `import { taskService } from '../taskService.js';`
- `import { workspaceMemoryService } from '../workspaceMemoryService.js';`
- `import { MAX_CROSS_AGENT_TASKS } from '../../config/limits.js';`
- `import type { AgentRunRequest } from './types.js';`
- `import type { TaskWithAgent } from './types.js';`

**Function exports (signatures unchanged):**
```ts
export async function buildTeamRoster(subaccountId: string, currentAgentId: string): Promise<string | null>
export async function buildSmartBoardContext(organisationId: string, subaccountId: string, agentId: string): Promise<string>
export function buildTaskContext(item: Record<string, unknown>): string
export function buildTaskOverviewContext(items: TaskWithAgent[]): string
export function buildAutonomousInstructions(request: AgentRunRequest, targetItem: Record<string, unknown> | null): string
```

Note: `buildSmartBoardContext` calls `buildTaskOverviewContext` (source L2709) — both move together so the intra-module call resolves locally.

**Barrel updates:**
- Add: `import { buildTeamRoster, buildSmartBoardContext, buildTaskContext, buildTaskOverviewContext, buildAutonomousInstructions } from './agentExecutionService/promptBuilders.js';`
- Redirect call sites inside `executeRun`:
  - `buildTeamRoster` — single call inside Phase 6 area (~L1080-1094, used by Phase 6 task-context assembly)
  - `buildSmartBoardContext` — Phase 6 (~L1079-1094)
  - `buildTaskContext` — Phase 6 (called when `request.targetItem` is a task)
  - `buildTaskOverviewContext` — Phase 6 fallback path
  - `buildAutonomousInstructions` — Phase 7 (~L1095-1538)
- DELETE the moved function bodies from the barrel.

**Module shape:**
- *Public interface:* five named exports (`buildTeamRoster` / `buildSmartBoardContext` / `buildTaskContext` / `buildTaskOverviewContext` / `buildAutonomousInstructions`). Consumed only by `runLifecycle/prepare.ts` (Chunk 7b) and — until Chunk 7b lands — by the inline `executeRun` body in the barrel.
- *What stays hidden:* the internal cross-call from `buildSmartBoardContext` to `buildTaskOverviewContext`; the DB read patterns; the cross-agent fallback selection logic.

**Error handling:** N/A — functions are throw-free and behaviour-preserving.

**Test considerations:**
- No collocated tests for these helpers exist today. None added (spec §13).
- Verify `taskService` and `workspaceMemoryService` import paths resolve from the new directory depth (one extra `..`).

**Dependencies:**
- Chunk 1 (`types.ts`) — `promptBuilders.ts` imports `AgentRunRequest` and `TaskWithAgent` from there.

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- All five function bodies deleted from `agentExecutionService.ts`.
- `agentExecutionService/promptBuilders.ts` contains them with identical signatures.
- All in-`executeRun` call sites use the imported names (no `this.` prefix; they were already standalone functions).
- `npm run typecheck` clean.

## Chunk 3 — Backend-dispatch closure module

**Scope:** Move `buildBackendOptionsForMode` to a sibling module. `ExecutionClosureContext` already lives in `types.ts` after Chunk 1; this chunk imports it from there. The Phase 8 dispatch call site inside `executeRun` is redirected — the surrounding orchestration is left for Chunk 8.

**Files created:**
- `server/services/agentExecutionService/backendDispatch.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete the moved function; redirect the call site at L1539-1676 (Phase 8) to import from the new module.

**Source moves (delete from barrel, add to `backendDispatch.ts`):**
- Lines 172-265 — `function buildBackendOptionsForMode(mode, request, ctx): BackendOptions` (including the JSDoc preamble at L160-171). Export it.

**Imports added to `backendDispatch.ts`:**
- `import type { BackendOptions } from '../executionBackends/types.js';`
- `import type { ExecutionMode } from '../../../shared/types/executionEnvironment.js';`
- `import type { AgentRunRequest } from './types.js';`
- `import type { ExecutionClosureContext } from './types.js';`
- `import { executionBackendRegistry } from '../executionBackends/registry.js';`
- `import { ParentRunNotDispatchable } from '../executionBackends/types.js';`
- `import type { LoopParams } from '../agentExecutionLoop.js';` (transitively required by `ExecutionClosureContext` field types — verify the type-only import resolves)

**Function exports:**
```ts
export function buildBackendOptionsForMode(
  mode: ExecutionMode,
  request: AgentRunRequest,
  ctx: ExecutionClosureContext,
): BackendOptions
```

Signature is identical to source L172-176.

**Barrel updates:**
- DELETE the moved function (L172-265).
- DELETE the now-orphaned imports at L119-122 (`executionBackendRegistry`, `ParentRunNotDispatchable`, `BackendOptions`, `ExecutionMode`) ONLY if `executeRun`'s Phase 8 call site is the only remaining consumer of `executionBackendRegistry` AND that call site is rewritten in this chunk. Otherwise: keep the imports for the inline Phase 8 dispatch call (which Chunk 8 will absorb into the wrapper). Conservative choice: keep the imports in the barrel, redirect only the `buildBackendOptionsForMode` call. The orphan-cleanup happens in Chunk 8 when the dispatch wrapper lands.
- Add: `import { buildBackendOptionsForMode } from './agentExecutionService/backendDispatch.js';`
- At the Phase 8 dispatch site (~L1539-1676), the existing line that calls `buildBackendOptionsForMode(executionMode, request, closureContext)` now resolves to the imported function. No call-shape change.

**Module shape:**
- *Public interface:* `buildBackendOptionsForMode(mode, request, ctx)` — one function, identical signature to source.
- *What stays hidden:* the exhaustive-switch logic over `ExecutionMode`; the `runSource` derivation; the per-backend `loopContext` projection; the `_exhaustive: never` exhaustiveness check.

**Error handling:**
- Preserves the existing two throw paths: (1) `'operator_managed'` runs throwing because they dispatch via `operatorRunService`; (2) the `default` branch throwing on unknown `ExecutionMode`. Both error messages preserved byte-for-byte.

**Test considerations:**
- No collocated tests for `buildBackendOptionsForMode` today. None added.
- Smoke check: confirm the function exports with the same name and signature so the `executionBackendRegistry.resolve(mode).dispatch(input)` chain at the Phase 8 site continues to compile.

**Dependencies:**
- Chunk 1 (`types.ts`) — imports `AgentRunRequest`, `ExecutionClosureContext` from there.

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- `buildBackendOptionsForMode` no longer declared in `agentExecutionService.ts`.
- It is exported from `agentExecutionService/backendDispatch.ts` with identical signature.
- The Phase 8 dispatch site in the barrel still calls `buildBackendOptionsForMode(...)` and still consumes `executionBackendRegistry.resolve(mode).dispatch(input)` — only the import source changed.
- `npm run typecheck` clean.

## Chunk 4 — Phase A: validate.ts

**Scope:** Extract source phases 0a-0d (subaccount validation, kill switch, org-subaccount detection, idempotency lookup) into a single phase function.

**Files created:**
- `server/services/agentExecutionService/runLifecycle/validate.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete L457-532 from the `executeRun` body and replace with a call to `validateAndPrepare(request, startTime)`.

**Source moves (delete from barrel, add to `validate.ts`):**
- Lines 460-473 — Phase 0a subaccount validation (`subaccountId` + `subaccountAgentId` presence checks).
- Lines 475-493 — Phase 0b org-execution kill switch (DB read on `organisations.orgExecutionEnabled`; returns synthetic `failed` AgentRunResult on disabled).
- Lines 495-501 — Phase 0c `isOrgSubaccountRun` detection (DB read on `subaccounts.isOrgSubaccount`).
- Lines 503-532 — Phase 0d idempotency: `idempotencyLookupKeys` derivation + `agentRuns` SELECT + early-return existing run shape.

**Imports added to `validate.ts`:**
- `import { db } from '../../../db/index.js';`
- `import { eq, inArray } from 'drizzle-orm';`
- `import { organisations, subaccounts, agentRuns } from '../../../db/schema/index.js';`
- `import type { AgentRunRequest, AgentRunResult, ValidatePrepareResult, RunExecutionContext } from '../types.js';`

**Function exports:**
```ts
export async function validateAndPrepare(
  request: AgentRunRequest,
  startTime: number,
): Promise<ValidatePrepareResult>
```

Return shape (from `types.ts` Chunk 1):
- `{ kind: 'early_exit', result: AgentRunResult }` — used when (a) kill switch is off and a synthetic `failed` result must return; (b) an idempotent duplicate row already exists.
- `{ kind: 'proceed', ctx: RunExecutionContext }` — populated with `startTime`, `isOrgSubaccountRun`, `idempotencyLookupKeys`.

**Throws (preserved exactly from source):**
- `Object.assign(new Error('All agent runs require a subaccountId'), { statusCode: 400, errorCode: 'MISSING_SUBACCOUNT_ID' })` — Phase 0a.
- `Object.assign(new Error('All agent runs require a subaccountAgentId post-migration'), { statusCode: 400, errorCode: 'MISSING_SUBACCOUNT_AGENT_ID' })` — Phase 0a.

**Barrel updates:**
- Add `import { validateAndPrepare } from './agentExecutionService/runLifecycle/validate.js';`
- At the top of `executeRun` (after `const startTime = Date.now();` at L458), insert:
  ```ts
  const validated = await validateAndPrepare(request, startTime);
  if (validated.kind === 'early_exit') return validated.result;
  const ctx = validated.ctx;
  ```
- DELETE source L460-532.
- Subsequent in-method references to `isOrgSubaccountRun` and `idempotencyLookupKeys` rewrite to `ctx.isOrgSubaccountRun` and `ctx.idempotencyLookupKeys`. (The barrel body still owns all subsequent phases until Chunks 5-9 land.)

**Module shape:**
- *Public interface:* `validateAndPrepare(request, startTime): Promise<ValidatePrepareResult>` — one async function.
- *What stays hidden:* the three DB reads (`organisations`, `subaccounts`, `agentRuns`); the early-exit `AgentRunResult` shape construction (zeroed totals, computed `durationMs`); the `idempotencyCandidateKeys` deduplication via `Set`.

**Error handling:**
- Two throws (Phase 0a) preserved verbatim — same `statusCode`, same `errorCode`, same message text.
- DB-read failures propagate (no catch — matches source).

**Test considerations:**
- `__tests__/agentExecutionService.middlewareContext.test.ts` exercises kill-switch + idempotency paths in a few places. Expect zero assertion changes; only the indirection through `validateAndPrepare` changes.

**Dependencies:** Chunk 1 (`types.ts`).

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- Source L460-532 fully removed from `agentExecutionService.ts`.
- `validateAndPrepare` exists at the documented path with the documented signature.
- Idempotency lookup returns the same `AgentRunResult` shape as before (same column projection from `existing` row, same `durationMs` fallback).
- Kill-switch early exit returns identical zeroed `AgentRunResult` shape.
- `npm run typecheck` clean.

## Chunk 5 — Phase B: persistRun.ts

**Scope:** Extract Phase 1 (controller-style resolve) + Phase 2 (`agent_runs` INSERT + all observability emissions). Bookended by the awaited `run.started` Live-log emission — sequence-number invariant is load-bearing.

**Files created:**
- `server/services/agentExecutionService/runLifecycle/persistRun.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete L534-674 from the `executeRun` body; replace with a call to `persistAndAnnounce(request, ctx)`.

**Source moves (delete from barrel, add to `persistRun.ts`):**
- Lines 534-556 — Phase 1 controller-style resolution: `subaccountAgents` read for `controllerStyleAllowed`, derivation via `deriveControllerStyle`, controller-style source attribution.
- Lines 558-674 — Phase 2: `agentRuns` INSERT (all current columns); websocket emissions `agent:run:started` + `live:agent_started`; AWAITED `emitAgentEvent('run.started', ...)` (sequence-1 invariant); fire-and-forget `tryEmitAgentEvent('foundation.controller_style.derived', ...)`; fire-and-forget `tryEmitAgentEvent('orchestrator.routing_decided', ...)` when `request.orchestratorDispatch` is present; `org_subaccount_run` observability metric when `ctx.isOrgSubaccountRun`.

**Imports added to `persistRun.ts`:**
- `import { db } from '../../../db/index.js';`
- `import { eq } from 'drizzle-orm';`
- `import { agentRuns, subaccountAgents } from '../../../db/schema/index.js';`
- `import { deriveControllerStyle } from '../../controllerStyleResolver.js';`
- `import { emitAgentEvent, tryEmitAgentEvent } from '../../agentExecutionEventEmitter.js';`
- `import { emitAgentRunUpdate, emitSubaccountUpdate } from '../../../websocket/emitters.js';`
- `import type { AgentRunRequest, RunExecutionContext } from '../types.js';`
- Any `tracing.createEvent` import currently used in Phase 2 — preserve the exact import shape.

**Function exports:**
```ts
export async function persistAndAnnounce(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<{ run: typeof agentRuns.$inferSelect }>
```

The returned `run` row is the freshly-inserted `agent_runs` record; later phases consume `run.id`, `run.configSnapshot` (initially null), etc.

**Critical invariants (preserve verbatim):**
- The `await emitAgentEvent('run.started', ...)` MUST stay awaited (spec §8.3, §14). This is the sequence-number-1 claim — any fire-and-forget conversion changes downstream sequence numbering.
- The `tryEmitAgentEvent('foundation.controller_style.derived', ...)` MUST stay fire-and-forget.
- The `tryEmitAgentEvent('orchestrator.routing_decided', ...)` MUST stay fire-and-forget AND only emit when `request.orchestratorDispatch` is present (preserve the conditional).
- The `org_subaccount_run` metric emission MUST stay fire-and-forget and conditional on `ctx.isOrgSubaccountRun`.
- INSERT column set is byte-for-byte preserved (every column written today is written here; default values unchanged).

**`RunExecutionContext` extension (Chunk 5 adds):**
```ts
// In types.ts (extend the interface in-place during Chunk 5):
//   resolvedControllerStyleAllowed: string;
//   controllerStyleSource: 'subaccount_agent' | 'default' | string;
//   run: typeof agentRuns.$inferSelect;
```

**Barrel updates:**
- Add `import { persistAndAnnounce } from './agentExecutionService/runLifecycle/persistRun.js';`
- Replace L534-674 with:
  ```ts
  const { run } = await persistAndAnnounce(request, ctx);
  ctx.run = run;
  ```
- DELETE source L534-674.

**Module shape:**
- *Public interface:* `persistAndAnnounce(request, ctx)` — one async function returning the inserted run row.
- *What stays hidden:* the controller-style derivation logic; the INSERT column projection; the four downstream emissions and their ordering; the websocket envelope shape.

**Error handling:**
- DB-write failures propagate (no catch — matches source).
- The awaited `emitAgentEvent('run.started', ...)` failure rethrows (matches current behaviour — sequence-1 invariant means an unwritable event must surface).

**Test considerations:**
- `__tests__/agentExecutionService.middlewareContext.test.ts` exercises the run-started emission path. Existing assertions must hold.
- Any test that mocks `emitAgentEvent` to verify sequence-number ordering still observes the awaited call shape.

**Dependencies:**
- Chunk 1 (`types.ts`) — `AgentRunRequest`, `RunExecutionContext`.
- Chunk 4 (`validate.ts`) — `ctx` must already be populated with `isOrgSubaccountRun` and `idempotencyLookupKeys`.

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- L534-674 fully removed from `agentExecutionService.ts`.
- `persistAndAnnounce` exists at the documented path.
- The `emitAgentEvent('run.started', ...)` call remains awaited (grep for `await emitAgentEvent\(['"]run\.started`) and resolves inside the new module.
- INSERT column set diff is empty vs the source (column-by-column comparison).
- `npm run typecheck` clean.

## Chunk 6 — Phase C: configure.ts

**Scope:** Extract Phase 2-load-agent through Phase 2d (agent + saLink load, config snapshot, workspace-limit check, DEC hash snapshot, policy envelope resolution + persist + emit + executionMode allow-list).

**Files created:**
- `server/services/agentExecutionService/runLifecycle/configure.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete L675-889 from the `executeRun` body; replace with a call to `configureRun(request, ctx)`.

**Source moves (delete from barrel, add to `configure.ts`):**
- Lines 675-706 — Load agent (`agentService.getAgent`) + saLink (`subaccountAgents` SELECT).
- Lines 707-725 — Phase 2a: config-snapshot construction (resolved tokens / tool calls / timeout / `configSkillSlugs` / `configCustomInstructions`), `configHash` fingerprint, UPDATE `agent_runs` with `configSnapshot`.
- Lines 726-756 — Phase 2b: workspace-limit check via `checkWorkspaceLimits`; on `false`, mark run failed, emit `live:agent_failed`, return early via context (signals downstream to skip and complete).
- Lines 757-790 — Phase 2c: DEC fingerprint snapshot + iteration count; `triggerContext.executionSnapshot` UPDATE.
- Lines 791-889 — Phase 2d: `resolvePolicyEnvelope` + `persistPolicyEnvelope` + `tryEmitAgentEvent('foundation.policy_envelope.resolved', ...)` + `allowedEnvironments` gate (throws `ExecutionModeNotAllowedForAgentError` on violation, emits-then-throws).

**Imports added to `configure.ts`:**
- `import { db } from '../../../db/index.js';`
- `import { createHash } from 'crypto';`
- `import { eq, and } from 'drizzle-orm';`
- `import { agentRuns, subaccountAgents } from '../../../db/schema/index.js';`
- `import { agentService } from '../../agentService.js';`
- `import { checkWorkspaceLimits } from '../../middleware/index.js';`
- `import { CONTROLLER_LIMITS } from '../../../config/controllerLimits.js';`
- `import { resolvePolicyEnvelope, persist as persistPolicyEnvelope, ExecutionModeNotAllowedForAgentError } from '../../policyEnvelopeResolver.js';`
- `import { executionModeToEnvironment } from '../../../../shared/types/executionEnvironment.js';`
- `import { tryEmitAgentEvent } from '../../agentExecutionEventEmitter.js';`
- `import { emitSubaccountUpdate } from '../../../websocket/emitters.js';`
- `import type { AgentRunRequest, RunExecutionContext } from '../types.js';`

**Function exports:**
```ts
export async function configureRun(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<{ kind: 'workspace_limit_failed'; result: AgentRunResult } | { kind: 'configured' }>
```

The discriminated return shape covers Phase 2b's early-exit path (workspace limit exceeded → failed run UPDATE + emit + return).

**`RunExecutionContext` extension (Chunk 6 adds):**
```ts
// In types.ts (extend in-place during Chunk 6):
//   agent: Awaited<ReturnType<typeof agentService.getAgent>>;
//   saLink: typeof subaccountAgents.$inferSelect;
//   tokenBudget: number;
//   maxToolCalls: number;
//   timeoutMs: number;
//   configSkillSlugs: string[];
//   configCustomInstructions: string | null;
//   configHash: string;
//   configVersion: string;
//   policyEnvelope: ReturnType<typeof resolvePolicyEnvelope>;
//   maxLoopIterations: number;
```

**Critical invariants (preserve verbatim):**
- Policy-envelope emit-then-throw ordering preserved: `tryEmitAgentEvent('foundation.policy_envelope.resolved', ...)` MUST fire BEFORE `ExecutionModeNotAllowedForAgentError` is thrown.
- `configSnapshot` UPDATE is awaited; `triggerContext.executionSnapshot` UPDATE is awaited.
- `checkWorkspaceLimits` early-exit path UPDATEs the run row's `status` to `failed` AND emits the websocket event AND returns the synthetic `AgentRunResult` — all three preserved.

**Barrel updates:**
- Add `import { configureRun } from './agentExecutionService/runLifecycle/configure.js';`
- Replace L675-889 with:
  ```ts
  const configResult = await configureRun(request, ctx);
  if (configResult.kind === 'workspace_limit_failed') return configResult.result;
  ```
- DELETE source L675-889.

**Module shape:**
- *Public interface:* `configureRun(request, ctx)` — one async function with discriminated return.
- *What stays hidden:* config-hash derivation (createHash + canonical-stringify of resolved values); the 5 sub-steps (load agent, snapshot, limit, DEC, policy); the policy-envelope persist + emit + allow-list-throw ordering; CONTROLLER_LIMITS lookup.

**Error handling:**
- `ExecutionModeNotAllowedForAgentError` thrown after the emission (load-bearing — preserved).
- Workspace-limit failure returns through discriminated union (no throw — matches source).

**Test considerations:**
- Policy-envelope behaviour is gate-tested in CI (`verify-policy-envelope-*`). No new local test.
- Workspace-limit test (if any) keeps its assertions.

**Dependencies:** Chunks 1 + 5 (`ctx.run` is required to UPDATE `agent_runs`).

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- L675-889 fully removed from `agentExecutionService.ts`.
- `configureRun` exists at the documented path.
- Policy-envelope emission ordering preserved (emit before throw).
- `configSnapshot` UPDATE preserved; `triggerContext.executionSnapshot` UPDATE preserved.
- `npm run typecheck` clean.

## Chunk 7a — Phase D1: loadContext.ts

**Scope:** Extract source-order phases 3, 3.5, 4, 4.5 — run-context data load, auto-knowledge retrieval, org-processes load, immutable hierarchy snapshot.

**Files created:**
- `server/services/agentExecutionService/runLifecycle/loadContext.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete L890-976 from `executeRun`; replace with a call to `loadRunContextAndHierarchy(request, ctx)`.

**Source moves (delete from barrel, add to `loadContext.ts`):**
- Lines 890-920 — Phase 3: `loadRunContextData` (from `runContextLoader.ts`) + downstream `dataSourceContents` projection.
- Lines 921-936 — Phase 3.5: `assembleKnowledgeForRun` (from `retrievalService.ts`) call; fail-open semantics (degraded result → empty `loaded`).
- Lines 937-939 — Phase 4: `getOrgProcessesForTools` call (for the `trigger_process` skill).
- Lines 940-976 — Phase 4.5: `buildHierarchyForRun` for the immutable hierarchy snapshot (INV-4); fire-and-forget `db.update(...).catch(...)` writing `hierarchy_depth`; `HierarchyContextBuildError` logged as warning, NOT rethrown.

**Imports added to `loadContext.ts`:**
- `import { db } from '../../../db/index.js';`
- `import { eq } from 'drizzle-orm';`
- `import { agentRuns } from '../../../db/schema/index.js';`
- `import { loadRunContextData } from '../../runContextLoader.js';` (verify exact export name during build)
- `import { assembleKnowledgeForRun } from '../../retrievalService.js';` (verify)
- `import { getOrgProcessesForTools } from '../../llmService.js';`
- `import { buildForRun as buildHierarchyForRun, HierarchyContextBuildError } from '../../hierarchyContextBuilderService.js';`
- `import { logger } from '../../../lib/logger.js';`
- `import type { AgentRunRequest, RunExecutionContext } from '../types.js';`

**Function exports:**
```ts
export async function loadRunContextAndHierarchy(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<void>
```

The function mutates `ctx` in place (Decision 2 — single mutable record). Returns `void`.

**`RunExecutionContext` extension (Chunk 7a adds):**
```ts
//   runContextData: Awaited<ReturnType<typeof loadRunContextData>>;
//   knowledgeLoaded: Awaited<ReturnType<typeof assembleKnowledgeForRun>>['loaded'];
//   orgProcesses: Awaited<ReturnType<typeof getOrgProcessesForTools>>;
//   hierarchyContext: HierarchyContext;
//   agentDomain: string | null;
```

**Critical invariants (preserve verbatim):**
- `assembleKnowledgeForRun` fail-open: catch → log → degrade to `{ loaded: [], ... }`. Exact catch shape preserved.
- `HierarchyContextBuildError` caught → `logger.warn(...)`. NOT rethrown.
- `hierarchy_depth` UPDATE is fire-and-forget (`.catch(...)`). Awaiting it would change behaviour.

**Barrel updates:**
- Add `import { loadRunContextAndHierarchy } from './agentExecutionService/runLifecycle/loadContext.js';`
- Replace L890-976 with: `await loadRunContextAndHierarchy(request, ctx);`
- DELETE source L890-976.

**Module shape:**
- *Public interface:* `loadRunContextAndHierarchy(request, ctx)` — single async function; mutates ctx.
- *What stays hidden:* the four sequential sub-loads (data sources / knowledge / processes / hierarchy); the fail-open knowledge path; the warn-only hierarchy path; the fire-and-forget hierarchy_depth UPDATE.

**Error handling:**
- Knowledge: fail-open, no throw.
- Hierarchy: catch + warn, no rethrow.
- Other paths propagate (DB-read failures bubble).

**Test considerations:**
- Hierarchy build edge cases (HierarchyContextBuildError) covered by existing tests if any. No new tests.

**Dependencies:** Chunks 1 + 6 (`ctx.run`, `ctx.agent`, `ctx.saLink` already populated).

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- L890-976 fully removed from `agentExecutionService.ts`.
- `loadRunContextAndHierarchy` exists at the documented path.
- Fail-open + warn-only semantics preserved (grep for `HierarchyContextBuildError` and confirm the catch is `logger.warn`, not `throw`).
- `npm run typecheck` clean.

## Chunk 7b — Phase D2: prepare.ts

**Scope:** Extract source-order phases 5, 5a, 5b, 6, 7 — skill→tool resolution, auto-inject, MCP tool resolution, task context, 3-layer system-prompt assembly (including thread context, memory/beliefs/briefing injection, persist + emit).

This is the largest non-completion phase (~561 LOC, source L977-1538).

**Files created:**
- `server/services/agentExecutionService/runLifecycle/prepare.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete L977-1538 from `executeRun`; replace with a call to `prepareRun(request, ctx)`.

**Source moves (delete from barrel, add to `prepare.ts`):**
- Lines 977-1030 — Phase 5: 3-layer skill→tool + instruction resolution (`resolveAgentSkillsToTools` or equivalent — verify exact call site).
- Lines 1031-1051 — Phase 5a: auto-inject `read_data_source` tool when resolver result requires it.
- Lines 1052-1078 — Phase 5b: MCP tool resolution (lazy + eager registries).
- Lines 1079-1094 — Phase 6: build task context via `buildSmartBoardContext` / `buildTaskContext` / `buildTaskOverviewContext` (imported from `promptBuilders.ts` — Chunk 2). `buildTeamRoster` called here too.
- Lines 1095-1538 — Phase 7: 3-layer system-prompt assembly. Uses `buildSystemPrompt` (from `llmService.ts`), `buildAutonomousInstructions` + `assembleVoiceBlock` (pre-existing `agentExecutionServicePure.ts`). Thread context: `buildThreadContextReadModel` + `prependThreadContextToBasePrompt`. Memory injection (memory_blocks / agent_beliefs / agent_briefing / subaccount_state_summary — Phase 1, Phase 2D, Phase 3B / Phase 8 W3c). `context_sources_snapshot` UPDATE. Prompt assembly persisted via `persistAssembly` and emitted.

**Imports added to `prepare.ts`:**
- `import { db } from '../../../db/index.js';`
- `import { eq, and } from 'drizzle-orm';`
- `import { agentRuns } from '../../../db/schema/index.js';`
- `import { buildSystemPrompt, approxTokens, type AnthropicTool } from '../../llmService.js';`
- `import { assembleVoiceBlock } from '../../agentExecutionServicePure.js';`
- `import { buildTeamRoster, buildSmartBoardContext, buildTaskContext, buildTaskOverviewContext, buildAutonomousInstructions } from '../promptBuilders.js';`
- `import { buildThreadContextReadModel } from '../../conversationThreadContextService.js';`
- `import { formatThreadContextBlock, prependThreadContextToBasePrompt } from '../../conversationThreadContextServicePure.js';`
- `import { persistAssembly as persistPromptAssembly } from '../../agentRunPromptService.js';`
- `import { workspaceMemoryService, agentRoleToDomain } from '../../workspaceMemoryService.js';`
- `import * as memoryBlockService from '../../memoryBlockService.js';`
- `import { agentBriefingService } from '../../agentBriefingService.js';`
- `import { agentBeliefService } from '../../agentBeliefService.js';`
- `import { subaccountStateSummaryService } from '../../subaccountStateSummaryService.js';`
- `import * as voiceProfileService from '../../voiceProfile/voiceProfileService.js';`
- `import { skillService } from '../../skillService.js';` (verify the exact tool-resolver helper used — may be `resolveAgentSkillsToTools` or a method on `skillService`)
- `import type { AgentRunRequest, RunExecutionContext } from '../types.js';`
- `import type { ThreadContextReadModel } from '../../../../shared/types/conversationThreadContext.js';`

**Function exports:**
```ts
export async function prepareRun(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<void>
```

Mutates `ctx` in place. Returns `void`.

**`RunExecutionContext` extension (Chunk 7b adds):**
```ts
//   effectiveTools: AnthropicTool[];
//   pipeline: ReturnType<typeof createDefaultPipeline>;
//   mcpClients: unknown[];  // verify exact type from llmService/MCP module
//   mcpLazyRegistry: unknown;
//   taskPrompt: string;
//   systemPrompt: string;
//   stablePromptBlock: string;
//   dynamicPromptBlock: string;
//   threadContext: ThreadContextReadModel | null;
//   injectedMemoryEntries: unknown[];
//   appliedMemoryBlockIds: string[];
//   targetItem: Record<string, unknown> | null;
//   routerCtx: unknown;  // verify
```

**Critical invariants (preserve verbatim):**
- 3-layer assembly order: base system prompt → autonomous instructions → voice block → thread context PREPENDED (not appended) → memory injections (beliefs / briefing / state summary / memory blocks / injected memory) in their current source order.
- `context_sources_snapshot` UPDATE is awaited; column write set unchanged.
- Prompt-assembly `persistAssembly` is awaited; emission is awaited if the source awaits it (verify L1095-1538 site).
- Stable/dynamic split for multi-breakpoint prompt caching (Phase 0C — L1278) preserved exactly.
- Injected-memory tracking array (Phase 2 S12 — L1351) populated for the citation detector AND consumed later in Chunk 9 (Phase 10 scoring at L1974).

**Barrel updates:**
- Add `import { prepareRun } from './agentExecutionService/runLifecycle/prepare.js';`
- Replace L977-1538 with: `await prepareRun(request, ctx);`
- DELETE source L977-1538.

**Module shape:**
- *Public interface:* `prepareRun(request, ctx)` — single async function.
- *What stays hidden:* tool resolution chain; auto-inject decision; MCP registries; task-context assembly; thread-context prepend; the 4+ memory-injection sites and their ordering; stable/dynamic split; prompt-assembly persistence + emission.

**Error handling:**
- Each existing try/catch boundary preserved exactly. Memory-injection failures degrade per the existing source behaviour (verify each call site during the move).

**Test considerations:**
- Largest extraction; highest behaviour-preservation risk. The line-range copy MUST preserve ordering of all side effects (Live-log emissions, UPDATEs, awaited vs fire-and-forget).
- Existing tests exercising prompt assembly (if any) keep their assertions.

**Dependencies:** Chunks 1, 2 (`promptBuilders.ts`), 7a (`ctx.runContextData`, `ctx.hierarchyContext`, etc.).

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- L977-1538 fully removed from `agentExecutionService.ts`.
- `prepareRun` exists at the documented path.
- Stable/dynamic split preserved (grep for the marker comment in the new module).
- Thread-context prepend (not append) preserved (grep for `prependThreadContextToBasePrompt`).
- `context_sources_snapshot` UPDATE preserved.
- `npm run typecheck` clean.

## Chunk 8 — Phase E: dispatch.ts (thin wrapper)

**Scope:** Extract Phase 8 dispatch site (`executionBackendRegistry.resolve(mode).dispatch(input)`) into a small wrapper. `buildBackendOptionsForMode` is already in `backendDispatch.ts` after Chunk 3.

**Files created:**
- `server/services/agentExecutionService/runLifecycle/dispatch.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete L1539-1676 from `executeRun`; replace with a call to `dispatchRun(request, ctx)`. Remove the now-orphan `executionBackendRegistry` / `ParentRunNotDispatchable` imports kept in Chunk 3.

**Source moves (delete from barrel, add to `dispatch.ts`):**
- Lines 1539-1676 — Phase 8 dispatch orchestration: assemble `ExecutionClosureContext` bundle from `ctx`; call `buildBackendOptionsForMode(executionMode, request, closureContext)`; assemble `BackendDispatchInput`; call `executionBackendRegistry.resolve(mode).dispatch(input)`; consume `BackendDispatchResult`; handle `ParentRunNotDispatchable` early exit.

**Imports added to `dispatch.ts`:**
- `import { buildBackendOptionsForMode } from '../backendDispatch.js';`
- `import { executionBackendRegistry } from '../../executionBackends/registry.js';`
- `import { ParentRunNotDispatchable } from '../../executionBackends/types.js';`
- `import type { AgentRunRequest, RunExecutionContext, ExecutionClosureContext } from '../types.js';`

**Function exports:**
```ts
export async function dispatchRun(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<{ kind: 'dispatched'; result: BackendDispatchResult } | { kind: 'parent_not_dispatchable' }>
```

The discriminated union covers the `ParentRunNotDispatchable` early-exit path.

**`RunExecutionContext` extension (Chunk 8 adds):**
```ts
//   dispatchResult: BackendDispatchResult;
```

**Critical invariants (preserve verbatim):**
- The `ExecutionClosureContext` projection from `ctx` MUST include every field listed at source L138-158. The closure-context bundle's field set is the load-bearing contract with the adapters (api / headless / claude-code consume specific subsets).
- `ParentRunNotDispatchable` early exit preserved (orchestrator returns same shape as source).

**Barrel updates:**
- Add `import { dispatchRun } from './agentExecutionService/runLifecycle/dispatch.js';`
- Replace L1539-1676 with:
  ```ts
  const dispatchOutcome = await dispatchRun(request, ctx);
  if (dispatchOutcome.kind === 'parent_not_dispatchable') {
    // ... preserve source behaviour for early-exit (likely return prior to finalise)
  }
  ctx.dispatchResult = dispatchOutcome.result;
  ```
- Remove orphan imports: `executionBackendRegistry`, `ParentRunNotDispatchable`, `BackendOptions` from the barrel's top-level imports (kept in Chunk 3 conservatively; cleaned here).
- DELETE source L1539-1676.

**Module shape:**
- *Public interface:* `dispatchRun(request, ctx)` — one async function with discriminated return.
- *What stays hidden:* the `ExecutionClosureContext` bundle assembly; the `BackendDispatchInput` shape construction; the registry-resolve call; per-adapter return-shape handling.

**Error handling:**
- `ParentRunNotDispatchable` caught and surfaced via discriminated return (matches source).
- Backend dispatch errors propagate to the orchestrator's outer try/catch (which is preserved in the barrel for the try/finally MCP cleanup).

**Test considerations:**
- Each backend adapter has its own gate test under `executionBackends/__tests__/` — unchanged.

**Dependencies:** Chunks 1, 3, 7b.

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- L1539-1676 fully removed from `agentExecutionService.ts`.
- `dispatchRun` exists at the documented path.
- The closure-context field set is identical to source L138-158 (one-to-one mapping verified).
- `npm run typecheck` clean.

## Chunk 9 — Phase F: complete.ts

**Scope:** Extract Phase 9 (finalise), Phase 10 (insights), Phase 11 (triggers) into a single completion function. Phase 12 (MCP cleanup) stays inside the barrel's `finally` block but delegates to a cleanup helper exported from `complete.ts`.

**Files created:**
- `server/services/agentExecutionService/runLifecycle/complete.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete L1677-2209 from `executeRun`; replace the `try` body's tail with a call to `finalizeRun(request, ctx)`; replace the `finally` block's body with a call to `cleanupMcp(ctx)`.

**Source moves (delete from barrel, add to `complete.ts`):**
- Lines 1677-1973 — Phase 9: status / summary / totals derivation via `computeRunResultStatus` (from pre-existing `agentExecutionServicePure.ts`); final `agent_runs` UPDATE (status, summary, totals, durationMs, completedAt); `run.completed` / `run.failed` / `run.timeout` Live-log emission (preserve awaited-vs-fire-and-forget per current source); websocket `agent:run:completed` emission; workflow-engine hook (`notifyWorkflowEngineOnAgentRunComplete`).
- Lines 1974-2190 — Phase 10: insight extraction for workspace memory + entities; memory-block scoring (Phase 8 W3c at L2003); injected-memory scoring (Phase 2 S12 at L1974); agent-briefing enqueue (Phase 2D at L2161 — pg-boss non-blocking); universal-brief artefact validation hook (currently prep-only).
- Lines 2191-2209 — Phase 11: non-blocking `agent_completed` trigger firing via `triggerService`.
- Lines 2210-2302 — Phase 12: MCP cleanup — DOES NOT MOVE to `complete.ts` as-is. Instead, a `cleanupMcp(ctx)` helper is added to `complete.ts` containing the body of the cleanup. The `try { ... } finally { await cleanupMcp(ctx); }` shape stays in the barrel's `executeRun`.

**Imports added to `complete.ts`:**
- `import { db } from '../../../db/index.js';`
- `import { eq } from 'drizzle-orm';`
- `import { agentRuns } from '../../../db/schema/index.js';`
- `import { computeRunResultStatus } from '../../agentExecutionServicePure.js';`
- `import { tryEmitAgentEvent, emitAgentEvent } from '../../agentExecutionEventEmitter.js';`
- `import { emitAgentRunUpdate, emitSubaccountUpdate } from '../../../websocket/emitters.js';`
- `import { workspaceMemoryService } from '../../workspaceMemoryService.js';`
- `import * as memoryBlockService from '../../memoryBlockService.js';`
- `import { agentBriefingService } from '../../agentBriefingService.js';`
- `import { agentBeliefService } from '../../agentBeliefService.js';`
- `import { triggerService } from '../../triggerService.js';`
- `import { validateArtefactForPersistence } from '../../briefArtefactValidator.js';`
- `import { logger } from '../../../lib/logger.js';`
- `import type { AgentRunRequest, AgentRunResult, RunExecutionContext } from '../types.js';`
- Workflow-engine hook import: `import { notifyWorkflowEngineOnAgentRunComplete } from '../../workflowEngineService.js';` (verify exact name)

**Function exports:**
```ts
export async function finalizeRun(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<AgentRunResult>

export async function cleanupMcp(
  ctx: RunExecutionContext,
): Promise<void>
```

`finalizeRun` returns the public `AgentRunResult` that `executeRun` ultimately resolves to. `cleanupMcp` is invoked from the orchestrator's `finally` block — see Decision 5 above.

**Critical invariants (preserve verbatim — spec §14):**
- The `try { ... } finally { ... }` enclosing scope STAYS in the orchestrator (barrel). `executeRun` body looks like:
  ```ts
  try {
    // Phases 1-7 calls (Chunks 5-7b)
    // Phase 8 dispatch call (Chunk 8)
    return await finalizeRun(request, ctx);    // Phases 9-11
  } catch (err) {
    // Existing catch behaviour: final agent_runs UPDATE to 'failed' status,
    // emit live:agent_completed with status: 'failed', return failed AgentRunResult.
    // This catch body is small (source L2280-2302) and STAYS in the barrel.
  } finally {
    await cleanupMcp(ctx);                     // Phase 12
  }
  ```
- The catch block at source ~L2280-2302 (the "if execution itself fails" fallback that writes a failed run row + emits `live:agent_completed` + returns a synthetic `AgentRunResult`) stays in the barrel because it shares the orchestrator's `run` / `request` / `startTime` references and must run regardless of whether `finalizeRun` was reached.
- Fire-and-forget emissions in Phases 10-11 stay fire-and-forget. Awaited emissions in Phase 9 stay awaited.
- `agent_completed` trigger firing is non-blocking — preserved (no `await`).
- MCP cleanup error suppression matches source: per-client `try/catch` around each `.close()` call, errors logged not rethrown.

**Barrel updates:**
- Add `import { finalizeRun, cleanupMcp } from './agentExecutionService/runLifecycle/complete.js';`
- Replace L1677-2209 with: `return await finalizeRun(request, ctx);`
- Replace L2210-2302 (the `finally` body's MCP cleanup loop): `await cleanupMcp(ctx);`. The `finally { }` wrapping brace stays in the barrel.
- DELETE source L1677-2302 EXCEPT the orchestrator-level `try` / `catch` / `finally` brace structure and the catch block.

**Module shape:**
- *Public interface:* two functions — `finalizeRun` (Phases 9-11) and `cleanupMcp` (Phase 12 body, called from orchestrator's `finally`).
- *What stays hidden:* `computeRunResultStatus` consumption; final UPDATE column projection; the 3 Live-log emission variants (completed / failed / timeout); workflow-engine notification; memory-block + injected-memory scoring; agent-briefing pg-boss enqueue; universal-brief artefact validation hook.

**Error handling:**
- All existing per-emission `try/catch` blocks preserved (some emissions wrap in try/catch to prevent insight failures from failing the run — verify each site).
- MCP cleanup error suppression preserved.
- Orchestrator's outer `catch` (writing failed-status row) STAYS in the barrel.

**Test considerations:**
- `__tests__/agentExecutionService.middlewareContext.test.ts` may exercise the finalise path. Assertions unchanged.
- Memory scoring callable is mockable in tests — keep the import path stable.

**Dependencies:** Chunks 1, 8 (`ctx.dispatchResult` is required).

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- L1677-2209 fully removed from `agentExecutionService.ts`; L2210-2302 replaced with `await cleanupMcp(ctx);`.
- `finalizeRun` + `cleanupMcp` exist at the documented path.
- The `try / catch / finally` structure remains in `executeRun` (grep for the orchestrator's outer `finally` keyword — must still be in the barrel).
- The catch block (L2280-2302 equivalent) stays in the barrel — verify by grep.
- `npm run typecheck` clean.

## Chunk 10 — resumeAgentRun extraction

**Scope:** Move `resumeAgentRun` plus its public option/result types to a dedicated sibling module. Orthogonal to Chunks 4-9 — can land in any order after Chunk 1.

**Files created:**
- `server/services/agentExecutionService/resume.ts` (new)

**Files modified:**
- `server/services/agentExecutionService.ts` — delete L2389-2590; re-export from `./agentExecutionService/resume.js`.

**Source moves (delete from barrel, add to `resume.ts`):**
- Lines 2389-2411 — Resume-path header comment (Sprint 3A context, design rationale).
- Lines 2413-2421 — `export interface ResumeAgentRunOptions`
- Lines 2423-2440 — `export interface ResumeAgentRunResult`
- Lines 2442-2590 — `export async function resumeAgentRun(runId, options): Promise<ResumeAgentRunResult>`

**Imports added to `resume.ts`:**
- `import { eq, and } from 'drizzle-orm';`
- `import { agentService } from '../agentService.js';`
- `import { agentRuns, agentRunSnapshots, subaccountAgents } from '../../db/schema/index.js';`
- `import { getOrgScopedDb } from '../../lib/orgScopedDb.js';`
- `import { streamMessages as streamAgentRunMessages } from '../agentRunMessageService.js';`
- `import { fingerprint } from '../regressionCaptureServicePure.js';`
- `import { buildResumeContext } from '../agentExecutionServicePure.js';`
- `import type { AgentRunCheckpoint, MiddlewareContext } from '../middleware/types.js';`
- `import type { SubaccountAgent } from '../../db/schema/index.js';`
- `import type { AgentRunRequest } from './types.js';`

**Function exports (signatures unchanged):**
```ts
export interface ResumeAgentRunOptions { useLatestConfig?: boolean }
export interface ResumeAgentRunResult { /* ... unchanged from source L2423-2440 */ }
export async function resumeAgentRun(
  runId: string,
  options?: ResumeAgentRunOptions,
): Promise<ResumeAgentRunResult>
```

**Barrel updates:**
- Add: `export { resumeAgentRun } from './agentExecutionService/resume.js';`
- Add: `export type { ResumeAgentRunOptions, ResumeAgentRunResult } from './agentExecutionService/resume.js';`
- DELETE source L2389-2590 from the barrel.

**Module shape:**
- *Public interface:* `resumeAgentRun` + the two public types (re-exported from barrel for backward compatibility).
- *What stays hidden:* the 5 sequential sub-steps (run row load / checkpoint load / configVersion drift check / message stream / live MiddlewareContext build); the org-scoped tx requirement; the `useLatestConfig` override semantics; the empty-saLink stub for org-scope runs (Sprint 3A scaffolding).

**Critical invariants (preserve verbatim):**
- The `useLatestConfig` flag default is `false` — drift is a hard refusal.
- The `messageCursor < 0` sentinel skip preserved.
- The `getOrgScopedDb('agentExecutionService.resumeAgentRun')` label preserved (used in `missing_org_context` failure attribution).
- All error message strings preserved byte-for-byte.

**Error handling:**
- All five `throw new Error(...)` paths preserved (no `runRow`, no `snapshotRow.checkpoint`, unsupported checkpoint version, configVersion drift, missing saLink for subaccount run).

**Test considerations:**
- No resume-path unit test exists today (Sprint 3A library-only).
- If a future test is added, it imports from the barrel re-export — path preserved.

**Dependencies:** Chunk 1 (`AgentRunRequest`).

**Verification commands (G1):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- L2389-2590 fully removed from `agentExecutionService.ts`.
- `resumeAgentRun` exists at the documented path with identical signature.
- Barrel re-exports `resumeAgentRun`, `ResumeAgentRunOptions`, `ResumeAgentRunResult` (verify with grep on the barrel).
- `npm run typecheck` clean.

## Chunk 11 — Barrel thinning + caller sweep + doc sync

**Scope:** Final barrel trim; sweep §10 caller list; update architecture.md and doc-sync.md. This is the G2 chunk — runs build:client in addition to build:server.

**Files modified:**
- `server/services/agentExecutionService.ts` — final trim to the §5.6 barrel shape (target < 250 LOC per spec §1).
- `architecture.md` — short paragraph update in § Agent Execution Middleware Pipeline pointing at the new module tree.
- `docs/doc-sync.md` — update if any reference doc trigger fires (likely none — the public surface is unchanged).
- `references/project-map.md` — regenerate via `npm run code-graph:rebuild` (the new sibling files are auto-discovered).

**`startRunAsync` placement (LOCKED — spec §11 Chunk 11 lock):**
- `startRunAsync` (source L2316-2386) STAYS in the barrel as a method on the same `agentExecutionService` object literal as `executeRun` (per Decision 1).
- The `void this.executeRun(request).catch(...)` line (source L2381) MUST resolve `this` against the live object — splitting `startRunAsync` from `executeRun` would break the `this` binding and the fire-and-forget detachment.
- The `PLAN_GAP` comment block (source L2376-2380) is preserved verbatim. It is an existing tech-debt marker (`AGENTEXEC-SPLIT-DEF-1`), not a finding for this build.

**Final barrel shape:**
```ts
// server/services/agentExecutionService.ts (target < 250 LOC)

import { db } from '../db/index.js';
import { eq, inArray } from 'drizzle-orm';
import { agentRuns } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import type { AgentRunRequest, AgentRunResult, RunExecutionContext } from './agentExecutionService/types.js';
import { validateAndPrepare } from './agentExecutionService/runLifecycle/validate.js';
import { persistAndAnnounce } from './agentExecutionService/runLifecycle/persistRun.js';
import { configureRun } from './agentExecutionService/runLifecycle/configure.js';
import { loadRunContextAndHierarchy } from './agentExecutionService/runLifecycle/loadContext.js';
import { prepareRun } from './agentExecutionService/runLifecycle/prepare.js';
import { dispatchRun } from './agentExecutionService/runLifecycle/dispatch.js';
import { finalizeRun, cleanupMcp } from './agentExecutionService/runLifecycle/complete.js';

export const agentExecutionService = {
  async executeRun(request: AgentRunRequest): Promise<AgentRunResult> {
    const startTime = Date.now();
    const validated = await validateAndPrepare(request, startTime);
    if (validated.kind === 'early_exit') return validated.result;
    const ctx = validated.ctx;

    const { run } = await persistAndAnnounce(request, ctx);
    ctx.run = run;

    try {
      const configResult = await configureRun(request, ctx);
      if (configResult.kind === 'workspace_limit_failed') return configResult.result;

      await loadRunContextAndHierarchy(request, ctx);
      await prepareRun(request, ctx);

      const dispatchOutcome = await dispatchRun(request, ctx);
      if (dispatchOutcome.kind === 'parent_not_dispatchable') {
        // ... preserve source early-exit behaviour
      }
      ctx.dispatchResult = dispatchOutcome.result;

      return await finalizeRun(request, ctx);
    } catch (err) {
      // Preserved catch block (source L2280-2302 equivalent):
      // final agent_runs UPDATE to failed; emit live:agent_completed; return failed AgentRunResult.
    } finally {
      await cleanupMcp(ctx);
    }
  },

  async startRunAsync(request: AgentRunRequest): Promise<{ runId: string; status: 'running' | AgentRunResult['status']; isExisting?: true }> {
    // Body preserved from source L2316-2386 (idempotency check + immediate INSERT + fire-and-forget executeRun).
    // The `void this.executeRun(request).catch(...)` line preserved verbatim.
  },
};

export type { AgentRunRequest, AgentRunResult } from './agentExecutionService/types.js';
export { resumeAgentRun } from './agentExecutionService/resume.js';
export type { ResumeAgentRunOptions, ResumeAgentRunResult } from './agentExecutionService/resume.js';
export type { LoopParams } from './agentExecutionLoop.js';
export type { LoopResult } from './agentExecutionTypes.js';
```

**Caller sweep (per spec §10 — 16 files):**

Routes, jobs, services, tools, tests in the §10 list all import `agentExecutionService` (the object) and/or `AgentRunRequest` / `AgentRunResult` types. The barrel re-export preserves every import path. No caller change is REQUIRED.

OPTIONAL per-caller move (do only if low cost): redirect `AgentRunRequest` type-only imports to the canonical `agentExecutionService/types.js` path. For this build's minimal-diff posture, leave callers on the barrel re-export.

**Hard boundary (spec §2 + §5.4):** The pre-existing siblings — `agentExecutionServicePure.ts`, `agentExecutionLoop.ts`, `agentExecutionTypes.ts`, `executionBackends/options.ts` — appear in the §10 list because they `import type { AgentRunRequest }` from this module. They are NEVER modified by Chunk 11. Their import lines stay on the barrel re-export (since the barrel preserves `export type { AgentRunRequest }`, no edit is needed).

**doc updates:**
- `architecture.md § Agent Execution Middleware Pipeline` — add one short paragraph pointing at `server/services/agentExecutionService/` and listing the runLifecycle phase modules in order (validate → persistRun → configure → loadContext → prepare → dispatch → complete). One-line pointer to the directory; do not duplicate the spec.
- `docs/doc-sync.md` — verify no reference doc trigger fires; if a refactor pointer is needed, add one.

**Module shape:**
- *Public interface:* the barrel — `agentExecutionService` object (with `executeRun` + `startRunAsync`), `AgentRunRequest`, `AgentRunResult`, `resumeAgentRun`, `ResumeAgentRunOptions`, `ResumeAgentRunResult`, `LoopParams` (re-export), `LoopResult` (re-export). Identical to spec §4 Public-Surface Lock.
- *What stays hidden:* the entire `runLifecycle/*` directory; `backendDispatch.ts`; `promptBuilders.ts`; `resume.ts` internals; the `RunExecutionContext` shape; the phase-function call ordering inside `executeRun`.

**Error handling:**
- The orchestrator's try/catch/finally structure is the only error-handling change vs source — and it is structurally identical to source L1670-2302 (the bracketing try/finally with the embedded fallback catch). Verify by structural diff.

**Test considerations:**
- `__tests__/agentExecutionService.middlewareContext.test.ts` runs against the final shape. Assertions unchanged.
- `npm run build:client` runs in this chunk (the only client-touching chunk — verifies no stale type re-export breaks shared types consumed by client code).

**Dependencies:** ALL prior chunks (1, 2, 3, 4, 5, 6, 7a, 7b, 8, 9, 10).

**Verification commands (G2):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`

**Acceptance criteria:**
- `agentExecutionService.ts` is at or below 250 LOC (spec §1 target).
- The barrel's re-export shape matches spec §5.6 exactly.
- `startRunAsync` is a method on the same object literal as `executeRun` (verify by reading the barrel — both methods appear in the `agentExecutionService = { ... }` object).
- The `void this.executeRun(request).catch(...)` line at the new `startRunAsync` position is present verbatim.
- `architecture.md § Agent Execution Middleware Pipeline` references the new directory.
- All four G2 commands clean.
- Public-surface caller sweep complete: no §10 caller import broken (verify with `npx tsc --noEmit` clean).

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sequence-number invariant break (Chunk 5 converts the awaited `run.started` emission to fire-and-forget) | Low | High — downstream consumers depend on sequence-1 = `run.started` | Chunk 5 acceptance criterion grep-checks `await emitAgentEvent('run.started'` is present in the new module. CI gate covers behavioural verification. |
| Side-effect ordering drift inside Phase 7 (Chunk 7b — 561 LOC of memory injection, thread context, stable/dynamic split) | Medium | High — prompt-cache hit rate + memory citation accuracy degrade silently | Chunk 7b acceptance criterion enumerates the load-bearing markers (stable/dynamic split, thread-context prepend, `context_sources_snapshot` UPDATE). The chunk's line-range move is a copy-paste with redirected imports; no logic edits. |
| Try/finally MCP cleanup break (Chunk 9 — relaxing the try/finally would orphan MCP clients) | Low | High — leaked MCP clients across runs | Chunk 9 acceptance criterion requires the `try/catch/finally` structure to remain in the barrel (grep-verified). `cleanupMcp` is invoked from the barrel's `finally`, not from `finalizeRun`. |
| `RunExecutionContext` shape drift across Chunks 4-9 (each chunk extends the interface — if shapes diverge or a phase reads a field a prior phase did not write, a runtime `undefined` bug emerges) | Medium | Medium | Decision 2 fixes the shape: single mutable record, extended in-place in `types.ts` per chunk. Each chunk's acceptance criterion lists the fields it adds. Typecheck catches missing-field reads. |
| `this`-binding break in `startRunAsync` (if a future cleanup splits `startRunAsync` from `executeRun`) | Low | High — fire-and-forget detachment silently breaks | Chunk 11 acceptance criterion grep-verifies both methods are on the same object literal. Decision 1 + spec §11 Chunk 11 lock pin this. |
| Caller sweep miss (a §10 caller's import path resolves through a sibling not listed in §10) | Low | Medium — build breaks | Chunk 11 runs `npm run typecheck` AND `npm run build:client`. Spec §10 is regenerated each chunk if the import topology widens. |
| Pattern-setter divergence (the companion spec `feat-split-skillexecutor` lands later or with different §5 conventions) | Low | Low | Spec §5.1 adopts the pattern-setter's §5.1/5.4/5.5/5.6 by reference. This build's §5.2 directory layout is bespoke (no `*Handlers.ts` family — agentExecutionService has no handler registry). Cross-spec drift only surfaces if the pattern-setter changes its §5.1 naming conventions, which is low-likelihood since the conventions are stable. |
| Policy-envelope emit-then-throw ordering inversion (Chunk 6) | Low | High — downstream consumers miss the `foundation.policy_envelope.resolved` event before the run fails | Chunk 6 acceptance criterion enumerates the emit-before-throw ordering. CI gate `verify-policy-envelope-*` covers behavioural verification. |
| Hierarchy fail-open path becomes fail-closed (Chunk 7a) | Low | High — runs with malformed hierarchy now fail instead of degrading | Chunk 7a acceptance criterion grep-verifies `HierarchyContextBuildError` is caught with `logger.warn`, not `throw`. |
| Resume-path saLink stub regression for org-scope runs (Chunk 10) | Very low | Low — Sprint 3A is library-only, no production caller today | Chunk 10 preserves the empty-saLink cast for org-scope runs. Behaviour is unchanged. |

## Self-consistency pass

- Every spec §7 chunk (1, 2, 3, 4, 5, 6, 7a, 7b, 8, 9, 10, 11) has a corresponding chunk section in this plan. ✓
- Every spec §4 public-surface entry is preserved by the barrel after Chunk 11 (verified against the final barrel shape). ✓
- Every spec §14 execution-safety contract is named explicitly in a chunk's "Critical invariants" subsection (idempotency lookup unchanged → Chunk 4; INSERT column set + run.started sequence-1 → Chunk 5; configSnapshot UPDATE + policy emit-then-throw → Chunk 6; fail-open hierarchy → Chunk 7a; thread-context prepend + stable/dynamic split → Chunk 7b; closure-context field set → Chunk 8; try/finally MCP cleanup → Chunk 9; PLAN_GAP comment + `this`-binding → Chunk 11). ✓
- The 4 spec §11 open questions are resolved in Architecture Notes Decisions 1-4. ✓
- Spec §2 + §5.4 hard boundaries (pre-existing siblings untouched) are honoured: no chunk modifies `agentExecutionServicePure.ts`, `agentExecutionLoop.ts`, `agentExecutionTypes.ts`, or `executionBackends/*`. ✓
- Spec §9 deferred items (`AGENTEXEC-SPLIT-DEF-*`) are not assigned to any chunk. ✓
- The line-range map covers every byte of source L1-2806. ✓
- Forward-only dependency graph has no cycles. ✓
- Plan adds no behaviour, no test files, no schema work, no client changes (except Chunk 11's `build:client` verification step). ✓

## Spec deviations

None. The plan resolves all 4 spec §11 open questions in Architecture Notes Decisions 1-4 (each cites the spec default and confirms it). The plan adds no scope beyond the spec's §7 chunked migration.

## Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Per-chunk verification commands are listed in each chunk's "Verification commands (G1)" subsection. Chunk 11 runs `build:client` in addition because the barrel's type re-exports are consumed by client-side imports through shared types.

No new test files are authored by this build (spec §13, testing posture `static_gates_primary`). Existing tests (`__tests__/agentExecutionService.middlewareContext.test.ts` and any policy-envelope / resume-path tests) keep their assertions; if their import path needs to shift (it does not, because the barrel re-exports the public surface), update the import only — never the assertions.

For each chunk:
1. Read this plan's chunk section.
2. Move the listed source line range to the destination file.
3. Update the call site in the barrel (`agentExecutionService.ts`) per the chunk's "Barrel updates" subsection.
4. Run the chunk's G1 verification commands.
5. Commit with the chunk's acceptance criteria satisfied.
6. Move to the next chunk in numeric order.

The barrel is the integration point. After every chunk, `npm run typecheck` must pass — if it does not, the chunk is incomplete and the next chunk MUST NOT start.
