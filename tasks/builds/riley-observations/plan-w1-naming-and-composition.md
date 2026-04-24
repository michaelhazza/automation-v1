# Wave 1 — Riley Observations — Naming pass + Workflows-calling-Automations

_Plan for `docs/riley-observations-dev-spec.md` §4 (Part 1 — naming) + §5 (Part 2 — composition). One PR, multiple commits._

## Contents

1. Header + orientation
2. Architect decisions
3. Migration ordering
4. File inventory — Edit vs Write
5. Mockup citations
6. Commit boundaries
7. Test strategy
8. Separable audit deliverables
9. Reviewer checklist

---

## 1. Header + orientation

Wave 1 ships on a single PR the two Parts of the Riley Observations spec that together re-anchor the vocabulary of the system: the naming pass (Part 1 / spec §4) and the Workflows-calling-Automations composition (Part 2 / spec §5). The naming pass clears the `workflow*` namespace, renames `processes → automations`, then renames `playbooks → workflows`, as three strictly-ordered commits (§4.1–§4.8). The composition work registers a new `invoke_automation` step type in the Workflow DSL, pins the standardised `AutomationStepError` shape (§5.7), adds the `side_effects` and `idempotent` capability-contract columns to `automations` (§5.4a) in the SAME migration that renames `processes → automations`, and enforces the §5.10a composition constraints at BOTH authoring-time and dispatch-time.

Wave 1 is the largest wave in the spec — every downstream wave depends on its final vocabulary. W2 (Explore/Execute), W3 (context-assembly telemetry), and W4 (heartbeat gate) are all explicitly out of scope here and will each ship on their own PR once this wave lands.

