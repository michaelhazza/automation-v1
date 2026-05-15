---
status: READY_FOR_BUILD
date: 2026-05-15
author: architect (claude opus 4.7)
scope_class: Significant
spec: tasks/builds/feat-split-skillexecutor/spec.md (commit b72f44d0)
build_slug: feat-split-skillexecutor
source_branch: feat/split-skillexecutor
output_location: tasks/builds/feat-split-skillexecutor/plan.md
---

# feat/split-skillexecutor — Implementation Plan

Mechanical refactor: split `server/services/skillExecutor.ts` (6,133 LOC) into a thin barrel + ~25 sibling modules under `server/services/skillExecutor/`. NO behaviour change. PUBLIC API PRESERVED.

This plan is the per-chunk implementation contract a builder agent executes. All conventions, public-surface lock, dependency DAG, and chunk boundaries are defined in the spec. This plan adds the line-range and import-path detail the builder needs to move code without re-deriving anything.

## Model-collapse check

This is a code-organisation refactor — there is no ingest → extract → transform → render pipeline, no model call, no inference. The collapsed-call alternative does not exist for this task. Reject collapse: N/A for mechanical refactors.

## Executor notes

- Branch `feat/split-skillexecutor` is already checked out.
- Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.
- Plan chunk numbering matches spec §7 exactly: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10a, 10b, 10c, 10d, 10e, 11, 12, 13, 14, 15. Total: 20 chunks (16 numbered + 4 sub-chunks under 10).
- Builders MUST NOT renumber, merge, or skip chunks. If a chunk's scope is empty (e.g. a target module's slugs were absorbed by an earlier chunk), the chunk still lands as a no-op PR with a description explaining why.
- Source-line citations refer to `server/services/skillExecutor.ts` at the pre-Chunk-1 baseline. After each chunk lands, line numbers in subsequent chunks DRIFT — the function name + symbol identity is the load-bearing reference. Builders use `grep -n "^async function executeXxx" server/services/skillExecutor.ts` (or the equivalent) to locate the current line range before moving.
- Each `handlers/*.ts` module is created as part of the chunk that first needs it. The in-barrel slot is replaced with `await import('./skillExecutor/handlers/<family>.js').then(m => m.<slug>)` ONLY if the chunk cannot directly call the named export — the default is direct ESM import at the top of `skillExecutor.ts` and a slot that looks like `<slug>: <importedName>,`. Direct imports are simpler and preserved by Chunk 14's spread-pattern consolidation.
- The `registerAdapter('worker', ...)` call (lines 69-131 of the source) STAYS in the barrel through Chunks 1-12. It moves to `skillExecutor/adapter-registration.ts` ONLY in Chunk 13, after `handlers/pages.ts` (Chunk 9) and `handlers/delegation.ts` (Chunk 12) both exist.
- Public surface lock: every export named in spec §4 MUST stay importable from `server/services/skillExecutor.js` at every chunk boundary, including after intermediate chunks. The barrel re-export shape is the spec §5.7 target shape.

## Per-chunk module-shape protocol

Each chunk below names:
1. **Files** — exact paths created or modified.
2. **Symbols moved** — function name, source line range (pre-chunk baseline), what stays vs goes.
3. **Imports the new module needs** — explicit list per spec §5.3 DAG.
4. **In-barrel updates** — what `skillExecutor.ts` changes to consume the new module.
5. **Dependencies** — which earlier chunk must have landed.
6. **G1 verification commands** — lint, typecheck, build:server, targeted vitest if applicable.

---

## Chunk 1 — Scaffold + types

