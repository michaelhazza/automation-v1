---
status: DRAFT
date: 2026-05-15
author: architect (claude opus 4.7)
build_slug: split-services-soft-cap-batch
spec: tasks/builds/split-services-soft-cap-batch/spec.md
branch: claude/split-services-soft-cap-batch
---

# Wave 2 Session B — implementation plan

Splits the 5 soft-cap god-files identified in the spec into thin barrels + sibling directories. Adopts §5 module-decomposition conventions from `tasks/builds/feat-split-skillexecutor/spec.md` verbatim. Adopts the lifecycle-phase decomposition pattern from `tasks/builds/feat-split-agentexecutionservice/spec.md` for `workspaceMemoryService` and `llmRouter`.

## Table of contents

- Model-collapse check
- Executor notes
- Architecture notes
- Chunk 0 — cross-target caller sweep + PR-shape decision
- Per-target mini-plans
  - Target 1 — `server/services/queueService.ts`
  - Target 2 — `server/services/agentService.ts`
  - Target 3 — `server/services/workspaceMemoryService.ts`
  - Target 4 — `server/services/llmRouter.ts`
  - Target 5 — `server/jobs/skillAnalyzerJob.ts`
- Final chunk — cross-target verification
- Risks and mitigations
- Self-consistency pass
- Open questions for the operator
- Deferred items

## Model-collapse check

Q1: Does this feature decompose into ingest → extract → transform → render? **No.** It is a mechanical code redistribution. No data pipeline, no model in the loop.

Q2: Is each step doing something a frontier multimodal model could do in one call? **No.** Splitting a TypeScript module by extracting functions to sibling files preserving exact public surface is a deterministic refactor, not an inference task.

Q3: Can the whole pipeline collapse into one model call with a structured-output schema? **No.** Decision: **reject collapse**. Rationale: the work is "redistribute existing LOC across new files while preserving public exports byte-for-byte." Frontier models can perform individual extractions but cannot execute the multi-PR, dependency-ordered, gate-validated sequence in one call. The plan exists to drive deterministic builder invocations, not to invoke an LLM.

## Executor notes

Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

Per-chunk allowed local commands: `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` (mandatory after every barrel transition), `npm run build:client` only when a chunk crosses into the client surface (none of the 5 targets do — this build is server-only). No targeted vitest runs are scheduled because this build authors no new tests; see §13 of the spec.

## Architecture notes

### Conventions adopted

- **§5.1 (naming) of skillExecutor spec — adopted verbatim.** New modules under each target directory follow the `*Pipeline.ts` / `*Registry.ts` / `*Adapter.ts` suffix convention where it fits; bespoke phase / cluster names where it does not. No `*Pure.ts` extractions in this build (deferred per spec §3 and §6.1).
- **§5.2 (directory layout) — adopted.** Each target sits as a thin barrel at its current path with a sibling directory matching the filename slug (e.g., `server/services/agentService.ts` is the barrel; `server/services/agentService/` is the directory).
- **§5.3 (DAG, no cycles) — adopted with one explicit modification.** The skillExecutor pattern forbids cross-`handlers/*` imports. Here the equivalent rule is: no file under `<target>/` may import the barrel; no cross-target imports under `<target>/<subdir>/`. The two pre-existing cross-target edges (`workspaceMemoryService` → `llmRouter.routeCall`, `skillAnalyzerJob` → `llmRouter.routeCall`) are preserved through `llmRouter`'s public barrel.
- **§5.4 (Pure/impure separation) — acknowledged, not exercised.** No `*Pure.ts` extractions in this build. Opportunities surface to `tasks/todo.md` under `SOFTCAP-PURE-<target>-*`.
- **§5.5 (Module-level state) — adopted.** Each target has at most a handful of module-level state sites (registries, cache maps, in-flight sets, pgBossSend handle). Every such site moves to exactly one home in the new tree; no duplication across siblings.
- **§5.6 (Test-collocation) — adopted.** Existing `__tests__/*` files stay at their current path. Their import paths may shift to the new sub-module location during the relevant chunk, but no test file is created or moved.
- **§5.7 (Barrel re-export shape) — adopted.** Each target's barrel becomes a thin re-export skeleton matching the public-surface table in §1 below.

### Lifecycle-phase decomposition pattern (agentExecutionService spec)

Applied to `workspaceMemoryService` and `llmRouter`, both of which have an internal phased structure:

- `workspaceMemoryService` has six clean phases visible from §-comment markers (read, extract, hybrid retrieval, graph expansion, embedding lifecycle, enrichment job worker).
- `llmRouter`'s `routeCall` function has 16 numbered phases (`// ── N. <name>`). They are sequential and amenable to the same threaded-context-object extraction used by `agentExecutionService` — but here the cohort is small enough to land as a single phase-module file (`router/routeCall.ts`) per the principle of "depth over shallow file fan-out."

### Risks (full discussion in § Risks and mitigations)

- llmRouter is the highest-risk target because every consumer in the codebase ultimately routes through it; the `routeCall` function holds module-level state (`providerCooldowns` Map, dynamic `import('./routerJobService.js')` shape) and is the deepest single function in the batch (~1,600 LOC).
- queueService's `startMaintenanceJobs()` registers 50+ pg-boss workers as a single registration block. Extracting groups of registrations must preserve dispatch order to avoid duplicate-handler races at boot.
- workspaceMemoryService and agentService both have a single exported object literal with ~25 methods each. The split moves method bodies into sibling files while preserving the export shape via spread assembly in the barrel.

### Decisions deferred to the operator

See § Open questions for the operator. None block plan acceptance — all default decisions are documented inline; operator may override before the first chunk runs.

---

## Chunk 0 — cross-target caller sweep + PR-shape decision

This chunk is research, not code. It is recorded here so the per-target chunks below operate on a known surface. No commits land for Chunk 0.

### Locked public surface per target

The following exports MUST remain importable from each target's canonical path at the end of every chunk boundary. Confirmed by `grep -nE "^export\s+" <target>` at plan time:

| Target | Public exports (every name listed is barrel-re-exported) |
|---|---|
| `server/services/agentService.ts` | `AgentPersonality` (interface, line 26), `AgentRunPreview` (interface, line 33), `AgentFull` (interface, line 42), `dataSyncScheduler` (const, line 134), `loadSourceContent` (async function, line 403), `DataSourceScope` (interface, line 472), `LoadedDataSource` (interface, line 484), `fetchDataSourcesByScope` (async function, line 520), `fetchAgentDataSources` (async function, line 587), `agentService` (const object literal, line 623, 25 methods including the underscore-prefixed `_assertNotSystemManaged`, `_assertEtag`, `_getScheduledTaskOrThrow`) |
| `server/jobs/skillAnalyzerJob.ts` | `processSkillAnalyzerJob` (async function, line 95) — only export |
| `server/services/workspaceMemoryService.ts` | `ExtractRunInsightsOptions` (interface, line 64), `agentRoleToDomain` (function, line 136), `setContextEnrichmentJobSender` (function, line 562), `workspaceMemoryService` (const object literal, line 598, ~20 methods), `pruneStaleMemoryEntries` (async function, line 1710), `reembedEntry` (async function, line 1754), `getStaleEmbeddingsBatch` (async function, line 1799), `recomputeStaleEmbeddings` (async function, line 1835), `processContextEnrichment` (async function, line 1859) |
| `server/services/llmRouter.ts` | `shouldEmitLaelLifecycle` (re-export from `llmRouterLaelPure.ts`, line 35), `LLMCallContext` (type alias, line 108), `RouterCallParams` (interface, line 110), `ProviderTimeoutError` + `callWithTimeout` (re-exports from `llmRouterTimeoutPure.ts`, line 189), `routeCall` (async function, line 287), `TaskType` + `SourceType` + `ExecutionPhase` + `RoutingMode` (type re-exports, line 1910), `TASK_TYPES` + `SOURCE_TYPES` + `EXECUTION_PHASES` + `ROUTING_MODES` (value re-exports, line 1911), `countTokens` + `SUPPORTED_MODEL_FAMILIES` (re-exports from `providers/anthropicAdapter.ts`, line 1917), `SupportedModelFamily` (type re-export, line 1918) |
| `server/services/queueService.ts` | `queueService` (const object literal, line 410, methods: `enqueueExecution`, `sendJob`, `cleanupExpiredExecutionFiles`, `cleanupExpiredComputeReservations`, `enqueueWorkflowResume`, `enqueueRegressionCapture`, `startMaintenanceJobs`) — only export |

If any future caller is found to import a name not in this table, that import path becomes locked too. The Final chunk caller sweep re-validates.

### Per-target caller sweep

Confirmed by `grep -rnE "from\s+['\"][^'\"]*<target>(\.js)?['\"]" server/` (excluding tests, docs, review logs, build artefacts):

**`server/services/agentService.ts` callers (16 files):**

- `server/index.ts` — `agentService`
- `server/routes/agents.ts` — `agentService`
- `server/routes/agents/agentTabs.ts` — `agentService`
- `server/routes/skills.ts` — `agentService`
- `server/routes/scheduledTasks.ts` — `agentService`
- `server/routes/webhookAdapter.ts` — `agentService`
- `server/services/agentPromptRevisionService.ts` — `agentService`
- `server/services/agentExecutionService/types.ts` — `agentService` (type-only)
- `server/services/agentExecutionService/runLifecycle/configure.ts` — `agentService`
- `server/services/agentExecutionService/resume.ts` — `agentService`
- `server/services/conversationService.ts` — `agentService`
- `server/services/runContextLoader.ts` — `fetchDataSourcesByScope`, `LoadedDataSource`, `DataSourceScope`
- `server/services/runContextLoaderPure.ts` — `LoadedDataSource` (type-only)
- `server/services/taskAttachmentContextService.ts` — `LoadedDataSource` (type-only)
- `server/tools/readDataSource.ts` — `loadSourceContent`, `LoadedDataSource`
- `server/tools/config/configSkillHandlers.ts` — `agentService`

**`server/jobs/skillAnalyzerJob.ts` callers (1 file):**

- `server/jobs/skillAnalyzerJobWithIncidentEmission.ts` — `processSkillAnalyzerJob` (the boot-time wrapper)

**`server/services/workspaceMemoryService.ts` callers (9 files):**

- `server/jobs/memoryDecayJob.ts` — `pruneStaleMemoryEntries`
- `server/routes/knowledge.ts` — `workspaceMemoryService`
- `server/routes/workspaceMemory.ts` — `workspaceMemoryService`
- `server/services/agentExecutionService/promptBuilders.ts` — `workspaceMemoryService`
- `server/services/agentExecutionService/runLifecycle/prepare.ts` — `workspaceMemoryService`, `agentRoleToDomain`
- `server/services/agentExecutionService/runLifecycle/complete.ts` — `workspaceMemoryService`
- `server/services/agentScheduleService.ts` — `setContextEnrichmentJobSender`
- `server/services/outcomeLearningService.ts` — `workspaceMemoryService`
- `server/services/skillExecutor/handlers/memory.ts` — `workspaceMemoryService`

**`server/services/llmRouter.ts` callers (~30 files):**