**Explicitly out of scope for this plan (referenced by the spec but deferred per the caller's wave split):**

- Part 3 (Explore / Execute Mode, spec §6) — W2.
- Part 4 (heartbeat activity-gate, spec §7) — W4.
- Part 5 (context-assembly telemetry, spec §8) — W3.
- Part 6 (spec-authoring decomposition rule, spec §9) — W0, a doc edit, not gated on this wave.
- `side_effects` skill audit (§12.12) and `system_skills.side_effects` storage (§12.22) — W2.
- Supervised-mode call-site audit (§12.14) — W2.
- Portal `safety_mode` field naming (§12.13) — W2.
- Rule 3 "Check now" trigger mechanism (§12.16) — W4.
- "Meaningful" output definition for `last_meaningful_tick_at` (§12.17) — W4.
- Cost estimation for Workflows containing Automation steps (§5.10 edge 5) — deferred per §9b.
- Automation-to-Workflow callback composition (§5.2) — deferred per §9b.
- Per-row `timeout_seconds` override column on `automations` (§5.3) — deferred per §9b.

Nothing in Wave 1 introduces a new tenant-scoped table, so the full RLS pipeline (new entry in `rlsProtectedTables.ts`, new route guards beyond the existing `authenticate` + `requirePermission`) is not triggered here. The `invoke_automation` step dispatcher re-uses the existing Workflow-run scope + principal context; the `side_effects` / `idempotent` columns live on the already-RLS-covered `automations` table (formerly `processes`) and inherit that table's existing policy.

## 2. Architect decisions

Four pinned decisions the Sonnet execution session does NOT need to reopen. Each is a single line with one-sentence rationale.

1. **Input / output schema validator — `zod` with best-effort posture.** `automations.input_schema` / `output_schema` stay as `text` columns. At dispatch time, if the column is non-empty, parse with `JSON.parse`, feed through `z.any().parse(...)`-style structural validator compiled from a minimal `{ properties, required, additionalProperties }` subset of JSON Schema. If the column is empty or unparseable, skip validation and proceed (spec §5.4 explicit "best-effort" posture). Rationale: `zod` is already a runtime dep (`package.json:76`); no new vendor dep, no ajv bundle-size cost, no hand-rolled validator. `additionalProperties` default — **permissive (`true`) unless the parsed schema explicitly declares `false`**, matching the spec §5.4 clause "Extra fields are permitted unless the parsed schema declares `additionalProperties: false`." Validator module lives at `server/lib/workflow/invokeAutomationSchemaValidator.ts` (Write) and is the ONLY place `input_schema` / `output_schema` parsing lives; the dispatcher is a thin caller.
2. **Migration numbers — spec-declared `0202 / 0203 / 0204` already taken; renumber at architect pass.** `server/db/schema/index.ts` already exports tables from the "Cached Context Infrastructure Phase 1" migrations claiming slots `0202–0208` and Paperclip Hierarchy's `delegationOutcomes` claiming `0217` (which was "renumbered from 0205 post-merge"). The Riley spec's §10.1 proposed numbers (`0202_rename_workflow_runs_to_flow_runs.sql`, `0203_rename_processes_to_automations.sql`, `0204_rename_playbooks_to_workflows.sql`) must shift to the next-available contiguous triple at the moment the build session branches off `main`. The Sonnet session runs `ls migrations/ | sort | tail` as the first step of Chunk 1 and picks three consecutive numbers above the current max. The spec text does not need to be updated; the plan's migration-ordering section below is the canonical record. **Down-migration files** live under `migrations/_down/` with matching numbers.
3. **Workflow step-type enum — extended in place at `server/lib/playbook/types.ts` (post-rename: `server/lib/workflow/types.ts`).** The existing step-type discriminator lives in the `server/lib/playbook/*` tree (Part 1 Step 3 renames this to `server/lib/workflow/*`). The `invoke_automation` step variant is added to the existing discriminated union rather than a parallel registry. Contract: `kind: 'invoke_automation'` per spec §5.3, with fields pinned in the §5.3 TypeScript example. Authoring-time validator (also under the same tree) gains one additional case in its switch-on-`kind` and rejects unknown `kind` values (§5.10a rule 2). Rationale: one discriminated union, no parallel registry; step discriminator set is the single source of truth at save time.
4. **Template expression renderer — reuse `server/lib/playbook/renderExpression.ts` (post-rename: `server/lib/workflow/renderExpression.ts`); no parallel DSL.** Spec §5.3 / §5.11 / §12.2 item 8 all explicitly require this. The Sonnet session cites the exact file at plan-execution time (grep for `{{` template-literal renderer under `server/lib/playbook/`); the plan pins the directory and the contract. `inputMapping` field values on an `invoke_automation` step are passed through this renderer the same way every other Workflow step's input bindings are — no new expression grammar, no new escape rules, no parallel `handlebars`-style path.

## 3. Migration ordering

Three forward migrations, three paired down-migrations. The ordering is strict per spec §4.2 — Step 3 cannot ship until Step 1 clears the `workflow*` namespace, because `playbook_runs → workflow_runs` collides with the existing `workflow_runs` table until Step 1 moves it out to `flow_runs`.

The spec's migration numbers (`0202 / 0203 / 0204`) are **already taken** on `main` by the "Cached Context Infrastructure Phase 1" work (`server/db/schema/index.ts:216–227`) and Paperclip Hierarchy (which renumbered `0205 → 0217` post-merge, `server/db/schema/index.ts:229–230`). The Sonnet execution session picks the next-available contiguous triple (`ls migrations/ | sort | tail`) at branch-off time, preserving the strict ordering. The rest of this plan refers to the three migrations as **M1 / M2 / M3** to decouple the plan from the specific number picked.

| # | Forward file | Down file | Purpose |
|---|---|---|---|
| **M1** | `XXXX_rename_workflow_runs_to_flow_runs.sql` | `_down/XXXX_rename_workflow_runs_to_flow_runs.sql` | Spec §4.3 Step 1 — clear `workflow*` namespace. Rename `workflow_runs → flow_runs`, `workflow_step_outputs → flow_step_outputs`, rename FKs + indexes. No column semantic changes. |
| **M2** | `YYYY_rename_processes_to_automations.sql` | `_down/YYYY_rename_processes_to_automations.sql` | Spec §4.6 Step 2 — rename `processes → automations`, `process_categories → automation_categories`, `subaccount_process_links → subaccount_automation_links`, `process_connection_mappings → automation_connection_mappings`, `workflow_engines → automation_engines`. **Also adds §5.4a capability-contract columns** — `automations.side_effects text NOT NULL DEFAULT 'unknown'` (enum check `('read_only','mutating','unknown')`) and `automations.idempotent boolean NOT NULL DEFAULT false`. Per spec §5.4a: the capability columns are "introduced by migration 0203 as part of the rename" — they are part of the rename migration, not a separate migration. |
| **M3** | `ZZZZ_rename_playbooks_to_workflows.sql` | `_down/ZZZZ_rename_playbooks_to_workflows.sql` | Spec §4.8 Step 3 — rename `playbook_runs → workflow_runs` (slot cleared by M1), `playbook_step_runs → workflow_step_runs`, `playbook_step_reviews → workflow_step_reviews`, `playbook_templates → workflow_templates`, `playbook_template_versions → workflow_template_versions`, `system_playbook_templates → system_workflow_templates`, `system_playbook_template_versions → system_workflow_template_versions`, `playbook_studio_sessions → workflow_studio_sessions`, `playbook_run_event_sequences → workflow_run_event_sequences`. Rename cross-table `playbook_*` columns on `memory_blocks`, `modules`, `subaccount_onboarding_state`, `portal_briefs`, `agent_runs`, `onboarding_bundle_configs` per the enumeration in §4 file inventory. Rename FKs + indexes. |

**Ordering invariants (pre-merge CI gate):**

- M1 must run before M3 (namespace collision). This is a Postgres-level hard constraint — M3 will error on `ALTER TABLE playbook_runs RENAME TO workflow_runs` if `workflow_runs` still exists.
- M2 is independent of M1 and M3 at the DDL level (different namespaces), but the plan lands it as commit 2 of 3 for the reason spec §4.1 gives: the intermediate state after M2-but-before-M3 is "Automations are external; Playbooks are native" which is coherent-but-awkward. Landing all three on one PR keeps reviewers focused on the end state.
- Each forward migration has a matching `_down/` file authored alongside it (not retrofitted). Rollback posture per spec §10.5.

**Pre-merge verification sequence** (spec §10.3 + this plan's Chunk-3 acceptance criteria):

1. Drop dev DB → apply all three migrations in order → `drizzle-kit introspect` diff against the renamed schema files is clean.
2. `_down/M3` → `_down/M2` → `_down/M1` runs cleanly against a forward-migrated DB.
3. Forward and down are idempotent on re-apply to the same DB state.
4. `npm run build` (`tsc -p server/tsconfig.json && vite build`) passes.
5. `npm run test:unit` passes (composition pure-function suite added under Part 2 — see Chunk 5 and §7 below).

## 4. File inventory — Edit vs Write

Every file this wave touches, labeled `Edit` (modify in place) or `Write` (new file). Grouped by commit (M1 / M2 / M3 / Part 2). Post-rename path names are used wherever the plan runs after the rename has landed on the branch.

### 4.1 M1 — Rename internal flow stack (`workflow_runs → flow_runs`)

Purely internal; no user-visible surfaces; no permission or route renames.

| Path | Action | Notes |
|---|---|---|
| `migrations/XXXX_rename_workflow_runs_to_flow_runs.sql` | Write | `ALTER TABLE workflow_runs RENAME TO flow_runs`; `ALTER TABLE workflow_step_outputs RENAME TO flow_step_outputs`; rename FKs + indexes referencing old names. |
| `migrations/_down/XXXX_rename_workflow_runs_to_flow_runs.sql` | Write | Reverse direction; same shape. |
| `server/db/schema/workflowRuns.ts` | Edit | Rename file to `flowRuns.ts` (git-mv) and rename all exported table/type symbols (`workflowRuns → flowRuns`, `workflowStepOutputs → flowStepOutputs`, `WorkflowRun → FlowRun`, `NewWorkflowRun → NewFlowRun`, `WorkflowStepOutput → FlowStepOutput`, `NewWorkflowStepOutput → NewFlowStepOutput`, `WorkflowRunStatus → FlowRunStatus`, `WorkflowCheckpoint → FlowCheckpoint`). |
| `server/db/schema/index.ts` | Edit | Update the barrel re-export line for the renamed file. |
| `server/db/schema/clientPulseCanonicalTables.ts` | Edit | Inline rename `canonicalWorkflowDefinitions → canonicalFlowDefinitions` at line 182 (cited in spec §4.3). |
| `server/types/workflow.ts` | Edit | Rename file to `server/types/flow.ts` (git-mv); rename type exports (`WorkflowDefinition → FlowDefinition`, etc.). |
| `server/services/workflowExecutorService.ts` | Edit | Rename file to `flowExecutorService.ts` (git-mv); update internal references. |
| `server/services/actionService.ts` | Edit | Update imports + call sites (consumes `flowExecutorService`). |
| `server/services/scanIntegrationFingerprintsService.ts` | Edit | Update imports + call sites. |
| `server/services/queueService.ts` | Edit | Update imports + call sites. |
| `server/services/regressionCaptureServicePure.ts` | Edit | Update imports + call sites (surfaced by grep of `workflowExecutorService` consumers). |
| `server/services/executionLayerService.ts` | Edit | Update imports + call sites. |
| `server/services/middleware/proposeAction.ts` | Edit | Update imports + call sites. |
| `server/services/cachedContextOrchestrator.ts` | Edit | Update imports + call sites. |
| `server/services/configUpdateOrganisationService.ts` | Edit | Update imports + call sites. |
| `server/services/reviewService.ts` | Edit | Update imports + call sites. |
| `server/services/clientPulseInterventionContextService.ts` | Edit | Update imports + call sites. |
| `server/services/clientPulseIngestionService.ts` | Edit | Update imports + call sites. |
| `server/services/playbookActionCallExecutor.ts` | Edit | Update imports (renamed during M3 as well — `playbookActionCallExecutor → workflowActionCallExecutor`; for M1 purposes, only the workflow-executor import is touched). |

**Drizzle schema inventory (§12.1.1 resolved here).** The three file renames above (`workflowRuns.ts`, `workflow.ts`, `workflowExecutorService.ts`) are the complete set — `grep -rln 'WorkflowRun\|workflowRuns\|WorkflowDefinition' server/db/schema/` confirms the schema surface is two tables + one derived canonical-tables ref. No other schema file imports from `workflowRuns.ts`.

**Post-M1 verification grep:** `grep -rn 'workflow_runs\|WorkflowRun\|WorkflowDefinition' server/ client/ --include='*.ts' --include='*.tsx'` returns only migration-history files + code-comment references. Zero hits in live schema/service/type/page modules.

### 4.2 M2 — Rename processes → automations (+ §5.4a capability-contract columns)

Adds the two §5.4a columns (`side_effects`, `idempotent`) to the renamed `automations` table as part of the same migration. User-visible rename (permissions, routes, UI labels).

**Schema + migration:**

| Path | Action | Notes |
|---|---|---|
| `migrations/YYYY_rename_processes_to_automations.sql` | Write | `processes → automations`, `process_categories → automation_categories`, `subaccount_process_links → subaccount_automation_links`, `process_connection_mappings → automation_connection_mappings`, `workflow_engines → automation_engines`. Then `ALTER TABLE automations ADD COLUMN side_effects text NOT NULL DEFAULT 'unknown' CHECK (side_effects IN ('read_only','mutating','unknown'))` + `ADD COLUMN idempotent boolean NOT NULL DEFAULT false`. |
| `migrations/_down/YYYY_rename_processes_to_automations.sql` | Write | Drop the two new columns before reversing the renames. |
| `server/db/schema/processes.ts` | Edit | Rename file to `automations.ts` (git-mv); rename exported symbols (`processes → automations`, `Process → Automation`, `NewProcess → NewAutomation`, etc.); add the two new column declarations (`sideEffects`, `idempotent`). |
| `server/db/schema/processCategories.ts` | Edit | Rename file to `automationCategories.ts`; rename exports. |
| `server/db/schema/processConnectionMappings.ts` | Edit | Rename file to `automationConnectionMappings.ts`; rename exports. |
| `server/db/schema/subaccountProcessLinks.ts` | Edit | Rename file to `subaccountAutomationLinks.ts`; rename exports. |
| `server/db/schema/workflowEngines.ts` | Edit | Rename file to `automationEngines.ts`; rename exports (`workflowEngines → automationEngines`, `WorkflowEngine → AutomationEngine`). Note this is distinct from M1's `workflow_runs` rename — `workflow_engines` is the external-engine registry (Make/n8n/Zapier/GHL/custom_webhook) and belongs to the user-facing rename. |
| `server/db/schema/index.ts` | Edit | Update barrel re-exports for each renamed file. |

**Services + routes:**

| Path | Action | Notes |
|---|---|---|
| `server/services/processService.ts` | Edit | Rename file to `automationService.ts`; rename class/function exports. |
| `server/services/processResolutionService.ts` | Edit | Rename file to `automationResolutionService.ts`; rename exports. |
| `server/routes/processes.ts` | Edit | Rename file to `automations.ts`; update route paths from `/api/processes → /api/automations`, `/api/admin/processes → /api/admin/automations`. |
| `server/routes/processConnectionMappings.ts` | Edit | Rename to `automationConnectionMappings.ts`; update paths. |
| `server/routes/systemProcesses.ts` | Edit | Rename to `systemAutomations.ts`; update paths `/api/system/processes → /api/system/automations`. |
| `server/routes/portal.ts` | Edit | Update portal URL `/portal/:subaccountId/processes/:processId → /portal/:subaccountId/automations/:automationId`. |
| `server/index.ts` (route registration) | Edit | Update `registerRoutes` import + registration calls for all three renamed route files. Confirmed pattern: routes are imported and registered one-by-one in `server/index.ts` (§12.1.3 resolved — manual registration, not auto-discovery). |

**Permissions (spec §13.3):**

| Path | Action | Notes |
|---|---|---|
| `server/lib/permissions.ts` | Edit | Rename all `PROCESSES_*` keys to `AUTOMATIONS_*` (8 keys across `ORG_PERMISSIONS` lines 13–32 + `SUBACCOUNT_PERMISSIONS` lines 104–125). Update the `AVAILABLE_PERMISSIONS` metadata array (descriptions + groupName) so human-readable strings swap "Process" → "Automation". |
| Permission seed (§12.1.2 resolved) | Edit | The permission catalogue in `server/lib/permissions.ts` is the SEED source — no separate SQL seed table. Enum values are consumed at runtime via imports; the migration does not touch permission rows. |

**UI pages (§12.1.6 partial — process-related pages):**

| Path | Action | Notes |
|---|---|---|
| `client/src/pages/TasksPage.tsx` | Edit | Rename to `AutomationsPage.tsx` (lazy-loaded as `ProcessesPage` currently per spec §3.1). Update header strings, route wiring. |
| `client/src/pages/AdminTasksPage.tsx` | Edit | Rename to `AdminAutomationsPage.tsx`. Update strings. |
| `client/src/pages/TaskExecutionPage.tsx` | Edit | Rename to `AutomationExecutionPage.tsx`. |
| `client/src/pages/AdminTaskEditPage.tsx` | Edit | Rename to `AdminAutomationEditPage.tsx`. |
| `client/src/pages/SystemProcessesPage.tsx` | Edit | Rename to `SystemAutomationsPage.tsx`. Update strings. |
| `client/src/pages/AdminSubaccountDetailPage.tsx` | Edit | Update references to renamed routes + services + types. |
| `client/src/components/CommandPalette.tsx` | Edit | Update nav entries referencing `/processes` / `/api/processes`. |
| `client/src/App.tsx` (router table) | Edit | Update route definitions to new paths. |

**Remaining search-and-replace seam:** Any client-side data hook (`useProcesses`, `useProcessById`, etc.) gets renamed to the automation-prefixed equivalent. The codemod (§4.5) handles this mechanically.

### 4.3 M3 — Rename playbooks → workflows (+ cross-schema column renames)

Depends on M1 (namespace cleared). User-visible rename touching permissions, routes, UI, skill files, and cross-table columns on six unrelated schemas.

**Schema + migration:**

| Path | Action | Notes |
|---|---|---|
| `migrations/ZZZZ_rename_playbooks_to_workflows.sql` | Write | Nine primary renames: `playbook_runs → workflow_runs`, `playbook_step_runs → workflow_step_runs`, `playbook_step_reviews → workflow_step_reviews`, `playbook_templates → workflow_templates`, `playbook_template_versions → workflow_template_versions`, `system_playbook_templates → system_workflow_templates`, `system_playbook_template_versions → system_workflow_template_versions`, `playbook_studio_sessions → workflow_studio_sessions`, `playbook_run_event_sequences → workflow_run_event_sequences`. Plus six cross-table column renames (§4.3 cross-schema list). Rename FKs + indexes throughout. |
| `migrations/_down/ZZZZ_rename_playbooks_to_workflows.sql` | Write | Reverse of every rename. |
| `server/db/schema/playbookRuns.ts` | Edit | Rename file to `workflowRuns.ts` (git-mv); rename exports. |
| `server/db/schema/playbookTemplates.ts` | Edit | Rename file to `workflowTemplates.ts`; rename exports. |
| `server/db/schema/index.ts` | Edit | Update barrel re-exports. |

**Cross-schema column renames (§12.1.5 resolved — exhaustive list from `grep -rn 'playbook_\|Playbook' server/db/schema/`):**

| Schema file | Current column | Renamed to |
|---|---|---|
| `server/db/schema/subaccountOnboardingState.ts` | `playbook_slug` (line 45) | `workflow_slug` |
| `server/db/schema/portalBriefs.ts` | `playbook_slug` (line 32) | `workflow_slug` |
| `server/db/schema/modules.ts` | `onboarding_playbook_slugs` (line 18) | `onboarding_workflow_slugs` |
| `server/db/schema/onboardingBundleConfigs.ts` | `playbook_slugs` (line 20) | `workflow_slugs` |
| `server/db/schema/memoryBlocks.ts` | `last_written_by_playbook_slug` (line 71) | `last_written_by_workflow_slug` |
| `server/db/schema/agentRuns.ts` | `playbook_step_run_id` (line 162) + index `agent_runs_playbook_step_run_id_idx` (line 250) | `workflow_step_run_id` + `agent_runs_workflow_step_run_id_idx` |
| `server/db/schema/scheduledTasks.ts` | Any `playbook_*` column (surfaced by grep — confirm at build time) | `workflow_*` |
| `server/db/schema/memoryBlockVersions.ts` | Any `playbook_*` column (surfaced by grep) | `workflow_*` |

All eight files are **Edit** entries; the migration file adds matching `ALTER TABLE ... RENAME COLUMN` statements for each.

**Services:**

| Path | Action | Notes |
|---|---|---|
| `server/services/playbookRunService.ts` | Edit | Rename to `workflowRunService.ts`; rename exports (`PlaybookRunService → WorkflowRunService`, method names, type refs). Drop `'supervised'` from `PlaybookRunMode` union (see W2 audit; if W2 hasn't merged first, leave `'supervised'` in place and let W2 handle it). |
| `server/services/playbookEngineService.ts` | Edit | Rename to `workflowEngineService.ts`. (Note: this collides in name with the renamed `automation_engines` table's service; acceptable because there is no existing `workflowEngineService.ts` — the automation side is pure schema + resolution service. If a collision surfaces during grep, the automation-side service stays named `automationEngineResolutionService.ts` per M2 §4.2 — spec §5.8 credential resolution lives there, not in this file.) |
| `server/services/playbookTemplateService.ts` | Edit | Rename to `workflowTemplateService.ts`. |
| `server/services/playbookStudioService.ts` | Edit | Rename to `workflowStudioService.ts`. |
| `server/services/playbookStudioGithub.ts` | Edit | Rename to `workflowStudioGithub.ts`. |
| `server/services/playbookStepReviewService.ts` | Edit | Rename to `workflowStepReviewService.ts`. |
| `server/services/playbookActionCallExecutor.ts` | Edit | Rename to `workflowActionCallExecutor.ts`. |
| `server/services/playbookActionCallExecutorPure.ts` | Edit | Rename to `workflowActionCallExecutorPure.ts`. |
| `server/services/playbookAgentRunHook.ts` | Edit | Rename to `workflowAgentRunHook.ts`. |
| `server/services/subaccountOnboardingService.ts` | Edit | Import + call-site updates (consumes run service). |
| `server/services/queueService.ts` | Edit | Import + call-site updates. |
| `server/lib/playbook/` (entire directory) | Edit | Rename directory to `server/lib/workflow/`; all internal files (`definePlaybook.ts`, `templating.ts`, `renderer.ts`, `validator.ts`, `types.ts`, `canonicalJson.ts`, `hash.ts`, `agentDecisionEnvelope.ts`, `agentDecisionPure.ts`, `agentDecisionSchemas.ts`, `actionCallAllowlist.ts`, `onboardingStateHelpers.ts`, `index.ts`) get moved and their exports follow the rename (`definePlaybook → defineWorkflow` etc.). The `__tests__` subdirectory moves with the directory. |

**Routes:**

| Path | Action | Notes |
|---|---|---|
| `server/routes/playbookRuns.ts` | Edit | Rename to `workflowRuns.ts`; update paths `/api/playbook-runs → /api/workflow-runs`. Drop `'supervised'` from `validModes` at line 55 (W2 audit); if W2 hasn't merged, leave in place. |
| `server/routes/playbookTemplates.ts` | Edit | Rename to `workflowTemplates.ts`; update paths. |
| `server/routes/playbookStudio.ts` | Edit | Rename to `workflowStudio.ts`; update path `/api/playbook-studio → /api/workflow-studio`. |
| `server/index.ts` | Edit | Update route registration imports. |

**Permissions (spec §13.3):**

| Path | Action | Notes |
|---|---|---|
| `server/lib/permissions.ts` | Edit | Rename 11 permission keys across `ORG_PERMISSIONS` (lines 69–76 — `PLAYBOOK_TEMPLATES_READ/WRITE/PUBLISH`, `PLAYBOOK_STUDIO_ACCESS`, `PLAYBOOK_RUNS_START`) and `SUBACCOUNT_PERMISSIONS` (lines 137–141 — `PLAYBOOK_RUNS_READ/START/CANCEL/EDIT_OUTPUT/APPROVE`) per spec §13.3 table. Update `AVAILABLE_PERMISSIONS` metadata strings (e.g. "View Playbook templates" → "View Workflow templates"). |

**UI pages + components (§12.1.6 resolved — playbook-related):**

| Path | Action | Notes |
|---|---|---|
| `client/src/pages/PlaybookStudioPage.tsx` | Edit | Rename to `WorkflowStudioPage.tsx`; update strings, route import. |
| `client/src/pages/PlaybooksLibraryPage.tsx` | Edit | Rename to `WorkflowsLibraryPage.tsx`. |
| `client/src/pages/PlaybookRunDetailPage.tsx` | Edit | Rename to `WorkflowRunDetailPage.tsx`. |
| `client/src/components/PlaybookRunModal.tsx` | Edit | Rename to `WorkflowRunModal.tsx`; drop supervised checkbox per W2 spec §6.8 (if W2 hasn't merged, leave supervised in place). |
| `client/src/components/CommandPalette.tsx` | Edit | Update `/playbooks` / `/playbook-studio` nav links. |
| `client/src/App.tsx` (router table) | Edit | Update route paths `/playbooks → /workflows`, `/system/playbook-studio → /system/workflow-studio`. |

**Skill markdown files (spec §13.5):**

| Path | Action | Notes |
|---|---|---|
| `server/skills/playbook_validate.md` | Edit | Rename to `workflow_validate.md`; update frontmatter + content. |
| `server/skills/playbook_simulate.md` | Edit | Rename to `workflow_simulate.md`. |
| `server/skills/playbook_propose_save.md` | Edit | Rename to `workflow_propose_save.md`. |
| `server/skills/playbook_read_existing.md` | Edit | Rename to `workflow_read_existing.md`. |
| `server/skills/playbook_estimate_cost.md` | Edit | Rename to `workflow_estimate_cost.md`. |
| `server/skills/config_publish_playbook_output_to_portal.md` | Edit | Rename to `config_publish_workflow_output_to_portal.md`. |
| `server/skills/config_send_playbook_email_digest.md` | Edit | Rename to `config_send_workflow_email_digest.md`. |
| Skill handlers under `server/services/skillExecutor.ts` or similar | Edit | Update skill slug constants referenced from any skill handler (the slug string has to match the renamed markdown). Builder greps `playbook_validate\|playbook_simulate\|...` at implementation time. |

**Post-M3 verification grep:** `grep -rn 'playbook_\|Playbook' server/ client/ --include='*.ts' --include='*.tsx' --include='*.md'` returns zero live hits; only migration-history files + test fixtures + historical commit messages remain. The `grep` is part of the pre-merge verification (§3 above).

### 4.4 Part 2 — Composition (`invoke_automation` step type)

All paths below use post-rename names (after M3 landed). Schema changes here are zero — the `automations.side_effects` and `automations.idempotent` columns were already added in M2. Part 2 is a code-only extension.

**Step-type registration + pure dispatcher:**

| Path | Action | Notes |
|---|---|---|
| `server/lib/workflow/types.ts` | Edit | Extend the existing Workflow step discriminated union with `kind: 'invoke_automation'` per spec §5.3. Fields: `automationId`, `inputMapping` (record of template expressions), `outputMapping` (optional projection), `gateLevel?` (override), `retryPolicy?` (with `overrideNonIdempotentGuard: boolean` opt-in per §5.4a rule 3). |
| `server/lib/workflow/validator.ts` | Edit | Add the `invoke_automation` case to the switch-on-`kind`. Enforce spec §5.10a composition rules at authoring time: reject unknown `kind`, reject nested `invoke_workflow` (not a valid kind in v1), reject missing `automationId`, reject absent `inputMapping` record. Surface `workflow_composition_invalid` error code (§5.7). |
| `server/services/invokeAutomationStepPure.ts` | Write | Pure-function dispatcher per spec §5.3 + §11.2. Inputs: `{ step, run, automation, connections, renderTemplate }`. Returns a `{ kind: 'dispatch' \| 'skip' \| 'error', ... }` discriminated result. Handles: input-mapping resolution, output-mapping projection, scope-matching rule (§5.8), gate-resolution branch (reads §5.4a `side_effects` / `idempotent`), error-code mapping (§5.7), dispatcher-clamp of `retryPolicy.maxAttempts > 3 → 3` (§5.4a rule 3 hard ceiling). No HTTP-layer knowledge — webhook fetch is injected as a function. |
| `server/services/invokeAutomationStepService.ts` | Write | Stateful wrapper around the pure dispatcher. Owns: the webhook fetch (via `server/lib/webhookClient.ts` or equivalent — grep at build time), tracing emission, retry loop honouring the pure result. Dispatcher enforces the §5.10a rule 4 "one step → one webhook" defence-in-depth — any multi-webhook resolution returns `automation_composition_invalid` (§5.7). Enforces the `AutomationStepError` shape (§5.7): `{ code, type, message, retryable }` with `type ∈ {validation, execution, timeout, external, unknown}`. |
| `server/lib/workflow/invokeAutomationSchemaValidator.ts` | Write | Per architect decision 1 (§2 above): zod-based best-effort validator of `automations.input_schema` / `output_schema` (both `text` columns). Contract: if empty or unparseable, skip silently. If parseable as JSON, compile to a zod schema from `{ properties, required, additionalProperties }`. Default `additionalProperties: true` unless schema explicitly declares `false`. Exports two functions: `validateInput(raw, schema)` and `validateOutput(raw, schema)`. Only place `input_schema` / `output_schema` parsing lives; the dispatcher is a thin caller. |

**Authoring-time + runtime enforcement (spec §5.10a Enforcement surface):**

| Path | Action | Notes |
|---|---|---|
| `server/lib/workflow/validator.ts` | Edit | (Same file as above, different concern.) Authoring-time surface — Workflow-definition validator on save emits `workflow_composition_invalid` for violations. |
| `server/services/invokeAutomationStepService.ts` | Edit | (Same file as above.) Runtime surface — dispatcher emits `automation_composition_invalid` at dispatch for mutated / imported / race-condition / storage-corruption states that bypass authoring. Enforces §5.10a rules 1 (depth=1), 2 (no recursive workflow calls — no `invoke_workflow` kind), 3 (no callback composition), 4 (one step → one webhook). |

**Template expression renderer reuse (§12.2 item 8 resolved):**

| Path | Action | Notes |
|---|---|---|
| `server/lib/workflow/renderer.ts` or `server/lib/workflow/templating.ts` | Edit (reuse only — no logic change) | The `invoke_automation` step's `inputMapping` values are rendered via the existing `{{ steps.X.output.Y }}` renderer after M3 moves `server/lib/playbook/*` to `server/lib/workflow/*`. No new expression grammar, no new escape rules. The pure dispatcher (`invokeAutomationStepPure.ts`) accepts `renderTemplate: (expr: string, ctx: TemplateCtx) => unknown` as an injected function and the service wrapper passes the existing renderer. Decision captured in §2 above. |

**Telemetry:**

| Path | Action | Notes |
|---|---|---|
| `server/lib/tracing.ts` | Edit | Register two new event names per spec §5.9: `workflow.step.automation.dispatched` (fired pre-dispatch) and `workflow.step.automation.completed` (fired on terminal state). Payload types per §5.9 + §9a Contracts table. `completed` event fields: `runId`, `stepId`, `automationId`, `status` (10-value enum), `retryAttempt` (required, 1-indexed, 1 = initial), `latencyMs`, `error?: AutomationStepError` (present iff status !== 'ok'). |

**UI — composition mockups:**

| Path | Action | Notes |
|---|---|---|
| `client/src/pages/WorkflowStudioPage.tsx` | Edit | (Post-M3 rename of `PlaybookStudioPage.tsx`.) Extend step-type picker menu to include "Call Automation" entry per Mock 05. One extra menu row; existing shell untouched. |
| Step-picker component (within `WorkflowStudioPage.tsx` or extracted) | Edit | Add "Call Automation" row. Clicking it opens the Automation picker drawer (new component below). |
| `client/src/components/AutomationPickerDrawer.tsx` | Write | New drawer component per Mock 06. Table with columns `name \| tool \| readiness`, selected-row expands inline for input mapping. No scope-filter tabs, no engine-filter chips, no readiness counters per §3a.2 lock 7. On confirm, emits the `invoke_automation` step config to the Studio save path. |
| Run-log viewer (within `WorkflowRunDetailPage.tsx` or agent-run-log components) | Edit | Extend existing run-log row rendering per Mock 07 — failed Automation calls render as one row, one human error line ("The Mailchimp connection isn't set up for this subaccount"), one "fix" CTA ("Set up Mailchimp"). No JSON payload preview, no tracing-event names, no HTTP status exposure per §3a.2 lock 2. Internal diagnostics stay in the tracing sink. The exact run-log file to edit: `client/src/components/agentRunLog/EventRow.tsx` is the likely target — builder greps at implementation time. |

**Libraries (spec §3a.2 lock 8):**

| Path | Action | Notes |
|---|---|---|
| `client/src/pages/WorkflowsLibraryPage.tsx` | Edit | (Post-M3 rename of `PlaybooksLibraryPage.tsx`.) Per Mock 08: single table ≤ 4 columns (`name`, `agent`, `last-run`). No KPI tiles, no filter chips, no per-row step-count chips. One primary action. |
| `client/src/pages/AutomationsPage.tsx` | Edit | (Post-M2 rename of `TasksPage.tsx`.) Per Mock 09: single table ≤ 4 columns (`name`, `tool`, `readiness`). No KPI tiles, no filter chips. One primary action. |

**Post-Part 2 verification:** unit tests green (`invokeAutomationStepPure.test.ts` covers the §5.7 error-code matrix, §5.8 scope-matching branch, §5.4a retry-guard clamp, §5.10a dispatch-time composition rejection); `tsc` clean; no direct HTTP assertions required (composition tests mocked at the injected `webhookFetch` function boundary per spec §11.2 and `docs/spec-context.md` framing).

### 4.5 Tooling (one-time, shipped with W1)

Both files are **Write** — new tooling artefacts scoped to this PR. Not retained, not scheduled. Listed explicitly so `pr-reviewer` and `spec-conformance` both see them in the changed-file set.

| Path | Action | Notes |
|---|---|---|
| `scripts/codemod-riley-rename.ts` | Write | Conservative ts-morph codemod for branches that fork off `main` before W1 lands. Replacement rules: (1) `playbook_` → `workflow_` ONLY in SQL string literals, TypeScript imports, route-path strings, and permission-key enum references; (2) `Playbook` → `Workflow` ONLY in TypeScript type/interface/class symbols; (3) `/api/playbooks` → `/api/workflows` (route strings only); (4) `processes` → `automations` (only where context proves it's the table identifier — skip generic word uses); (5) `ProcessService` → `AutomationService`; (6) rename imports to the new schema file paths. Excludes: migration history files (`migrations/*.sql`), test fixtures (`**/*.fixture.json`), historical commit messages, docs under `docs/superpowers/` + `tasks/review-logs/`. Each rule run is dry-run-able (`--dry-run` flag prints what would change without writing). |
| `scripts/rebase-post-riley-rename.sh` | Write | Bash orchestrator. Sequence: (a) `git fetch origin`, (b) `git merge origin/main --no-edit`, (c) run the codemod (`tsx scripts/codemod-riley-rename.ts`), (d) `npm run build` to surface unresolved imports, (e) print a punch list of remaining manual conflicts. Dry-run mode runs steps a–c without committing. |
| Announcement stub — inline Slack/#engineering message, not a file | — | Not a code artefact; captured in §10.4 of the spec. Plan does not manage the message body, only flags that the merge window needs the comms step. |

**Codemod rules defined in the script file itself** — the plan does not enumerate every replacement pattern here. The builder is free to iterate; the rebase-script wraps it with the dry-run convention. (§12.1.4 resolved — builder discretion with the framing above.)

## 5. Mockup citations

Every UI touch in W1 binds to exactly one mockup in `prototypes/riley-observations/`. No parallel surfaces; no mockup maps to a newly-created page.

| Mockup | File | Target code path(s) | Action |
|---|---|---|---|
| 01 | `prototypes/riley-observations/01-sidebar-post-rename.html` | `client/src/App.tsx` (nav tree / sidebar config) + `client/src/components/CommandPalette.tsx` | Edit — relabel "Playbooks" → "Workflows" and "Processes"/"Workflows" → "Automations"; differentiated icons per mockup. No new nav slot. |
| 05 | `prototypes/riley-observations/05-workflow-studio-step-picker.html` | `client/src/pages/WorkflowStudioPage.tsx` (post-M3 rename) | Edit — add "Call Automation" entry to the existing step-type menu. Existing shell untouched. |
| 06 | `prototypes/riley-observations/06-automation-picker-drawer.html` | `client/src/components/AutomationPickerDrawer.tsx` | Write — new drawer component. Table ≤ 3 columns (`name`, `tool`, `readiness`), selected-row-expands-inline for input mapping. No scope-filter tabs, no engine-filter chips per §3a.2 lock 7. |
| 07 | `prototypes/riley-observations/07-invoke-automation-run-detail.html` | Run-log row rendering — likely `client/src/components/agentRunLog/EventRow.tsx` (grep at build time) | Edit — one-row rendering for failed `invoke_automation` step with one human error line + one "fix" CTA. No new run-detail page per §3a.2 lock 2. No JSON / tracing / HTTP-status exposure on the user screen. |
| 08 | `prototypes/riley-observations/08-workflows-library.html` | `client/src/pages/WorkflowsLibraryPage.tsx` (post-M3 rename) | Edit — single table, 3 columns (`name`, `agent`, `last-run`). No KPI tiles, no filter chips, no per-row step-count chips per §3a.2 lock 8. One primary CTA. |
| 09 | `prototypes/riley-observations/09-automations-library.html` | `client/src/pages/AutomationsPage.tsx` (post-M2 rename of `TasksPage.tsx`) | Edit — single table, 3 columns (`name`, `tool`, `readiness`). Same consumer-simple posture as Mock 08. One primary CTA. |

Mocks 02, 03, 04, 10 bind to W2 surfaces (Explore/Execute Mode) and do not appear in W1.

## 6. Commit boundaries

W1 ships as **one PR, five commits**. Each commit is green on its own — tests pass, `tsc` clean, build clean. Spec §4.1 mandates the rename-steps split; Part 2 appends two commits for the composition work after the rename fully lands.

| # | Commit subject | Scope | Green-on-commit gate |
|---|---|---|---|
| 1 | `refactor(flow): rename internal workflow stack to flow stack to clear namespace` | M1 migration (forward + down) + all §4.1 file renames + consumer updates. No user-visible surface. | `npm run build` + `npm run test:unit` green. `grep -rn 'workflow_runs\|WorkflowRun\|WorkflowDefinition' server/ client/` returns zero live hits. |
| 2 | `refactor(automations): rename processes → automations and add capability contract` | M2 migration (forward + down) + all §4.2 file renames + route/permission/UI renames + the §5.4a `side_effects` / `idempotent` column additions. User-visible strings flip but no new UI components. | Same gates. `grep -rn 'process\|Process\|PROCESSES_' server/ client/ --include='*.ts' --include='*.tsx'` returns only generic English uses (no table/permission/route refs). Permission seed regen confirmed. |
| 3 | `refactor(workflows): rename playbooks → workflows and migrate cross-schema columns` | M3 migration (forward + down) + all §4.3 file renames + cross-schema column renames + route/permission/UI renames + skill markdown renames. | Same gates. `grep -rn 'playbook\|Playbook\|PLAYBOOK' server/ client/ --include='*.ts' --include='*.tsx' --include='*.md'` returns zero live hits. |
| 4 | `feat(workflows): add invoke_automation step type and capability-contract dispatcher` | Part 2 — §4.4 schema-free code additions. New step-type enum variant, pure + stateful dispatcher, schema validator, composition constraints (authoring + runtime), telemetry event registration. Adds Mock 05 step-picker entry + Mock 06 Automation-picker drawer + Mock 07 run-log row rendering. | Full composition unit-test suite added and green. `tracing.ts` registers new events. `spec-conformance` on §5 passes. |
| 5 | `chore(tooling): add codemod + rebase script for post-rename branch coordination` | §4.5 tooling scripts. Separated from the rename commits so branches that rebase against W1 can `git cherry-pick` this commit in isolation. | Codemod dry-run on a known pre-rename fixture produces the expected diff. |

**Reordering invariant:** commit 3 MUST be after commit 1 (namespace collision — spec §4.2). Commits 1 → 2 → 3 are fixed-order; commit 4 (Part 2) MUST be after commit 3 (uses post-rename `workflow_*` identifiers + §5.4a column). Commit 5 is independent order-wise but lands last so the tooling targets the final state.

**Why one PR, not five.** Spec §4.1 rationale — the intermediate states between M1, M2, M3 are valid but semantically confusing; reviewers evaluate the end state. Part 2 piggybacks on the same PR because it depends directly on the post-rename vocabulary and the §5.4a columns added in M2. Splitting Part 2 into a follow-up PR would force a second merge-coordination pass during the 72-hour post-merge in-flight-branch unblock window (§10.4) — avoidable churn.

## 7. Test strategy

Cite spec §11.2 Part 1 + §11.2 Part 2 (lines 1776–1786). One-line summary per Part; no duplication.

- **Part 1 (naming):** `tsc` clean is the baseline pass — every renamed identifier is type-checked. Existing Playbook/Process unit and integration test suites retarget to Workflow/Automation and must stay green. Clean-DB migration + rollback + re-migration runs as the CI gate per §10.3. Manual QA script per §10.3 step 6.
- **Part 2 (composition):** pure-function unit suite in `server/services/__tests__/invokeAutomationStepPure.test.ts`. Test matrix covers every `error_code` in §5.7, every §5.8 scope-mismatch branch, the §5.4a retry-guard clamp (authored `maxAttempts > 3 → clamp to 3`), the `overrideNonIdempotentGuard: true` opt-in path, and the §5.10a dispatch-time composition rejection (`automation_composition_invalid`). Webhook fetch is injected as a function parameter; tests stub it with a fake. One gate-resolution test added to cover the `invoke_automation` branch of `resolveEffectiveGate` (one extra case in the Part 3 gate matrix — not a new test harness).

Integration tests — none added in W1. Codebase framing (`docs/spec-context.md` — `composition_tests: defer_until_stabilisation`, `testing_posture: static_gates_primary`) routes integration coverage to `tasks/todo.md`. No MSW / supertest / HTTP-layer assertions per framing.

## 8. Separable audit deliverables

Audits the Sonnet execution session can run as distinct read-only sub-tasks. All four are inlined into this plan's file-inventory tables (§4) — no separate deliverable document, no separate artefact on disk.

| Open question | Source | Where it lives in this plan |
|---|---|---|
| Drizzle schema inventory | Spec §12.1.1 | §4.1 M1 table (flow schemas) + §4.2 M2 table (automation schemas) + §4.3 M3 table (workflow schemas) — the three tables exhaustively enumerate every Drizzle schema file the rename touches. |
| Component rename inventory | Spec §12.1.6 | §4.2 (process-related pages) + §4.3 (playbook-related pages + components). Complete list based on `ls client/src/pages/*Playbook* client/src/pages/*Process* client/src/pages/*Task*` at plan-writing time. |
| Cross-schema column-rename list | Spec §12.1.5 | §4.3 "Cross-schema column renames" table. Eight schema files with exact `playbook_*` → `workflow_*` column mappings (derived from `grep -rn 'playbook_\|Playbook' server/db/schema/`). |
| Codemod replacement rules | Spec §12.1.4 | §4.5 tooling row for `scripts/codemod-riley-rename.ts`. Rules defined inside the script file, not enumerated here; builder discretion with the conservative framing. |

**Out-of-scope audits handled in other waves:**
- 152-skill `side_effects` audit (§12.12) → W2 (`tasks/builds/riley-observations/skills-side-effects-audit.md`). Touches `system_skills.side_effects` column added by W2 migration 0205, not W1.
- Supervised-mode call-site audit (§12.14) → W2. W1's `playbookRunService.ts` / `playbookRuns.ts` route / `PlaybookRunModal.tsx` may or may not already have `'supervised'` dropped by W2 — depends on merge order. If W2 merges first, W1 inherits the drop; if W1 merges first, W2 does the drop as part of its §4.9 audit. Either order works.

**No cross-wave blocker:** each of the four W1-scoped audits above is resolved in this plan's prose. The builder does not have to open `tasks/todo.md` or consult an external artefact to act on W1.

## 9. Reviewer checklist

See spec §11.3. Every checklist line applies to W1 — `grep`-clean of user-facing strings, `drizzle-kit introspect` clean, all migrations reversible, permission-enum rename reflected in seed data, no in-flight branch left broken > 24h (W1-specific), success criteria verifiable, telemetry events registered in `tracing.ts` with documented schema, feature flags default to safe posture (N/A for W1 but applies when Part 3/4 land), and `spec-conformance` pass before `pr-reviewer`.