**Files**
- Create directory `server/services/skillExecutor/`.
- Create `server/services/skillExecutor/context.ts` (new).
- Modify `server/services/skillExecutor.ts` (remove what's moved, add re-export).
- Modify `server/services/agentExecutionLoop.ts` (smoke-test import-path change — see below).

**Symbols moved (source → `context.ts`)**
- `SkillExecutionContext` interface — lines 137-229 of `skillExecutor.ts`. Exported.
- `SkillHandler` type alias — lines 426-429. Exported.
- `requireSubaccountContext` function — lines 250-255. Internal (no export keyword needed; it is consumed by handlers via re-export from `context.ts`).

**Symbols that stay in the barrel (DO NOT MOVE in this chunk)**
- `SkillExecutionParams` interface (lines 231-243) — stays in barrel; migrates to `registry.ts` in Chunk 14.
- All `applyOnFailure*`, `runWithProcessors`, `processorRegistry`, `registerProcessor`, `setHandoffJobSender`, `enqueueHandoff`, `AGENT_HANDOFF_QUEUE`, `pgBossSend` — stay in barrel; move in Chunk 2.

**Imports `context.ts` needs**
- Type-only: `import type { HierarchyContext } from '../../../shared/types/delegation.js';`
- Type-only: `import type { ProcessorHooks, ProcessorContext } from '../../types/processor.js';` (NOTE: `ProcessorHooks` / `ProcessorContext` are NOT used in `SkillExecutionContext` — leave them for `pipeline.ts` in Chunk 2. Do NOT add to `context.ts`.)
- No DB, no service imports. Per spec §5.3, `context.ts` is a leaf.

**In-barrel updates**
- Remove the moved lines 137-229, 250-255, 426-429.
- Add at top of barrel (after existing imports):
  ```typescript
  export type { SkillExecutionContext, SkillHandler } from './skillExecutor/context.js';
  ```
- The internal `requireSubaccountContext` is consumed by inline handlers still in the barrel — add at top:
  ```typescript
  import { requireSubaccountContext } from './skillExecutor/context.js';
  ```
  (NOT exported from the barrel; not in spec §4 public surface.)

**Smoke-test import change**
- In `server/services/agentExecutionLoop.ts`, find the current import of `SkillExecutionContext` from `./skillExecutor.js` (per spec §10 it imports `skillExecutor` value only, but also uses the type transitively via downstream — if the file currently does `import type { SkillExecutionContext } from './skillExecutor.js'`, change it to import from `./skillExecutor/context.js`). If no direct type import exists, this smoke test reduces to a no-op observation in the PR description.

**Dependencies**
- None (foundation chunk).

**G1 verification commands**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

---

## Chunk 2 — Pipeline module

**Files**
- Create `server/services/skillExecutor/pipeline.ts` (new).
- Modify `server/services/skillExecutor.ts`.

**Symbols moved (source → `pipeline.ts`)**
- `applyOnFailure` (lines 282-286) — internal.
- `applyOnFailureForStructuredFailure` (lines 288-295) — internal.
- `processorRegistry` module-level `Map` (line 302) — internal.
- `registerProcessor` (lines 305-307) — EXPORTED.
- `runWithProcessors` (lines 310-406) — internal.
- `AGENT_HANDOFF_QUEUE` constant (line 409) — internal.
- `pgBossSend` module-level state (line 412) — internal.
- `setHandoffJobSender` (lines 414-416) — EXPORTED.
- `enqueueHandoff` (lines 3990-4067 — name verified in source) — EXPORTED (so `handlers/tasks.ts` Chunk 6 and `handlers/handoff.ts` Chunk 7 can import it per spec §5.5).

**Imports `pipeline.ts` needs (per spec §5.3)**
- `import type { SkillExecutionContext, SkillHandler } from './context.js';` (only `SkillExecutionContext` needed; include `SkillHandler` if `runWithProcessors` signature needs it — it does not; OMIT `SkillHandler`).
- `import { applyOnFailurePure, applyOnFailureForStructuredFailurePure, type OnFailureDirective } from '../skillExecutorPure.js';`
- `import type { ProcessorHooks, ProcessorContext } from '../../types/processor.js';`
- `import { createSpan, createEvent } from '../../lib/tracing.js';`
- `import { TripWire } from '../../lib/tripwire.js';`
- `import { getActionDefinition } from '../../config/actionRegistry.js';`
- `import { recordIncident } from '../incidentIngestor.js';`
- For `enqueueHandoff`: `import { db } from '../../db/index.js';`, `import { subaccountAgents, agents, agentRuns } from '../../db/schema/index.js';`, `import { eq, and } from 'drizzle-orm';`, `import { isActive } from '../../lib/queryHelpers.js';`, `import { MAX_HANDOFF_DEPTH } from '../../config/limits.js';`.
- Per spec §5.3 explicitly NOT imported: `./gating.js`, any `./handlers/*`.

**In-barrel updates**
- Remove moved lines (282-295, 302, 305-307, 310-406, 409, 412, 414-416, 3990-4067).
- Replace the moved exports by re-exporting from `pipeline.ts`:
  ```typescript
  export { registerProcessor, setHandoffJobSender } from './skillExecutor/pipeline.js';
  ```
- Inline handlers in the barrel that call `runWithProcessors`, `applyOnFailure`, `applyOnFailureForStructuredFailure`, `enqueueHandoff` add a top-of-file import:
  ```typescript
  import { runWithProcessors, applyOnFailure, applyOnFailureForStructuredFailure, enqueueHandoff } from './skillExecutor/pipeline.js';
  ```

**Dependencies**
- Chunk 1 (needs `context.ts`).

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`
- If `server/services/__tests__/skillExecutorPure.test.ts` covers `applyOnFailurePure` directly (not through the barrel): no targeted test needed for this chunk. If a `processorRegistry` or `enqueueHandoff` unit test exists, run it: `npx vitest run <path>`.

---

## Chunk 3 — Gating module

**Files**
- Create `server/services/skillExecutor/gating.ts` (new).
- Modify `server/services/skillExecutor.ts`.

**Symbols moved (source → `gating.ts`)**
- `executeWithActionAudit` (lines 2547-2670 — verify by grep) — internal export.
- `proposeReviewGatedAction` (lines 2672-2787 — verify by grep) — internal export.
- `awaitReviewDecision` (lines 2789-2813 — verify by grep) — internal.
- `buildDenialMessage` (lines 2815-2823 — verify by grep) — internal.

**Imports `gating.ts` needs (per spec §5.3)**
- `import type { SkillExecutionContext } from './context.js';`
- `import { runWithProcessors } from './pipeline.js';`
- `import { actionService, buildActionIdempotencyKey } from '../actionService.js';`
- `import { reviewService } from '../reviewService.js';`
- `import { hitlService } from '../hitlService.js';`
- `import { executionLayerService } from '../executionLayerService.js';`
- `import { getActionDefinition } from '../../config/actionRegistry.js';`
- `import { createSpan, createEvent } from '../../lib/tracing.js';`
- `import { HITL_REVIEW_TIMEOUT_MS } from '../../config/limits.js';`
- Per spec §5.3 explicitly NOT imported: any `./handlers/*`.

**In-barrel updates**
- Remove moved lines (2547-2823 range).
- Add top-of-file import for the in-barrel handlers that still call gating helpers:
  ```typescript
  import { executeWithActionAudit, proposeReviewGatedAction } from './skillExecutor/gating.js';
  ```
- No public re-export — these are internal.

**Dependencies**
- Chunk 1 (`context.ts`), Chunk 2 (`pipeline.ts`).

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

#### Chunks 4-12 — Per-chunk procedure (common template)

For every handler-family chunk (Chunks 4-12), the procedure is identical and matches spec §7:
1. Create the new `handlers/<family>.ts` file with the imports its moved functions need.
2. Move the named functions and any helpers used ONLY by them. Verify "used only by them" with `grep -n "helperName" server/services/skillExecutor.ts` BEFORE the move.
3. Update the in-barrel `SKILL_HANDLERS` literal slot bodies — they continue to call `executeXxx(input, context)` but resolve to imported references.
4. Add a top-of-barrel import block for the moved functions.
5. Builder PR description names every moved function and every slug whose slot was updated.
6. Builder runs G1 commands.
7. If the chunk's `handlers/*.ts` exports a function that the `registerAdapter('worker', ...)` switch (still in the barrel) references, update the switch arms to call the imported reference. This applies to Chunk 9 (page executors) and Chunk 12 (delegation executors) only.

---

## Chunk 4 — `handlers/web.ts`

**Files**
- Create `server/services/skillExecutor/handlers/web.ts` (new).
- Modify `server/services/skillExecutor.ts`.

**Symbols moved (source → `handlers/web.ts`)**
- `executeWebSearch` (lines 2829-2885) — internal export.
- `logSearchUsage` (lines 2886-2904) — internal.
- `executeFetchUrl` (lines 4682-4737) — internal export.
- `executeScrapeUrl` (lines 4738-4789) — internal export.
- `deriveSelectorGroup` (lines 4790-4797) — internal.
- `executeScrapeStructured` (lines 4798-5029) — internal export.
- `executeMonitorWebpage` (lines 5030-5209) — internal export.
- `executeCaptureScreenshot` (lines 5646-5750) — internal export.
- `executeRunPlaywrightTest` (lines 5751-5859) — internal export.
- `executeAnalyzeEndpoint` (lines 5504-5568) — internal export.

**Slugs whose in-barrel slot now points at `handlers/web.ts`**
- `web_search` (line 451), `fetch_url` (line 590), `scrape_url` (line 593), `scrape_structured` (line 596), `monitor_webpage` (line 599), `capture_screenshot` (line 659), `run_playwright_test` (line 663), `analyze_endpoint` (line 651).

**Imports `handlers/web.ts` needs**
- `import type { SkillExecutionContext } from '../context.js';`
- `import { executeWithActionAudit, proposeReviewGatedAction } from '../gating.js';` (only the helpers each handler actually uses — verify per-handler at move time).
- `import { scrapingEngine, parseFrequencyToRRule, serializeMonitorBrief, parseMonitorBrief } from '../scrapingEngine/index.js';`
- `import { loadSelectors, saveSelector, incrementHit, incrementMiss, updateSelector } from '../scrapingEngine/selectorStore.js';`
- `import { buildFingerprint, resolveSelector } from '../scrapingEngine/adaptiveSelector.js';`
- `import { canonicalizeFieldKey, computeContentHash } from '../scrapingEngine/contentExtractor.js';`
- `import { scheduledTaskService } from '../scheduledTaskService.js';`
- `import { routeCall } from '../llmRouter.js';`
- `import { db } from '../../db/index.js';` and any schema imports actually used by the moved bodies (`scheduledTasks`, etc.).
- Other imports: copy whatever the moved functions reference at move time (env, logger, drizzle helpers). Builder grep at move time to confirm the exact set.

**In-barrel updates**
- Remove moved function bodies (lines listed above).
- At top of barrel, add:
  ```typescript
  import {
    executeWebSearch,
    executeFetchUrl,
    executeScrapeUrl,
    executeScrapeStructured,
    executeMonitorWebpage,
    executeCaptureScreenshot,
    executeRunPlaywrightTest,
    executeAnalyzeEndpoint,
  } from './skillExecutor/handlers/web.js';
  ```
- The 8 slug slots in `SKILL_HANDLERS` literal continue to call `executeWebSearch(input, context)` etc. — the slot bodies do not change; only the resolution point changes (now an import, not an in-file function).

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 5 — `handlers/workspace.ts`

**Files**
- Create `server/services/skillExecutor/handlers/workspace.ts`.
- Modify `server/services/skillExecutor.ts`.

**Symbols moved**
- `executeReadWorkspace` (lines 2905-2964) — internal export.
- `serializeTask` (lines 2965-2988) — internal (used only by `executeReadWorkspace`; verify with grep).
- `executeWriteWorkspace` (lines 3426-3454) — internal export.

**Slugs**
- `read_workspace` (line 454), `write_workspace` (line 458).

**Imports `handlers/workspace.ts` needs**
- `import type { SkillExecutionContext } from '../context.js';`
- `import { workspaceMemoryService } from '../workspaceMemoryService.js';`
- `import { db } from '../../db/index.js';`, `import { tasks } from '../../db/schema/index.js';` if `serializeTask` needs them (verify at move time).
- Other imports: copy as needed.

**In-barrel updates**
- Remove moved bodies, add import block.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 6 — `handlers/tasks.ts`

**Files**
- Create `server/services/skillExecutor/handlers/tasks.ts`.
- Modify `server/services/skillExecutor.ts`.

**Symbols moved**
- `executeCreateTask` (lines 3505-3616) — internal export.
- `buildIdeaDescription` (lines 3617-3634) — internal (triage helper).
- `buildBugDescription` (lines 3635-3666) — internal.
- `buildChoreDescription` (lines 3667-3684) — internal.
- `inferTypeFromDescription` (lines 3685-3690) — internal.
- `suggestDisposition` (lines 3691-3735) — internal.
- `executeTriageIntake` (lines 3736-3901) — internal export.
- `executeMoveTask` (lines 3902-3938) — internal export.
- `executeAddDeliverable` (lines 3939-3989) — internal export.
- `executeUpdateTask` (lines 4069-4125) — internal export.
- `executeReassignTask` (lines 4126-4364) — internal export. Calls `enqueueHandoff` per spec §5.5 — imports it from `../pipeline.js`.
- `executeReadInbox` (lines 4665-4681) — internal export.
- `executeReportBug` (lines 5569-5645) — internal export. (Per spec Chunk 8 note: `executeReportBug` is task-domain even though source-adjacent to dev-context — it lives in `handlers/tasks.ts`, NOT `handlers/devContext.ts`.)

**Slugs**
- `create_task` (566), `triage_intake` (570), `move_task` (574), `add_deliverable` (577), `reassign_task` (580), `update_task` (584), `read_inbox` (587), `report_bug` (655).

**Imports `handlers/tasks.ts` needs**
- `import type { SkillExecutionContext } from '../context.js';`
- `import { enqueueHandoff } from '../pipeline.js';` (per spec §5.5 — `executeReassignTask` calls it)
- `import { taskService } from '../taskService.js';`
- `import { db } from '../../db/index.js';`, `import { tasks, agentRuns, subaccountAgents, agents } from '../../db/schema/index.js';` (as needed)
- `import { eq, and, count, inArray } from 'drizzle-orm';` (as needed)
- `import { isActive } from '../../lib/queryHelpers.js';`
- `import { MAX_TASK_TITLE_LENGTH, MAX_TASK_DESCRIPTION_LENGTH, VALID_PRIORITIES, type TaskPriority } from '../../config/limits.js';`
- `import { computeReassignDirection, validateReassignScope, evaluateReassignPreconditions } from '../skillExecutorDelegationPure.js';`
- `import { insertOutcomeSafe } from '../delegationOutcomeService.js';`
- `import { insertExecutionEventSafe } from '../agentExecutionEventService.js';`
- Others: copy what the moved bodies reference.

**In-barrel updates**
- Remove moved bodies, add import block.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.
- If `server/services/__tests__/skillExecutor.reassignTask.test.ts` runs through `skillExecutorDelegationPure` only (per spec §10), no targeted test needed. Otherwise: `npx vitest run server/services/__tests__/skillExecutor.reassignTask.test.ts`.

---

## Chunk 7 — `handlers/handoff.ts`

**Files**
- Create `server/services/skillExecutor/handlers/handoff.ts`.
- Modify `server/services/skillExecutor.ts`.

**Symbols moved**
- `executeSpawnSubAgents` (lines 4365-4664) — internal export. Calls `enqueueHandoff`.
- `executeTriggerProcess` (lines 3455-3504) — internal export.

**Slugs**
- `spawn_sub_agents` (554), `trigger_process` (550).

**Imports `handlers/handoff.ts` needs**
- `import type { SkillExecutionContext } from '../context.js';`
- `import { enqueueHandoff } from '../pipeline.js';` (per spec §5.5)
- `import type { HierarchyContext } from '../../../shared/types/delegation.js';`
- `import { HIERARCHY_CONTEXT_MISSING, CROSS_SUBTREE_NOT_PERMITTED, DELEGATION_OUT_OF_SCOPE } from '../../../shared/types/delegation.js';`
- `import { classifySpawnTargets, evaluateSpawnPreconditions } from '../skillExecutorDelegationPure.js';`
- `import { executeTriggerredProcess } from '../llmService.js';`
- `import { agentExecutionService } from '../agentExecutionService.js';`
- `import { db } from '../../db/index.js';`, schema as needed.
- `import { MAX_SUB_AGENTS, MIN_SUB_AGENT_TOKEN_BUDGET, SUB_AGENT_TIMEOUT_BUFFER } from '../../config/limits.js';`
- Other imports: copy as needed.

**In-barrel updates**
- Remove moved bodies, add import block.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.
- If `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts` runs through `skillExecutorDelegationPure` only (per spec §10), no targeted test needed.

---

## Chunk 8 — `handlers/devContext.ts`

**Files**
- Create `server/services/skillExecutor/handlers/devContext.ts`.
- Modify `server/services/skillExecutor.ts`.

**Symbols moved**
- `executeReadCodebase` (lines 5305-5343) — internal export.
- `executeSearchCodebase` (lines 5344-5417) — internal export.
- `executeRunTests` (lines 5418-5503) — internal export.
- `proposeDevopsAction` (lines 5210-5304) — internal (devContext-specific gate helper).

**Slugs**
- `read_codebase` (639), `search_codebase` (643), `run_tests` (647).
- `write_patch` (669), `run_command` (673), `create_pr` (677) — these call `proposeDevopsAction` per spec §5.2.1 NOTE. Their in-barrel slot bodies update to call the imported `proposeDevopsAction`.

**Imports `handlers/devContext.ts` needs**
- `import type { SkillExecutionContext } from '../context.js';`
- `import { devContextService, assertPathInRoot } from '../devContextService.js';`
- `import { readFile } from 'fs/promises';`, `import { resolve, join } from 'path';`, `import { glob } from 'glob';`, `import { execFile } from 'child_process';`, `import { promisify } from 'util';` (for `executeRunTests`)
- `import { actionService, buildActionIdempotencyKey } from '../actionService.js';` (for `proposeDevopsAction`)
- `import { reviewService } from '../reviewService.js';` (for `proposeDevopsAction`)
- `import { executionLayerService } from '../executionLayerService.js';` (for `proposeDevopsAction`)
- Other imports: copy at move time.

**In-barrel updates**
- Remove moved bodies (5210-5503 range), add import block.
- Update slug slot bodies for `write_patch`, `run_command`, `create_pr` to call imported `proposeDevopsAction`.
- The `execFileAsync` constant (line 58) is used only by `executeRunTests` after this chunk — move it into `handlers/devContext.ts` and remove from the barrel.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 9 — `handlers/pages.ts`

**Files**
- Create `server/services/skillExecutor/handlers/pages.ts`.
- Modify `server/services/skillExecutor.ts`.

**Symbols moved**
- `executeCreatePage` (lines 5860-5891) — internal export.
- `executeUpdatePage` (lines 5892-5920) — internal export.
- `executePublishPage` (lines 5921-5944) — internal export.

**Symbols NOT moved here**
- `executeMethodologySkill` (lines 5945-5964) — moves with Chunk 10a (`methodologyStubs.ts`), per spec Chunk 9 note.

**Slugs**
- `create_page` (683), `update_page` (687), `publish_page` (691).

**Imports `handlers/pages.ts` needs**
- `import type { SkillExecutionContext } from '../context.js';`
- `import { proposeReviewGatedAction } from '../gating.js';` (if any page handler uses it)
- Page-service imports (verify at move time — likely a `pageService` import or similar).

**In-barrel updates**
- Remove moved bodies, add import block.
- The in-barrel `registerAdapter('worker', ...)` switch arms at lines 78-80 (`case 'create_page':`, `case 'update_page':`, `case 'publish_page':`) currently call in-barrel function names. Update them to call the imported names from `handlers/pages.ts`. The `registerAdapter(...)` call ITSELF stays in the barrel — only the switch-arm targets change.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 10 — `handlers/workflowStudio.ts` + `handlers/skillStudio.ts`

**Files**
- Create `server/services/skillExecutor/handlers/workflowStudio.ts`.
- Create `server/services/skillExecutor/handlers/skillStudio.ts`.
- Modify `server/services/skillExecutor.ts`.

**Symbols moved to `workflowStudio.ts`**
- `executeWorkflowReadExisting` (5965-5980), `executeWorkflowValidate` (5981-5989), `executeWorkflowSimulate` (5990-5998), `executeWorkflowEstimateCost` (5999-6008), `executeWorkflowProposeSave` (6009-6091), `executeImportN8nWorkflow` (6097-6133). All internal exports.
- Slug `workflow.run.start` (line 622) — its body dispatches via `executionLayerService` / workflow runner. Move the inline body into `workflowStudio.ts` as an exported async function (e.g. `executeWorkflowRunStart`) and have the in-barrel slot call it.

**Slugs (workflowStudio)**
- `workflow_read_existing` (604), `workflow_validate` (607), `workflow_simulate` (610), `workflow_estimate_cost` (613), `workflow_propose_save` (616), `import_n8n_workflow` (619), `workflow.run.start` (622).

**Symbols moved to `skillStudio.ts`**
- The 5 slot bodies at lines 511-549 (no named `executeXxx` exists in source for these — they are inline). Builder either: (a) creates inline async functions inside `skillStudio.ts` and re-imports, or (b) exports a `skillStudioHandlers: Record<string, SkillHandler>` map. Pick (b) for parity with Chunk 14's spread pattern.

**Slugs (skillStudio)**
- `skill_read_existing` (511), `skill_read_regressions` (518), `skill_validate` (524), `skill_simulate` (528), `skill_propose_save` (535).

**Imports each module needs**
- `workflowStudio.ts`: `import type { SkillExecutionContext } from '../context.js';` plus the dynamic-imported services (`WorkflowStudioService`, `n8nImportServicePure`) which stay as `await import(...)` inside the function bodies. Other imports: copy at move time.
- `skillStudio.ts`: `import type { SkillExecutionContext, SkillHandler } from '../context.js';` plus `import * as skillStudioService from '../skillStudioService.js';`.

**In-barrel updates**
- Remove moved bodies (5965-6133), remove the 5 skillStudio inline slot bodies (511-549).
- Add import blocks. Update the slot bodies to call imported functions or to spread the `skillStudioHandlers` map.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 10a — `handlers/methodologyStubs.ts`

**Files**
- Create `server/services/skillExecutor/handlers/methodologyStubs.ts`.
- Modify `server/services/skillExecutor.ts`.

**Symbols moved**
- `executeMethodologySkill` helper (lines 5945-5964) — internal export.

**Slugs moved (every `executeMethodologySkill(...)` consumer)**
- `analyse_performance` (905), `draft_ad_copy` (919), `draft_sequence` (958), `generic_methodology` (976), `analyse_financials` (1020), `generate_competitor_brief` (1041), `synthesise_voc` (1058), `draft_content` (1080), `audit_seo` (1095), `audit_geo` (1114), `geo_citability` (1137), `geo_crawlers` (1151), `geo_schema` (1165), `geo_platform_optimizer` (1180), `geo_brand_authority` (1198), `geo_llmstxt` (1212), `geo_compare` (1228), `draft_report` (1250), `analyse_pipeline` (1287), `draft_followup` (1302), `detect_churn_risk` (1315), `draft_architecture_plan` (698), `draft_tech_spec` (713), `review_ux` (726), `review_code` (738), `write_tests` (751), `draft_requirements` (766), `derive_test_cases` (779), `classify_email` (797), `draft_reply` (813), `draft_post` (850), `analyse_42macro_transcript` (1527).

Builder must verify the slug set by grepping `executeMethodologySkill` at move time. Spec gives "~30"; this plan enumerates 32. Final count is whatever grep returns at move time — log any divergence in the PR.

**Export shape**
- Export a `methodologyStubHandlers: Record<string, SkillHandler>` map. Chunk 14 absorbs it via spread.

**Imports `methodologyStubs.ts` needs**
- `import type { SkillExecutionContext, SkillHandler } from '../context.js';`
- Whatever `executeMethodologySkill` body requires — likely `routeCall` from `../llmRouter.js`. Verify at move time.

**In-barrel updates**
- Remove the slot bodies for the listed slugs. Spread `methodologyStubHandlers` into `SKILL_HANDLERS` literal OR import each slug individually.

**Dependencies**
- Chunks 1, 2, 3. Independent of Chunks 4-10.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 10b — `handlers/autoGatedStubs.ts` + `handlers/reviewGatedProposers.ts`

**Files**
- Create `server/services/skillExecutor/handlers/autoGatedStubs.ts`.
- Create `server/services/skillExecutor/handlers/reviewGatedProposers.ts`.
- Modify `server/services/skillExecutor.ts`.

**`autoGatedStubs.ts` — slugs (per spec §5.2.1, ONLY these four)**
- `search_knowledge_base` (827), `read_analytics` (866), `read_campaigns` (887), `enrich_contact` (946).

**`reviewGatedProposers.ts` — slugs (per spec §5.2.1, ONLY these — others with a domain home stay there)**
- `publish_post` (863), `update_financial_record` (1036), `create_lead_magnet` (1245), `deliver_report` (1266), `configure_integration` (1271), `propose_doc_update` (1342), `write_docs` (1345), `write_spec` (792), `update_bid` (932), `update_copy` (935), `pause_campaign` (938), `increase_budget` (941), `send_email` (628), `update_record` (631), `request_approval` (634).

**Imports both modules need**
- `import type { SkillExecutionContext, SkillHandler } from '../context.js';`
- `import { executeWithActionAudit, proposeReviewGatedAction } from '../gating.js';`

**Export shape**
- Each module exports a `Record<string, SkillHandler>` map: `autoGatedStubHandlers`, `reviewGatedProposerHandlers`. Chunk 14 spreads them.

**In-barrel updates**
- Remove slot bodies for the listed slugs. Spread the new maps (or named-import each slug).

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 10c — Sibling-service shells

**Files**
- Create:
  - `server/services/skillExecutor/handlers/systemMonitorShells.ts`
  - `server/services/skillExecutor/handlers/optimiserShells.ts`
  - `server/services/skillExecutor/handlers/spendShells.ts`
  - `server/services/skillExecutor/handlers/configShells.ts`
  - `server/services/skillExecutor/handlers/capabilityDiscovery.ts`
- Modify `server/services/skillExecutor.ts`.

**`systemMonitorShells.ts` — 11 slugs**
- `read_agent_run` (1858), `read_baseline` (1862), `read_connector_state` (1866), `read_dlq_recent` (1870), `read_heuristic_fires` (1874), `read_incident` (1878), `read_logs_for_correlation_id` (1882), `read_recent_runs_for_agent` (1886), `read_skill_execution` (1890), `write_diagnosis` (1894), `write_event` (1898). Each body is a thin dynamic import of the corresponding `server/services/systemMonitor/skills/*.ts` module.

**`optimiserShells.ts` — 8 slugs**
- `optimiser.scan_agent_budget` (2021), `optimiser.scan_workflow_escalations` (2037), `optimiser.scan_skill_latency` (2053), `optimiser.scan_inactive_workflows` (2086), `optimiser.scan_escalation_phrases` (2102), `optimiser.scan_memory_citation` (2118), `optimiser.scan_routing_uncertainty` (2134), `optimiser.scan_cache_efficiency` (2150).

**`spendShells.ts` — 5 slugs**
- `pay_invoice` (2173), `purchase_resource` (2177), `subscribe_to_service` (2181), `top_up_balance` (2185), `issue_refund` (2189). Thin shells over `server/services/spendSkillHandlers.ts`.

**`configShells.ts` — config_* slugs (~33; verify count at move time)**
- `config_create_agent` (1693), `config_update_agent` (1697), `config_activate_agent` (1701), `config_link_agent` (1705), `config_update_link` (1709), `config_set_link_skills` (1713), `config_set_link_instructions` (1717), `config_set_link_schedule` (1721), `config_set_link_limits` (1725), `config_create_subaccount` (1729), `config_create_scheduled_task` (1733), `config_update_scheduled_task` (1737), `config_attach_data_source` (1741), `config_update_data_source` (1745), `config_remove_data_source` (1749), `config_restore_version` (1753), `config_list_agents` (1777), `config_list_subaccounts` (1781), `config_list_links` (1785), `config_list_scheduled_tasks` (1789), `config_list_data_sources` (1793), `config_list_system_skills` (1797), `config_list_org_skills` (1801), `config_get_agent_detail` (1805), `config_get_link_detail` (1809), `config_run_health_check` (1815), `config_preview_plan` (1819), `config_view_history` (1823), `config_publish_workflow_output_to_portal` (1829), `config_send_workflow_email_digest` (1833), `config_update_organisation_config` (1513), `config_deliver_workflow_output` (1640), `config_weekly_digest_gather` (1634). Thin shells over `server/tools/config/configSkillHandlers.ts` + `workflowSkillHandlers.ts`.

**`capabilityDiscovery.ts` — 8 slugs**
- `list_platform_capabilities` (1759), `list_connections` (1763), `check_capability_gap` (1767), `request_feature` (1771), `ask_clarifying_questions` (1589), `ask_clarifying_question` (1606), `challenge_assumptions` (1597), `request_clarification` (1616). Thin shells over `server/tools/capabilities/*` handlers.

**Imports each shell module needs**
- `import type { SkillExecutionContext, SkillHandler } from '../context.js';`
- Dynamic `await import(...)` sites stay inside each slot body — per spec §3, dynamic-import sites are NOT modernised in this build.

**Export shape**
- Each module exports a `Record<string, SkillHandler>` map (e.g. `systemMonitorShellHandlers`).

**In-barrel updates**
- Remove all listed slot bodies. Spread the maps into `SKILL_HANDLERS`.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 10d — Domain shells

**Files**
- Create:
  - `server/services/skillExecutor/handlers/crm.ts`
  - `server/services/skillExecutor/handlers/orgInsights.ts`
  - `server/services/skillExecutor/handlers/output.ts`
  - `server/services/skillExecutor/handlers/threadContext.ts`
  - `server/services/skillExecutor/handlers/notifyOperator.ts`
  - `server/services/skillExecutor/handlers/memoryBlock.ts`
  - `server/services/skillExecutor/handlers/financialReporting.ts`
- Modify `server/services/skillExecutor.ts`.

**`crm.ts` — 7 slugs**
- `crm.fire_automation` (1423), `crm.send_email` (1426), `crm.send_sms` (1429), `crm.create_task` (1432), `crm.query` (1442), `read_crm` (1276), `update_crm` (985). Methodology CRM slugs (`analyse_pipeline`, `draft_followup`, `detect_churn_risk`) belong to `methodologyStubs.ts` per Chunk 10a — NOT here.

**`orgInsights.ts` — 11 slugs**
- `read_org_insights` (1363), `write_org_insight` (1368), `compute_health_score` (1373), `detect_anomaly` (1378), `compute_churn_risk` (1383), `compute_staff_activity_pulse` (1388), `scan_integration_fingerprints` (1400), `generate_portfolio_report` (1412), `trigger_account_intervention` (1417), `assign_task` (1350), `query_subaccount_cohort` (1358).

**`output.ts` — 1 slug**
- `output.recommend` (1907-~2000; body is non-trivial, ~90 lines).

**`threadContext.ts` — 1 slug**
- `update_thread_context` (2002).

**`notifyOperator.ts` — 1 slug**
- `notify_operator` (1505) — thin shell over `notifyOperatorFanoutService`.

**`memoryBlock.ts` — 2 slugs**
- `update_memory_block` (1681), `read_docs` (1329).

**`financialReporting.ts` — 2 slugs**
- `read_revenue` (990), `read_expenses` (1005).

**Imports each module needs**
- `import type { SkillExecutionContext, SkillHandler } from '../context.js';`
- Domain-service imports (verify per slug at move time).
- `gating.ts` helpers where needed.

**In-barrel updates**
- Remove listed slot bodies. Spread the maps.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.
- Targeted: `npx vitest run server/services/__tests__/agentRecommendations.skillExecutor.test.ts` — exercises `output.recommend` and dynamically imports the barrel; should pass unchanged.

---

## Chunk 10e — `handlers/mediaTranscription.ts` + `handlers/digest.ts` + `handlers/thinDispatchers.ts`

**Files**
- Create:
  - `server/services/skillExecutor/handlers/mediaTranscription.ts`
  - `server/services/skillExecutor/handlers/digest.ts`
  - `server/services/skillExecutor/handlers/thinDispatchers.ts`
- Modify `server/services/skillExecutor.ts`.

**`mediaTranscription.ts` — 3 slugs**
- `transcribe_audio` (1546), `fetch_paywalled_content` (1560), `send_to_slack` (1574).

**`digest.ts` — 3 slugs**
- `weekly_digest_gather` (1628), `smart_skip_from_website` (1841), `canonical_dictionary` (1846).

**`thinDispatchers.ts` — catch-all**
- Any slug that calls `await import('./otherService.js')` and forwards, and is NOT already domain-assigned in §5.2 nor a member of one of the family modules already created. Builder identifies leftovers at move time by greping the remaining `SKILL_HANDLERS` literal for slot bodies of the form `const { x } = await import(...); return x.fn(...)`. Expected leftovers: NONE (all of them have a domain home per §5.2). If grep finds any, log them in the PR description.

**Imports each module needs**
- `import type { SkillExecutionContext, SkillHandler } from '../context.js';`
- Dynamic `await import(...)` sites stay inside slot bodies.

**Export shape**
- `Record<string, SkillHandler>` maps.

**In-barrel updates**
- Remove listed slot bodies. Spread the maps.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

**Post-Chunk-10e invariant**
- The in-barrel `SKILL_HANDLERS` literal at line 439 of the source is now substantially smaller. The two `Object.assign(SKILL_HANDLERS, {...})` blocks at lines 2210 and 2374 are still present (they handle support.* and calendar.*/slack.* respectively); they move in Chunk 11.

