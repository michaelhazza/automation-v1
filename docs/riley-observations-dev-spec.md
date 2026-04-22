# Riley Observations — Development Specification

_Date: 2026-04-22_
_Status: draft for review; architect decomposition follows finalisation_
_Source brief: `docs/riley-observations-dev-brief.md` (v2)_
_Related: `docs/openclaw-strategic-analysis.md` (2026-04-18)_

---

## Document purpose and audience

This is a prescriptive development specification. It turns the v2 brief into a buildable plan.

- **Reviewers** (human + `spec-reviewer` + external LLM): scrutinise the design decisions, contracts, edge cases, and ordering. Flag gaps before the architect plans against this spec.
- **Architect agent** (next step after this spec finalises): decomposes each Part into one or more implementation plans under `tasks/builds/riley-observations/`.
- **Main development session** (after architect): executes against the decomposed plans.

Every proposed change in this spec has: a clear contract, named files/surfaces, an ordered change list, edge cases, and success criteria. Nothing is hand-waved — if it's not specified here, it's listed under *Open questions for architect*.

---

## Contents

1. [Goals, non-goals, success criteria](#1-goals-non-goals-success-criteria)
2. [Background — condensed](#2-background--condensed)
3. [Existing system reference](#3-existing-system-reference)
4. [Part 1 — Naming pass](#4-part-1--naming-pass)
5. [Part 2 — Workflows calling Automations (composition)](#5-part-2--workflows-calling-automations-composition)
6. [Part 3 — Explore Mode / Execute Mode](#6-part-3--explore-mode--execute-mode)
7. [Part 4 — Heartbeat activity-gate](#7-part-4--heartbeat-activity-gate)
8. [Part 5 — Context-assembly telemetry](#8-part-5--context-assembly-telemetry)
9. [Part 6 — Agent-decomposition rule](#9-part-6--agent-decomposition-rule)
10. [Data migration plan](#10-data-migration-plan)
11. [Rollout plan + test strategy](#11-rollout-plan--test-strategy)
12. [Open questions for architect](#12-open-questions-for-architect)
13. [Appendix — mapping tables and glossary](#13-appendix--mapping-tables-and-glossary)

---

## 1. Goals, non-goals, success criteria

### 1.1 Goals

1. **Eliminate naming debt** — one clear mental model (`Automations` are external, `Workflows` are native multi-step orchestrations; Workflows can invoke Automations as steps).
2. **Ship a visible safety affordance** — `Explore Mode` / `Execute Mode` as a first-class run concept, defaulting new agents to Explore.
3. **Reduce heartbeat waste** — deterministic activity-gate skips unproductive Portfolio Health Agent ticks.
4. **Make context assembly debuggable** — single telemetry event with enough signal to diagnose bad runs in <30 seconds.
5. **Codify one hygiene rule** — agent-decomposition heuristic written to the spec-authoring checklist.

### 1.2 Non-goals (deliberately deferred)

- New onboarding flow, guided first-run, starter-workflow library, outcome-first navigation. Tracked separately as the next wave. See §10 of the brief.
- LLM-based heartbeat decision-step. Deferred until deterministic gate proves insufficient.
- Per-phase / per-memory-source telemetry. Minimal v1 event ships; richer breakdowns land only when debugging questions demand them.
- Data sandbox (duplicated DBs, synthetic data). Explore Mode is the substitute.
- OpenClaw substrate work. Covered in `openclaw-strategic-analysis.md`.
- `processedResources` renaming. Unrelated to the `processes` primitive; leave as-is.

### 1.3 Success criteria (objective, measurable)

| # | Criterion | Measurement |
|---|---|---|
| 1 | Zero user-visible "Playbook" / "Playbooks" strings remain | grep of `client/src/`, server-rendered templates, portal surfaces returns only historical migration file comments |
| 2 | Zero user-visible "Workflows" referring to external integrations | grep + manual audit across nav, empty states, portal cards |
| 3 | `drizzle-kit introspect` diff against updated schema is clean after all three migrations | CI job runs this check on the PR |
| 4 | A first-time user cannot auto-execute a side-effecting action on a new agent without explicitly switching from Explore to Execute | Verified by manual QA and by a new integration test |
| 5 | 100% of agent-loop runs emit exactly one `context.assembly.complete` event | Query on the tracing sink; zero missing for a 24h window post-launch |
| 6 | Portfolio Health Agent skip-rate lands in 20–60% window after 2 weeks of post-launch operation | Query on `heartbeat.tick.gated` events |
| 7 | No in-flight feature branch is broken for more than one day after the naming-pass PR merges | Manual audit of open PRs + rebase script |

### 1.4 Out-of-scope safeguards

This spec does **not** modify:
- Agent roster (the 15+ system agents)
- Orchestrator capability routing logic
- Universal Brief fast-path classifier
- Memory-block retrieval precedence
- Integration credentials / OAuth layer
- Portal layout beyond renamed strings
- `processedResources` or any unrelated "process"-named concept

If any of these surface during implementation as requiring change, escalate before proceeding.

---

## 2. Background — condensed

This section assumes the reader has read `docs/riley-observations-dev-brief.md` (v2). Key points carried forward:

- **Pre-launch posture.** No live users, no paying customers, no API consumers in production, no in-place data to preserve. Migrations and renames are cheap now and expensive forever after launch.
- **Two-pass reviewer reconciliation.** v1 brief external-reviewed by ChatGPT; v2 integrated feedback (Explore/Execute Mode, deterministic heartbeat, minimal telemetry, demoted decomposition rule). This spec inherits the v2 framing.
- **One concept pair, not two.** `Automations` = external engine wrappers (Make/n8n/Zapier/GHL/custom webhooks). `Workflows` = native multi-step orchestrations. Composition (Workflows invoke Automations as steps) makes the two concepts feel like one coherent system.
- **Three "workflow"-named concepts exist in the schema today.** The rename requires a prerequisite pass to clear the `workflow*` namespace (the internal flow stack moves to `flow*`) before `playbooks → workflows` can land.

### 2.1 The rename in one sentence

> Automations are external tools we call. Workflows are native multi-step orchestrations we run with our agents. Workflows can invoke Automations as steps.

This is the test for every label, column, file, string, and docstring touched by this spec.

---

## 3. Existing system reference

This is the vocabulary every Part builds on. Reference section — skip to Part 1 if already familiar.

### 3.1 Primitives

| Primitive | Where it lives | What it does |
|---|---|---|
| **Agents** | `companies/automation-os/agents/{slug}/AGENTS.md`, DB table `agents` | 15+ system-defined agents each scoped to a capability area (Dev, QA, Ads Mgmt, CRM, Portfolio Health, etc.). |
| **Skills** | `server/skills/*.md`, `companies/*/skills/*.md` | Bounded capabilities an agent can invoke. Statically bound via YAML frontmatter in `AGENTS.md`. Each agent sees only its assigned subset. |
| **Orchestrator** | `server/jobs/orchestratorFromTaskJob.ts`, `docs/orchestrator-capability-routing-spec.md` | Receives tasks and routes to the right agent or delegates to the Configuration Assistant. |
| **Universal Brief fast-path** | `server/services/briefCreationService.ts`, `server/services/chatTriageClassifier.ts` | Two-layer classifier (heuristic tier 1 + Haiku LLM tier 2) that decides simple_reply / cheap_answer / needs_clarification / needs_orchestrator. Logs to `fast_path_decisions`. |
| **Agent execution** | `server/services/agentExecutionService.ts` | Assembles context (briefing + beliefs + memory blocks + workspace memory + known entities) before the agent loop starts. |
| **Playbooks** (to become Workflows) | DB: `playbooks`, `playbook_runs`, `playbook_step_runs`, `playbook_step_reviews`, `playbook_templates`, `playbook_template_versions`, `playbook_studio_sessions`, `playbook_run_event_sequences`, `system_playbook_templates`, `system_playbook_template_versions`. Services: `playbookStudioService.ts`. UI: `PlaybookStudioPage`, `PlaybooksLibraryPage`, `PlaybookRunModal`, `PlaybookRunDetailPage`. Files: `*.playbook.ts`. Skills: `playbook_*`. | Native DAG orchestration with HITL gates, memory integration, scheduling, simulation, cost estimation, per-step reviews. |
| **Processes** (UI: Workflows; to become Automations) | DB: `processes`, `process_categories`, `subaccount_process_links`, `process_connection_mappings`. Service: `processService.ts`, `processResolutionService.ts`. Routes: `/api/processes/*`. Pages: `TasksPage.tsx` (lazy-loaded as `ProcessesPage`), `AdminTasksPage.tsx`, `TaskExecutionPage.tsx`, `AdminTaskEditPage.tsx`, `SystemProcessesPage.tsx`. | Webhook wrappers for external engines. Each row points at a Make scenario / n8n flow / GHL workflow / Zapier zap / custom webhook. |
| **Workflow engines** (to become Automation engines) | DB: `workflow_engines`. | Infrastructure registry of external engines (`engineType: 'n8n' \| 'ghl' \| 'make' \| 'zapier' \| 'custom_webhook'`). |
| **Internal flow stack** (to be renamed out of the way) | DB: `workflow_runs`, `workflow_step_outputs`, `canonicalWorkflowDefinitions`. Service: `workflowExecutorService.ts`. Types: `server/types/workflow.ts`. Consumers: `actionService.ts`, `scanIntegrationFingerprintsService.ts`. Migration provenance: `0037_phase1c_memory_and_workflows.sql`. | A separate internal flow-execution stack ("Flows pattern" per schema comment). Predates Playbooks (migration 0076). Not user-facing. Collides with the target namespace for Playbook → Workflow rename. |
| **HITL gate resolution** | `server/services/agentExecutionService.ts` | Resolves effective gate level per skill: `auto` / `review` / `block`. |
| **Supervised mode** | `client/src/components/PlaybookRunModal.tsx:339–344` (`runMode: 'supervised' \| 'auto'`) | Forces pause before each side-effecting step for a specific run. |
| **Heartbeat** | `migrations/0068_portfolio_health_agent_seed.sql`, `server/services/agentScheduleService.ts`, `server/services/scheduleCalendarService.ts`, `client/src/pages/AdminAgentEditPage.tsx:1416–1422`. Columns: `agents.heartbeat_enabled`, `agents.heartbeat_interval_hours`, `subaccount_agents.heartbeat_enabled/_interval_hours/_offset`. | Scheduled wake-up for agents. Portfolio Health runs every 4h. Currently runs unconditionally each tick. |
| **Tracing registry** | `server/lib/tracing.ts` | Named event emitter for structured observability. |
| **Fast-path telemetry** | `fast_path_decisions` table, `fastPathDecisionLogger.ts` | Shadow-eval logging for Universal Brief classifier. Async / best-effort. |

### 3.2 Permissions and scoping model

- Three-level scope across Automations, Workflows, Engines, skills: `system` (global, no org), `organisation` (agency-owned), `subaccount` (client-specific).
- Permissions are enum-keyed (`ORG_PERMISSIONS.PLAYBOOKS_VIEW`, `PROCESSES_CREATE`, etc.) and evaluated in `middleware/auth.ts` / `lib/permissions.ts`.
- RLS and principal context apply per-request.

### 3.3 Portal surface

- Portal (`/portal/:subaccountId/*`) is the customer-facing view into agency-configured primitives.
- Portal currently exposes both Playbooks and Processes (plus other surfaces). Any rename to user-visible strings propagates to portal copy.

---

## 4. Part 1 — Naming pass

Three-step ordered rename: clear the `workflow*` namespace, rename `processes → automations`, rename `playbooks → workflows`. All three steps ship in one PR. Each step produces a distinct commit that is green (tests pass, types compile) before the next step begins.

### 4.1 Why one PR, not three

The intermediate states between steps are *valid* but *semantically confusing*:

- After step 1: the internal flow stack has moved to `flow*` but nothing externally visible has changed.
- After step 2: `processes` has become `automations`, but `playbooks` still exists as the native orchestration primitive — the mental model is incoherent for a brief window.
- After step 3: full end-state.

Landing all three in one PR means reviewers evaluate the end state, not the intermediate mess. Each step is still a separate commit on the branch so rollback and bisect remain surgical.

### 4.2 Ordering constraint

Step 3 cannot ship until Step 1 clears the `workflow*` namespace. Naively renaming `playbook_runs → workflow_runs` collides with the existing `workflow_runs` table in the internal flow stack. Step 1 is the prerequisite.

### 4.3 Step 1 — Rename internal flow stack

**Purpose:** clear the `workflow*` namespace so step 3 can use it.

**Schema changes** (migration: `0172_rename_workflow_runs_to_flow_runs.sql`):

| From | To |
|---|---|
| Table `workflow_runs` | `flow_runs` |
| Table `workflow_step_outputs` | `flow_step_outputs` |
| Foreign key constraint names (Postgres auto-retains; rename for consistency) | Updated to `flow_*` pattern |
| Indexes referencing `workflow_*` | Renamed to `flow_*` |

**Drizzle schema file changes:**

| From | To |
|---|---|
| `server/db/schema/workflowRuns.ts` | `server/db/schema/flowRuns.ts` |
| `server/db/schema/workflowStepOutputs.ts` (if separate) or definitions inside `workflowRuns.ts` | `server/db/schema/flowStepOutputs.ts` |
| Schema barrel `server/db/schema/index.ts` — export updates | Barrel re-exports `flow_runs`, `flow_step_outputs` |
| `canonicalWorkflowDefinitions` in `clientPulseCanonicalTables.ts:182` | `canonicalFlowDefinitions` (same file, inline rename) |

**Type exports:**

| From | To |
|---|---|
| `WorkflowRun`, `NewWorkflowRun` | `FlowRun`, `NewFlowRun` |
| `WorkflowStepOutput`, `NewWorkflowStepOutput` | `FlowStepOutput`, `NewFlowStepOutput` |
| `WorkflowDefinition` (in `server/types/workflow.ts`) | `FlowDefinition` (in `server/types/flow.ts`) |
| `WorkflowRunStatus`, `WorkflowCheckpoint` | `FlowRunStatus`, `FlowCheckpoint` |

**Service / consumer changes:**

| From | To |
|---|---|
| `server/services/workflowExecutorService.ts` | `server/services/flowExecutorService.ts` |
| `server/types/workflow.ts` | `server/types/flow.ts` |
| References in `server/services/actionService.ts` | Updated imports + usage |
| References in `server/services/scanIntegrationFingerprintsService.ts` | Updated imports + usage |
| References in `server/services/queueService.ts` | Updated imports + usage |

**No user-visible surface.** This rename is purely internal; no UI strings, no routes, no permission keys change.

**Commit boundary:** one commit titled `refactor(flow): rename internal workflow stack to flow stack to clear namespace`. Green on merge (all tests pass, typecheck clean).

### 4.4 Naming decision log — alternatives considered for step 1

| Candidate | Rejected because |
|---|---|
| `action_runs` | Accurate (tied to `actionService.ts`) but `action` is already overloaded in skill vocabulary (*"skill takes an action"*); would create a new collision. |
| `integration_scan_runs` | Descriptive of one consumer (`scanIntegrationFingerprintsService.ts`) but not the other. Too narrow. |
| `legacy_workflow_runs` | Marks the stack as deprecated without actually deprecating it; the stack is still used. Misleading. |
| `flow_runs` **(chosen)** | Matches the existing schema comment ("Flows pattern"). Short. Not overloaded elsewhere in the code. Clear separation from user-facing `workflow_runs` that will exist after step 3. |

### 4.5 Verification after step 1

- `drizzle-kit introspect` diff against updated schema files is clean.
- All tests pass.
- `tsc` clean.
- `grep -rn 'workflow_runs\|WorkflowRun\|WorkflowDefinition' server/ client/` returns zero hits outside migration history and comments.

### 4.6 Step 2 — Rename processes → automations

**Purpose:** user-facing "Workflows" (external engine wrappers) become "Automations." Internal table and code names match the UI.

**Schema changes** (migration: `0173_rename_processes_to_automations.sql`):

| From | To |
|---|---|
| Table `processes` | `automations` |
| Table `process_categories` | `automation_categories` |
| Table `subaccount_process_links` | `subaccount_automation_links` |
| Table `process_connection_mappings` | `automation_connection_mappings` |
| Table `workflow_engines` | `automation_engines` |
| Column `processes.workflow_engine_id` | `automations.automation_engine_id` |
| Column `processes.parent_process_id` | `automations.parent_automation_id` |
| Column `processes.system_process_id` | `automations.system_automation_id` |
| Column `processes.is_system_managed` | retained as-is (boolean flag, no name change needed) |
| Column `processes.org_category_id` references `process_categories(id)` → `automation_categories(id)` | FK renamed |
| Indexes referencing `process_*` or `workflow_engines_*` | Renamed to `automation_*` / `automation_engines_*` |
| `engineType` enum value names (`n8n/ghl/make/zapier/custom_webhook`) | Retained — these are provider identifiers, not part of our naming debt |

**Not renamed** (deliberately):
- `processedResources` table (unrelated; resource-ingestion book-keeping).
- `dropZoneProcessingLog` (unrelated).
- `engineType` string values — they are external-provider identifiers. Our wrapper concept changes name; the providers don't.

**Drizzle schema file changes:**

| From | To |
|---|---|
| `server/db/schema/processes.ts` | `server/db/schema/automations.ts` |
| `server/db/schema/processCategories.ts` | `server/db/schema/automationCategories.ts` |
| `server/db/schema/subaccountProcessLinks.ts` | `server/db/schema/subaccountAutomationLinks.ts` |
| `server/db/schema/processConnectionMappings.ts` | `server/db/schema/automationConnectionMappings.ts` |
| `server/db/schema/workflowEngines.ts` | `server/db/schema/automationEngines.ts` |
| Exports in `server/db/schema/index.ts` | Updated |

**Type exports:**

| From | To |
|---|---|
| `Process`, `NewProcess` | `Automation`, `NewAutomation` |
| `ProcessCategory`, `NewProcessCategory` | `AutomationCategory`, `NewAutomationCategory` |
| `WorkflowEngine`, `NewWorkflowEngine` | `AutomationEngine`, `NewAutomationEngine` |
| `SubaccountProcessLink` | `SubaccountAutomationLink` |
| `ProcessConnectionMapping` | `AutomationConnectionMapping` |

**Service changes:**

| From | To |
|---|---|
| `server/services/processService.ts` | `server/services/automationService.ts` |
| `server/services/processResolutionService.ts` | `server/services/automationResolutionService.ts` |
| Exported class `ProcessService` | `AutomationService` |
| Exported class `ProcessResolutionService` | `AutomationResolutionService` |

**Route changes:**

| From | To |
|---|---|
| `server/routes/processes.ts` | `server/routes/automations.ts` |
| `server/routes/systemProcesses.ts` | `server/routes/systemAutomations.ts` |
| `server/routes/processConnectionMappings.ts` | `server/routes/automationConnectionMappings.ts` |
| `/api/processes/*` | `/api/automations/*` |
| `/api/system/processes/*` | `/api/system/automations/*` |
| Route registration in `server/index.ts` or equivalent | Updated |

**Permission keys:**

| From | To |
|---|---|
| `ORG_PERMISSIONS.PROCESSES_VIEW` | `ORG_PERMISSIONS.AUTOMATIONS_VIEW` |
| `ORG_PERMISSIONS.PROCESSES_CREATE` | `ORG_PERMISSIONS.AUTOMATIONS_CREATE` |
| `ORG_PERMISSIONS.PROCESSES_EDIT` | `ORG_PERMISSIONS.AUTOMATIONS_EDIT` |
| `ORG_PERMISSIONS.PROCESSES_DELETE` | `ORG_PERMISSIONS.AUTOMATIONS_DELETE` |
| `ORG_PERMISSIONS.PROCESSES_TEST` | `ORG_PERMISSIONS.AUTOMATIONS_TEST` |
| Permission seed data in migrations / bootstrap | Updated alongside the enum rename |

**UI page changes:**

| From | To |
|---|---|
| `client/src/pages/TasksPage.tsx` (lazy-loaded as `ProcessesPage`) | `client/src/pages/AutomationsPage.tsx`, lazy-loaded alias drops the `Tasks` name entirely |
| `client/src/pages/TaskExecutionPage.tsx` | `client/src/pages/AutomationExecutionPage.tsx` |
| `client/src/pages/AdminTasksPage.tsx` | `client/src/pages/AdminAutomationsPage.tsx` |
| `client/src/pages/AdminTaskEditPage.tsx` | `client/src/pages/AdminAutomationEditPage.tsx` |
| `client/src/pages/SystemProcessesPage.tsx` | `client/src/pages/SystemAutomationsPage.tsx` |
| Lazy-import aliases in `client/src/App.tsx` | Renamed both alias and target consistently (no more misleading `ProcessesPage → TasksPage` aliasing) |

**URL path changes:**

| From | To |
|---|---|
| `/processes` | `/automations` |
| `/processes/:id` | `/automations/:id` |
| `/admin/processes` | `/admin/automations` |
| `/admin/processes/:id` | `/admin/automations/:id` |
| `/system/processes` | `/system/automations` |
| `/portal/:subaccountId/processes/:processId` | `/portal/:subaccountId/automations/:automationId` |

**No URL redirects.** Pre-launch; nobody has bookmarks. Hard break is acceptable.

**UI string changes** (audit target — all instances of "Workflow(s)" referring to external integrations):

| File | Line(s) | From | To |
|---|---|---|---|
| `client/src/components/Layout.tsx` | 74 | `processes: 'Workflows'` in label map | `processes: 'Automations'` → then after rename `automations: 'Automations'` |
| `client/src/components/Layout.tsx` | 702 | `<NavItem to="/processes" ... label="Workflows" />` | `<NavItem to="/automations" ... label="Automations" />` |
| `client/src/components/Layout.tsx` | 810 | `hasSidebarItem('workflows')` sidebar-visibility key + label | Key stays internal; label changes |
| `client/src/components/Layout.tsx` | 826 | `label="Workflows"` on admin nav | `label="Automations"` |
| Empty states on `AutomationsPage` / admin / system variants | — | "No workflows available yet" | "No automations available yet" |
| Portal card (`PortalPage`) | — | If referenced as "Workflows" | Change to "Automations" |
| Any run-modal / detail / history copy | — | "Workflow X finished running" | "Automation X finished running" |
| Email templates, Slack messages, PDF exports | — | Any "workflow" copy referring to a `process` | Update to "automation" |

**Icons:**

- Current `Icons.automations` is already named "automations" in the icon pack — retain.
- Consider adding a distinct icon for Workflows (native orchestrations) in step 3; see §4.7.

**Test fixtures / seed data:**

- Any seed `.sql` or TypeScript fixture that inserts into `processes` / `process_categories` / `workflow_engines` → update to new table names.
- Test files referencing `processService` / `ProcessesPage` / `/api/processes` → updated imports.

### 4.7 Verification after step 2

- `drizzle-kit introspect` diff clean.
- `grep -rn 'processes\|/api/processes\|ProcessService\|TasksPage' client/src/ server/routes/ server/services/` returns zero hits outside migration history.
- Permission seed data inserts `AUTOMATIONS_*` keys, not `PROCESSES_*`.
- Manual smoke test: create an Automation via the admin UI; verify it appears on the library page; fire its webhook; confirm it executes against the engine.
- At this point the UI says "Automations" everywhere externally, but Playbooks still exist under their old name. The mental model is *"Automations are external; Playbooks are native"* — coherent but awkward. Step 3 resolves.

### 4.8 Step 3 — Rename playbooks → workflows

**Purpose:** native multi-step orchestration adopts the `workflow*` namespace (cleared by step 1). Final end state.

**Schema changes** (migration: `0174_rename_playbooks_to_workflows.sql`):

| From | To |
|---|---|
| Table `playbook_runs` | `workflow_runs` |
| Table `playbook_step_runs` | `workflow_step_runs` |
| Table `playbook_step_reviews` | `workflow_step_reviews` |
| Table `playbook_templates` | `workflow_templates` |
| Table `playbook_template_versions` | `workflow_template_versions` |
| Table `system_playbook_templates` | `system_workflow_templates` |
| Table `system_playbook_template_versions` | `system_workflow_template_versions` |
| Table `playbook_studio_sessions` | `workflow_studio_sessions` |
| Table `playbook_run_event_sequences` | `workflow_run_event_sequences` |
| Any column named `playbook_id` / `playbook_template_id` on child tables | `workflow_id` / `workflow_template_id` |
| FK constraints referencing renamed tables | Renamed for consistency |
| Indexes referencing `playbook_*` | Renamed to `workflow_*` |

**Check for columns carrying playbook identity in unrelated tables:**

- `memoryBlocks.ts` — `memory_block_playbook_fields` migration (0120) added fields; audit and rename.
- `modules.ts` — `modules_onboarding_playbook_slugs` migration (0119, 0122). Audit.
- `subaccountOnboardingState.ts` — references Playbook slugs.
- `portalBriefs.ts` — references Playbook runs.
- `agentRuns.ts` — may carry `playbook_run_id` linkage.
- `onboardingBundleConfigs.ts` — carries Playbook references.

Each of these is confirmed from `grep -lE "'playbooks'|'playbook_" server/db/schema/`. The migration renames any `playbook_*` column on these tables to `workflow_*`, and the corresponding Drizzle schema files update their field declarations and references.

**Drizzle schema file changes:**

| From | To |
|---|---|
| `server/db/schema/playbookRuns.ts` | `server/db/schema/workflowRuns.ts` |
| `server/db/schema/playbookTemplates.ts` | `server/db/schema/workflowTemplates.ts` |
| (any other `playbook*.ts` schema files found during audit) | Renamed to `workflow*.ts` |
| Exports in `server/db/schema/index.ts` | Updated |

**Type exports:**

| From | To |
|---|---|
| `Playbook`, `NewPlaybook` | `Workflow`, `NewWorkflow` |
| `PlaybookRun`, `NewPlaybookRun` | `WorkflowRun`, `NewWorkflowRun` |
| `PlaybookTemplate`, `PlaybookTemplateVersion` | `WorkflowTemplate`, `WorkflowTemplateVersion` |
| `PlaybookStepRun`, `PlaybookStepReview` | `WorkflowStepRun`, `WorkflowStepReview` |
| `PlaybookStudioSession` | `WorkflowStudioSession` |

**Service changes:**

| From | To |
|---|---|
| `server/services/playbookStudioService.ts` | `server/services/workflowStudioService.ts` |
| Any sibling `playbook*Service.ts` (audit) | Renamed to `workflow*Service.ts` |
| Exported class / function names | Renamed from `Playbook*` to `Workflow*` |

**Route changes:**

| From | To |
|---|---|
| `/api/playbooks/*` | `/api/workflows/*` |
| `/api/system/playbook-studio/*` | `/api/system/workflow-studio/*` |
| Route registration | Updated |

**Permission keys:**

| From | To |
|---|---|
| `ORG_PERMISSIONS.PLAYBOOKS_VIEW` | `ORG_PERMISSIONS.WORKFLOWS_VIEW` |
| `ORG_PERMISSIONS.PLAYBOOKS_CREATE` | `ORG_PERMISSIONS.WORKFLOWS_CREATE` |
| `ORG_PERMISSIONS.PLAYBOOKS_EDIT` | `ORG_PERMISSIONS.WORKFLOWS_EDIT` |
| `ORG_PERMISSIONS.PLAYBOOKS_DELETE` | `ORG_PERMISSIONS.WORKFLOWS_DELETE` |
| `ORG_PERMISSIONS.PLAYBOOKS_RUN` | `ORG_PERMISSIONS.WORKFLOWS_RUN` |
| `ORG_PERMISSIONS.PLAYBOOK_TEMPLATES_READ` | `ORG_PERMISSIONS.WORKFLOW_TEMPLATES_READ` |
| Sidebar-visibility key `'workflows'` (already `workflows`) | Retained — already correct |

**UI page / component changes:**

| From | To |
|---|---|
| `client/src/pages/PlaybooksLibraryPage.tsx` | `WorkflowsLibraryPage.tsx` |
| `client/src/pages/PlaybookStudioPage.tsx` | `WorkflowStudioPage.tsx` |
| `client/src/pages/PlaybookRunDetailPage.tsx` | `WorkflowRunDetailPage.tsx` |
| `client/src/pages/PlaybookRunPage.tsx` | `WorkflowRunPage.tsx` |
| `client/src/components/PlaybookRunModal.tsx` | `WorkflowRunModal.tsx` |
| Any component prefixed `Playbook*` | Renamed `Workflow*` |
| Lazy imports in `App.tsx` | Updated to reference new file names |

**URL path changes:**

| From | To |
|---|---|
| `/playbooks` | `/workflows` |
| `/playbooks/:id` | `/workflows/:id` |
| `/system/playbook-studio` | `/system/workflow-studio` |
| Portal routes that reference Playbooks | Updated |

**UI string changes** (audit target — all instances of "Playbook(s)"):

| Area | From | To |
|---|---|---|
| Sidebar nav (`Layout.tsx:705`) | "Playbooks" | "Workflows" |
| Admin nav (`Layout.tsx:825`) | "Playbook Studio" | "Workflow Studio" |
| Library page title, breadcrumb, heading | "Playbooks" | "Workflows" |
| Library empty state | "No playbook templates available yet" | "No workflow templates available yet" |
| Portal card (`PortalPage`) | "Playbooks" | "Workflows" |
| Run modal (`PlaybookRunModal.tsx:209, 346`) | "Run playbook" | "Run workflow" |
| Admin subaccount detail (`AdminSubaccountDetailPage.tsx:1364–1365`) | "About onboarding playbooks" | "About onboarding workflows" |
| Schedule-calendar badges | "Playbook: X" | "Workflow: X" |
| Email notifications | "Your playbook 'X' finished running" | "Your workflow 'X' finished running" |
| Slack / digest outputs | Any "playbook" copy | "workflow" |
| Portal-facing markdown content | Any "playbook" copy | "workflow" |
| Onboarding help content | Any "playbook" copy | "workflow" |

**File-extension convention:**

| From | To |
|---|---|
| `*.playbook.ts` (built-in Playbook definitions) | `*.workflow.ts` |

**Skill renames:**

| From | To |
|---|---|
| `server/skills/playbook_validate.md` | `server/skills/workflow_validate.md` |
| `server/skills/playbook_simulate.md` | `server/skills/workflow_simulate.md` |
| `server/skills/playbook_propose_save.md` | `server/skills/workflow_propose_save.md` |
| `server/skills/playbook_read_existing.md` | `server/skills/workflow_read_existing.md` |
| `server/skills/playbook_estimate_cost.md` | `server/skills/workflow_estimate_cost.md` |
| `server/skills/config_publish_playbook_output_to_portal.md` | `server/skills/config_publish_workflow_output_to_portal.md` |
| `server/skills/config_send_playbook_email_digest.md` | `server/skills/config_send_workflow_email_digest.md` |

**Skill cross-references:** skills reference each other by slug. After renaming files, grep `server/skills/*.md` and `companies/*/skills/*.md` for `playbook_` and update every in-content reference. Agent config YAML frontmatter (`companies/automation-os/agents/*/AGENTS.md`) that lists renamed skill slugs in its `skills:` array must be updated in the same commit.

**Docs / specs under `docs/`:**

| From | To |
|---|---|
| `docs/playbooks-spec.md` | `docs/workflows-spec.md` (or: rename for consistency; the underlying spec content updates its own vocabulary) |
| `docs/onboarding-playbooks-spec.md` | `docs/onboarding-workflows-spec.md` |
| `docs/playbook-agent-decision-step-spec.md` | `docs/workflow-agent-decision-step-spec.md` |
| Any `docs/*brief*.md` or `docs/*spec*.md` referencing Playbooks | Update internal vocabulary |

**Review logs and historical artefacts:** leave as-is. They reference a primitive that existed at the time. Rewriting history is churn with no benefit.

### 4.9 Verification after step 3

- `drizzle-kit introspect` diff clean.
- `grep -rn 'playbook\|Playbook' client/src server/routes server/services server/db server/skills` returns only hits in migration files (historical), review logs (historical), and possibly inline code comments referring to historical migrations.
- `grep -rn "label=\"Playbook" client/src` returns zero.
- Permission seed data contains only `WORKFLOWS_*` keys for this domain.
- Manual smoke: build a Workflow in the Studio; run it; verify all step reviews, cost estimation, and simulation work.
- Final state grep: `grep -rnE "('workflows'|'workflow_engines'|'processes')" server/db/schema/ | grep -v "automation_engines"` — should reveal no `workflow_engines` or `processes` remaining as table names.

---

## 5. Part 2 — Workflows calling Automations (composition)

### 5.1 Purpose

A Workflow (native orchestration) should be able to invoke a registered Automation (external engine wrapper) as one of its steps. This is what makes the two-concept model feel like one coherent system from a user's perspective: they compose native and external capabilities in the same builder.

Without this composition step, users who want to combine native logic with an existing Make scenario have to do it across two surfaces — which defeats the purpose of a single orchestration builder.

### 5.2 Scope

In scope for this spec:
- New Workflow step type: `invoke_automation`
- Contract for how inputs map, outputs map, errors propagate
- HITL gate semantics for composed Automation steps
- Telemetry emissions
- Credential resolution

Out of scope (deferred):
- UI picker / builder panel redesign to surface Automations as a step type (spec the contract here; the UI presentation is an architect-plan detail)
- Automation-to-Workflow composition (an Automation triggering a Workflow via webhook callback) — doable with existing webhook primitives; not part of this spec

### 5.3 Step type definition

Add a new case to the Workflow step type enum (wherever step-type discriminator lives in the Workflow definition JSON):

```typescript
// Existing step types (illustrative; confirm actual discriminator during architect pass)
type WorkflowStep =
  | SkillInvocationStep
  | AgentDecisionStep
  | InvokeAutomationStep;   // new

interface InvokeAutomationStep {
  kind: 'invoke_automation';
  automationId: string;        // references automations.id
  inputMapping: Record<string, JsonPathExpression | LiteralValue>;
  outputMapping?: Record<string, JsonPathExpression>;
  timeoutSeconds?: number;     // default: inherit from automation.timeout_seconds (300 today)
  retryPolicy?: StepRetryPolicy; // default: inherit from Workflow's step-retry default
  gateLevel?: GateLevel;       // default: review (see §5.6)
  // Scoping note: the resolved automation must match the scope of this Workflow run
  // — subaccount-scoped Workflow → subaccount-scoped Automation (or org/system fallback);
  // see §5.8.
}
```

`JsonPathExpression` reuses the existing Workflow input-expression format (assumed to support `$.previousStep.field` style references). The architect pass confirms the exact expression language from the existing Workflow DSL.

### 5.4 Input mapping contract

- The Automation's declared `input_schema` defines the required input shape.
- The step's `inputMapping` must produce a JSON document that validates against that schema at runtime.
- Validation happens before the webhook fires. On validation failure, the step fails with `error_code: 'automation_input_validation_failed'` and the full validation error is recorded.
- Missing required fields fail fast; extra fields are permitted if the Automation's schema is non-strict (audit existing schema strictness posture — this is an open question).

### 5.5 Output mapping contract

- The Automation's response (whatever the engine returns) is treated as the step output.
- The optional `outputMapping` projects fields out of the response into the Workflow's variable space, addressable by later steps as `$.steps.{stepId}.{mappedKey}`.
- If `outputMapping` is omitted, the full response body is available at `$.steps.{stepId}.response`.
- Output-schema validation: if the Automation declares `output_schema`, validate the response against it. On mismatch, step fails with `error_code: 'automation_output_validation_failed'`.

### 5.6 HITL gate semantics

- Default: `gateLevel: 'review'` for any `invoke_automation` step. External calls have blast-radius implications — a CRM webhook could modify records we can't observe.
- Users can override to `'auto'` per-step at authoring time if the Automation is known-safe.
- Block-level gating is not supported for `invoke_automation` (if you want to block an external call, remove the step).
- Explore Mode (Part 3) forces `invoke_automation` steps to `'review'` regardless of declared gate level, matching side-effecting skill behaviour. This is automatic — no special-case code beyond the generic gate resolution.
- Supervised mode (existing) is subsumed by Explore Mode after Part 3 ships.

### 5.7 Error propagation

- Automation call returns non-2xx HTTP → step fails with `error_code: 'automation_http_error'`, payload includes status + response body.
- Automation call times out → step fails with `error_code: 'automation_timeout'`. Timeout defaults to 300s unless overridden on the step.
- Network error / DNS failure → step fails with `error_code: 'automation_network_error'`.
- Retries apply per the step's `retryPolicy` (default: Workflow's step-retry default).
- Failure cascades follow Workflow error-handling semantics (continue / stop / branch to error handler — whatever the existing DSL supports).

### 5.8 Credential resolution and scoping

- At step dispatch, resolve the Automation's `automation_engine_id` to an `automation_engines` row.
- Scope-matching: subaccount-scoped Workflow → subaccount-scoped Automation / Engine (or org / system fallback). Org-scoped Workflow → org or system Automation. System → system.
- HMAC signing: reuse the existing per-engine HMAC secret from `automation_engines.hmac_secret` for outbound request signatures.
- Required connections: the Automation declares required connections in its `required_connections` field. At dispatch, resolve each required connection's credential for the subaccount context. If any required connection is missing, the step fails with `error_code: 'automation_missing_connection'` before the webhook fires.

### 5.9 Telemetry emissions

Two events per `invoke_automation` step:

**At dispatch:**

```typescript
{
  eventType: 'workflow.step.automation.dispatched',
  runId: string,
  workflowId: string,
  stepId: string,
  automationId: string,
  automationEngineId: string,
  engineType: 'n8n' | 'ghl' | 'make' | 'zapier' | 'custom_webhook',
  subaccountId: string | null,
  orgId: string,
  timestamp: ISO8601,
}
```

**At completion (success or failure):**

```typescript
{
  eventType: 'workflow.step.automation.completed',
  runId: string,
  workflowId: string,
  stepId: string,
  automationId: string,
  status: 'ok' | 'http_error' | 'timeout' | 'network_error' | 'input_validation_failed' | 'output_validation_failed' | 'missing_connection',
  httpStatus?: number,
  latencyMs: number,
  responseSizeBytes?: number,
  timestamp: ISO8601,
}
```

Both events register in `server/lib/tracing.ts`. Keep response bodies OUT of the event payload for privacy; store them (if needed) in the existing workflow-step-output table.

### 5.10 Edge cases

1. **Automation is deleted mid-Workflow-run.** Step fails with `error_code: 'automation_not_found'`. Workflow's error-handling policy applies.
2. **Automation scope changes after Workflow authoring.** A Workflow references an org-scoped Automation; that Automation gets deleted and recreated at subaccount scope. The Workflow reference breaks. Detect at dispatch; fail with `automation_not_found`.
3. **Automation engine offline.** Reuse whatever degraded-mode posture the existing process-execution path has. Audit during architect pass.
4. **Automation called recursively via Workflow → Automation → Workflow → …** Not supported in v1. Automations are leaf external calls; they don't call back into our Workflows. If we ever add callback-based composition, that's a separate spec.
5. **Cost estimation for Workflows containing Automation steps.** The existing `workflow_estimate_cost` skill (renamed in Part 1) needs to incorporate Automation cost (the external engine's cost, if known, or zero if unknown). Out of scope for v1 — flag for follow-up.

### 5.11 UI considerations

- The Workflow Studio (renamed in Part 1) gains a new step-type option: "Call Automation."
- Selecting it opens a picker listing the user's Automations filtered by scope.
- Picker shows Automation name, description, engine type (Make / n8n / etc.), required connections.
- Input mapping editor uses the same JSON-path expression UI as other steps.
- Output mapping editor previews the Automation's declared `output_schema` if present.

Exact UI layout and component list: architect pass.

### 5.12 Success criteria

1. A user can author a Workflow that combines two native skill steps with one `invoke_automation` step between them, save it, run it, and see all three steps execute in order with per-step output available.
2. In Explore Mode, the `invoke_automation` step always pauses for review regardless of its declared gate level.
3. An Automation with broken credentials causes the Workflow step to fail fast with a clear error code, without firing the webhook.
4. The tracing events contain enough signal for operators to debug a failed Automation call without needing to correlate multiple sources.

---

## 6. Part 3 — Explore Mode / Execute Mode

### 6.1 Purpose

Promote the safety affordance from a hidden toggle to a first-class interaction pillar. Every agent run and every Workflow run is in exactly one of two modes, and the mode is always visible on the run surface.

### 6.2 Core semantics

| Mode | Gate behaviour | Banner |
|---|---|---|
| **Explore** | Every side-effecting skill / every `invoke_automation` step is forced to `review` regardless of declared gate. Read-only skills run unimpeded. | *"Explore Mode — nothing will change until you approve."* |
| **Execute** | Declared gate levels apply as configured (including `auto` for skills marked safe). | *"Execute Mode — auto-gated actions will run without approval."* |

Exactly one mode per run. Not a matrix.

### 6.3 Schema changes

One migration (`0175_explore_execute_mode.sql`):

```sql
-- Add default_run_mode to agents
ALTER TABLE agents
  ADD COLUMN default_run_mode text NOT NULL DEFAULT 'explore'
  CHECK (default_run_mode IN ('explore', 'execute'));

-- Add run_mode to workflow_runs (renamed from playbook_runs in Part 1)
ALTER TABLE workflow_runs
  ADD COLUMN run_mode text NOT NULL DEFAULT 'explore'
  CHECK (run_mode IN ('explore', 'execute'));

-- Add run_mode to agent_runs
ALTER TABLE agent_runs
  ADD COLUMN run_mode text NOT NULL DEFAULT 'explore'
  CHECK (run_mode IN ('explore', 'execute'));

-- User-mode-preference storage (see §6.8)
CREATE TABLE user_run_mode_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  subaccount_id uuid NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  last_successful_mode text NOT NULL CHECK (last_successful_mode IN ('explore', 'execute')),
  successful_explore_runs integer NOT NULL DEFAULT 0,
  promoted_to_execute_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, agent_id, subaccount_id)
);
CREATE INDEX ON user_run_mode_preferences (user_id, agent_id);
```

Naming convention: `run_mode` (not `mode`) so it's unambiguous in joined queries.

Defaults favour safety:
- New agents: `default_run_mode = 'explore'`
- New runs: `run_mode = 'explore'` unless explicitly overridden
- New user preferences (no row yet): treated as `'explore'`

### 6.4 Skill side-effect declaration

Explore Mode relies on knowing which skills are side-effecting. Today, this is inferred ambiguously. This spec adds an explicit frontmatter field on every skill markdown file:

```yaml
---
name: send_email
side_effects: true    # NEW — boolean, required for all skills
# ... other frontmatter
---
```

**Migration for existing 152 skills:** one-time audit pass annotates every skill with `side_effects: true | false`. Guidance:
- `true` for anything mutating external state: send email, update CRM, modify ad spend, post message, create GHL contact, write Notion page, fire webhook, transition pipeline stage.
- `false` for pure reads: list deals, get campaign stats, fetch thread, search messages.
- When ambiguous, default to `true` (safe).
- Audit happens as part of Part 3's spec execution; tracked in `tasks/builds/riley-observations/skills-side-effects-audit.md`.

**Fallback heuristic during migration:** if a skill file has no `side_effects` frontmatter at dispatch time, default to `true`. This fails safely on unannotated skills.

### 6.5 Gate resolution algorithm

Resolved in `server/services/agentExecutionService.ts` (or wherever `gateLevel` is computed today). Pseudocode:

```typescript
function resolveEffectiveGate(skill: Skill, context: RunContext): GateLevel {
  // 1. Block always wins — never bypassed.
  if (skill.defaultGateLevel === 'block') return 'block';

  // 2. Explore Mode forces review on side-effecting skills.
  if (context.runMode === 'explore' && skill.sideEffects === true) {
    return 'review';
  }

  // 3. Fall through to existing per-agent, per-subaccount, per-run gate overrides.
  return resolveExistingGateOverrides(skill, context);
}
```

Applies identically to `invoke_automation` steps (Part 2 §5.6): Explore Mode forces `review` regardless of declared gate.

### 6.6 Run-creation contract

When a run is initiated (agent chat, Workflow run modal, scheduled trigger, external API):

```typescript
interface RunCreationRequest {
  agentId: string;
  subaccountId: string | null;
  // ... other existing fields
  runMode?: 'explore' | 'execute';  // optional; defaulting logic below
}

function resolveRunMode(request: RunCreationRequest, agent: Agent, userPref: UserRunModePreference | null): 'explore' | 'execute' {
  // 1. Explicit override from the request wins.
  if (request.runMode) return request.runMode;

  // 2. Scheduled runs always Execute (no interactive approval).
  if (request.triggerType === 'scheduled') return 'execute';

  // 3. User preference for this (user, agent, subaccount) if one exists.
  if (userPref?.last_successful_mode) return userPref.last_successful_mode;

  // 4. Agent default (which starts as 'explore' for new agents).
  return agent.default_run_mode;
}
```

Scheduled runs forcing `execute` is deliberate — review queues would pile up unreviewable items otherwise. Documented as a product decision; explicit in copy when a user configures a schedule.

### 6.7 Skill-level exceptions and edge cases

1. **Read-only skill in Explore Mode.** Runs immediately. No review item created.
2. **`invoke_automation` step in Explore Mode.** Forced to review regardless of declared gate. Reviewer sees the Automation name, input payload, engine. Approves → webhook fires.
3. **Chained side-effecting skills.** Skill A is forced to review. Approved → runs. Skill B depends on A's output → runs when A completes. Standard chained-review queue flow; no special handling.
4. **Skill declared `side_effects: true` but actually safe** (audit miss). Reviewer approves through. No harm done — just review-queue noise. Audit the skill post-launch; toggle to `false`.
5. **Skill declared `side_effects: false` but actually unsafe** (audit miss). Explore Mode does NOT force review. Potential incident. **Mitigation: default-true fallback on missing frontmatter**; audit pass annotates every skill deliberately; post-launch monitoring looks for missed annotations via `context.assembly.complete` telemetry (Part 5).
6. **Workflow with mixed gate levels.** Entire run is in one mode. No per-step mode switching. If a Workflow has some auto-safe and some review-needed steps, use per-skill `defaultGateLevel` in Execute Mode; don't fragment the mode model.
7. **Orchestrator-delegated runs.** If the Orchestrator dispatches a sub-task to another agent, the sub-run inherits the parent's `run_mode`. Explore Mode is transitive — you can't escape Explore by delegating.

### 6.8 UI surfaces

The mode is visible on every run surface. Not hidden, not collapsible.

**Agent chat page** (`AgentChatPage.tsx`):
- Persistent header chip showing current mode: pill styled distinct per mode (Explore = neutral with lock icon; Execute = accent with play icon).
- Single-click switch: clicking the chip toggles mode for the current conversation.
- Banner below the header when entering a new conversation: *"Explore Mode — nothing will change until you approve."*
- Mode changes mid-conversation are logged as system messages: *"Mode changed to Execute at 14:32 by {user}."*

**Workflow Run Modal** (`WorkflowRunModal.tsx` after Part 1 rename):
- Step 2 of the run wizard: explicit "Run in:" radio pair.
  - Explore (selected by default): *"Review every side-effecting step before it runs."*
  - Execute: *"Let auto-gated steps run immediately."*
- The existing Supervised-mode checkbox is removed — Supervised semantics are a subset of Explore.
- Scheduled runs: mode selector disabled, tooltip explains *"Scheduled runs always execute. Use Explore Mode for manual test runs."*

**Agent config page** (`AdminAgentEditPage.tsx` + `SubaccountAgentEditPage.tsx` / `OrgAgentConfigsPage.tsx`):
- New field under the existing config: "Default run mode for this agent: [ Explore | Execute ]". Default is `explore` for new agents.
- Help text: *"New runs for this agent start in this mode unless you've already run it successfully in the other mode."*

**Portal run surfaces** (customer-facing):
- Customer-initiated Workflow runs always use agency-configured defaults (resolved server-side — customer cannot switch modes).
- This is a conservative posture: agency owners control exposure to their customers.

### 6.9 Mode persistence per (user, agent, subaccount)

Persistence is stored in `user_run_mode_preferences` (DB-backed, not localStorage). Rationale: user might log in from multiple devices; preferences follow the user, not the device.

Resolution order (as in §6.6):
1. Explicit request override
2. Scheduled → Execute
3. User preference for this (user, agent, subaccount)
4. Agent default

**Reset conditions:**
- User runs the agent against a *new* subaccount for the first time → no preference row; falls through to agent default (Explore).
- User changes agent's default mode → existing per-user prefs retained.
- Agent is deleted or recreated with same ID → prefs stay (harmless).

**Update conditions:**
- Successful Explore run → increment `successful_explore_runs`.
- Successful Execute run → update `last_successful_mode = 'execute'`, set `promoted_to_execute_at` if first time.
- Failed run → no preference update.

### 6.10 Promote-to-Execute flow

After **N successful Explore runs** for a given (user, agent, subaccount), prompt the user:

> *"This agent has run {N} times in Explore Mode and you've approved every action. Switch to Execute Mode for future runs? You can switch back anytime."*

With two buttons: *Switch to Execute* / *Not yet*.

**N = 5** in v1. Rationale: enough to establish confidence without nagging; tuning is cheap post-launch.

**Prompt cadence:** shown once per trigger threshold. If the user clicks *Not yet*, don't re-prompt until they complete 5 more successful Explore runs.

**Reverse promotion:** if a user manually switches back to Explore from Execute, reset the counter to 0 and don't auto-prompt again for that (user, agent, subaccount) until they've demonstrated new confidence.

**Risk acknowledgement** (open question for reviewer, §12): does click-through on the promote prompt create a psychological trap? Alternatives: require typing *"Execute"* to confirm; require re-selection each session; time-windowed trust decay. v1 ships with the simple button click; monitor incident rate post-launch.

### 6.11 Analytics / telemetry

Emit `run.mode.selected` at run creation with `{runId, agentId, subaccountId, userId, resolvedMode, resolutionReason}` where `resolutionReason` ∈ `{explicit_request, scheduled, user_preference, agent_default}`. Drives analytics on:
- What percentage of new agents ever get promoted to Execute?
- Which agents have the highest Execute adoption?
- Which agents' promote prompts get declined most?

Event registers in `server/lib/tracing.ts` alongside other run-lifecycle events.

### 6.12 Edge cases

1. **Concurrent runs in different modes.** User has two conversations open with the same agent against the same subaccount: one in Explore, one in Execute. Both should work correctly. Mode is per-run, not per-agent-subaccount pairing.
2. **Agent config change mid-conversation.** Admin changes agent's `default_run_mode` from Explore → Execute. Active conversations retain their mode; new conversations use the new default.
3. **Subaccount deletion.** Cascade delete on `user_run_mode_preferences` via FK `ON DELETE CASCADE`.
4. **Skill added with missing `side_effects` frontmatter.** Defaults to `true`. Runs pause for review in Explore Mode, erring on safe. Audit and annotate.
5. **Empty `user_run_mode_preferences` after schema deploy.** Pre-launch state; all users default to agent-level default. No backfill required.

### 6.13 Success criteria

1. New user creates agent → first run defaults to Explore → every side-effecting action pauses for review.
2. After 5 successful Explore runs (all actions approved), user sees promote prompt. Accepts → next run is Execute.
3. User switches to Execute mid-conversation → system message logs the change → subsequent auto-gated skills run without approval.
4. Scheduled Workflow run in the same agent context uses Execute regardless of user preferences.
5. Mode is always visible on every run surface. A user who can't tell what mode they're in is the failure case.
6. Explore Mode + `invoke_automation` step = mandatory review before external webhook fires.
7. Removing the existing Supervised-mode checkbox does not break any flow a user previously depended on.

---

## 7. Part 4 — Heartbeat activity-gate

### 7.1 Purpose

Portfolio Health Agent ticks every 4h unconditionally. Add a deterministic pre-dispatch gate that skips ticks when there's no signal. No LLM — just rules over data we already have. Cheap, predictable, debuggable.

### 7.2 Scope

- Deterministic rules only in v1. Four rules listed below.
- LLM-based signal detection deferred to v2; will be considered only if deterministic rules prove insufficient in real-world operation.
- Gate applies only to heartbeat-originated dispatches, not to user-initiated or Orchestrator-initiated runs.

### 7.3 Schema changes

One migration (`0176_heartbeat_activity_gate.sql`):

```sql
-- Per-agent config
ALTER TABLE agents
  ADD COLUMN heartbeat_activity_gate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN heartbeat_event_delta_threshold integer NOT NULL DEFAULT 3,
  ADD COLUMN heartbeat_min_ticks_before_mandatory_run integer NOT NULL DEFAULT 6;

-- Per-subaccount override (mirrors existing heartbeat override pattern)
ALTER TABLE subaccount_agents
  ADD COLUMN heartbeat_activity_gate_enabled boolean NULL,
  ADD COLUMN heartbeat_event_delta_threshold integer NULL,
  ADD COLUMN heartbeat_min_ticks_before_mandatory_run integer NULL;

-- Track the last tick that actually produced output (not counting skipped ticks)
ALTER TABLE subaccount_agents
  ADD COLUMN last_meaningful_tick_at timestamptz NULL,
  ADD COLUMN ticks_since_last_meaningful_run integer NOT NULL DEFAULT 0;
```

Resolution precedence for config: `subaccount_agents` override (if non-null) → `agents` value → schema default. Matches existing `heartbeatEnabled` / `heartbeatIntervalHours` / `heartbeatOffset` pattern.

### 7.4 The four rules

At each heartbeat tick, before dispatching to the agent loop, evaluate in order. If any rule returns `true`, dispatch. If all return `false`, skip.

**Rule 1 — Event delta**

```
new_events_since_last_tick > heartbeat_event_delta_threshold
```

Where `new_events_since_last_tick` counts domain-relevant entities added/modified since the last tick:
- Portfolio Health Agent: new entities in `memory_blocks`, `subaccount_onboarding_state` changes, `agent_runs` created since last tick, review-queue items resolved, integration-scan deltas.

Exact event source per agent: defined per agent. Portfolio Health details in §7.7.

**Rule 2 — Time-since-last-meaningful-output**

```
ticks_since_last_meaningful_run >= heartbeat_min_ticks_before_mandatory_run
```

Prevents permanent silence. If we've been skipping for 6 ticks (24h at 4h cadence), force a run on the next tick to check state regardless of delta.

**Rule 3 — Explicit trigger**

```
any_user_initiated_check_queued = true
```

If a user has explicitly requested a check via the agent's config page ("Check now" button) or via API since the last tick, always run.

**Rule 4 — State-flag**

```
subaccount_has_requires_attention_flag = true
```

If the subaccount has any outstanding "requires attention" signal — failed run in review queue, broken integration, billing issue, deferred review item — always run.

Exact flag sources defined per domain. For Portfolio Health: failed `agent_runs` in the last tick window, broken integrations in `connections` (status = error), pending review items assigned to the agent.

### 7.5 Gate implementation

New service: `server/services/heartbeatActivityGateService.ts`. Pure function (no LLM, no external calls beyond DB reads):

```typescript
interface HeartbeatGateInput {
  agentId: string;
  subaccountId: string;
  lastMeaningfulTickAt: Date | null;
  ticksSinceLastMeaningfulRun: number;
  config: {
    eventDeltaThreshold: number;
    minTicksBeforeMandatoryRun: number;
  };
}

interface HeartbeatGateDecision {
  shouldRun: boolean;
  reason: 'event_delta' | 'time_threshold' | 'explicit_trigger' | 'state_flag' | 'no_signal';
  signalsEvaluated: {
    newEventCount: number;
    ticksSinceLastRun: number;
    explicitTriggerQueued: boolean;
    stateFlagSet: boolean;
  };
  latencyMs: number;
}

async function evaluateHeartbeatGate(input: HeartbeatGateInput): Promise<HeartbeatGateDecision> {
  // ... implementation reads domain tables, evaluates four rules, returns decision
}
```

**Error posture:** any exception → log error, return `{ shouldRun: true, reason: 'gate_error', ... }`. Never skip on error. Gate is optimisation; safety posture is "when in doubt, run."

### 7.6 Execution hook

Wrap the heartbeat-originated dispatch path (currently in `agentExecutionService.ts` or the pg-boss handler registered by `agentScheduleService.ts` / `scheduleCalendarService.ts`).

Flow:
1. pg-boss fires heartbeat job.
2. Handler resolves agent + subaccount + config.
3. If `heartbeat_activity_gate_enabled = false` → dispatch as today.
4. If enabled → call `evaluateHeartbeatGate`.
5. If decision is `shouldRun: true` → dispatch. Reset `ticks_since_last_meaningful_run` when the run produces output.
6. If decision is `shouldRun: false` → emit `heartbeat.tick.gated` telemetry, increment `ticks_since_last_meaningful_run` by 1, return.

The gate adds one DB-read-only service call before dispatch. Expected latency: <50ms.

### 7.7 Portfolio Health Agent specifics

Define the per-agent event-source list. For Portfolio Health:

| Signal | Source | Query shape |
|---|---|---|
| New memory blocks | `memory_blocks` | `count(*) where subaccount_id = ? and created_at > last_tick_at` |
| Onboarding state changes | `subaccount_onboarding_state` | `count(*) where subaccount_id = ? and updated_at > last_tick_at` |
| Failed agent runs | `agent_runs` | `count(*) where subaccount_id = ? and status = 'failed' and created_at > last_tick_at` |
| Integration errors | `connections` | `count(*) where subaccount_id = ? and status = 'error' and updated_at > last_tick_at` |
| Pending review items | (existing review-queue table — audit) | `count(*) where subaccount_id = ? and assigned_agent_id = ? and status = 'pending'` |
| Explicit "check now" triggers | (new column or existing mechanism — audit) | Boolean: has one been enqueued since last tick |

Architect pass confirms exact table / column names during plan decomposition.

### 7.8 Observability

Emit `heartbeat.tick.gated` on every gate evaluation (both run and skip outcomes):

```typescript
{
  eventType: 'heartbeat.tick.gated',
  agentId: string,
  subaccountId: string,
  timestamp: ISO8601,
  shouldRun: boolean,
  reason: 'event_delta' | 'time_threshold' | 'explicit_trigger' | 'state_flag' | 'no_signal' | 'gate_error',
  signalsEvaluated: {
    newEventCount: number,
    ticksSinceLastRun: number,
    explicitTriggerQueued: boolean,
    stateFlagSet: boolean,
  },
  latencyMs: number,
}
```

Register in `server/lib/tracing.ts`.

Operator dashboard (future work, not in v1): query this event type for a given agent to see skip rate over time, which rules drive runs vs skips, and whether thresholds need tuning.

### 7.9 UI surface

`AdminAgentEditPage.tsx`, under the existing heartbeat toggle at line 1422, add:

- Toggle: "Skip ticks with no activity" (maps to `heartbeat_activity_gate_enabled`).
- Number input: "Minimum events to trigger a run" (maps to `heartbeat_event_delta_threshold`, default 3).
- Number input: "Maximum ticks before a mandatory run" (maps to `heartbeat_min_ticks_before_mandatory_run`, default 6).
- Help text: *"When on, this agent only runs a scheduled tick if something changed (new data, user requests, or outstanding issues). Prevents unnecessary LLM cost."*

System-admin only in v1. Agency-admin exposure follows after operational validation.

### 7.10 Edge cases

1. **First tick after enabling.** No prior tick data. Always run the first tick (treat `last_meaningful_tick_at` null → rule 2 evaluates true).
2. **Heartbeat config changes mid-cycle.** Next tick uses the new config. No rollback of in-flight decisions.
3. **Gate itself fails** (DB error). Log, run anyway. See §7.5 error posture.
4. **Skipped-tick logging flooding.** Only the `heartbeat.tick.gated` event is emitted (not a memory entry). Events in the tracing sink have retention policies; no workspace-memory pollution.
5. **Non-Portfolio-Health agents with `heartbeat_activity_gate_enabled = true`.** Falls back to generic event counting (any `agent_runs`, any memory writes for that agent's scope). If domain-specific signal counting is needed, extend the per-agent source list during architect pass.
6. **Portfolio Health across many subaccounts.** Each (agent, subaccount) pairing evaluates the gate independently. A quiet subaccount skips; a busy one runs. No cross-subaccount aggregation.

### 7.11 Rollout posture

- Feature flag: `heartbeat_activity_gate_enabled` default `false` in schema. Opt-in per agent.
- Enable on Portfolio Health Agent only in the initial rollout. Monitor for 2 weeks.
- Conservative default thresholds (delta=3, min-ticks=6) favour running over skipping.
- If skip rate >70% or <10%, tune thresholds rather than redesign.
- Do not auto-enable for other agents.

### 7.12 Success criteria

1. Portfolio Health Agent skip rate lands in 20–60% window after 2 weeks.
2. Zero operator complaints traceable to a legitimately-skipped tick (signal was there; gate missed it).
3. Average LLM cost per Portfolio Health Agent tick drops measurably (target: 40%+ reduction once skip rate stabilises).
4. Gate adds <50ms to pre-dispatch latency (p95).
5. On gate failure, tick runs instead of skips — zero incidents of "gate crashed, agent didn't run for 24h."

---

## 8. Part 5 — Context-assembly telemetry

### 8.1 Purpose

One telemetry event, fired after context assembly completes and before the agent loop starts. Makes "why did this run produce bad output?" a single-query question instead of multi-minute log archaeology.

### 8.2 Event contract

Event name: `context.assembly.complete`

```typescript
{
  eventType: 'context.assembly.complete',
  runId: string,
  agentId: string,
  subaccountId: string | null,
  orgId: string,
  timestamp: ISO8601,

  // What happened
  latencyMs: number,                  // total time in context assembly
  totalTokens: number,                // everything injected into the final prompt
  contextBudget: number,              // the model's context window
  contextPressure: number,            // totalTokens / contextBudget, 0..1

  // How much memory showed up
  memoryBlockCount: number,           // blocks included after precedence filtering
  workspaceMemoryLength: number,      // token count of workspace-memory segment

  // Any gaps the assembler flagged
  gapFlags: string[],                 // well-known codes, see §8.4
}
```

No bodies. No per-source breakdowns. No per-skill arrays. v1 is deliberately minimal.

### 8.3 Not in v1

Deferred to v2 only if post-launch debugging demonstrates we need them:

- Per-phase token breakdown (briefing / beliefs / memory / known-entities separately)
- Per-source memory attribution (which retrievers contributed)
- Full authorised-skills / available-skills arrays
- Per-sub-phase latencies

The v2 expansion is additive to the same event type. Additions do not require a new event registration.

### 8.4 `gapFlags` vocabulary

Strict enum, extensible:

- `no_briefing` — briefing query returned nothing
- `no_beliefs` — beliefs query returned nothing
- `no_memory_blocks` — memory retrieval returned zero blocks
- `no_workspace_memory` — workspace memory was empty for this context
- `stale_beliefs` — beliefs loaded but last-updated > 30d ago
- `missing_integration` — agent expected a connection that wasn't resolved
- `context_pressure_high` — `contextPressure > 0.9`
- `memory_retrieval_timeout` — memory retrieval hit timeout before returning
- `assembly_partial_failure` — one or more sub-phases failed but assembly continued

If a new flag is needed, add it to the enum and update the event-registry documentation. Do not use free-form strings.

### 8.5 Where the code changes land

1. **Register the event** in `server/lib/tracing.ts` event registry with the schema above.
2. **Fire from `agentExecutionService.ts`** at the end of context assembly, before the agent loop starts. Single call site. All required fields are already local variables at that point (confirmed during audit).
3. **Emit path:** async, fire-and-forget, best-effort. Matches the pattern in `fastPathDecisionLogger.ts`. Must never block or fail the agent run.
4. **Storage:** reuse the existing tracing sink (whatever table / stream `tracing.ts` writes to today). No new table.
5. **No UI in v1.** Query via existing observability tooling.

### 8.6 Relationship to other telemetry

- `fast_path_decisions` (Universal Brief) — different phase (pre-dispatch), different question (which agent/scope). Complementary.
- `agent_runs` table — tracks run outcome. Not overlapping.
- `heartbeat.tick.gated` (Part 4) — different stage, different decision. Not overlapping.
- `workflow.step.automation.*` (Part 2) — different layer (workflow step, not agent run). Not overlapping.

No event duplication. Each answers a specific question.

### 8.7 Edge cases

1. **Simple_reply path from Universal Brief.** No agent-loop runs → no event emitted. Documented behaviour.
2. **Assembly partial failure.** Event still emitted with `gapFlags: ['assembly_partial_failure']` plus specific gap flags.
3. **Model context window unknown.** If `contextBudget` can't be resolved, set to `0` and include `context_pressure_unknown` in `gapFlags`.
4. **Extremely long workspace memory truncated before injection.** Assembly truncates; `workspaceMemoryLength` reflects the pre-truncation length. Add `workspace_memory_truncated` to `gapFlags`.
5. **Telemetry sink unavailable.** Agent run continues. Event loss is acceptable — no retry, no queue.

### 8.8 Success criteria

1. 100% of agent-loop runs (excluding Universal Brief simple_reply paths) emit exactly one `context.assembly.complete` event.
2. An operator debugging a failed run can answer "was context assembled correctly?" in <30 seconds with a single query.
3. Event emit adds <5ms to the pre-loop latency (p95).
4. In the 2 weeks after shipping, we log any debugging question we couldn't answer from this minimal event. That log drives the v2 field list.

### 8.9 Review criteria for reviewer

Specifically flag:
- Any field in v1 that's genuinely not needed — propose to cut.
- Any field deferred to v2 that we'll *definitely* regret deferring within the first week of data.
- Any flag missing from the `gapFlags` enum that would be commonly needed.
- Whether the async-emit latency target (<5ms p95) is realistic given the tracing sink's write path.

---

## 9. Part 6 — Agent-decomposition rule

### 9.1 Purpose

Captures a heuristic the v6 agent roster already follows implicitly. Five-minute doc edit. Keeps the pattern discoverable for future spec authors and architect-agent invocations proposing agent additions or splits.

### 9.2 Change

Append to `docs/spec-authoring-checklist.md` under a new heading "Agent decomposition":

> **Agent decomposition.** Agents that share context and have aligned goals should stay together. Divergent context or goals justify a split.
>
> Example: a Content agent handling YouTube, Instagram, and TikTok shares both context (channel performance data, brand voice, asset library) and goals (grow reach and engagement). Keep together. A Customer Support agent has different context (ticket history, issue taxonomy) and different goals (resolve faster, reduce escalations). Split.
>
> Cite this rule in any spec that proposes adding or splitting an agent. If the proposal doesn't fit the rule, explain why in the spec.

No other changes. No new file, no code.

### 9.3 Success criteria

A future session authoring an agent spec reads the rule on their first pass through the checklist. Architect-agent invocations cite it when evaluating split/merge decisions.

---

## 10. Data migration plan

### 10.1 Ordered migration list

| # | File | Purpose | Reversibility |
|---|---|---|---|
| 1 | `0172_rename_workflow_runs_to_flow_runs.sql` | Clear `workflow*` namespace. Rename internal flow stack. | Reversible (rename tables back). |
| 2 | `0173_rename_processes_to_automations.sql` | `processes → automations`, `workflow_engines → automation_engines`, all child tables and columns. | Reversible. |
| 3 | `0174_rename_playbooks_to_workflows.sql` | `playbooks → workflows`, all child tables and columns, cross-table `playbook_*` columns. | Reversible. |
| 4 | `0175_explore_execute_mode.sql` | `run_mode` columns on `agent_runs` + `workflow_runs`, `default_run_mode` on `agents`, new `user_run_mode_preferences` table. | Reversible (drop columns + table). |
| 5 | `0176_heartbeat_activity_gate.sql` | Heartbeat gate columns on `agents` + `subaccount_agents`, plus tracking columns for last-meaningful-tick. | Reversible. |

No data migration needed on any of these — pre-launch posture means zero rows in tables we care about (beyond seed data, which is regenerated by each rename).

### 10.2 Ordering constraints

- Migrations 1, 2, 3 MUST run in strict order (3 depends on 1 clearing the namespace).
- Migration 4 and 5 depend on migration 3 completing (they reference `workflow_runs` and `agents` columns by name).
- Migrations 4 and 5 can run in either order relative to each other.

### 10.3 Pre-merge verification

Before the PR merges to `main`:

1. Run all migrations on a clean dev DB. Assert each runs green in sequence.
2. Run `drizzle-kit introspect` against the updated Drizzle schema files; assert the diff is clean after each migration.
3. Rollback each migration in reverse order on a second clean DB; assert rollback is clean.
4. Full TypeScript build. `tsc` clean.
5. Full test suite pass (unit + integration).
6. Manual smoke:
   - Create an Automation via admin UI; run it via webhook; assert response logged.
   - Build a Workflow in Workflow Studio; run it; assert all steps execute.
   - Build a Workflow containing an `invoke_automation` step; run it; assert the external call fires and output propagates.
   - Run an agent in Explore Mode; assert side-effecting action pauses for review.
   - Run the same agent in Execute Mode; assert `auto`-gated skills run.
   - Enable heartbeat activity-gate on Portfolio Health; force a no-signal state; assert tick skips and emits `heartbeat.tick.gated`.

### 10.4 Coordinating in-flight branches

Because all migrations ship in one PR, there is a single coordinated merge window. Process:

1. Announce in #engineering: "Riley-observations naming-pass PR merging at {time}. All open feature branches will need rebase."
2. Prepare a rebase-script committed under `scripts/rebase-post-riley-rename.sh`:
   - Fetches main
   - Merges main into the current branch
   - Runs `scripts/codemod-riley-rename.ts` (new) which does:
     - Replace `playbook_` → `workflow_` in SQL strings, TypeScript imports, references
     - Replace `Playbook` → `Workflow` in TypeScript type usages
     - Replace `/api/playbooks` → `/api/workflows` in route strings
     - Replace `processes` → `automations` (table references)
     - Replace `ProcessService` → `AutomationService`
     - (Codemod rules defined in the scripts file; conservative — only replaces where context indicates schema/API/UI reference)
3. After merge, open-PR owners run the rebase script on their branch, resolve any remaining conflicts manually, and force-push.
4. For 72 hours post-merge, engineering team prioritises unblocking any branch that can't auto-rebase.

### 10.5 Rollback posture

- If the PR merges and something breaks: `git revert` the merge commit. All five migrations revert in reverse order automatically (they're reversible).
- Post-revert, re-run tests; assert clean rollback.
- Post-mortem before re-attempting.

Rollback window: up to 48h post-merge. After that, any downstream work has made rollback complex; fix-forward instead.

---

## 11. Rollout plan + test strategy

### 11.1 Build waves (from brief §9)

| Wave | Content | Gating |
|------|---|---|
| **W0** | Rec 5 (agent-decomposition rule) | No spec. Ship immediately. |
| **W1** | Part 1 (naming pass) + Part 2 (Workflows invoking Automations composition) | This spec + spec-review + architect plan → `spec-conformance` → `pr-reviewer` → PR. |
| **W2** | Part 3 (Explore / Execute Mode) | Depends on W1. Spec drafted after W1 lands so it uses the final vocabulary. |
| **W3** | Part 5 (context-assembly telemetry) | Standard-class. Lightweight spec. Depends on nothing. |
| **W4** | Part 4 (heartbeat activity-gate) | Ships last so W3's telemetry is in place to measure skip-rate. |

### 11.2 Test strategy per Part

**Part 1 (naming pass):**
- Unit: rename touches type-checked code; `tsc` clean = baseline pass.
- Integration: existing Playbook/Process tests retarget to Workflow/Automation. Assert all green.
- Migration test: clean-DB migration + rollback + re-migration as CI job.
- Manual QA per §10.3.

**Part 2 (composition):**
- Unit: step-dispatch logic isolated; mock engine response.
- Integration: end-to-end test — Workflow with one `invoke_automation` step against a test engine fixture (MSW or similar).
- Failure-mode tests: timeout, 5xx response, input-schema mismatch, missing connection.
- Explore-Mode interaction test: `invoke_automation` step forced to review in Explore.

**Part 3 (Explore / Execute Mode):**
- Unit: `resolveEffectiveGate` test matrix — every combination of mode × sideEffects × defaultGateLevel.
- Integration: create run in Explore, dispatch side-effecting skill, assert review-queue entry; approve; assert execution.
- Schedule test: scheduled run ignores user preference, always executes.
- Promotion test: 5 successful Explore runs → prompt surfaces.
- Mode-persistence test: user pref survives refresh, resets on new subaccount.

**Part 4 (heartbeat gate):**
- Unit: gate service pure-function test matrix — every rule combination → expected decision.
- Integration: enable gate on test agent; force state where no rule fires; assert skip emits `heartbeat.tick.gated` with `reason: 'no_signal'`.
- Error-posture test: gate throws → run proceeds anyway.
- Mandatory-run test: 6 consecutive skips → 7th tick forces run regardless of signal.

**Part 5 (telemetry):**
- Unit: event-emission hook test. Assert all required fields populated.
- Integration: run an agent; assert exactly one `context.assembly.complete` emitted per agent-loop run.
- Latency test: assembly completion → emit → next-step readiness < 5ms p95.
- Edge test: assembly partial failure → event emitted with correct `gapFlags`.

**Part 6 (decomposition rule):**
- No tests. Doc edit only.

### 11.3 Reviewer checklist (for `pr-reviewer` before PR)

Each Part's PR must pass:
- [ ] No user-facing string debt remaining (grep clean)
- [ ] `drizzle-kit introspect` clean
- [ ] All migrations reversible (tested)
- [ ] Permission enum rename reflected in seed data
- [ ] No in-flight branch left broken > 24h (for W1 specifically)
- [ ] Success criteria from this spec verifiable via test suite or manual QA script
- [ ] Telemetry events register in `tracing.ts` with documented schema
- [ ] Feature flags default to safe posture (Explore = default, heartbeat gate = off)
- [ ] `spec-conformance` pass run before `pr-reviewer`

---

## 12. Open questions for architect

Items the architect should confirm or decide during plan decomposition. None block spec finalisation — they're the seams where plan-level details matter.

### 12.1 Part 1 (naming pass)

1. **Exact Drizzle schema file inventory.** This spec lists the known `playbook*.ts` and `process*.ts` schema files; architect confirms the complete set during plan write-up and adds any missed files.
2. **Permission seed data location and migration.** Which file seeds `ORG_PERMISSIONS` enum values? Architect confirms and ensures permission rename runs as part of the corresponding migration (not a separate manual step).
3. **Route registration pattern.** Does `server/index.ts` manually register every route file, or is there auto-registration? Architect confirms and lists all registration edits.
4. **Codemod script design.** §10.4 proposes `scripts/codemod-riley-rename.ts`. Architect designs the codemod's replacement rules with appropriate conservatism (don't replace `playbook` in historical commit message strings, test fixtures, etc.).
5. **Cross-schema column references.** §4.8 flagged `memoryBlocks`, `modules`, `subaccountOnboardingState`, `portalBriefs`, `agentRuns`, `onboardingBundleConfigs` as potentially carrying `playbook_*` columns. Architect enumerates exact columns to rename.
6. **Component file renames within `client/src/pages/`.** Full list of renames (not just the ones enumerated in §4.8). Architect produces during plan.

### 12.2 Part 2 (composition)

7. **Workflow step-type enum location.** Exact file and discriminator name. Architect finds and specifies.
8. **JSON-path expression language.** What expression format does the existing Workflow DSL use? Architect confirms and ensures `invoke_automation` step uses the same syntax.
9. **Output-schema strictness.** Does the current Automation (`processes`) output-schema validation reject extra fields, or permit them? Architect confirms and ensures composition step matches.
10. **Engine-degraded-mode behaviour.** What does the current process-execution path do when an external engine is offline? Architect confirms and ensures `invoke_automation` step inherits that behaviour.

### 12.3 Part 3 (Explore / Execute Mode)

11. **Exact sidebar component/icon for mode indicator.** Architect chooses component primitives.
12. **`side_effects` audit process.** Architect defines the process for auditing all 152 skills and assigning `side_effects: true/false`. Output: a work log under `tasks/builds/riley-observations/skills-side-effects-audit.md`.
13. **Portal mode behaviour.** §6.8 says "agency-configured defaults" — architect confirms exactly which field on `subaccount_agents` drives portal-facing run mode (or introduces one).
14. **Supervised-mode removal safety.** Audit all call sites of `runMode: 'supervised' | 'auto'`. Architect confirms nothing breaks with Supervised mode's removal.

### 12.4 Part 4 (heartbeat gate)

15. **Event-source table list per agent.** §7.7 defines for Portfolio Health; architect audits other heartbeat-enabled agents (if any) and defines per-agent source mappings.
16. **"Check now" trigger plumbing.** How does a user-initiated "check now" signal get to the gate? Architect specifies the mechanism (DB column, queue flag, pg-boss message).
17. **`last_meaningful_tick_at` update site.** Where in the dispatch path is the counter reset when a run produces "meaningful" output? Architect defines "meaningful" and the update hook.

### 12.5 Part 5 (telemetry)

18. **Tracing sink write path.** What's the current write latency of `tracing.ts`? Is the <5ms target realistic? Architect measures and confirms or proposes mitigation.
19. **`gapFlags` evaluation logic.** How does the assembler detect each flag? Architect confirms each has a computable source and defines the check per flag.

### 12.6 Cross-cutting

20. **Spec-review iteration.** Does this spec go through `spec-reviewer` before architect? Default per CLAUDE.md: yes. Architect confirms that review iteration completed before plan-writing starts.
21. **Plan decomposition.** Does architect produce one plan covering all 6 Parts, or six separate plans? Recommendation: one plan per Wave (W1 combined Part 1+2 plan; W2–W4 each a plan). Architect confirms.

---

## 13. Appendix — mapping tables and glossary

### 13.1 Vocabulary change summary

| Concept | Old name | New name | User-facing? |
|---|---|---|---|
| Native multi-step agent orchestration | Playbook | Workflow | Yes |
| External engine wrapper | Process (internal) / Workflow (UI) | Automation | Yes |
| External engine registry | Workflow Engine | Automation Engine | Infrastructure only |
| Internal flow-execution stack | Workflow Run (legacy) | Flow Run | Internal only |
| Workflow composition step type | (new) | `invoke_automation` | Authoring UI |
| Run safety mode | Dry Run / Supervised (old) | Explore Mode / Execute Mode | Yes |
| Heartbeat pre-check | (new) | Heartbeat activity-gate | Internal with admin UI |
| Agent context telemetry | (new) | `context.assembly.complete` | Observability only |

### 13.2 Table rename mapping (condensed)

| Step | Old table | New table |
|---|---|---|
| 1 | `workflow_runs` | `flow_runs` |
| 1 | `workflow_step_outputs` | `flow_step_outputs` |
| 2 | `processes` | `automations` |
| 2 | `process_categories` | `automation_categories` |
| 2 | `subaccount_process_links` | `subaccount_automation_links` |
| 2 | `process_connection_mappings` | `automation_connection_mappings` |
| 2 | `workflow_engines` | `automation_engines` |
| 3 | `playbook_runs` | `workflow_runs` (new — distinct from step 1's old table, which is now `flow_runs`) |
| 3 | `playbook_step_runs` | `workflow_step_runs` |
| 3 | `playbook_step_reviews` | `workflow_step_reviews` |
| 3 | `playbook_templates` | `workflow_templates` |
| 3 | `playbook_template_versions` | `workflow_template_versions` |
| 3 | `system_playbook_templates` | `system_workflow_templates` |
| 3 | `system_playbook_template_versions` | `system_workflow_template_versions` |
| 3 | `playbook_studio_sessions` | `workflow_studio_sessions` |
| 3 | `playbook_run_event_sequences` | `workflow_run_event_sequences` |

### 13.3 Permission rename mapping

| Old key | New key |
|---|---|
| `PROCESSES_VIEW` | `AUTOMATIONS_VIEW` |
| `PROCESSES_CREATE` | `AUTOMATIONS_CREATE` |
| `PROCESSES_EDIT` | `AUTOMATIONS_EDIT` |
| `PROCESSES_DELETE` | `AUTOMATIONS_DELETE` |
| `PROCESSES_TEST` | `AUTOMATIONS_TEST` |
| `PLAYBOOKS_VIEW` | `WORKFLOWS_VIEW` |
| `PLAYBOOKS_CREATE` | `WORKFLOWS_CREATE` |
| `PLAYBOOKS_EDIT` | `WORKFLOWS_EDIT` |
| `PLAYBOOKS_DELETE` | `WORKFLOWS_DELETE` |
| `PLAYBOOKS_RUN` | `WORKFLOWS_RUN` |
| `PLAYBOOK_TEMPLATES_READ` | `WORKFLOW_TEMPLATES_READ` |

### 13.4 URL path rename mapping

| Old | New |
|---|---|
| `/processes` | `/automations` |
| `/admin/processes` | `/admin/automations` |
| `/system/processes` | `/system/automations` |
| `/portal/:subaccountId/processes/:processId` | `/portal/:subaccountId/automations/:automationId` |
| `/playbooks` | `/workflows` |
| `/system/playbook-studio` | `/system/workflow-studio` |

### 13.5 Skill rename mapping

| Old | New |
|---|---|
| `playbook_validate` | `workflow_validate` |
| `playbook_simulate` | `workflow_simulate` |
| `playbook_propose_save` | `workflow_propose_save` |
| `playbook_read_existing` | `workflow_read_existing` |
| `playbook_estimate_cost` | `workflow_estimate_cost` |
| `config_publish_playbook_output_to_portal` | `config_publish_workflow_output_to_portal` |
| `config_send_playbook_email_digest` | `config_send_workflow_email_digest` |

### 13.6 Glossary

- **Agent** — a system-defined or agency-configured AI operator with a bounded skill set and a set of capabilities.
- **Skill** — a bounded capability declared via markdown file, statically bound to one or more agents via YAML frontmatter.
- **Workflow** (after rename) — a native multi-step DAG authored in Workflow Studio, executed by our engine with HITL gates and observability.
- **Automation** (after rename) — a registered wrapper around an external engine's webhook endpoint. A black-box call.
- **`invoke_automation` step** — a Workflow step type that calls an Automation. Bridges native orchestration and external execution.
- **Explore Mode** — run mode in which every side-effecting skill or `invoke_automation` step is forced to `review` regardless of declared gate.
- **Execute Mode** — run mode in which declared gate levels apply as configured.
- **Heartbeat** — per-agent scheduled wake-up (pg-boss cron). Currently unconditional; Part 4 adds an activity gate.
- **Activity gate** — a deterministic rule-based pre-check that decides whether a heartbeat tick should dispatch.
- **Context-assembly event** (`context.assembly.complete`) — telemetry event emitted after context injection and before the agent loop starts.
- **Flow stack** — the internal execution stack formerly named `workflow_runs`, now `flow_runs`. Not user-facing. Used by `actionService` and `scanIntegrationFingerprintsService`.

### 13.7 Related documents

- `docs/riley-observations-dev-brief.md` (v2) — source brief for this spec
- `docs/openclaw-strategic-analysis.md` (2026-04-18) — strategic context
- `docs/spec-authoring-checklist.md` — receives the agent-decomposition rule
- `docs/playbook-agent-decision-step-spec.md` (to be renamed) — existing decision-step primitive
- `docs/memory-and-briefings-spec.md` — memory retrieval context for Part 5
- `docs/orchestrator-capability-routing-spec.md` — Orchestrator routing reference

---

_End of spec. Ready for `spec-reviewer` pass, then external review, then architect decomposition._
