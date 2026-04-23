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
3a. [UI surface decisions](#3a-ui-surface-decisions)
4. [Part 1 — Naming pass](#4-part-1--naming-pass)
5. [Part 2 — Workflows calling Automations (composition)](#5-part-2--workflows-calling-automations-composition)
6. [Part 3 — Explore Mode / Execute Mode](#6-part-3--explore-mode--execute-mode)
7. [Part 4 — Heartbeat activity-gate](#7-part-4--heartbeat-activity-gate)
8. [Part 5 — Context-assembly telemetry](#8-part-5--context-assembly-telemetry)
9. [Part 6 — Agent-decomposition rule](#9-part-6--agent-decomposition-rule)
9a. [Contracts](#9a-contracts)
9b. [Deferred Items](#9b-deferred-items)
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
| 1 | Zero user-visible "Playbook" / "Playbooks" strings remain | grep of `client/src/**/*.{ts,tsx,md,html}`, server-rendered templates (`server/templates/**`, `server/emails/**` if present), and portal-facing copy files returns zero hits. (Migration files under `migrations/**` and historical review logs under `tasks/review-logs/**` are out of scope for this grep — they document historical state and are not renamed.) |
| 2 | Zero user-visible "Workflows" referring to external integrations | grep + manual audit across nav, empty states, portal cards |
| 3 | `drizzle-kit introspect` diff against updated schema is clean after all five migrations (§10.1: three naming-pass migrations + Explore/Execute migration + heartbeat-gate migration) | CI job runs this check on the PR |
| 4 | A first-time user cannot auto-execute a side-effecting action on a new agent without explicitly switching from Explore to Execute | Verified by manual QA and by a new integration test |
| 5 | 100% of agent-loop runs (excluding Universal Brief simple_reply paths, which skip the agent loop — see §8.7 edge 1) emit exactly one `context.assembly.complete` event | Query on the tracing sink; zero missing for a 24h window post-launch |
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

### 1.5 Architectural principles (binding on every Part)

These principles frame the Workflow ↔ Automation model and are binding on every section below. A downstream decision that conflicts with one of these is a pre-implementation bug — fix the section, not the principle.

1. **Capability-layer boundary — logic lives at the Workflow layer, not in Automations.** Workflows are the orchestration layer; Automations are capabilities the orchestration invokes. Control flow — branching, looping, conditional step selection, retry policy choice, gate selection, error-handling strategy — lives exclusively in the Workflow definition. Automations are leaf external calls: they accept inputs, perform their external effect, and return a response. An Automation that contains business logic affecting Workflow progression (deciding what the Workflow does next based on internal state) is a design bug. The webhook wrapper is a black box; anything the caller needs to reason about must be on the Workflow side of the boundary. This forces the mental model to stay coherent: one layer decides, the other layer does.
2. **Derive, don't duplicate.** Workflows reference Automations by `automationId`; they do not copy the Automation's logic, configuration, credentials, or required-connection list into the Workflow definition. A change to an Automation propagates to every Workflow that references it (subject to the §5.8 scope-matching rule). Any persisted Workflow definition that embeds Automation logic instead of referencing it is a design bug.
3. **Workflows are the primary user construct; Automations are supporting capabilities.** Workflows are how users accomplish outcomes; Automations exist to be invoked from Workflows (or occasionally run standalone as legacy engine wrappers). Product UX — libraries, empty states, nav, onboarding surfaces, templates, search — treats Workflows as the outcome-level construct and Automations as capability ingredients. Automations are never presented as an alternative solution to authoring a Workflow. This is a UX-contract rule enforced by §3a's mockup set and the [frontend-design-principles](./frontend-design-principles.md) pre-design gate.

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
| **Playbooks** (to become Workflows) | DB: `playbook_runs`, `playbook_step_runs`, `playbook_step_reviews`, `playbook_templates`, `playbook_template_versions`, `playbook_studio_sessions`, `playbook_run_event_sequences`, `system_playbook_templates`, `system_playbook_template_versions` (note: there is no top-level `playbooks` table — the primary identity lives on `playbook_templates`/`playbook_runs`). Services: `playbookStudioService.ts`, `playbookRunService.ts`, `playbookTemplateService.ts`, `playbookStepReviewService.ts`, `playbookEngineService.ts`. UI: `PlaybookStudioPage`, `PlaybooksLibraryPage`, `PlaybookRunModal`, `PlaybookRunDetailPage`. Files: `*.playbook.ts`. Skills: `playbook_*`. | Native DAG orchestration with HITL gates, memory integration, scheduling, simulation, cost estimation, per-step reviews. |
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

## 3a. UI surface decisions

Every UI change in this spec has an accompanying mockup in [`prototypes/riley-observations/`](../prototypes/riley-observations/index.html). The mockup set was reviewed against [`docs/frontend-design-principles.md`](./frontend-design-principles.md) and deliberately trimmed — where a v1 UI surface was originally going to expose internal configuration, diagnostics, or aggregated metrics, those surfaces were cut or deferred to admin-only views.

Design posture applied across every mockup, and binding on every section below:

- **Start from the user's task, not the data model.** A new column does not imply a new panel.
- **One primary action per screen.** Libraries have one CTA. Modals have one Run / Save / Switch.
- **Default to hidden** for dashboards, KPI tiles, diagnostic panels, trend charts, aggregated metrics, and internal identifier exposure. These ship only on admin-only observability pages that the primary user never opens.
- **Inline state beats dashboards.** A status dot next to a name + a timestamp beats a utilization panel. Where runs surface on per-entity pages, they surface as single rows with one human error line and one "fix" CTA — not as full JSON / tracing / error-code references.
- **Extend existing pages; do not introduce parallel surfaces.** Every "agent config" field in this spec slots into the existing `AdminAgentEditPage.tsx` / `SubaccountAgentEditPage.tsx` shells. No new config page is created. The implementation path is `Edit` an existing form, not `Write` a new route.

### 3a.1 Mockup ↔ spec section map

| # | Mockup | Part | Primary user task | Surface type |
|---|---|---|---|---|
| 01 | [Sidebar post-rename](../prototypes/riley-observations/01-sidebar-post-rename.html) | 1 | Navigate to the right primitive | Existing sidebar, renamed labels + differentiated icons |
| 02 | [Agent chat · Explore Mode](../prototypes/riley-observations/02-agent-chat-explore-mode.html) | 3 | Chat safely — see what will change before it runs | Existing chat page, new mode chip + approval card |
| 03 | [Workflow Run Modal](../prototypes/riley-observations/03-workflow-run-modal-step2.html) | 3 | Pick a safety mode and run the Workflow | Existing `WorkflowRunModal`, new radio pair |
| 04 | [Promote-to-Execute](../prototypes/riley-observations/04-promote-to-execute-prompt.html) | 3 | Decide whether to stop reviewing every action | New one-sentence modal |
| 05 | [Step picker — "Call Automation"](../prototypes/riley-observations/05-workflow-studio-step-picker.html) | 2 | Add a step to the Workflow | Existing Studio step-type menu, new option |
| 06 | [Automation picker + input mapping](../prototypes/riley-observations/06-automation-picker-drawer.html) | 2 | Pick an Automation and fill in its inputs | New drawer triggered from mock 05 |
| 07 | [Failed step inline in run log](../prototypes/riley-observations/07-invoke-automation-run-detail.html) | 2 | Know what to do when something broke | Existing run log, one row — **no new run-detail page** |
| 08 | [Workflows library](../prototypes/riley-observations/08-workflows-library.html) | 1 | Find or create a Workflow | Existing library, simplified |
| 09 | [Automations library](../prototypes/riley-observations/09-automations-library.html) | 1 | Find or register an Automation | Existing library, simplified |
| 10 | [Agent settings — safety + schedule](../prototypes/riley-observations/10-agent-config-page.html) | 3 + 4 | Set the agent's defaults | Existing `AdminAgentEditPage.tsx` → "Schedule & Concurrency" section (~L1410–1531); existing `SubaccountAgentEditPage.tsx` (safety mode only) — **no new config page** |

### 3a.2 Decisions locked by the mockup pass

The following UI decisions are binding on every downstream section. Where §5.11 / §6.8 / §7.9 disagree with the mockups, the mockups win — the section prose has been updated to match, and any remaining drift is a pre-implementation bug.

1. **No new agent-config page is introduced.** `default_safety_mode` and the heartbeat activity-gate toggle are surgical additions to the existing "Schedule & Concurrency" section on `AdminAgentEditPage.tsx`. `default_safety_mode` mirrors onto `SubaccountAgentEditPage.tsx`. `OrgAgentConfigsPage.tsx` stays read-only. Architect + builder must `Edit` — not `Write` — these pages. Any parallel "Agent Safety Settings" page is a bug.
2. **No new run-detail page for `invoke_automation` steps.** Failed Automation calls render as one row in the existing run log with a one-line human error ("The Mailchimp connection isn't set up for this subaccount") and one primary CTA ("Set up Mailchimp"). No JSON payload preview, no tracing-event names, no HTTP status exposure, no error-code reference grid on user screens. Internal diagnostics live in the tracing sink (§5.9) and an admin observability page — not here.
3. **Heartbeat gate UI ships the toggle only.** The two numeric thresholds (`heartbeat_event_delta_threshold`, `heartbeat_min_ticks_before_mandatory_run`) remain in the schema with their defaults (3, 6) but **are not exposed as per-agent form fields in v1**. Tuning is an admin observability concern; re-exposure happens only if operational data shows per-agent tuning is necessary. The rule-inventory help text (*"more than 3 new events since last tick…"*) is dropped — gate logic is internal.
4. **Scheduled-run mode is enforced server-side only.** The `WorkflowRunModal` has no "disabled selector" variant for scheduled runs; there is no second modal state to maintain. Scheduled runs skip the mode-picker step entirely and always resolve to Execute at dispatch (§6.6 rule 3).
5. **Mid-conversation mode switches are recorded in the run log, not inline in the chat stream.** §6.8's original "Mode changed to Execute at 14:32 by {user}" system-message rendering is dropped. The run log (existing infrastructure) is the audit trail; the chat surface stays focused on conversation + approvals.
6. **Promote-to-Execute prompt ships as one sentence + two buttons.** No trust-receipts list of previously-approved actions inside the modal; the lead-in line ("5 successful Explore runs") is the receipt. Typing "Execute" to confirm is not required in v1 (reopens only if post-launch incident data demands it).
7. **Automation picker shows list + selected-row-expands-inline for input mapping.** No scope-filter tabs, no engine-filter chips, no per-row connection-readiness counters. Scope matching is resolved server-side via the §5.8 rule; engine type is informational metadata per row; connection readiness surfaces inline only when a connection is missing ("Needs a Mailchimp connection").
8. **Libraries render as single tables with ≤ 4 columns.** No KPI tiles, no filter chips, no per-row step-count chips ("3 native · 1 Automation"). Workflows: name, agent, last-run. Automations: name, tool, readiness. One primary action per page.

Anything not listed here that a future UI change introduces must pass the [frontend-design-principles](./frontend-design-principles.md) pre-design checklist before going into a mockup — let alone into production code.

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

**Schema changes** (migration: `0202_rename_workflow_runs_to_flow_runs.sql`):

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

**Schema changes** (migration: `0203_rename_processes_to_automations.sql`):

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

**Permission keys** (full enumeration — every `PROCESSES_*` key defined in `server/lib/permissions.ts`):

| From | To |
|---|---|
| `ORG_PERMISSIONS.PROCESSES_VIEW` | `ORG_PERMISSIONS.AUTOMATIONS_VIEW` |
| `ORG_PERMISSIONS.PROCESSES_CREATE` | `ORG_PERMISSIONS.AUTOMATIONS_CREATE` |
| `ORG_PERMISSIONS.PROCESSES_EDIT` | `ORG_PERMISSIONS.AUTOMATIONS_EDIT` |
| `ORG_PERMISSIONS.PROCESSES_DELETE` | `ORG_PERMISSIONS.AUTOMATIONS_DELETE` |
| `ORG_PERMISSIONS.PROCESSES_ACTIVATE` | `ORG_PERMISSIONS.AUTOMATIONS_ACTIVATE` |
| `ORG_PERMISSIONS.PROCESSES_TEST` | `ORG_PERMISSIONS.AUTOMATIONS_TEST` |
| `ORG_PERMISSIONS.PROCESSES_VIEW_SYSTEM` | `ORG_PERMISSIONS.AUTOMATIONS_VIEW_SYSTEM` |
| `ORG_PERMISSIONS.PROCESSES_CLONE` | `ORG_PERMISSIONS.AUTOMATIONS_CLONE` |
| `SUBACCOUNT_PERMISSIONS.PROCESSES_VIEW` | `SUBACCOUNT_PERMISSIONS.AUTOMATIONS_VIEW` |
| `SUBACCOUNT_PERMISSIONS.PROCESSES_EXECUTE` | `SUBACCOUNT_PERMISSIONS.AUTOMATIONS_EXECUTE` |
| `SUBACCOUNT_PERMISSIONS.PROCESSES_CREATE` | `SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CREATE` |
| `SUBACCOUNT_PERMISSIONS.PROCESSES_EDIT` | `SUBACCOUNT_PERMISSIONS.AUTOMATIONS_EDIT` |
| `SUBACCOUNT_PERMISSIONS.PROCESSES_DELETE` | `SUBACCOUNT_PERMISSIONS.AUTOMATIONS_DELETE` |
| `SUBACCOUNT_PERMISSIONS.PROCESSES_CLONE` | `SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CLONE` |
| `SUBACCOUNT_PERMISSIONS.PROCESSES_CONFIGURE` | `SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CONFIGURE` |
| Permission seed data in `server/lib/permissions.ts` `ORG_PERMISSION_DEFINITIONS` + `SUBACCOUNT_PERMISSION_DEFINITIONS` arrays | Updated alongside the enum rename (same commit) |
| Group-name strings `'org.processes'` + `'subaccount.processes'` | `'org.automations'` + `'subaccount.automations'` |

**UI page changes:**

| From | To |
|---|---|
| `client/src/pages/TasksPage.tsx` (lazy-loaded as `ProcessesPage`) | `client/src/pages/AutomationsPage.tsx`, lazy-loaded alias drops the `Tasks` name entirely |
| `client/src/pages/TaskExecutionPage.tsx` | `client/src/pages/AutomationExecutionPage.tsx` |
| `client/src/pages/AdminTasksPage.tsx` | `client/src/pages/AdminAutomationsPage.tsx` |
| `client/src/pages/AdminTaskEditPage.tsx` | `client/src/pages/AdminAutomationEditPage.tsx` |
| `client/src/pages/SystemProcessesPage.tsx` | `client/src/pages/SystemAutomationsPage.tsx` |
| Lazy-import aliases in `client/src/App.tsx` | Renamed both alias and target consistently (no more misleading `ProcessesPage → TasksPage` aliasing) |

**Additional client files referencing `/processes` or `/api/processes`** (confirmed via grep; each gets its `/processes` → `/automations` update in the same commit):

| File | What to update |
|---|---|
| `client/src/App.tsx` | Route registration, lazy imports |
| `client/src/components/CommandPalette.tsx` | `{ label: 'Workflows', to: '/processes', keywords: 'processes automations' }` → `{ label: 'Automations', to: '/automations', keywords: 'automations' }` |
| `client/src/pages/AdminSubaccountDetailPage.tsx` | `api.get('/api/processes')` + any downstream `processes` property references |
| `client/src/pages/PortalExecutionPage.tsx` | `/processes` → `/automations` in any referenced paths |
| `client/src/pages/PortalExecutionHistoryPage.tsx` | Same |
| `client/src/pages/OrgSettingsPage.tsx` | Any settings panels referencing `/processes` or permission names |

**Additional server routes referencing `/processes`:**

| File | What to update |
|---|---|
| `server/routes/subaccounts.ts` | Any downstream `/processes` path or `processService` import |
| `server/routes/portal.ts` | Any downstream `/processes` or `processService` usage |
| `server/routes/systemProcesses.ts` | Already renamed above — confirm no stale path strings inside |
| `server/routes/processConnectionMappings.ts` | Already renamed above — confirm all handler functions and response shapes referencing `process*` are renamed |

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

**Schema changes** (migration: `0204_rename_playbooks_to_workflows.sql`):

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
| Column `playbook_id` (on child tables) | `workflow_id` |
| Column `playbook_template_id` | `workflow_template_id` |
| Column `playbook_run_id` (on `agent_runs` and others) | `workflow_run_id` |
| Column `playbook_step_run_id` | `workflow_step_run_id` |
| Column `playbook_slug` (on memory/onboarding tables) | `workflow_slug` |
| Column `last_written_by_playbook_slug` | `last_written_by_workflow_slug` |
| Column `created_by_playbook_slug` | `created_by_workflow_slug` |
| Onboarding slug-array columns containing `playbook_*` slugs (e.g. `modules.onboarding_playbook_slugs`) | Renamed to `onboarding_workflow_slugs` |
| FK constraints referencing renamed tables | Renamed for consistency |
| Indexes referencing `playbook_*` | Renamed to `workflow_*` |

**Cross-table columns carrying playbook identity** (enumerated — the migration renames each):

- `memoryBlocks.ts` / migration 0120 `memory_block_playbook_fields` — rename the `playbook_*` fields (including `playbook_slug`, `last_written_by_playbook_slug`, `created_by_playbook_slug` where present).
- `modules.ts` / migrations 0119 + 0122 `modules_onboarding_playbook_slugs` — rename slug-array column.
- `subaccountOnboardingState.ts` — rename any `playbook_slug` or `active_playbook_slugs` reference.
- `portalBriefs.ts` — rename `playbook_run_id` column to `workflow_run_id`.
- `agentRuns.ts` — rename `playbook_run_id` linkage column.
- `onboardingBundleConfigs.ts` — rename any `playbook_slug`-keyed fields.

Architect pass runs `grep -rE "'playbook_|playbook_id|playbook_run_id|playbook_slug" server/db/schema/` once more at plan time to catch any column missed here; any new hit is added to the migration in the same PR.

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

**Service changes** (full enumeration — every `playbook*` file under `server/services/` and `server/lib/`):

| From | To |
|---|---|
| `server/services/playbookStudioService.ts` | `server/services/workflowStudioService.ts` |
| `server/services/playbookRunService.ts` | `server/services/workflowRunService.ts` |
| `server/services/playbookTemplateService.ts` | `server/services/workflowTemplateService.ts` |
| `server/services/playbookStepReviewService.ts` | `server/services/workflowStepReviewService.ts` |
| `server/services/playbookEngineService.ts` | `server/services/workflowEngineService.ts` |
| `server/services/playbookStudioGithub.ts` | `server/services/workflowStudioGithub.ts` |
| `server/services/playbookActionCallExecutor.ts` | `server/services/workflowActionCallExecutor.ts` |
| `server/services/playbookActionCallExecutorPure.ts` | `server/services/workflowActionCallExecutorPure.ts` |
| `server/services/playbookAgentRunHook.ts` | `server/services/workflowAgentRunHook.ts` |
| `server/lib/playbook/*` directory | `server/lib/workflow/*` directory (mirror all subfiles: `types.ts`, `__tests__/`, validators, renderer, etc.) |
| Exported class / function names | Renamed from `Playbook*` to `Workflow*` |

**Route changes** (full enumeration — every route file referencing playbook surfaces):

| From | To |
|---|---|
| `server/routes/playbookRuns.ts` | `server/routes/workflowRuns.ts` |
| `server/routes/playbookTemplates.ts` | `server/routes/workflowTemplates.ts` |
| `server/routes/playbookStudio.ts` | `server/routes/workflowStudio.ts` |
| `server/routes/subaccountOnboarding.ts` | Retained as-is — update internal references to renamed Playbook functions/types |
| `/api/playbooks/*` | `/api/workflows/*` |
| `/api/system/playbook-studio/*` | `/api/system/workflow-studio/*` |
| Route registration in `server/index.ts` / `server/routes/index.ts` | Updated |

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
- Automation capability-contract fields: side-effect classification, idempotency expectation (§5.4a)
- HITL gate semantics for composed Automation steps
- Composition constraints — nesting depth and recursion rules (§5.10a)
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
  automationId: string;           // references automations.id
  // Input values: each field is either a literal JSON value or a template string
  // in the existing Workflow DSL's form (e.g. "{{ steps.previousStep.output.field }}").
  // Template resolution matches the existing `playbookEngineService` expression
  // renderer; no new DSL is introduced. Confirmed file/function name during architect pass.
  inputMapping: Record<string, TemplateExpression | JsonLiteral>;
  outputMapping?: Record<string, TemplateExpression>;
  timeoutSeconds?: number;        // default: `DEFAULT_TIMEOUT_SECONDS` (300s, defined in
                                  // `server/services/processService.ts:7` today; moves to
                                  // `server/services/automationService.ts` after Part 1 rename).
                                  // Note: the Automation row does NOT carry a per-row timeout
                                  // today — this is a service-level constant. Adding a per-row
                                  // override column is an open question deferred to architect (§12).
  retryPolicy?: StepRetryPolicy;  // default: inherit from Workflow's step-retry default, subject
                                  // to the Automation's `idempotent` column (§5.4a rule 3) —
                                  // non-idempotent Automations disable auto-retry on transient
                                  // failure unless the author overrides explicitly.
  gateLevel?: 'auto' | 'review';  // default: resolved from the Automation's `side_effects` column
                                  // per §5.4a rule 1 and §5.6 (read_only → auto; mutating or
                                  // unknown → review). `'block'` is intentionally excluded — to
                                  // block an external call, remove the step. Workflow-definition
                                  // validator rejects persisted steps with `gateLevel: 'block'`
                                  // at authoring time.
  // Scoping note: the resolved Automation must be the SAME scope as this Workflow run's
  // scope AND share the same identity on the shared scope column.
  //   - subaccount-scoped Workflow + subaccount-scoped Automation → same `subaccount_id`
  //   - subaccount-scoped Workflow + org-scoped Automation → same `organisation_id` (fallback)
  //   - subaccount-scoped Workflow + system-scoped Automation → always matches (system)
  //   - org-scoped Workflow + org-scoped Automation → same `organisation_id`
  //   - org-scoped Workflow + system Automation → always matches
  //   - system Workflow → system Automation only.
  // Cross-subaccount references are rejected at dispatch with `error_code: 'automation_scope_mismatch'`.
  // See §5.8 for the full resolution rule and error posture.
}
```

`TemplateExpression` is the existing Workflow DSL expression form used in `server/lib/playbook/types.ts` — a template-literal string resolved by the engine's expression renderer (e.g. `"{{ steps.event_basics.output.venue }}"` or `"{{ run.input.name }}"`). Authored templates for `invoke_automation` MUST use the same syntax as every other Workflow step type; no parallel expression language is introduced. Architect pass cites the exact renderer module.

### 5.4 Input mapping contract

- The Automation's `input_schema` column (currently `text` on `processes`, post-rename `automations`) is the intended source of the required input shape.
- **v1 posture on runtime validation.** `input_schema` is stored as a `text` column today with no canonical format. v1 of `invoke_automation` treats input validation as best-effort: if the column is non-empty and parseable as JSON Schema (ajv-compatible), the step validates and fails with `error_code: 'automation_input_validation_failed'` on mismatch. If the column is empty OR not parseable as recognised JSON Schema, the step skips input validation and fires the webhook with the rendered `inputMapping` as-is. The exact validator library and format are §12 open questions — architect picks before Part 2 lands.
- Missing required fields (as declared by a parseable schema) fail fast with `error_code: 'automation_input_validation_failed'`.
- Extra fields are permitted unless the parsed schema declares `additionalProperties: false`.

### 5.4a Automation capability contract — side-effects and idempotency

Per §1.5 principle 1 (capability-layer boundary), every Automation declares its side-effect class and idempotency expectation at the capability layer. The Workflow layer uses these to drive gate resolution and retry posture — it does not re-derive them per step.

Two new columns on `automations` (added by migration `0203_rename_processes_to_automations.sql` as part of the rename; these columns did not exist on `processes` and are introduced by the same migration that renames the table):

| Column | Type | Default | Nullability | Purpose |
|---|---|---|---|---|
| `side_effects` | text enum (`'read_only' \| 'mutating' \| 'unknown'`) | `'unknown'` | NOT NULL | Declares what the external call does to systems of record. Drives the gate-resolution default for the Automation when invoked from a Workflow step with no explicit `gateLevel`. |
| `idempotent` | boolean | `false` | NOT NULL | Declares whether the external call is safe to retry on transient failure without producing duplicate effects. Drives retry-policy posture at the Workflow layer. |

Resolution rules:

1. **Gate resolution default.** When an `invoke_automation` step omits `gateLevel`, the default is:
   - `side_effects = 'read_only'` → `gateLevel: 'auto'`
   - `side_effects = 'mutating'` → `gateLevel: 'review'`
   - `side_effects = 'unknown'` → `gateLevel: 'review'` (safe default; audit the Automation and reclassify)
2. **Explore Mode override.** Per §5.6 / §6.2, Explore Mode forces `'review'` on every `invoke_automation` step regardless of declared gate or `side_effects` class. The classification drives the Execute-Mode default, not the Explore-Mode override.
3. **Retry posture.** `idempotent = true` allows the Workflow's step-retry default to apply on transient failures (`timeout`, `network_error`, 5xx `http_error`). `idempotent = false` disables automatic retry on those error classes — the Workflow must handle failure explicitly (continue, stop, or branch to error handler). Authoring-time UI warns when a user selects a retry policy on an Automation with `idempotent = false`; the choice is persisted as authored (no silent override).
4. **Audit expectation.** Every Automation ships with `side_effects` and `idempotent` set by the author; the default `'unknown' / false` is a safe-but-noisy fallback for unmigrated or imported rows. Post-launch monitoring flags rows stuck on defaults.

The capability-layer contract is the Automation's self-declaration; the Workflow layer consumes it but does not override it. A user who needs a stricter posture on a specific step sets `gateLevel: 'review'` or disables retries explicitly on the step — they do not mutate the underlying Automation.

Cross-reference: `side_effects` on **Automations** (this section) is a distinct column from `side_effects` on **skills** (§6.4). Both serve the same gate-resolution purpose but live on separate primitives; the §6.5 `resolveEffectiveGate` function reads the appropriate column based on the subject kind (`'skill'` vs `'invoke_automation'`).

### 5.5 Output mapping contract

- The Automation's response (whatever the engine returns) is treated as the step output.
- The optional `outputMapping` projects fields out of the response into the Workflow's variable space, addressable by later steps as `{{ steps.{stepId}.output.{mappedKey} }}` — the same template syntax used everywhere else in the DSL.
- If `outputMapping` is omitted, the full response body is available at `{{ steps.{stepId}.output.response }}`.
- Output-schema validation: same best-effort posture as §5.4. If `output_schema` is non-empty and parseable, validate and fail with `error_code: 'automation_output_validation_failed'` on mismatch; otherwise skip.

### 5.6 HITL gate semantics

- **Default gate resolution** when an `invoke_automation` step omits `gateLevel`: driven by the Automation's `side_effects` capability-contract column (§5.4a). `read_only` → `'auto'`; `mutating` or `unknown` → `'review'`. External calls have blast-radius implications — a CRM webhook could modify records we can't observe — so the safe-default for unclassified Automations (`unknown`) remains `'review'`.
- Users can override the resolved default to `'auto'` per-step at authoring time if the Automation is known-safe (typically after reclassifying its `side_effects` or accepting the blast-radius risk).
- Block-level gating is not supported for `invoke_automation` (if you want to block an external call, remove the step).
- Explore Mode (Part 3) forces `invoke_automation` steps to `'review'` regardless of declared gate level or `side_effects` class, matching side-effecting skill behaviour. This is automatic — no special-case code beyond the generic gate resolution.
- Supervised mode (existing) is subsumed by Explore Mode after Part 3 ships.

### 5.7 Error propagation

- Automation call returns non-2xx HTTP → step fails with `error_code: 'automation_http_error'`, payload includes status + response body.
- Automation call times out → step fails with `error_code: 'automation_timeout'`. Timeout defaults to 300s unless overridden on the step.
- Network error / DNS failure → step fails with `error_code: 'automation_network_error'`.
- Retries apply per the step's `retryPolicy` (default: Workflow's step-retry default), gated by the Automation's `idempotent` column per §5.4a rule 3 — a `retryPolicy` on a non-idempotent Automation is persisted as authored but the dispatcher does not auto-retry on transient failure classes (`timeout`, `network_error`, 5xx `http_error`) unless the author has explicitly overridden the guard at authoring time.
- Failure cascades follow Workflow error-handling semantics (continue / stop / branch to error handler — whatever the existing DSL supports).

### 5.8 Credential resolution and scoping

- At step dispatch, resolve the Automation's `automation_engine_id` to an `automation_engines` row.
- **Scope-matching rule — identity must match at the shared tenancy column, not just the scope tier:**
  - Subaccount-scoped Workflow must resolve to either (a) a subaccount-scoped Automation with the SAME `subaccount_id`, (b) an org-scoped Automation with the SAME `organisation_id`, or (c) a system Automation.
  - Org-scoped Workflow must resolve to either (a) an org-scoped Automation with the SAME `organisation_id`, or (b) a system Automation.
  - System-scoped Workflow may only resolve to a system Automation.
  - Cross-subaccount or cross-org references are rejected at dispatch with `error_code: 'automation_scope_mismatch'` before the webhook fires. Engine resolution applies the same tenant-equality rule.
- HMAC signing: reuse the existing per-engine HMAC secret from `automation_engines.hmac_secret` for outbound request signatures.
- Required connections: the Automation declares required connections in its `required_connections` field. At dispatch, resolve each required connection's credential for the subaccount context. If any required connection is missing, the step fails with `error_code: 'automation_missing_connection'` before the webhook fires.

### 5.9 Telemetry emissions

Two events per `invoke_automation` step, but the `dispatched` event is conditional on successful pre-dispatch resolution. Pre-dispatch failures (scope mismatch, missing connection, not-found, input-validation failure) emit ONLY the completion event, and ONLY if the step reached the telemetry call path at all — authoring-time validation rejections never emit anything.

**At dispatch (only after successful resolution — automation found, scope matched, connections resolved, input validated):**

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

**At completion (success or failure; fires for every resolved-or-failed dispatch attempt):**

```typescript
{
  eventType: 'workflow.step.automation.completed',
  runId: string,
  workflowId: string,
  stepId: string,
  automationId: string,
  // Every terminal outcome the step can reach:
  //   'ok'                            — webhook fired, 2xx response, passed output validation
  //   'http_error'                    — webhook fired, non-2xx response
  //   'timeout'                       — webhook fired, request timed out
  //   'network_error'                 — webhook fire failed (DNS / TCP / TLS)
  //   'input_validation_failed'       — pre-dispatch: rendered input failed `input_schema`
  //   'output_validation_failed'      — post-dispatch: response body failed `output_schema`
  //   'missing_connection'            — pre-dispatch: a required connection was unresolved
  //   'automation_not_found'          — pre-dispatch: automationId could not be resolved
  //   'automation_scope_mismatch'     — pre-dispatch: scope rule in §5.8 rejected the match
  //   'automation_composition_invalid' — pre-dispatch: §5.10a rule 4 rejected multi-webhook resolution
  // Note: `workflow_composition_invalid` (§5.10a rules 1–3) is an authoring-time
  // validator error, not a dispatch-time outcome — it never reaches this event path.
  status:
    | 'ok'
    | 'http_error'
    | 'timeout'
    | 'network_error'
    | 'input_validation_failed'
    | 'output_validation_failed'
    | 'missing_connection'
    | 'automation_not_found'
    | 'automation_scope_mismatch'
    | 'automation_composition_invalid',
  httpStatus?: number,           // present when `status` is `'ok'`, `'http_error'`, or `'output_validation_failed'`
  latencyMs: number,             // time from step start to step terminal outcome (pre-dispatch failures have low latency)
  responseSizeBytes?: number,    // present when the webhook returned a body
  timestamp: ISO8601,
}
```

Both events register in `server/lib/tracing.ts`. Keep response bodies OUT of the event payload for privacy; store them (if needed) in the native workflow step-output column `workflow_step_runs.output_json` (post-Part-1-rename). This is the Playbook/Workflow step-run storage — NOT `flow_step_outputs` (the internal flow stack renamed in Part 1 Step 1).

### 5.10 Edge cases

1. **Automation is deleted mid-Workflow-run.** Step fails with `error_code: 'automation_not_found'`. Workflow's error-handling policy applies.
2. **Automation scope changes after Workflow authoring.** A Workflow references an org-scoped Automation; that Automation gets deleted and recreated at subaccount scope. The Workflow reference breaks. Detect at dispatch; fail with `automation_not_found`.
3. **Automation engine offline.** Reuse whatever degraded-mode posture the existing process-execution path has. Audit during architect pass.
4. **Automation called recursively via Workflow → Automation → Workflow → …** Not supported in v1. Automations are leaf external calls; they don't call back into our Workflows. If we ever add callback-based composition, that's a separate spec.
5. **Cost estimation for Workflows containing Automation steps.** The existing `workflow_estimate_cost` skill (renamed in Part 1) needs to incorporate Automation cost (the external engine's cost, if known, or zero if unknown). Out of scope for v1 — flag for follow-up.

### 5.10a Composition constraints

Per §1.5 principle 1 (Automations are leaf calls; logic lives at the Workflow layer), the composition model has a small, enforceable ruleset. The authoring-time validator and the dispatcher both enforce these; a persisted Workflow violating any of them is rejected at save time and, as a defence-in-depth check, at dispatch time.

1. **Maximum composition depth is one.** The only supported shape is Workflow → Automation → external engine. An `invoke_automation` step fires a single outbound webhook; the Automation is the leaf. There is no Automation → Automation chaining at our layer — what the external engine does downstream (Make scenario fans out to multiple steps, n8n flow calls another flow) is outside our boundary and does not count against our depth.
2. **No recursive Workflow calls in v1.** A Workflow cannot invoke another Workflow, directly or indirectly. The only step types that execute something are `skill invocation`, `agent decision`, and `invoke_automation`; there is no `invoke_workflow` step type. If/when sub-Workflow composition lands in a future spec, it will define its own recursion-detection and cycle-breaking rules (deferred — see §9b marketplace-readiness entry). The authoring validator rejects any persisted step whose discriminator does not belong to the documented set.
3. **No callback-based composition in v1.** An Automation cannot trigger a Workflow via webhook callback as part of composition (§5.2 out-of-scope). External engines can still call our inbound webhooks — that's the existing `/api/automations/...` surface unchanged by this spec — but those inbound calls are not treated as continuations of the calling Workflow run. They are independent entry points.
4. **Dispatcher defence-in-depth.** The step dispatcher rejects any `invoke_automation` step resolution that would produce more than one outbound webhook for the step (e.g. an Automation row that has been mutated to embed a list of webhook targets). One step, one webhook, one response.

Violations of rules 1–3 are authoring-time errors (`error_code: 'workflow_composition_invalid'`) raised by the Workflow-definition validator. Rule 4 is a dispatch-time error (`error_code: 'automation_composition_invalid'`) raised by the step dispatcher. Both error codes register alongside the §5.7 vocabulary.

### 5.11 UI considerations

Locked by the mockup pass (see §3a.2). Mockups: [05 step picker](../prototypes/riley-observations/05-workflow-studio-step-picker.html), [06 Automation picker](../prototypes/riley-observations/06-automation-picker-drawer.html), [07 failed step in run log](../prototypes/riley-observations/07-invoke-automation-run-detail.html).

- **Step-type menu:** the existing Workflow Studio step-type menu gains a new sibling option *"Call an Automation."* It is rendered alongside *"Run a skill"*, *"Ask the agent to decide"*, *"Wait"*, and *"Ask a person to review"* with no elevated visual treatment beyond a subtle highlight on first introduction. No separate "advanced" or "external" submenu.
- **Automation picker drawer:** single right-side drawer. Shows a plain list of the user's Automations. The selected row expands inline to reveal the input-mapping fields — no dedicated picker → configure two-step flow.
- **Picker row content:** Automation name + tool badge (Make / n8n / GHL / Zapier / Webhook). No scope-filter tabs, no engine-filter chip row, no per-row connection-count readout. Connection-readiness surfaces inline only when a connection is missing (e.g. *"Needs a Mailchimp connection"*).
- **Scope resolution is server-side.** The picker does not prompt the user to pick a scope; the §5.8 scope-matching rule runs on submit and rejects with `automation_scope_mismatch` if a cross-scope reference is attempted. Cross-scope references are rare by construction (users pick from their own scope's Automations) and do not need a UI filter.
- **Input mapping:** plain labelled form fields. Authored values may be literals or template expressions in the existing `{{ steps.X.output.Y }}` DSL — the syntax is typed into the field directly, not exposed as a quick-pick chip row. The field placeholder and help-text document the template syntax for advanced users who need it. The template renderer module (cited in §5.3) remains the single DSL; no parallel input language.
- **Output mapping:** the optional `outputMapping` is exposed as an additional section inside the selected row's expanded state, shown only when the user explicitly adds output bindings. The Automation's declared `output_schema` (if present) is surfaced as inline help text inside the first output-mapping field, not as a separate preview panel.
- **Failed `invoke_automation` steps have NO dedicated run-detail page.** They surface as one row in the existing run log with a single human-readable error message and one primary CTA (e.g. *"Set up Mailchimp"*). Request / response bodies, tracing event names, HTTP status codes, and the full §5.7 error-code vocabulary are admin observability concerns — surfaced through the tracing sink and a future admin page, never on the user-facing run log.
- **Success `invoke_automation` steps** surface as one row in the run log with a green dot and a short result summary (e.g. *"Pushed 34 contacts"*). The dispatched + completed telemetry events (§5.9) fire regardless; they are not exposed to the primary user.

Exact component file names and placement within `WorkflowStudioPage.tsx` / run-log components: architect pass. Architect is bound by the mockups above — any divergence from them must route back through §3a's design-principles gate.

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

One migration (`0205_explore_execute_mode.sql`):

> **Naming collision with pre-existing `run_mode` column.** `playbook_runs.run_mode` was introduced in migration `0086_playbook_run_mode.sql` with values `('auto', 'supervised', 'background', 'bulk')` — execution-style semantics, not safety semantics. After Part 1's Step 3 rename the column lands on `workflow_runs.run_mode` with those four legacy values. The Explore/Execute safety mode is a **separate** dimension and gets its own column (`safety_mode`) rather than overloading `run_mode`. The supervised-mode overlap with Explore is addressed by §6.8 (Supervised checkbox removal) and must not bleed into the existing `run_mode` enum. Architect pass confirms the final approach (see §12.24 open question).

```sql
-- Add default_safety_mode to agents (NEW — Explore/Execute safety dimension)
ALTER TABLE agents
  ADD COLUMN default_safety_mode text NOT NULL DEFAULT 'explore'
  CHECK (default_safety_mode IN ('explore', 'execute'));

-- Add safety_mode to workflow_runs (renamed from playbook_runs in Part 1; separate
-- from the pre-existing `run_mode` column which carries auto|supervised|background|bulk).
ALTER TABLE workflow_runs
  ADD COLUMN safety_mode text NOT NULL DEFAULT 'explore'
  CHECK (safety_mode IN ('explore', 'execute'));

-- Add safety_mode to agent_runs (no pre-existing column collision here).
ALTER TABLE agent_runs
  ADD COLUMN safety_mode text NOT NULL DEFAULT 'explore'
  CHECK (safety_mode IN ('explore', 'execute'));

-- User-safety-mode-preference storage (see §6.8). Tenant-scoped — includes organisation_id
-- for the RLS policy; see §6.3a below for the complete RLS contract.
-- Table name uses `safety_mode` consistently with the column name — no `run_mode` leakage.
CREATE TABLE user_agent_safety_mode_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  subaccount_id uuid NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  last_successful_mode text NOT NULL CHECK (last_successful_mode IN ('explore', 'execute')),
  successful_explore_runs integer NOT NULL DEFAULT 0,
  promoted_to_execute_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Two partial unique indexes to express "one row per (user, agent, subaccount)" where
-- subaccount_id is nullable. Postgres does not allow NULL in PRIMARY KEY columns, so
-- the surrogate `id` is the PK and uniqueness is enforced via the two partial indexes.
CREATE UNIQUE INDEX user_agent_safety_mode_preferences_scoped_uniq_idx
  ON user_agent_safety_mode_preferences (user_id, agent_id, subaccount_id)
  WHERE subaccount_id IS NOT NULL;
CREATE UNIQUE INDEX user_agent_safety_mode_preferences_unscoped_uniq_idx
  ON user_agent_safety_mode_preferences (user_id, agent_id)
  WHERE subaccount_id IS NULL;

CREATE INDEX user_agent_safety_mode_preferences_user_agent_idx
  ON user_agent_safety_mode_preferences (user_id, agent_id);
```

Naming convention: `safety_mode` (explicitly distinct from the pre-existing `run_mode` execution-style column).

Defaults favour safety:
- New agents: `default_safety_mode = 'explore'`
- New runs: `safety_mode = 'explore'` unless explicitly overridden
- New user preferences (no row yet): treated as `'explore'`

#### 6.3a RLS and manifest entry for `user_agent_safety_mode_preferences`

The table is tenant-scoped (per-organisation) and must ship with the four-requirement bundle from `docs/spec-authoring-checklist.md §4`:

1. **RLS policy** in migration `0205_explore_execute_mode.sql`: `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY user_agent_safety_mode_preferences_tenant_isolation ON user_agent_safety_mode_preferences USING (organisation_id = current_setting('app.current_organisation_id')::uuid)`. Exact policy shape matches the existing three-layer model in `architecture.md §1155`.
2. **Manifest entry** in `server/config/rlsProtectedTables.ts`: add `{ tableName: 'user_agent_safety_mode_preferences', schemaFile: 'userAgentSafetyModePreferences.ts', policyMigration: '0205_explore_execute_mode.sql', rationale: 'Per-user safety-mode preferences — PII via user identity plus agent-usage history.' }`.
3. **Route-level guard**: all HTTP access requires `authenticate` + `requireOrganisation` and the preference mutation routes require a permission key (new: `ORG_PERMISSIONS.AGENT_RUN_MODE_MANAGE` — added in Part 3's permission seed).
4. **Principal-scoped context**: reads from an agent-execution path use `withOrgTx` / `getOrgScopedDb` per `architecture.md §1116`.

Throughout the rest of §6 and every downstream section, the Part 3 safety dimension is always referred to as `safety_mode` (SQL) / `safetyMode` (TypeScript) — NEVER `run_mode` / `runMode`. The term `run_mode` in this spec refers exclusively to the legacy execution-style enum on `workflow_runs` (`auto|supervised|background|bulk`, from migration `0086`). Prose, code examples, telemetry events, and API fields all follow this rule.

### 6.4 Skill side-effect declaration

Explore Mode relies on knowing which skills are side-effecting. Today, this is inferred ambiguously. This spec adds an explicit frontmatter field on every skill markdown file:

```yaml
---
name: send_email
side_effects: true    # NEW — boolean, required for all skills
# ... other frontmatter
---
```

**Runtime storage and migration.** Skills are DB-backed at runtime via the `system_skills` table (`system_skills.definition` JSONB column), with markdown files in `server/skills/*.md` acting as the authoring seed. The `side_effects` field must be accessible during gate resolution — the exact storage location (dedicated `system_skills.side_effects` boolean column vs nested inside `definition`) is §12.22 open question; this spec authors the frontmatter on every markdown file as the source of truth and treats the DB surface as an open decision for architect pass.

**Migration for existing 152 skills:** one-time audit pass annotates every skill markdown file with `side_effects: true | false`. Guidance:
- `true` for anything mutating external state: send email, update CRM, modify ad spend, post message, create GHL contact, write Notion page, fire webhook, transition pipeline stage.
- `false` for pure reads: list deals, get campaign stats, fetch thread, search messages.
- When ambiguous, default to `true` (safe).
- Audit happens as part of Part 3's spec execution; tracked in `tasks/builds/riley-observations/skills-side-effects-audit.md`.

**Enforcement mechanism — static gate, not runtime default.** A new CI gate `scripts/gates/verify-skill-side-effects.sh` runs on every PR and fails the build if any file under `server/skills/**/*.md` or `companies/*/skills/*.md` lacks a top-level `side_effects` frontmatter key. The gate also re-validates the DB-backed skill rows once §12.22 resolves (so skills inserted via `systemSkillService` cannot skip the field). Runtime behaviour on a missing field still defaults to `true` (safe fallback) but the static gate ensures that never happens in practice. This matches the codebase's testing posture (static gates primary).

### 6.5 Gate resolution algorithm

To give `invoke_automation` steps (Part 2 §5.6) and side-effecting skills a single enforcement site, extract the gate decision into a **shared pure function** and call it from both the agent-execution path and the workflow-engine step-dispatch path. The shared function lives at `server/services/gateResolutionServicePure.ts` with a matching wet wrapper in `server/services/gateResolutionService.ts`; both `agentExecutionService.ts` and `playbookEngineService.ts` (post-rename `workflowEngineService.ts`) call the pure function before any side-effecting branch.

```typescript
// server/services/gateResolutionServicePure.ts
type GateSubject =
  | { kind: 'skill'; skill: Skill }
  | { kind: 'invoke_automation'; step: InvokeAutomationStep };

function resolveEffectiveGate(subject: GateSubject, context: RunContext): GateLevel {
  // 1. Block always wins — never bypassed. Only applies to skills, since
  //    InvokeAutomationStep.gateLevel is narrowed to 'auto' | 'review' at authoring
  //    time (see §5.3); a workflow-definition validator rejects 'block' on invoke_automation.
  if (subject.kind === 'skill' && subject.skill.defaultGateLevel === 'block') {
    return 'block';
  }

  // 2. Safety mode Explore forces review on side-effecting skills and on every
  //    invoke_automation step. Rationale: external webhook calls are treated as
  //    side-effecting by definition (§5.6).
  const isSideEffecting =
    subject.kind === 'invoke_automation' ||
    (subject.kind === 'skill' && subject.skill.sideEffects === true);
  if (context.safetyMode === 'explore' && isSideEffecting) {
    return 'review';
  }

  // 3. Fall through to existing per-agent, per-subaccount, per-run gate overrides.
  return resolveExistingGateOverrides(subject, context);
}
```

`invoke_automation` steps (Part 2 §5.6) route through the same shared function — no branch duplication, no separate gate pathway. The workflow engine's step-dispatch loop calls `resolveEffectiveGate({ kind: 'invoke_automation', step }, context)` immediately before firing the outbound webhook.

### 6.6 Run-creation contract

When a run is initiated (agent chat, Workflow run modal, scheduled trigger, external API):

```typescript
// Naming note: the TypeScript field name `safetyMode` (camelCase) maps to the SQL
// column `safety_mode` (snake_case). The Part 3 safety dimension is always
// `safetyMode` in code / `safety_mode` in SQL — NEVER `run_mode` / `runMode`,
// which is reserved for the legacy execution-style enum on `workflow_runs`.
interface RunCreationRequest {
  agentId: string;
  subaccountId: string | null;
  // ... other existing fields
  safetyMode?: 'explore' | 'execute';  // optional; defaulting logic below
  triggerType?: 'user' | 'scheduled' | 'delegated';
  // parentRun is populated when this run is spawned by another run (delegation chain).
  // It is the DIRECT parent only — a grandchild-scheduled sub-run sees only its parent's
  // safety_mode, which was itself already resolved by this function on an earlier call.
  parentRun?: { safetyMode: 'explore' | 'execute' } | null;
}

function resolveSafetyMode(
  request: RunCreationRequest,
  agent: Agent,                    // carries the `defaultSafetyMode` field (`default_safety_mode` column)
  userPref: UserAgentSafetyModePreference | null,
): 'explore' | 'execute' {
  // 1. Delegation inheritance wins over everything. If this run is spawned by a parent
  //    run (including delegated-then-scheduled sub-runs), it inherits the parent's mode.
  //    See §6.7 edge 7: Explore is transitive; you can't escape by delegating or scheduling
  //    from within an Explore-mode parent.
  if (request.parentRun) return request.parentRun.safetyMode;

  // 2. Explicit override from the request wins.
  if (request.safetyMode) return request.safetyMode;

  // 3. Top-level scheduled runs always Execute (no interactive approval). This applies
  //    ONLY to schedules with no parent run — delegation-then-schedule hits rule 1 above.
  if (request.triggerType === 'scheduled') return 'execute';

  // 4. User preference for this (user, agent, subaccount) if one exists.
  if (userPref?.last_successful_mode) return userPref.last_successful_mode;

  // 5. Agent default (which starts as 'explore' for new agents).
  return agent.defaultSafetyMode;
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
7. **Orchestrator-delegated runs.** If the Orchestrator dispatches a sub-task to another agent, the sub-run inherits the parent's `safety_mode`. Explore Mode is transitive — you can't escape Explore by delegating. **Delegation wins over scheduling:** if a parent Explore-mode run enqueues a scheduled sub-run (e.g. "tomorrow at 9am, do X"), the scheduled sub-run still inherits `safety_mode = 'explore'` from the parent — the scheduled-runs-always-execute rule in §6.6 step 2 applies only to top-level schedules (no parent run in the delegation chain).

### 6.8 UI surfaces

Locked by the mockup pass (see §3a.2). Mockups: [02 chat](../prototypes/riley-observations/02-agent-chat-explore-mode.html), [03 Run Modal](../prototypes/riley-observations/03-workflow-run-modal-step2.html), [04 Promote prompt](../prototypes/riley-observations/04-promote-to-execute-prompt.html), [10 agent settings](../prototypes/riley-observations/10-agent-config-page.html).

The mode is visible on every run surface. Not hidden, not collapsible.

**Agent chat page** (`AgentChatPage.tsx`):
- Persistent header chip showing current mode. Single pill, no banner below the header. Explore = neutral pill with lock icon; Execute = accent pill with play icon. One inline chip is the whole mode affordance in the chat header.
- Single-click toggle opens a small confirm dialog before switching. No inadvertent toggles mid-action.
- Side-effecting actions in Explore Mode surface as an inline approval card in the message stream (buttons: *Approve* / *Skip*). Approved actions proceed; skipped actions are recorded and the run continues.
- Mode changes mid-conversation are recorded in the existing run log; they are NOT rendered as an inline system-message bubble in the chat stream. The run-log entry is the audit trail — the chat surface stays focused on conversation + approvals.

**Workflow Run Modal** (`WorkflowRunModal.tsx` after Part 1 rename):
- Single dialog with a two-radio mode picker: *Explore — review each action* / *Execute — run straight through*. Explore is the default.
- No multi-step wizard framing around the mode picker; it's one question with one primary *Run* button.
- The existing Supervised-mode checkbox is removed — Supervised semantics fold into Explore.
- **Scheduled runs are handled server-side only.** There is no "selector disabled" UI variant for scheduled-run creation — the scheduled-run flow does not prompt for a mode. Mode resolution happens at dispatch via the §6.6 rules (top-level scheduled → Execute). No second modal state to maintain.

**Agent config — new fields on the EXISTING Agent Edit page, not a new page:**
- `default_safety_mode` slots into the existing `AdminAgentEditPage.tsx` form AND the existing `SubaccountAgentEditPage.tsx` form. Rendered as a small two-option segmented control (*Explore* / *Execute*) inside the form's general/behaviour area. Column name / form field name: `default_safety_mode`, never `default_run_mode`.
- Help text: *"Explore is recommended for new agents. Users can switch per-run if they need to."*
- `OrgAgentConfigsPage.tsx` remains read-only in v1; no new field there.
- **Implementation note (binding):** the architect pass and the builder session must `Edit` these existing files, not `Write` a new "Agent Safety Settings" page. `AdminAgentEditPage.tsx` is ~2,252 LOC today; the new field slots next to existing agent config (adjacent to the "Schedule & Concurrency" section used in §7.9). Introducing a parallel config surface is a bug.

**Promote-to-Execute modal:**
- One-sentence prompt + two buttons (*Not yet* / *Switch to Execute*). The lead-in line ("*5 successful Explore runs*") is the trust receipt — no separate list of previously-approved actions inside the modal.
- *Not yet* suppresses the prompt until the counter accrues 5 more successful Explore runs; reverse promotion (user manually switches back to Explore after accepting Execute) resets the counter to 0 per §6.10.

**Portal run surfaces** (customer-facing):
- Customer-initiated Workflow runs always use agency-configured defaults (resolved server-side — customer cannot switch modes).
- This is a conservative posture: agency owners control exposure to their customers.

### 6.9 Mode persistence per (user, agent, subaccount)

Persistence is stored in `user_agent_safety_mode_preferences` (DB-backed, not localStorage). Rationale: user might log in from multiple devices; preferences follow the user, not the device.

Resolution order (as in §6.6):
1. Delegation inheritance (parent run's safety mode)
2. Explicit request override
3. Top-level scheduled → Execute
4. User preference for this (user, agent, subaccount)
5. Agent default

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

Emit `run.safety_mode.selected` at run creation with `{runId, agentId, subaccountId, userId, resolvedSafetyMode, resolutionReason}` where `resolutionReason` ∈ `{explicit_request, scheduled, user_preference, agent_default}` and `resolvedSafetyMode` ∈ `{'explore', 'execute'}`. Drives analytics on:
- What percentage of new agents ever get promoted to Execute?
- Which agents have the highest Execute adoption?
- Which agents' promote prompts get declined most?

Event registers in `server/lib/tracing.ts` alongside other run-lifecycle events.

### 6.12 Edge cases

1. **Concurrent runs in different modes.** User has two conversations open with the same agent against the same subaccount: one in Explore, one in Execute. Both should work correctly. Mode is per-run, not per-agent-subaccount pairing.
2. **Agent config change mid-conversation.** Admin changes agent's `default_safety_mode` from Explore → Execute. Active conversations retain their mode; new conversations use the new default.
3. **Subaccount deletion.** Cascade delete on `user_agent_safety_mode_preferences` via FK `ON DELETE CASCADE`.
4. **Skill added with missing `side_effects` frontmatter.** Defaults to `true`. Runs pause for review in Explore Mode, erring on safe. Audit and annotate.
5. **Empty `user_agent_safety_mode_preferences` after schema deploy.** Pre-launch state; all users default to agent-level default. No backfill required.

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

One migration (`0206_heartbeat_activity_gate.sql`):

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

-- Track tick state:
--   last_tick_evaluated_at: every gate evaluation (run OR skip) updates this. Used as the
--     event-delta cursor in Rule 1 and as the "since last tick" reference in §7.7 queries.
--   last_meaningful_tick_at: only meaningful runs update this (see §12.17 for the definition
--     of "meaningful" that architect pass pins). Used by Rule 2 + Rule 4.
--   ticks_since_last_meaningful_run: monotonically incremented on skip, reset on meaningful
--     run. Duplicates (count of skipped ticks since last_meaningful_tick_at) but cheap to
--     maintain and avoids a count(*) on gate telemetry during dispatch.
ALTER TABLE subaccount_agents
  ADD COLUMN last_tick_evaluated_at timestamptz NULL,
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

**Rule 2 — Time-since-last-meaningful-output (with first-tick branch)**

```
last_meaningful_tick_at IS NULL           # first tick ever — always run to establish baseline
  OR
ticks_since_last_meaningful_run >= heartbeat_min_ticks_before_mandatory_run
```

Prevents permanent silence. If we've been skipping for 6 ticks (24h at 4h cadence), force a run on the next tick to check state regardless of delta. The first-tick branch keeps the §7.10 edge-1 behaviour ("always run first tick") mechanically derivable from the rule, rather than an exception layered on top.

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
  lastTickEvaluatedAt: Date | null;
  lastMeaningfulTickAt: Date | null;
  ticksSinceLastMeaningfulRun: number;
  config: {
    eventDeltaThreshold: number;
    minTicksBeforeMandatoryRun: number;
  };
}

type HeartbeatGateReason =
  | 'event_delta'
  | 'time_threshold'
  | 'explicit_trigger'
  | 'state_flag'
  | 'no_signal'
  | 'gate_error';

interface HeartbeatGateDecision {
  shouldRun: boolean;
  reason: HeartbeatGateReason;
  signalsEvaluated: {
    newEventCount: number;
    ticksSinceLastMeaningfulRun: number;
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
3. Handler loads gate state from `subaccount_agents` — specifically `last_tick_evaluated_at`, `last_meaningful_tick_at`, and `ticks_since_last_meaningful_run` for the `(agent_id, subaccount_id)` pair.
4. If `heartbeat_activity_gate_enabled = false` → dispatch as today (no tick-state updates, no gate call).
5. If enabled → build `HeartbeatGateInput` from the loaded state + resolved config, then call `evaluateHeartbeatGate`:

   ```typescript
   await evaluateHeartbeatGate({
     agentId,
     subaccountId,
     lastTickEvaluatedAt: subaccountAgent.lastTickEvaluatedAt,
     lastMeaningfulTickAt: subaccountAgent.lastMeaningfulTickAt,
     ticksSinceLastMeaningfulRun: subaccountAgent.ticksSinceLastMeaningfulRun,
     config: {
       eventDeltaThreshold: resolvedConfig.eventDeltaThreshold,
       minTicksBeforeMandatoryRun: resolvedConfig.minTicksBeforeMandatoryRun,
     },
   });
   ```

6. If decision is `shouldRun: true` → dispatch. Update `last_tick_evaluated_at = now()` in the same transaction that enqueues the run. When the dispatched run subsequently produces "meaningful" output (definition deferred to architect per §12.17; recommendation: `status='completed'` AND at least one action proposed OR memory block written), the run-completion hook updates `last_meaningful_tick_at = now()` and resets `ticks_since_last_meaningful_run = 0` on `subaccount_agents`.
7. If decision is `shouldRun: false` → emit `heartbeat.tick.gated` telemetry, update `last_tick_evaluated_at = now()`, increment `ticks_since_last_meaningful_run += 1`, return.

**Ownership of `last_meaningful_tick_at` / counter-reset writes.** The recommendation is to site these writes alongside the existing `agent_runs.completed_at` write — `server/services/agentRunFinalizationService.ts` is the candidate hook (it already handles terminal-state transitions for agent runs; see its docblock). Architect confirms during plan decomposition (see §12.17); if a different completion hook is used in the heartbeat-originated path, name it in the plan.

The gate adds one DB-read-only service call before dispatch. Expected latency: <50ms.

### 7.7 Portfolio Health Agent specifics

Define the per-agent event-source list. For Portfolio Health:

| Signal | Source | Query shape |
|---|---|---|
| New memory blocks | `memory_blocks` | `count(*) where subaccount_id = ? and created_at > last_tick_evaluated_at` |
| Onboarding state changes | `subaccount_onboarding_state` | `count(*) where subaccount_id = ? and updated_at > last_tick_evaluated_at` |
| Failed agent runs | `agent_runs` | `count(*) where subaccount_id = ? and status = 'failed' and created_at > last_tick_evaluated_at` |
| Integration errors | `connections` | `count(*) where subaccount_id = ? and status = 'error' and updated_at > last_tick_evaluated_at` |
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
    ticksSinceLastMeaningfulRun: number,
    explicitTriggerQueued: boolean,
    stateFlagSet: boolean,
  },
  latencyMs: number,
}
```

Register in `server/lib/tracing.ts`.

Operator dashboard (future work, not in v1): query this event type for a given agent to see skip rate over time, which rules drive runs vs skips, and whether thresholds need tuning.

### 7.9 UI surface

Locked by the mockup pass (see §3a.2). Mockup: [10 agent settings](../prototypes/riley-observations/10-agent-config-page.html).

**New field on the EXISTING Agent Edit page, not a new page.** Slots into the existing `AdminAgentEditPage.tsx` → "Schedule & Concurrency" section (existing heading at ~line 1410; existing heartbeat fields at ~lines 1420–1480). Builder session must `Edit` this file, not `Write` a new one.

- **Toggle:** *"Skip ticks with no activity"* (maps to `heartbeat_activity_gate_enabled`).
- **Help text:** *"Only runs when something's changed — prevents unnecessary cost."*

**Numeric thresholds are NOT exposed as per-agent form fields in v1.** The two columns (`heartbeat_event_delta_threshold`, `heartbeat_min_ticks_before_mandatory_run`) remain in the schema with their default values (3 and 6) and are used internally by the gate's rule evaluation (§7.4). Per-agent tuning UI is deferred — if operational data after rollout shows individual agents need different thresholds, the thresholds re-surface on a future admin observability page. In v1, tuning happens at the schema-default level (migration + seed) if it happens at all. The rule-inventory help text (*"more than 3 new events since last tick…"*) is dropped — gate logic is internal.

**Historical gate activity (skip rate over time, per-tick decisions, latency distribution)** is NOT rendered on the Agent Edit page. That observability lives in the tracing sink (§7.8) and surfaces — if at all — on a future admin observability page. No KPI tile, no sparkline, no "last decision: skipped (no_signal)" inline state on the form.

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
  contextPressure: number,            // totalTokens / contextBudget, 0..1; when contextBudget = 0
                                      // (budget unknown — see §8.7 edge 3), contextPressure = 0
                                      // AND `context_pressure_unknown` appears in gapFlags.

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
- `context_pressure_unknown` — `contextBudget` could not be resolved (see §8.7 edge 3)
- `workspace_memory_truncated` — workspace memory exceeded the injection budget and was truncated (see §8.7 edge 4)
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
3. **Model context window unknown.** If `contextBudget` can't be resolved, set `contextBudget = 0`, set `contextPressure = 0`, and include `context_pressure_unknown` in `gapFlags`. Consumers that filter on `contextPressure > 0.9` therefore never fire on unknown-budget runs (intentional — no signal is better than a false positive).
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

## 9a. Contracts

Per `docs/spec-authoring-checklist.md §3`, every data shape crossing a service / parser / persistence boundary is pinned here with Name, Type, Producer, Consumer, Nullability, and Example. Detailed schemas remain inline in the per-Part sections above; this table is the single source of truth for the boundary shapes.

| Name | Type | Producer | Consumer | Nullability / defaults | Example |
|---|---|---|---|---|---|
| `InvokeAutomationStep` | TypeScript discriminated union member in the Workflow DSL (see §5.3) | Workflow author (authoring UI) → stored in the Workflow definition JSON on `workflow_templates` / `workflow_runs` | `workflowEngineService.ts` step dispatcher (post-rename) | `kind` required; `outputMapping`/`timeoutSeconds`/`retryPolicy`/`gateLevel` optional with documented defaults | `{ kind: 'invoke_automation', automationId: 'uuid-a', inputMapping: { to: '{{ run.input.email }}', subject: 'Hi' }, gateLevel: 'review' }` |
| `workflow.step.automation.dispatched` | Tracing event registered in `server/lib/tracing.ts` (see §5.9) | `workflowEngineService.ts` at the moment the webhook fetch is initiated | Tracing sink / operator observability queries | All fields required except optional ones per the type; `subaccountId` nullable for org-scoped runs | `{ eventType: 'workflow.step.automation.dispatched', runId: 'r-1', workflowId: 'w-1', stepId: 's-1', automationId: 'a-1', automationEngineId: 'e-1', engineType: 'make', subaccountId: 'sa-1', orgId: 'o-1', timestamp: '2026-04-22T21:45:51Z' }` |
| `workflow.step.automation.completed` | Tracing event (see §5.9) | `workflowEngineService.ts` after the step reaches a terminal outcome (dispatched-and-returned OR pre-dispatch failure) | Tracing sink / operator queries | `httpStatus` / `responseSizeBytes` optional (absent on `timeout`, `network_error`, `missing_connection`, `automation_not_found`, `automation_scope_mismatch`, `automation_composition_invalid`, `input_validation_failed`); status enum per §5.9 — every terminal outcome appears. Invariant: `workflow.step.automation.dispatched` fires iff the step reached successful pre-dispatch resolution; pre-dispatch failures emit ONLY the completed event. Authoring-time rejections (`workflow_composition_invalid`) never reach this event path. | `{ eventType: 'workflow.step.automation.completed', runId: 'r-1', workflowId: 'w-1', stepId: 's-1', automationId: 'a-1', status: 'ok', httpStatus: 200, latencyMs: 842, responseSizeBytes: 1240, timestamp: '2026-04-22T21:45:51Z' }` |
| `automations.side_effects` / `automations.idempotent` | Columns on `automations` table (see §5.4a) | Automation author (admin UI) → migration `0203_rename_processes_to_automations.sql` adds the columns with the rename | `resolveEffectiveGate` (gate default); Workflow step dispatcher (retry posture); Workflow authoring UI (warning on non-idempotent retry) | `side_effects` NOT NULL, defaults to `'unknown'`; `idempotent` NOT NULL, defaults to `false`. Values constrained to the §5.4a enums. | `{ side_effects: 'mutating', idempotent: false }` |
| `UserAgentSafetyModePreference` row | `user_agent_safety_mode_preferences` table row (see §6.3) | `userAgentSafetyModePreferencesService` on run completion | Run-creation resolver (`resolveSafetyMode` in §6.6) | `subaccount_id` nullable; `promoted_to_execute_at` nullable; all others NOT NULL | `{ id: 'pref-1', organisation_id: 'o-1', user_id: 'u-1', agent_id: 'a-1', subaccount_id: 'sa-1', last_successful_mode: 'explore', successful_explore_runs: 3, promoted_to_execute_at: null, updated_at: '2026-04-22T21:45:51Z' }` |
| `HeartbeatGateInput` | TypeScript value (see §7.5) | `heartbeatActivityGateService.ts` dispatch handler | `evaluateHeartbeatGate` pure function | `lastTickEvaluatedAt` / `lastMeaningfulTickAt` nullable (first-tick) | `{ agentId: 'a-1', subaccountId: 'sa-1', lastTickEvaluatedAt: null, lastMeaningfulTickAt: null, ticksSinceLastMeaningfulRun: 0, config: { eventDeltaThreshold: 3, minTicksBeforeMandatoryRun: 6 } }` |
| `HeartbeatGateDecision` | TypeScript value (see §7.5) | `evaluateHeartbeatGate` | Dispatch handler + `heartbeat.tick.gated` telemetry emitter | All fields required; `reason` enum includes `gate_error`. Invariant: `reason: 'no_signal'` ⇒ `shouldRun: false`. Every other reason may pair with either `shouldRun: true` (`event_delta` / `time_threshold` / `explicit_trigger` / `state_flag` / `gate_error`) or `shouldRun: false` (never, for those — `gate_error` always runs per §7.5 error posture). | `{ shouldRun: false, reason: 'no_signal', signalsEvaluated: { newEventCount: 0, ticksSinceLastMeaningfulRun: 2, explicitTriggerQueued: false, stateFlagSet: false }, latencyMs: 12 }` |
| `heartbeat.tick.gated` | Tracing event (see §7.8) | `heartbeatActivityGateService.ts` after decision | Tracing sink | All fields required | `{ eventType: 'heartbeat.tick.gated', agentId: 'a-1', subaccountId: 'sa-1', timestamp: '2026-04-22T21:45:51Z', shouldRun: true, reason: 'event_delta', signalsEvaluated: { newEventCount: 5, ticksSinceLastMeaningfulRun: 1, explicitTriggerQueued: false, stateFlagSet: false }, latencyMs: 12 }` |
| `context.assembly.complete` | Tracing event (see §8.2) | `agentExecutionService.ts` at end of context assembly | Tracing sink | `subaccountId` nullable; `gapFlags` can be empty array; flag values constrained to the §8.4 enum | `{ eventType: 'context.assembly.complete', runId: 'r-1', agentId: 'a-1', subaccountId: 'sa-1', orgId: 'o-1', timestamp: '2026-04-22T21:45:51Z', latencyMs: 120, totalTokens: 8500, contextBudget: 200000, contextPressure: 0.0425, memoryBlockCount: 12, workspaceMemoryLength: 320, gapFlags: [] }` |
| `resolveEffectiveGate(subject, context)` | Pure function signature in `server/services/gateResolutionServicePure.ts` (see §6.5) | Both `agentExecutionService.ts` (for skill invocations) and `workflowEngineService.ts` (for `invoke_automation` steps) | Callers who need to know whether a side-effecting action must pause for review | `subject` is a discriminated union `{ kind: 'skill', skill } \| { kind: 'invoke_automation', step }`; `context.safetyMode` required | Call: `resolveEffectiveGate({ kind: 'invoke_automation', step: stepRow }, { safetyMode: 'explore', agentId, subaccountId })` → returns `'review'` |
| `run.safety_mode.selected` | Tracing event (see §6.11) | Run-creation resolver (`resolveSafetyMode` in §6.6) at run-creation time | Tracing sink / adoption-analytics queries | `subaccountId` nullable; `resolvedSafetyMode` ∈ `{'explore', 'execute'}`; `resolutionReason` ∈ `{explicit_request, scheduled, user_preference, agent_default}` | `{ eventType: 'run.safety_mode.selected', runId: 'r-1', agentId: 'a-1', subaccountId: 'sa-1', userId: 'u-1', resolvedSafetyMode: 'explore', resolutionReason: 'agent_default' }` |

---

## 9b. Deferred Items

Per `docs/spec-authoring-checklist.md §7`, every prose mention of "deferred", "later", "v2", "not in v1", "future", or "follow-up" appears here with a one-line rationale.

**Run-mode / Explore-Execute Part 3 deferrals:**
- **Portal mode field selection.** §6.8 defers naming the `subaccount_agents` field that drives portal run mode. Architect must resolve before Part 3 migration lands; see §12.13.
- **`side_effects` runtime storage schema.** §6.4 defers the DB vs JSONB placement decision. Architect pass; see §12.22.
- **Promote-to-Execute risk posture.** §6.10 defers the question of whether a single click-through is safe enough, or whether typing "Execute" / time-windowed trust / re-selection is needed. Decision gated on post-launch incident rate.

**Workflow-composition Part 2 deferrals:**
- **Cost estimation for Workflows containing Automation steps.** §5.10 edge 5 — the existing `workflow_estimate_cost` skill doesn't incorporate external engine cost; v2 follow-up.
- **Automation-to-Workflow composition.** §5.2 out-of-scope — callback-based composition where an Automation triggers a Workflow is doable with existing webhook primitives; not part of this spec.
- **UI picker / Studio panel redesign for the new step type.** §5.2 out-of-scope — spec pins the contract; Studio UI is an architect-plan detail.
- **Output-schema validator format.** §5.4 / §5.5 defer the validator choice and the JSON-Schema strictness posture. Architect pass; see §12.23.
- **Per-row timeout override column on `automations`.** §5.3 defers whether to add `automations.timeout_seconds` or keep the service-level constant. Architect pass.

**Heartbeat Part 4 deferrals:**
- **LLM-based heartbeat signal detection.** §7.2 / §1.2 — deterministic rules only in v1; LLM layer considered only if deterministic rules prove insufficient.
- **Rule 3 "Check now" trigger mechanism.** §7.4 / §12.16 — either add the "Check now" surface to this spec or drop Rule 3 from v1. Recommendation: drop Rule 3 from v1. Architect decides.
- **"Meaningful" output definition for `last_meaningful_tick_at` update.** §7.6 / §12.17 — recommendation: `status='completed'` AND at least one action proposed OR memory block written. Architect confirms before coding.
- **Operator dashboard for gate telemetry.** §7.8 — future work; v1 has no UI.
- **Agency-admin exposure of the heartbeat gate toggle.** §7.9 — system-admin only in v1; agency-admin after operational validation.

**Context-assembly telemetry Part 5 deferrals (all §8.3):**
- **Per-phase token breakdown.** Briefing / beliefs / memory / known-entities separately.
- **Per-source memory attribution** (which retrievers contributed).
- **Full authorised-skills / available-skills arrays.**
- **Per-sub-phase latencies.**
- **Operator UI for `context.assembly.complete` queries.** §8.5 step 5 — query via existing observability tooling in v1.

**Naming-pass Part 1 deferrals:**
- **`processedResources` / `dropZoneProcessingLog` renaming.** §1.2 / §4.6 — unrelated to the `processes` primitive; explicitly left as-is.
- **External-provider `engineType` value strings** (`n8n`, `ghl`, `make`, `zapier`, `custom_webhook`) — external-provider identifiers; our wrapper concept changes name, the providers don't (§4.6).
- **Review logs and historical artefacts** — §4.8 explicitly leaves as-is because they reference a primitive that existed at the time; rewriting history is churn with no benefit.

**Cross-cutting / pipeline deferrals:**
- **Next-wave UX.** §1.2 — new onboarding flow, guided first-run, starter-workflow library, outcome-first navigation. Tracked as the next wave.
- **Data sandbox** (duplicated DBs, synthetic data). §1.2 — Explore Mode is the substitute in v1.
- **OpenClaw substrate work.** §1.2 — covered in `openclaw-strategic-analysis.md`, not this spec.
- **Automation + Workflow versioning and marketplace-readiness.** Full lifecycle ownership for shared/partner/BYO capabilities — immutable execution versions pinned on runs, opt-in upgrade paths, cross-tenant isolation, partner-provided capability ingestion, marketplace distribution primitives. Pre-launch posture (§2) + §1.5 principle 3 (Workflows are the primary user construct) mean v1 does not need multi-tenant partner publishing. The §5.10a composition constraints are the forward-compatible foundation: today's "depth = 1, no recursive Workflow calls" ruleset is what a future multi-party graph will inherit from. Re-evaluate when (a) an external party needs to publish capabilities the platform consumes, OR (b) in-place upgrades to a shared Automation cause a customer-visible break — whichever surfaces first. No v1 migration or schema accommodation beyond what §5.4a and §5.10a already declare.

Architect pass reviews this list at plan time; any item that turns out to block v1 gets promoted out of Deferred Items and into the phase it belongs in.

---

## 10. Data migration plan

### 10.1 Ordered migration list

Every forward migration below ships alongside a paired down-migration file under `migrations/_down/` (matching the codebase's existing reversibility pattern). "Reversible" means the `_down/` file is authored and green-on-rerun; `git revert` alone does not execute DDL.

| # | Forward file | Down file | Purpose |
|---|---|---|---|
| 1 | `0202_rename_workflow_runs_to_flow_runs.sql` | `_down/0202_rename_workflow_runs_to_flow_runs.sql` | Clear `workflow*` namespace. Rename internal flow stack. |
| 2 | `0203_rename_processes_to_automations.sql` | `_down/0203_rename_processes_to_automations.sql` | `processes → automations`, `workflow_engines → automation_engines`, all child tables and columns. |
| 3 | `0204_rename_playbooks_to_workflows.sql` | `_down/0204_rename_playbooks_to_workflows.sql` | `playbooks → workflows`, all child tables and columns, cross-table `playbook_*` columns. |
| 4 | `0205_explore_execute_mode.sql` | `_down/0205_explore_execute_mode.sql` | See §6.3. New `safety_mode` column on renamed `workflow_runs` (distinct from the pre-existing `run_mode` column; see §12.24), new `safety_mode` on `agent_runs`, new `default_safety_mode` on `agents`, new `user_agent_safety_mode_preferences` table with RLS policy + `rlsProtectedTables.ts` manifest entry. |
| 5 | `0206_heartbeat_activity_gate.sql` | `_down/0206_heartbeat_activity_gate.sql` | Heartbeat gate columns on `agents` + `subaccount_agents`, `last_tick_evaluated_at` + `last_meaningful_tick_at` tracking columns. |

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
2. Prepare a rebase-script committed under `scripts/rebase-post-riley-rename.sh` (new file — tooling artefact scoped to this PR, not a runtime script):
   - Fetches main
   - Merges main into the current branch
   - Runs `scripts/codemod-riley-rename.ts` (new file — tooling artefact scoped to this PR) which does:
     - Replace `playbook_` → `workflow_` in SQL strings, TypeScript imports, references
     - Replace `Playbook` → `Workflow` in TypeScript type usages
     - Replace `/api/playbooks` → `/api/workflows` in route strings
     - Replace `processes` → `automations` (table references)
     - Replace `ProcessService` → `AutomationService`
     - (Codemod rules defined in the scripts file; conservative — only replaces where context indicates schema/API/UI reference)
3. After merge, open-PR owners run the rebase script on their branch, resolve any remaining conflicts manually, and force-push.
4. For 72 hours post-merge, engineering team prioritises unblocking any branch that can't auto-rebase.

**Inventory note.** Both `scripts/rebase-post-riley-rename.sh` and `scripts/codemod-riley-rename.ts` are new files committed as part of Part 1's PR. They are one-time tooling — not retained or scheduled. List them explicitly alongside the Part 1 file-inventory tables (§4.3 / §4.6 / §4.8) when the architect decomposes the plan.

### 10.5 Rollback posture

- If the PR merges and something breaks: `git revert` the merge commit AND run the five paired `_down/` migrations in reverse order (5 → 4 → 3 → 2 → 1). `git revert` on its own does not execute DDL; the `_down/` files are the actual rollback mechanism.
- Post-revert, re-run tests; assert clean rollback.
- Post-mortem before re-attempting.

Rollback window: up to 48h post-merge. After that, any downstream work has made rollback complex; fix-forward instead.

---

## 11. Rollout plan + test strategy

### 11.1 Build waves (from brief §9)

| Wave | Content | Gating |
|------|---|---|
| **W0** | Part 6 (agent-decomposition rule, §9) | No spec. Ship immediately. |
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
- Unit (pure-function): `invoke_automation` step-dispatch logic in `invokeAutomationStepPure.ts` — input mapping resolution, output mapping projection, scope-matching rule, error-code mapping, gate-resolution branch. Test matrix covers every `error_code` listed in §5.7 and §5.8. No HTTP layer involved — the webhook fetch is mocked at the service boundary (a function-level stub), not via an HTTP-level mocking library. This follows the codebase's testing posture (static gates + pure-function unit tests; no MSW / supertest for the app's own surfaces).
- Failure-mode coverage (part of the same unit suite): timeout, 5xx response, input-schema mismatch, missing connection, automation not found, scope mismatch.
- Explore-Mode interaction (unit): `resolveEffectiveGate` called with a `{ kind: 'invoke_automation' }` subject under Explore-mode context returns `'review'`. This is one case in the Part 3 gate matrix (below) and does not require a new test harness.

**Part 3 (Explore / Execute Mode):**
- Unit (pure-function): `server/services/gateResolutionServicePure.test.ts` — test matrix against `resolveEffectiveGate` exported from `server/services/gateResolutionServicePure.ts` (extracted in §6.5). Every combination of `context.safetyMode` × subject kind (`skill` vs `invoke_automation`) × `skill.sideEffects` × `skill.defaultGateLevel`. Confirms the `invoke_automation` branch always treats the step as side-effecting and that `'block'` on a skill wins over every other rule.
- Unit (pure-function): `server/services/resolveSafetyModeServicePure.test.ts` — test matrix against `resolveSafetyMode` (§6.6). Covers: explicit override wins; delegated parent inheritance wins over scheduled; top-level scheduled → execute; user preference fallback; agent default last.
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
8. **Template-expression renderer module citation.** The `invoke_automation` step uses the existing `{{ steps.X.output.Y }}` template form (§5.3). Architect cites the exact renderer module in `server/lib/playbook/` (post-rename `server/lib/workflow/`) that `invoke_automation` reuses — no parallel renderer is introduced.
9. **Output-schema strictness.** Does the current Automation (`processes`) output-schema validation reject extra fields, or permit them? Architect confirms and ensures composition step matches.
10. **Engine-degraded-mode behaviour.** What does the current process-execution path do when an external engine is offline? Architect confirms and ensures `invoke_automation` step inherits that behaviour.

### 12.3 Part 3 (Explore / Execute Mode)

11. **Exact sidebar component/icon for mode indicator.** Architect chooses component primitives.
12. **`side_effects` audit process.** Architect defines the process for auditing all 152 skills and assigning `side_effects: true/false`. Output: a work log under `tasks/builds/riley-observations/skills-side-effects-audit.md`.
13. **Portal mode behaviour — naming the field.** §6.8 says "agency-configured defaults" but does not name the field. Architect must either (a) identify the existing `subaccount_agents` column that drives portal-facing run mode, OR (b) add a new column (e.g. `subaccount_agents.portal_default_safety_mode text NOT NULL DEFAULT 'explore'`) to migration `0205_explore_execute_mode.sql` and inventory it in §4.8. Non-negotiable before Part 3 ships.
14. **Supervised-mode removal — decided; architect confirms call-site migration.** §6.8 decides the Supervised checkbox is removed. Architect audits all call sites of `runMode: 'supervised' | 'auto'` in the existing `playbook_runs.run_mode` column and confirms the migration path leaves no orphaned references. NOT an open decision — just an audit step.
22. **`side_effects` runtime storage — schema decision.** §6.4 proposes `side_effects` as skill-markdown frontmatter, but runtime skills are DB-backed via `system_skills.definition` JSONB. Architect picks one of: (a) add `side_effects boolean NOT NULL DEFAULT true` as a top-level column on `system_skills` in migration `0205` with backfill from the markdown audit, OR (b) require the `definition` JSONB to contain `side_effects` and add a CI gate that validates it, OR (c) keep frontmatter-only and treat `system_skills` as regenerated from markdown at seed time. Recommendation: (a) — top-level column enables fast reads during gate resolution without JSONB unpacking on every dispatch. Non-negotiable before Part 3 ships; name the mechanism before coding.
23. **`input_schema` / `output_schema` validator and format.** §5.4 / §5.5 claim runtime validation against the `processes.input_schema` / `output_schema` `text` columns. Architect picks the validator (ajv / zod / custom) and the schema format (JSON Schema vs plain JSON-Schema-Lite) and cites it in the spec. Until resolved, the spec's validation claim is best-effort only.

### 12.4 Part 4 (heartbeat gate)

15. **Event-source table list per agent.** §7.7 defines for Portfolio Health; architect audits other heartbeat-enabled agents (if any) and defines per-agent source mappings.
16. **"Check now" trigger plumbing OR Rule 3 removal.** Rule 3 in §7.4 depends on a "Check now" button/API that does NOT exist in the current codebase. Architect picks one of: (a) add the "Check now" surface to Part 4's Files-to-change list with a specific mechanism (e.g. `subaccount_agents.check_now_requested_at timestamptz NULL` column + `POST /api/subaccount-agents/:id/check-now` route + admin UI button), OR (b) remove Rule 3 from v1, shipping the gate with only 3 rules. Recommendation: (b) for v1 — defer "Check now" as a post-launch enhancement.
17. **`last_meaningful_tick_at` update site AND "meaningful" definition.** §7.6 resets `ticks_since_last_meaningful_run` when a run produces "meaningful" output. Architect pins the exact definition and update hook. Recommendation: "meaningful" = agent run completed with `status = 'completed'` AND either proposed at least one action OR wrote at least one memory block. Non-negotiable before Part 4 ships.

### 12.5 Part 5 (telemetry)

18. **Tracing sink write path.** What's the current write latency of `tracing.ts`? Is the <5ms target realistic? Architect measures and confirms or proposes mitigation.
19. **`gapFlags` evaluation logic.** How does the assembler detect each flag? Architect confirms each has a computable source and defines the check per flag.

### 12.6 Cross-cutting

20. **Spec-review iteration.** Does this spec go through `spec-reviewer` before architect? Default per CLAUDE.md: yes. Architect confirms that review iteration completed before plan-writing starts.
21. **Plan decomposition.** Does architect produce one plan covering all 6 Parts, or six separate plans? Recommendation: one plan per Wave (W1 combined Part 1+2 plan; W2–W4 each a plan). Architect confirms.
24. **`safety_mode` vs pre-existing `run_mode` reconciliation.** Part 3 introduces `safety_mode` (`explore|execute`) as a new column to avoid overloading the pre-existing `workflow_runs.run_mode` (`auto|supervised|background|bulk` — from migration 0086). Architect confirms this split is correct OR proposes an alternative: (a) migrate the existing `run_mode` to hold the new enum and record execution-style elsewhere, or (b) add a mapping table. Default: keep the split. Non-negotiable decision captured before Part 3 ships.

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
| Run safety mode (NEW `safety_mode` column, distinct from legacy `run_mode` enum) | (no previous dedicated dimension — the old Supervised checkbox was subsumed into Explore) | Explore Mode / Execute Mode | Yes |
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