---

## Chunk 11 — Remaining handler shells (memory, support, calendar, slack, meta, capabilities, userOwnedAgentOwner)

**Files**
- Create:
  - `server/services/skillExecutor/handlers/memory.ts`
  - `server/services/skillExecutor/handlers/support.ts`
  - `server/services/skillExecutor/handlers/calendar.ts`
  - `server/services/skillExecutor/handlers/slack.ts`
  - `server/services/skillExecutor/handlers/meta.ts`
  - `server/services/skillExecutor/handlers/capabilities.ts`
  - `server/services/skillExecutor/handlers/userOwnedAgentOwner.ts`
- Modify `server/services/skillExecutor.ts`.

**`memory.ts` — 3 slugs**
- `search_agent_history` (462), `read_priority_feed` (484), `read_data_source` (560 — thin re-export of `server/tools/readDataSource.ts`).

**`support.ts` — 11 slugs**
- From the `Object.assign(SKILL_HANDLERS, {...})` block at lines 2210-2349 (10 slugs): `support.list_open_tickets` (2212), `support.read_thread` (2224), `support.propose_reply` (2230), `support.add_internal_note` (2245), `support.approve_draft` (2259), `support.reject_draft` (2267), `support.set_status` (2273), `support.assign` (2283), `support.tag` (2293), `support.find_customer_history` (2306).
- Plus inline slug `support.classify_ticket` (line 840 — thin dispatcher to `skillHandlers/supportClassifyTicket.ts`).
- Also move `buildSupportPrincipal` helper (lines 2197-2206) into `support.ts`.