- `server/jobs/benchExecuteJob.ts` — `routeCall`
- `server/jobs/scorecardJudgeJob.ts` — `routeCall`
- `server/jobs/skillAnalyzerJob.ts` — `routeCall` (cross-target import — see §Cross-target audit)
- `server/lib/__tests__/llmStub.test.ts` — `RouterCallParams` (type-only)
- `server/lib/__tests__/llmStub.ts` — `RouterCallParams` (type-only)
- `server/services/agentBriefingService.ts` — `routeCall`
- `server/services/agentExecutionLoop.ts` — `routeCall`, `LLMCallContext` (type)
- `server/services/cachedContextOrchestrator.ts` — `routeCall`
- `server/services/chatTriageClassifier.ts` — `routeCall`
- `server/services/configDocumentParserService.ts` — `routeCall`
- `server/services/conversationService.ts` — `routeCall`
- `server/services/crmQueryPlanner/llmPlanner.ts` — `routeCall`
- `server/services/documentPromotionService.ts` — `countTokens`, `SUPPORTED_MODEL_FAMILIES`
- `server/services/documentSummariseService.ts` — `routeCall`
- `server/services/memoryInspectorService.ts` — `routeCall`
- `server/services/optimiser/renderRecommendation.ts` — `routeCall`
- `server/services/outcomeLearningService.ts` — `routeCall`
- `server/services/referenceDocumentService.ts` — `countTokens`, `SUPPORTED_MODEL_FAMILIES`
- `server/services/ruleCandidateDrafter.ts` — `routeCall`
- `server/services/skillAnalyzerService/execute/retry.ts` — `routeCall`
- `server/services/skillExecutor/handlers/web.ts` — `routeCall`
- `server/services/skillHandlers/supportClassifyTicket.ts` — `routeCall`
- `server/services/skillHandlers/supportFindCustomerHistory.ts` — `routeCall`
- `server/services/skillHandlers/supportProposeReply.ts` — `routeCall`
- `server/services/skillRuntimeCheckSuggestionService.ts` — `routeCall`
- `server/services/supportEvalHarness.ts` — `routeCall`
- `server/services/systemMonitor/triage/triageHandler.ts` — `routeCall`
- `server/services/workspaceMemoryService.ts` — `routeCall` (cross-target import — see §Cross-target audit)
- `server/tools/capabilities/askClarifyingQuestionsHandler.ts` — `routeCall`
- `server/tools/capabilities/challengeAssumptionsHandler.ts` — `routeCall`

**`server/services/queueService.ts` callers (3 files):**

- `server/index.ts` — `queueService`
- `server/routes/reviewItems.ts` — `queueService`
- `server/services/executionService.ts` — `queueService`

### Cross-target import audit (10 pairs)

Performed by `grep -nE "from\s+['\"][^'\"]*(agentService|skillAnalyzerJob|workspaceMemoryService|llmRouter|queueService)(\.js)?['\"]"` inside each of the 5 target source files:

| Pair (left → right) | Edge present? | Detail |
|---|---|---|
| `agentService` ↔ `skillAnalyzerJob` | no | grep clean both directions |
| `agentService` ↔ `workspaceMemoryService` | no | grep clean both directions |
| `agentService` ↔ `llmRouter` | no | grep clean both directions |
| `agentService` ↔ `queueService` | no | grep clean both directions |
| `skillAnalyzerJob` ↔ `workspaceMemoryService` | no | grep clean both directions |
| `skillAnalyzerJob` → `llmRouter` | **YES** | `server/jobs/skillAnalyzerJob.ts:76` — `import { routeCall } from '../services/llmRouter.js';` |
| `llmRouter` → `skillAnalyzerJob` | no | grep clean |
| `skillAnalyzerJob` ↔ `queueService` | no | grep clean both directions (`maintenance:stale-analyzer-job-sweep` uses dynamic `import('../jobs/staleAnalyzerJobSweepJob.js')`, not the analyzer job itself) |
| `workspaceMemoryService` → `llmRouter` | **YES** | `server/services/workspaceMemoryService.ts:9` — `import { routeCall } from './llmRouter.js';` |
| `llmRouter` → `workspaceMemoryService` | no | grep clean |
| `workspaceMemoryService` ↔ `queueService` | no | grep clean (job-sender is wired by callback at boot via `setContextEnrichmentJobSender`; no direct import) |
| `llmRouter` ↔ `queueService` | no | grep clean (router uses pg-boss via `routerJobService` dynamic import, NOT via `queueService` directly) |

**Two cross-target edges found, both one-way INTO `llmRouter`:**

1. `server/jobs/skillAnalyzerJob.ts:76` → `routeCall` from `../services/llmRouter.js`
2. `server/services/workspaceMemoryService.ts:9` → `routeCall` from `./llmRouter.js`

Both consume only `routeCall`, which is `llmRouter`'s primary public export and is locked at the barrel for every chunk. Therefore the edges are preserved transparently through the barrel re-export — no consumer needs to update its import path.

**Spec §6.3 compliance:** the rule "no cross-target imports introduced during the split" is honoured because the edges are PRE-EXISTING; we do not create new ones. The rule "if chunk 0 finds an existing cross-target import, preserve it through the public barrel" is honoured by leaving the `routeCall` export on `llmRouter.ts`'s barrel for the whole migration.

### PR-shape decision

**Decision: one master PR with one commit per target chunk** (spec §10 Option A, the preferred default).

Rationale:

1. The cross-target audit found only two pre-existing edges, both pointing into `llmRouter.routeCall`, which remains importable from `server/services/llmRouter.js` at every chunk boundary. No staged migration ordering is forced on the 5 targets.
2. The 5 targets touch independent file trees: `server/services/{agentService,workspaceMemoryService,llmRouter,queueService}` + `server/jobs/skillAnalyzerJob`. Git diff overlap between target chunks is zero (each chunk modifies disjoint paths).
3. Bisect granularity is preserved at the commit level — if a chunk regresses, `git revert <chunk-sha>` returns the working tree to a known-good barrel state for that target while the other 4 targets stay split.
4. One PR fits the spec's framing assumption (§4) that the 5 targets have no cross-imports between them, "making conflict-free parallel chunk execution feasible."

**Ordering of target chunks within the master PR.** Targets execute sequentially in this order (rationale follows the order, not the other way around):

1. **`queueService`** — smallest LOC (1,683), no cross-target edges, single registry-style top-level structure. Lowest blast radius if a barrel transition goes wrong; serves as the pattern-validation chunk for this batch.
2. **`agentService`** — second-smallest blast radius (no cross-target edges, single big object literal). Validates the spread-assembly barrel shape on a 2,335-LOC target before applying it to larger ones.
3. **`workspaceMemoryService`** — depends on `llmRouter.routeCall` but only through the public barrel. Splitting workspace-memory before llmRouter is fine; the `routeCall` import line in the new `workspaceMemoryService/extract.ts` continues to resolve to the unchanged `llmRouter.ts` barrel.
4. **`llmRouter`** — split AFTER its consumers because the cross-target imports point INTO it. By the time llmRouter splits, `workspaceMemoryService` and `skillAnalyzerJob` already import `routeCall` from the barrel. The barrel preserves that export through every llmRouter chunk.
5. **`skillAnalyzerJob`** — split LAST. It is the most pipeline-shaped target and benefits from being the final cohort to absorb any pattern adjustments learned from the prior four splits. Its public surface is a single function so the barrel transition is the simplest of the five.

If the operator prefers to parallelise across multiple worktrees, every target chunk is independent of every other (no shared file is touched). Order within each target's chunks is dependency-driven and serialised inside that target.

---

## Per-target mini-plans

Each mini-plan follows: scaffold → extract leaves → extract orchestrator → thin the barrel → caller-sweep validate. Each chunk's "Files modified" list is exact; "Module shape" gives the public interface vs hidden surface; "Verification commands" lists ONLY the local commands allowed per the Executor notes above.

Per spec §6.1 + §5 of skillExecutor, every new file in a target's directory follows the barrel-imports-only-from-its-children rule. No file under `<target>/` imports the barrel; no file under `<target>/` imports another target's internal modules.

---

### Target 1 — `server/services/queueService.ts` (1,683 LOC)

Split by responsibility: execution-processing core, generic enqueue helpers, maintenance-job worker registry, in-memory fallback. Pattern reference: spec §6.4 — "Split by responsibility: registration, lifecycle (start/stop), DLQ, metrics, health checks."

#### Final directory shape

```
server/services/queueService.ts                   ← barrel (target < 250 LOC; budget 180)
server/services/queueService/
  types.ts                                        ← QueueBackend types, queue-name constants, advisory-lock IDs, error-serialiser, SimpleQueue class (~120 LOC budget)
  backend.ts                                      ← getQueueBackend(), queueWorkerReady module-state, the EXECUTION_QUEUE_NAME boss.work registration that lives inside getQueueBackend today (~180 LOC budget)
  executionProcessor.ts                           ← processExecution() (~280 LOC budget — the core dispatch + retry loop)
  enqueueHelpers.ts                               ← enqueueExecution, sendJob, enqueueWorkflowResume, enqueueRegressionCapture, cleanupExpiredExecutionFiles, cleanupExpiredComputeReservations (~180 LOC budget)
  migrationAdapter.ts                             ← resolveMigrationAdapter() (~30 LOC budget)
  maintenanceJobs/
    pgBossRegistrations.ts                        ← every boss.work(...) call inside the pg-boss branch of startMaintenanceJobs() (~750 LOC budget — accepts a `boss` arg and a `withAdvisoryLock` ref; called by start.ts)
    intervalFallback.ts                           ← every setInterval(...) inside the in-memory branch of startMaintenanceJobs() (~120 LOC budget)
    start.ts                                      ← startMaintenanceJobs() wrapper — picks the branch, sets the system-worker context, calls into pgBossRegistrations or intervalFallback (~80 LOC budget)
```

All files are under the 1,500 LOC soft cap; `pgBossRegistrations.ts` at ~750 LOC is the largest and is intentionally not sub-split because it is a flat list of `boss.work(name, opts, handler)` registrations — splitting it further would invent grouping that does not exist in the source. If the operator's preference is finer slicing, the natural cohort lines from source comments are: maintenance vs spec-B-sandbox vs scorecard/bench vs slack/orchestrator — but spec §3 forbids drive-by re-grouping.

#### Chunks

##### Chunk Q1 — Scaffold + types + SimpleQueue

- `chunk_name:` `queue-scaffold`
- `spec_sections:` §1, §5 (queueService row), §6.2 directory layout, §6.4 (queueService seams)
- `files_modified:` create `server/services/queueService/types.ts`; modify `server/services/queueService.ts` to import the moved symbols
- `files_deleted:` none
- `contract:` `SimpleQueue` class, `EXECUTION_QUEUE_NAME`, `WORKFLOW_RESUME_QUEUE`, `LOCK_ID_*` constants, `serializeError`, `withAdvisoryLock` move to `types.ts`. No public-surface change.
- `error_handling_strategy:` preserve existing error throws verbatim; `serializeError` keeps the same shape.
- `dependency_order:` first chunk for this target. No predecessor.
- `loc_budget:` `types.ts` ~120 LOC; barrel still > 1,500 after this chunk (Q1 is only foundation).
- **Module shape — public interface this chunk exposes (to other modules in the new tree):** `SimpleQueue` class, `EXECUTION_QUEUE_NAME`, `WORKFLOW_RESUME_QUEUE`, `LOCK_ID_CLEANUP_FILES`, `LOCK_ID_CLEANUP_RESERVATIONS`, `serializeError(err)`, `withAdvisoryLock(lockId, fn)`. None of these are re-exported from the barrel because none are in the locked public surface.
- **What stays hidden behind it:** the SimpleQueue's `processing` boolean, the internal queue array, `processNext()` recursion shape.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk Q2 — Backend + executionProcessor extraction

