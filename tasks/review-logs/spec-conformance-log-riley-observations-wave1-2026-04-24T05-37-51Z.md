# Spec Conformance Log

**Spec:** `docs/riley-observations-dev-spec.md`
**Spec commit at check:** `4db85d5c` (docs(riley-observations): finalize ChatGPT spec review session)
**Branch:** `claude/start-riley-architect-pipeline-7ElHp`
**Base:** `d44575ff` (merge-base with main)
**Scope:** Wave 1 only — spec §4 (Part 1 naming) + §5 (Part 2 invoke_automation composition). W2 (§6 Explore/Execute), W3 (§8 context-assembly telemetry), W4 (§7 heartbeat gate), W0 (§9 spec-authoring rule) explicitly out of scope per caller.
**Changed-code set:** 389 files total on branch; Wave-1-relevant subset: ~180 files (M1+M2+M3 renames + Part 2 composition additions).
**Run at:** 2026-04-24T05:37:51Z
**Commit at finish:** `34aa3179` (local; push failed because remote has diverged — see Next step)

---

## Summary

- Requirements extracted: 55
- PASS: 39
- MECHANICAL_GAP → fixed: 8
- DIRECTIONAL_GAP → deferred: 5
- AMBIGUOUS → deferred: 1
- OUT_OF_SCOPE → skipped: 0

**Verdict:** NON_CONFORMANT (6 deferred items — see `tasks/todo.md` under "Deferred from spec-conformance review — riley-observations wave 1 (2026-04-24)") but all 8 mechanical gaps were closed in-session. Caller should re-run `pr-reviewer` on the expanded changed-code set before PR.

---

## Requirements extracted (full checklist)

