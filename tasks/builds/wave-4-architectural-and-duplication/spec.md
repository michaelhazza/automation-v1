---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Major
source_branch: main
build_slug: wave-4-architectural-and-duplication
output_location: tasks/builds/wave-4-architectural-and-duplication/spec.md
---

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

## 2. Goals

1. Break the CD1 super-cycle by inverting `skillExecutor` and `workflowEngine` handler imports. The pattern: handlers receive their dependencies via a `HandlerContext` object instead of importing services directly.
2. Extract 8 named duplication clones to shared modules. Each is a UI or service-helper lift.
3. Address 4 frontend complexity items via sub-component extraction OR an explicit "this dashboard is admin-only, accept the LOC" decision.
4. Drop `madge --circular` count from 73 server cycles to under 30 (CD1 alone removes ~43).
5. Drop `jscpd` duplicated-line count by ~1,800 lines (the 8 extractions sum to ~1,800L across both halves of each clone).

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
- The 4 frontend complexity items (FE1 = operate/HomePage 4×MetricCard + RunActivityChart; FE4 = SystemIncidentsPage 491 LOC; FE5+FE6 = ClientPulseDashboardPage, ClientPulseDrilldownPage, JobQueueDashboardPage, SpendLedgerPage) require operator review to decide between trim-or-accept. Default: trim FE1 (operator-facing); accept the others with documented "admin-only, complexity acceptable" rationale.
- Total touch surface: `server/services/skillExecutor/`, `server/services/workflowEngine/`, `client/src/components/` (8 new shared modules), `client/src/pages/{operate, govern, system, AdminPermissionSets, OrgApprovalChannels, SubaccountApprovalChannels, SubaccountBlueprints, SystemOrganisationTemplates, AgentChat, ConfigAssistant, ClientPulse*, JobQueueDashboard, SpendLedger, SystemIncidents}`, `server/services/{hierarchyTemplate, systemTemplate, calendarAction, slackAction, notifyOperatorFanout}`.
- TypeScript strict mode is on. The existing tsconfig path mapping is immutable.
## 5. CD1 — skillExecutor ↔ workflowEngine super-cycle break

### 5.1. Current shape

Long chains routing through `workflowEngine/queueLifecycle/dispatch.ts > workflowActionCallExecutor.ts > skillExecutor.ts > skillExecutor/registry.ts > skillExecutor/handlers/*.ts > tools/*.ts > services/*.ts > workflowEngineService.ts > ...`.

Root cause: handler files in both `skillExecutor/handlers/` and `workflowEngine/queueLifecycle/` import services directly from the OTHER subsystem. This creates a bidirectional edge: skill handlers need the workflow engine to enqueue downstream steps; workflow queue handlers need the skill executor to dispatch a skill from a workflow step.

### 5.2. Fix — handler-injection pattern

Each handler gains a `HandlerContext` parameter containing the methods it needs:

```typescript
// Conceptual shape — architect refines exact interface during chunk 0
interface HandlerContext {
  workflowEngine: {
    enqueueTick(runId: string): Promise<void>;
    enqueueStep(stepRunId: string): Promise<void>;
    // ... methods the skill handlers actually call
  };
  skillExecutor: {
    invokeSkill(name: string, payload: unknown): Promise<unknown>;
    // ... methods the workflow handlers actually call
  };
  // ... other injected services as needed
}
```

The wiring layer (boot-time, likely `server/index.ts` or a new `server/lib/handlerContext.ts`) constructs the context object with both real implementations and passes it to each handler at registration.

This breaks the import cycle because:
- Handlers import `HandlerContext` (a pure interface, no implementation)
- Handlers do NOT import `workflowEngineService` or `skillExecutor` directly
- The wiring layer imports both implementations and constructs the context

### 5.3. Out-of-scope variants

- We are NOT moving to a full DI framework (e.g., InversifyJS). Hand-rolled `HandlerContext` interface + boot-time wiring is sufficient.
- We are NOT renaming `skillExecutor` or `workflowEngineService` exports.
- We are NOT changing the runtime behaviour of any handler — only how it gets its dependencies.

### 5.4. Acceptance

- `madge --circular` no longer reports any cycle on the skillExecutor ↔ workflowEngine edge.
- Every skill handler accepts a `HandlerContext` (or equivalent named context interface).
- Every workflow queue-lifecycle handler accepts a `HandlerContext`.
- Boot-time wiring constructs the context once and passes it to each handler.
- `npm run build:server` exits 0.
- No behaviour change in any handler (existing Vitest passes).

## 6. Duplication extractions

Each is a mechanical lift. The pattern: identify the cloned block, extract to a named module, both original sites import from the new module, delete the duplicate code.

### 6.1. DUP1 — 213L + 209L Skills pages ↔ pulse/HistoryTab.tsx

Extract shared rendering logic to `client/src/components/skills/historyRender.tsx` (or equivalent — architect names during chunk 0).

### 6.2. DUP2 — `AdminPermissionSetsPage` ↔ `org-settings/PermissionsTab` triple-clone (176L total)

Lift `<PermissionsEditor>` component to `client/src/components/permissions/PermissionsEditor.tsx`.

