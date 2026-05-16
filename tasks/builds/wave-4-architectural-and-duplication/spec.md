---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Major
source_branch: main
build_slug: wave-4-architectural-and-duplication
output_location: tasks/builds/wave-4-architectural-and-duplication/spec.md
---

**Status:** reviewing
**Spec date:** 2026-05-15
**Last updated:** 2026-05-16
**Author:** main-session (claude opus 4.7)
**Build slug:** wave-4-architectural-and-duplication

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Platform Hygiene |
| Capability owner | main-session (TODO: assign human owner at finalisation) |
| Lifecycle state on launch | Growth |
| Risk surface | None. |
| Review cadence | on-incident-only |

## ABCd Estimate

| Dimension | Sizing |
|---|---|
| Acquire | L |
| Build | L |
| Carry | S |
| decommission | S |

# Wave 4 Session H — CD1 super-cycle break + duplication extractions + frontend complexity

Single coordinated PR closing the architectural and UI-extraction work surfaced by the Wave 2 audit sweep.

Scope: 1 architectural refactor (CD1 super-cycle break via handler-injection pattern) + 8 UI/service duplication extractions (DUP1-DUP5, DUP7-DUP9) + 4 frontend complexity items (FE1, FE4, FE5+FE6).

This is the largest single build in the Wave 3+4 final consolidation push. Major-class.

---

## 1. Scope

Closes the following `tasks/todo.md` items:

- **Architectural (1)**: CD1 — skillExecutor ↔ workflowEngine super-cycle (≈43 of 73 server cycles, ≈59% on its own)
- **Duplication extractions (8)**: DUP1, DUP2, DUP3, DUP4, DUP5, DUP7, DUP8, DUP9
- **Frontend complexity (4)**: FE1, FE4, FE5+FE6 (the dashboard-page deep-read group)

**Total: 13 items, but CD1 alone is sized as a Significant task within this Major-class build.**

### 1.1 Present-state verification (per spec-authoring-checklist §0)

Verified 2026-05-16 against current `main` (commit `77b70f82`):

| Item | Status | Evidence |
|---|---|---|
| CD1 | verified open | `server/services/skillExecutor/handlers/*.ts` import `workflowEngineService`; `server/services/workflowEngine/queueLifecycle/**` imports `skillExecutor`. `madge --circular` baseline = 73 server cycles. |
| DUP1 | verified open | `client/src/pages/{SubaccountSkillsPage,SystemSkillsPage}.tsx` + `client/src/components/pulse/HistoryTab.tsx` all exist; no shared module under `client/src/components/skills/` yet. |
| DUP2 | verified open | `client/src/pages/AdminPermissionSetsPage.tsx` + `client/src/components/org-settings/PermissionsTab.tsx` exist; no `client/src/components/permissions/` yet. |
| DUP3 | verified open | `client/src/pages/{OrgApprovalChannelsPage,SubaccountApprovalChannelsPage}.tsx` exist; no `client/src/components/approval/ApprovalChannelsEditor.tsx` yet. |
| DUP4 | verified open | `client/src/components/agent-chat/messageRender.tsx` + `client/src/components/config-assistant/messageRender.tsx` both exist (100% duplicated per audit); no unified `client/src/components/chat/messageRender.tsx` yet. |
| DUP5 | verified open | `client/src/pages/{SubaccountBlueprintsPage,SystemOrganisationTemplatesPage}.tsx` exist; no `client/src/components/templates/` yet. |
| DUP7 | verified open | `server/services/{hierarchyTemplateService,systemTemplateService}.ts` exist; no `server/services/templates/` shared module yet. |
| DUP8 | verified open | 6 prune-job files exist (`agentObservationsPruneJob`, `fastPathDecisionsPruneJob`, `sandboxEgressAuditPruneJob`, `sandboxLogsPruneJob`, `sandboxTelemetryPruneJob`, `webhookReplayNoncePruneJob`). Audit baseline targeted 4; once the `definePruneJob` factory exists the marginal cost of migrating all 6 is trivial, so this build scopes ALL 6 — see §6.7. |
| DUP9 | verified open | `server/services/calendar/calendarActionService.ts` + `server/services/slack/slackActionService.ts` exist with the 32L clone. |
| FE1 | verified open | `client/src/pages/operate/HomePage.tsx` exists with 4× MetricCard tile row and RunActivityChart hero. |
| FE4 | verified open | `client/src/pages/SystemIncidentsPage.tsx` LOC count to be re-measured at chunk 0; audit baseline = 491. |
| FE5+FE6 | verified open | `client/src/pages/{ClientPulseDashboardPage,ClientPulseDrilldownPage,JobQueueDashboardPage,SpendLedgerPage}.tsx` all exist. |

