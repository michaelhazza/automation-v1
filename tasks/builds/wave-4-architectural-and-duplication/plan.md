---
status: READY
date: 2026-05-16
author: architect (claude opus 4.7 1m)
build_slug: wave-4-architectural-and-duplication
spec_path: tasks/builds/wave-4-architectural-and-duplication/spec.md
spec_status: ACCEPTED
chunk_count: 16
---

# Wave 4 Session H — implementation plan

Plan for the largest single build in the Wave 3+4 consolidation push. 1 architectural refactor (CD1 super-cycle break via handler-injection) + 8 duplication extractions (DUP1-DUP5, DUP7-DUP9) + 4 frontend complexity items (FE1, FE4, FE5+FE6).

Spec is ACCEPTED (spec-reviewer 3 iterations READY_FOR_BUILD + chatgpt-spec-review 2 rounds APPROVED). This plan refines spec §9's 16-chunk shape with forward-only dependencies and exact module contracts.

## Table of contents

1. Model-collapse check
2. Architecture notes
   - A1. Handler-injection pattern (CD1) — design rationale
   - A2. Duplication extractions — three-similar-lines rule already exceeded
   - A3. Frontend complexity — bias to deletion, not relocation
   - A4. Test gates are CI-only
3. Chunk-0 deliverables (CD0.1–CD0.6)
4. Dependency graph
5. Stepwise implementation plan (Chunks 0–15)
6. UX considerations
7. Risks & mitigations
8. Plan-shape concerns surfaced for operator adjudication
9. Executor notes

---

## Model-collapse check

N/A. This is a structural refactor (cycle break + extraction + UI trim/extract). No ingest → extract → transform → render pipeline; no LLM steps to collapse into a single structured-output call. All work moves existing code; nothing is generated. Reject collapse — there is no model call to consolidate.

---

## Architecture notes

### A1. Handler-injection pattern (CD1) — design rationale

**Pattern:** `HandlerContext` is a structurally-typed record passed as the LAST parameter to every skill handler and every workflow queue-lifecycle handler. Handlers consume it with `import type` only (TypeScript erases at compile time). The factory at `server/lib/buildHandlerContext.ts` is the only place where `WorkflowEngineService` and `skillExecutor` value-imports meet.

**Why this works:**
- Handlers never `import { skillExecutor }` or `import { WorkflowEngineService }` — they only `import type { HandlerContext }`. TypeScript's `import type` is erased before bundling, so no runtime import edge is created.
- The factory module (`buildHandlerContext.ts`) is a leaf — nothing imports it except `server/index.ts` and the two registration entry points (`skillExecutor/registry.ts` for handler dispatch, `workflowEngine/queueLifecycle/registerWorkers.ts` for engine wiring).
- The cycle is broken because the only file that touches both `WorkflowEngineService` and `skillExecutor` is `buildHandlerContext.ts`, and nothing in the engine or executor graphs imports it.

**Patterns considered and rejected:**
- *Full DI framework (InversifyJS, tsyringe).* Rejected per spec §5.3 — over-engineered for a single boundary. The hand-rolled factory + interface ships the same isolation properties without the framework footprint.
- *Lazy `await import()` in handlers.* This is the CURRENT mitigation in the codebase (e.g. `handlers/workflowStudio.ts:184`, `handlers/workflowStudio.ts:15`). It works but obscures the dependency graph from static analysis (madge sees no edge), masks regressions (a new direct import re-introduces the cycle silently), and creates per-call overhead. Replacing dynamic imports with explicit context injection makes dependencies visible at the type system level.
- *Service locator (a single `registry` object that resolves arbitrary services by string key).* Rejected per spec §5.2.3 governance invariant — service locators bloat indefinitely and hide which handler depends on which service. Constraining `HandlerContext` to a small typed surface keeps the dependency graph readable.

**Governance enforcement (spec §5.2.3):** every method on the master `HandlerContext` (and any future sub-context) must have a documented cycle-break justification. Additions without one are rejected at PR review. This is the only rule that prevents the pattern from drifting into a service locator over time.

**Sub-context split rule:** if any handler in chunk 0's inventory has more than 5 service dependencies, those dependencies are grouped into a domain-specific sub-context (e.g. `WorkflowDispatchContext`, `SkillInvocationContext`) rather than bloated onto the master interface. Hard cap on the master interface: ~12 methods total before splitting.

### A2. Duplication extractions — three-similar-lines rule already exceeded

DUP1-DUP9 each have 2 or 3 callers — past the threshold where extraction is justified. The pattern is mechanical: extract to a named module, import from each call site, delete the duplicate body. No abstraction-for-the-future — these are extractions of code that EXISTS in three places today.

**Module placement rationale:**
- Client UI extractions land under `client/src/components/<domain>/` matching the existing convention (e.g. `client/src/components/pulse/`, `client/src/components/org-settings/`).
- Server helper extractions land alongside the existing service folder (e.g. `server/services/templates/templateHelpers.ts` neighbours `server/services/hierarchyTemplateService.ts`).
- The factory job extraction (`server/jobs/lib/definePruneJob.ts`) lives in a new `server/jobs/lib/` folder — matches the established pattern of `server/lib/` for primitive helpers.

**Canonical ownership (spec §6.6, §6.8):** for DUP7 and DUP9, the extracted module is the SOLE source of truth post-extraction. The two source services MUST NOT retain parallel private copies. Any future caller that needs the same helper imports from the canonical module; if it needs a variant, it extends the shared helper (new parameter or new named export in the same module) — never a per-service re-implementation. Acceptance criteria for chunks 10 and 12 include a grep check that the source services contain zero copies of the extracted helpers' bodies.

### A3. Frontend complexity — bias to deletion, not relocation

**FE1 (HomePage trim):** removing 4 KPI tiles is deletion, not extraction. Per the frontend design principles ("default to hidden — KPI tiles: 0 by default"), the simpler page IS the better page. The hero RunActivityChart stays because it answers the page's primary task (operator sees live activity).

**FE4 (SystemIncidentsPage extraction):** extraction is structural — the drawer already exists as an inline `IncidentDetailDrawer` function inside the page file (line 116). Lifting it to its own file preserves rendering exactly and reduces the parent file from 491 LOC to ~250. The five FE4 success criteria (spec §7.2) — independent testability, prop boundary clarity, reduced render branching, reduced hook density, reduced cognitive load — are evaluated by chunk 13 pr-reviewer; LOC-reduction-only is NOT sufficient.

**FE5+FE6 (4 dashboard pages):** ACCEPT verdict default. These are admin/power-user pages where complexity is intentional. Adding a header acceptance comment turns implicit acceptance into documented acceptance — future audits will not re-flag them.

### A4. Test gates are CI-only — no full-suite runs in this plan

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Each chunk's "Verification commands" section lists ONLY: `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` / `npm run build:client` when relevant, and `npx vitest run <path>` for tests authored in THAT chunk. Nothing else.

---

## Chunk-0 deliverables

The architect resolves these BEFORE chunks 1-15 begin. Default values below; chunk 0 confirms or replaces each. Operator approval required for all six before chunk 1 starts.

### CD0.1 — HandlerContext method set (spec §5.2.1, §5.2.3)

Master `HandlerContext` interface — 5 methods, each with a cycle-break justification. Well under the 12-method cap; no sub-context split needed at chunk 0.

| Method | Cycle-break justification |
|---|---|
| `workflowEngine.enqueueTick(runId: string)` | Replaces dynamic `await import('../../workflowEngineService.js')` calls in skill handlers that need to wake the engine after producing workflow-relevant state changes. Currently a value edge that re-introduces if the dynamic import becomes static. |
| `workflowEngine.tick(runId: string)` | Direct kick from skill handlers used in the synchronous workflow-start path. Same cycle-break basis as `enqueueTick`. |
| `workflowEngine.dispatchStep(run, def, step, liveStepRuns)` | Used by the post-skill-completion bridge inside `workflowActionCallExecutor` (currently `import { skillExecutor } from './skillExecutor.js'`). Lifting `dispatchStep` to the context lets the bridge live in a neutral file. |
| `workflowEngine.startWorkflowRun(input, context)` | Replaces dynamic import of `workflowRunStartSkillService` from `handlers/workflowStudio.ts:184`. Today's dynamic import obscures the cycle from madge but the value edge exists; injection makes it explicit and safe. |
| `skillExecutor.execute({skillName, input, context, toolCallId})` | Used by `workflowActionCallExecutor` to dispatch a skill from a workflow step. Today `import { skillExecutor } from './skillExecutor.js'` (line 25). Injection collapses the value edge into the boot-time factory only. Method name matches the real export at `server/services/skillExecutor/registry.ts:296-334` (verified 2026-05-16). |

Chunk 1 confirms each method's signature against actual call sites. If chunk 1 surfaces a 6th candidate method, it is added if-and-only-if it has a cycle-break justification (no convenience methods, per §5.2.3). If 12 methods are exceeded, split into `WorkflowDispatchContext` (engine-side) and `SkillInvocationContext` (skill-side) per spec §10 risk register.

**Spec update: NONE required at chunk 0.** Spec §5.2.2's example is conceptual; chunk 1 lands the concrete interface and the spec's example remains accurate.

### CD0.2 — DUP7 export names (spec §6.6)

Helpers in `server/services/templates/templateHelpers.ts`, all named exports:

| Export | Source | Purpose |
|---|---|---|
| `computeManifestHash(manifest: Record<string, unknown>): string` | `hierarchyTemplateService.ts:15-17` + `systemTemplateService.ts:20-22` (identical bodies) | SHA-256 of canonicalised manifest JSON |
| `slugify(text: string): string` | `hierarchyTemplateService.ts:23-25` + `systemTemplateService.ts:28-30` (identical bodies) | Lowercase + alphanumeric-dash slug normaliser |
| `PARSER_VERSION: string` | `hierarchyTemplateService.ts:13` + `systemTemplateService.ts:18` (both `'1.0.0'`) | Manifest parser version constant |

**Spec update at chunk 0:** spec §6.6 acceptance line gains a bullet `chosen exports: computeManifestHash, slugify, PARSER_VERSION`. Chunk 0 commits the spec edit before chunk 10 begins.

### CD0.3 — DUP9 export name (spec §6.8)

Single named export in `server/services/actions/dispatchHelper.ts`:

```typescript
export async function dispatchWithDraftClaim<T>(args: {
  draftId: string;
  ctx: { organisationId: string; subaccountId: string; ownerUserId: string; _dispatchPreClaimed?: boolean };
  performDispatch: () => Promise<T>;
  resolveSentId: (result: T) => string;
}): Promise<T>;
```

Encapsulates the "claim send if not pre-claimed → call provider → markSendFailed on error → markSent on success" envelope shared by `calendarActionService.createEvent/updateEvent/respondToInvite` and `slackActionService.sendMessage`.

**Spec update at chunk 0:** spec §6.8 acceptance line gains `chosen export: dispatchWithDraftClaim`. Chunk 0 commits the edit before chunk 12 begins.

### CD0.4 — FE4 sub-component names (spec §4.1 FE4 sub-table, §7.2)

Two extractions, no third needed. Confirmed against `client/src/pages/SystemIncidentsPage.tsx`:

| Path | Source range (verified) | Notes |
|---|---|---|
| `client/src/components/system-incidents/IncidentDetailDrawer.tsx` | Lines 116-322 (already exists as inline function `IncidentDetailDrawer`) | Lift verbatim; props are `{ incident, onClose, onAck, onResolve, onSuppress }` (≤6 props per §7.2) |
| `client/src/components/system-incidents/IncidentTimeline.tsx` | Lines 240-260 of original (the `<h3>Timeline</h3>` block inside the drawer) | Lift the timeline pane to its own component; props are `{ events, loading }` |

Parent file post-extraction sits at ~250 LOC (well under 400). Third extraction is NOT needed.

**Spec update at chunk 0:** spec §4.1 FE4 sub-table column "Path" updated to drop `(placeholder name; chunk 0 confirms)` qualifier on both rows. The third-extraction row is removed (default path uses 2 sub-components).

### CD0.5 — FE1 trim decision (spec §7.1)

**Default verdict accepted:** remove ALL 4 MetricCard tiles. Rationale per §7.1: operator-facing page; primary task is "see live activity"; tiles are decoration per the §*default to hidden* principle. RunActivityChart hero stays.

Operator confirms at chunk 0 sign-off (no override expected).

**Spec update at chunk 0:** none required. Default verdict was the binding default.

### CD0.6 — FE5+FE6 per-page acceptance text (spec §7.3)

**Default verdict accepted:** ACCEPT all 4 pages. Header comment copy (single line, no em-dashes per user prefs):

```typescript
// admin/power-user page; complexity intentional; reviewed wave-4 spec §7.3 2026-05-15
```

Applied verbatim as the first line of each of:
- `client/src/pages/ClientPulseDashboardPage.tsx`
- `client/src/pages/ClientPulseDrilldownPage.tsx`
- `client/src/pages/JobQueueDashboardPage.tsx`
- `client/src/pages/SpendLedgerPage.tsx`

Operator confirms at chunk 0 sign-off (no per-page trim instructions expected).

**Spec update at chunk 0:** none required. Default verdict + canonical header copy match spec §7.3.

---

## Dependency graph

```
Chunk 0 (deliverables) ── must complete before all downstream chunks
   │
   ├─→ Chunk 1 (HandlerContext type + factory) ──┐
   │                                              │
   │      Chunk 2 (skillExecutor handler signatures) ──┐
   │                                                    │
   │      Chunk 3 (workflowEngine handler signatures) ──┤
   │                                                    │
   │   Chunk 4 (boot wiring + cycle-gate confirm) ←─────┘  must follow 1+2+3
   │
   ├─→ Chunks 5-12 (DUP extractions; mutually independent; can interleave with 1-4)
   │
   ├─→ Chunk 13 (FE1 trim + FE4 extraction; depends on 0)
   ├─→ Chunk 14 (FE5+FE6 acceptance headers; depends on 0)
   └─→ Chunk 15 (architecture.md update + final review pass; depends on ALL prior)
```

Forward-only. Chunks 5-12 can interleave with 1-4 because they touch disjoint files. Chunks 13-14 depend only on chunk 0. Chunk 15 closes the build.

---

## Stepwise implementation plan

### Chunk 0 — Scope verification, file-set sweep, deliverables lock

**spec_sections:** §0, §4.1, §5.2.1, §5.2.3, §6.6, §6.8, §7.1, §7.2, §7.3, §9 (chunk 0 row), §10

**Module shape:**
- *Public interface this chunk exposes:* the six chunk-0 deliverables (CD0.1-CD0.6) above, locked into the spec at chunk-0 commit.
- *What stays hidden behind it:* the architect's exploration of handler call sites, helper bodies, and component boundaries that informed the deliverables.

**Files to create or modify:**
- Modify `tasks/builds/wave-4-architectural-and-duplication/spec.md` — apply CD0.2 (§6.6 export names), CD0.3 (§6.8 export name), and CD0.4 (§4.1 FE4 sub-table cleanup) edits per the chunk-0 deliverables above.
- Modify `tasks/builds/wave-4-architectural-and-duplication/progress.md` — record chunk-0 sign-off, operator confirmation of FE1/FE4/FE5+FE6 verdicts, and HandlerContext method set commitment.
- Re-read all files cited in spec §1.1 (present-state verification table) to confirm none have moved or been split since 2026-05-16 verification pass; record any drift in progress.md as a pre-Chunk-1 fix-up note.

**Contracts:**
- HandlerContext method set (5 methods, table CD0.1)
- DUP7 export set (3 exports, table CD0.2)
- DUP9 export name (`dispatchWithDraftClaim`, signature CD0.3)
- FE4 sub-component paths and props (table CD0.4)

**Error handling:**
- If any source file from spec §1.1 has moved/been split, surface as a chunk-0 blocker. Do NOT proceed to chunk 1 — operator decides whether to update the spec or rebase first.
- If chunk 0 surfaces a 6th HandlerContext method that DOES have a cycle-break justification, add it (CD0.1 table updated). If a candidate method does NOT have one, reject it and re-plan that specific cycle differently.
- If chunk 0 surfaces a handler with >5 service dependencies (per spec §10 risk register), split the master `HandlerContext` into `WorkflowDispatchContext` + `SkillInvocationContext` (or domain-specific names appropriate to the dependency) and update CD0.1 + spec §5.2.1 method-set-cap row before chunk 1 begins.

**Test considerations:**
- This chunk authors no code and no tests. The output is spec edits + a chunk-0 sign-off.

**Dependencies:** none.

**Acceptance:**
- All six CD0.x deliverables locked.
- Spec §6.6, §6.8, §4.1 FE4 sub-table updated.
- Operator has approved CD0.5 (FE1 trim) and CD0.6 (FE5+FE6 acceptance text) — no override.
- progress.md records chunk-0 sign-off with timestamp.

**Verification commands:**
- None. Chunk 0 is documentation only.

---

### Chunk 1 — Author HandlerContext type module + buildHandlerContext factory

**spec_sections:** §5.2.1, §5.2.2, §5.2.3, §5.4

**Module shape:**
- *Public interface this chunk exposes:* `interface HandlerContext` from `handlerContextTypes.ts`; `buildHandlerContext()` from `buildHandlerContext.ts`. Both are zero-cost imports for any file that needs them.
- *What stays hidden behind it:* the choice of `Pick<typeof Service, 'method'>` vs hand-written method signatures (chunk 1 commits to whichever produces cleaner type errors against existing handler call sites — likely `Pick`); the `import type` discipline at the type module level.

**Files to create or modify:**
- Create `server/services/handlerContextTypes.ts` (~30 LOC; pure type-only module).
- Create `server/lib/buildHandlerContext.ts` (~30 LOC; boot-time factory).

**Contracts:**

```typescript
// server/services/handlerContextTypes.ts
import type { WorkflowEngineService } from './workflowEngineService.js';
import type { skillExecutor } from './skillExecutor.js';
import type { SkillExecutionContext } from './skillExecutor.js';

export interface HandlerContext {
  workflowEngine: Pick<typeof WorkflowEngineService, 'enqueueTick' | 'tick' | 'dispatchStep'> & {
    startWorkflowRun: (input: Record<string, unknown>, ctx: SkillExecutionContext) => Promise<unknown>;
  };
  skillExecutor: Pick<typeof skillExecutor, 'execute'>;
}
```

```typescript
// server/lib/buildHandlerContext.ts
import { WorkflowEngineService } from '../services/workflowEngineService.js';
import { skillExecutor } from '../services/skillExecutor.js';
import { handleWorkflowRunStartSkill } from '../services/workflowRunStartSkillService.js';
import type { HandlerContext } from '../services/handlerContextTypes.js';

export function buildHandlerContext(): HandlerContext {
  return {
    workflowEngine: {
      enqueueTick: WorkflowEngineService.enqueueTick,
      tick: WorkflowEngineService.tick,
      dispatchStep: WorkflowEngineService.dispatchStep,
      startWorkflowRun: handleWorkflowRunStartSkill,
    },
    skillExecutor: {
      execute: skillExecutor.execute,
    },
  };
}
```