**`calendar.ts` — 6 slugs**
- From the second `Object.assign(SKILL_HANDLERS, {...})` block at lines 2374-2493: `calendar.list_events` (2376), `calendar.get_event` (2384), `calendar.find_free_slot` (2392), `calendar.create_event` (2400), `calendar.update_event` (2410), `calendar.respond_to_invite` (2420). Imports `resolveAgentOwner` from `handlers/userOwnedAgentOwner.ts`.

**`slack.ts` — 6 slugs**
- From the same `Object.assign` block: `slack.list_channels` (2433), `slack.read_channel` (2441), `slack.search_messages` (2449), `slack.summarise_thread` (2457), `slack.post_message` (2465), `slack.post_dm` (2479). Imports `resolveAgentOwner` from `handlers/userOwnedAgentOwner.ts`.

**`meta.ts` — 2 slugs**
- `search_tools` (441), `load_tool` (445) — BM25 tool discovery; thin shells over `server/tools/meta/searchTools.ts`.

**`capabilities.ts`**
- Empty or thin re-export module — the capability-discovery slugs were moved in Chunk 10c to `capabilityDiscovery.ts`. Per spec §5.2, `capabilities.ts` is listed as "capability discovery skills (re-export thin shells calling existing capability handlers)". To avoid two near-duplicate modules, this chunk lands `handlers/capabilities.ts` as a thin re-export of `capabilityDiscovery.ts` OR as an empty module that builders leave for a follow-up consolidation. Recommended: SKIP creating `capabilities.ts` in this chunk; let the spec's intent be served by `capabilityDiscovery.ts` alone. If a future audit decides `capabilities.ts` should exist as a separate file, that's a follow-up. Document this deviation in the PR description.