| REQ | Spec section | Verdict | Evidence / note |
|-----|---|---|---|
| 1  | §4.3 M1 table renames              | PASS        | migrations/0219 renames workflow_runs → flow_runs, workflow_step_outputs → flow_step_outputs, canonical_workflow_definitions → canonical_flow_definitions + FKs/indexes |
| 2  | §4.3 M1 Drizzle schema files       | PASS        | server/db/schema/flowRuns.ts |
| 3  | §4.3 M1 types module               | PASS        | server/types/flow.ts imported by flowRuns.ts |
| 4  | §4.3 M1 service rename             | PASS        | server/services/flowExecutorService.ts (R068) |
| 5  | §4.6 M2 table renames              | PASS        | migrations/0220 renames processes/process_categories/subaccount_process_links/process_connection_mappings/workflow_engines |
| 6  | §4.6 M2 column renames             | DIRECTIONAL | workflow_engine_id / parent_process_id / system_process_id NOT renamed; deferred (59 call sites) |
| 7  | §5.4a capability-contract columns  | PASS        | automations.side_effects + automations.idempotent present in M2 + schema |
| 8  | §4.6 M2 schema file renames        | PASS        | processes.ts → automations.ts, 4 other file renames |
| 9  | §4.6 M2 type exports               | PASS        | Automation, AutomationEngine, AutomationCategory, SubaccountAutomationLink, AutomationConnectionMapping |
| 10 | §4.6 M2 service renames            | PASS        | automationService.ts + automationResolutionService.ts |
| 11 | §4.6 M2 route URLs                 | PASS        | /api/automations/* in routes/automations.ts |
| 12 | §4.6 M2 permission-key renames     | PASS        | all AUTOMATIONS_* keys; no PROCESSES_* remaining |
| 13 | §4.6 M2 perm group-name strings    | FIXED       | OrgSettingsPage.tsx:614 `'org.processes'` → `'org.automations'` |
| 14 | §4.6 M2 client page renames        | PASS        | 5 page renames applied |
| 15 | §4.6 M2 nav labels + paths         | FIXED       | Layout.tsx L74/L701/L702/L810/L826 |
| 16 | §4.6 M2 portal client paths        | FIXED       | PortalPage.tsx + PortalExecutionPage.tsx paths + response key |
| 17 | §4.6 M2 CommandPalette             | PASS        | CommandPalette.tsx:14 |
| 18 | §4.8 M3 table renames              | PASS        | migrations/0221 renames 9 tables |
| 19 | §4.8 M3 cross-table column renames | PASS        | 8 column renames in migrations/0221 Step 4 + Step 5 |
| 20 | §4.8 M3 Drizzle schema file renames| PASS        | playbookRuns.ts deleted; workflowRuns.ts updated; playbookTemplates.ts → workflowTemplates.ts |
| 21 | §4.8 M3 type exports               | PASS        | WorkflowRun / WorkflowStepRun / WorkflowStepReview / WorkflowStudioSession |
| 22 | §4.8 M3 service renames            | PASS        | 8 playbook*Service → workflow*Service renames |
| 23 | §4.8 M3 lib directory rename       | PASS        | server/lib/workflow/ with all subfiles |
| 24 | §4.8 M3 route file renames         | PASS        | workflowRuns.ts, workflowTemplates.ts, workflowStudio.ts |
| 25 | §4.8 M3 URL path lowercase         | FIXED       | `/api/Workflow-*` (capital W) → `/api/workflow-*` across 9 route+client files; `'Workflow-run'` socket room → `'workflow-run'`; server `join:playbook-run` → `join:workflow-run` |
| 26 | §4.8 M3 permission keys            | PASS        | all WORKFLOW_* keys; no PLAYBOOK_* remaining |
| 27 | §4.8 M3 client page renames        | PASS        | 4 page renames + PlaybookRunModal → WorkflowRunModal |
| 28 | §4.8 M3 skill markdown renames     | PASS        | 7 skill file renames + workflow_read_existing.md |
| 29 | §4.8 M3 *.playbook.ts → *.workflow.ts | DIRECTIONAL | server/playbooks/*.playbook.ts retained; deferred |
| 30 | §5.3 invoke_automation in StepType | PASS        | types.ts:26, workflowRuns.ts:122 |
| 31 | §5.3 InvokeAutomationStep type     | PASS        | types.ts:298-305 |
| 32 | §5.4a AutomationStepRetryPolicy    | PASS        | types.ts:69-76 |
| 33 | §5.7 AutomationStepError shape     | PASS        | types.ts:78-87 |
| 34 | §5.4a rule 1 gate resolution       | PASS        | resolveGateLevel in invokeAutomationStepPure.ts |
| 35 | §5.4a rule 3 maxAttempts ≤ 3       | PASS        | clampMaxAttempts + service dispatcher use |
| 36 | §5.4a rule 3 non-idempotent guard  | PASS        | shouldBlock_nonIdempotentGuard |
| 37 | §5.8 scope matching                | PASS        | checkScope(run, automation) |
| 38 | §5.7 error-code vocabulary + buckets | FIXED+AMBIG | FIXED: scope_mismatch+not_found → 'execution'; webhook_error → http_error; exec_error → network_error; status enum aligned. AMBIGUOUS: engine-not-found emits `automation_execution_error` not in §5.7 vocabulary |
| 39 | §5.10a rules 1-3 composition       | PASS        | validator.ts unknown_step_type default + invoke_automation case |
| 40 | §5.3 reject gateLevel='block'      | PASS        | validator.ts:304-309 |
| 41 | §5.10a rule 2 authoring-time       | PASS        | validator.ts:289-303 missing automationId + inputMapping checks |
| 42 | §5.4a rule 3 authoring warning     | PASS        | validator.ts retry_ceiling_exceeded |
| 43 | §5.10a rule 4 dispatcher DiD       | DIRECTIONAL | Not implemented — deferred |
| 44 | §5.8 required-connection check     | DIRECTIONAL | requiredConnections never inspected by dispatcher — deferred |
| 45 | §5.9 tracing event registration    | PASS        | tracing.ts:87-88 |
| 46 | §5.9 completed-event status enum   | FIXED       | dispatcher status now aligned to spec (http_error/network_error/timeout/input_validation_failed/output_validation_failed/automation_not_found/automation_scope_mismatch/ok) via preDispatchStatusForCode helper |
| 47 | §5.9 retryAttempt required         | PASS        | every createEvent call passes retryAttempt |
| 48 | §5.4/§5.5 best-effort validator    | PASS        | invokeAutomationSchemaValidator.ts |
| 49 | §5.11 Mock 05 step picker          | PASS        | WorkflowStudioPage.tsx:493 |
| 50 | §5.11 Mock 06 AutomationPickerDrawer | PASS      | client/src/components/AutomationPickerDrawer.tsx |
| 51 | §5.11 Mock 07 failed step row      | PASS        | EventRow.tsx invoke_automation failure branch |
| 52 | §3a.2 lock 8 Mock 08 library       | DIRECTIONAL | WorkflowsLibraryPage not simplified to Mock 08 posture |
| 53 | §3a.2 lock 8 Mock 09 library       | DIRECTIONAL | AutomationsPage not matching Mock 09 columns |
| 54 | Plan §4.5 codemod + rebase script  | PASS        | scripts/codemod-riley-rename.ts + rebase-post-riley-rename.sh |
| 55 | Plan §3 matching _down/ migrations | PASS        | migrations/_down/0219, _down/0220, _down/0221 present |

---

## Mechanical fixes applied

### client/src/components/Layout.tsx (5 edits)

- [FIXED] REQ 15 — SEG breadcrumb map L74: `processes: 'Workflows'` → `automations: 'Automations', workflows: 'Workflows'`.
- [FIXED] REQ 15 — nav-item guard L701: `hasOrgPerm('org.processes.view')` → `hasOrgPerm('org.automations.view')`.
- [FIXED] REQ 15 — NavItem L702: `to="/processes"` + `label="Workflows"` → `to="/automations"` + `label="Automations"`.
- [FIXED] REQ 15 — admin NavItem L810: `hasOrgPerm('org.processes.view')` + `to="/admin/processes"` + `label="Workflows"` → `hasOrgPerm('org.automations.view')` + `to="/admin/automations"` + `label="Automations"`.
- [FIXED] REQ 15 — system NavItem L826: `to="/system/processes"` + `label="Workflows"` → `to="/system/automations"` + `label="Automations"`.

### client/src/pages/OrgSettingsPage.tsx

- [FIXED] REQ 13 — GROUP_META L614: `'org.processes'` key + `'Processes'` label + description → `'org.automations'` + `'Automations'` + updated description (matches server-side group-name rename).

### client/src/pages/PortalPage.tsx

- [FIXED] REQ 16 — L72 API path `/api/portal/${subaccountId}/processes` → `/api/portal/${subaccountId}/automations`.
- [FIXED] REQ 16 — L85 response key `processRes.data.processes` → `processRes.data.automations` (matches portal.ts:179 server response shape).
- [FIXED] REQ 16 — L302 link path `/portal/${subaccountId}/processes/${process.id}` → `/portal/${subaccountId}/automations/${process.id}`.
- [FIXED] REQ 25 — L73 + L107 `/playbook-runs` → `/workflow-runs` (matches portal.ts server route rename).

### client/src/pages/PortalExecutionPage.tsx

- [FIXED] REQ 16 — L68 API path `/processes` → `/automations`.
- [FIXED] REQ 16 — L71 response key `portalRes.data.processes` → `portalRes.data.automations`.

### server/routes/workflowTemplates.ts

- [FIXED] REQ 25 — all 9 occurrences of `/api/Workflow-templates` and `/api/system/Workflow-templates` lowercased to `workflow-templates`.

### server/routes/workflowStudio.ts

- [FIXED] REQ 25 — all 11 occurrences of `/api/system/Workflow-studio` lowercased; `/workflow-studio/Workflows` sub-segment → `/workflow-studio/workflows`.

### server/routes/workflowRuns.ts

- [FIXED] REQ 25 — 8 occurrences of `/api/Workflow-runs` and `:subaccountId/Workflow-runs` lowercased.

### server/routes/portal.ts

- [FIXED] REQ 25 — L483 + L630 `:subaccountId/Workflow-runs` → `:subaccountId/workflow-runs`.

### server/services/workflowStudioService.ts

- [FIXED] REQ 25 — L133 docblock reference to `/api/system/Workflow-studio/render` lowercased.

### server/websocket/rooms.ts

- [FIXED] REQ 25 — L200-216 socket events + room name: `join:playbook-run`/`leave:playbook-run` → `join:workflow-run`/`leave:workflow-run`; room ID `playbook-run:${runId}` → `workflow-run:${runId}`. Completes §4.8 rename on the socket surface (previously broken: client emitted `join:Workflow-run` while server listened for `join:playbook-run`).

### server/websocket/emitters.ts

- [FIXED] REQ 25 — L147 `emitWorkflowRunUpdate` now emits to `workflow-run:${runId}` room (was `playbook-run:${runId}`). Matches the renamed socket room.

### client/src/components/WorkflowRunModal.tsx

- [FIXED] REQ 25 — L110 `/api/system/Workflow-templates/${slug}` → lowercase; L177 `/api/subaccounts/.../Workflow-runs` → lowercase.

### client/src/pages/WorkflowRunDetailPage.tsx

- [FIXED] REQ 25 — all 5 `/api/Workflow-runs` occurrences lowercased; L121 `useSocketRoom('Workflow-run', ...)` → `useSocketRoom('workflow-run', ...)`.

### client/src/pages/subaccount/WorkflowRunPage.tsx

- [FIXED] REQ 25 — 8 occurrences of `/Workflow-runs` → `/workflow-runs`; L214 `useSocketRoom('Workflow-run', ...)` → `'workflow-run'`; L555 `/system/Workflow-studio` → `/system/workflow-studio`.

### client/src/pages/WorkflowsLibraryPage.tsx

- [FIXED] REQ 25 — L57-58 `/api/system/Workflow-templates` + `/api/Workflow-templates` → lowercase; L95-96 `/api/subaccounts/.../Workflow-runs` + `/Workflow-runs/${runId}` → lowercase.

### client/src/pages/WorkflowStudioPage.tsx

- [FIXED] REQ 25 — all 10 `/api/system/Workflow-studio` occurrences lowercased; `/workflow-studio/Workflows` sub-segments → `/workflow-studio/workflows`.

### server/services/invokeAutomationStepPure.ts

- [FIXED] REQ 38 — L134 `resolveDispatch` scope-mismatch: `type: 'validation'` → `type: 'execution'` per §5.7 bucket table ("pre-dispatch resolution failure → execution class").

### server/services/invokeAutomationStepService.ts (4 distinct edits)

- [FIXED] REQ 38 — automation_not_found branch (L61): `type: 'validation'` → `type: 'execution'`; status `'not_found'` → `'automation_not_found'` (spec §5.9 enum).
- [FIXED] REQ 38 — automation_scope_mismatch branch (L76): `type: 'validation'` → `type: 'execution'`; status `'scope_mismatch'` → `'automation_scope_mismatch'`.
- [FIXED] REQ 38 — HTTP-error branch (L172): code `automation_webhook_error` → `automation_http_error` (spec-named); status `'webhook_error'` → `'http_error'`; `retryable` now also respects non-idempotent guard override; `httpStatus` added to event payload per §5.9.
- [FIXED] REQ 38 — fetch-catch branch (L211): code `automation_execution_error` → `automation_network_error`; type `'execution'` → `'external'`; status `'execution_error'` → `'network_error'`. Network/DNS/TCP/TLS failures now emit the spec-named code.
- [FIXED] REQ 46 — added `CompletedStatus` type + `preDispatchStatusForCode()` helper; pre-dispatch error path now emits the spec-named §5.9 status enum (was legacy `'pre_dispatch_error'`). Retry-guard-blocked branch no longer emits a second event (previous attempt's event carries the true terminal outcome); returns `lastError` from the previous iteration instead of a synthetic `automation_retry_guard_blocked` code.
- [FIXED] REQ 38 — exhaustion-fallback error: code `automation_execution_error` → `automation_network_error`; type `'unknown'` aligns with §1.5 principle 4 unknown-safe default.

### server/services/__tests__/invokeAutomationStepPure.test.ts

- [FIXED] REQ 38 test alignment — the "resolveDispatch emits automation_scope_mismatch error code" test asserted `type: 'validation'` (encoding the bug). Updated to `type: 'execution'` with a comment citing §5.7 bucket table. Full suite: 18/18 green after fix.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

See `tasks/todo.md` → `## Deferred from spec-conformance review — riley-observations wave 1 (2026-04-24)` for full triage entries.

- **REQ W1-6** — §4.6 column renames (`workflow_engine_id → automation_engine_id`, `parent_process_id → parent_automation_id`, `system_process_id → system_automation_id`). Migration 0220 + Drizzle schema + 59 call sites unchanged. Plan §4.2 silent; architectural scope.
- **REQ W1-29** — `*.playbook.ts` file extension + `server/playbooks/` directory not renamed (§4.8 file-extension convention). Plan §4.3 silent.
- **REQ W1-43** — §5.10a rule 4 dispatcher defence-in-depth not implemented. Comment at `invokeAutomationStepService.ts:165-166` acknowledges the rule but no assertion; design decision required.
- **REQ W1-44** — §5.8 `required_connections` resolution not plumbed. The `automations.requiredConnections` column exists; `automation_connection_mappings` table exists; dispatcher never inspects either. Missing feature, not cosmetic.
- **REQ W1-52/53** — WorkflowsLibraryPage + AutomationsPage not simplified to Mock 08/09 posture per §3a.2 lock 8. Product/UX decision.
- **REQ W1-38 engine-not-found** — `automation_execution_error` emitted by `invokeAutomationStepService.ts:95` is NOT in §5.7 vocabulary. Spec §5.10 edge 3 punts on this ("reuse whatever degraded-mode posture the existing process-execution path has — audit during architect pass"). Spec-reviewer pass needed for the canonical code.

---

## Files modified by this run

- client/src/components/Layout.tsx
- client/src/pages/OrgSettingsPage.tsx
- client/src/pages/PortalPage.tsx
- client/src/pages/PortalExecutionPage.tsx
- server/routes/workflowTemplates.ts
- server/routes/workflowStudio.ts
- server/routes/workflowRuns.ts
- server/routes/portal.ts
- server/services/workflowStudioService.ts
- server/websocket/rooms.ts
- server/websocket/emitters.ts
- client/src/components/WorkflowRunModal.tsx
- client/src/pages/WorkflowRunDetailPage.tsx
- client/src/pages/subaccount/WorkflowRunPage.tsx
- client/src/pages/WorkflowsLibraryPage.tsx
- client/src/pages/WorkflowStudioPage.tsx
- server/services/invokeAutomationStepPure.ts
- server/services/invokeAutomationStepService.ts
- server/services/__tests__/invokeAutomationStepPure.test.ts
- tasks/todo.md

(20 files touched in-session)

---

## Next step

**CONFORMANT_AFTER_FIXES + NON_CONFORMANT (directional).** Mechanical gaps are closed in-session; 6 directional/ambiguous items routed to `tasks/todo.md` require human-in-the-loop decisions (column renames, file-extension rename, connection-resolver design, engine-not-found spec edit, library simplification).

Caller actions:

1. Re-run `pr-reviewer` on the expanded changed-code set — 20 files were modified by this run, the reviewer needs to see the final state before PR.
2. Process the 6 deferred items per CLAUDE.md § *Processing spec-conformance NON_CONFORMANT findings — standalone contract*:
   - All 6 items here are architectural (design/scope decisions, not surgical typos) — leave in the dated section AND promote into `## PR Review deferred items / ### riley-observations` to survive across review cycles.
3. Do NOT re-invoke `spec-conformance` — the remaining gap set is directional-only. Escalate to the user for decisions.

**Test status at run end:** `npx tsx server/services/__tests__/invokeAutomationStepPure.test.ts` → 18 passed, 0 failed. Server + client TypeScript compile (pre-existing unrelated errors in `taskService.ts`, `workspaceMemoryService.ts`, `capabilityDiscoveryHandlers.ts`; none introduced by this run).