### 6.3. DUP3 — `OrgApprovalChannelsPage` ↔ `SubaccountApprovalChannelsPage` triple-clone (178L total)

Lift `<ApprovalChannelsEditor>` component to `client/src/components/approval/ApprovalChannelsEditor.tsx`.

### 6.4. DUP4 — `AgentChatPage` ↔ `ConfigAssistantPage` clones (125L + 68L `messageRender.tsx` 100% duplicated)

Combine the two `messageRender.tsx` copies into `client/src/components/chat/messageRender.tsx`. Both pages import from the unified module.

### 6.5. DUP5 — `SubaccountBlueprintsPage` ↔ `SystemOrganisationTemplatesPage` (143L)

Template-rendering UI cloned. Extract `<TemplateGrid>` (or named component) to `client/src/components/templates/TemplateGrid.tsx`.

### 6.6. DUP7 — `hierarchyTemplateService` ↔ `systemTemplateService` clones (44L + 33L)

Single source of truth. Move the duplicated logic to a shared helper at `server/services/templates/templateHelpers.ts` or similar; both services import.

### 6.7. DUP8 — Prune-job family clones (4 jobs, 28-33L blocks each)

Extract `definePruneJob({table, retentionConfig})` factory to `server/jobs/lib/definePruneJob.ts`. The 4 prune jobs become thin wrappers that call the factory.

### 6.8. DUP9 — `calendarActionService` ↔ `slackActionService` 32L clone

Shared dispatch helper at `server/services/actions/dispatchHelper.ts`. Both services import.

## 7. Frontend complexity

### 7.1. FE1 — `operate/HomePage.tsx` exceeds complexity budget

Current state: 4× MetricCard tiles + RunActivityChart hero. Per `docs/frontend-design-principles.md § Complexity budget per screen`, "KPI tiles: 0 by default".

Fix decision (chunk 0, operator confirms): trim the 4 tiles to 0-1 most-load-bearing OR move tiles behind an "Insights" expander. Default: trim to single primary metric tile if needed; remove the 3 non-load-bearing tiles.

Acceptance: complexity audit passes; operator visual confirmation.

### 7.2. FE4 — `SystemIncidentsPage.tsx` 491 LOC

Above the long-page heuristic. Admin-only so relaxed budget applies.

Fix decision (chunk 0): extract 2-3 sub-components OR accept the LOC with documented "admin-only, complexity acceptable" rationale. Default: extract `<IncidentTimeline>` and `<IncidentDetailDrawer>` to reduce parent file LOC.

Acceptance: page LOC drops below 400 OR documented acceptance in `architecture.md`.

### 7.3. FE5+FE6 — Dashboard-named pages deep-read

Targets: `ClientPulseDashboardPage`, `ClientPulseDrilldownPage`, `JobQueueDashboardPage`, `SpendLedgerPage`.

Fix decision (chunk 0): per-page operator review. Determine if dashboards are load-bearing or decoration. For load-bearing, accept LOC. For decoration, trim per `docs/frontend-design-principles.md § default to hidden`.

Default: accept all four as admin-only / power-user pages with documented rationale.

Acceptance: each page either trimmed OR documented acceptance.
## 8. Acceptance Criteria

A build is complete when ALL of the following hold:

1. CD1 fix: `madge --circular` no longer reports the skillExecutor ↔ workflowEngine edge. Total cycle count drops from 73 to under 30.
2. All 8 duplication extractions land. `jscpd` duplicated-line count drops by ~1,800 lines.
3. Each frontend complexity item resolved per §7.
4. `npm run build:server` exits 0.
5. `npm run build:client` exits 0.
6. `npm run lint` exits 0.
7. `verify-duplicate-blocks.sh` baseline drops.
8. Existing test suite (where present) passes with no behaviour change.
9. `tasks/todo.md` items in §1 marked `[status:closed:pr:<num>]` in the merge commit.

## 9. Chunks (high-level)

Architect refines during plan phase. Expected shape:

- **Chunk 0**: scope verification + file-set sweep + HandlerContext interface design + operator decisions (FE1/FE4/FE5/FE6 trim-or-accept calls) + plan write
- **Chunks 1-4 (CD1 architectural — the biggest piece)**:
  - Chunk 1: design and author HandlerContext interface + boot-time wiring layer
  - Chunk 2: migrate skillExecutor handlers to accept HandlerContext
  - Chunk 3: migrate workflowEngine queue-lifecycle handlers to accept HandlerContext
  - Chunk 4: verify cycle break via madge; remove obsolete direct imports
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

The following stay v2-backlog or are in another session:

- **CD2-CD10** — Session G scope (small cycles).
- **DUP6** — Session G scope (same-file extraction).
- **AE1, AE2, AE5** — Session G scope (handoff durability).
- **MC tests** — Session G scope (test-meta + standalone).
- **LAEL Phases 1-3** — Wave 5 scope per operator decision 2026-05-15.
- **PA-V2 chunks 5+** — Wave 5 scope per operator decision 2026-05-15.
- **Two additional features** — operator will define in separate branches per 2026-05-15 statement.
- All Hermes / iee-browser / OSI-DEF / Sandbox-defer / not-feasible items — post-lockdown v2 per Wave 1/2 operator decisions.