**`userOwnedAgentOwner.ts` — helper-only module**
- Move `resolveAgentOwner` helper (lines 2356-2372) into this module as the only exported function. Per spec §5.3, this is the allowed one-way edge: `handlers/calendar.ts` and `handlers/slack.ts` both import it.

**Imports each module needs**
- All: `import type { SkillExecutionContext, SkillHandler } from '../context.js';`
- `support.ts`: `import * as supportService from '../support/supportService.js';` (or whichever the source uses) and `import type { PrincipalContext } from '../principal/types.js';`.
- `calendar.ts`, `slack.ts`: dynamic `await import('../calendar/calendarActionService.js')` and `await import('../slack/slackActionService.js')` per source pattern; plus `import { resolveAgentOwner } from './userOwnedAgentOwner.js';`.
- `meta.ts`: dynamic `await import('../../tools/meta/searchTools.js')`.

**In-barrel updates**
- Remove the 11 inline memory.* / support.* / meta.* slot bodies in the main literal.
- Remove both `Object.assign(SKILL_HANDLERS, {...})` blocks (lines 2210-2349 and 2374-2493 in source). The slugs they registered move into `support.ts`, `calendar.ts`, `slack.ts`.
- Remove `buildSupportPrincipal` (2197-2206) and `resolveAgentOwner` (2356-2372).
- Add import block at top of barrel for the new family modules.
- Spread their handler maps into `SKILL_HANDLERS` (Chunk 14 finalises this; here we either spread directly or named-import each slug).