- `chunk_name:` `queue-backend-processor`
- `spec_sections:` §1, §6.4 (queueService seams)
- `files_modified:` create `server/services/queueService/backend.ts`, `server/services/queueService/executionProcessor.ts`; modify `server/services/queueService.ts` to import from them
- `files_deleted:` none
- `contract:` `getQueueBackend()` and `queueWorkerReady` module state move to `backend.ts`. `processExecution()` moves to `executionProcessor.ts`. The single `boss.work(EXECUTION_QUEUE_NAME, ...)` registration that lives inside `getQueueBackend()` stays there (it is local to that function, not a top-level call). The execution-processor module references `processExecution` from the orchestrator via direct import; no circular shape because `backend.ts` imports `executionProcessor.ts`, not vice versa. The `simpleQueue` instance is constructed in `backend.ts` (it is only consumed inside `getQueueBackend()`'s in-memory path).
- `error_handling_strategy:` preserve `isNonRetryable` / `isTimeoutError` / `getRetryCount` import paths and call semantics. Preserve all `await db.update(...).where(...)` writes byte-for-byte.
- `dependency_order:` Q1
- `loc_budget:` `backend.ts` ~180 LOC; `executionProcessor.ts` ~280 LOC.
- **Module shape — public interface:** `getQueueBackend(): Promise<{ enqueue, kind, send? }>`; `processExecution(executionId: string): Promise<void>`.
- **What stays hidden:** the type narrowing of the `kind: 'pg-boss' | 'in-memory'` discriminated union; the retry-loop control flow (`while (retryCount <= maxRetries)`); per-attempt `fetch(...)` + HMAC signing; `subaccountId`-gated `emitSubaccountUpdate` semantics; the email-on-completion try/catch.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk Q3 — Enqueue helpers + migration adapter + interval fallback

- `chunk_name:` `queue-enqueue-and-interval-fallback`
- `spec_sections:` §6.4 (queueService seams), §6.2 directory layout
- `files_modified:` create `server/services/queueService/enqueueHelpers.ts`, `server/services/queueService/migrationAdapter.ts`, `server/services/queueService/maintenanceJobs/intervalFallback.ts`; modify the barrel to import the helpers (the `queueService` object literal still lives in the barrel at this point and references the moved helpers by function reference)
- `files_deleted:` none
- `contract:` `enqueueExecution`, `sendJob`, `enqueueWorkflowResume`, `enqueueRegressionCapture`, `cleanupExpiredExecutionFiles`, `cleanupExpiredComputeReservations` become module-level async functions in `enqueueHelpers.ts`. The barrel's `queueService` object literal binds these methods to the module-level functions (i.e., `enqueueExecution: enqueueExecutionFn,`). The function signatures stay identical. `resolveMigrationAdapter` moves to `migrationAdapter.ts`. The setInterval block at lines 1605-1665 of source moves to `intervalFallback.ts` as `startIntervalFallback()`.
- `error_handling_strategy:` preserve all existing fire-and-forget `.catch(err => console.error(...))` shapes verbatim. The `enqueueRegressionCapture` triple-layer try/catch (outer + dynamic-import + inline fallback) is preserved.
- `dependency_order:` Q2
- `loc_budget:` `enqueueHelpers.ts` ~180 LOC; `migrationAdapter.ts` ~30 LOC; `intervalFallback.ts` ~120 LOC.
- **Module shape — public interface:** named async functions (one per helper); `startIntervalFallback(): void` from `intervalFallback.ts`.
- **What stays hidden:** the pg-boss vs in-memory branching inside `enqueueWorkflowResume` / `enqueueRegressionCapture`; the `withAdvisoryLock`-wrapped interval scheduling.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk Q4 — pg-boss registrations bulk move

- `chunk_name:` `queue-pgboss-registrations`
- `spec_sections:` §6.4 (queueService seams), §6.2 directory layout
- `files_modified:` create `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts`, `server/services/queueService/maintenanceJobs/start.ts`; rewrite the barrel's `startMaintenanceJobs` method body to call `start.ts`'s `runStartMaintenanceJobs()`
- `files_deleted:` none
- `contract:` every `await (boss as any).work(name, opts, handler)` call inside the pg-boss branch (lines ~559-1601 of source) moves to `pgBossRegistrations.ts` as `async function registerAllPgBossWorkers(boss, queueService, withAdvisoryLock)`. `start.ts` exports `runStartMaintenanceJobs(queueService)` which: (a) calls `getQueueBackend`, (b) calls `setSystemWorkerContext(true)` when pg-boss is the backend, (c) dispatches to `registerAllPgBossWorkers` OR `startIntervalFallback`, (d) emits the `maintenance:started` log. The `queueService` arg is passed because some of the worker handlers (e.g. cleanup-execution-files, cleanup-budget-reservations) re-enter `queueService.cleanupExpiredExecutionFiles()` / `queueService.cleanupExpiredComputeReservations()` — these calls stay intact, but they now resolve through the live barrel object instead of a self-reference.
- `error_handling_strategy:` every `try { ... } catch (err) { if (isTimeoutError(err)) logger.error(...); throw err; }` block inside each registration is preserved byte-for-byte. The `await boss.send('memory-blocks-embedding-backfill', {}, {singletonKey: ...})` enqueue-once shape is preserved at the exact line position relative to its registration (no re-ordering).
- `dependency_order:` Q3
- `loc_budget:` `pgBossRegistrations.ts` ~750 LOC; `start.ts` ~80 LOC.
- **Module shape — public interface:** `registerAllPgBossWorkers(boss, queueService, withAdvisoryLock): Promise<void>`; `runStartMaintenanceJobs(queueService): Promise<void>`.
- **What stays hidden:** the 50+ individual `boss.work(...)` invocations; the singletonKey-driven enqueue-once for the embedding backfill; the `boss.schedule(...)` cron-wiring for sandbox + correction-pattern jobs.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.
- **Caveat — module-load side effects.** None of the boss.work registrations runs at module load today; they only run when `queueService.startMaintenanceJobs()` is called (from `server/index.ts` at server start). The split preserves this — `pgBossRegistrations.ts` only executes its registrations when `registerAllPgBossWorkers(...)` is called.

##### Chunk Q5 — Thin the barrel

- `chunk_name:` `queue-barrel-thin`
- `spec_sections:` §2 (barrel < 250 LOC), §5 (queueService row), §7 (acceptance criteria 1, 9)
- `files_modified:` `server/services/queueService.ts` becomes a thin re-export skeleton
- `files_deleted:` none
- `contract:` final barrel shape:
  - imports the seven module-level helpers from `enqueueHelpers.ts` + `start.ts`
  - exports a single `queueService` const that binds each method to the imported function (e.g., `enqueueExecution: enqueueExecutionFn,`)
  - no other exports; no internal logic in the barrel beyond the assembly
- `error_handling_strategy:` no behaviour change; the barrel is purely structural.
- `dependency_order:` Q4
- `loc_budget:` barrel ~140 LOC after thinning (under the 250-LOC barrel cap from spec §2).
- **Module shape — public interface:** `export const queueService = { enqueueExecution, sendJob, cleanupExpiredExecutionFiles, cleanupExpiredComputeReservations, enqueueWorkflowResume, enqueueRegressionCapture, startMaintenanceJobs };` — identical to today's surface.
- **What stays hidden:** all the helpers, the maintenance-jobs registry, the execution processor, the migration adapter — every implementation file lives under `queueService/`.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

### Target 2 — `server/services/agentService.ts` (2,335 LOC)

Split by operation cluster: agent CRUD, agent data-sources, scheduled-task data-sources, full-agent assembly + patch operations, helper utilities. Pattern reference: spec §6.4 — "Split by operation cluster: CRUD, roster management, permissions, role assignment, validation."

The actual source has no "permissions" or "role assignment" cluster (those live in `permissionService` / `subaccountAgentService`). The visible clusters in the source are: in-memory caches + scheduler class, external data-source fetchers, the `agentService` object literal methods (split into CRUD vs data-sources vs scheduled-task data-sources vs `getFull`-and-patches), and shared helpers.

#### Final directory shape

```
server/services/agentService.ts                   ← barrel (target < 250 LOC; budget 200)
server/services/agentService/
  types.ts                                        ← AgentPersonality, AgentRunPreview, AgentFull, DataSourceScope, LoadedDataSource, CacheEntry, GoogleDocsContent (~80 LOC budget)
  caches.ts                                       ← dataSourceCache Map, lastGoodContentCache Map, getCachedContent, setCachedContent (~50 LOC budget)
  scheduler.ts                                    ← DataSyncScheduler class, dataSyncScheduler instance, runProactiveSync helper (~80 LOC budget — bind point for proactive intervals)
  externalFetchers.ts                             ← extractGoogleDocId, extractGoogleDocText, ExternalDocSourceError, formatContent, ALERT_COOLDOWN_MS, alert-on-fail + clear-on-recover helpers, loadSourceContent (~430 LOC budget — the heavy fetch+decode path)
  dataSourceScope.ts                              ← fetchDataSourcesByScope, fetchAgentDataSources (~200 LOC budget)
  helpers.ts                                      ← makeSlug, plus the underscore-prefixed object methods _assertNotSystemManaged, _assertEtag (returned to the object via spread in the barrel) (~50 LOC budget)
  crud.ts                                         ← listAgents, listAllAgents, listOwnedByUser, getAgent, createAgent, updateAgent, activateAgent, deactivateAgent, deleteAgent (~620 LOC budget)
  agentDataSources.ts                             ← uploadDataSourceFile, addDataSource, updateDataSource, deleteDataSource, testDataSource, scheduleAllProactiveSources, getTree (~440 LOC budget)
  scheduledTaskDataSources.ts                     ← _getScheduledTaskOrThrow, listScheduledTaskDataSources, addScheduledTaskDataSource, updateScheduledTaskDataSource, deleteScheduledTaskDataSource, testScheduledTaskDataSource, uploadScheduledTaskDataSourceFile (~480 LOC budget)
  agentFullView.ts                                ← getFull, patchConfigure, patchBehaviour, patchPersonality, replaceSkills, replaceDataSources, replaceTriggers, patchBudget (~530 LOC budget)
```

All files are under the 1,500 LOC soft cap. Largest cohort (`crud.ts` at ~620 LOC) is the agent CRUD cluster and is not further sub-split because the methods share helpers in tight rotation (etag computation, hierarchy validation, audit row writes); splitting would force re-export hopping for the next reader.

#### Chunks

##### Chunk A1 — Scaffold + types + caches + scheduler

- `chunk_name:` `agent-scaffold-foundation`
- `spec_sections:` §1, §5 (agentService row), §6.2 directory layout
- `files_modified:` create `server/services/agentService/types.ts`, `caches.ts`, `scheduler.ts`; modify `server/services/agentService.ts` to import from them
- `files_deleted:` none
- `contract:` `AgentPersonality`, `AgentRunPreview`, `AgentFull`, `DataSourceScope`, `LoadedDataSource` move to `types.ts` (still exported from the barrel). `CacheEntry`, `GoogleDocsContent` are package-internal — defined in `types.ts` but not re-exported from the barrel. `dataSyncScheduler` instance + `DataSyncScheduler` class move to `scheduler.ts` (instance still barrel-exported). `getCachedContent`, `setCachedContent`, the two Maps move to `caches.ts`.
- `error_handling_strategy:` no behaviour change.
- `dependency_order:` first agentService chunk
- `loc_budget:` `types.ts` ~80; `caches.ts` ~50; `scheduler.ts` ~80.
- **Module shape — public interface (to other agentService/ modules):** the named types; `dataSourceCache` + `lastGoodContentCache` + cache get/set helpers; `dataSyncScheduler` + `runProactiveSync`.
- **What stays hidden:** the Map representation of the caches; the `DataSyncScheduler` private `timers` map; the schedule/cancel/activeCount internals.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk A2 — External fetchers + data-source scope helpers

- `chunk_name:` `agent-externalfetchers-scope`
- `spec_sections:` §6.4 (agentService seams)
- `files_modified:` create `server/services/agentService/externalFetchers.ts`, `server/services/agentService/dataSourceScope.ts`; modify the barrel to import + re-export `loadSourceContent`, `fetchDataSourcesByScope`, `fetchAgentDataSources` from the new files
- `files_deleted:` none
- `contract:` `loadSourceContent` (and its in-file private helpers `extractGoogleDocId`, `extractGoogleDocText`, `ExternalDocSourceError`, `formatContent`, `ALERT_COOLDOWN_MS`, the alert-cooldown + clear-on-recover paths, the `runProactiveSync` private helper hooked from the scheduler) all move to `externalFetchers.ts`. `fetchDataSourcesByScope`, `fetchAgentDataSources` move to `dataSourceScope.ts`. Public-surface exports (`loadSourceContent`, `fetchDataSourcesByScope`, `fetchAgentDataSources`) are re-exported from the barrel — caller imports do not change.
- `error_handling_strategy:` preserve every error throw, every alert-cooldown decision, every `if (!agent) return` guard.
- `dependency_order:` A1 (depends on `types.ts` + `caches.ts` + `scheduler.ts`)
- `loc_budget:` `externalFetchers.ts` ~430; `dataSourceScope.ts` ~200.
- **Module shape — public interface:** `loadSourceContent(source): Promise<string | null>`; `fetchDataSourcesByScope(scope): Promise<LoadedDataSource[]>`; `fetchAgentDataSources(agentId): Promise<LoadedDataSource[]>`.
- **What stays hidden:** Google Docs URL parsing, the JSON/text content-type branching, the S3 `transformToString` adapter, the 1-hour alert cooldown, all email recipient resolution.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk A3 — CRUD cluster

- `chunk_name:` `agent-crud`
- `spec_sections:` §6.4 (agentService seams)
- `files_modified:` create `server/services/agentService/crud.ts` and `server/services/agentService/helpers.ts`; modify the barrel `agentService` literal to assemble methods from `crud.ts` + `helpers.ts`
- `files_deleted:` none
- `contract:` `listAgents`, `listAllAgents`, `listOwnedByUser`, `getAgent`, `createAgent`, `updateAgent`, `activateAgent`, `deactivateAgent`, `deleteAgent`, `makeSlug`, and the two underscore-prefixed `_assertNotSystemManaged` / `_assertEtag` methods extracted. The barrel still holds the `agentService` const but now binds these methods via `...crudMethods, ...assertionHelpers`. Function-shape preservation: the underscore-prefixed methods stay on the object literal so existing `agentService._assertNotSystemManaged(...)` callsites (lines 2330-2331 inside `patchBudget`) continue to compile.
- `error_handling_strategy:` preserve all etag-mismatch errors, all hierarchy-validation throws, all subaccount-link integrity guards.
- `dependency_order:` A2 (depends on types/caches/scheduler/external)
- `loc_budget:` `crud.ts` ~620; `helpers.ts` ~50.
- **Module shape — public interface:** ten named async functions matching the agentService method names, plus `assertNotSystemManaged` / `assertEtag` non-async helpers and `makeSlug`. The barrel rebinds these as `agentService.<methodName>` via spread.
- **What stays hidden:** the audit-trail row construction, the etag recomputation on each mutation, the `agent_prompt_revisions` row writes, the hierarchy-tree DFS used by `getTree` (which is in A4).
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk A4 — Agent data-sources cluster

- `chunk_name:` `agent-data-sources`
- `spec_sections:` §6.4 (agentService seams)
- `files_modified:` create `server/services/agentService/agentDataSources.ts`; modify the barrel to spread these methods into the `agentService` literal
- `files_deleted:` none
- `contract:` `uploadDataSourceFile`, `addDataSource`, `updateDataSource`, `deleteDataSource`, `testDataSource`, `scheduleAllProactiveSources`, `getTree` move out. `getTree` is in this file (not in CRUD) because it follows the data-source soft-coupled API path; the operator may prefer it under `crud.ts` — see Open question §1.
- `error_handling_strategy:` preserve all "data source not found / not owned by agent / connection error" throws verbatim.
- `dependency_order:` A3 (depends on barrel having scheduler + types + external)
- `loc_budget:` `agentDataSources.ts` ~440 LOC.
- **Module shape — public interface:** seven named async functions matching the agentService method names.
- **What stays hidden:** S3 upload bodies, content-type negotiation per source kind, the scheduler.schedule callback wiring, the alert email plumbing.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk A5 — Scheduled-task data-sources cluster

- `chunk_name:` `agent-scheduled-task-data-sources`
- `spec_sections:` §6.4 (agentService seams)
- `files_modified:` create `server/services/agentService/scheduledTaskDataSources.ts`; modify the barrel
- `files_deleted:` none
- `contract:` `_getScheduledTaskOrThrow`, `listScheduledTaskDataSources`, `addScheduledTaskDataSource`, `updateScheduledTaskDataSource`, `deleteScheduledTaskDataSource`, `testScheduledTaskDataSource`, `uploadScheduledTaskDataSourceFile` move out. The underscore-prefixed `_getScheduledTaskOrThrow` stays as a method on the agentService object via spread so existing `agentService._getScheduledTaskOrThrow(...)` callsites still compile.
- `error_handling_strategy:` preserve all 404 throws and `assertScopeSingle` enforcement.
- `dependency_order:` A4 (sibling cluster; A4 first because data-source kinds reuse it)
- `loc_budget:` `scheduledTaskDataSources.ts` ~480 LOC.
- **Module shape — public interface:** seven named async functions.
- **What stays hidden:** scheduledTask + scope assertion plumbing; S3 file handling for task-scoped uploads.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk A6 — Full view + patch operations

- `chunk_name:` `agent-full-view-and-patches`
- `spec_sections:` §6.4 (agentService seams)
- `files_modified:` create `server/services/agentService/agentFullView.ts`; modify the barrel
- `files_deleted:` none
- `contract:` `getFull`, `patchConfigure`, `patchBehaviour`, `patchPersonality`, `replaceSkills`, `replaceDataSources`, `replaceTriggers`, `patchBudget` move out. `getFull` is the largest method (~200 LOC) — it assembles the `AgentFull` shape by reading from agents, agent_prompt_revisions, the run summary view, and the budget projection.
- `error_handling_strategy:` preserve etag stamping at every patch path; preserve `_assertNotSystemManaged` gate on every mutation entry.
- `dependency_order:` A5
- `loc_budget:` `agentFullView.ts` ~530 LOC.
- **Module shape — public interface:** eight named async functions.
- **What stays hidden:** the AgentFull projection, the run-summary aggregation, the etag rotation algorithm, the deep `replaceSkills` / `replaceTriggers` set-membership diff (which uses `diffByIdentityKey`).
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk A7 — Thin the barrel

- `chunk_name:` `agent-barrel-thin`
- `spec_sections:` §2 (barrel < 250 LOC), §7 (acceptance criteria 1, 9)
- `files_modified:` `server/services/agentService.ts` becomes a thin re-export skeleton
- `files_deleted:` none
- `contract:` final barrel shape:
  - re-exports `AgentPersonality`, `AgentRunPreview`, `AgentFull`, `DataSourceScope`, `LoadedDataSource` (types) from `agentService/types.js`
  - re-exports `dataSyncScheduler` from `agentService/scheduler.js`
  - re-exports `loadSourceContent` from `agentService/externalFetchers.js`
  - re-exports `fetchDataSourcesByScope`, `fetchAgentDataSources` from `agentService/dataSourceScope.js`
  - exports `agentService` object literal assembled via spread from `crud.js`, `agentDataSources.js`, `scheduledTaskDataSources.js`, `agentFullView.js`, `helpers.js`
- `error_handling_strategy:` no behaviour change; structural-only.
- `dependency_order:` A6
- `loc_budget:` barrel ~200 LOC.
- **Module shape — public interface:** identical to today's surface table.
- **What stays hidden:** every implementation file under `agentService/`.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

### Target 3 — `server/services/workspaceMemoryService.ts` (1,949 LOC)

Split by lifecycle phase (per spec §6.4 — "write, read/search, retention/eviction, embedding cache"). The source has six visible phases delimited by `// ---` section markers, plus a top-of-file types/limits cluster and a bottom-of-file enrichment-job worker.

#### Final directory shape

```
server/services/workspaceMemoryService.ts         ← barrel (target < 250 LOC; budget 160)
server/services/workspaceMemoryService/
  types.ts                                        ← ExtractRunInsightsOptions, internal types (DOMAIN_KEYWORDS, TOPIC_KEYWORDS, HybridResult, etc.), agentRoleToDomain helper (~180 LOC budget — includes the keyword-domain classifier)
  hydeCache.ts                                    ← HyDE cache LRU + TTL state, scope-aware helpers, classifyQueryIntent integration (~120 LOC budget)
  hybridRetrieval.ts                              ← The RRF hybrid retrieval pipeline (lines 170-507 of source — semantic + lexical + rerank) (~360 LOC budget)
  graphExpansion.ts                               ← Phase 1C graph-aware context expansion (lines 509-558 of source) + helper expandWithGraph (~70 LOC budget)
  quality.ts                                      ← Quality scoring (lines 566-595 of source) + minimum-content thresholds (~40 LOC budget)
  read.ts                                         ← Methods getMemory, getOrCreateMemory, listEntries, deleteEntry, updateSummary, updateQualityThreshold (~150 LOC budget)
  extract.ts                                      ← extractRunInsights (~225 LOC budget — the LLM-driven extraction phase; consumes routeCall from the external llmRouter barrel)
  retrieve.ts                                     ← getRelevantMemories, semanticSearchMemories, getMemoryEntry, getMemoryForPrompt, getMemoryForPromptWithTracking, getBoardSummaryForPrompt (~410 LOC budget)
  entities.ts                                     ← extractEntities, getEntitiesForPrompt (~250 LOC budget)
  dedup.ts                                        ← Mem0 dedup helpers (lines 1604-1705 of source) (~100 LOC budget)
  decayAndEmbedding.ts                            ← pruneStaleMemoryEntries, embedding invalidation helpers, reembedEntry, getStaleEmbeddingsBatch, recomputeStaleEmbeddings, inFlightReembeds Set (~280 LOC budget)
  enrichmentJob.ts                                ← processContextEnrichment + the pgBossSendCallback module state + setContextEnrichmentJobSender setter (~120 LOC budget)
  regenerateSummary.ts                            ← regenerateSummary (consumes the dedup + LLM) (~110 LOC budget)
```

All files are under 1,500 LOC. Largest cohort (`retrieve.ts` at ~410 LOC) is read-side memory retrieval; sub-splitting forces helper-import hopping that doesn't earn its keep.

#### Chunks

##### Chunk W1 — Scaffold + types + quality + hyde cache

- `chunk_name:` `workspace-memory-scaffold`
- `spec_sections:` §1, §5 (workspaceMemoryService row), §6.2, §6.4 (lifecycle-phase decomposition)
- `files_modified:` create `server/services/workspaceMemoryService/types.ts`, `hydeCache.ts`, `quality.ts`
- `files_deleted:` none
- `contract:` `ExtractRunInsightsOptions` (exported, re-export from barrel), `agentRoleToDomain` (exported, re-export from barrel), `DOMAIN_KEYWORDS`, `TOPIC_KEYWORDS`, internal helper types (`HybridResult`, etc.) move to `types.ts`. HyDE cache state + helpers move to `hydeCache.ts`. Quality scoring moves to `quality.ts`.
- `error_handling_strategy:` no behaviour change.
- `dependency_order:` first workspace chunk
- `loc_budget:` `types.ts` ~180; `hydeCache.ts` ~120; `quality.ts` ~40.
- **Module shape — public interface:** named types + `agentRoleToDomain(role): string | null` + HyDE cache get/set + quality scorer.
- **What stays hidden:** HyDE Map size + LRU eviction; keyword-domain coverage; the cache TTL.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk W2 — Hybrid retrieval + graph expansion + read

- `chunk_name:` `workspace-memory-retrieval-core`
- `spec_sections:` §6.4 (lifecycle-phase decomposition)
- `files_modified:` create `server/services/workspaceMemoryService/hybridRetrieval.ts`, `graphExpansion.ts`, `read.ts`
- `files_deleted:` none
- `contract:` the RRF pipeline (semantic search via `generateEmbedding` + `formatVectorLiteral`, lexical search via `sanitizeSearchQuery`, optional rerank, dominance-gated expansion, recency boost) moves to `hybridRetrieval.ts`. The graph-expansion helper moves to `graphExpansion.ts`. `getMemory`, `getOrCreateMemory`, `listEntries`, `deleteEntry`, `updateSummary`, `updateQualityThreshold` move to `read.ts`.
- `error_handling_strategy:` preserve `assertScopeSingle` semantics, all empty-result early returns, all reranker-budget guards.
- `dependency_order:` W1
- `loc_budget:` `hybridRetrieval.ts` ~360; `graphExpansion.ts` ~70; `read.ts` ~150.
- **Module shape — public interface:** `hybridRetrieve(params): Promise<HybridResult[]>`; `expandWithGraph(results, scopeFilter, maxExpansion): Promise<HybridResult[]>`; six named read methods.
- **What stays hidden:** RRF scoring math, the reranker-call budget, the recency-window day cutoff, the `assertScope` shape of the inner-join filter.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk W3 — Extract + retrieve + entities

- `chunk_name:` `workspace-memory-extract-retrieve-entities`
- `spec_sections:` §6.4 (lifecycle-phase decomposition)
- `files_modified:` create `server/services/workspaceMemoryService/extract.ts`, `retrieve.ts`, `entities.ts`
- `files_deleted:` none
- `contract:` `extractRunInsights` (the LLM call to Sonnet that derives memory entries from a run summary — depends on `routeCall` from `../llmRouter.js`) moves to `extract.ts`. `getRelevantMemories`, `semanticSearchMemories`, `getMemoryEntry`, `getMemoryForPrompt`, `getMemoryForPromptWithTracking`, `getBoardSummaryForPrompt` move to `retrieve.ts`. `extractEntities`, `getEntitiesForPrompt` move to `entities.ts`.
- `error_handling_strategy:` preserve `routeCall` failure paths (`ParseFailureError` surfaces back to the caller; budget-exceeded throws are not caught here); preserve all token-budget guards in `getMemoryForPrompt*`.
- `dependency_order:` W2
- `loc_budget:` `extract.ts` ~225; `retrieve.ts` ~410; `entities.ts` ~250.
- **Module shape — public interface:** named async methods bound to the `workspaceMemoryService` literal via spread.
- **What stays hidden:** the Sonnet system prompt, the JSON schema for extraction, the entity-confidence floor, the prompt-budget bucket selection.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk W4 — Dedup + decay + embedding lifecycle + enrichment + summary regenerate

- `chunk_name:` `workspace-memory-write-side`
- `spec_sections:` §6.4 (lifecycle-phase decomposition)
- `files_modified:` create `server/services/workspaceMemoryService/dedup.ts`, `decayAndEmbedding.ts`, `enrichmentJob.ts`, `regenerateSummary.ts`
- `files_deleted:` none
- `contract:` Mem0 dedup helpers move to `dedup.ts`. `pruneStaleMemoryEntries` (top-level export, re-exported from barrel), embedding invalidation helpers, `inFlightReembeds` Set state, `reembedEntry`, `getStaleEmbeddingsBatch`, `recomputeStaleEmbeddings` move to `decayAndEmbedding.ts`. `processContextEnrichment` (top-level export), `setContextEnrichmentJobSender` (top-level export), and the `pgBossSendCallback` module state move to `enrichmentJob.ts`. `regenerateSummary` (a method on the workspaceMemoryService object) moves to `regenerateSummary.ts`.
- `error_handling_strategy:` preserve every fire-and-forget `.catch(...)` in the embedding paths; preserve the inFlight-guard against duplicate re-embeds.
- `dependency_order:` W3
- `loc_budget:` `dedup.ts` ~100; `decayAndEmbedding.ts` ~280; `enrichmentJob.ts` ~120; `regenerateSummary.ts` ~110.
- **Module shape — public interface:** Each module's exports as named functions. The barrel re-exports `pruneStaleMemoryEntries`, `reembedEntry`, `getStaleEmbeddingsBatch`, `recomputeStaleEmbeddings`, `processContextEnrichment`, `setContextEnrichmentJobSender` (preserving the locked surface).
- **What stays hidden:** the cosine-similarity dedup threshold, the embedding-invalidation cascade, the pg-boss enrichment queue name, the regenerate-summary prompt.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk W5 — Thin the barrel

- `chunk_name:` `workspace-memory-barrel-thin`
- `spec_sections:` §2, §7 (acceptance criteria 1, 9)
- `files_modified:` `server/services/workspaceMemoryService.ts` becomes a thin re-export skeleton
- `files_deleted:` none
- `contract:` final barrel shape:
  - re-exports `ExtractRunInsightsOptions`, `agentRoleToDomain` from `workspaceMemoryService/types.js`
  - re-exports `setContextEnrichmentJobSender`, `processContextEnrichment` from `workspaceMemoryService/enrichmentJob.js`
  - re-exports `pruneStaleMemoryEntries`, `reembedEntry`, `getStaleEmbeddingsBatch`, `recomputeStaleEmbeddings` from `workspaceMemoryService/decayAndEmbedding.js`
  - exports `workspaceMemoryService` object literal assembled via spread from `read.js`, `extract.js`, `retrieve.js`, `entities.js`, `regenerateSummary.js`
- `error_handling_strategy:` structural-only.
- `dependency_order:` W4
- `loc_budget:` barrel ~160 LOC.
- **Module shape — public interface:** identical to today's surface table.
- **What stays hidden:** every implementation file under `workspaceMemoryService/`.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

### Target 4 — `server/services/llmRouter.ts` (1,918 LOC)

Split by routing concern: type schema + idempotency, billing + cooldown helpers, fallback model map, IEE run-id resolver, the main `routeCall` function, the aggregate-update enqueuer, the re-exports.

The 1,600-LOC `routeCall` function holds 16 numbered phases (`// ── 1. Validate context`, …, `// ── 16. Attach routing metadata`) plus a finally-block safety net. Spec §6.4 suggests "model selection, cost guard, retry, fallback, observability" as separate concerns; in this source they are entangled inside `routeCall` because the retry loop spans phases 5-8 and the cost-guard reservation spans phases 5-14. Splitting them apart would force a context-object threading refactor that exceeds the spec's "preserve behaviour exactly" boundary. Instead the plan keeps `routeCall` as a single function in one sub-module, and lifts the surrounding helpers into peers.

#### Final directory shape

```
server/services/llmRouter.ts                      ← barrel (target < 250 LOC; budget 130)
server/services/llmRouter/
  types.ts                                        ← LLMCallContext + LLMCallContextSchema (zod), RouterCallParams, SystemCallerPolicy, FallbackAttempt internal type (~140 LOC budget)
  billing.ts                                      ← getBillingPeriods helper, billingMonth/billingDay computation (~30 LOC budget)
  cooldown.ts                                     ← providerCooldowns Map + isProviderCoolingDown + setProviderCooldown helper (~40 LOC budget)
  fallbackMap.ts                                  ← FALLBACK_MODEL_MAP constant + isNonRetryableError predicate (~60 LOC budget)
  ieeResolver.ts                                  ← resolveRunIdFromIee helper (~30 LOC budget)
  aggregateEnqueue.ts                             ← enqueueAggregateUpdate (with the dynamic-import fallback to routerJobService + costAggregateService) (~40 LOC budget)
  routeCall.ts                                    ← The 1,600-LOC routeCall function — extracted whole; phases stay as numbered comments inside the function body (~1,420 LOC budget — under the cap)
```

`routeCall.ts` at ~1,420 LOC is under the 1,500 LOC soft cap with ~80 LOC of headroom. If a future addition pushes it over, the natural next-split point is to extract phases 8 (provider retry-fallback loop, ~700 LOC) and 12 (ledger write, ~340 LOC) into peer files, threading a router-context object. That follow-up is deferred (`SOFTCAP-PURE-llmRouter-1`); it requires changing the function signature shape and so falls outside this build.

#### Chunks

##### Chunk L1 — Scaffold + types + billing/cooldown/fallback/iee helpers

- `chunk_name:` `llmrouter-scaffold-helpers`
- `spec_sections:` §1, §5 (llmRouter row), §6.2, §6.4 (llmRouter seams)
- `files_modified:` create `server/services/llmRouter/types.ts`, `billing.ts`, `cooldown.ts`, `fallbackMap.ts`, `ieeResolver.ts`
- `files_deleted:` none
- `contract:` `LLMCallContextSchema` + `LLMCallContext` type alias (public-re-exported from barrel) + `RouterCallParams` interface (public-re-exported) + `SystemCallerPolicy` + `FallbackAttempt` move to `types.ts`. `getBillingPeriods` moves to `billing.ts`. `providerCooldowns` Map + `isProviderCoolingDown` move to `cooldown.ts`. `FALLBACK_MODEL_MAP` + `isNonRetryableError` move to `fallbackMap.ts`. `resolveRunIdFromIee` moves to `ieeResolver.ts`.
- `error_handling_strategy:` preserve all `RouterContractError` throws verbatim; preserve provider cooldown semantics (set on retry-failed call sites).
- `dependency_order:` first llmRouter chunk
- `loc_budget:` `types.ts` ~140; `billing.ts` ~30; `cooldown.ts` ~40; `fallbackMap.ts` ~60; `ieeResolver.ts` ~30.
- **Module shape — public interface (to other llmRouter/ modules):** zod schema, types, `getBillingPeriods()`, `isProviderCoolingDown(provider)`, `setProviderCooldown(provider, ms)` (extracted from the cooldown writes inside routeCall, called by routeCall.ts), `FALLBACK_MODEL_MAP`, `isNonRetryableError(err)`, `resolveRunIdFromIee(ieeRunId)`.
- **What stays hidden:** the Map representation; the cooldown clock; the fallback-chain encoding.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk L2 — Aggregate-update enqueuer

- `chunk_name:` `llmrouter-aggregate-enqueue`
- `spec_sections:` §6.4 (llmRouter seams)
- `files_modified:` create `server/services/llmRouter/aggregateEnqueue.ts`
- `files_deleted:` none
- `contract:` `enqueueAggregateUpdate(idempotencyKey)` moves out. Its dynamic-import fallback (`./routerJobService.js` first, then `./costAggregateService.js` if the queue is unavailable) is preserved verbatim — the file path strings are relative-to-services, NOT relative-to-llmRouter, so they become `'../routerJobService.js'` and `'../costAggregateService.js'` inside the new file.
- `error_handling_strategy:` preserve the try/catch around `routerJobService` import (catches module-load failures + queue-unavailable + falls through to synchronous in-process `upsertAggregates` call).
- `dependency_order:` L1
- `loc_budget:` `aggregateEnqueue.ts` ~40 LOC.
- **Module shape — public interface:** `enqueueAggregateUpdate(idempotencyKey: string): Promise<void>`.
- **What stays hidden:** the synchronous fallback path; the dynamic-import resolution.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk L3 — Extract routeCall

- `chunk_name:` `llmrouter-routecall`
- `spec_sections:` §6.4 (llmRouter seams), §6.2
- `files_modified:` create `server/services/llmRouter/routeCall.ts`; modify the barrel to re-export from the new file
- `files_deleted:` none
- `contract:` `routeCall(params)` moves to `routeCall.ts` whole. Phase numbering stays as in-function comments (1-16 + finally-block safety net). Imports in `routeCall.ts` are adjusted: all the cross-cutting helpers move to relative imports from `./billing.js`, `./cooldown.js`, `./fallbackMap.js`, `./ieeResolver.js`, `./aggregateEnqueue.js`. External imports (`db`, schema tables, `pricingService`, `computeBudgetService`, `resolveLLM`, `getProviderAdapter`, `inflightRegistry`, `llmInflightPayloadStore`, `tryEmitAgentEvent`, `emitAgentEvent`, `buildPayloadRow`, etc.) stay on absolute-from-services paths.
- `error_handling_strategy:` preserve the entire 1,600-LOC function body byte-for-byte. The retry-fallback loop, the provisional-ledger row create/update sequence, the parse-failure handling, the AbortSignal threading, the LAEL pairing-completeness safety net in the finally block — all preserved exactly.
- `dependency_order:` L2
- `loc_budget:` `routeCall.ts` ~1,420 LOC; the barrel still > 200 LOC after this chunk (final thinning happens in L4).
- **Module shape — public interface:** `routeCall(params: RouterCallParams): Promise<ProviderResponse>`. Locked public surface — every external caller continues to import this from `server/services/llmRouter.js` (the barrel).
- **What stays hidden:** every one of the 16 numbered phases; the 16-step state machine inside the function; the LAEL emission state booleans (`laelRequestEmitted` / `laelCompletedEmitted` / `terminalStatus` / `provisionalLedgerRowId`); the abort-signal early-return; the started-row idempotency upsert; the parse-failure raw-excerpt logic.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk L4 — Thin the barrel

- `chunk_name:` `llmrouter-barrel-thin`
- `spec_sections:` §2, §7 (acceptance criteria 1, 9)
- `files_modified:` `server/services/llmRouter.ts` becomes a thin re-export skeleton
- `files_deleted:` none
- `contract:` final barrel shape:
  - re-exports `shouldEmitLaelLifecycle` from `./llmRouterLaelPure.js` (untouched — pre-existing Pure sibling)
  - re-exports `LLMCallContext`, `RouterCallParams` (types) from `./llmRouter/types.js`
  - re-exports `ProviderTimeoutError`, `callWithTimeout` from `./llmRouterTimeoutPure.js` (untouched — pre-existing Pure sibling)
  - re-exports `routeCall` from `./llmRouter/routeCall.js`
  - re-exports `TaskType`, `SourceType`, `ExecutionPhase`, `RoutingMode` (types) from `../db/schema/index.js` (preserving the type-re-export semantics)
  - re-exports `TASK_TYPES`, `SOURCE_TYPES`, `EXECUTION_PHASES`, `ROUTING_MODES` from `../db/schema/index.js`
  - re-exports `countTokens`, `SUPPORTED_MODEL_FAMILIES` from `./providers/anthropicAdapter.js`
  - re-exports `SupportedModelFamily` (type) from `./providers/anthropicAdapter.js`
- `error_handling_strategy:` structural-only.
- `dependency_order:` L3
- `loc_budget:` barrel ~130 LOC.
- **Module shape — public interface:** identical to today's surface table.
- **What stays hidden:** every implementation file under `llmRouter/`.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

### Target 5 — `server/jobs/skillAnalyzerJob.ts` (2,254 LOC)

Split by pipeline stage. The source has the cleanest stage decomposition of all 5 targets — explicit numbered comments (`Stage 1: Parse`, …, `Stage 8b: Agent cluster recommendation (Sonnet)`). The single public export `processSkillAnalyzerJob(jobId)` becomes a thin orchestrator that calls each stage in order, threading a shared `JobContext` object.

Per spec §6.1, this target falls under the Area 10 jobs extension of `verify-loc-cap.sh` (jobs can exceed 1,500 if mechanically required by the pipeline shape). The split aims to bring all new files comfortably under 1,500 anyway.

#### Final directory shape

```
server/jobs/skillAnalyzerJob.ts                   ← barrel (target < 250 LOC; budget 100)
server/jobs/skillAnalyzerJob/
  types.ts                                        ← JobContext interface (the threaded state — candidates, libraryById, libraryByName, embeddingByContent, resultRows, validationThresholds, classifiedDistinct map, …), helper types (~140 LOC budget)
  helpers.ts                                      ← getPLimit, consolidationWordCount, BATCH_SIZE constant, any small in-file pure helpers (~40 LOC budget)
  stage1Parse.ts                                  ← Stage 1 (lines 121-189 of source) — parse from sourceType (paste/upload/github/download), parsedCandidates handling (~110 LOC budget)
  stage2Hash.ts                                   ← Stage 2 (lines 192-296) — content hashing, exact-duplicate detection (~120 LOC budget)
  stage3Embed.ts                                  ← Stage 3 (lines 298-391) — embedding generation in BATCH_SIZE-100 chunks (~120 LOC budget)
  stage4Compare.ts                                ← Stage 4 (lines 392-469) — cosine comparison + nearest-neighbour ranking (~110 LOC budget)
  stage4bNonSkillDetect.ts                        ← Stage 4b (lines 471-498) — heuristic pre-classification of non-skills (~50 LOC budget)
  stage5Classify.ts                               ← Stage 5 (lines 499-1650) — Sonnet classification + per-slug skip on resume + library-collision detection + storedMerge hydration (~1,200 LOC budget — the largest stage)
  stage5bCrossBatchCollision.ts                   ← Stage 5b (lines 1651-1720) — v3 Fix 3 cross-batch detection (~90 LOC budget)
  stage5cSourceFork.ts                            ← Stage 5c (lines 1721-1800) — v4 Fix 3 + Fix 8 detection (~100 LOC budget)
  stage6AgentEmbed.ts                             ← Stage 6 (lines 1801-1816) — agent-skill embed for downstream agent-propose (~30 LOC budget)
  stage7AgentPropose.ts                           ← Stage 7 (lines 1817-1886) — cosine agent-propose (~90 LOC budget)
  stage7bAgentSuggest.ts                          ← Stage 7b (lines 1975-2164) — Haiku LLM enrichment of agent proposals (~210 LOC budget)
  stage8WriteResults.ts                           ← Stage 8 (lines 1887-1974) — finalise resultRows write to skill_analyzer_results (~110 LOC budget)
  stage8bClusterRecommend.ts                      ← Stage 8b (lines 2165-2253) — Sonnet cluster recommendation per agent (~110 LOC budget)
  orchestrator.ts                                 ← processSkillAnalyzerJob entry function — loads the job, builds the JobContext, calls each stage in source order (~100 LOC budget)
```

Largest file (`stage5Classify.ts` at ~1,200 LOC) is under the 1,500 LOC soft cap. The Stage 5 cohort genuinely is one piece: the per-candidate loop, the per-slug skip-on-resume guard, the storedMerge hydration, the library-collision detection, and the cross-reference batch — they all share state across iterations and a smaller split would force tight cross-imports. If a future audit demands further sub-split, candidates are: hoist the Sonnet prompt builder into `stage5.classifierPrompt.ts`, hoist the storedMerge hydration into `stage5.storedMergeHydrate.ts`, hoist the library-collision detector into `stage5.libraryCollisionGuard.ts`. Deferred (`SOFTCAP-PURE-skillAnalyzerJob-1`).

#### Chunks

##### Chunk S1 — Scaffold + types + helpers

- `chunk_name:` `skillanalyzer-scaffold`
- `spec_sections:` §1, §5 (skillAnalyzerJob row), §6.2
- `files_modified:` create `server/jobs/skillAnalyzerJob/types.ts`, `helpers.ts`
- `files_deleted:` none
- `contract:` `JobContext` (the threaded state shape — candidates, libraryById, libraryByName, embeddingByContent, resultRows, validationThresholds, classifiedDistinct, distinctResults, exactDuplicates, hashFromCandidateContent — i.e. every named local in the current `processSkillAnalyzerJob` body) defined as an exported interface in `types.ts`. `getPLimit`, `consolidationWordCount`, `BATCH_SIZE` move to `helpers.ts`. A `JobAlreadyFailedAbort` private sentinel class is also defined in `types.ts` (see Open question §3).
- `error_handling_strategy:` no behaviour change.
- `dependency_order:` first skillAnalyzerJob chunk
- `loc_budget:` `types.ts` ~140; `helpers.ts` ~40.
- **Module shape — public interface:** `JobContext` interface; helper functions; `JobAlreadyFailedAbort` sentinel.
- **What stays hidden:** p-limit instantiation; the hardcoded batch size.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk S2 — Stages 1-4b (parse → hash → embed → compare → non-skill detect)

- `chunk_name:` `skillanalyzer-stages-1-to-4b`
- `spec_sections:` §6.4 (skillAnalyzerJob seams), §6.2
- `files_modified:` create `server/jobs/skillAnalyzerJob/stage1Parse.ts`, `stage2Hash.ts`, `stage3Embed.ts`, `stage4Compare.ts`, `stage4bNonSkillDetect.ts`; the barrel still hosts `processSkillAnalyzerJob` and calls these stages by import
- `files_deleted:` none
- `contract:` each stage exports an async function taking the `JobContext` (and any necessary external deps not on the context, like the job row + jobId) and returning a (possibly-updated) `JobContext`. The function signature is `runStageN(ctx: JobContext): Promise<JobContext>`. Stage 1 has the additional `job` argument because it sets `ctx.candidates` from the job's sourceType. Each stage's existing `updateJobProgress(...)` calls stay inline.
- `error_handling_strategy:` preserve every `await updateJobProgress(jobId, { status: 'failed', errorMessage: ... })` + `return` early-exit shape. The orchestrator becomes responsible for the early-exit detection — each stage throws a `JobAlreadyFailedAbort` private sentinel (defined in `types.ts`) when it sets the job to failed and wants to abort. The orchestrator's outer try/catch swallows the sentinel and returns normally. Operator may prefer the null-return shape — see Open question §3.
- `dependency_order:` S1
- `loc_budget:` stage1 ~110; stage2 ~120; stage3 ~120; stage4 ~110; stage4b ~50.
- **Module shape — public interface:** five named async functions, each `runStageN(ctx, job?): Promise<JobContext>`.
- **What stays hidden:** the OpenAI embedding batch loop, the cosine-comparison math, the per-candidate hashing.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk S3 — Stage 5 (classify) + Stage 5b + Stage 5c

- `chunk_name:` `skillanalyzer-stage-5`
- `spec_sections:` §6.4 (skillAnalyzerJob seams)
- `files_modified:` create `server/jobs/skillAnalyzerJob/stage5Classify.ts`, `stage5bCrossBatchCollision.ts`, `stage5cSourceFork.ts`
- `files_deleted:` none
- `contract:` Stage 5 (~1,200 LOC) extracts the per-candidate classification loop including: per-slug `listResultIndicesForJob` skip-on-resume guard, `markSkillInFlight` + `unmarkSkillInFlight` lifecycle, the Sonnet `routeCall` invocation with the classification prompt, the storedMerge hydration that re-loads prior partial results on resume, the library-collision detection, the consolidation prompt + parse + writes via `insertSingleResult`. Stage 5b extracts the cross-batch collision detection (v3 Fix 3). Stage 5c extracts the source-fork detection + content-overlap detection (v4 Fix 3 + Fix 8).
- `error_handling_strategy:` every existing fail-mode is preserved verbatim: `ParseFailureError` from `routeCall` becomes a per-skill failure that writes a `buildClassifierFailureOutcome` row; LLM timeout is caught and recorded as a failed-classifier outcome; library-collision warnings are appended via `appendBatchCollisionWarnings`; Stage 5b's atomic batch deduction stays in `applyBatchDeductionAndWarningAtomic`.
- `dependency_order:` S2
- `loc_budget:` stage5 ~1,200; stage5b ~90; stage5c ~100.
- **Module shape — public interface:** `runStage5(ctx): Promise<JobContext>`, `runStage5b(ctx): Promise<JobContext>`, `runStage5c(ctx): Promise<JobContext>`.
- **What stays hidden:** the per-candidate concurrency limit, the storedMerge hydration shape, the Sonnet classifier prompt, the consolidation parser, the library-collision rules, the cross-batch dedup math.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk S4 — Stages 6-8b (agent-embed → agent-propose → write → agent-suggest → cluster-recommend)

- `chunk_name:` `skillanalyzer-stages-6-to-8b`
- `spec_sections:` §6.4 (skillAnalyzerJob seams)
- `files_modified:` create `server/jobs/skillAnalyzerJob/stage6AgentEmbed.ts`, `stage7AgentPropose.ts`, `stage7bAgentSuggest.ts`, `stage8WriteResults.ts`, `stage8bClusterRecommend.ts`
- `files_deleted:` none
- `contract:` stages 6-8b extract per their source-comment boundaries. Stage 7 reads candidate embeddings + agent embeddings and applies cosine + role bonus to produce proposals. Stage 7b uses Haiku via `routeCall` to enrich proposals; the per-skill heartbeat updates stay inline. Stage 8 finalises `resultRows` (merging exactDuplicates from Stage 2 + distinct from Stage 4 + classified from Stage 5) and writes via `insertResults`. Stage 8b runs a Sonnet cluster recommendation per agent via `routeCall`.
- `error_handling_strategy:` preserve every "Stage 7b is best-effort — leaves llmConfirmed=false" path; preserve every `tryUpdateJobProgress` heartbeat.
- `dependency_order:` S3
- `loc_budget:` stage6 ~30; stage7 ~90; stage7b ~210; stage8 ~110; stage8b ~110.
- **Module shape — public interface:** five named async functions, each `runStageN(ctx): Promise<JobContext>`.
- **What stays hidden:** the agent-embedding generation, the cosine + role-bonus scoring, the Haiku enrichment prompt, the resultRows merge order, the Sonnet cluster prompt + JSON parse.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

##### Chunk S5 — Extract orchestrator + thin the barrel

- `chunk_name:` `skillanalyzer-orchestrator-and-barrel`
- `spec_sections:` §2, §7 (acceptance criteria 1, 9)
- `files_modified:` create `server/jobs/skillAnalyzerJob/orchestrator.ts`; rewrite `server/jobs/skillAnalyzerJob.ts` as a thin re-export
- `files_deleted:` none
- `contract:` `orchestrator.ts` exports `processSkillAnalyzerJob(jobId: string): Promise<void>`. The function body loads the job via `getJobById`, builds the initial `JobContext` from `configSnapshot` + `validationThresholds`, then invokes stages in source order (1 → 2 → 3 → 4 → 4b → 5 → 5b → 5c → 6 → 7 → 7b → 8 → 8b). Each stage call is `ctx = await runStageN(ctx);`. The orchestrator's try/catch wraps the whole pipeline and surfaces failures via `updateJobProgress(... status: 'failed' ...)` matching the existing top-of-function early-exit guards. The barrel becomes:
  ```ts
  export { processSkillAnalyzerJob } from './skillAnalyzerJob/orchestrator.js';
  ```
- `error_handling_strategy:` the `JobAlreadyFailedAbort` sentinel from Chunk S2 is caught at the orchestrator boundary; everything else propagates to pg-boss for retry.
- `dependency_order:` S4
- `loc_budget:` `orchestrator.ts` ~100; barrel ~100.
- **Module shape — public interface:** `processSkillAnalyzerJob(jobId: string): Promise<void>` re-exported from the barrel at the same path callers use today (`server/jobs/skillAnalyzerJob.js`).
- **What stays hidden:** the JobContext construction, the stage ordering, the abort sentinel.
- **Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Final chunk — Cross-target verification

- `chunk_name:` `wave2b-final-verification`
- `spec_sections:` §7 (every acceptance criterion)
- `files_modified:` none beyond docs (this chunk verifies; it does not refactor)
- `files_deleted:` none
- `contract:` after all 5 target mini-plans have landed and the barrels are thin, this chunk:
  1. Re-runs the caller sweep from Chunk 0 to confirm no caller imported a name from outside the locked surface (per spec §9). Command (allowed locally because it is grep, not a gate):
     ```bash
     for target in agentService workspaceMemoryService llmRouter queueService; do
       grep -rnE "from\s+['\"][^'\"]*${target}(\\.js)?['\"]" server/ client/ shared/ | grep -v "${target}/" | grep -v "tasks/" > /tmp/${target}-callers.txt
     done
     grep -rnE "from\s+['\"][^'\"]*skillAnalyzerJob(\\.js)?['\"]" server/ client/ shared/ | grep -v "tasks/" > /tmp/skillAnalyzerJob-callers.txt
     ```
     Verifies each callsite in the resulting files matches the Chunk-0 list. New entries are flagged.
  2. Confirms each barrel is < 250 LOC: `wc -l server/services/agentService.ts server/services/workspaceMemoryService.ts server/services/llmRouter.ts server/services/queueService.ts server/jobs/skillAnalyzerJob.ts`
  3. Confirms each new sub-module is < 1,500 LOC: `find server/services/{agentService,workspaceMemoryService,llmRouter,queueService} server/jobs/skillAnalyzerJob -name '*.ts' | xargs wc -l | sort -n | tail -20`
  4. Runs `npm run lint`, `npm run typecheck`, `npm run build:server` as a final sanity pass. (Spec §7 criteria 3 + 4 explicitly call for `npm run build:server` and `npm run lint`.)
  5. Closes `tasks/todo.md` line 296 (Area 10 soft-cap register entry) and SA3 (skillAnalyzerJob god-file) with the merge commit hash per spec §7 criterion 10. The closing line takes shape `[status:closed:pr:<num>]`.
  6. Doc-sync — per `docs/doc-sync.md`: this batch does not change architecture, RLS contracts, or any documented behaviour. The only doc that needs an update is `architecture.md`'s "Key files per domain" index, IF any of the 5 targets is named there. Verify by `grep -n "agentService\.ts\|workspaceMemoryService\.ts\|llmRouter\.ts\|queueService\.ts\|skillAnalyzerJob\.ts" architecture.md` — if the file is named with a line-number marker that the split invalidates, update to point at the directory or remove the marker. If the file is named only as a logical reference, leave it.
- `error_handling_strategy:` if step 1, 2, or 3 fails, this chunk does NOT auto-correct — it surfaces the failure with file paths so the operator decides whether to back out the offending mini-chunk or amend the barrel. No silent edits.
- `dependency_order:` after all of Q5, A7, W5, L4, S5.
- `loc_budget:` no source files modified in this chunk; only docs touched (a one-line update to `architecture.md`'s index if needed).
- **Module shape — public interface:** none (verification-only).
- **What stays hidden:** none.
- **Verification commands:** `wc -l`, `find ... | xargs wc -l`, `grep`, `npm run lint`, `npm run typecheck`, `npm run build:server`. The spec-§7 verifier scripts (`verify-loc-cap.sh`, `verify-with-org-tx-or-scoped-db.sh`, `verify-canonical-retry.sh`, `verify-duplicate-blocks.sh`) run in CI and not locally per the Executor notes; their absence here is intentional.

---

## Risks and mitigations

### Risk 1 — llmRouter `routeCall` extraction breaks LAEL emission pairing

**Risk.** `routeCall` is 1,600 LOC with 16 sequential phases that share ~30 named locals (`provisionalLedgerRowId`, `laelRequestEmitted`, `laelCompletedEmitted`, `terminalStatus`, `idempotencyKey`, `actualModel`, `actualProvider`, `costResult`, `tokensIn`, `tokensOut`, `attemptNumber`, `reservationId`, etc.). The finally-block safety net at the bottom of the function (lines 1847-1881) depends on those locals being in scope. The plan extracts `routeCall` as ONE function into `routeCall.ts` rather than threading a context object across phase files. If a future builder splits the phases further to chase LOC headroom, the LAEL safety net will silently drop unless every phase rebinds the lifecycle flags.

**Mitigation.** Chunk L3 explicitly forbids sub-splitting `routeCall` within this build. The single-function extraction is byte-for-byte preserving. Future sub-splits are deferred to `SOFTCAP-PURE-llmRouter-1` with the note that any phase extraction MUST go through a router-context object that owns the lifecycle flags.

### Risk 2 — queueService boss.work registration order

**Risk.** `startMaintenanceJobs` registers 50+ pg-boss workers via `boss.work(...)` calls. pg-boss's documented behaviour is that a queue may have only one registered worker per process; a second registration on the same queue name is undefined behaviour. If Chunk Q4's bulk-move re-orders the registrations, two paths could attempt to register the same queue name and the runtime contract breaks.

**Mitigation.** Chunk Q4's contract is "preserved byte-for-byte" — the function body is a flat list of `boss.work` calls + a few `boss.schedule` cron-wirings + one `boss.send` enqueue-once. The split moves the whole block to a single new file (`pgBossRegistrations.ts`); it does NOT re-order or group. Builder must use `git diff --stat` after Chunk Q4 to confirm only the file path changed; line-by-line content is identical. If the builder finds itself "tidying" the registration order, the change is out of scope (spec §3 — no drive-by reformat).

### Risk 3 — agentService object literal spread assembly

**Risk.** The `agentService` const is referenced from 16 callers as `agentService.method(args)`. Some callers (notably `routes/agents.ts`) read `agentService._assertNotSystemManaged` and `agentService._assertEtag` directly. The post-split barrel must produce an object where these methods bind correctly, including the underscore-prefixed ones. If a method body references `this.someOtherMethod(...)`, the `this` binding must survive the spread.

**Mitigation.** Pre-flight grep before Chunk A3:
```bash
grep -nE "\bagentService\.[a-zA-Z_][a-zA-Z0-9]*\s*\(" server/ client/ shared/
grep -nE "\bthis\.[a-zA-Z_][a-zA-Z0-9]*" server/services/agentService.ts
```
The current source uses `agentService.<method>(...)` for cross-method calls inside the literal (see `patchBudget` calling `agentService._assertNotSystemManaged` at line 2330). It does NOT use `this.*` for internal calls. The spread shape preserves this — each method is a top-level async function in its sub-module, and the spread assembles them into the object. No `this` binding survival is required because none exists today.

If a future builder finds a `this.*` call surface, the chunk that surfaces it must convert to `agentService.*` BEFORE the spread (one-line mechanical change inside the moved method body; no behaviour change).

### Risk 4 — Cross-target edges resolve through the barrel

**Risk.** `workspaceMemoryService/extract.ts` and `skillAnalyzerJob/stage5Classify.ts` (and `stage7bAgentSuggest.ts`, `stage8bClusterRecommend.ts`) import `routeCall` from `llmRouter`. After Chunk L3 extracts `routeCall` to `llmRouter/routeCall.ts`, those callers still import from `llmRouter.js` (the barrel). If a chunk accidentally short-circuits the import to `llmRouter/routeCall.js` (the internal path), spec §6.3 is violated.

**Mitigation.** Per-chunk grep before merging:
```bash
grep -rnE "from\s+['\"][^'\"]*llmRouter/" server/ client/ shared/ | grep -v "server/services/llmRouter/"
```
The output should be empty — only files INSIDE `server/services/llmRouter/` may import from `./*`; everything else imports from the barrel `'./llmRouter.js'` or its relatives. If a violation is found, the chunk reverts the offending import to the barrel.

### Risk 5 — skillAnalyzerJob Stage 5 cohesion

**Risk.** Stage 5 is ~1,200 LOC and combines the per-candidate Sonnet classify loop, storedMerge hydration on resume, library-collision detection, and the consolidation parse. If a future audit splits these into sub-stages, the resume-safety contract (rows already written to `skill_analyzer_results` are NOT re-classified) might be broken by an extraction that drops the per-slug skip-guard.

**Mitigation.** Chunk S3 keeps Stage 5 as one file. The skip-guard at the top of the per-candidate loop (currently a per-slug `if (existingIndices.has(candidateIndex)) continue;`) stays inline. If a future builder splits Stage 5 further, the resume-safety test must pass — but no new test is authored by this build per spec §13.

### Risk 6 — Module-load side effects (queueService.SimpleQueue)

**Risk.** The `simpleQueue` const at line 57 of queueService.ts is module-level state. It is constructed at module load. If `types.ts` (Chunk Q1) puts the `SimpleQueue` class but `backend.ts` (Chunk Q2) constructs the instance, and the import order in the barrel is wrong, the in-memory fallback path may see a `simpleQueue is undefined` runtime error.

**Mitigation.** The plan locates the `simpleQueue` instance in `backend.ts` (alongside the rest of the in-memory fallback shape, since `getQueueBackend()` is the only consumer). `types.ts` holds only the class definition + the queue-name constants. Import order in the barrel does not matter because Node's ESM evaluation is dependency-resolved.

### Risk 7 — Doc-sync gap (architecture.md key-files-per-domain index)

**Risk.** `architecture.md` may name some of the 5 targets directly with line-number references in its "Key files per domain" index. The split invalidates those line numbers.

**Mitigation.** The Final chunk's step 6 explicitly greps for the named targets in `architecture.md` and proposes the update. If the document only refers to the targets by logical name (no line-number markers), no update is needed. The doc update is part of the same commit per CLAUDE.md §11.

---

## Self-consistency pass

- Locked public surface (§Chunk 0) matches every per-target barrel re-export shape (Q5, A7, W5, L4, S5): ✓
- Cross-target audit lists exactly 2 edges; both preserved through the llmRouter barrel; PR-shape decision honours spec §10 Option A: ✓
- Every chunk's "files modified" list is exact (paths from project root, .ts not .js, server/ prefix): ✓
- Every chunk's "verification commands" list excludes `test:gates`, `test:qa`, `test:unit`, `npm test`, every `scripts/verify-*.sh`, every `scripts/gates/*.sh`, every `scripts/run-all-*.sh`: ✓
- Every chunk's "verification commands" list contains only `npm run lint`, `npm run typecheck`, `npm run build:server`: ✓ (no targeted `npx vitest run <test>` invocations because spec §4 + §13 establish no new tests are authored by this build)
- Executor notes line is present verbatim per the architect template: ✓
- Five mini-plans cover all 5 targets in §Targets; total chunk count is 5 (queue) + 7 (agent) + 5 (workspace) + 4 (llm) + 5 (skill) + 1 (final) = 27 chunks across the master PR: ✓
- Deferred items are surfaced (no `*Pure.ts` extractions; Stage 5 sub-split; routeCall phase-split) — routed to `tasks/todo.md`: ✓
- No new module-level state introduced; every existing module-level state site has exactly one new home: ✓
- Pre-existing baseline `verify-with-org-tx-or-scoped-db.sh` entries are preserved (none of the 5 targets uses `getOrgScopedDb` today; the new sub-modules do not change that): ✓
- Spec §7 acceptance criteria 1-10 are addressed (1 barrels < 250 LOC: covered in each Final chunk; 2 directories match plan: §each mini-plan; 3 build:server clean: per-chunk + final; 4 lint clean: per-chunk + final; 5 verify-loc-cap CI; 6 verify-with-org-tx-or-scoped-db CI; 7 verify-canonical-retry CI; 8 verify-duplicate-blocks CI; 9 callers unchanged: Chunk 0 + Final; 10 `tasks/todo.md` closures: Final chunk step 5): ✓

---

## Open questions for the operator

1. **`getTree` placement (agentService Chunk A4).** `getTree(organisationId)` is a hierarchy read that does NOT use the agent-data-sources DB tables — it reads from `agents`. The plan puts it in `agentDataSources.ts` because the source places it adjacent to data-source methods. The natural alternative is `crud.ts` (treat it as an agent-listing variant). Default chosen: keep with data-sources per source order. Operator may move it to `crud.ts` with one extra line of spread re-assembly in the barrel; no behaviour change.

2. **Stage 5 sub-split horizon (skillAnalyzerJob Chunk S3).** Stage 5 ships at ~1,200 LOC. If the operator wants the cushion under 1,000 LOC, the plan can add a Chunk S3b that hoists the Sonnet classifier prompt builder and the library-collision detector into sibling files (`stage5.classifierPrompt.ts`, `stage5.libraryCollisionGuard.ts`). Default chosen: defer to `SOFTCAP-PURE-skillAnalyzerJob-1`. Operator may flip to in-build if the headroom is preferred.

3. **JobAlreadyFailedAbort sentinel vs null-return (skillAnalyzerJob Chunk S2).** When a stage marks the job failed and wants to abort the pipeline, the default plan uses a throw of a `JobAlreadyFailedAbort` sentinel that the orchestrator catches. The alternative is for each stage to return `null` and the orchestrator to check after every call. The sentinel approach is tidier (one catch in the orchestrator); null-return is more explicit per-stage. Default chosen: sentinel. Operator may swap to null-return with a one-line per-stage change.

4. **llmRouter `routeCall` future phase-split.** Spec §6.4 names "model selection, cost guard, retry, fallback, observability" as separate concerns. This plan extracts `routeCall` as ONE function because phases 5-8 (cost guard + retry-fallback loop) genuinely span shared state and a context-object refactor exceeds the spec's "no behaviour change" boundary. Operator may wish to split `routeCall` further as a follow-up build that introduces a `RouterCallContext` value-object. Default chosen: defer to `SOFTCAP-PURE-llmRouter-1`. The current plan keeps `routeCall.ts` at ~1,420 LOC with ~80 LOC of headroom under the cap.

5. **architecture.md index doc-sync timing.** Final chunk step 6 proposes the architecture.md update. The default plan does this in the same commit as the Final chunk's verification work. If the operator wants the doc-sync as a separate commit at the end of the master PR, that is a one-line ordering preference; behaviour unchanged.

6. **Order of target chunks within the master PR.** The plan defaults to queueService → agentService → workspaceMemoryService → llmRouter → skillAnalyzerJob. The rationale is in §Chunk 0 PR-shape decision (lowest-risk first). If the operator wants llmRouter first (because its surface is the most public and the cleanest barrel transition would catch any pattern bugs early), the plan supports that — each target is independent.

---

## Deferred items (route to `tasks/todo.md`)

- `SOFTCAP-PURE-agentService-1` — investigate Pure extraction of validators / hierarchy normalisers (`assertEtag`, `assertNotSystemManaged`, hierarchy DFS in `getTree`).
- `SOFTCAP-PURE-workspaceMemoryService-1` — investigate Pure extraction of RRF scoring + recency-boost arithmetic in `hybridRetrieval.ts`.
- `SOFTCAP-PURE-llmRouter-1` — investigate context-object refactor of `routeCall` to split phases 5-8 + 9-12 into peer files; only after a `RouterCallContext` value-type is designed.
- `SOFTCAP-PURE-queueService-1` — investigate Pure extraction of `processExecution`'s retry-loop control flow into a small state-machine helper.
- `SOFTCAP-PURE-skillAnalyzerJob-1` — investigate Stage 5 sub-split (classifier prompt builder, library-collision detector, storedMerge hydrator as peer files).
- `SOFTCAP-DOCSYNC-1` — confirm `architecture.md` "Key files per domain" index uses logical names, not line-number markers; if line markers exist, refresh in the Final chunk's commit.

End of plan.
