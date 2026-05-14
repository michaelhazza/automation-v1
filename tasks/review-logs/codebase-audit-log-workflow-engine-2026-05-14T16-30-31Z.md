# Codebase Audit Report — Track A2 (workflowEngine split, post-refactor)

| Field | Value |
|---|---|
| Audit framework version | 1.4 |
| Project | automation-v1 |
| Audited by | Claude Code (main session, inline audit-runner playbook, second track) |
| Date | 2026-05-14 |
| Branch | audit/track-workflow-engine |
| Starting commit SHA | 6f2f819a235f78dc0fca8575d015cc7945cf8bd5 |
| Final commit SHA | _(filled below — Track A2 has no Pass 2 fixes; final commits are log/todo/KNOWLEDGE only)_ |
| Mode | Targeted — workflowEngine split surface (one of the four god-file splits stated in the original operator brief) |
| Layers run | Layer 2 Module I (RLS overlap) + Module J (idempotency / queues / job discipline) + Module K (three-tier agents — workflow hooks into agent runs), informed by Layer 1 Areas 9 (boundary violations) + 10 (god files) |
| Subagents invoked | None (audit-runner runs inline) |
| Linked review logs | _(filled when spec-conformance + pr-reviewer run)_ |
| Previous track in this session | `audit/track-rls-agent-exec` (Track A) — PR #308 |

---

## Reconnaissance Map

### Context block validation

Validated 2.5 hours earlier in Track A; no stack changes since. Skipping re-validation per framework §2 ("re-verify at the start of every audit run" — done within the same session, same starting commit family).

### Resolved in-scope paths

**Services (31 workflow + 9 automation/flow companions):**

- `workflowEngineService.ts` (4,073 LOC) — the focal point of the operator-stated split
- `workflowEngineServicePure.ts` (95 LOC) — Pure companion
- `workflowRunService.ts` (1,117 LOC)
- `workflowRunInsertHelper.ts`, `workflowRunResolverService.ts`
- `workflowRunPauseStopService.ts` + `…Pure.ts`
- `workflowRunCostLedgerService.ts`
- `workflowStudioService.ts` (612 LOC), `workflowStudioGithub.ts`
- `workflowStepGateService.ts` (517 LOC), `workflowStepReviewService.ts`
- `workflowTemplateService.ts` (489 LOC), `workflowPublishService.ts`, `workflowDraftService.ts`
- `workflowActionCallExecutor.ts` + `…Pure.ts`
- `workflowAgentRunHook.ts`
- `workflowApproverPoolService.ts` + `…Pure.ts`
- `workflowConfidenceService.ts` + `…Pure.ts` + `workflowConfidenceCopyMap.ts`
- `workflowGateRefreshPoolService.ts`, `workflowGateStallNotifyService.ts` + `…Pure.ts`
- `workflowScheduleDispatchService.ts`, `workflowSeenPayloadServicePure.ts`, `workflowValidatorPure.ts`
- `flowExecutorService.ts`, `automationService.ts`, `automationResolutionService.ts`
- `automationConnectionMappingService.ts`, `systemAutomationService.ts`
- `invokeAutomationStepService.ts` + `…Pure.ts`, `invokeAutomationStepPure.ts`
- `memoryOnboardingFlowService.ts`

**Routes:** `workflowRuns.ts`, `workflowDrafts.ts`, `workflowGates.ts`, `workflowStudio.ts`, `workflowTemplates.ts`, `automations.ts`, `automationConnectionMappings.ts`, `subaccountOnboardingFlow.ts`, `systemAutomations.ts`.

**Schema:** `workflow_runs`, `workflow_step_gates`, `workflow_drafts`, `workflow_templates` (+ `workflow_template_versions`, `system_workflow_templates`, `system_workflow_template_versions`, `workflow_step_runs`, `workflow_studio_sessions`, `workflow_run_event_sequences`), `flow_runs`, `flow_step_outputs`, `automation_engines` (formerly workflow_engines).

### Out-of-scope

- pg-boss workers / jobs themselves (Module J general) — Track B/C territory.
- Webhook adapters.
- Skills / actionRegistry editorial.
- Frontend workflow studio UI.