**Dependencies**
- Chunks 1, 2, 3. Independent of Chunks 4-10e.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 12 — Worker-approved-execute family (`handlers/delegation.ts`)

**Files**
- Create `server/services/skillExecutor/handlers/delegation.ts`.
- Modify `server/services/skillExecutor.ts`.

**Symbols moved**
- `executeWriteSpecApproved` (lines 2989-3051) — internal export.
- `executePublishPostApproved` (lines 3052-3100) — internal export.
- `executeAdsActionApproved` (lines 3101-3146) — internal export.
- `executeCrmUpdateApproved` (lines 3147-3191) — internal export.
- `executeFinancialRecordUpdateApproved` (lines 3192-3230) — internal export.
- `executeLeadMagnetApproved` (lines 3231-3263) — internal export.
- `executeDeliverReportApproved` (lines 3264-3311) — internal export.
- `redactSensitiveFields` (lines 3312-3325) — internal (used by `executeDocProposalApproved` and `executeWriteDocsApproved`).
- `executeConfigureIntegrationApproved` (lines 3326-3365) — internal export.
- `executeDocProposalApproved` (lines 3366-3395) — internal export.
- `executeWriteDocsApproved` (lines 3396-3425) — internal export.

**Imports `handlers/delegation.ts` needs**
- `import type { SkillExecutionContext } from '../context.js';`
- Service imports per the moved bodies' references (verify at move time — likely `actionService`, `taskService`, domain services for each `*Approved` flow).

**In-barrel updates**
- Remove moved bodies (2989-3425 range).
- The `registerAdapter('worker', ...)` switch arms (lines 81-93 of source) currently call in-barrel `execute*Approved` names. Update them to call the imported names from `handlers/delegation.ts`. The `registerAdapter(...)` call ITSELF stays in the barrel — only the switch-arm targets change. This is the LAST in-barrel mutation before adapter extraction in Chunk 13.
- Add top-of-barrel import block for the 10 `execute*Approved` functions.

**Dependencies**
- Chunks 1, 2, 3.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.

---

## Chunk 13 — Extract adapter-registration

**Files**
- Create `server/services/skillExecutor/adapter-registration.ts` (new).
- Modify `server/services/skillExecutor.ts`.

**Code moved**
- The entire `registerAdapter('worker', createWorkerAdapter(async (rawActionType, payload, ctx) => { ... }));` block at source lines 69-131 — moves verbatim into `adapter-registration.ts`. The two dynamic-import arms (`config_update_organisation_config` at lines 98-109, `notify_operator` at lines 112-127) STAY as `await import(...)` inside the dispatch — per spec §5.3 they are NOT modernised.
- Helper imports tied to the `registerAdapter` block currently inside the barrel — `createWorkerAdapter`, `recordIncident`, `updateThreadContextHandler`, `getOrgScopedDb`, `logger` — verify each is still referenced after the block moves. Imports referenced ONLY by the moved block move with it; imports referenced by other still-in-barrel code stay in the barrel. (Builder identifies per-symbol at move time.)