**Live-export verification — REQUIRED before chunk 1 commits the contract** (per chatgpt-plan-review R1 F1 fix, 2026-05-16):

Before authoring the type module, chunk 1 MUST run:

```bash
grep -nE "^\s+[a-zA-Z_][a-zA-Z0-9_]*," server/services/workflowEngineService.ts | head -40
grep -nE "^\s+async\s+[a-zA-Z_]|^\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(" server/services/skillExecutor/registry.ts | head -20
```

Confirm BEFORE writing the contract that:
- `WorkflowEngineService.enqueueTick`, `WorkflowEngineService.tick`, `WorkflowEngineService.dispatchStep` all exist as methods on the const facade (verified 2026-05-16 at `server/services/workflowEngineService.ts:38-64`).
- `skillExecutor.execute(params: SkillExecutionParams): Promise<unknown>` exists with that exact shape (verified 2026-05-16 at `server/services/skillExecutor/registry.ts:296-334`).
- `handleWorkflowRunStartSkill` is exported from `server/services/workflowRunStartSkillService.ts` with the expected signature.

If ANY method name differs from the contract above (e.g. renamed, moved, deleted on a parallel main commit), chunk 1 STOPS, updates CD0.1 with the actual name, edits this contract in the same commit, then proceeds. Do NOT define a `Pick<typeof X, 'methodName'>` with a method name that doesn't exist on `X` — it fails compilation immediately and produces a confusing type error.

If `skillExecutor.execute` has been renamed (unlikely but possible), use the new name in the `Pick<>`. Do NOT add a wrapper that renames the method; match the real export verbatim.

If `dispatchStep` and/or `tick` are NOT facade methods at chunk 1 time (e.g. main has refactored them into a sibling module), use explicit function-type imports from their real module instead of `Pick<typeof WorkflowEngineService, ...>`:

```typescript
// fallback shape if facade no longer re-exports tick/dispatchStep
import type { tick } from './workflowEngine/queueLifecycle/tick.js';
import type { dispatchStep } from './workflowEngine/queueLifecycle/dispatch.js';
// ...
workflowEngine: {
  enqueueTick: ...; // whatever shape is available
  tick: typeof tick;
  dispatchStep: typeof dispatchStep;
  startWorkflowRun: (...) => ...;
};
```

**Error handling:**
- Both files are pure. No runtime errors possible at construction time. Type errors on the `Pick<typeof ...>` line surface at compile time and indicate one of: a renamed method on `WorkflowEngineService` (sweep callers), or a missing method (add it to the service first, then refer here).

**Test considerations:**
- One targeted Vitest test at `server/lib/__tests__/buildHandlerContext.test.ts` asserting `buildHandlerContext()` returns an object with the expected method shape. Pure structural test; no DB.

**Dependencies:** chunk 0.