### Concurrent audits

Track A (PR #308) is in flight on `audit/track-rls-agent-exec`. This Track A2 audit operates on a non-overlapping file set; no anticipated collisions on merge.

### Critical-path coverage assessment

`gates + sparse unit`. Specific named tests:

- `__tests__/workflowValidatorPure.test.ts` (641 LOC)
- `__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts` (563 LOC)
- `__tests__/workflowConfidenceServicePure.test.ts` (256 LOC)
- `__tests__/workflowRunPauseStopServicePure.test.ts` (148 LOC)
- `__tests__/workflowSeenPayloadServicePure.test.ts` (140 LOC)
- `__tests__/workflowPublishService.test.ts` (126 LOC)

Trust posture: downgrade `high` to `medium` for any fix whose path lacks named test coverage.

### Implicit external contracts (Rule 4)

- `workflow_runs.execution_log` persisted JSON shape.
- `workflow_runs.workflow_template_version_id` FK contract (pinned version).
- pg-boss job payloads (`workflow_run_gate_refresh`, `workflow_run_gate_stall_notify` etc.).
- `workflowApproverPool` selection algorithm (changes affect approver routing).
- `workflowConfidence` scoring output (affects HITL gating decisions).

### Protected files identified in scope (framework §4)

- `server/db/schema/workflow*.ts`, `flowRuns.ts`, `automationEngines.ts`.
- All `migrations/*.sql` touching workflow tables.
- `server/services/workflowEngineService.ts` (cited in §4 Three-Tier Agent System indirectly — workflowAgentRunHook bridges).
- `server/services/withBackoff` (canonical retry primitive) — referenced by workflowGateStallNotifyService.

---

## Pass 1 Findings

### Gate-script sanity sweep (where applicable)

| Gate | Result | Notes |
|---|---|---|
| `verify-rls-coverage.sh` | PASS — 0 violations (run in Track A 2.5h earlier) | No new tenant tables added since |
| `verify-rls-contract-compliance.sh` | PASS — 0 violations | `server/services/` allowlist — same coverage gap as Track A F3 |
| `verify-org-id-source.sh` | post-Track A: 2 violations (was 12) | Track A F1 fix landed in PR #308 reduces this. Workflow routes use `req.orgId!` correctly. |

### Workflow area — findings

| # | Finding | Severity | Confidence | Justification | Proposed fix | Pass |
|---|---|---|---|---|---|---|
| WF1 | **Five tenant-private workflow tables lack RLS policies entirely.** `workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs` — none have a `CREATE POLICY` statement in any migration (verified via `grep -E "...|" migrations/*.sql \| grep -iE "POLICY\|ENABLE ROW\|FORCE ROW"` returning empty). All carry FK references to a tenant-scoped parent (`workflow_runs` or `flow_runs`), but no Postgres-level isolation exists. They hold tenant-private data: `workflow_step_runs.input_json` / `output_json` (LLM payloads, agent run outputs), `workflow_step_reviews.decision_reason` (HITL decision context), `workflow_studio_sessions` (workflow authoring chat sessions), `flow_step_outputs.output` (per-step agent outputs). They are NOT in `rlsProtectedTables.ts` and NOT in `rls-not-applicable-allowlist.txt`. The gate `verify-rls-protected-tables.sh` does not flag them because it only inspects tables with a literal `organisation_id` column in their CREATE TABLE — these are FK-scoped. **Concrete evidence of the gap:** `server/services/workflowEngineService.ts:151-152` already queries `workflow_step_runs` by id alone: `db.select({status}).from(workflowStepRuns).where(eq(workflowStepRuns.id, stepRunId))` — no org filter, no `workflow_runs` join. Currently safe because the surrounding flow has already validated org context (the stepRunId comes from a prior tx-scoped query), but the DB layer offers zero defence-in-depth. A future query that takes a stepRunId from a less-trusted source would silently cross-tenant read. | high | high — empty grep result + concrete unsafe-query site at `workflowEngineService.ts:151` proves the gap | Add `CREATE POLICY` migrations using parent-EXISTS pattern (same shape as `document_bundle_members` and `subaccount_baseline_metrics` in the check2-exempt section of `rls-not-applicable-allowlist.txt`). Add the table names to the check2-exempt section of the allowlist with rationale. Architectural — Pass 3 (Module I + migration). | 3 |
| WF2 | **`workflowEngineService.ts` god-file persists post-split.** 4,073 LOC. The `workflowEngineServicePure.ts` companion landed (95 LOC) but the main file remains over framework Area 10 hard cap (2,500 LOC) by 1.6× and over soft cap (1,500 LOC) by 2.7×. The split extracted pure helpers only; the main file's surface area (enqueueTick, tick, dispatchStep, resolveAgentForStep, findReusableOutputForStep, resumeInvokeAutomationStep, failStepRunInternal, editStepOutput, handleBulkFanOut, checkBulkParentCompletion, replayDispatch, createReplayRun, completeStepRunInternal, completeStepRunFromReview, completeStepRun, failStepRun, onAgentRunCompleted, handleDecisionStepCompletion, watchdogSweep, registerWorkers — 20 methods) was not reduced. | medium | high — `wc -l` is deterministic | Per Area 10: splits are never Pass 2 in an audit. Future work should aim to land a split commit that drops `workflowEngineService.ts` BELOW its hard cap, not just extracts pure helpers. Likely shape: per-phase decomposition (e.g. `workflowEngineDispatch.ts`, `workflowEngineCompletion.ts`, `workflowEngineBulkFanOut.ts`, `workflowEngineReplay.ts`). | 3 |
| WF3 | **`workflowEngineService.ts` uses raw `db` 18 times, `getOrgScopedDb` 0 times.** Same root cause as Track A F3 / F4 (see PR #308). The service does not import the org-scoped DB helper at all (`grep -nE "withOrgTx\|getOrgScopedDb" server/services/workflowEngineService.ts` returns no matches). Every tenant-touching query (workflow_runs reads, workflow_step_runs writes, etc.) runs on the unscoped pool. Defence-in-depth = prod-only RLS enforcement + app-layer `where(eq(table.organisationId, orgId))` filter where present. | medium | medium — observed; same gate-coverage gap as Track A | Migrate tick → wrap remainder in `withOrgTx({tx, organisationId: run.organisationId, ...}, ...)` once the run is loaded. Migrate the other 17 raw-db sites to `getOrgScopedDb()`. Wide blast radius — call sites must all be running within (or have an entry path that opens) a `withOrgTx` block. | 3 |
| WF4 | **Workflow tick worker explicitly opts out of org context (`resolveOrgContext: () => null`) without re-opening `withOrgTx` after loading the run row.** `workflowEngineService.ts:3897`. The tick handler payload only carries `{ runId }`, so the default org-context resolver in `createWorker` would throw `missing_org_context`. The override is correct in shape (tick needs the runId to find the org), but the handler then proceeds to do 30+ raw-`db` operations without ever re-opening a tenant-scoped tx. Better pattern: opt out of the default resolver, look up the org from `workflow_runs.organisation_id` ONCE on a cross-tenant read, then wrap the rest of `tick()` in `withOrgTx({...}, () => ...)`. Same applies to `watchdogSweep` (line 3908) which is intentionally cross-org but should still scope each per-run iteration. | medium | high — explicit comment at line 3897 + visible cross-tenant DB access pattern in `tick()` | Refactor `tick()` to wrap the run-loaded section in `withOrgTx` and use `getOrgScopedDb()` thereafter. `watchdogSweep` should scope per iteration. | 3 |
| WF5 | **Workflow run permission inconsistency at routes layer.** `server/routes/workflowRuns.ts` mixes two permission families: subaccount-scoped routes (lines 28, 43, 113, 130) use `WORKFLOW_RUNS_READ` / `WORKFLOW_RUNS_START` — proper workflow-specific subaccount perms. But org-tier routes (lines 100, 152, 162, 177, 203, 247, 291, 311) reuse `AGENTS_VIEW` / `AGENTS_EDIT` — a foreign permission family. The codebase has proper org-tier workflow perms (`WORKFLOW_TEMPLATES_READ`, `WORKFLOW_TEMPLATES_WRITE`, `WORKFLOW_TEMPLATES_PUBLISH`, `WORKFLOW_STUDIO_ACCESS`, `WORKFLOW_RUNS_START` org-scope variant), but no `WORKFLOW_RUNS_VIEW_ALL` or `WORKFLOW_RUNS_ADMIN`. Either (a) workflows are intentionally an "agent" surface and the AGENTS_* gating is by design, or (b) the org-tier workflow perms were never added. Without product context, treat as deferred. | medium | medium — observed pattern; intent ambiguous | Either rename / add `WORKFLOW_RUNS_VIEW_ALL` and `WORKFLOW_RUNS_ADMIN` org permissions and switch the org-tier routes to them, OR document the intent (workflows-as-agents) inline at the route. Product call. | 3 |
| WF6 | **`workflowAgentRunHook.ts:36-39` raw `db.select` on `agent_runs` by id with no org filter.** The hook is invoked from `agentExecutionService` at agent-run completion. It does `db.select({workflowStepRunId}).from(agentRuns).where(eq(agentRuns.id, agentRunId))` — no org context, no withOrgTx wrap, no eq(agentRuns.organisationId, ...) filter. `agent_runs` IS RLS-protected, so the prod DB layer should defend; in dev with BYPASSRLS the query returns cross-org. The lifecycle hook design pattern relies on the caller (`agentExecutionService`) being inside a tx context — but `agentExecutionService` itself uses raw db (Track A F4), so the chain breaks. | low | medium — hook is non-critical (only fires on workflow-driven agent runs), but pattern matches the wider WF3 / Track A F3 gap | Use `getOrgScopedDb('workflowAgentRunHook.notifyOnComplete')` inside the hook. Defer to the wider migration in WF3 / Track A F3 + F4. | 3 |
| WF7 | **`workflowEngineService.tick()` advisory-lock pattern is documented as broken (AR-3.1 deferred).** Line 838-847: `pg_try_advisory_xact_lock` runs in auto-commit mode (no wrapping `db.transaction`), so the xact-level lock releases at statement end, NOT at function end. The comment explicitly says: "The practical effect is contention detection only, not a true serialisation gate. A full fix (wrapping all of tick() in a single db.transaction) is deferred to AR-3.1 resolution and tracked in tasks/todo.md under ## Deferred. The current implementation is safe under pg-boss's own singletonKey deduplication." | low | medium — already known-deferred; framework Rule 14 (idempotency) is satisfied by pg-boss singletonKey | Re-check that the existing AR-3.1 todo entry is still open. If yes, no new finding. If no, re-add. The audit's role here is to verify the comment matches reality. | 3 |
| WF8 | **`workflowRuns.ts:100` — `GET /api/workflow-runs/:runId` gates via `AGENTS_VIEW`.** Same finding family as WF5 — calling this out separately because the GET route's permission is the most user-facing of the inconsistency. A user with `AGENTS_VIEW` but no `WORKFLOW_RUNS_READ` can fetch arbitrary workflow run details by id (org-filter on the service side narrows to their org, but the permission semantics are off). | low | medium — same as WF5 | Subsumed by WF5 fix. | 3 |

---

## Prevention Proposals

| # | Target | Leverage tier | Proposed addition | Closes findings | Severity blocked | Notes |
|---|---|---|---|---|---|---|
| Q1 | `gate` | 1 (block at write time) | Extend `verify-rls-protected-tables.sh` Check 1 to also flag tables that have a `references()` FK to a tenant-scoped parent table but no `CREATE POLICY` statement in any migration AND no `# check2-exempt:` entry in the allowlist. Currently the gate only looks at literal `organisation_id` columns in CREATE TABLE; tenant-scoped data living in FK-only tables slips through. | WF1 | high | The harder version of this check (FK chain analysis) is hard in bash. A weaker form: lint that every schema file with a `pgTable` that references `workflow_runs`/`flow_runs`/`agent_runs`/`subaccount_id` parents either has its own `organisation_id` or is in check2-exempt. |
| Q2 | `gate` | 1 | Add a gate `verify-fk-only-tenant-tables.sh` that walks `server/db/schema/*.ts`, identifies pgTable definitions that reference a tenant-scoped parent but have no `organisation_id` column AND no migration-level `CREATE POLICY` statement, and emits violations. Lower implementation cost than Q1 because it works at the schema-file level rather than parsing migrations. | WF1 | high | Pairs naturally with the existing manifest + allowlist architecture. |
| Q3 | `architecture.md` | 2 (convention at design time) | Document the FK-scoped RLS pattern explicitly: "A table that holds tenant-private data and references a tenant-scoped parent via FK MUST either (a) carry its own `organisation_id` column and an RLS policy keyed on `current_setting('app.organisation_id')`, OR (b) carry an EXISTS-based policy that joins through the parent FK (see `connector_location_tokens`, `document_bundle_members`, `subaccount_baseline_metrics` for examples). The 'FK alone is enough' assumption is incorrect — without an explicit policy, the DB layer offers zero defence." | WF1 | high | One paragraph. References existing examples in the allowlist. |
| Q4 | `DEVELOPMENT_GUIDELINES.md` | 2 | "A pg-boss worker that calls `resolveOrgContext: () => null` MUST re-open a `withOrgTx` block after loading the run/job's organisation from the DB. The opt-out is for the initial cross-tenant lookup only, not for the entire handler body." | WF4 | medium | Codifies the correct pattern. |
| Q5 | `KNOWLEDGE.md` | 3 (lesson via context) | Pattern entry: "FK-scoped tenant data ≠ RLS-protected. workflow_step_runs, workflow_step_reviews, workflow_studio_sessions, flow_step_outputs, workflow_run_event_sequences all live with no Postgres-level isolation despite holding agent payloads + HITL decisions. The audit found this via grepping `migrations/*.sql` for `CREATE POLICY`/`ENABLE ROW` against the table names. Lesson: when a new derived table is added, the check is not 'does the parent have RLS' but 'does THIS table have its own policy'." | WF1 | high | |
| Q6 | `gate` | 1 | Tighten `workflowRuns.ts` permission gating via a new lint gate that flags any `requireOrgPermission(AGENTS_*)` call inside a file matching `server/routes/workflow*.ts`. Forces a deliberate decision: either rename to `WORKFLOW_*` perms or add an inline `// guard-ignore-next-line: <reason>` comment. | WF5, WF8 | medium | Cheap; high-signal. |

---


## Pass 2 Changes Applied

**None.** Every Pass 1 finding (WF1–WF8) is architectural or requires product judgement. Per framework Rule 7 (blast radius control) + Rule 8 (auto-downgrade triggers that touch RLS / multi-tenancy plumbing), none qualifies as a high-confidence mechanical fix. All deferred to Pass 3.

Specifically:
- **WF1** (5 tables missing RLS policies) needs a new migration adding EXISTS-based policies. Migrations are Protected Files (§4) and append-only; this is an architectural change deferred to a dedicated branch.
- **WF2** (god-file) — Area 10 rule: splits are NEVER Pass 2.
- **WF3 / WF4 / WF6** (raw-db patterns) — wide blast radius across `agentExecutionService` / `workflowEngineService` / `workflowAgentRunHook`. Same cluster as Track A F3 / F4 / F7.
- **WF5 / WF8** (permission inconsistency) — requires product call on workflows-as-agents intent.
- **WF7** (advisory-lock comment) — already-known deferred (AR-3.1). Audit's role is to verify the comment still matches reality; no new fix.

### Validation Results

**N/A — no code modified in Pass 2.** Track A2's deliverables are: (1) the audit log, (2) the deferred-items routing in `tasks/todo.md`, (3) the KNOWLEDGE.md pattern entries. No build / typecheck / test commands apply.

---

## Pass 3 Items (Awaiting Human Decision)

Cross-listed in `tasks/todo.md` under `## Deferred from codebase audit — 2026-05-14 (Track A2: workflowEngine split)`.

| Item | Area | Severity | Confidence | Reason for Escalation | Recommendation |
|---|---|---|---|---|---|
| WF1 | RLS / Module I | high | high | Architectural — requires new migration adding EXISTS-based RLS policies on 5 FK-scoped tenant tables | Land migration + allowlist updates in a dedicated branch; pair with Q1/Q2/Q3 prevention |
| WF2 | God-file / Area 10 | medium | high | Splits are never Pass 2 (framework Area 10) | Per-phase decomposition |
| WF3 | RLS / Module I | medium | medium | Architectural — same cluster as Track A F3/F4/F7 | Migrate to `getOrgScopedDb()`; pair with WF4 |
| WF4 | Module J + I | medium | high | Same root cause as WF3; wider blast radius (30+ DB sites in tick) | Refactor `tick()` to wrap rest in `withOrgTx` |
| WF5 | Module A (permissions) | medium | medium | Requires product call | Add `WORKFLOW_RUNS_*` org-tier perms or document workflows-as-agents intent |
| WF6 | RLS / Module I | low | medium | Hook design — defer to WF3 wider migration | Use `getOrgScopedDb()` inside hook |
| WF7 | Module J (idempotency) | low | medium | Already-known-deferred (AR-3.1) | Re-confirm AR-3.1 todo entry exists |
| WF8 | Module A | low | medium | Subsumed by WF5 | No separate action |

---

## Patterns Captured to KNOWLEDGE.md

| Pattern title | Trigger | KNOWLEDGE.md entry |
|---|---|---|
| FK-scoped tenant data tables can ship with zero Postgres-level isolation if no one writes a CREATE POLICY | WF1 — 5 workflow tables with no RLS policy | `[2026-05-14] Pattern — FK-scoped tenant data tables can ship with zero Postgres-level isolation if no one writes a CREATE POLICY` |
| pg-boss worker `resolveOrgContext: () => null` is a footgun if the handler then does scoped work without re-opening withOrgTx | WF4 — workflow tick worker | `[2026-05-14] Pattern — pg-boss worker resolveOrgContext: () => null is a footgun if the handler then does scoped work without re-opening withOrgTx` |

---

## Summary

| Field | Value |
|---|---|
| Overall Status | PASS (audit produced; all findings deferred per architectural / product-call scope) |
| Critical findings | 0 |
| High findings | WF1 — 1 |
| Medium findings | WF2, WF3, WF4, WF5 — 4 |
| Low findings | WF6, WF7, WF8 — 3 |
| Fixes applied (pass 2) | **0** |
| Files modified | 0 (audit log + todo + KNOWLEDGE only) |
| Items deferred to pass 3 (symptom fixes, in `tasks/todo.md`) | 8 (WF1–WF8) |
| Prevention proposals (root-cause fixes, in `tasks/todo.md`) | 6 — breakdown: `gate` × 3 (Q1, Q2, Q6) + `architecture.md` × 1 (Q3) + `DEVELOPMENT_GUIDELINES.md` × 1 (Q4) + `KNOWLEDGE.md` × 1 (Q5) |
| KNOWLEDGE.md entries appended | 2 (FK-scoped data + RLS gap; pg-boss resolveOrgContext footgun) |
| Checkpoint tags created | none |
| Linked `pr-reviewer` log | _(filled when run)_ |
| Linked `spec-conformance` log | _(filled when run)_ |
| Linked `dual-reviewer` log | not requested |

---

## Post-audit actions required

1. `spec-conformance: verify the audit branch audit/track-workflow-engine against its spec` — sanity check (no spec).
2. `pr-reviewer: review the audit branch audit/track-workflow-engine. No Pass 2 code changes; review the audit log, deferred-item routing, and KNOWLEDGE.md additions. Audit log: tasks/review-logs/codebase-audit-log-workflow-engine-2026-05-14T16-30-31Z.md.`

---

## Recommended Next Steps

- **WF1 is the highest-leverage finding** — add the missing RLS policies in a dedicated migration branch before any further work on workflow_step_runs touches a less-trusted code path. Q1/Q2/Q3 prevention proposals are paired with this.
- Coordinate Track A2 PR merge with Track A (PR #308) — same root-cause cluster for the raw-db / org-scoped-db pattern; merging in series avoids tasks/todo.md merge conflicts.
- WF5 product call: decide whether to add `WORKFLOW_RUNS_*` org-tier perms or stay with the workflows-as-agents permission mapping.
- WF2 god-file decomposition can be planned alongside the Track A F6 split work — both files are in the same service tier.