**Imports `adapter-registration.ts` needs (per spec §5.3)**
- `import type { SkillExecutionContext } from './context.js';`
- `import { registerAdapter, executionLayerService } from '../executionLayerService.js';` (only `registerAdapter` is needed at call-site; include `executionLayerService` only if the moved block references it directly — it does not, only `registerAdapter`).
- `import { createWorkerAdapter } from '../adapters/workerAdapter.js';`
- `import { resolveActionSlug } from '../../config/actionRegistry.js';`
- `import { executeCreatePage, executeUpdatePage, executePublishPage } from './handlers/pages.js';`
- `import { executeWriteSpecApproved, executePublishPostApproved, executeAdsActionApproved, executeCrmUpdateApproved, executeFinancialRecordUpdateApproved, executeLeadMagnetApproved, executeDeliverReportApproved, executeConfigureIntegrationApproved, executeDocProposalApproved, executeWriteDocsApproved } from './handlers/delegation.js';`
- Per spec §5.3 explicitly NOT imported: the barrel `skillExecutor.ts`, any other `handlers/*` module.

**In-barrel updates**
- Remove lines 60-131 (the registerAdapter call and the comment header above it).
- Remove the imports it depended on if no other code in the barrel needs them.
- Add at the very top of the barrel (above the `export ...` lines):
  ```typescript
  import './skillExecutor/adapter-registration.js';  // side-effect: registerAdapter('worker', ...) at module load
  ```
- Confirm the side-effect import is the FIRST `import` statement in the barrel — `registerAdapter` must run at module load BEFORE any consumer dispatches a worker-routed action.

**Dependencies**
- Chunks 9 (`handlers/pages.ts`) AND 12 (`handlers/delegation.ts`) — both target modules must exist.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.
- The single-call invariant (`registerAdapter('worker', ...)` runs exactly once at module load) is CI-checked via `__tests__/registerOptimiserSchedulePure.test.ts` and `optimiser/__tests__/verificationMatrix.test.ts` which both `vi.mock('../skillExecutor.js', ...)` — the barrel-as-mock-target path must keep resolving. No targeted local run needed.

---

## Chunk 14 — Registry assembly + barrel thinning

**Files**
- Create `server/services/skillExecutor/registry.ts` (new).
- Modify `server/services/skillExecutor.ts` (final barrel shape).

**Code moved**
- The three-piece source-file shape consolidates:
  - Main `SKILL_HANDLERS` literal (line 439).
  - `Object.assign(SKILL_HANDLERS, {...})` block at line 2210 (10 support.* slugs — already moved in Chunk 11).
  - `Object.assign(SKILL_HANDLERS, {...})` block at line 2374 (6 calendar.* + 6 slack.* slugs — already moved in Chunk 11).
- The `skillExecutor` constant `{ execute }` (lines 2495-2533) moves to `registry.ts`.
- The private `SkillExecutionParams` interface (lines 231-243) moves to `registry.ts` (private symbol, no public-surface change).

**Symbol assembly in `registry.ts`**
- Import every `handlers/*` family module's exported `Record<string, SkillHandler>` map (or individual named slugs where modules export per-slug):
  ```typescript
  import { webHandlers } from './handlers/web.js';
  import { workspaceHandlers } from './handlers/workspace.js';
  import { taskHandlers } from './handlers/tasks.js';
  import { handoffHandlers } from './handlers/handoff.js';
  import { devContextHandlers } from './handlers/devContext.js';
  import { pageHandlers } from './handlers/pages.js';
  import { workflowStudioHandlers } from './handlers/workflowStudio.js';
  import { skillStudioHandlers } from './handlers/skillStudio.js';
  import { methodologyStubHandlers } from './handlers/methodologyStubs.js';
  import { autoGatedStubHandlers } from './handlers/autoGatedStubs.js';
  import { reviewGatedProposerHandlers } from './handlers/reviewGatedProposers.js';
  import { systemMonitorShellHandlers } from './handlers/systemMonitorShells.js';
  import { optimiserShellHandlers } from './handlers/optimiserShells.js';
  import { spendShellHandlers } from './handlers/spendShells.js';
  import { configShellHandlers } from './handlers/configShells.js';
  import { capabilityDiscoveryHandlers } from './handlers/capabilityDiscovery.js';
  import { crmHandlers } from './handlers/crm.js';
  import { orgInsightHandlers } from './handlers/orgInsights.js';
  import { outputHandlers } from './handlers/output.js';
  import { threadContextHandlers } from './handlers/threadContext.js';
  import { notifyOperatorHandlers } from './handlers/notifyOperator.js';
  import { memoryBlockHandlers } from './handlers/memoryBlock.js';
  import { financialReportingHandlers } from './handlers/financialReporting.js';
  import { mediaTranscriptionHandlers } from './handlers/mediaTranscription.js';
  import { digestHandlers } from './handlers/digest.js';
  import { thinDispatcherHandlers } from './handlers/thinDispatchers.js';
  import { memoryHandlers } from './handlers/memory.js';
  import { supportHandlers } from './handlers/support.js';
  import { calendarHandlers } from './handlers/calendar.js';
  import { slackHandlers } from './handlers/slack.js';
  import { metaHandlers } from './handlers/meta.js';
  ```
- Exported `SKILL_HANDLERS`:
  ```typescript
  export const SKILL_HANDLERS: Record<string, SkillHandler> = {
    ...metaHandlers,
    ...webHandlers,
    ...workspaceHandlers,
    ...memoryHandlers,
    ...taskHandlers,
    ...handoffHandlers,
    ...devContextHandlers,
    ...pageHandlers,
    ...workflowStudioHandlers,
    ...skillStudioHandlers,
    ...methodologyStubHandlers,
    ...autoGatedStubHandlers,
    ...reviewGatedProposerHandlers,
    ...systemMonitorShellHandlers,
    ...optimiserShellHandlers,
    ...spendShellHandlers,
    ...configShellHandlers,
    ...capabilityDiscoveryHandlers,
    ...crmHandlers,
    ...orgInsightHandlers,
    ...outputHandlers,
    ...threadContextHandlers,
    ...notifyOperatorHandlers,
    ...memoryBlockHandlers,
    ...financialReportingHandlers,
    ...mediaTranscriptionHandlers,
    ...digestHandlers,
    ...thinDispatcherHandlers,
    ...supportHandlers,
    ...calendarHandlers,
    ...slackHandlers,
  };
  ```
- Exported `skillExecutor` (closure over `SKILL_HANDLERS`):
  ```typescript
  export const skillExecutor = {
    async execute(params: SkillExecutionParams): Promise<unknown> {
      // body unchanged from source lines 2496-2532
    },
  };
  ```
- Private `SkillExecutionParams` interface declared in this file (not exported).