## 2. Goals

1. Break the CD1 super-cycle by inverting `skillExecutor` and `workflowEngine` handler imports. The pattern: handlers receive their dependencies via a `HandlerContext` object instead of importing services directly.
2. Extract 8 named duplication clones to shared modules. Each is a UI or service-helper lift.
3. Address 4 frontend complexity items via sub-component extraction OR an explicit "this dashboard is admin-only, accept the LOC" decision.
4. Drop `madge --circular` count from 73 server cycles by at least 43 (CD1 alone). Post-build cycle count target is ≤30 if chunk 4 cleanup also resolves any trivial sibling cycles surfaced when the CD1 edge is removed; otherwise the floor is `73 − (cycles broken by CD1)`, which is expected to land in the 28-31 range. The minimum bar is "no skillExecutor ↔ workflowEngine cycle remains", whatever the absolute count.
5. Drop `jscpd` duplicated-line count by an estimated ~1,200-1,500 lines (sum of declared block sizes across the 8 extractions; precise figure is whatever CI's jscpd reports post-build, which MUST be lower than the pre-build baseline). See §8 acceptance #2 for the breakdown.

## 3. Non-Goals

- No behaviour changes in any of the touched paths. CD1 break is a pure dependency-direction inversion; UI extractions preserve rendering output exactly.
- No new features, no new permissions, no new audit events.
- No changes to skill or workflow runtime semantics.
- No drive-by lint cleanup outside the items above.
- No CD2-CD10 — Session G scope (5-minute fixes).
- No DUP6 — Session G scope (same-file extraction).
- No SK1-SK3 — Session G scope.

## 4. Framing Assumptions

- Repo is pre-production. Testing posture is `static_gates_primary` per `docs/spec-context.md`.
- The CD1 super-cycle dominates because `skillExecutor` handler files import `workflowEngineService` (to enqueue downstream work) and `workflowEngineService` queue-lifecycle modules import `skillExecutor.invokeSkill` (to dispatch a skill from a workflow step). The fix is **handler-injection**: handlers receive a `HandlerContext` interface containing the methods they need, and the wiring layer (boot-time) constructs the context with both implementations.
- The 8 duplication extractions are mechanical UI/service lifts. Each follows the pattern: identify the cloned block, extract to a named module, import from both original sites, delete the duplicates.
- The 4 frontend complexity items (FE1 = operate/HomePage 4×MetricCard + RunActivityChart; FE4 = SystemIncidentsPage 491 LOC; FE5+FE6 = ClientPulseDashboardPage, ClientPulseDrilldownPage, JobQueueDashboardPage, SpendLedgerPage) carry binding default verdicts per §7 (trim FE1; extract FE4; accept FE5+FE6). Operator may override at chunk 0; without an override, the defaults are the build instructions.
- TypeScript strict mode is on. The existing tsconfig path mapping is immutable.

### 4.1 Files to change (single source of truth)

Total new files (FE4 default verdict path = EXTRACT): **12** = 8 DUP shared modules (5 client + 3 server) + 2 CD1 wiring/type files + 2 FE4 sub-components.

Total new files (FE4 override = ACCEPT): **10** = 8 DUP shared modules + 2 CD1 wiring/type files (FE4 sub-component rows are dropped from §4.1 when the override path is selected).

If chunk 0 decides FE4 needs a third extraction to land under 400 LOC (per the FE4 sub-table), the default-path total becomes 13.

Editing surface enumerated below; chunk 0 confirms exact line counts and adds any sibling files the architect identifies during file-set sweep. FE4 sub-components are placeholders to lock at chunk 0 — see the FE4-extraction sub-table below.

**New files (created by this build):**

| Path | Purpose | Created by chunk |
|---|---|---|
| `server/services/handlerContextTypes.ts` | Pure type-only module exporting the `HandlerContext` interface (no implementation imports) | Chunk 1 |
| `server/lib/buildHandlerContext.ts` | Boot-time factory that constructs the `HandlerContext` with real service implementations | Chunk 1 |
| `client/src/components/skills/HistoryRender.tsx` | DUP1 shared rendering for Skills history (Subaccount + System pages) and pulse HistoryTab | Chunk 5 |
| `client/src/components/permissions/PermissionsEditor.tsx` | DUP2 shared editor — replaces inline editor in AdminPermissionSetsPage + org-settings/PermissionsTab | Chunk 6 |
| `client/src/components/approval/ApprovalChannelsEditor.tsx` | DUP3 shared editor — replaces inline editor in OrgApprovalChannelsPage + SubaccountApprovalChannelsPage | Chunk 7 |
| `client/src/components/chat/messageRender.tsx` | DUP4 unified message renderer (replaces agent-chat/ + config-assistant/ copies) | Chunk 8 |
| `client/src/components/templates/TemplateGrid.tsx` | DUP5 shared template-grid renderer for SubaccountBlueprintsPage + SystemOrganisationTemplatesPage | Chunk 9 |
| `server/services/templates/templateHelpers.ts` | DUP7 shared helpers used by hierarchyTemplateService + systemTemplateService | Chunk 10 |
| `server/jobs/lib/definePruneJob.ts` | DUP8 factory; pruning jobs become thin wrappers | Chunk 11 |
| `server/services/actions/dispatchHelper.ts` | DUP9 shared dispatch helper used by calendarActionService + slackActionService | Chunk 12 |

**FE4 sub-components (names locked at chunk 0, then this table is updated):**

| Path | Purpose | Created by chunk |
|---|---|---|
| `client/src/components/system-incidents/IncidentTimeline.tsx` (placeholder name; chunk 0 confirms) | FE4 extraction — timeline pane from SystemIncidentsPage | Chunk 13 |
| `client/src/components/system-incidents/IncidentDetailDrawer.tsx` (placeholder name; chunk 0 confirms) | FE4 extraction — detail drawer from SystemIncidentsPage | Chunk 13 |
| (optional third) — chunk 0 decides whether a third extraction is warranted to land under 400 LOC | FE4 third sub-component if needed | Chunk 13 |

If chunk 0 instead selects the FE4 override path ("accept the LOC"), the FE4 sub-component rows are dropped from §4.1.

**Modified files (existing files edited by this build):**

| Path | Modification | Chunk |
|---|---|---|
| `server/services/skillExecutor/handlers/*.ts` (~24 handler files) | Add `HandlerContext` parameter; remove direct imports of `workflowEngineService` | Chunk 2 |
| `server/services/skillExecutor/registry.ts` | Update handler registration signature to accept + pass `HandlerContext` | Chunk 2 |
| `server/services/workflowEngine/queueLifecycle/*.ts` | Add `HandlerContext` parameter; remove direct imports of `skillExecutor` | Chunk 3 |
| `server/services/workflowEngine/queueLifecycle/dispatch.ts` | Same as above | Chunk 3 |
| `server/index.ts` OR a new bootstrap entry point | Wire `buildHandlerContext()` into handler registration sites once chunks 2 and 3 have landed the receiving signatures | Chunk 4 |
| `client/src/pages/SubaccountSkillsPage.tsx`, `client/src/pages/SystemSkillsPage.tsx`, `client/src/components/pulse/HistoryTab.tsx` | Import from new `HistoryRender`; delete inline duplication | Chunk 5 |
| `client/src/pages/AdminPermissionSetsPage.tsx`, `client/src/components/org-settings/PermissionsTab.tsx` | Import from new `PermissionsEditor` | Chunk 6 |
| `client/src/pages/OrgApprovalChannelsPage.tsx`, `client/src/pages/SubaccountApprovalChannelsPage.tsx` | Import from new `ApprovalChannelsEditor` | Chunk 7 |
| `client/src/pages/AgentChatPage.tsx`, `client/src/pages/ConfigAssistantPage.tsx` | Re-point imports from the per-page `messageRender.tsx` copies to the new unified `client/src/components/chat/messageRender.tsx` | Chunk 8 |
| `client/src/pages/SubaccountBlueprintsPage.tsx`, `client/src/pages/SystemOrganisationTemplatesPage.tsx` | Import from new `TemplateGrid` | Chunk 9 |
| `server/services/hierarchyTemplateService.ts`, `server/services/systemTemplateService.ts` | Import shared helpers from `templates/templateHelpers` | Chunk 10 |
| `server/jobs/agentObservationsPruneJob.ts`, `server/jobs/fastPathDecisionsPruneJob.ts`, `server/jobs/sandboxEgressAuditPruneJob.ts`, `server/jobs/sandboxLogsPruneJob.ts`, `server/jobs/sandboxTelemetryPruneJob.ts`, `server/jobs/webhookReplayNoncePruneJob.ts` (all 6) | Replace inline cron-prune body with `definePruneJob({table, retentionConfig})` call | Chunk 11 |
| `server/services/calendar/calendarActionService.ts`, `server/services/slack/slackActionService.ts` | Import from new `actions/dispatchHelper` | Chunk 12 |
| `client/src/pages/operate/HomePage.tsx` | FE1 trim per §7.1 default verdict | Chunk 13 |
| `client/src/pages/SystemIncidentsPage.tsx` | FE4 extraction per §7.2 default verdict — extracts sub-components named in the FE4 sub-table above | Chunk 13 |
| `client/src/pages/{ClientPulseDashboardPage,ClientPulseDrilldownPage,JobQueueDashboardPage,SpendLedgerPage}.tsx` | FE5+FE6 default verdict = accept; chunk 14 adds the documented-acceptance header comment | Chunk 14 |
| `architecture.md` | Document the handler-injection pattern (per existing prevention item PP-CD2) | Chunk 15 |
| `tasks/todo.md` | Mark §1 items `[status:closed:pr:<num>]` | Merge commit |

**Deleted files (existing files removed by this build):**

| Path | Reason | Removed by chunk |
|---|---|---|
| `client/src/components/agent-chat/messageRender.tsx` | DUP4 — folded into unified `client/src/components/chat/messageRender.tsx`; not left as a re-export shim | Chunk 8 |
| `client/src/components/config-assistant/messageRender.tsx` | DUP4 — folded into unified `client/src/components/chat/messageRender.tsx`; not left as a re-export shim | Chunk 8 |
## 5. CD1 — skillExecutor ↔ workflowEngine super-cycle break

### 5.1. Current shape

Long chains routing through `workflowEngine/queueLifecycle/dispatch.ts > workflowActionCallExecutor.ts > skillExecutor.ts > skillExecutor/registry.ts > skillExecutor/handlers/*.ts > tools/*.ts > services/*.ts > workflowEngineService.ts > ...`.

Root cause: handler files in both `skillExecutor/handlers/` and `workflowEngine/queueLifecycle/` import services directly from the OTHER subsystem. This creates a bidirectional edge: skill handlers need the workflow engine to enqueue downstream steps; workflow queue handlers need the skill executor to dispatch a skill from a workflow step.

### 5.2. Fix — handler-injection pattern

Each handler gains a `HandlerContext` parameter containing the methods it needs.

#### 5.2.1 Contract — `HandlerContext`

| Field | Value |
|---|---|
| Name | `HandlerContext` |
| Type module | `server/services/handlerContextTypes.ts` (pure type-only module — MUST NOT import any service implementation; consumers MUST use `import type { HandlerContext } from '../handlerContextTypes.js'`) |
| Factory module | `server/lib/buildHandlerContext.ts` (boot-time wiring — imports the actual exports `WorkflowEngineService` (const facade object from `server/services/workflowEngineService.ts`) + `skillExecutor` (const from `server/services/skillExecutor.ts`), returns `HandlerContext`) |
| Position in handler signature | `HandlerContext` is the LAST parameter, appended to existing handler signatures (e.g. existing `SkillExecutionContext` stays in its current position; `HandlerContext` is added after). Exact ordering confirmed by architect during chunk 0. |
| Producer | `buildHandlerContext()` called once at boot (wired in chunk 4 after the receiving signatures land in chunks 2-3), return value passed to `skillExecutor/registry.ts` and `workflowEngine/queueLifecycle/dispatch.ts` handler registration. |
| Consumers | Every skill handler under `server/services/skillExecutor/handlers/` and every workflow queue-lifecycle handler under `server/services/workflowEngine/queueLifecycle/`. |
| Import discipline | Handler files MUST use `import type` (TypeScript erases at compile time, never produces a runtime import edge). The cycle break is enforced by this discipline plus the lint rule documented in PP-CD2. |
| Method-set cap | If the interface grows beyond ~12 methods total, group into domain-specific sub-contexts (e.g. `WorkflowDispatchContext`, `SkillInvocationContext`) — see §10 risk register. |

#### 5.2.2 Conceptual shape

```typescript
// server/services/handlerContextTypes.ts — pure types, zero runtime imports
// `WorkflowEngineService` is a const facade object (uppercase), and `skillExecutor` is a const
// (lowercase). We use `typeof` to derive structural types directly from the value exports.
import type { WorkflowEngineService } from '../services/workflowEngineService.js';
import type { skillExecutor } from '../services/skillExecutor.js';

export interface HandlerContext {
  workflowEngine: Pick<typeof WorkflowEngineService, 'enqueueTick' | 'tick' | 'dispatchStep'>;
  skillExecutor: Pick<typeof skillExecutor, 'invokeSkill'>;
  // ... exact method set finalised during chunk 1, capped per 5.2.1
}
```

```typescript
// server/lib/buildHandlerContext.ts — boot-time wiring
import { WorkflowEngineService } from '../services/workflowEngineService.js';
import { skillExecutor } from '../services/skillExecutor.js';
import type { HandlerContext } from '../services/handlerContextTypes.js';

export function buildHandlerContext(): HandlerContext {
  return {
    workflowEngine: WorkflowEngineService,
    skillExecutor,
  };
}
```

Note: `WorkflowEngineService` is exported as `export const WorkflowEngineService = { ... }` from `server/services/workflowEngineService.ts`; `skillExecutor` is `export { skillExecutor } from './skillExecutor/registry.js'`. Both are values, not types, so the type module uses `typeof` to extract structural types.

This breaks the import cycle because:
- Handlers `import type` from `handlerContextTypes.ts` (no runtime edge)
- `handlerContextTypes.ts` uses `import type` for its references to `WorkflowEngineService` / `SkillExecutor` (no runtime edge)
- Handlers do NOT import `workflowEngineService` or `skillExecutor` as values
- Only `buildHandlerContext.ts` (which the handlers never import) carries the value-level imports

#### 5.2.3 Governance invariant — `HandlerContext` is not a service locator

`HandlerContext` exists to break the CD1 cycle, NOT to become a shared dependency-aggregation layer for unrelated services. The following additions are PROHIBITED in the master `HandlerContext` interface and in every future sub-context derived from it:

- **No arbitrary DB accessors.** Handlers that need DB access continue to obtain it via `getOrgScopedDb()` / `withOrgTx()` / `withAdminConnection()` per existing conventions. `HandlerContext.db` or similar is not allowed.
- **No feature-specific helpers.** If only one handler needs a helper, it does NOT belong on the shared context. Inline it, or expose it via an existing service module.
- **No convenience wrappers.** If a method's only purpose is to chain two other context methods together, the handler chains them directly. No facade layer on top of the facade.
- **Additions require explicit cycle-break justification.** Any new method on `HandlerContext` (or a sub-context) MUST be added because removing it reintroduces a circular import. A code-review comment on the PR adding the method MUST cite the specific cycle the method breaks. Additions without that justification are rejected.

These rules apply to every method added during chunk 1 AND every method added in future builds. Surface a re-plan signal if chunk 1 surfaces a candidate method that violates these rules.

### 5.3. Out-of-scope variants

- We are NOT moving to a full DI framework (e.g., InversifyJS). Hand-rolled `HandlerContext` interface + boot-time wiring is sufficient.
- We are NOT renaming `skillExecutor` or `workflowEngineService` exports.
- We are NOT changing the runtime behaviour of any handler — only how it gets its dependencies.

### 5.4. Acceptance

- CI's `npm run check:circular` (madge) no longer reports any cycle on the skillExecutor ↔ workflowEngine edge.
- The CI circular-dependency gate's failure scope is limited to **architectural CD1-class cycles** between first-party `server/services/` modules. If the gate currently tolerates known framework/tooling cycles (e.g. transitive cycles inside `node_modules`, generated artefacts, or build-tool internals), that tolerance MUST be preserved — the gate fails on new first-party cycles only. Chunk 4 confirms the gate's allowlist scope before declaring CD1 done; if no allowlist exists yet, chunk 4 documents the current full-graph behaviour in a code comment alongside the gate config so a future audit can narrow the scope without surprise.
- Every skill handler accepts a `HandlerContext` (or the named sub-context per §5.2.1 method-set cap).
- Every workflow queue-lifecycle handler accepts a `HandlerContext`.
- Boot-time wiring (`buildHandlerContext()`) constructs the context once and passes it to each handler registration site.
- `HandlerContext` (and every sub-context) complies with the §5.2.3 governance invariant — no DB accessors, no feature-specific helpers, no convenience wrappers, every method has a cycle-break justification.
- `npm run build:server` exits 0 locally.
- No behaviour change in any handler. Any targeted Vitest unit tests authored for new pure-function code in this build pass via `npx vitest run <path>` (per CLAUDE.md verification table). The full suite runs in CI only.

## 6. Duplication extractions

Each is a mechanical lift. The pattern: identify the cloned block, extract to a named module, both original sites import from the new module, delete the duplicate code.

Module paths are locked below — builders must NOT invent parallel primitives. Export names are locked for DUP1, DUP2, DUP3, DUP4, DUP5, DUP8 (single concrete component or factory per item). For DUP7 and DUP9, the set of exported helpers is intentionally decided at chunk 0 once the architect inventories which helpers are actually shared (the audit identified the line ranges but not the helper names); chunk 0 MUST update this spec to record the chosen export names before the corresponding extraction chunk begins. If chunk 0 surfaces any other reason to deviate, surface a re-plan signal first.

### 6.1. DUP1 — 213L + 209L Skills pages ↔ pulse/HistoryTab.tsx

Extract shared rendering logic to `client/src/components/skills/HistoryRender.tsx`, default export `HistoryRender`.

**Acceptance:** `client/src/pages/SubaccountSkillsPage.tsx`, `client/src/pages/SystemSkillsPage.tsx`, and `client/src/components/pulse/HistoryTab.tsx` all import `HistoryRender` from the new module; the previously-duplicated rendering bodies are deleted; jscpd no longer reports the 213L+209L clone pair.

### 6.2. DUP2 — `AdminPermissionSetsPage` ↔ `org-settings/PermissionsTab` triple-clone (176L total)

Lift `<PermissionsEditor>` to `client/src/components/permissions/PermissionsEditor.tsx`, named export `PermissionsEditor`.

**Acceptance:** `client/src/pages/AdminPermissionSetsPage.tsx` + `client/src/components/org-settings/PermissionsTab.tsx` both import `PermissionsEditor`; jscpd no longer reports the 176L triple-clone.

### 6.3. DUP3 — `OrgApprovalChannelsPage` ↔ `SubaccountApprovalChannelsPage` triple-clone (178L total)

Lift `<ApprovalChannelsEditor>` to `client/src/components/approval/ApprovalChannelsEditor.tsx`, named export `ApprovalChannelsEditor`.

**Acceptance:** both source pages import `ApprovalChannelsEditor`; jscpd no longer reports the 178L triple-clone.

### 6.4. DUP4 — `AgentChatPage` ↔ `ConfigAssistantPage` clones (125L + 68L `messageRender.tsx` 100% duplicated)

Combine the two `messageRender.tsx` copies (`client/src/components/agent-chat/messageRender.tsx` + `client/src/components/config-assistant/messageRender.tsx`) into `client/src/components/chat/messageRender.tsx`, named export `MessageRender`. Both pages import from the unified module; the two source copies are deleted (not left as re-export shims).

**Acceptance:** the two source copies are deleted; both pages import from `chat/messageRender`; jscpd no longer reports the 68L 100%-duplicated clone or the 125L page clone.

### 6.5. DUP5 — `SubaccountBlueprintsPage` ↔ `SystemOrganisationTemplatesPage` (143L)

Template-rendering UI cloned. Extract `<TemplateGrid>` to `client/src/components/templates/TemplateGrid.tsx`, named export `TemplateGrid`.

**Acceptance:** both pages import `TemplateGrid`; jscpd no longer reports the 143L clone.

### 6.6. DUP7 — `hierarchyTemplateService` ↔ `systemTemplateService` clones (44L + 33L)

Single source of truth. Move the duplicated helpers to `server/services/templates/templateHelpers.ts`, named exports per the architect's chunk 0 inventory of which helpers are actually shared. Both services import.

**Canonical ownership:** `server/services/templates/templateHelpers.ts` is the sole source of truth for any helper extracted by this chunk. `hierarchyTemplateService.ts` and `systemTemplateService.ts` MUST NOT carry parallel private copies of the same helper after extraction. Future changes to the extracted helpers happen in `templateHelpers.ts` only — if a future caller needs a variant, it either extends the shared helper with a parameter or adds a NEW named helper in the same shared module; it does NOT re-introduce a per-service copy.

**Acceptance:** both services import from `templates/templateHelpers`; neither service retains a private copy of the extracted helpers; jscpd no longer reports the 44L+33L clone pair; `npx tsc --noEmit` exits 0.

### 6.7. DUP8 — Prune-job family clones (all 6 jobs, 28-33L blocks each)

Extract `definePruneJob({table, retentionConfig})` factory to `server/jobs/lib/definePruneJob.ts`, named export `definePruneJob`. All 6 prune-job files become thin wrappers that call the factory: `agentObservationsPruneJob`, `fastPathDecisionsPruneJob`, `sandboxEgressAuditPruneJob`, `sandboxLogsPruneJob`, `sandboxTelemetryPruneJob`, `webhookReplayNoncePruneJob`. (Audit baseline identified 4 as duplicated above the jscpd threshold; the marginal cost of migrating the other 2 once the factory exists is trivial, so they are in scope to keep the family uniform.)

**Acceptance:** all 6 prune jobs are thin `definePruneJob(...)` wrappers; jscpd no longer reports the prune-family clones; `npx tsc --noEmit` exits 0.

### 6.8. DUP9 — `calendarActionService` ↔ `slackActionService` 32L clone

Shared dispatch helper at `server/services/actions/dispatchHelper.ts`, named export per architect's chunk 0 design. Both services (`server/services/calendar/calendarActionService.ts` + `server/services/slack/slackActionService.ts`) import.

**Canonical ownership:** `server/services/actions/dispatchHelper.ts` is the sole source of truth for the extracted dispatch logic. `calendarActionService.ts` and `slackActionService.ts` MUST NOT retain parallel copies after extraction. Any future action service (e.g. a new SMS or webhook action) that needs the same dispatch shape imports from `dispatchHelper.ts`; it does NOT re-implement the helper locally.

**Acceptance:** both services import from `actions/dispatchHelper`; neither service retains a private copy of the extracted helper; jscpd no longer reports the 32L clone.

## 7. Frontend complexity

Each item below has a **binding default verdict**. The operator may override the verdict at chunk 0 before chunks 13-14 begin; if no override is recorded by the chunk 0 sign-off, the default verdict is the spec.

### 7.1. FE1 — `operate/HomePage.tsx` exceeds complexity budget

Current state: 4× MetricCard tiles + RunActivityChart hero. Per `docs/frontend-design-principles.md § Complexity budget per screen`, "KPI tiles: 0 by default".

**Default verdict (binding):** TRIM. Remove the 4 MetricCard tiles entirely; the RunActivityChart hero stays. Rationale: operator-facing page, primary task is "see live activity", tiles are decoration per the §*default to hidden* principle.

**Override path:** at chunk 0, operator may instead specify "trim to N tiles" (1-3) and which tiles to retain.

**Acceptance:** chunk 13 implements exactly the verdict (default or override); `verify-page-complexity-budget.sh` baseline passes (CI-enforced).

### 7.2. FE4 — `SystemIncidentsPage.tsx` 491 LOC

Above the long-page heuristic. System-admin-only so relaxed budget applies.

**Default verdict (binding):** EXTRACT. Extract `<IncidentTimeline>` and `<IncidentDetailDrawer>` to `client/src/components/system-incidents/` to reduce parent file LOC below 400.

**Override path:** at chunk 0, operator may instead specify "accept the LOC" with a documented rationale appended to the page header comment.

**Extraction success criteria (default verdict only — beyond LOC reduction):** each extracted sub-component MUST clear ALL of the following before chunk 13 is marked done. LOC reduction alone is not sufficient — extraction that merely relocates complexity does NOT pass.

| Criterion | Definition (per extracted sub-component) |
|---|---|
| Independent testability | Sub-component can be rendered in isolation given only its declared props; no hidden parent-state coupling. If it cannot be rendered in isolation, the extraction has not actually decoupled the logic. |
| Prop boundary clarity | Props are a small, named, typed surface (rule of thumb: ≤6 props; if more, the boundary is wrong or the parent state shape needs flattening first). No `any`, no untyped option bags. |
| Reduced render branching | Sub-component contains at most one top-level branching axis (e.g. loading vs loaded, or detail-open vs closed — not both layered). If two branching axes survive, split further or stop and re-plan. |
| Reduced hook density | Sub-component uses fewer hooks than the parent line range it replaces. Counter-example to avoid: parent had 4 `useState` / 3 `useEffect` inline; sub-component takes all 7 — that is relocation, not reduction. |
| Reduced cognitive load | Reviewer (chunk 13 pr-reviewer pass) confirms the parent file is genuinely easier to scan after extraction. If the reviewer flags "feels the same, just split", chunk 13 re-plans. |

**Acceptance:** chunk 13 either extracts the two sub-components AND each extracted sub-component clears all five criteria above (default) or appends the documented-acceptance comment (override).

### 7.3. FE5+FE6 — Dashboard-named pages deep-read

Targets: `ClientPulseDashboardPage`, `ClientPulseDrilldownPage`, `JobQueueDashboardPage`, `SpendLedgerPage`.

**Default verdict (binding):** ACCEPT, all four. Per-page documented-acceptance header comment of the form "admin/power-user page; complexity intentional; reviewed wave-4 spec §7.3 2026-05-15".

**Override path:** at chunk 0, operator may instead specify per-page trim instructions (which sections to remove or move behind expanders).

**Acceptance:** chunk 14 appends the documented-acceptance header to each of the four pages (default) or implements the per-page trim instructions (override).
## 8. Acceptance Criteria

A build is complete when ALL of the following hold:

1. CD1 fix: CI's `npm run check:circular` (madge) no longer reports any cycle on the skillExecutor ↔ workflowEngine edge. Total cycle count drops by at least 43 from the 73-baseline (i.e. ≤30 if chunk 4 cleanup also resolves trivial sibling cycles surfaced when the CD1 edge is removed, otherwise 28-31). The hard bar is "no skillExecutor ↔ workflowEngine cycle remains"; the absolute count target is a soft goal.
2. All 8 duplication extractions land. Estimated jscpd duplicated-line reduction is **approximately 1,200-1,500 lines of duplicated source** (sum of declared block sizes: 213+209+176+178+125+68+143+44+33+~120 [4 prune-job blocks @ ~30L]+32). The `~1,800` figure in earlier drafts was a coarse upper bound; the precise number is whatever CI's jscpd baseline reports post-build, which MUST be lower than the pre-build baseline.
3. Each frontend complexity item resolved per §7 (default verdicts binding unless overridden at chunk 0).
4. `npm run build:server` exits 0 locally.
5. `npm run build:client` exits 0 locally.
6. `npm run lint` exits 0 locally.
7. CI's `verify-duplicate-blocks.sh` baseline reports a lower clone-block count than pre-build (CI-enforced; per CLAUDE.md *Test gates are CI-only*, do NOT run the script locally — CI runs it pre-merge).
8. Targeted Vitest unit tests authored for any new pure-function code in this build pass via `npx vitest run <path>` (per CLAUDE.md verification table). The full suite (`test:gates`, `test:qa`, `test:unit`) runs in CI only — implementers MUST NOT run the broader suite locally.
9. `tasks/todo.md` items in §1 marked `[status:closed:pr:<num>]` in the merge commit.

## 9. Chunks (high-level)

Architect refines during plan phase. Expected shape:

- **Chunk 0**: scope verification + file-set sweep + HandlerContext interface design + operator decisions (FE1/FE4/FE5/FE6 trim-or-accept calls) + plan write
- **Chunks 1-4 (CD1 architectural — the biggest piece)**:
  - Chunk 1: author `handlerContextTypes.ts` (pure type module) + author `buildHandlerContext.ts` (factory; not yet wired into boot). Compiles in isolation; no runtime caller updated yet.
  - Chunk 2: migrate skillExecutor handlers + registry to accept HandlerContext (signatures change; registry's call sites still pass through whatever wiring exists today).
  - Chunk 3: migrate workflowEngine queue-lifecycle handlers + dispatch to accept HandlerContext (same shape as chunk 2).
  - Chunk 4: wire `buildHandlerContext()` at boot, replacing the prior direct-import paths with the injected context. Run `npm run check:circular` and confirm the CD1 edge is gone. Remove any now-obsolete direct imports surfaced by `eslint --no-eslintrc` or the `import/no-cycle` rule.
- **Chunks 5-12 (duplication extractions, 1 per DUP)**:
  - One chunk per extraction: DUP1, DUP2, DUP3, DUP4, DUP5, DUP7, DUP8, DUP9
- **Chunks 13-14 (frontend complexity)**:
  - Chunk 13: FE1 trim + FE4 extraction
  - Chunk 14: FE5+FE6 deep-read + per-page decision
- **Chunk 15**: spec-conformance + pr-reviewer + reality-checker + final review pass

## 10. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| HandlerContext interface design surfaces unexpected dependencies during chunk 0 | medium | Chunk 0 ends with operator confirmation of the interface before chunks 1-4 begin. If interface bloats beyond ~12 methods, surface a re-plan signal. |
| Duplication extractions break visual rendering despite identical logic | low | Each chunk runs a client build + manual smoke against the affected pages. |
| FE1 trim removes a tile the operator actually wanted | medium | Operator approves the trim list in chunk 0; chunk 13 implements exactly what was approved. |
| CD1 fix surfaces tightly-coupled handler logic that resists injection | medium | If a handler has > 5 service dependencies, group them into a domain-specific sub-context (e.g., `WorkflowDispatchContext`) rather than bloating the master `HandlerContext`. |

## 11. Out of Scope

The following are explicitly NOT part of this spec; they live in other sessions/sprints or are post-lockdown v2. This section is about non-scope (other-spec ownership), not about deferred work within THIS spec — see §12 Deferred Items.

- **CD2-CD10** — Session G scope (small cycles).
- **DUP6** — Session G scope (same-file extraction).
- **AE1, AE2, AE5** — Session G scope (handoff durability).
- **MC tests** — Session G scope (test-meta + standalone).
- **LAEL Phases 1-3** — Wave 5 scope per operator decision 2026-05-15.
- **PA-V2 chunks 5+** — Wave 5 scope per operator decision 2026-05-15.
- **Two additional features** — operator will define in separate branches per 2026-05-15 statement.
- All Hermes / iee-browser / OSI-DEF / Sandbox-defer / not-feasible items — post-lockdown v2 per Wave 1/2 operator decisions.

## 12. Deferred Items

None within this spec. Every item in §1 is shipped in this build; no work is deferred to a later phase of THIS build. Items in §11 are owned by other sessions/sprints, not deferred work within wave-4. The checklist §7 framing distinguishes between "non-scope" (§11) and "deferred within this spec" (§12 — empty for this build).