**Acceptance:**
- Both files compile in isolation — `npx tsc --noEmit` exits 0 against the modified server tree.
- `handlerContextTypes.ts` contains zero value-level imports — verify by grep `^import [^t]` returning no lines other than `import type ...`.
- `buildHandlerContext.ts` is the only NEW file that imports both `WorkflowEngineService` and `skillExecutor` as values — verify by grep across `server/`.
- Targeted Vitest test passes via `npx vitest run server/lib/__tests__/buildHandlerContext.test.ts`.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:server`
- `npx vitest run server/lib/__tests__/buildHandlerContext.test.ts`

---

### Chunk 2 — Migrate skillExecutor handlers + registry to accept HandlerContext

**spec_sections:** §5.2.1 (Position in handler signature), §5.2.3 (Governance invariant), §9 (Chunk 2 row)

**Module shape:**
- *Public interface this chunk exposes:* updated handler signatures across all 24 `server/services/skillExecutor/handlers/*.ts` files — `(input, context, handlerContext) => Promise<unknown>`. Updated `SkillHandler` type in `server/services/skillExecutor/context.ts`. Updated `SKILL_HANDLERS` registry shape in `server/services/skillExecutor/registry.ts`.
- *What stays hidden behind it:* per-handler refactoring of dynamic `await import(...)` calls into `handlerContext.workflowEngine.*` / `handlerContext.skillExecutor.*` calls; the audit of which handlers actually need the context (most do not).

**Files to create or modify:**

Modify `server/services/skillExecutor/context.ts`:
- Update `SkillHandler` type to accept the 3rd parameter: `(input, context, handlerContext) => Promise<unknown>`.

Modify `server/services/skillExecutor/registry.ts`:
- Update `SKILL_HANDLERS` arrow signatures to forward `handlerContext` as the 3rd argument.
- Update `skillExecutor.execute` to accept and forward `handlerContext`.

Modify the 24 handler files under `server/services/skillExecutor/handlers/`:
- Add `handlerContext: HandlerContext` parameter to handler functions THAT ACTUALLY USE IT (audit during chunk; most handlers don't touch the workflow engine).
- For handlers that today use `await import('../../workflowEngineService.js')` or `await import('../../workflowRunStartSkillService.js')` (e.g. `workflowStudio.ts:184`), replace with `handlerContext.workflowEngine.startWorkflowRun(input, context)` and remove the dynamic import.
- For handlers that don't use the workflow engine, ADD the parameter to keep the registry signature uniform but mark it `_handlerContext` to satisfy the no-unused-vars lint.

**Contracts:**

```typescript
// server/services/skillExecutor/context.ts (modified)
export type SkillHandler = (
  input: Record<string, unknown>,
  context: SkillExecutionContext,
  handlerContext: HandlerContext,
) => Promise<unknown>;
```

```typescript
// server/services/skillExecutor/registry.ts (modified, illustrative entry)
'workflow.run.start': async (input, context, handlerContext) => {
  return handlerContext.workflowEngine.startWorkflowRun(input, context);
},
```

**Error handling:**
- TypeScript surfaces missing `handlerContext` parameters at compile time. Fix every call site before declaring chunk done.
- If a handler's existing signature includes a fourth ambiguous arg (none observed at chunk 0, but verify), append `handlerContext` after; do NOT reorder existing args.
- If a handler that today calls `WorkflowEngineService.enqueueTick` directly (none observed at chunk 0) is found, refactor to `handlerContext.workflowEngine.enqueueTick`.

**Test considerations:**
- Existing Vitest tests under `server/services/__tests__/` that exercise handlers (e.g. `workflowRunDepthEntryGuard.test.ts`, `workflowRunStartSkillPure.test.ts`) MUST continue to pass — they synthesise their own handlerContext via small test fixtures or pass `undefined as never` if they don't exercise the workflow engine. Update them in this chunk.
- Author one new Vitest test at `server/services/skillExecutor/__tests__/registry.handlerContextForwarding.test.ts` asserting that `skillExecutor.execute({skillName: 'workflow.run.start', input, context, handlerContext})` calls `handlerContext.workflowEngine.startWorkflowRun` with the right arguments. Use a stub `handlerContext`.

**Dependencies:** chunk 1.

**Acceptance:**
- All `await import('../../workflowEngineService.js')` and `await import('../../workflowRunStartSkillService.js')` calls in `server/services/skillExecutor/handlers/**` are removed and replaced with `handlerContext.*` calls — verify by grep `await import.*workflow` returning zero hits in that directory.
- `SkillHandler` type and `SKILL_HANDLERS` registry both accept the 3-arg signature; `npx tsc --noEmit` exits 0.
- Targeted Vitest tests pass.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:server`
- `npx vitest run server/services/skillExecutor/__tests__/registry.handlerContextForwarding.test.ts`
- `npx vitest run server/services/__tests__/workflowRunDepthEntryGuard.test.ts`
- `npx vitest run server/services/__tests__/workflowRunStartSkillPure.test.ts`

---

### Chunk 3 — Migrate workflowEngine queue-lifecycle handlers + dispatch to accept HandlerContext

**spec_sections:** §5.2.1, §5.2.3, §9 (Chunk 3 row)

**Module shape:**
- *Public interface this chunk exposes:* updated function signatures on `dispatch.ts`, `agentStep.ts`, `tick.ts`, `watchdog.ts`, `registerWorkers.ts` — each accepts `handlerContext: HandlerContext` as the LAST parameter where the function needs to invoke a skill. The `WorkflowEngineService` facade (`server/services/workflowEngineService.ts`) re-exports updated function signatures.
- *What stays hidden behind it:* internal threading of `handlerContext` through `dispatchStep` → `workflowActionCallExecutor.executeActionCall` → into the eventual `skillExecutor.execute` call. Replaces the static `import { skillExecutor } from './skillExecutor.js'` in `workflowActionCallExecutor.ts`.

**Files to create or modify:**

Modify `server/services/workflowActionCallExecutor.ts`:
- Replace `import { skillExecutor, type SkillExecutionContext } from './skillExecutor.js';` with `import type { SkillExecutionContext } from './skillExecutor.js';` + `import type { HandlerContext } from './handlerContextTypes.js';`.
- Add `handlerContext: HandlerContext` as the LAST parameter to `executeActionCall(args, handlerContext)`.
- Replace `skillExecutor.execute({...})` with `handlerContext.skillExecutor.execute({...})` — same method name; the only change is the routing path (handlerContext-mediated instead of direct value-import).

Modify `server/services/workflowEngine/queueLifecycle/dispatch.ts`:
- Add `handlerContext: HandlerContext` as the LAST parameter to `dispatchStep(run, def, step, liveStepRuns, handlerContext)`.
- Forward `handlerContext` to `executeActionCall(args, handlerContext)`.

Modify `server/services/workflowEngine/queueLifecycle/agentStep.ts`:
- Add `handlerContext: HandlerContext` parameter to `onAgentRunCompleted(stepRunId, result, agentRunId, handlerContext)` IF AND ONLY IF the function transitively reaches a skill dispatch path. Audit in this chunk; most likely needed because completion can re-dispatch.

Modify `server/services/workflowEngine/queueLifecycle/tick.ts`:
- Add `handlerContext: HandlerContext` parameter to `tick(runId, handlerContext)`.
- Forward to `dispatchStep(...)`.

Modify `server/services/workflowEngine/queueLifecycle/watchdog.ts`:
- Add `handlerContext: HandlerContext` parameter to `watchdogSweep(handlerContext)` if it transitively dispatches.

Modify `server/services/workflowEngine/queueLifecycle/registerWorkers.ts`:
- Add `handlerContext: HandlerContext` parameter to `registerWorkers(handlerContext)`.
- Pass `handlerContext` to `tick(data.runId, handlerContext)` and `watchdogSweep(handlerContext)` inside the worker handlers.
- The `agentExecutionService` dynamic import inside the AGENT_STEP_QUEUE worker (line 117) stays — that is a separate cycle that this build does NOT scope. Comment it as `// out-of-scope-CD: this dynamic import is a separate cycle, not CD1.`

Modify `server/services/workflowEngineService.ts` (facade):
- Update re-exported function signatures to match. The facade itself does not import `handlerContext` — it just re-exports.

**Contracts:**

```typescript
// server/services/workflowActionCallExecutor.ts (modified signature)
export async function executeActionCall(
  args: ActionCallExecuteArgs,
  handlerContext: HandlerContext,
): Promise<ActionCallExecuteResult>;
```

```typescript
// server/services/workflowEngine/queueLifecycle/dispatch.ts (modified signature)
export async function dispatchStep(
  run: WorkflowRun,
  def: WorkflowDefinition,
  step: WorkflowStep,
  liveStepRuns: WorkflowStepRun[],
  handlerContext: HandlerContext,
): Promise<void>;
```

**Error handling:**
- Same as chunk 2 — TypeScript surfaces missing parameters at compile time. Fix every call site.
- If an existing test fixture invokes `dispatchStep` directly (search `server/services/__tests__/`), update the fixture to pass a stub `handlerContext`.

**Test considerations:**
- Existing tests under `server/services/__tests__/dispatcherDefenceInDepthPure.test.ts`, `workflowEngineApprovalResumeDispatch.integration.test.ts` need their fixtures updated to pass a stub `handlerContext`.
- Author one new Vitest test at `server/services/__tests__/dispatchHandlerContextForwarding.test.ts` asserting that `dispatchStep` forwards `handlerContext` into `executeActionCall`. Stub all DB and network.

**Dependencies:** chunk 1. Independent of chunk 2 (touches different files); can run in parallel with chunk 2.

**Acceptance:**
- `workflowActionCallExecutor.ts` no longer value-imports `skillExecutor` — verify by grep `^import \{ skillExecutor` returning zero hits.
- All function signatures in `server/services/workflowEngine/queueLifecycle/**` accept `handlerContext: HandlerContext` where they reach a skill dispatch.
- `npx tsc --noEmit` exits 0.
- Targeted Vitest tests pass.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:server`
- `npx vitest run server/services/__tests__/dispatchHandlerContextForwarding.test.ts`
- `npx vitest run server/services/__tests__/dispatcherDefenceInDepthPure.test.ts`

---

### Chunk 4 — Boot wiring + CD1 cycle-gate confirmation

**spec_sections:** §5.4 (CD1 gate scope), §5.2.3, §9 (Chunk 4 row), §10

**Module shape:**
- *Public interface this chunk exposes:* the boot sequence in `server/index.ts` constructs `handlerContext = buildHandlerContext()` once and passes it to `WorkflowEngineService.registerWorkers(handlerContext)`. The registry's `skillExecutor.execute` also receives `handlerContext` from its top-level entry points (workflowActionCallExecutor passes it through; agentExecutionLoop, flowExecutorService, optimiser/runOptimiserScan synthesise theirs at boot or per-run).
- *What stays hidden behind it:* the cycle-gate baseline confirmation, the allowlist scope check (per spec §5.4), and the cleanup of any obsolete dynamic imports surfaced when the static graph re-stabilises.

**Files to create or modify:**

Modify `server/index.ts`:
- After `WorkflowEngineService` import block, add:

  ```typescript
  import { buildHandlerContext } from './lib/buildHandlerContext.js';
  // ...
  const handlerContext = buildHandlerContext();
  await WorkflowEngineService.registerWorkers(handlerContext);
  ```

- The `handlerContext` is hoisted module-scope or passed into worker registration paths. Chunk 4 picks the cleaner placement (likely module-scope inside the boot function).

Modify `server/services/agentExecutionLoop.ts`, `server/services/flowExecutorService.ts`, `server/services/optimiser/runOptimiserScan.ts`:
- **Operator decision 2026-05-16: expand the injection sweep to cover these 3 entry-point files.** They value-import `skillExecutor` directly today; chunk 4 makes them construct their own `handlerContext` via `buildHandlerContext()` at their entry point (cheap; pure object construction) and pass it through every `.execute()` call.
- After chunk 4, the only file in `server/` that value-imports `skillExecutor` is `server/lib/buildHandlerContext.ts`. Verify by `grep -rn "from '.*skillExecutor\.js'" server/ | grep -v "import type" | grep -v "buildHandlerContext.ts"` returning ZERO hits.
- Acceptance for each of the 3 files: import the factory (`import { buildHandlerContext } from '../lib/buildHandlerContext.js';`), call it once at the right scope (module-init for long-lived loops; per-job-start for runOptimiserScan), pass `handlerContext` through every internal call chain that reaches `.execute()`.

Modify `server/services/workflowAgentRunHook.ts`, `server/services/workflowRunService.ts`:
- These value-import `WorkflowEngineService` (the engine facade itself, not `skillExecutor`). They are entry points outside the CD1 cycle — the cycle is `skillExecutor ↔ workflowEngine` via queue-lifecycle handlers, not via these two facade-callers. Per operator decision the **value-import of `WorkflowEngineService` from these two files MAY stay** because they sit on the engine side of the boundary and removing the import does NOT break the CD1 cycle. Chunk 4 audits and confirms in a code comment.

Modify `scripts/.gate-baselines/circular-deps.txt`:
- Re-baseline the file. Current baseline = `cycle-count:0`. Post-chunk this should remain 0 — chunk 4 confirms by running `npx madge --circular --json server/ client/ shared/ worker/` (NOT a gate; allowed because it's a single direct invocation, not a `scripts/verify-*.sh` run) and verifying the count is unchanged.
- IF the count INCREASES (chunk 4 surfaces a new cycle from the explicit handler-context wiring), STOP and re-plan that specific handler before declaring chunk done.

Add a code comment at the top of `scripts/verify-no-new-cycles.sh` (or alongside the gate baseline file) per spec §5.4:

```bash
# Gate scope (wave-4 spec §5.4 confirmed 2026-05-XX): this gate runs against the
# full server/ + client/ + shared/ + worker/ graph. There is no allowlist for
# framework/tooling cycles today — current baseline is 0, so any new cycle is
# a regression irrespective of source. If a future tooling cycle becomes
# unavoidable, narrow scope here AND add the corresponding tolerance comment.
```

**Contracts:**

```typescript
// server/index.ts (modified, illustrative)
import { buildHandlerContext } from './lib/buildHandlerContext.js';
// ...
const handlerContext = buildHandlerContext();
await WorkflowEngineService.registerWorkers(handlerContext);
```

**Error handling:**
- If `npx madge --circular` reports MORE cycles than the baseline (currently 0), STOP. Trace the new cycle to its source file and decide whether to (a) fix the offending value import, (b) split into a sub-context, or (c) re-plan that specific handler.
- If `npm run build:server` exits non-zero after wiring, the most likely cause is an entry-point file that was supposed to construct its own `handlerContext` but now has a missing parameter on `tick()` / `dispatchStep()`. Sweep the call sites and fix.

**Test considerations:**
- Author one Vitest test at `server/__tests__/handlerContextWiring.test.ts` asserting that `buildHandlerContext()` returns a context whose `workflowEngine.enqueueTick` and `skillExecutor.execute` are bound to real (not stub) values. This is a structural test — does NOT exercise the engine end-to-end.

**Dependencies:** chunks 1, 2, 3 ALL must land first (this is the wiring layer).

**Acceptance:**
- `server/index.ts` boots without error — `npm run build:server` exits 0.
- `npx madge --circular --json server/ client/ shared/ worker/` reports 0 cycles (baseline preserved).
- `scripts/.gate-baselines/circular-deps.txt` retains `cycle-count:0`.
- `verify-no-new-cycles.sh` config carries the spec §5.4 gate-scope comment.
- The skillExecutor ↔ workflowEngine value-edge is gone — `workflowActionCallExecutor.ts` no longer value-imports `skillExecutor`; `handlers/workflowStudio.ts` no longer dynamic-imports `workflowRunStartSkillService`.
- The **3 entry-point files** (`agentExecutionLoop.ts`, `flowExecutorService.ts`, `optimiser/runOptimiserScan.ts`) no longer value-import `skillExecutor` — each constructs its own `handlerContext` via `buildHandlerContext()` and routes calls through it (per operator decision 2026-05-16, expanded scope from the architect's original carve-out proposal).
- After chunk 4, `buildHandlerContext.ts` is the ONLY file in `server/` that value-imports `skillExecutor` — verify by `grep -rn "from '.*skillExecutor\.js'" server/ | grep -v "import type" | grep -v "buildHandlerContext.ts"` returning ZERO hits.
- Targeted Vitest test passes: `npx vitest run server/__tests__/handlerContextWiring.test.ts`.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:server`
- `npx vitest run server/__tests__/handlerContextWiring.test.ts`

---

### Chunk 5 — DUP1 extraction (Skills history rendering)

**spec_sections:** §6.1

**Module shape:**
- *Public interface this chunk exposes:* `client/src/components/skills/HistoryRender.tsx` exporting `HistoryRender` as the default export — props are `{ history, onSelect?, ... }` per the existing inline component contract.
- *What stays hidden behind it:* the layout, badge logic, and timestamp formatting that today live duplicated in three call sites.

**Files to create or modify:**

Create `client/src/components/skills/HistoryRender.tsx`:
- Lift the rendering body from `client/src/pages/SubaccountSkillsPage.tsx` (213L cloned section) and `client/src/pages/SystemSkillsPage.tsx` (209L cloned section) and `client/src/components/pulse/HistoryTab.tsx`.
- Default export `HistoryRender(props: HistoryRenderProps)`.

Modify `client/src/pages/SubaccountSkillsPage.tsx`:
- Replace the inline rendering body with `<HistoryRender history={history} ... />`.
- Delete the 213L body.

Modify `client/src/pages/SystemSkillsPage.tsx`:
- Same as above; delete the 209L body.

Modify `client/src/components/pulse/HistoryTab.tsx`:
- Same; replace inline rendering with `<HistoryRender ... />`.

**Contracts:**

```typescript
interface HistoryRenderProps {
  history: SkillHistoryItem[]; // existing type from shared/
  onSelect?: (item: SkillHistoryItem) => void;
  // ... full prop set finalised during chunk 5 against the live component
}

export default function HistoryRender(props: HistoryRenderProps): JSX.Element;
```

**Error handling:**
- React rendering errors handled by existing ErrorBoundary; no new error paths introduced.
- If the three call sites' inline rendering bodies have semantic divergence (e.g. one filters, one doesn't), unify by adding the divergence point as a prop (e.g. `filterPredicate?: (item: SkillHistoryItem) => boolean`). DO NOT fork into two components.

**Test considerations:**
- No new tests required (testing posture = static_gates_primary; component is purely presentational).
- Manual smoke test: open Skills pages and HistoryTab in dev to confirm rendering matches pre-extraction.

**Dependencies:** chunk 0.

**Acceptance:**
- All three call sites import `HistoryRender` from `@/components/skills/HistoryRender`.
- The previously-duplicated rendering bodies are deleted from all three call sites.
- `npm run build:client` exits 0.
- jscpd no longer reports the 213L+209L clone pair (CI confirms post-merge; not run locally).

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:client`

---

### Chunk 6 — DUP2 extraction (PermissionsEditor)

**spec_sections:** §6.2

**Module shape:**
- *Public interface this chunk exposes:* `client/src/components/permissions/PermissionsEditor.tsx` named export `PermissionsEditor`, props match the inline `<PermissionsEditor>` already used in `org-settings/PermissionsTab.tsx` and `AdminPermissionSetsPage.tsx`.
- *What stays hidden behind it:* the permission-group rendering, the toggle state machine, and the persistence handler — all internal to the component.

**Files to create or modify:**

Create `client/src/components/permissions/PermissionsEditor.tsx`:
- Lift the 176L triple-clone from `client/src/pages/AdminPermissionSetsPage.tsx` and `client/src/components/org-settings/PermissionsTab.tsx`.
- Named export `PermissionsEditor`.

Modify `client/src/pages/AdminPermissionSetsPage.tsx`:
- Import `{ PermissionsEditor }` from `@/components/permissions/PermissionsEditor`.
- Delete the inline 176L body.

Modify `client/src/components/org-settings/PermissionsTab.tsx`:
- Same; delete the inline body.

**Contracts:**

```typescript
interface PermissionsEditorProps {
  permissions: PermissionSet;
  onChange: (p: PermissionSet) => void;
  readOnly?: boolean;
  // ... full prop set finalised during chunk 6
}

export function PermissionsEditor(props: PermissionsEditorProps): JSX.Element;
```

**Error handling:** same as chunk 5 — presentational; no new error paths.

**Test considerations:**
- Note: `client/src/components/org-settings/PermissionSetEditor.tsx` already exists as a sibling. Chunk 6 audits whether `PermissionSetEditor` is the same component; if so, RENAME it to `PermissionsEditor` and move it to the new location instead of creating a fresh file. Do NOT leave two parallel components.
- Manual smoke test: open both pages and confirm the editor renders identically.

**Dependencies:** chunk 0.

**Acceptance:**
- Both call sites import `PermissionsEditor` from `@/components/permissions/PermissionsEditor`.
- Inline 176L bodies deleted.
- `client/src/components/org-settings/PermissionSetEditor.tsx` resolved (renamed/moved/deleted per chunk audit).
- `npm run build:client` exits 0.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:client`

---

### Chunk 7 — DUP3 extraction (ApprovalChannelsEditor)

**spec_sections:** §6.3

**Module shape:**
- *Public interface this chunk exposes:* `client/src/components/approval/ApprovalChannelsEditor.tsx` named export `ApprovalChannelsEditor`. Props mirror the inline editor used in both org and subaccount approval-channels pages.
- *What stays hidden behind it:* the channel form, the channel-type switch, and the per-channel persistence calls.

**Files to create or modify:**

Create `client/src/components/approval/ApprovalChannelsEditor.tsx`:
- Lift the 178L triple-clone from `client/src/pages/OrgApprovalChannelsPage.tsx` and `client/src/pages/SubaccountApprovalChannelsPage.tsx`.
- Named export `ApprovalChannelsEditor`.

Modify the two call sites:
- Import `{ ApprovalChannelsEditor }`; delete the 178L bodies.

**Contracts:**

```typescript
interface ApprovalChannelsEditorProps {
  channels: ApprovalChannel[];
  scope: 'organisation' | 'subaccount';
  organisationId: string;
  subaccountId?: string; // required when scope = 'subaccount'
  onChange: (channels: ApprovalChannel[]) => void;
}

export function ApprovalChannelsEditor(props: ApprovalChannelsEditorProps): JSX.Element;
```

**Error handling:** same as chunks 5-6.

**Test considerations:** manual smoke test only.

**Dependencies:** chunk 0.

**Acceptance:**
- Both call sites import `ApprovalChannelsEditor`.
- Inline bodies deleted.
- `npm run build:client` exits 0.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:client`

---

### Chunk 8 — DUP4 extraction (unified MessageRender)

**spec_sections:** §6.4

**Module shape:**
- *Public interface this chunk exposes:* `client/src/components/chat/messageRender.tsx` named export `MessageRender`. Replaces the two per-page copies entirely (no re-export shims).
- *What stays hidden behind it:* the markdown rendering, code-block highlighting, and tool-call inline display logic.

**Files to create or modify:**

Create `client/src/components/chat/messageRender.tsx`:
- Combine the two 100%-duplicated copies (`agent-chat/messageRender.tsx` 68L + `config-assistant/messageRender.tsx` 68L identical).
- Named export `MessageRender`.

Delete `client/src/components/agent-chat/messageRender.tsx`.
Delete `client/src/components/config-assistant/messageRender.tsx`.

Modify `client/src/pages/AgentChatPage.tsx`:
- Update import from `@/components/agent-chat/messageRender` to `@/components/chat/messageRender`.

Modify `client/src/pages/ConfigAssistantPage.tsx`:
- Update import from `@/components/config-assistant/messageRender` to `@/components/chat/messageRender`.

Modify any other importers (search at chunk 8):
- Sweep `grep -rn "agent-chat/messageRender\|config-assistant/messageRender" client/src/` and update each.

**Contracts:**

```typescript
interface MessageRenderProps {
  message: ChatMessage; // existing shared type
  // ... full prop set finalised during chunk 8 by reading the existing copies
}

export function MessageRender(props: MessageRenderProps): JSX.Element;
```

**Error handling:** same as prior client chunks.

**Test considerations:**
- The two test files `client/src/components/agent-chat/__tests__/format.test.ts` and `client/src/components/config-assistant/__tests__/format.test.ts` exercise `format.ts` siblings, not `messageRender.tsx`. They are NOT touched by this chunk.
- Manual smoke test: open both chat surfaces and confirm message rendering parity.

**Dependencies:** chunk 0.

**Acceptance:**
- The two source `messageRender.tsx` files are DELETED (not left as re-export shims) per spec §6.4.
- All importers re-pointed to `@/components/chat/messageRender`.
- jscpd no longer reports the 68L 100%-duplicated clone or the 125L page-level clone.
- `npm run build:client` exits 0.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:client`

---

### Chunk 9 — DUP5 extraction (TemplateGrid)

**spec_sections:** §6.5

**Module shape:**
- *Public interface this chunk exposes:* `client/src/components/templates/TemplateGrid.tsx` named export `TemplateGrid`. Renders the template grid identically for the two pages.
- *What stays hidden behind it:* the grid layout, the empty-state, the per-template-card rendering.

**Files to create or modify:**

Create `client/src/components/templates/TemplateGrid.tsx`:
- Lift the 143L clone from `client/src/pages/SubaccountBlueprintsPage.tsx` and `client/src/pages/SystemOrganisationTemplatesPage.tsx`.
- Named export `TemplateGrid`.

Modify the two call sites:
- Import `{ TemplateGrid }`; delete the inline bodies.

**Contracts:**

```typescript
interface TemplateGridProps {
  templates: Template[]; // existing shared type
  onSelect: (template: Template) => void;
  emptyState?: ReactNode;
}

export function TemplateGrid(props: TemplateGridProps): JSX.Element;
```

**Error handling:** same as prior client chunks.

**Test considerations:** manual smoke test only.

**Dependencies:** chunk 0.

**Acceptance:**
- Both call sites import `TemplateGrid`.
- Inline 143L bodies deleted.
- `npm run build:client` exits 0.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:client`

---

### Chunk 10 — DUP7 extraction (template helpers)

**spec_sections:** §6.6 (canonical ownership)

**Module shape:**
- *Public interface this chunk exposes:* `server/services/templates/templateHelpers.ts` named exports `computeManifestHash`, `slugify`, `PARSER_VERSION`. Both `hierarchyTemplateService.ts` and `systemTemplateService.ts` import from this module.
- *What stays hidden behind it:* nothing — these are pure helpers; the full body is the public surface.

**Files to create or modify:**

Create `server/services/templates/templateHelpers.ts`:

```typescript
import { createHash } from 'crypto';

export const PARSER_VERSION = '1.0.0' as const;

export function computeManifestHash(manifest: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
```

Modify `server/services/hierarchyTemplateService.ts`:
- Add `import { computeManifestHash, slugify, PARSER_VERSION } from './templates/templateHelpers.js';`.
- Delete the local `function computeManifestHash`, `function slugify`, and `const PARSER_VERSION` declarations (lines 13-25).

Modify `server/services/systemTemplateService.ts`:
- Same; add the import and delete the local declarations (lines 18-30).

**Contracts:** the three exports above.

**Error handling:** none — pure helpers.

**Test considerations:**
- Author one Vitest test at `server/services/templates/__tests__/templateHelpersPure.test.ts`:
  - `computeManifestHash` returns the same hash for the same input twice.
  - `computeManifestHash` returns different hashes for different inputs.
  - `slugify('Hello World!')` returns `'hello-world'`.
  - `PARSER_VERSION` equals `'1.0.0'`.
- Naming convention `*Pure.test.ts` enforces zero DB imports per `verify-pure-helper-convention.sh` (DEVELOPMENT_GUIDELINES §7).

**Dependencies:** chunk 0.

**Acceptance:**
- Both services import from `templates/templateHelpers`.
- Neither service retains a private copy of the three helpers — verify by `grep -n 'function computeManifestHash\|function slugify\|PARSER_VERSION' server/services/hierarchyTemplateService.ts server/services/systemTemplateService.ts` returning ZERO hits.
- `npx tsc --noEmit` exits 0.
- Targeted Vitest test passes: `npx vitest run server/services/templates/__tests__/templateHelpersPure.test.ts`.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:server`
- `npx vitest run server/services/templates/__tests__/templateHelpersPure.test.ts`

---

### Chunk 11 — DUP8 extraction (definePruneJob factory; all 6 jobs)

**spec_sections:** §6.7

**Module shape:**
- *Public interface this chunk exposes:* `server/jobs/lib/definePruneJob.ts` named export `definePruneJob({table, retentionConfig})`. The 6 prune-job files become thin wrappers (≤30 LOC each).
- *What stays hidden behind it:* the per-org enumeration, the batched DELETE loop, the per-org transaction + `withOrgTx` envelope, the security-event emission, and the partial-success status calculation.

**Files to create or modify:**

Create `server/jobs/lib/definePruneJob.ts` (~150 LOC):
- Implements the union of behaviours observed across the 6 jobs: org enumeration, per-org transaction, per-org `withOrgTx`, batched DELETE (configurable batch size; pass-through to single-shot when `batchSize` not set), retention cutoff, optional GUC bypass (e.g. `app.allow_observation_mutation = 'retention_prune'` for `agent_observations`), optional security-event emission, partial-success status calc.

```typescript
export interface PruneJobConfig {
  source: string; // e.g. 'agent-observations-prune'
  table: string; // SQL identifier, e.g. 'agent_observations'
  retentionDays: number;
  cutoffColumn: string; // e.g. 'created_at' or 'decided_at'
  batchSize?: number; // omit for single-shot delete
  preDeleteGUC?: { name: string; value: string }; // e.g. for observations mutation bypass
  extraWhere?: string; // e.g. 'AND pinned_at IS NULL'
  emitSecurityEvent?: { event: string };
}

export interface PruneJobResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  rowsDeleted: number;
  durationMs: number;
}

export function definePruneJob(config: PruneJobConfig): () => Promise<PruneJobResult>;
```

Modify the 6 prune-job files (each becomes a thin wrapper):

```typescript
// server/jobs/agentObservationsPruneJob.ts (post-chunk shape, ~30 LOC)
import { definePruneJob } from './lib/definePruneJob.js';
import { auditEvent } from '../../shared/types/securityAuditEvents.js';

export const runAgentObservationsPrune = definePruneJob({
  source: 'agent-observations-prune',
  table: 'agent_observations',
  retentionDays: 90,
  cutoffColumn: 'created_at',
  batchSize: 1000,
  preDeleteGUC: { name: 'app.allow_observation_mutation', value: 'retention_prune' },
  extraWhere: 'AND pinned_at IS NULL',
  emitSecurityEvent: { event: auditEvent.agent.observationsRetentionPrune },
});
```

Same shape for the other 5 jobs:
- `server/jobs/fastPathDecisionsPruneJob.ts`
- `server/jobs/sandboxEgressAuditPruneJob.ts`
- `server/jobs/sandboxLogsPruneJob.ts`
- `server/jobs/sandboxTelemetryPruneJob.ts`
- `server/jobs/webhookReplayNoncePruneJob.ts`

Each export name is preserved (e.g. `runAgentObservationsPrune`, `pruneFastPathDecisions`) so the queue scheduler in `queueService.ts` does not need to change.

**Contracts:** see the `definePruneJob` interface above.

**Error handling:**
- The factory carries the per-org `try/catch` envelope; one org failure logs and continues to the next org.
- If all orgs fail, the factory returns `status: 'failed'`. Mixed = `partial`. All-success = `success`.
- The per-org logger event names (e.g. `${SOURCE}.org_failed`) match the existing convention so log dashboards continue to find them.

**Test considerations:**
- Author one Vitest test at `server/jobs/lib/__tests__/definePruneJob.test.ts`:
  - The factory returns a function whose result has the right shape.
  - Stub `withAdminConnection` and `db.transaction` to return a fixed org list; assert the function visits each org.
  - This is integration-shaped — note in CLAUDE.md §7 testing posture, runtime tests are added only for pure functions. The core of `definePruneJob` is impure (DB). Limit the new test to PURE pieces: extract a pure `computePruneStatus(succeeded, failed)` helper and test it. The DB-bound parts go untested locally; CI gates handle them.

**Dependencies:** chunk 0.

**Acceptance:**
- All 6 prune-job files are thin wrappers around `definePruneJob(...)`.
- `server/jobs/lib/definePruneJob.ts` exists and exports `definePruneJob`.
- The 6 jobs' exported function names are preserved (no consumer-side changes needed in `queueService.ts`).
- `npx tsc --noEmit` exits 0.
- Targeted Vitest test passes for the pure helper.
- jscpd no longer reports the prune-family clones (CI confirms).

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:server`
- `npx vitest run server/jobs/lib/__tests__/definePruneJob.test.ts`

---

### Chunk 12 — DUP9 extraction (dispatchWithDraftClaim)

**spec_sections:** §6.8 (canonical ownership)

**Module shape:**
- *Public interface this chunk exposes:* `server/services/actions/dispatchHelper.ts` named export `dispatchWithDraftClaim<T>`. Both `calendarActionService.ts` (3 call sites: createEvent, updateEvent, respondToInvite) and `slackActionService.ts` import from this module.
- *What stays hidden behind it:* the `_dispatchPreClaimed` check, the `claimSend` call, the `markSendFailed` call on error, the `markSent` call on success.

**Files to create or modify:**

Create `server/services/actions/dispatchHelper.ts`:

```typescript
import { eaDraftService } from '../eaDrafts/eaDraftService.js';

interface DispatchCtx {
  organisationId: string;
  subaccountId: string;
  ownerUserId: string;
  _dispatchPreClaimed?: boolean;
}

export async function dispatchWithDraftClaim<T>(args: {
  draftId: string;
  ctx: DispatchCtx;
  performDispatch: () => Promise<T>;
  resolveSentId: (result: T) => string;
}): Promise<T> {
  if (!args.ctx._dispatchPreClaimed) {
    const claimed = await eaDraftService.claimSend(args.draftId, args.ctx);
    if (!claimed.claimed) {
      throw Object.assign(
        new Error(`Draft ${args.draftId} send already in flight`),
        { statusCode: 409, errorCode: 'DRAFT_SEND_IN_FLIGHT' },
      );
    }
  }

  let result: T;
  try {
    result = await args.performDispatch();
  } catch (err) {
    await eaDraftService.markSendFailed(args.draftId, args.ctx);
    throw err;
  }

  await eaDraftService.markSent(args.draftId, args.resolveSentId(result), args.ctx);
  return result;
}
```

Modify `server/services/calendar/calendarActionService.ts`:
- Replace the inline claim/dispatch/markSent envelope in `createEvent`, `updateEvent`, `respondToInvite` with calls to `dispatchWithDraftClaim({ draftId, ctx, performDispatch: () => gcalFetch(...), resolveSentId: (e) => e.id ?? '' })`.

Modify `server/services/slack/slackActionService.ts`:
- Same shape — replace the inline envelope with `dispatchWithDraftClaim`.

**Contracts:** see the `dispatchWithDraftClaim` signature above.

**Error handling:**
- The helper preserves the existing error contract (statusCode + errorCode shape from `Object.assign(new Error, {...})`).
- On `markSendFailed` itself failing, the original dispatch error wins — the helper does NOT swallow.

**Test considerations:**
- Author one Vitest test at `server/services/actions/__tests__/dispatchHelperPure.test.ts`:
  - Stub `eaDraftService` (it is imported via dependency injection or via a minimal factory wrapper for testability). Alternative: extract the pure decision logic (`shouldClaim(ctx)` etc.) and test those.
  - Assert: `_dispatchPreClaimed: true` skips `claimSend`; failed dispatch calls `markSendFailed`; successful dispatch calls `markSent` with the right id.

**Dependencies:** chunk 0.

**Acceptance:**
- Both source services import `dispatchWithDraftClaim` from `actions/dispatchHelper`.
- Neither source service retains a private copy of the claim-and-dispatch envelope — verify by `grep -n '_dispatchPreClaimed\|claimSend' server/services/calendar/calendarActionService.ts server/services/slack/slackActionService.ts` returning import-line hits only, not inline-body hits.
- `npx tsc --noEmit` exits 0.
- Targeted Vitest test passes.
- jscpd no longer reports the 32L clone (CI confirms).

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:server`
- `npx vitest run server/services/actions/__tests__/dispatchHelperPure.test.ts`

---

### Chunk 13 — FE1 trim + FE4 extraction

**spec_sections:** §7.1, §7.2 (5 extraction success criteria)

**Module shape:**
- *Public interface this chunk exposes:* (FE4) two new components `IncidentDetailDrawer` and `IncidentTimeline` from `client/src/components/system-incidents/`. (FE1) the trimmed HomePage with no MetricCards.
- *What stays hidden behind it:* the per-component prop boundary, the hook redistribution between parent and children.

**Files to create or modify:**

**FE1 — `client/src/pages/operate/HomePage.tsx`:**
- Delete the 4 `<MetricCard ...>` blocks at lines ~400, ~418, ~439, ~458.
- Delete `import MetricCard from '../../components/MetricCard';` if no other usage remains in this file.
- Keep `<RunActivityChart data={chartData ?? []} />` at line ~517.
- Sweep removed imports (per CLAUDE.md §6.1 surgical changes).

**FE4 — Create `client/src/components/system-incidents/IncidentDetailDrawer.tsx`:**
- Lift the inline `IncidentDetailDrawer` function (lines 116-322 of `SystemIncidentsPage.tsx`) verbatim.
- Named export `IncidentDetailDrawer`.
- Props: `{ incident, onClose, onAck, onResolve, onSuppress }` (≤6 props per §7.2 prop boundary clarity).

**FE4 — Create `client/src/components/system-incidents/IncidentTimeline.tsx`:**
- Lift the timeline pane (the `<h3>Timeline</h3>` block + its events list rendering, lines ~240-260 of original) from inside the drawer.
- Named export `IncidentTimeline`.
- Props: `{ events: IncidentEvent[]; loading: boolean }`.

**Modify `client/src/pages/SystemIncidentsPage.tsx`:**
- Remove the inline `IncidentDetailDrawer` function.
- Add `import { IncidentDetailDrawer } from '@/components/system-incidents/IncidentDetailDrawer';`.
- The drawer's render call site stays unchanged (`<IncidentDetailDrawer incident={...} ... />`).
- Inside the (now-extracted) drawer, replace the inline timeline rendering with `<IncidentTimeline events={events} loading={loadingEvents} />`.

**Contracts:**

```typescript
// IncidentDetailDrawer
interface IncidentDetailDrawerProps {
  incident: SystemIncident;
  onClose: () => void;
  onAck: (id: string) => Promise<void>;
  onResolve: (id: string, note: string) => Promise<void>;
  onSuppress: (id: string, reason: string, duration: '24h' | '7d' | '30d' | 'permanent') => Promise<void>;
}
export function IncidentDetailDrawer(props: IncidentDetailDrawerProps): JSX.Element;
```

```typescript
// IncidentTimeline
interface IncidentTimelineProps {
  events: IncidentEvent[];
  loading: boolean;
}
export function IncidentTimeline(props: IncidentTimelineProps): JSX.Element;
```

**Error handling:**
- React error boundaries catch render errors; no new error paths.
- If the drawer extraction surfaces a parent-state coupling (e.g. the drawer's `useState` reaches into a parent ref), unify by hoisting that state to the parent and passing it down — do NOT recreate parent state inside the drawer.

**Test considerations:**
- No new tests required (testing posture).
- Manual smoke test: open SystemIncidentsPage, click an incident row, verify the drawer opens with the same content and the timeline populates correctly. Verify ack/resolve/suppress all work.
- `pr-reviewer` (chunk 15) confirms each of the 5 FE4 success criteria from spec §7.2:
  1. **Independent testability:** can `IncidentDetailDrawer` be rendered with stub props? Pass.
  2. **Prop boundary clarity:** ≤6 props, all named, all typed, no `any`. Pass.
  3. **Reduced render branching:** drawer has at most one top-level branching axis (e.g. `selectedIncident ? <Drawer /> : null` is the parent's branch; the drawer itself has loading-vs-loaded only). Pass.
  4. **Reduced hook density:** drawer uses the same hook count as before extraction (8 hooks in the source, 8 hooks post-extraction). Verify hooks live with the component that owns the state. If the parent now has FEWER hooks AND the drawer has the SAME hooks it had inline, criterion is met. If the drawer has MORE hooks than its old line range had, the extraction is hiding new state — re-plan.
  5. **Reduced cognitive load:** parent file drops from 491 LOC to ~250 LOC. Reviewer subjective check.

**Dependencies:** chunk 0.

**Acceptance:**
- HomePage.tsx no longer renders the 4 MetricCard tiles. RunActivityChart hero still renders.
- SystemIncidentsPage.tsx LOC count is ≤300 (~250 expected) post-extraction.
- The two new component files exist with the contracts above.
- All 5 FE4 success criteria pass under chunk 15 pr-reviewer.
- `npm run build:client` exits 0.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:client`

---

### Chunk 14 — FE5+FE6 documented-acceptance headers

**spec_sections:** §7.3

**Module shape:**
- *Public interface this chunk exposes:* a documented-acceptance header comment on each of 4 dashboard pages. No other changes.
- *What stays hidden behind it:* nothing — the change is a header comment.

**Files to create or modify:**

Modify the first line of each:
- `client/src/pages/ClientPulseDashboardPage.tsx`
- `client/src/pages/ClientPulseDrilldownPage.tsx`
- `client/src/pages/JobQueueDashboardPage.tsx`
- `client/src/pages/SpendLedgerPage.tsx`

Add as the first source line of each:

```typescript
// admin/power-user page; complexity intentional; reviewed wave-4 spec §7.3 2026-05-15
```

(Single line, no em-dashes per user prefs — uses semicolons as separators.)

**Contracts:** none (pure comment edit).

**Error handling:** none.

**Test considerations:** none. This is a comment edit.

**Dependencies:** chunk 0.

**Acceptance:**
- Each of the 4 files starts with the header comment on line 1.
- `npm run build:client` exits 0 (sanity check that nothing else broke).

**Verification commands:**
- `npm run lint`
- `npm run build:client`

---

### Chunk 15 — architecture.md update + spec-conformance + pr-reviewer + reality-checker pass

**spec_sections:** §5 (handler-injection pattern documentation per existing prevention item PP-CD2), §9 (Chunk 15 row), §8 (acceptance criteria)

**Module shape:**
- *Public interface this chunk exposes:* an updated `architecture.md` describing the handler-injection pattern, sufficient for future readers to understand the cycle-break and apply the pattern when adding new handlers.
- *What stays hidden behind it:* the verification sweep (which deferred items in tasks/todo.md to mark closed), the chunk-15 review pass coordination.

**Files to create or modify:**

Modify `architecture.md`:
- Add a section under the existing "Service patterns" or "Architecture rules" area describing the handler-injection pattern. Cover: what `HandlerContext` is, where the type module lives (`server/services/handlerContextTypes.ts`), where the factory lives (`server/lib/buildHandlerContext.ts`), the §5.2.3 governance invariant (no DB accessors, no feature-specific helpers, no convenience wrappers, every method has a cycle-break justification), and the import-discipline rule (`import type` only at handler call sites).
- Reference the prevention item PP-CD2 (per spec §5 mention) for the lint-rule discipline.
- Length target: one paragraph + a short example. Total addition ~30-50 lines. Doc style: agent-facing per CLAUDE.md §13 (dense, no preambles, every line earns its tokens).

Modify `tasks/todo.md`:
- Mark the items from spec §1 as `[status:closed:pr:<num>]` once the merge commit lands. This is done at merge time, not chunk-15 time — chunk 15 stages the edit.

**Review pass coordination (managed by feature-coordinator, NOT this chunk):**
- `spec-conformance` reviews the branch against spec.md. Returns CONFORMANT or CONFORMANT_AFTER_FIXES.
- `pr-reviewer` reviews the full branch diff. Confirms FE4 5 success criteria pass.
- `reality-checker` verifies the branch against the spec's acceptance criteria with evidence (build logs, file diffs, etc.).

**Contracts:** none new — this chunk closes the build.

**Error handling:**
- If `spec-conformance` returns CONFORMANT_AFTER_FIXES with mechanical edits, apply them; re-run `pr-reviewer` on the expanded set per CLAUDE.md.
- If `reality-checker` returns NEEDS_WORK citing a missing acceptance criterion, fix in this chunk before declaring done.
- If chunk 15 surfaces a missed deferred item from spec §1, add it to the same chunk (do NOT defer to a follow-up PR).

**Test considerations:** chunk 15 authors no new tests. Existing tests authored in chunks 1-12 must all still pass via their per-chunk targeted Vitest commands.

**Dependencies:** chunks 1-14 ALL must land first.

**Acceptance:**
- `architecture.md` has the handler-injection pattern section.
- `spec-conformance` returns CONFORMANT (or CONFORMANT_AFTER_FIXES with all fixes applied).
- `pr-reviewer` returns LGTM.
- `reality-checker` returns READY (Significant/Major mandatory).
- `dual-reviewer` runs (Major-class) — returns READY or `REVIEW_GAP` written if Codex unavailable.
- All chunk-1-12 targeted Vitest commands still pass.
- `npm run build:server` and `npm run build:client` both exit 0.
- Spec §8 acceptance criteria 1, 4, 5, 6 pass locally; criteria 2, 3, 7 are CI-confirmed (jscpd, full gate suite); criterion 9 is staged for merge commit.

**Verification commands:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build:server`
- `npm run build:client`
- (Re-run any chunk-1-12 targeted Vitest tests as smoke check.)

---

## UX considerations

### FE1 — operate/HomePage trim

The HomePage is the operator's daily landing surface. Removing 4 KPI tiles changes what they see on load. The hero `RunActivityChart` answers the primary question ("what's running right now?") in a single visual; the 4 tiles surface duplicates of information already elsewhere in the IA (run counts, success rates, etc.).

- **Loading state:** `RunActivityChart` already has its own loading skeleton; no new state to add.
- **Empty state:** if `chartData` is empty, the chart shows its existing empty-state. No tiles to render means no decision needed for tile-empty states.
- **Permissions:** no permission gates change. The page remains visible to anyone with operator access.
- **Real-time:** existing WebSocket-driven chart refresh continues to work (no change to data path).

### FE4 — SystemIncidentsPage drawer extraction

System-admin-only page. Extraction is purely structural — the drawer renders identically pre/post.

- **Loading state:** drawer continues to show its existing loading skeleton inside the timeline pane.
- **Empty state:** drawer continues to show "no events recorded yet" when `events.length === 0`.
- **Permissions:** no change. Page is gated by system-admin role; the extracted components inherit that gate via the parent.
- **Real-time:** no change.

### FE5+FE6 — 4 dashboard pages, header acceptance

No UI change. The header comment is a comment, not a render. Operator and admin users see the page identically.

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| HandlerContext interface design surfaces a 6th method or a >5-dependency handler at chunk 0 | medium | medium | Spec §10 risk register: split into `WorkflowDispatchContext` + `SkillInvocationContext` (or domain-specific names). Chunk 0 commits the split and updates CD0.1 before chunk 1 begins. |
| HandlerContext value-edge re-introduces a cycle | low | high | The `import type` discipline at handler files is the primary defence. Chunk 4's `madge --circular` re-baseline catches any regression. If a cycle returns, the offending file's static import is the cause — fix that file specifically, do NOT loosen the lint rule. |
| Chunk 4 cycle re-baseline reports MORE cycles than the 0-baseline (current real value, NOT the spec's stale 73-claim) | medium | high | If the count rises, STOP. Trace the new edge and either (a) fix the offending value import, (b) move the helper into the factory module, or (c) re-plan that handler. Do NOT increase the baseline. |
| Three of the entry-point files (`agentExecutionLoop`, `flowExecutorService`, `optimiser/runOptimiserScan`) value-import `skillExecutor` | high | low | **Operator decision 2026-05-16: expand the injection sweep.** These 3 files MUST switch to constructing their own `handlerContext` via `buildHandlerContext()` at their entry point and routing calls through it. After chunk 4, `buildHandlerContext.ts` is the only file in `server/` that value-imports `skillExecutor`. Uniform rule; no carve-out. |
| DUP4 `messageRender.tsx` deletion breaks a third-party importer not surfaced in chunk-0 search | medium | low | Chunk 8 sweeps with `grep -rn "agent-chat/messageRender\|config-assistant/messageRender" client/src/` before deletion. Any hit gets re-pointed in the same commit. |
| DUP2 (PermissionsEditor) collides with existing `PermissionSetEditor.tsx` | high | medium | Chunk 6 audits and decides — either rename the existing file OR confirm they are different concerns. If they're the same component, the rename + move IS the chunk; if different, document the distinction in a code comment in both files. |
| FE4 extraction relocates complexity rather than reducing it (5 success criteria fail) | medium | medium | Chunk 15 pr-reviewer enforces the 5 criteria. If extraction merely splits LOC without decoupling state, re-plan in chunk 13 — likely by hoisting state from the drawer to the parent or by splitting the timeline further. |
| The 6 prune jobs have subtle behaviour divergence the chunk-0 audit missed | medium | medium | Chunk 11 reads each of the 6 jobs end-to-end before locking the `definePruneJob` interface. If a job has a unique behaviour (e.g. observations needs `app.allow_observation_mutation` GUC; others don't), the factory exposes it as a config field (e.g. `preDeleteGUC`). If the divergence is too deep, scope back to the original 4-job set per spec §1.1 and document why. |
| Spec's claim of "73 server cycles" is stale (actual current baseline = 0) | high | low | Plan acceptance reframes CD1 success: the goal is "no skillExecutor ↔ workflowEngine value edge remains" (which IS the spec's hard-bar phrasing in §5.4, §8 #1). The 43-cycle delta and ≤30 absolute target are SOFT goals; the cycle-gate baseline is already at 0. The spec's hard bar still binds. |
| Concurrent feature work merges to main between chunk 0 and chunk 15 | medium | medium | Long-running build. Operator's standard practice (feature freeze during structural remediation per DEVELOPMENT_GUIDELINES §8.5) applies. If a conflict arises, rebase the branch, re-verify chunk 4's cycle baseline, and re-run targeted Vitest tests for the chunks that touched the conflicting paths. |

---

## Plan-shape concerns surfaced for operator adjudication

**Status update 2026-05-16:** all 5 concerns adjudicated. Resolutions captured inline below.

1. **Stale baseline claim in spec § Goals + § Acceptance — RESOLVED (auto-corrected).** The current `madge --circular` baseline is `cycle-count:0`, not 73. Spec §2 goal #4 and §8 acceptance #1 updated in the Phase 1→2 transition commit to drop the stale absolute targets ("≤30 cycles", "43-cycle delta") and reframe around the HARD bar that was already correct: **no skillExecutor ↔ workflowEngine value-edge remains**, AND the dynamic-import mitigations in `handlers/workflowStudio.ts` etc. are replaced with explicit injection. Spec §1.1 verification row for CD1 now notes the cycle is dynamic-import-mediated (madge sees 0 because of the workarounds; the value-edge still exists in the type graph).

2. **3 entry-point files (`agentExecutionLoop.ts`, `flowExecutorService.ts`, `optimiser/runOptimiserScan.ts`) value-import `skillExecutor` — RESOLVED (operator decision 2026-05-16: EXPAND).** Operator chose uniform-rule over carve-out. Chunk 4 sweep expanded: all 3 files switch to constructing their own `handlerContext` via `buildHandlerContext()` and routing calls through it. After chunk 4, `buildHandlerContext.ts` is the only file in `server/` that value-imports `skillExecutor`. Plan chunk 4, risks table, and acceptance criteria all reflect the expanded scope.

3. **Existing `PermissionSetEditor.tsx` collides with the planned `PermissionsEditor.tsx` — DEFERRED to chunk 6 audit.** Chunk 6 reads both components end-to-end, decides rename+move vs separate-concern, executes. No operator action needed pre-build.

4. **DUP8 factory size ~150 LOC vs ~50 — RESOLVED (auto-confirmed).** Architect's design (single factory with optional config fields for batching/GUC/security-event variance) is cleaner than the alternatives (two factories or 6 thin-but-different wrappers). Plan unchanged.

5. **No "73 → 30" headline number — RESOLVED (comms note for merge commit).** Finalisation summary will report "CD1 value-edge eliminated; dynamic-import mitigation pattern replaced with explicit injection; cycle baseline preserved at 0". Stakeholder messaging framed as a structural-quality win, not a numbers-down win.

---

## Executor notes

- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- Chunks 5-12 are mechanical extractions and can interleave freely with chunks 1-4 because they touch disjoint files. Chunk 4 must follow chunks 1, 2, AND 3 because it wires the receiving signatures.
- Chunks 13-14 depend only on chunk 0; they can land at any time after chunk 0.
- Chunk 15 must close the build (architecture.md update + final review pass coordination).
- All commits use placeholder migration numbers if any (none expected — this build adds zero migrations per spec §4.1 and per the handoff Phase 2 entry checks).
- The branch name is `claude/wave-4-architectural-and-duplication`. Each chunk produces commits on this branch; the integration branch is the same. One PR to main at the end.
- Per CLAUDE.md user preferences: no em-dashes in any code or doc text added to the repo (use commas, colons, semicolons, or rewrite).
- Per spec §5.2.3: every method on `HandlerContext` (added in chunk 0/1 and any future addition) MUST have a cycle-break justification cited in the PR review. Reviewers reject additions without one.