**Imports `registry.ts` needs**
- `import type { SkillExecutionContext, SkillHandler } from './context.js';`
- All 31 `handlers/*` imports above.
- Per spec §5.3 explicitly NOT imported: pipeline (registry doesn't dispatch processors directly; per-handler does), gating (same).

**Barrel final shape (per spec §5.7)**
- The entire post-Chunk-13 barrel collapses to:
  ```typescript
  // server/services/skillExecutor.ts (target shape)
  import './skillExecutor/adapter-registration.js';  // side-effect import
  export { skillExecutor, SKILL_HANDLERS } from './skillExecutor/registry.js';
  export type { SkillExecutionContext, SkillHandler } from './skillExecutor/context.js';
  export { registerProcessor, setHandoffJobSender } from './skillExecutor/pipeline.js';
  ```
- All remaining inline content (the empty `SKILL_HANDLERS` literal scaffolding, both `Object.assign(...)` shells, the `skillExecutor` constant, `SkillExecutionParams`) is deleted from the barrel.
- Target barrel size: < 400 LOC per spec §1.

**Dependencies**
- All of Chunks 1-13.

**G1 verification commands**
- `npm run lint`, `npm run typecheck`, `npm run build:server`.
- Targeted: `npx vitest run server/services/__tests__/skillHandlerRegistryEquivalence.test.ts` — registry contract test asserts `SKILL_HANDLERS` slug set is unchanged. MUST pass.

**G2 (end-of-build) verification**
- `npm run lint`, `npm run typecheck`, `npm run build:server`, `npm run build:client`.

---

## Chunk 15 — Caller sweep + doc sync

**Files modified**
- `architecture.md` (one short paragraph in § Skill executor & processor hooks).
- Optionally any consumer in spec §10 that imports a type which moved (left at the barrel by default; updated to canonical path only if there's a reason).

**Caller sweep procedure**
1. Run:
   ```bash
   grep -rnE "^import.*from\s+['\"]([^'\"]*)skillExecutor(\.js)?['\"]" server/
   ```
   (per spec §10's filter command — excludes textual references).
2. Verify the result matches spec §10's enumeration. Any new caller found is a spec gap — log and add to spec §10 in a follow-up.
3. For each caller, decide whether to leave it on the barrel re-export (default, preferred) or update to the canonical path under `skillExecutor/`. The barrel preserves all current public exports, so leaving callers on the barrel is correct. Update only if the caller would benefit from import precision (e.g. a type-only consumer pulling from `context.ts` directly).
4. Test-file `vi.mock('../skillExecutor.js', ...)` paths in `registerOptimiserSchedulePure.test.ts`, `optimiser/__tests__/verificationMatrix.test.ts`, `optimiser/__tests__/runOptimiserScanPure.test.ts` MUST still resolve. The barrel exists at `server/services/skillExecutor.ts` — no path change needed.

**Doc sync (per CLAUDE.md §11 and `docs/doc-sync.md`)**
- Update `architecture.md § Skill executor & processor hooks` with one paragraph: barrel at `server/services/skillExecutor.ts`, sibling tree at `server/services/skillExecutor/`, dependency direction is context → pipeline → gating → handlers → registry → barrel (side-effect import of adapter-registration first). Point readers at this build's spec for full conventions.
- No change needed to `docs/doc-sync.md` itself — the rule already covers this.
- No change to `KNOWLEDGE.md` unless the build surfaces a correction worth recording.

**Dependencies**
- All previous chunks (1-14).

**G2 final verification**
- `npm run lint`, `npm run typecheck`, `npm run build:server`, `npm run build:client`.

---

## Cross-chunk dependency graph

```
Chunk 1 (context.ts)
  ├─ Chunk 2 (pipeline.ts)         depends on: 1
  │    └─ Chunk 3 (gating.ts)      depends on: 1, 2
  │         ├─ Chunk 4  (web)       depends on: 1, 2, 3
  │         ├─ Chunk 5  (workspace) depends on: 1, 2, 3
  │         ├─ Chunk 6  (tasks)     depends on: 1, 2, 3
  │         ├─ Chunk 7  (handoff)   depends on: 1, 2, 3
  │         ├─ Chunk 8  (devContext)depends on: 1, 2, 3
  │         ├─ Chunk 9  (pages)     depends on: 1, 2, 3
  │         ├─ Chunk 10 (workflow/skill studio) depends on: 1, 2, 3
  │         ├─ Chunks 10a-10e (stubs / shells)  depend on: 1, 2, 3
  │         ├─ Chunk 11 (memory/support/calendar/slack/meta/userOwnedAgentOwner) depends on: 1, 2, 3
  │         └─ Chunk 12 (delegation) depends on: 1, 2, 3
  ↓
Chunk 13 (adapter-registration)    depends on: 9, 12
  ↓
Chunk 14 (registry + barrel)        depends on: ALL of 1-13
  ↓
Chunk 15 (caller sweep + doc sync)  depends on: 14
```

Chunks 4 through 12 (excluding 9 and 12 which feed Chunk 13) can land in any order after Chunk 3. The spec's order is a recommendation, not a hard constraint, EXCEPT:
- Chunk 9 MUST land before Chunk 13.
- Chunk 12 MUST land before Chunk 13.
- All Chunks 1-13 MUST land before Chunk 14.
- Chunk 14 MUST land before Chunk 15.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A handler moved in Chunk N references a helper that was moved in Chunk M ≠ N, and the cross-edge is missed. | Per-chunk PR description names every moved function AND every still-in-barrel function the new module imports. Builder greps for cross-references before declaring G1 green. |
| The `registerAdapter('worker', ...)` side effect fails to run at the right time. | Chunk 13 places `import './skillExecutor/adapter-registration.js';` as the FIRST import line in the barrel. ESM guarantees side-effect imports run before the rest of the barrel evaluates. |
| `vi.mock('../skillExecutor.js', ...)` test paths break. | The barrel stays at `server/services/skillExecutor.ts` for the whole build. No mock path changes. |
| Slug-set drift — a slug is moved twice (claimed by two family modules) or missed entirely. | Spec §5.2.1 slug-placement precedence rule (domain-module from §5.2 wins over stub-module from §5.2.1). Chunk 14's `skillHandlerRegistryEquivalence.test.ts` run is the slug-set contract check. |
| `executeMethodologySkill` moved to Chunk 10a but Chunk 4/5/6/7/8/9/10 ship before 10a and need the helper. | Chunks 4-9 do NOT reference `executeMethodologySkill`. Chunk 10 (workflowStudio/skillStudio) does NOT reference it. Chunks 10a-10e land independently. If a chunk surprises a builder with an `executeMethodologySkill` reference, that's an indicator the slug should have been in 10a — log and re-route. |
| `enqueueHandoff` cross-edge: Chunks 6 (tasks) and 7 (handoff) both import it from Chunk 2's `pipeline.ts`. If pipeline export was missed, both chunks fail. | Chunk 2 explicitly exports `enqueueHandoff`. Plan §"Chunk 2 — Symbols moved" names it. |
| Barrel intermediate-state size drifts toward unmanageable during Chunks 4-12 (each chunk leaves the barrel slightly smaller, but not necessarily monotonically). | Acceptable — Chunk 14 is the cleanup checkpoint. Builders run lint+typecheck+build:server per chunk; the in-progress shape compiles cleanly throughout. |

## Self-consistency notes

- Chunk numbering matches spec §7 exactly: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10a, 10b, 10c, 10d, 10e, 11, 12, 13, 14, 15. No renumbering. No skipped chunks.
- Adapter-registration extraction is Chunk 13, after Chunks 9 (pages) and 12 (delegation) — preserves the §5.3 DAG, no cyclic imports.
- The `skillExecutor` constant + private `SkillExecutionParams` interface live in `registry.ts` per spec §5.7. They move in Chunk 14, not Chunk 1.
- The two `Object.assign(SKILL_HANDLERS, {...})` blocks dissolve in Chunk 11 (slug moves to family modules) and Chunk 14 (assembly via spread). No `Object.assign` survives Chunk 14.
- Test-collocation rule (spec §5.6) honoured: no test file moves; only test-file imports may update.

---

**Deviations from spec chunk numbering: NONE.**

