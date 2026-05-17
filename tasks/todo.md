# tasks/todo.md — Curated Open Backlog

**Last refreshed:** 2026-05-13 (branch `claude/cleanup-todo-knowledge-5ALbK`)

Historical detail for every deferred review-log item lives in `tasks/todo-archive-2026-Q2.md` (verbatim copy of the pre-cleanup file). The source of truth for any single item is its underlying review log under `tasks/review-logs/`.

This file is the **curated** open backlog: cross-cutting items, genuinely-still-open feature gaps, and security/correctness items from recent builds that have not been closed. Anything not listed here is either closed (see git history / archive) or build-specific debt captured in `tasks/builds/<slug>/handoff.md`.

---

## How to use this file

- New items append at the bottom under a dated heading.
- Close items by removing them. Git history is the audit trail; do not leave `[x]` checkboxes lying around.
- When a build merges, its build-specific deferred items move to `tasks/builds/<slug>/handoff.md`. Only cross-cutting items survive into this file.
- If you need the full context for an item referenced here, grep the archive or open its review log directly.

---

## Feature-level open work

### Live Agent Execution Log (LAEL)

Spec: `tasks/live-agent-execution-log-spec.md`. Phase 1 merged on `claude/build-agent-execution-spec-6p1nC`. The following items were explicitly deferred per spec §11.4.

- [ ] [status:absorbed:wave-5-lael] **LAEL-P1-1** — Finish `llmRouter` `llm.requested` / `llm.completed` emission + `agent_run_llm_payloads` writer integration. Files: `server/services/llmRouter.ts` (TODO near `llmInflightRegistry.add()`), `server/services/agentRunPayloadWriter.ts`, `server/services/agentExecutionEventEmitter.ts`. Spec refs §4.5, §5.3, §5.7. Without this, the Live Log shows no "doing" phase between `prompt.assembled` and `run.completed`. Full deferred-item context in archive.
- [ ] [status:absorbed:wave-5-lael] **LAEL-P1-2** — Remaining P1 emission sites: `memory.retrieved` (workspaceMemoryService, memoryBlockService), `rule.evaluated` (decisionTimeGuidanceMiddleware), `skill.invoked` / `skill.completed` (skillExecutor), `handoff.decided` (agentExecutionService). All non-critical except `handoff.decided`. Spec §5.3 + §6.2.
- [ ] [status:absorbed:wave-5-lael] **LAEL-P2** — Edit audit trail (Phase 2). Migration `0194_agent_execution_log_edits.sql`, `agent_execution_log_edits` table, optional `triggeringRunId` query param on memory/rule/skill/data-source edit surfaces, `EditedAfterBanner` component on `AgentRunLivePage`. Spec §8.
- [ ] [status:v2-backlog:lael-phase-3-only] **LAEL-P3 / P3.1** — Retention tiering + cold archive restore (Phase 3). Spec §9 / §9.1.
- [ ] [status:v2-backlog] **LAEL-FUTURE-{1..6}** — Admin-visible drop/gap metrics; trigger-based FK enforcement on `agent_run_llm_payloads.run_id`; `run.created` boundary event; causal grouping for parallel writers; deeper `prompt.assembled` layer attributions; per-run payload-persistence kill-switch. Each item is non-blocking; see archive for full context.

### Hermes Tier 1 — execution-cost deferred follow-ups

Branch `claude/hermes-audit-tier-1-qzqlD` merged 2026-04-21.

- [ ] [status:v2-backlog:hermes-deferred-pre-v1] **H1** — Add `successfulCostCents` to `/api/runs/:runId/cost` response. Removes the cost-per-call divide-by-zero / failed-call bias trap. Touches `shared/types/runCost.ts`, `server/routes/llmUsage.ts`, `client/src/components/run-cost/RunCostPanel.tsx`.
- [ ] [status:v2-backlog:hermes-deferred-pre-v1] **H2** — Rollup-vs-ledger breaker asymmetry (Slack / Whisper). LLM path now uses direct-ledger breaker; Slack / Whisper still rely on `cost_aggregates` async rollup. Becomes a real consistency risk only if those paths become hot.
- [ ] [status:v2-backlog:hermes-deferred-pre-v1] **H3** — `runResultStatus='partial'` coupling to summary presence. Decide whether `!hasSummary` is a downgrade signal or an orthogonal field. Monitor production `partial` rates first.
- [ ] [status:v2-backlog:hermes-deferred-pre-v1] **§6.8 errorMessage gap** — `agentExecutionService.ts:1350-1368`. When `finalStatus === 'failed'` via the normal terminal path, `errorMessage: null` is passed to `extractRunInsights`. Thread `preFinalizeMetadata.errorMessage` into the call. Pre-existing limitation per spec §11.4.

### Sandbox isolation (PR #287)

All actionable items from this section closed by sandbox-safety-batch (PR #326, 2026-05-16). Closed: SANDBOX-ADV-1.1, SANDBOX-ADV-1.2, SANDBOX-ADV-2.1, SANDBOX-ADV-2.2, SANDBOX-ADV-3.1, SANDBOX-ADV-3.2, SANDBOX-ADV-4.1, SANDBOX-ADV-4.2, SANDBOX-ADV-5.1, SANDBOX-ADV-5.2, SANDBOX-ADV-6.1, SANDBOX-R3-T1, plus REQ #6, #11, #20, #28, #29, #31, #35, #36, #55. See `tasks/builds/sandbox-safety-batch/handoff.md`.

- [ ] [status:v2-backlog:waiting-on-e2b-sdk] **SANDBOX-F1** — Real e2b publish/inspect wiring. Currently `templateDigest` falls back to placeholder `local-dev-*` value; publish workflow hard-fails until real e2b integration lands. Tracked by gate `verify-sandbox-template-version`. Cross-references SANDBOX-R3-T2 (placeholder PUBLISHED_VERSION acceptable only because version is `local-dev-*`).
- [ ] **REQ #57** — Credential value-threading into `/workspace/secrets/` (medium, v2-deferred). Reason: e2b SDK not installed in V1 per SANDBOX-DEF-EGRESS-MECH. Stub at e2bSandbox.ts declares intent; lands with the SDK in the follow-up build. See `tasks/builds/sandbox-safety-batch/req-57-decision.md`.

### Personal Assistant V1 (PR #291, merged 2026-05-12)

All originally-tracked deferred items closed by the 2026-05-13 deferred-sweep PR (branch `claude/close-deferred-pa-v1-13lHR`). Adversarial fixes (atomicity, cross-org filter, rate-cap scope, prompt-injection escape) shipped as code changes; spec-conformance gaps split between code amendments (CAL2, EA1, EA4, EA5, C3, CAL3-naming owner-mismatch, M9) and spec amendments (C4, T8, C1, EA3, M15-code-aligned, CAL3-naming error-code family). See:
- Code: `server/services/{eaDrafts,triggers,slack,calendar,homeWidget}/`, `server/services/actionService.ts`, `server/jobs/workflowGateStallNotifyJob.ts`, `server/config/actionRegistry/{calendar,slack}.ts`, `client/src/config/sidebar.ts`.
- Migration: `migrations/0343_ea_home_widget_spec_align.sql` — data-only seed update for EA template's `home_widget` + `default_org_skill_slugs`.
- Spec: `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` — amendments dated 2026-05-13 in the header + inline in §§7.1, 7.4, 8.4, 13.4, 14.1.

#### Follow-up surfaced during the 2026-05-13 sweep

_(EA-V1-FOLLOWUP-1 resolved 2026-05-13 — ChatGPT PR #296 round 2 review (REVIEW-F2) made the substantive scope-reassessment that multiple drafts of the same kind per run is a real product flow. Idempotency key now carries a stable per-call discriminator (`targetRef` or hashed `{ kind, body }`); migration 0344 adds `UNIQUE(proposal_action_id)` on `ea_drafts` as defence-in-depth. Spec §7.5 + eighth-pass amendment block. See `tasks/review-logs/chatgpt-pr-review-claude-close-deferred-pa-v1-13lHR-2026-05-13T06-43-44Z.md` Round 2.)_

---

## Cross-cutting / infrastructure

### Auth & Security (pre-prod-boundary-and-brief-api)

- [ ] **In-memory rate limiting lost on restart; bypassed in multi-process** — `server/routes/auth.ts:14-30`. Originally captured in 2026-04-01 audit (#21). Pending Phase 2 of pre-prod-boundary-and-brief-api.
- [ ] **Multer memory storage accepts 500MB — OOM DoS risk** — `server/middleware/validate.ts:17-20`. Pending Phase 1 of pre-prod-boundary-and-brief-api.

### Test infrastructure

- [ ] [status:v2-backlog:test-infra-non-blocking] **TI-001** — Make `build-code-graph-watcher.test.ts` parallel-safe.
- [ ] [status:v2-backlog:test-infra-non-blocking] **TI-006** — Canonical subaccount UUID for integration fixtures.
- [ ] [status:v2-backlog:test-infra-non-blocking] **TI-007** — Integration test conventions doc — real-DB vs mocked-DB rule.
- [ ] [status:v2-backlog:test-infra-non-blocking] **TI-008** — Configure CI with a non-superuser app role for RLS coverage.

### CI gate hardening (Phase 4 pre-launch)

- [ ] [status:v2-backlog:ci-hardening-non-blocking] **CHATGPT-R3-1** — Extend CI grep invariants to cover the remaining four pre-launch B.4 categories.
- [ ] [status:v2-backlog:ci-hardening-non-blocking] **CHATGPT-R3-2** — Canonical error taxonomy: enumerate every `error.code` string in production and lock to a typed union.
- [ ] [status:v2-backlog:ci-hardening-non-blocking] **CHATGPT-R3-6** — Audit event namespace consistency: extend `verify-audit-namespace.sh` to detect dynamic construction.
- [x] [status:closed:pr:329] **CHATGPT-R1-7** — OAuth state JWT window: tightened from 10min to 5min in pre-launch-phase-2. Confirmed 2026-05-16 — no real auth failures observed over the 30-day telemetry window; the 5min window remains the canonical posture (operator decision per launch prompt foundational section). Reverts not required.
- [x] **TI-001** — Make `build-code-graph-watcher.test.ts` parallel-safe. [status:closed:wave-4-session-i-prime]
- [x] **TI-006** — Canonical subaccount UUID for integration fixtures. [status:closed:wave-4-session-i-prime]
- [x] **TI-007** — Integration test conventions doc — real-DB vs mocked-DB rule. [status:closed:wave-4-session-i-prime]
- [x] **TI-008** — Configure CI with a non-superuser app role for RLS coverage. [status:closed:wave-4-session-i-prime] — infrastructure landed (migrations 0364 synthetos_app role + 0366 admin_role DML grants; CI sets the role password), but the test-runner DATABASE_URL swap is deferred — see TI-008-FOLLOWUP below.
- [ ] **TI-008-FOLLOWUP** — Re-enable the `DATABASE_URL: ${{ env.DATABASE_URL_TEST }}` env override on the `Run integration tests` step in `.github/workflows/ci.yml`. Currently disabled in `claude/wave-4-quality-hardening` because ~10 integration test files call production service code directly without setting up the per-request `app.organisation_id` GUC that middleware normally provides. Under the synthetos_app role (NOBYPASSRLS) those direct calls fail RLS. Fix: add a `withTestOrgContext(orgId, fn)` helper that wraps the test body in a `db.transaction` issuing `SELECT set_config('app.organisation_id', ${orgId}, true)` before invoking production code, then thread it through every failing integration test. Affected files: `server/services/__tests__/reviewServiceIdempotency.test.ts`, `workspaceMemoryService.test.ts`, `llmRouterLaelIntegration.test.ts`, `rls.context-propagation.test.ts`, `supportAgentInstall.integration.test.ts`, `workflowEngineApprovalResumeDispatch.integration.test.ts`, `server/services/crmQueryPlanner/__tests__/integration.test.ts`, `server/routes/__tests__/briefsArtefactsPagination.integration.test.ts`, `conversationsRouteFollowUp.integration.test.ts`, `sessionMessage.test.ts`, `workspaceAgentScope.test.ts`. Also: cleanup helpers in `supportAgentInstall.integration.test.ts` afterEach try to DELETE from `organisations` before subaccount rows — surface as FK errors under synthetos_app even with admin_role; wrap entire cleanup in admin_role transaction.

### CI gate hardening (Phase 4 pre-launch)

- [x] **CHATGPT-R3-1** — Extend CI grep invariants to cover the remaining four pre-launch B.4 categories. [status:closed:wave-4-session-i-prime] — landed as `scripts/verify-pre-launch-invariants.sh` (4 new passes: test-framework imports, feature-flag introductions, introduce-then-defer stubs, @ts-ignore/nocheck).
- [x] **CHATGPT-R3-2** — Canonical error taxonomy: enumerate every `error.code` string in production and lock to a typed union. [status:closed-v1:wave-4-session-i-prime] — v1 ships `shared/types/errorCodes.ts` (275 codes) + `scripts/verify-error-code-taxonomy.sh` in baseline mode (baseline 419 callsites). v2 follow-up below migrates the existing call sites in batches.
- [ ] **CHATGPT-R3-2-V2** — Migrate the 419 legacy `errorCode: '<literal>'` callsites to import `ErrorCode` from `shared/types/errorCodes.ts`. Tighten the baseline in `scripts/guard-baselines.json` after each batch; final state flips the gate from baseline-mode to strict-mode and removes the `error-code-taxonomy` entry. Batches by domain: routes → services → jobs.
- [x] **CHATGPT-R3-6** — Audit event namespace consistency: extend `verify-audit-namespace.sh` to detect dynamic construction. [status:closed:wave-4-session-i-prime] — added Pass 5 (multi-line dynamic eventType detection) to `scripts/verify-audit-event-namespace.sh`.
- [ ] **CHATGPT-R1-7** — OAuth state JWT window: tightened from 10min to 5min in pre-launch-phase-2. Revert pending telemetry — confirm 5min causes no real auth failures over 30 days, then close.

### Documentation / process

- [ ] **OAuth state security audit trail** — `auth.login.failure` / `auth.login.success` / OAuth state events / abuse events now live in `security_audit_events` (migration 0281). Architecture.md §Layer 4 documents the stream split. Operator action: confirm dashboards in Grafana / Mission Control surface the new stream before deprecating the legacy `audit_events` records.

## From builder — 2026-05-13

- **PA-V2-C4-1** [status:closed:pr:#299] — `cross_owner.ask_initiator_decision` action type registered in `server/config/actionRegistry/`. Verified shipped in PR #299 by Wave 4 Session I' audit.
- **PA-V2-C4-2** [status:closed:pr:#299] — `validateEventPayload` switch in `server/services/agentExecutionEventServicePure.ts` now handles `cross_owner_substep.awaiting_initiator_decision` and `.completed`. Verified shipped in PR #299 by Wave 4 Session I' audit.
- **PA-V2-C4-3** — `server/services/actionService.ts` line 2: `createHash` imported from `'crypto'` but unused — pre-existing dead import, not introduced by this chunk.
- **PA-V2-C4-4** [status:closed:wave-4-session-i-prime] — confirmed during Wave 4 Session I' grep sweep: no stale `isActive(actions)` / `actions.deletedAt` text remains in the PA-V2 operator spec. The note appears to have been removed in a prior PR; the tasks/todo.md entry was simply outdated.

---

## Closed by memory-improvements (PR #298, 2026-05-13)

REQs #20, #38, #41, #64 — all closed by Phase 2 fix-loop R2 (backfill) plus chatgpt-pr-review R1+R2:
- REQ #20: `MemoryBlockSourcesPayload` reshaped to spec §6.1 nested form; UI + tests updated.
- REQ #38: `memoryUtilityAggregatorPure.ts` + `.test.ts` shipped (9 named cases per spec §12.1).
- REQ #41: top-level `organisationId / generatedAt / windowDays:30` + 4 totals fields added.
- REQ #64: `pendingDegradedReason` threaded through to `RetrievalResult.degradedReason` at emission sites.

REQ #67 — `docs/capabilities.md` partially addressed: "Memory Injection Utility" entry added (B2 dashboard capability). A (lineage) and D (AKR semantic ranker) intentionally not catalogued as separate capabilities; both are operator-facing infrastructure rather than customer-visible product features. Rationale recorded in plan §10.

REQ #68 — Opportunistic cleanup (env-overridable `MEMORY_BLOCK_TOP_K` / `MEMORY_BLOCK_POOL_MULTIPLIER`): explicit operator deferral. Spec says "Not required for the spec to land." Move to follow-up backlog or close as won't-do.

---

## Known un-built / low-priority

These are noted to prevent re-discovery — none are urgent.

- Route files exceeding ~200 lines: `subaccounts.ts` (758L), `permissionSets.ts` (587L), `llmUsage.ts` (524L), `portal.ts` (502L). Split when domain-touching work lands.
- Auth tokens stored in localStorage (XSS risk — migrate to httpOnly cookies later).
- Silent promise rejections in `workspaceMemoryService.ts`.
- Missing cascade delete rules on parent-child task/agent relationships.
- Deprecated columns in agents schema (`sourceTemplateId`, `sourceTemplateVersion`).
- No refresh token rotation on OAuth integrations.

---

## Deferred spec decisions — personal-assistant-v2-operator

From `spec-reviewer` iteration 1 against `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md` (2026-05-13). PA-V2-OP-S1 and PA-V2-OP-S2 RESOLVED 2026-05-13 by operator via spec-coordinator decision prompt; the spec now encodes both decisions directly. Items below retained for audit trail.

- RESOLVED 2026-05-13: **PA-V2-OP-S1** — strategy (a): new table `operator_run_files`. Migration 0353 creates the table keyed on `agent_run_id → agent_runs.id` with full column set, UNIQUE `(agent_run_id, path)`, RLS policy filtering on the row's own `organisation_id`, plus an entry in `server/config/rlsProtectedTables.ts`. Spec §4.1 + §6.1 + §13 #1 updated. No longer blocks Chunk 7.

- RESOLVED 2026-05-13: **PA-V2-OP-S2** — strategy (a): extend `delegation_outcomes`. Migration 0352 (`0352_delegation_outcomes_cross_owner_state.sql`) adds three columns: `cross_owner_approval_timeout_policy TEXT NULL`, `substep_status TEXT NOT NULL DEFAULT 'proposed'` (canonical §9.7 vocabulary), `terminal_at TIMESTAMPTZ NULL`, plus a partial index on `(run_id, substep_status) WHERE terminal_at IS NULL` for the §9.4 uniqueness predicate. Spec §4.1 + §5.4 + §9.4 + §13 #2 updated. No longer blocks Chunk 3.
   
   Spec-reviewer (iteration 3) recommends strategy (a). Operator/architect input needed; spec encodes both options in §13 open question #2.

- [ ] [status:v2-backlog:informational] **PA-V2-OP-INFO-1** — The orchestrator routing module path was previously TBD in §4.3. Spec-reviewer resolved it to `server/tools/capabilities/capabilityDiscoveryHandlers.ts` (entry point: `executeCheckCapabilityGap`, dispatched by `server/services/skillExecutor.ts:1767-1770`). Informational only; recorded here so the next implementer/audit can confirm the path before Chunk 2 begins.

- [ ] [status:v2-backlog:informational] **PA-V2-OP-INFO-2** — During spec authoring §13 listed an open authoring question: whether `runTraceProjectionForViewer` deserves a dedicated `*Pure.ts` split. Defers to the implementer's judgement on test surface during Chunk 3. No action needed pre-implementation.

## From builder — 2026-05-13

- **PA-V2-OP-C3-NOTE-1** — `GET /api/agent-runs/:id/trace-events` was not modified by Chunk 3. The spec says to apply `runTraceProjectionForViewer` to both `trace-events` and `trace` endpoints, but `trace-events` returns a `toolCallsLog` (LLM tool call objects without an `eventType` field — already role-projected via `projectForRole`). Applying the viewer projection to this endpoint would require either a different projection strategy or a new endpoint-specific filter. The `trace` endpoint was modified as specified. The `trace-events` gap should be reviewed when the full privacy model for LLM payload drilldown is defined (spec §5.4 may need a supplementary clause for tool-call payloads).
- **PA-V2-OP-C3-NOTE-2** — `authorise()` in `executeCheckCapabilityGap` returns `fail_closed` (with `clarifying_question`) whenever no cross-owner signal is detected (no possessive pattern AND no trusted tool-call payload). This means every `check_capability_gap` call with intent text that doesn't include a possessive name reference will receive a `cross_owner_clarification_required` error. If this proves too aggressive in production (false-positive clarification prompts for ordinary tasks), the fix is to make `authorise` return a fourth outcome (`{ authorised: false, clarifying_question: null }`) when no cross-owner intent was detected, and only surface the question when a pattern was detected but couldn't be resolved. Needs spec amendment.

---

## Cross-owner approver wiring (adversarial finding, post-V2-build)

`server/services/actionServicePure.ts:14` — `deriveApproverUserId` is exported and tested but never called from production code. The spec (§5.5) requires cross-owner action proposals to set `approver_user_id = executor_agent.owner_user_id`. The wiring requires:
1. Adding `executorOwnerUserId?: string | null` to `MiddlewareContext` in `server/services/middleware/types.ts`
2. Populating it in the agent execution loop when the run has `agentRuns.ownerUserId` set AND the run is a cross-owner sub-run (detected via `agentRuns.parentRunId` + `delegation_outcomes.substep_status = 'awaiting_cross_owner_approval'`)
3. Calling `deriveApproverUserId({ isCrossOwner: ..., executorOwnerUserId: ctx.executorOwnerUserId })` in `proposeActionMiddleware.ts` and passing the result as `approverUserId` to `actionService.proposeAction`

Risk: without this wiring, cross-owner EA actions default to `approver_user_id = NULL` (initiator-defaulted path), meaning any org user with REVIEW_APPROVE can approve them rather than exclusively the executor's owner.

Workaround: Fix 5 (approveItem gate in reviewService) partially mitigates this by blocking wrong approvers, but only after an explicit approver is set. When approverUserId is NULL, Fix 5 is a no-op (the `!== null` guard doesn't fire).

Discovered by: adversarial-reviewer, 2026-05-14.

## Deferred from spec-conformance review — personal-assistant-v2-operator (2026-05-13)

**Captured:** 2026-05-13T20:55:39Z
**Source log:** `tasks/review-logs/spec-conformance-log-personal-assistant-v2-operator-full-2026-05-13T20-55-39Z.md`
**Spec:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`

- [ ] **PA-V2-CONFORMANCE-1** — `operator_run_files.subaccount_id` nullability divergence
  - Spec section: §4.1 (migration 0353 column list)
  - Gap: Spec specifies `subaccount_id UUID NOT NULL`. Migration 0353 adds the column as NULL (and Drizzle schema `server/db/schema/operatorRunFiles.ts` mirrors this without `.notNull()`). Spec inventory is explicit about NOT NULL.
  - Suggested approach: Author a new follow-up migration (0357 or later) to backfill any NULL `subaccount_id` from `agent_runs.subaccount_id`, then add `SET NOT NULL`. Update Drizzle schema in the same PR. Alternative: amend spec §4.1 if the operator decides the looser constraint is correct (a backfill via FK may surface migration-time pain that the spec did not anticipate).

- [ ] **PA-V2-CONFORMANCE-2** — Initial-context bundler reads timezone from `subaccount_agents.scheduleTimezone`, not `users` table
  - Spec section: §5.8 (`owner_identity.timezone`), §4.2 bundler row ("Reads ... `users WHERE id = ea.owner_user_id` for timezone + working hours")
  - Gap: `server/services/operatorSessionInitialContextBundler.ts:115-128` reads `subaccount_agents.scheduleTimezone`. Spec said to read `users` for timezone. `working_hours` and `recent_activity_summary` are hard-coded to null/omitted (spec said to populate them from `users` table and the existing summary store).
  - Suggested approach: confirm which is the canonical timezone source for the EA's owner (the spec was written before this implementation choice was finalised; if `users` doesn't carry a timezone field today, amend spec to point at `subaccount_agents` and add a note in §5.8 about the data source). Working-hours/recent-activity-summary are explicitly deferred — call this out in the spec or in the bundler comment, not silently.

- [ ] **PA-V2-CONFORMANCE-3** — `operatorSessionLifecycleService.startSession` has zero production callers
  - Spec section: §4.3 ("At session start (`operator_runs` insert path), call `operatorSessionInitialContextBundler` for EA-templated operator sessions; serialise into the operator runtime's start payload.")
  - Gap: `startSession` exists in `server/services/operatorSessionLifecycleService.ts:117-125` and delegates to the bundler, but no code in `server/` invokes it. The "operator_runs insert path" never reads the bundle.
  - Suggested approach: Wire `startSession` into the operator-run insertion path (likely `operatorSessionService.ts` or `operatorChainResumeService.ts`). If the operator runtime is infra-managed and runtime integration is genuinely out of scope for V1 CI, document the deferral explicitly in `tasks/builds/personal-assistant-v2-operator/handoff.md` and amend spec §4.3 to mark the row "deferred to runtime integration."

- [ ] **PA-V2-CONFORMANCE-4** — `operatorSessionService.handleFileWriteToolCall` has zero production callers
  - Spec section: §4.3 ("Wire the file-event bridge into the operator-session tool-registry handler so file-write tool calls trigger `operatorSandboxFileEventBridge.handle*` before returning to the runtime.")
  - Gap: `handleFileWriteToolCall` exists in `server/services/operatorSessionService.ts:625-637` and routes to the bridge, but no code path invokes it. The operator-runtime tool-registry does not call back into this handler.
  - Suggested approach: same as PA-V2-CONFORMANCE-3 — runtime tool-registry wiring is the missing piece. Either ship the wiring (likely in operatorSessionService at the runtime ↔ host bridge boundary) or document the deferral in handoff.md and spec §4.3.

- [ ] **PA-V2-CONFORMANCE-5** — File event payload shape diverges from spec §5.7 sketch
  - Spec section: §5.7 (`OperatorFileEvent` type)
  - Gap: Code in `shared/types/operatorEvents.ts` uses `eventType` (spec: `type`), `sizeBytes` (spec: `size`), and OMITS `emittedAt` entirely. The `eventType`/`sizeBytes` renames bring the payload into convention with the rest of `AGENT_EXECUTION_EVENT_CRITICALITY` (enforced by `verify-operator-event-registry.sh`) — likely deliberate convergence. `emittedAt` absence is harder to justify: spec lists it as a required field.
  - Suggested approach: amend spec §5.7 contract to use the registry-conventional field names (`eventType`, `sizeBytes`); decide whether `emittedAt` should be added to the payload (it's somewhat redundant with the row-level `eventTimestamp` set by `appendEvent`, but the spec said the FE consumes it). Two cleanest paths: (a) add `emittedAt: new Date().toISOString()` inside the `appendEvent` payload in `operatorSandboxFileEventBridge.ts` to satisfy spec; (b) amend spec to drop `emittedAt` from the payload contract and document `eventTimestamp` as the canonical source.

- [ ] **PA-V2-CONFORMANCE-6** — `runTraceProjectionForViewer` does not strip per-state timestamps from cross-owner substep rows
  - Spec section: §5.4 ("Initiator-visible lifecycle timing invariant")
  - Gap: The projection helper at `server/services/runTracePure.ts:26-42` filters only by event-type prefix. The spec requires an allow-list of timestamp fields when projecting cross-owner sub-step ROWS (not events) to the initiator (`authorised_at`, `routed_at`, `executing_started_at` and any other lifecycle-state timing field on `delegation_outcomes` must be owner-private by default).
  - Suggested approach: extend the projection helper with a substep-row projection mode that takes a `delegation_outcomes` row and returns a redacted shape with only coarse status visible. Apply it in `agentExecutionEventService` whenever a cross-owner sub-step row is serialised on the read path. Add a pure-function test exercising the allow-list. Open question for the implementer: do any read paths surface `delegation_outcomes` rows directly to the initiator today? If not, this can be deferred until a consumer is added — capture as a precondition note in `architecture.md` so the next consumer wires it.

- [ ] **PA-V2-CONFORMANCE-7** — `recomputeCapabilityMapWithOwner(tx?)` is not invoked from any `agents.ownerUserId` write path
  - Spec section: §6.4 ("When `agents.owner_user_id` is changed (rare — typically only on re-seeding or user reassignment), `capability_map.owner_user_id` MUST be recomputed in the same transaction.")
  - Gap: The function exists with a `tx` parameter, but `agents.ownerUserId` has no current mutation surface in production code, so the invariant is unenforced. If a future surface lands without invoking the recompute, the capability map will silently drift. The `verify-capability-map-shape.sh` gate would catch the drift after the fact, but not at write time.
  - Suggested approach: add an architecture.md note + an `architecture-rules` test that asserts any future `agents.ownerUserId` write site calls `recomputeCapabilityMapWithOwner(subaccountAgentId, tx)` inside the same transaction. Or accept the gate-only enforcement and document.

- [ ] **PA-V2-CONFORMANCE-8** — Sandbox file-watcher IPC will not deliver events
  - Spec section: §4.5 (sandbox-template change)
  - Gap: `infra/sandbox-templates/operator-session/entrypoint.sh:9` launches `node /workspace/file-watcher.js &` as a backgrounded shell process. `process.send` requires `child_process.fork()`, so the watcher's `sendIpc` calls fall through to the "IPC not available" branch and the events are dropped.
  - Suggested approach: the sandbox-template is explicitly infra-managed (Dockerfile header: "PLACEHOLDER: not built by V1 CI. Real build and publish is managed by the Operator Backend infra pipeline."). Either replace the entrypoint with a Node parent process that forks the watcher and bridges IPC over the runtime ↔ host channel, or document the runtime-side contract the infra pipeline must satisfy. Tracked here so future infra work doesn't ship the watcher in a non-functional state.

- [x] **PA-V2-LIST-APPROVALS-V1-ARM** — wire V1 initiator-defaulted arm into listPendingApprovalsForUser [status:closed:wave-4-session-i-prime]
  - Origin: chatgpt-pr-review Round 1 F5 (PR #299, personal-assistant-v2-operator).
  - Resolution: `listPendingApprovalsForUser` now unions Arm 1 (`approver_user_id = $userId`) and Arm 2 (`approver_user_id IS NULL` JOIN `agent_runs.acting_as_user_id = $userId`) with a defensive dedupe set. Org predicate retained on both arms.

- [ ] **PA-V2-WATCHER-HOST-BRIDGE** — host-side IPC handler that reads sandbox file content
  - Origin: chatgpt-pr-review Round 1 F1 (PR #299, personal-assistant-v2-operator).
  - Context: `infra/sandbox-templates/operator-session/file-watcher.js` sends metadata-only IPC payloads (path, sha256-hint, sizeBytes, emittedBy). The canonical `operatorSandboxFileEventBridge.handleWatcherEvent` requires `content: Buffer`. A host-side bridge is needed to read the file from the sandbox shared volume and call `handleWatcherEvent` with the populated payload.
  - Why deferred: the operator-session sandbox template is explicitly placeholder-only (`README.md`, `Dockerfile`, `entrypoint.sh` all declare PLACEHOLDER status; real implementation lands with the Operator Backend infra pipeline). Pairs with `PA-V2-CONFORMANCE-8` (same infra deliverable, same template).
  - Suggested approach: spawn watcher.js via `child_process.fork()` from a Node parent (replaces the current sh-backgrounded approach). The parent receives the metadata payload, opens the file from the mounted sandbox volume, calls `handleWatcherEvent({ ...payload, content })` against the canonical bridge. Apply a size cap (10 MB suggested) before reading.

- [ ] **PA-V2-OPERATOR-TEMPLATE-PROMOTION** — promote operator-session template to a CI-built artefact
  - Origin: chatgpt-pr-review Round 1 T2 (PR #299, personal-assistant-v2-operator).
  - Context: `infra/sandbox-templates/operator-session/` currently contains active runtime logic (chokidar watcher, Dockerfile, entrypoint.sh) but is documented as PLACEHOLDER and is not built/scanned/tested by V1 CI. ChatGPT flagged this as a grey-zone risk — production-relevant code outside CI coverage, especially the sandbox-side file-access path.
  - Why deferred: real implementation lands with the operator-backend spec; this PR is intentionally consistent with the placeholder framing per the template's own README (`Placeholder scaffolding. Real implementation lands with the Operator Backend spec; V1 CI does not build, scan, or publish this template.`).
  - Suggested approach: once operator-backend activates this directory, extend `verify-template-version-coherence` to include the path, add a Dockerfile build job in CI, run security scans on the built image, and add an integration test that the watcher's IPC payload matches `WatcherFileEventInput`'s expected shape.

- [x] **PA-V2-EVENT-IDEMPOTENCY** — content-keyed idempotency in appendEvent [status:closed:wave-4-session-i-prime]
  - Origin: chatgpt-pr-review Round 3 F10/F11 residual edge case (PR #299, personal-assistant-v2-operator).
  - Resolution: migration 0365 adds `agent_execution_events.idempotency_key` (nullable text) + partial UNIQUE index on `(run_id, event_type, idempotency_key) WHERE idempotency_key IS NOT NULL`. `AppendEventInput` gains optional `idempotencyKey`; the insert uses `onConflictDoNothing` and skips emit/presence side effects when the second write deduplicates. `crossOwnerApprovalTimeoutSweep` passes keys derived from substep + outcome and drops the stale-claim TTL workaround entirely (the `claimTerminalEventEmit` / `claimAwaitingInitiatorEventEmit` helpers were removed).

## Blockers

_None active._

When you hit a stuck-detection condition (per CLAUDE.md §1), append a Blocker subsection here with: what was attempted, exact failure, root-cause hypothesis, what you'd try next.

---

## Calendar

- [ ] [2026-06-12] Complete tasks/builds/iee-browser-on-e2b/cost-report-month-1.md from observed production traffic.

---

## iee-browser-on-e2b — deferred TODOs to wire when paths become live

These are dead-code TODOs accepted as non-blocking by pr-reviewer + reality-checker + chatgpt-pr-review Round 1 (PR #297). They are listed here so they don't get lost when the relevant code paths get wired up.

- [ ] [status:v2-backlog:dead-code-pending-live-traffic] **IEE-DEF-1** — `server/services/sandbox/browserWarmPool.ts::evictStale` outer FOR UPDATE SKIP LOCKED needs `withAdminConnection` for cross-tenant sweep. Currently dead code (zero callers); wire when warm-pool eviction is scheduled.
- [ ] [status:v2-backlog:dead-code-pending-live-traffic] **IEE-DEF-2** — `server/services/sandbox/browserWarmPool.ts::refillIfEligible` needs `organisationId` on its context and `setOrgAndSubaccountGUC` wrapping; currently inserts stub sandbox IDs (`stub-${randomUUID()}`). Wire when warm-pool refill is wired to a caller (today: dead code, zero callers).
- [ ] [status:v2-backlog:dead-code-pending-live-traffic] **IEE-DEF-3** — `server/services/sandbox/ieeBrowserProfileManager.ts::gcSweep` cross-tenant sweep needs `withAdminConnection`. Currently dead code; wire when profile GC is scheduled.
- [ ] [status:v2-backlog:dead-code-pending-live-traffic] **IEE-DEF-4** — `infra/sandbox-templates/iee-browser/` template is not yet buildable. Add CI sandbox-template-build pipeline when the e2b SDK is installed (SANDBOX-DEF-EGRESS-MECH). Pipeline: bundle `harness/index.ts` to `harness/dist/index.js`, publish image, write real digest into `PUBLISHED_VERSION`. Until then `assertNotLatestTemplateVersion` rejects the all-zero placeholder so production cannot accidentally use this template.
- [ ] [status:v2-backlog:dead-code-pending-live-traffic] **IEE-DEF-5** — Wire real Playwright executor into `infra/sandbox-templates/iee-browser/harness/index.ts`. Today the stub writes `status:'failed'` so any accidental deploy fails visibly. Pull the reference implementation from `worker/src/browser/executor.ts` when bundling.
- [ ] [status:v2-backlog:dead-code-pending-live-traffic] **IEE-DEF-6** — Pre-existing host-disk profiles (`BROWSER_SESSION_DIR`) migration decision was deferred during Phase 2 chunk 5 as no-op given dogfood-first launch. Revisit if production traffic shows profile-data continuity is needed across the substrate switch.
- [ ] [status:v2-backlog:dead-code-pending-live-traffic] **IEE-DEF-7** — Wire production network policy in `server/services/executionBackends/_ieeShared.ts::ieeDispatchBrowser` policy build. Today `network.mode='none'` makes Playwright tasks unable to navigate. Decide before any subaccount flips `rolloutApproved=true`: allowlist per skill, allowlist per subaccount, or open. The SDK-not-installed factory + `assertNotLatestTemplateVersion` placeholder guard prevent dispatch from reaching production today.
- [ ] [status:v2-backlog:dead-code-pending-live-traffic] **IEE-DEF-8** — Implement real assertions in `server/services/sandbox/__tests__/ieeBrowserProfileManager.serialization.test.ts`. Today the file is a scaffold gated behind `E2B_E2E=true`; the only assertion is a placeholder. Lands with the e2b SDK install + a real provider client so the test can spawn two concurrent mounts and assert serialisation + cross-tenant safety per spec §15 R2-F6.
- [ ] [status:v2-backlog:dead-code-pending-live-traffic] **IEE-DEF-9** — Add `template_name = 'iee-browser'` AND compatible-`template_version` filter to `browserWarmPool.checkout()` SELECT. Today only one template exists and refill is RUNTIME-DISABLED, so this is a forward-looking invariant. Wire before refillIfEligible (IEE-DEF-2) goes live, otherwise checkout could lease a warm session created against an incompatible template digest.

---

## skill-merge-consolidation-pass — deferred (Phase 2 close 2026-05-14)

From the branch-level review pass on `claude/improve-skill-analyzer-RiFpB`. None are blocking for the build; all are advisory/non-blocking items routed for follow-up.

**From adversarial-reviewer (Phase 1 advisory):**

- [ ] **SKILL-MERGE-RLS-1** — Add `skill_analyzer_results` to `server/config/rlsProtectedTables.ts` with a join-based policy via `skill_analyzer_jobs.organisation_id`. The new `pre_consolidation_merge` JSONB column adds more sensitive content to a pre-existing RLS gap. Also add `-- system-scoped: singleton row, no per-org data` to `migrations/0358_skill_merge_consolidation.sql` for the `skill_analyzer_config` ALTER block. Reference: `tasks/review-logs/adversarial-review-log-skill-merge-consolidation-pass-2026-05-14T02-39-41Z.md` finding 1.
- [ ] [status:v2-backlog:advisory] **SKILL-MERGE-INJECTION-1** — Decide whether to guard the `instructions` field in `parseConsolidationResponse` against mutation (the existing `name/description/definition/mergeRationale` mutation guards leave `instructions` open to second-order prompt injection from a jailbroken upstream LLM). Accept the residual risk on system-admin-only surface, or add an `instructions`-length / heuristic guard.
- [ ] [status:v2-backlog:advisory] **SKILL-MERGE-BUDGET-1** — Verify whether `systemCallerPolicy: 'bypass_routing'` exempts consolidation calls from per-org LLM budget guards. If yes, add a per-job consolidation-call cap or budget-aware skip. File: `server/jobs/skillAnalyzerJob.ts` ~lines 1289-1306.
- [ ] [status:v2-backlog:advisory] **SKILL-MERGE-AUDIT-1** — Decide whether to add a durable `agent_execution_events`-style audit row for consolidation transformations (today the trail is logger-only).
- [ ] **SKILL-MERGE-AUTHGATE-1** — Verify the config-update route serving `consolidationEnabled` / `consolidationTriggerSeverity` is gated by `requireSystemAdmin`, not a tenant-scoped admin middleware.
- [ ] [status:v2-backlog:advisory] **SKILL-MERGE-RESET-UX-1** — Confirm Reset-button semantics change (Reset now rolls back to the consolidated draft on success; the first-pass LLM merge is only accessible via the read-only disclosure panel). Discoverability check with operator before merge.

**From pr-reviewer (round 3, non-blocking):**

- [ ] [status:v2-backlog:advisory] **SKILL-MERGE-TEST-1** — Add direct test coverage for the `postWords >= preWords` outcome-classification decision (the new `not_shortened` branch from dual-reviewer's fix). Easiest path: extract a small pure helper `classifyConsolidationOutcome({ preWords, postWords })` from `server/jobs/skillAnalyzerJob.ts` ~line 1407 and Vitest it. Reference: `tasks/review-logs/pr-review-log-skill-merge-consolidation-pass-2026-05-14T03-15-00Z.md` Should-fix #2.
- [ ] [status:v2-backlog:advisory] **SKILL-MERGE-COPY-1** (Consider/Nit) — Map `failureReason` enum values to plain-English copy in `MergeReviewBlock.tsx` failed banner (today the value renders verbatim, e.g. `Reason: not_shortened` — opaque to non-technical reviewers). Reference: round-3 pr-review-log Consider section.

**From chatgpt-pr-review (Phase 3, Round 1):**

- [ ] [status:v2-backlog:advisory] **SKILL-MERGE-RATIONALE-1** (Consider/Nit) — Short-circuit the consolidation gate when `mergeRationale` is null upstream, instead of routing to `parseConsolidationResponse` and letting it reject with `rationale_missing_or_invalid`. Today the LLM is prompted to always echo a rationale and fallback paths backfill it, so the null-path is theoretical — but a 2-line guard at the consolidation gate (`server/jobs/skillAnalyzerJob.ts` ~line 1267) would avoid one wasted LLM call per occurrence. Reference: chatgpt-pr-review Round 1 finding F5 (defer).

---

## Deferred from codebase audit — 2026-05-14

**Captured:** 2026-05-14T04-49-08Z
**Source log:** `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`
**Branch:** `audit/full-pre-v1-lockdown-2026-05-14`
**Pass 2 already shipped on the audit branch:** Area 1 dead skill-analyzer subtree (~4,114 LOC); two static-import deps + two optional DOCX deps; framework §2 v1.3 → v1.4 refresh.

### Critical

- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:318] **Route → DB layer breach in `server/routes/support/supportAgentRoutes.ts`**. Lines 6, 35-46, 74+ import the `canonicalInboxes` schema table object and build Drizzle `.select().from(canonicalInboxes).where(...).orderBy(...)` queries inside the route handler. Bypasses route → service → db cascade. Gate `scripts/verify-no-db-in-routes.sh` has it in baseline. critical/high. Extract `supportAgentInboxService`; tighten gate baseline.

### High

- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:329] **Area 10 god-file register — hard-cap breaches** — Verified 2026-05-16: all 8 files now under hard cap. `server/services/skillExecutor.ts` 4 LOC (barrel, PR #317), `workflowEngineService.ts` 64 LOC (barrel, PR #319), `skillAnalyzerServicePure.ts` 64 LOC (barrel, PR #320), `agentExecutionService.ts` 248 LOC (PR #314), `skillAnalyzerService.ts` 78 LOC (barrel, PR #320), `AdminSubaccountDetailPage.tsx` 192 LOC, `Layout.tsx` 197 LOC, `UsagePage.tsx` 131 LOC.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:partial-closure:pr:327] **Area 10 soft-cap breaches** — 5 of 10 closed by PR #327 (split-services-soft-cap-batch): `agentService.ts` 2,335 → 39 LOC barrel + 10 sub-modules, `skillAnalyzerJob.ts` 2,254 → 1 LOC barrel + 16 sub-modules, `workspaceMemoryService.ts` 1,949 → 45 LOC barrel + 13 sub-modules, `llmRouter.ts` 1,918 → 46 LOC barrel + 7 sub-modules, `queueService.ts` 1,683 → 29 LOC barrel + 8 sub-modules. Remaining 5 (the "etc." files) still over soft cap. high/informational. Address opportunistically.
- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:317] **Missing dep `pg`** — added to `optionalDependencies` in package.json (matches docx/mammoth precedent).

### Medium

- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:deferred:pr:329:rationale-semantic-mismatch] **Custom retry loop in `server/services/agentBeliefService.ts:124-403`** outside canonical `withBackoff`. medium/medium. Investigation 2026-05-16: the agentBeliefService loop is optimistic-CAS (UPDATE ... WHERE updatedAt = X; refresh-and-retry-once on miss) with a per-run total-retry budget. `withBackoff` is exponential-backoff for SAME-CALL retries on external services. The semantics don't unify cleanly — extending `withBackoff` with a "storm cap" would not allow `agentBeliefService` to use it without a substantial refactor of the CAS loop. Current implementation is already well-bounded (BELIEFS_MAX_RETRIES_PER_RUN structurally enforced + `belief_retry_storm` telemetry on overflow). Defer to a focused refactor PR that migrates the CAS pattern to a shared helper rather than retrofitting `withBackoff`.
- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:329] **`enqueueHandoff` silent depth-cap rejection at `skillExecutor/pipeline.ts:185`** — Replaced `console.warn` with structured `logger.warn('handoff.depth_cap_rejected', { sourceRunId, agentId, subaccountId, organisationId, handoffDepth, maxHandoffDepth })`. Lands on the same Langfuse span as the surrounding run via the request-ALS context. File path updated post-#317 god-file split.
- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:329] **Three silent `.catch(() => {})` in `agentExecutionService/runLifecycle/prepare.ts` lines 258, 342, 469** (relocated from monolith lines 1157, 1240, 1368 in #314 split) — Annotated with `guard-ignore-next-line: no-silent-failure` + WHY rationale per site. All three are provenance-only metadata writes (threadContextVersionAtStart, appliedMemoryBlockIds, injectedEntryIds); transient failure → NULL → MV treats as unmeasured (spec-correct graceful degradation per §3.6 §8.31).
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **188 `: any` / `as any` occurrences** in non-test server + shared. medium/low. Ratchet via `verify-any-budget.sh`.
- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:329:counts-reduced-below-launch-prompt-target] **133 marker comments** (73 TEMP, 50 TODO, 23 LEGACY, 10 DEPRECATED, 1 XXX). Verified 2026-05-16: only ~21 marker comments remain in `server/`, `client/src/`, `shared/` (excluding `node_modules`, `__tests__`). The launch prompt's "remove 10 DEPRECATED and 1 XXX" target is unreachable — only 1 DEPRECATED comment-marker remains (`server/db/schema/agentRunSnapshots.ts:18` documenting the toolCallsLog deprecation, intentional) and 0 XXX markers. Prior PRs cleaned the rest. 73 TEMP and 50 TODO defers per launch prompt — leave open as TEMP/TODO category.
- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:tbd-wave-5] **Knip 306 unused-file flags + no `knip.json`** — false-positive risk high. medium/high (on noisiness). Author `knip.json` first.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **~80 unused exports in `shared/types/*`** (knip). medium/low. Per-export manual cross-check.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **101 client pages not yet audited against Frontend Design Principles**. medium/low. Schedule `audit-runner: hotspot frontend`.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **`SystemPnlPage.tsx` KPI cards admin-only status unverified**. medium/low. Confirm gate; document or trim.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **186 skill ↔ actionRegistry alignment not cross-referenced**. medium/low. `audit-runner: hotspot skills`.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **Per-critical-path coverage matrix not produced** (Module C). medium/medium.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **`madge --circular` not run** (Area 8). medium/low. `audit-runner: hotspot circular-deps`.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **`jscpd` not run** (Area 2). medium/low. `audit-runner: hotspot duplication`.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **Handoff audit-trail durability not fully traced** (Module K). medium/low. `audit-runner: hotspot agent-execution`.

### Low

- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **`pagePreview.ts:12-13` and `pageServing.ts:13-14` type-only imports from `db/schema/*`** trip gate regex. low/high. Move row types to `shared/types/page.ts`; gate fix in Prevention Proposals.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **`req.user.organisationId` dual-source in `server/middleware/auth.ts` lines 262, 288, 318, 384**. low/medium. Extract `resolveOrganisationId(req)` helper.
- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:329:already-fixed-in-314] **Comment cluster `agentExecutionService.ts:72-116`** WHAT-prose residue. Verified 2026-05-16: the cluster was removed during the PR #314 split (the file is now 248 LOC, lines 72-116 contain the executeRun catch-path implementation, not WHAT-prose). Close without action.
- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:329] **Borderline editorial mention of Google Docs / Dropbox at `docs/capabilities.md`**. Replaced marketing-prose mention (line 308 "Google Docs, Dropbox" in the data-files knowledge-sources description) with vendor-neutral phrasing ("document stores") per § Editorial Rules. Vendor names retained in the Integrations Reference table (factual section, rule §40 carve-out).
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **19 duplicate exports (default + named)** in client React components. low/medium. Drop aliases on 7 components; keep `auth.ts` shims.
- [ ] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:open] **`UNIVERSAL_SKILL_NAMES` dual-source maintained by hand**. low/medium. Refactor to generate from `ACTION_REGISTRY`.
- [x] [origin:audit:pre-v1-lockdown:2026-05-14T04-49-08Z] [status:closed:pr:317] **`@playwright/test` listed as production dep** — moved to `devDependencies`.

---

## Prevention proposals from codebase audit — 2026-05-14

**Captured:** 2026-05-14T04-49-08Z
**Source log:** `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`
**Spec for batched implementation:** `tasks/builds/audit-prevention-gates-2026-05-14/spec.md`
**Rule 16 invariant:** always pass 3; never auto-applied. Operator reviews and applies as a batch.

### Tier 1 — block at write time (16; gates / hooks)

- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P1** — `scripts/verify-no-missing-deps.sh`: `depcheck --skip-missing=false`; fail on any import absent from `package.json`.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P2** — tighten `scripts/verify-no-db-in-routes.sh`: (a) skip `import type`; (b) refuse new baseline entries; (c) companion `verify-with-org-tx-or-scoped-db.sh`.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P3** — `scripts/verify-loc-cap.sh`: enforce Area 10 thresholds.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P4** — `scripts/verify-no-silent-catch.sh`: silent catches require `guard-ignore: no-silent-failures`.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P5** — `scripts/verify-canonical-retry.sh`: `retryCount` loops outside `withBackoff` require `guard-ignore: canonical-retry`.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:covered-by-verify-no-raw-console] **P6** — `scripts/verify-canonical-logger.sh`: `console.(log\|warn\|error)` in `server/services`/`server/routes` requires `guard-ignore: canonical-logger`. Covered by pre-existing scripts/verify-no-raw-console.sh; see Chunk 3 implementation log for the scope-overlap evidence.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P7** — `scripts/verify-universal-skill-sync.sh`: `UNIVERSAL_SKILL_NAMES` ↔ `ACTION_REGISTRY` bidirectional.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P8** — `scripts/verify-frontend-design-budget.sh`: KPI/Sparkline/chart imports require admin-only allowlist.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P9** — `scripts/verify-any-budget.sh`: non-growing `: any` count per file.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P10** — `scripts/verify-marker-budget.sh`: non-growing marker count per file.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P11** — `scripts/verify-no-new-cycles.sh`: `madge --circular --json` baseline.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P12** — `scripts/verify-duplicate-blocks.sh`: `jscpd --min-tokens 15` baseline.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P13** — `scripts/verify-framework-context-block.sh`: §2 against `package.json` drift.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P14** — `scripts/verify-types-used.sh`: every exported event type in a discriminated union or used in code.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P15** — `scripts/verify-no-orphan-react-component.sh`: walk React Router from `App.tsx`; flag zero-ingress pages.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:307] **P16** — `scripts/verify-knip-config.sh`: `knip.json` registers every dynamic entry surface.

### Tier 2 — convention at design time (4; docs)

- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:architecture.md] [status:closed:pr:307] **P17** — "Single org-id source" sub-section.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:CLAUDE.md] [status:closed:pr:307] **P18** — extend § Comments: "comments describing a completed refactor are residue".
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:CLAUDE.md] [status:closed:pr:307] **P19** — § Frontend: "prefer named exports for React components".
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:docs/capabilities.md] [status:closed:pr:307] **P20** — § Editorial Rules: explicit always-OK industry-terms list.

### Tier 3 — lesson via context (4; KNOWLEDGE.md / ADR)

- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:KNOWLEDGE.md] [status:closed:pr:307] **P21** — pattern: per-critical-path coverage tier matrix; refresh quarterly.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:KNOWLEDGE.md] [status:closed:pr:307] **P22** — pattern: "Custom retry loops are pass-3 even when they look right".
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:KNOWLEDGE.md] [status:closed:pr:307] **P23** — pattern: "Handoff depth-cap rejections need structured events".
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:ADR] [status:closed:pr:307] **P24** — ADR: "Service-layer extraction policy for routes touching `db/schema/`".

### Warning→error promotion follow-ups (chunk 11 wired 14 gates as warning-first per Operator decision §C1)

Each gate ships with `default_exit_code=2` (warning). Operator reviews CI signal during the one-week soak window post-merge; if no unexpected false positives, promote `DEFAULT_EXIT_CODE` from 2 to 1 in the gate script. P6 has no row here because it was dropped per §B1 (covered by pre-existing `verify-no-raw-console.sh`).

Earliest promotion date: merge date + 7 days.

- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-universal-skill-sync.sh**
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-framework-context-block.sh**
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-types-used.sh**
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-canonical-retry.sh**
- [ ] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:open:deferred] **Warning→error promotion: verify-any-budget.sh** — REVERTED in PR #317: gate failed on current main with no new violations (73 files grew past seed); promotion deferred until baseline is re-seeded.
- [ ] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:open:deferred] **Warning→error promotion: verify-marker-budget.sh** — REVERTED in PR #317: same cause (33 files grew past seed).
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-no-new-cycles.sh**
- [ ] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:open:deferred] **Warning→error promotion: verify-duplicate-blocks.sh** — REVERTED in PR #317: gate failed on current main (9118 clones vs 8769 seed); promotion deferred until baseline is re-seeded.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-knip-config.sh**
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-with-org-tx-or-scoped-db.sh**
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-no-orphan-react-component.sh**
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-no-missing-deps.sh**
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-loc-cap.sh**
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate] [status:closed:pr:317] **Warning→error promotion: verify-frontend-design-budget.sh**
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:gate-baseline] [status:closed:pr:317] **Extend baseline: scripts/.gate-baselines/with-org-tx-or-scoped-db.txt** — extended to full server/services/*, server/jobs/*, server/lib/*, server/adapters/* scan.
- [x] [origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z] [target:package.json] [status:closed:pr:317] **Declare pg in package.json** — added to `optionalDependencies`.

### Not feasible — rationale

- [status:v2-backlog:not-feasible-keep-documented] N1 — `depcheck` false positives on PostCSS / Vitest coverage are noise-shaped; no enforceable preventive control.
- [status:v2-backlog:not-feasible-keep-documented] N2 — Handoff audit-trail durability requires deep agent-execution tracing; covered by `audit-runner: hotspot agent-execution`.

---

## Pointers

- **Archive of historical deferred items:** `tasks/todo-archive-2026-Q2.md`
- **Per-build deferred items for unmerged work:** `tasks/builds/<slug>/handoff.md`
- **Source-of-truth review logs:** `tasks/review-logs/`
- **Lessons + corrections:** `KNOWLEDGE.md` + `tasks/lessons.md`
- **Ideas captured mid-session:** `tasks/ideas.md`

---

## Capabilities Asset Register backfill — development-lifecycle-governance-upgrade (2026-05-14)

One-time append per spec §4.2 row 8 + §7.4.3 + §10 Chunk 4.
Owner-resolution entries (spec §7.4.3 — one per placeholder Owner).
Capabilities-backfill entries (spec §10 Chunk 4 — one per TBD Carry notes field).

### owner-resolution: multi-tenant-platform [status:closed:pr:334]

Capability ID: multi-tenant-platform
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: authentication-access-control [status:closed:pr:334]

Capability ID: authentication-access-control
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: ai-agent-system [status:closed:pr:334]

Capability ID: ai-agent-system
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: agent-workplace-identity [status:closed:pr:334]

Capability ID: agent-workplace-identity
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: capability-aware-orchestrator [status:closed:pr:334]

Capability ID: capability-aware-orchestrator
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: platform-feature-request-pipeline [status:closed:pr:334]

Capability ID: platform-feature-request-pipeline
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: universal-brief [status:closed:pr:334]

Capability ID: universal-brief
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: configuration-assistant [status:closed:pr:334]

Capability ID: configuration-assistant
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: skill-system [status:closed:pr:334]

Capability ID: skill-system
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: crm-query-planner [status:closed:pr:334]

Capability ID: crm-query-planner
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: workflow-engine [status:closed:pr:334]

Capability ID: workflow-engine
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: human-in-the-loop [status:closed:pr:334]

Capability ID: human-in-the-loop
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: task-board-workspace [status:closed:pr:334]

Capability ID: task-board-workspace
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: pulse-supervision-home [status:closed:pr:334]

Capability ID: pulse-supervision-home
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: agent-spending [status:closed:pr:334]

Capability ID: agent-spending
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: live-execution-log [status:closed:pr:334]

Capability ID: live-execution-log
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: memory-knowledge-system [status:closed:pr:334]

Capability ID: memory-knowledge-system
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: trust-verification-layer [status:closed:pr:334]

Capability ID: trust-verification-layer
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: workspace-health-diagnostics [status:closed:pr:334]

Capability ID: workspace-health-diagnostics
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: sub-account-optimiser [status:closed:pr:334]

Capability ID: sub-account-optimiser
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: sub-account-baseline [status:closed:pr:334]

Capability ID: sub-account-baseline
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: activity-analytics [status:closed:pr:334]

Capability ID: activity-analytics
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: client-portal [status:closed:pr:334]

Capability ID: client-portal
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: pages-content-builder [status:closed:pr:334]

Capability ID: pages-content-builder
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: integration-framework [status:closed:pr:334]

Capability ID: integration-framework
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: document-bundles-cached-context [status:closed:pr:334]

Capability ID: document-bundles-cached-context
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: execution-infrastructure [status:closed:pr:334]

Capability ID: execution-infrastructure
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: personal-assistant [status:closed:pr:334]

Capability ID: personal-assistant
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: sandboxed-runtime-iee [status:closed:pr:334]

Capability ID: sandboxed-runtime-iee
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: persistent-agent-workspace [status:closed:pr:334]

Capability ID: persistent-agent-workspace
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: subscription-driven-long-task-execution [status:closed:pr:334]

Capability ID: subscription-driven-long-task-execution
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: performance-reporting-analytics [status:closed:pr:334]

Capability ID: performance-reporting-analytics
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: seo-management [status:closed:pr:334]

Capability ID: seo-management
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: geo-ai-search-visibility [status:closed:pr:334]

Capability ID: geo-ai-search-visibility
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: content-creation-publishing [status:closed:pr:334]

Capability ID: content-creation-publishing
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: crm-contact-management [status:closed:pr:334]

Capability ID: crm-contact-management
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: email-marketing-outreach [status:closed:pr:334]

Capability ID: email-marketing-outreach
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: campaign-management-optimization [status:closed:pr:334]

Capability ID: campaign-management-optimization
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: financial-analysis-reporting [status:closed:pr:334]

Capability ID: financial-analysis-reporting
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: churn-detection-account-health [status:closed:pr:334]

Capability ID: churn-detection-account-health
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: customer-support-automation [status:closed:pr:334]

Capability ID: customer-support-automation
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: landing-page-management [status:closed:pr:334]

Capability ID: landing-page-management
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: competitor-intelligence [status:closed:pr:334]

Capability ID: competitor-intelligence
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: portfolio-intelligence [status:closed:pr:334]

Capability ID: portfolio-intelligence
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: llm-spend-observability [status:closed:pr:334]

Capability ID: llm-spend-observability
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: memory-injection-utility [status:closed:pr:334]

Capability ID: memory-injection-utility
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: tier-4-isolated-code-execution [status:closed:pr:334]

Capability ID: tier-4-isolated-code-execution
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row.

### owner-resolution: dev-lifecycle-governance [status:closed:pr:334]

Capability ID: dev-lifecycle-governance
Unknown field: Owner
Current value: TBD owner - temp reviewer: michaelhazza; due 2026-08-14
Due date: 2026-08-14
Notes: Identify capability owner and update docs/capabilities.md row. Created at Phase 3 finalisation of PR #304 (development-lifecycle-governance-upgrade) — new capability surface, not a backfill.

### capabilities-backfill: multi-tenant-platform [status:closed:pr:334]

Capability ID: multi-tenant-platform
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-multi-tenant-platform
Due date: 2026-08-14
Notes: Research and fill in carry notes (ongoing maintenance, review cadence, operational cost) for this capability.

### capabilities-backfill: authentication-access-control [status:closed:pr:334]

Capability ID: authentication-access-control
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-authentication-access-control
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: ai-agent-system [status:closed:pr:334]

Capability ID: ai-agent-system
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-ai-agent-system
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: agent-workplace-identity [status:closed:pr:334]

Capability ID: agent-workplace-identity
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-agent-workplace-identity
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: capability-aware-orchestrator [status:closed:pr:334]

Capability ID: capability-aware-orchestrator
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-capability-aware-orchestrator
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: platform-feature-request-pipeline [status:closed:pr:334]

Capability ID: platform-feature-request-pipeline
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-platform-feature-request-pipeline
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: universal-brief [status:closed:pr:334]

Capability ID: universal-brief
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-universal-brief
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: configuration-assistant [status:closed:pr:334]

Capability ID: configuration-assistant
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-configuration-assistant
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: skill-system [status:closed:pr:334]

Capability ID: skill-system
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-skill-system
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: crm-query-planner [status:closed:pr:334]

Capability ID: crm-query-planner
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-crm-query-planner
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: workflow-engine [status:closed:pr:334]

Capability ID: workflow-engine
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-workflow-engine
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: human-in-the-loop [status:closed:pr:334]

Capability ID: human-in-the-loop
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-human-in-the-loop
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: task-board-workspace [status:closed:pr:334]

Capability ID: task-board-workspace
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-task-board-workspace
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: pulse-supervision-home [status:closed:pr:334]

Capability ID: pulse-supervision-home
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-pulse-supervision-home
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: agent-spending [status:closed:pr:334]

Capability ID: agent-spending
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-agent-spending
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: live-execution-log [status:closed:pr:334]

Capability ID: live-execution-log
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-live-execution-log
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: memory-knowledge-system [status:closed:pr:334]

Capability ID: memory-knowledge-system
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-memory-knowledge-system
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: trust-verification-layer [status:closed:pr:334]

Capability ID: trust-verification-layer
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-trust-verification-layer
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: workspace-health-diagnostics [status:closed:pr:334]

Capability ID: workspace-health-diagnostics
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-workspace-health-diagnostics
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: sub-account-optimiser [status:closed:pr:334]

Capability ID: sub-account-optimiser
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-sub-account-optimiser
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: sub-account-baseline [status:closed:pr:334]

Capability ID: sub-account-baseline
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-sub-account-baseline
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: activity-analytics [status:closed:pr:334]

Capability ID: activity-analytics
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-activity-analytics
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: client-portal [status:closed:pr:334]

Capability ID: client-portal
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-client-portal
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: pages-content-builder [status:closed:pr:334]

Capability ID: pages-content-builder
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-pages-content-builder
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: integration-framework [status:closed:pr:334]

Capability ID: integration-framework
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-integration-framework
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: document-bundles-cached-context [status:closed:pr:334]

Capability ID: document-bundles-cached-context
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-document-bundles-cached-context
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: execution-infrastructure [status:closed:pr:334]

Capability ID: execution-infrastructure
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-execution-infrastructure
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: personal-assistant [status:closed:pr:334]

Capability ID: personal-assistant
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-personal-assistant
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: sandboxed-runtime-iee [status:closed:pr:334]

Capability ID: sandboxed-runtime-iee
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-sandboxed-runtime-iee
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: persistent-agent-workspace [status:closed:pr:334]

Capability ID: persistent-agent-workspace
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-persistent-agent-workspace
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: subscription-driven-long-task-execution [status:closed:pr:334]

Capability ID: subscription-driven-long-task-execution
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-subscription-driven-long-task-execution
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: performance-reporting-analytics [status:closed:pr:334]

Capability ID: performance-reporting-analytics
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-performance-reporting-analytics
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: seo-management [status:closed:pr:334]

Capability ID: seo-management
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-seo-management
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: geo-ai-search-visibility [status:closed:pr:334]

Capability ID: geo-ai-search-visibility
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-geo-ai-search-visibility
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: content-creation-publishing [status:closed:pr:334]

Capability ID: content-creation-publishing
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-content-creation-publishing
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: crm-contact-management [status:closed:pr:334]

Capability ID: crm-contact-management
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-crm-contact-management
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: email-marketing-outreach [status:closed:pr:334]

Capability ID: email-marketing-outreach
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-email-marketing-outreach
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: campaign-management-optimization [status:closed:pr:334]

Capability ID: campaign-management-optimization
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-campaign-management-optimization
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: financial-analysis-reporting [status:closed:pr:334]

Capability ID: financial-analysis-reporting
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-financial-analysis-reporting
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: churn-detection-account-health [status:closed:pr:334]

Capability ID: churn-detection-account-health
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-churn-detection-account-health
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: customer-support-automation [status:closed:pr:334]

Capability ID: customer-support-automation
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-customer-support-automation
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: landing-page-management [status:closed:pr:334]

Capability ID: landing-page-management
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-landing-page-management
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: competitor-intelligence [status:closed:pr:334]

Capability ID: competitor-intelligence
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-competitor-intelligence
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: portfolio-intelligence [status:closed:pr:334]

Capability ID: portfolio-intelligence
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-portfolio-intelligence
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: llm-spend-observability [status:closed:pr:334]

Capability ID: llm-spend-observability
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-llm-spend-observability
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: memory-injection-utility [status:closed:pr:334]

Capability ID: memory-injection-utility
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-memory-injection-utility
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.

### capabilities-backfill: tier-4-isolated-code-execution [status:closed:pr:334]

Capability ID: tier-4-isolated-code-execution
Unknown field: Carry notes
Current value: TBD — see tasks/todo.md#capabilities-backfill-tier-4-isolated-code-execution
Due date: 2026-08-14
Notes: Research and fill in carry notes for this capability.


---

## audit-prevention-gates-2026-05-14 / PR #307 — deferred from chatgpt-pr-review

### BUDGET-EXPIRY-ENFORCEMENT-1 — Per-file budget gates do not enforce `# expires:` directives

**Source:** chatgpt-pr-review Round 1 / T2 (escalated as Round 2 / F4 with operator-approved doc-softening remediation; full log: `tasks/review-logs/chatgpt-pr-review-audit-prevention-gates-2026-05-14-2026-05-14T12-23-57Z.md`)
**Status:** doc/code mismatch CLOSED in Round 2 — `references/test-gate-policy.md § Per-file count baselines are out of scope` explicitly carves these gates out of the expiry framework; both baseline file headers now carry the NOTE callout. This follow-up is now about the **feature gap** (if we ever want calendar-expiry-driven promotion for per-file budgets), not about a doc/code mismatch.
**Severity:** low (no doc/code mismatch any more; feature gap only fires if we decide we want calendar-expiry-driven promotion for per-file budgets in future)
**Files:**
- `scripts/lib/per-file-counter-pure.mjs` — `parsePerFileBudgetBaseline` strips `#`-comment lines including any `# expires:` directives (by design — see doc carve-out)
- `scripts/verify-any-budget.sh` (P9) and `scripts/verify-marker-budget.sh` (P10) — promote on count growth, not calendar

**Fix outline (if we ever do want expiry-driven promotion for these gates):** thread per-entry expiry through `parsePerFileBudgetBaseline` → `diffAgainstBaseline`, then have the calling shell scripts emit `[GUARD] WARNING / ERROR` per expired/past-grace entry. Apply same exit-code policy as `check_expiring_baseline` (current ∩ baseline > 0 → exit 2; new violation or past-grace → exit 1). Update `references/test-gate-policy.md § Per-file count baselines are out of scope` and the two baseline file headers when this lands.

**Estimated effort if pursued:** ~50 LOC across parser + 2 shell scripts + 2 test cases.

- [status:v2-backlog:operator-session-future] **OSI-DEF-2 — defence-in-depth token encryption on the unreachable `connect()` mock path** (pr-reviewer S1)
  - File: `server/services/operatorSessionService.ts` lines 287-289 (`accessToken: mockToken.access`, `refreshToken: mockToken.refresh`)
  - Reason for deferral: Path is unreachable in V1 (501 registry gate at line 204 + 500 defence-in-depth at line 246). The risk is "future operator flips the registry and forgets to wire encryption around these two assignments in the same change."
  - When to revisit: As part of the OpenClaw adapter activation (or any change that removes the line-246 token_encryption_required guard). Wire `connectionTokenService.encryptToken(mockToken.access)` and `…(mockToken.refresh)` even in the mock so the encryption contract is self-executing when the registry flips.

- [status:v2-backlog:operator-session-future] **OSI-DEF-3 — Coalesce the N+1 stale-disclosure pass in list endpoints** (pr-reviewer S4)
  - File: `server/services/operatorSessionService.ts` lines 458-576 (`listAllowedSubscriptionsForAgent`, `listForSubaccount`)
  - Reason for deferral: Performance optimisation, not correctness. At V1 scale (5-10 connections per subaccount) the `2 + ~3N` query count is acceptable. Becomes load-bearing the moment the provider registry flips and real subscriptions populate.
  - When to revisit: Before any change that makes operator_session connections real (registry flip from `none_verified`) OR if a subaccount routinely exceeds ~25 operator_session connections. Approach: compute the disclosure-version mismatch in SQL (`disclosure_version < OPERATOR_SESSION_DISCLOSURE_VERSION`) via `LEFT JOIN operator_session_consents`, batch-UPDATE the stale rows in one statement, return projected results without the re-read.

- [status:v2-backlog:operator-session-future] **OSI-DEF-4 — `<button>` `type="button"` sweep across new Govern modals** (pr-reviewer N1, N2)
  - Files: `client/src/pages/govern/components/*.tsx` (~36 occurrences) + `client/src/pages/govern/ConnectionsPage.tsx` lines 67-77 (tab buttons)
  - Reason for deferral: Theoretical risk only — none of the new modals are wrapped in `<form>`, so silent-submit cannot fire today. Per DEVELOPMENT_GUIDELINES §8.25 the class-level rule still wants the attribute; a future refactor introducing a form inside any modal would regress silently.
  - When to revisit: Bundle with the next pass of changes that introduces a form inside any of the new Govern modals, or as a standalone sweep tagged `chore(govern): wire type='button' across modals per §8.25`.

- [status:v2-backlog:operator-session-future] **OSI-DEF-5 — Down-migration ordering convention not enforced** (pr-reviewer N4)
  - Files: `migrations/0326_operator_session_columns.down.sql:3`, `migrations/0325_operator_session_consents.down.sql:7`
  - Reason for deferral: Both files carry "run me before/after X" comments. Drizzle's runner orders down migrations by descending number, so 0326.down runs first as expected. The comments are correct but rely on convention rather than explicit guards.
  - When to revisit: If the down-migration runner ever changes ordering semantics, or if a future migration needs to depend on a specific down-migration sequence. Could be hardened with an explicit guard query at the top of the down file.

- [status:v2-backlog:operator-session-future] **OSI-DEF-6 — Worth-confirming: agent-allowlist probing via allowed-subscriptions route** (adversarial-reviewer W1)
  - File: `server/routes/operatorSessionConnections.ts` lines 432-447 (`GET /api/subaccounts/:subaccountId/agents/:agentId/allowed-subscriptions`)
  - Question to resolve: Whether `agentId` from a different subaccount in the same org should be rejected at the route layer (404) vs silently returning an empty `specific_agents` result.
  - When to revisit: Before agent IDs are treated as cross-subaccount sensitive identifiers (e.g. if multi-subaccount user accounts are introduced).

- [status:v2-backlog:operator-session-future] **OSI-DEF-7 — Worth-confirming: `req.params.agentId` UUID validation at route layer** (adversarial-reviewer W2)
  - File: `server/routes/operatorSessionConnections.ts` line 442
  - Reason for deferral: No SQL injection vector (Drizzle parameterises the JSONB `?` query). A non-UUID `agentId` string silently returns an empty result rather than a 400.
  - When to revisit: Bundle with OSI-DEF-6, or as part of a general route-param validation sweep. Add `z.string().uuid()` at the route layer for consistency.

- [status:v2-backlog:operator-session-future] **OSI-DEF-8 — Worth-confirming: generic `/api/subaccounts/:subaccountId/connections` exposes operator_session rows** (adversarial-reviewer W3)
  - File: `server/routes/integrationConnections.ts` lines 36-45 + `sanitizeConnection`
  - Question to resolve: Whether `CONNECTIONS_VIEW` holders should see operator_session rows (with `consentRecordId`, `usabilityState`, `planTier`, `planVerificationStatus`) on the generic connections list, or whether those should be filtered out (`WHERE auth_type != 'operator_session'`) and served only via the dedicated `OPERATOR_SESSION_VIEW` route.
  - When to revisit: Before any external integration consumes the generic connections endpoint, or if `consentRecordId` is upgraded to a privileged identifier.

- [status:v2-backlog:operator-session-future] **OSI-DEF-9 — `usability_state` lacks a CHECK constraint at the DB level** (adversarial-reviewer additional observation)
  - File: `migrations/0326_operator_session_columns.sql` (`usability_state text` column)
  - Reason for deferral: TypeScript-only enforcement today. The state machine lives in `operatorSessionLifecycleServicePure.ts` and the `transition()` write-owner. A raw DBA UPDATE or future migration bug could write an invalid state string without DB-level rejection.
  - When to revisit: Bundle with the next operator_session migration. Add `CHECK (usability_state IN ('connected_usable', 'connected_needs_consent', 'connected_needs_reauth', 'connected_unverified', 'revoked', 'disabled'))` as a separate migration so the existing 0326 stays append-only.

- [status:v2-backlog:operator-session-future] **OSI-DEF-10 — `minimisePiiForDeletedUser` is a V1 501 stub** (adversarial-reviewer additional observation)
  - File: `server/services/operatorSessionConsentService.ts` lines 197-209
  - Reason for deferral: Spec §16 names the method but defers the implementation to the user-deletion privacy sweep (out of scope for Spec C).
  - When to revisit: When the user-deletion flow is implemented. Confirm any caller handles the 501 gracefully rather than failing the deletion.

- [status:v2-backlog:operator-session-future] **OSI-DEF-11 — `OPERATOR_SESSION_DISCLOSURE_VERSION` is deploy-coupled** (adversarial-reviewer additional observation)
  - File: `server/config/operatorSessionProviders.ts` (`OPERATOR_SESSION_DISCLOSURE_VERSION = 1`)
  - Reason for deferral: Hard-coded constant. Bumping the version (e.g. for a legal update) requires a code deploy. No DB-config or feature-flag path.
  - When to revisit: If the disclosure text needs an urgent update without a deploy window, or if legal asks for a feature-flag-style toggle on disclosure version.

- [status:v2-backlog:operator-session-future] **OSI-DEF-12 — Legacy `/admin/subaccounts/:id/connections` bookmark lands on empty state when org admin has no active client** (dual-reviewer P2)
  - File: `client/src/pages/govern/ConnectionsPage.tsx` lines 38-45 + `client/src/App.tsx` line 248 (`SubaccountIntegrationsRoute`)
  - Reason for deferral: The redirect adds `?workspace=X` but `ConnectionsPage` derives `isWorkspace` from `viewMode`. An org admin with no `activeClientId` lands in `'org'` mode and sees "Select a workspace" instead of subaccount X's connections. Honouring the query param across view modes was attempted in this dual-reviewer pass and reverted — it creates a worse UX problem: the page body shows workspace data while the switcher shows "Org" (mode/data mismatch with no clean way to clear the override without editing the URL). Correct fix is non-trivial (set `activeSubaccountId` + name in localStorage from the redirect, which requires fetching the subaccount name; or replace the redirect target with a workspace-picker prompt) and outside the scope of an in-loop edit.
  - When to revisit: Bundle with the next pass that touches `SubaccountIntegrationsRoute` or the workspace picker. The clean approach is: in `SubaccountIntegrationsRoute`, fetch the subaccount name via `GET /api/subaccounts/:id`, call `setActiveSubaccount(id, name)`, then `Navigate` to `/connections` without the `workspace` query param. The page then enters workspace mode naturally and the switcher stays consistent.
  - Current behaviour: legacy bookmark from org mode → "Select a workspace" empty state. Bookmark from workspace mode → works because `viewMode === 'workspace'` and the redirect's `workspace=` param is honoured by the existing line-43 ternary.

- [status:v2-backlog:operator-session-future] **OSI-DEF-13 — `EditAvailabilityModal` exposes raw agent-ID entry instead of a selectable agent picker** (chatgpt-pr-review PR #286 round 1 T1)
  - File: `client/src/pages/govern/components/EditAvailabilityModal.tsx`
  - Reason for deferral: V1 ships with this limitation noted. The backend schema validates UUIDs and non-empty arrays, but the UX is not viable for non-technical operators — they cannot realistically type or paste agent IDs from memory, and there is no in-product way to look an ID up. ChatGPT also flags the membership-validation gap (a user could type an ID belonging to a different subaccount and have the persistence layer accept it).
  - When to revisit: Either when the agent-list endpoint is being built for an adjacent feature (bundle the picker on the back of it), or earlier if a beta customer hits the "Specific agents only" path and the manual-ID flow blocks them.
  - Two viable end-states (decision deferred):
    - (a) Hide the "Specific agents only" option from the modal until the picker exists — narrows V1 surface area to "Any agent in this workspace", which is the default and what most callers will pick anyway.
    - (b) Add a minimal `GET /api/subaccounts/:id/agents` endpoint that returns `[{id, name}]` for the workspace, render a multi-select, and server-side enforce `allowedAgentIds ⊆ workspace.agents` on persistence.
  - Recommended end-state at revisit time: (b) — the multi-select is the long-term shape and (a) just kicks the can. Picking (a) at revisit is only justified if the agent-list endpoint is far off and a workspace user is actively asking for the restriction-by-agent path.
## Deferred spec decisions — sandbox-isolation (2026-05-11)

**Captured:** 2026-05-11
**Source log:** `tasks/review-logs/spec-review-log-sandbox-isolation-2-20260511T000426Z.md`
**Spec:** `tasks/builds/sandbox-isolation/spec.md`
**Iteration:** 2

These items were classified ambiguous/directional during spec review. Spec mechanics tightened to acknowledge the build-time choice; the choice itself is deferred to Phase 2.

- [ ] [status:v2-backlog:waiting-on-e2b-sdk] **SANDBOX-DEF-EGRESS-MECH — Choose egress interception mechanism**
  - Spec section: §9.1 (egress audit logging is mandatory when `network` is non-`none`).
  - Schema is locked in §20.6 — the choice is which component actually intercepts allow/deny decisions and writes the audit rows.
  - Candidates: (a) e2b SDK network-policy hooks if they expose per-decision callbacks, (b) application-layer egress proxy outside the sandbox with mandatory routing from the template entrypoint, (c) CNI / eBPF-side hooks if e2b exposes them.
  - **STATUS (C9 chunk, 2026-05-11): DEFERRED to actual SDK installation.** The e2b SDK (@e2b/sdk or 'e2b') is not yet installed in node_modules. The e2bSandbox provider is implemented with a thin E2bSdkClient interface stub that throws on first call; real SDK wiring lands when the e2b account is provisioned and the SDK's exposed surface (especially network-policy hooks) is verified. The audit-row schema (C1b §20.6) is unaffected by the mechanism choice. Decision options remain (a), (b), (c) above — pick based on the actual SDK API surface at installation time.

- [x] **SANDBOX-DEF-LOG-SCHEMA — CLOSED 2026-05-11 at chatgpt-spec-review Round 1 F1.** Locked to **option (a) — new `sandbox_logs` table**.
  - Spec section: §8.4 step 9 (log persistence), §17.1 + §17.3 (retention), §20.8 (contract), §21.1 (RLS), §19.1 (schema file + prune job), §19.4 (migration).
  - Rationale: cleaner RLS surface (symmetric with the other four sandbox tables); line-level idempotency via `UNIQUE (sandbox_execution_id, log_stream, sequence)` enforceable at the DB layer (a JSONB column couldn't); 90d retention lifecycle decoupled from the general application log layer.
  - Build impact: schema + migration + RLS manifest entry + `sandboxLogsPruneJob` land in C1 (types + schema). No longer a chunk-zero gating decision.

- [ ] [status:v2-backlog:waiting-on-e2b-sdk] **SANDBOX-F1 — Compute real digests + hashes for synthetos-sandbox template (deferred Phase 3 chatgpt-pr-review R1)**
  - Captured 2026-05-11 via Phase 3 `chatgpt-pr-review` Round 1 finding F1 (recommended `defer`).
  - Spec section: §15.2 (CURRENT_VERSION is human-committed pre-build), §15.3 (PUBLISHED_VERSION is CI-attested post-publish).
  - Current state per `infra/sandbox-templates/synthetos-sandbox/CURRENT_VERSION`: `deps_lockfile_hash = sha256:000...` placeholder; Dockerfile base image digest also placeholder; pip package hashes in requirements.txt similarly placeholder.
  - **Why deferred for V1 ship:** all of these are intentionally placeholder until the e2b account is provisioned (see SANDBOX-DEF-EGRESS-MECH above). The CURRENT_VERSION / PUBLISHED_VERSION contract is structurally complete; values are operator-computed pre-first-publish per spec §15.2.
  - **Operator action when e2b account is provisioned:** (0) flip `CURRENT_VERSION.version` AND `PUBLISHED_VERSION.version` from `local-dev-v1.0.0` to `v1.0.0` — the `local-dev-` prefix is intentional pre-first-publish to keep the `verify-template-version-coherence.sh` strict gate (Phase 3 T1 fix) green on `ready-to-merge` while no tag exists; (1) `docker pull` the real base image and capture the digest; (2) update `infra/sandbox-templates/synthetos-sandbox/Dockerfile` `FROM` line + CURRENT_VERSION `base_image_digest`; (3) regenerate `requirements.txt` with `pip-compile --generate-hashes` and capture real package hashes; (4) recompute `deps_lockfile_hash = sha256(requirements.txt || package-lock.json)`; (5) update CURRENT_VERSION; (6) flip repo variable `E2B_PUBLISH_ENABLED=true` AFTER wiring the real `e2b template publish` + `e2b template inspect` commands in `.github/workflows/publish-sandbox-templates.yml` (per Phase 3 F2 fix — the workflow now hard-fails until both wiring + variable flip are done); (7) push the `sandbox-template/synthetos-sandbox/v1.0.0` tag to trigger the publish workflow; (8) merge the auto-generated attestation PR within the 24h grace window so PUBLISHED_VERSION lands with real digests.

---

## Closed by sandbox-safety-batch (PR #326, 2026-05-16)

All items previously listed under `## Deferred from spec-conformance review — sandbox-isolation (2026-05-11)`, `## Deferred from adversarial-reviewer review — sandbox-isolation (2026-05-11)`, and `## Deferred from chatgpt-pr-review — sandbox-isolation (2026-05-11)` closed by the sandbox-safety-batch build.

**Closed REQs (spec-conformance):** #6 (logs line CHECK), #11 (runTask → runHarvest), #20 (sandboxMeteringQueryPure), #28 (sandbox_start_failed event), #29 (sandbox_start event), #31 (withSandboxProvider DB diagnostics), #35 (soft-delete artefact-purge trigger via canonical agentRunSoftDeleteService), #36 (provider terminate from monitor + kill), #55 (teardown verification).

**Closed adversarial findings:** SANDBOX-ADV-1.1 (reconciliation withOrgTx — verified), SANDBOX-ADV-1.2 (5-table subaccount FK migration 0360), SANDBOX-ADV-2.1 (templateVersion validated via resolveTemplateVersion + allowlist), SANDBOX-ADV-2.2 (inline-sandbox env-injection guard), SANDBOX-ADV-3.1 (telemetry sequence allocator race fixed via pg_advisory_xact_lock helper), SANDBOX-ADV-3.2 (ceiling-vs-provider race resolved via decideCeilingVsProviderRaceOutcome), SANDBOX-ADV-4.1 (credential-leak case-insensitive — extracted to pure helper + test), SANDBOX-ADV-4.2 (S3 path-traversal sanitised via sanitiseArtefactFilename), SANDBOX-ADV-5.1 (ceiling-monitor + wall-clock-kill enqueued in sandboxExecutionService start path), SANDBOX-ADV-5.2 (per-tenant log-storage quota), SANDBOX-ADV-6.1 (credential_aliases JSONB column + write + read path).

**Closed advisory:** SANDBOX-R3-T1 (reconciliation eligibility uses DB SELECT NOW() — Chunk 5).

Per-item verdicts: `tasks/review-logs/spec-conformance-log-sandbox-safety-batch-2026-05-15T10-01-59Z.md`. Build summary: `tasks/builds/sandbox-safety-batch/handoff.md`.

Remaining v2-backlog cross-references (still open elsewhere in this file):
- **SANDBOX-F1** (real e2b publish/inspect wiring; gates SANDBOX-R3-T2)
- **REQ #57** (credential value-threading; waits on e2b SDK install)

## Deferred adversarial findings — personal-assistant-v1 (2026-05-12)

Source: adversarial-reviewer Phase 1 pass on branch `claude/synthetos-personal-assistant-0kaIM`.
Confirmed holes fixed inline before pr-reviewer. Deferred items below.

### createDraftWithProposal non-atomic (likely-hole) [status:closed:pr:324]
`server/services/eaDrafts/eaDraftService.ts:58-88` — `actionService.proposeAction` and the
subsequent `db.insert(eaDrafts)` are not wrapped in a single transaction. `proposeAction` does
not accept a caller transaction handle. Fix requires refactoring `actionService.proposeAction`
to accept an optional `tx` parameter, or extracting its insert logic into a shared helper.
Phase 1.5 work item. Risk: orphaned `actions` row on `ea_drafts` insert failure.

**Closed 2026-05-15 (pa-v1-cleanup-batch):** Verified atomic at `server/services/eaDrafts/eaDraftService.ts:98-133` — already wrapped in `db.transaction(async (tx) => { ... })`; `actionService.proposeAction` accepts `tx` param. Migration `0344_ea_drafts_proposal_action_unique.sql` adds defence-in-depth UNIQUE on `ea_drafts.proposal_action_id`. Spec §7.5 amended 2026-05-13 to ratify the 1:1 invariant.

### dispatch() missing organisationId filter on integrationConnections lookup (worth-confirming) [status:v2-backlog:observational]
`server/services/triggers/externalSourceTriggers.ts:38-52` — add
`eq(integrationConnections.organisationId, ctx.organisationId)` for defence-in-depth.

### dispatch() rate-cap count not scoped by organisationId (worth-confirming) [status:v2-backlog:observational]
`server/services/triggers/externalSourceTriggers.ts:87-97` — add organisationId filter to
rate-cap count query.

### assembleThreadSummaryPrompt future prompt-injection surface (worth-confirming) [status:v2-backlog:observational]
`server/services/slack/slackActionService.ts:267` — when Slack thread summarisation ships,
the raw Slack message content must be XML-escaped or sandboxed in a structured prompt turn
before being passed to the LLM.

## Deferred from spec-conformance review — personal-assistant-v1 (2026-05-12)

**Captured:** 2026-05-12T13:15:07Z
**Source log:** `tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12T13-15-07Z.md`
**Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`

- [x] REQ-C4 — `voice_profiles` schema diverges from spec §7.4 contract [status:closed:pr:324]
  - Spec section: §7.4 + §21.1
  - Gap: Missing `name` column (display); single `source` column (string) replaced by `sources text[]` array; missing `source_config jsonb` (per-sampler config); missing `refresh_config jsonb` (per-policy config). Renames: `sample_size`→`sample_count`, `last_derived_at`→`last_refreshed_at`, `opt_out_at`→`opted_out_at`.
  - Suggested approach: Decide whether to bring schema into spec alignment (migration adds 4 cols, drops 1, renames 3) OR amend the spec to match the simpler implementation. The simpler schema is functional but breaks the spec's per-sampler config envelope.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Migration `0360_voice_profiles_schema_align.sql` renames 3 cols + adds 2 jsonb cols per spec §21.1. Drizzle + Zod + service aligned. Spec §7.4 was also amended 2026-05-13 to ratify simplified shape (no separate `name` column; `sources text[]` array; `source_config` jsonb).

- [x] REQ-CAL2 — Calendar `create_event` / `update_event` risk tier mismatch [status:closed:pr:324]
  - Spec section: §8.2 table + §6.3 rationale
  - Gap: Code uses Tier 6 (max); spec specifies Tier 4 with action-level `defaultGate: review`. The spec rationale (third-party visibility is consent-based) supports Tier 4. Either change works at runtime since both are review-gated, but tier classification drives downstream policy decisions (budget caps, audit categorisation).
  - Suggested approach: Confirm with the risk-tier rubric authors whether `create_event` is Tier 4 (record-write, consent-based visibility) or Tier 6 (broadcast). Update either the spec or the action registry.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Code already at Tier 4 with `defaultGate: 'review'` (`server/config/actionRegistry/calendar.ts:58-79` + `:81-102`). Conformance log captured an outdated view.

- [x] REQ-T8 — Dedup key formats diverge from spec §7.1 [status:closed:pr:324]
  - Spec section: §7.1 + §24.1
  - Gap: Slack dedup key uses `channelId@messageTs` not `slack_event_id`. Calendar dedup key uses `eventId@startAt@minutesUntilStart` not `{calendarId}@{eventId}@{startAtISO8601}@{lookaheadMinutes}`. Both work as unique keys but diverge from spec's explicit shapes (which were chosen for multi-calendar support + recurring occurrence handling).
  - Suggested approach: Update `deriveDedupKey` in `externalSourceTriggersPure.ts` to match spec format, or amend spec §7.1 to match the simpler keys.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Spec §7.1 amended 2026-05-13 (REQ-T8 amendment line 429) to ratify the simpler key shapes. Code at `externalSourceTriggersPure.ts:13-22` already matches.

- [x] REQ-C1 — `ExternalSourceTriggerEvent` schema simplified from spec §7.1 [status:closed:pr:324]
  - Spec section: §7.1
  - Gap: Spec specifies envelope with `provider`, `externalEventId`, `subaccountId`, `organisationId`, `integrationConnectionId`, and per-type `messageMetadata`/`eventMetadata`/`mentionMetadata` objects. Code's union has flat field shape (no envelope, owner-only). Loses some downstream consumer affordances (e.g. integration_connection_id passing through).
  - Suggested approach: Confirm with downstream consumers whether the simplified shape suffices. If not, expand schema to match spec.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Spec §7.1 amended 2026-05-13 (REQ-C1 amendment line 406) to ratify the flat discriminated union — no envelope. Code at `shared/types/externalSourceTrigger.ts` already matches.

- [x] REQ-EA1 — EA default skill allowlist incomplete vs spec §13.2 [status:closed:pr:324]
  - Spec section: §13.2
  - Gap: `0332_executive_assistant_seed.sql` `default_org_skill_slugs` lists 16 entries. Spec §13.2 names additionally: `read_inbox`, `send_email`, `read_data_source`, `web_search`, `fetch_url`, `scrape_structured`, `ask_clarifying_question`, `request_clarification`, `read_workspace`, `update_memory_block`, `notify_operator`, `read_priority_feed`, `search_agent_history`.
  - Suggested approach: Verify whether the missing skills are auto-enabled via universal-skills (per §13.2: "Universal skills per `server/config/universalSkills.ts` are always available regardless of allowlist"). If yes, allowlist is correct. If no, add the missing slugs to the seed.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Migration `0343_ea_home_widget_spec_align.sql` (lines 26-50) writes the spec-conforming allowlist. Universal skills covered by `server/config/universalSkills.ts`.

- [x] REQ-EA3 — Partial unique index axis differs from spec §13.4 [status:closed:pr:324]
  - Spec section: §13.4 concurrency guard
  - Gap: Code uses `agents(organisation_id, owner_user_id) WHERE slug='executive-assistant'`. Spec specifies `agents(subaccount_id, owner_user_id) WHERE slug='executive-assistant'`. Difference matters when a user has access to multiple subaccounts in the same org: spec's axis allows one EA per subaccount per user; code allows only one EA per user per org.
  - Suggested approach: Align with the multi-subaccount product intent; if users routinely access multiple subaccounts, change the index. If V1 dogfood is single-subaccount only, leave as-is and amend spec.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Spec §13.4 amended 2026-05-13 (REQ-EA3 amendment line 1187) to ratify per-org uniqueness because a single user has one EA across their entire org regardless of subaccount. Code at `migrations/0332_executive_assistant_seed.sql:64-66` already matches.

- [x] REQ-EA4 — EA `home_widget` refreshPolicy differs from spec §13.1 [status:closed:pr:324]
  - Spec section: §13.1
  - Gap: Seed uses `every_5m`; spec says `on_login`. The `every_5m` policy creates more API load per user; `on_login` lazily refreshes on route entry (and is what `useHomeWidgets` invalidates on).
  - Suggested approach: Change seed to `on_login` unless there's a UX reason for periodic refresh.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Migration `0343_ea_home_widget_spec_align.sql:19-25` writes `refreshPolicy: 'on_login'`.

- [x] REQ-EA5 — EA `home_widget.titleTemplate` hardcoded [status:closed:pr:324]
  - Spec section: §13.1 + §13.6 (display name renaming)
  - Gap: Seed hardcodes `"Personal Assistant"`; spec specifies `'${agent.displayName}'`. Once users rename their EA via Settings (§13.6), the home widget should reflect the new name.
  - Suggested approach: Update seed to use template string; ensure homeWidgetService substitutes `${agent.displayName}` when rendering.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Migration `0343_ea_home_widget_spec_align.sql:22` writes `titleTemplate: '${agent.displayName}'`.

- [x] REQ-M15 — Personal nav group placement [status:closed:pr:324]
  - Spec section: §14.1
  - Gap: Spec says Personal group renders at the TOP of the sidebar, above Operate/Build/Govern. Code places it mid-list per `client/src/config/sidebar.ts` ordering comment ("top → work → projects → agents → personal → company → ...").
  - Suggested approach: Move Personal group higher in `buildNavItems` if matching the spec is important for the "first thing the user sees" framing.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Moved `personal` group from position 5 to position 2 in `client/src/config/sidebar.ts`. New order: `top → personal → work → projects → agents → company → ...`. Requires operator visual confirmation in the PR.

- [x] REQ-C3 — `slack.list_channels` Zod schema missing `types` filter [status:closed:pr:324]
  - Spec section: §7.3
  - Gap: Spec input shape includes `types?: Array<'public_channel' | 'private_channel' | 'mpim' | 'im'>`. Code's Zod schema has no `types` field — callers cannot filter channel types.
  - Suggested approach: Add `types` to the action Zod schema and pass through to the Slack handler.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Code at `shared/types/slackAction.ts:3-9` already includes `types` field with the spec-named enum and `default(['public_channel'])`. Conformance log captured an outdated view.

- [x] REQ-CAL3-naming — Calendar write-action error codes differ from spec §8.4 [status:closed:pr:324]
  - Spec section: §8.4 step 2
  - Gap: Spec says `code: 'missing_draft_context'` (422) for missing/invalid `eaDraftId` or owner mismatch. Code uses `DRAFT_NOT_APPROVED`, `DRAFT_NOT_FOUND`, `DRAFT_SEND_IN_FLIGHT` (no `missing_draft_context`). Also: no owner-mismatch check (`ea_drafts.ownerUserId !== agent.ownerUserId`).
  - Suggested approach: Either add the `missing_draft_context` mapping when `eaDraftId` is absent, OR amend spec to use the more granular code set the code emits. Add the owner-mismatch assertion either way (defence-in-depth).
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Spec §8.4 + §24.2 + §24.9 amended 2026-05-13 (sixth-pass cleanup, REQ-CAL3-naming amendment) to ratify the `DRAFT_NOT_*` family used by shipped code. Owner-userId mismatch check is present at `server/services/calendar/calendarActionService.ts:178-183`.

- [x] REQ-M9 — Stall job 7-day proposal expiry path [status:closed:pr:324]
  - Spec section: §5.2 (`workflowGateStallNotifyJob` modification clause) + §20.4 + §22.2
  - Gap: Spec prose says stall job should "transition expired proposal rows (`createdAt + 7d`) to approval state `expired`" for EA-linked drafts. Code's `eaDraftStallResetHandler` only resets `sending → idle`. Existing `actions` primitive expiry may already cover this, but the spec's explicit clause says it should be added to the stall job for EA-linked rows.
  - Suggested approach: Verify whether existing `actions` expiry handles this; if not, extend the stall job to query `actions WHERE metadata_json->>'kind' = 'ea_draft' AND status='pending_approval' AND suspend_until < now()` and transition to `expired`/`rejected`.
  - **Closed 2026-05-15 (pa-v1-cleanup-batch):** Pre-existing primitive at `server/jobs/workflowGateStallNotifyJob.ts:124-135` already sweeps proposal rows at 7d with `metadata.systemExpired = true` + `expired_after_7d`. Spec §5.1 + §20.4 + §22.2 amended 2026-05-13 (seventh-pass cleanup, REVIEW-F1) to honestly describe the terminal state as `rejected` with metadata flags (the `actions` primitive has no `expired` status).

## Deferred from pa-v1-cleanup-batch review pass (2026-05-15)

**Captured:** 2026-05-15T19:00:00Z
**Source logs:**
- `tasks/review-logs/adversarial-review-log-pa-v1-cleanup-batch-2026-05-15T19-00-00Z.md`
- pr-reviewer R1 (CHANGES_REQUESTED → APPROVED after fix-loop)

- [ ] **PA-CLEANUP-DEF-1 — Missing `organisationId` predicate on three state-flip UPDATEs in `voiceProfileService.deriveProfile`** (adversarial LIKELY)
  - File: `server/services/voiceProfile/voiceProfileService.ts:88-91`, `:99-102`, `:112-121`
  - Gap: The initial claim UPDATE at lines 29-39 correctly includes `eq(voiceProfiles.organisationId, ctx.organisationId)`, but the three follow-on state-flip UPDATEs (error path, empty-samples path, success path) filter only on `voiceProfiles.id`. UUIDs are unguessable and the initial claim is org-scoped, so practical exploitability is low — but the defense-in-depth gap is real and inconsistent with `optOut`/`reactivate` (which DO include the org predicate). Pre-existing baselined pattern (bare-`db` posture across 10 callsites in this file).
  - Suggested approach: Add `eq(voiceProfiles.organisationId, ctx.organisationId)` to all three follow-on `.where()` clauses. Mechanical change.

- [ ] **PA-CLEANUP-DEF-2 — `operatorSessionInitialContextBundler.ts:83-88` voice profile SELECT missing application-layer `organisationId` predicate** (adversarial WORTH_CONFIRMING)
  - File: `server/services/operatorSessionInitialContextBundler.ts:80-90`
  - Gap: Query runs via `getOrgScopedDb()` so the Postgres session variable IS set and RLS enforces — but no application-layer `eq(voiceProfilesTable.organisationId, input.organisationId)` predicate. DEVELOPMENT_GUIDELINES.md §1 mandates application-layer filtering even with RLS. If the RLS session variable is ever absent in a background context, no backstop.
  - Suggested approach: Add the explicit application-layer predicate.

- [ ] **PA-CLEANUP-DEF-3 — Nightly voice profile refresh job emits no durable audit row per profile** (adversarial WORTH_CONFIRMING)
  - File: `server/jobs/voiceProfileRefreshJob.ts:46,48`
  - Gap: Log lines via `logger.info/error` are observability, not durable audit (no row in `audit_events` or `agent_execution_events`). Acceptable for V1 (system-initiated background action). Future compliance requirements may demand a per-refresh audit trail.
  - Suggested approach: If/when needed, emit a `voice.profile.refreshed` event row.

- [ ] **PA-CLEANUP-DEF-4 — `voiceProfileService.deriveProfile` writes `sampleSize: 0` (hardcoded) instead of actual sample count** (pr-reviewer STRONG_RECOMMENDATION)
  - File: `server/services/voiceProfile/voiceProfileService.ts:118`
  - Gap: The column rename `sample_count → sample_size` was driven by REQ-C4 to align with spec semantics. Persisting `0` defeats the rename's purpose. Existing comment "sample count intentionally zeroed — samples not retained" conflates two concerns: "we don't keep the sample text" vs "we don't record how many we processed". Spec §1092 trace event `voice.profile.refreshed { profileId, sampleSize, durationMs }` expects the actual count.
  - Suggested approach: Decide whether `sampleSize` should reflect the actual N. If yes, change `sampleSize: 0` to use `samples.length`. If no (privacy concern), update the spec §1009 + §1092 + §12 column semantics to document that `sample_size` is intentionally zero post-derivation.

- [ ] **PA-CLEANUP-DEF-5 — Stale doc comments referencing old voice_profiles column names** (pr-reviewer CONSIDER)
  - Files: `server/services/voiceProfile/voiceProfileServicePure.ts:128` (JSDoc references `last_refreshed_at` and `refresh_config.days`); `server/jobs/voiceProfileRefreshJob.ts:15` (JSDoc could mention `refresh_config.days` is read via `shouldRefresh` post-query); `server/services/operatorSessionService.ts:90-91` (comment "V1: lastRefreshedAt column not yet added (Chunk 6)" — references AiSubscriptionConnection, not voice_profiles, but phrasing is confusing post-rename)
  - Suggested approach: One-line doc updates. Cosmetic only.

- [ ] **PA-CLEANUP-DEF-6 — KNOWLEDGE.md rule: column-rename grep discipline** (pr-reviewer STRONG_RECOMMENDATION, process improvement)
  - Gap: Architect's chunk-0 file-set enumeration missed `agentExecutionServicePure.ts` and `operatorSessionInitialContextBundler.ts` (and would have missed `eaProvisioningService.ts` too) because the chunk-0 sweep grepped for Drizzle field names without also greping for snake_case column names in select projections / SQL templates / spec-referenced provisioning code.
  - Suggested approach: Append a Pattern entry to KNOWLEDGE.md: "When planning a column rename, grep BOTH camelCase Drizzle field names AND any snake_case literals in select projections AND any spec-referenced provisioning code paths that write the column." Captured by finalisation-coordinator Step 7.

- [ ] **PA-CLEANUP-DEF-7 — Failed voice profiles get retried nightly under `refreshPolicy='periodic'`** (dual-reviewer Codex iter 2, P2)
  - Files: `server/jobs/voiceProfileRefreshJob.ts:35-45`, `server/services/voiceProfile/voiceProfileServicePure.ts:131-146` (`shouldRefresh`), `server/services/voiceProfile/voiceProfileService.ts:36` (`deriveProfile` claim predicate).
  - Gap (pre-existing, surfaced by REQ-C4 provisioning change): When a newly-provisioned `periodic` profile's first derivation fails (sampler error / no samples), the row ends in `state='failed'` with `lastDerivedAt = null`. The nightly job filters by `refreshPolicy='periodic' AND opt_out_at IS NULL`, `shouldRefresh` returns `true` for null `lastDerivedAt`, and `deriveProfile` allows `failed` rows to be claimed (`inArray(state, ['pending', 'ready', 'failed'])`). Result: every failed opt-in profile is re-derived every night until manually opted out or fixed. The state machine in `canTransitionState` says `failed → pending` is the "manual retry path" only — so the nightly job is bypassing the intended state semantics.
  - Why deferred from this PR: REQ-C4 scope is column-rename + provisioning-shape alignment per spec §13.4 step 6. The spec mandates `refreshPolicy='periodic'` at provisioning (pr-reviewer R1 BLOCKING), and the behavioral interaction with `failed` rows is pre-existing — it predates this PR and would surface for ANY periodic profile, not just wizard-provisioned ones. Fix requires a spec decision (should the refresh job skip `state='failed'`? Should `shouldRefresh` require non-null `lastDerivedAt`? Should `deriveProfile` exclude `failed` from the claim predicate?).
  - Suggested approach: Pick one: (a) add `ne(voiceProfiles.state, 'failed')` to the nightly job's candidate query, (b) make `shouldRefresh` return `false` when `lastDerivedAt` is null AND `state='failed'`, or (c) tighten `deriveProfile`'s claim predicate to exclude `failed` so only the explicit `optOut` / `reactivate` flow can transition out of `failed`. Option (a) is the smallest change and respects the state-machine intent.

## Deferred spec decisions — feat-split-usagepage (2026-05-14)

Routed from `spec-reviewer` autonomous decisions during iteration 1 of `tasks/builds/feat-split-usagepage/spec.md`. These are informational — the spec is mechanically tight and READY_FOR_BUILD; review only if you want to revisit a directional call.

- [ ] **Codex #9 — `setRoutingFilters` / `setIeeFilters` update-pattern contract.** AUTO-REJECT (framing). Codex suggested specifying how filter setters avoid reload loops. Rejected because this is a pure refactor preserving today's plain `setState` behaviour, and adding a defensive contract over a simple setter is over-specification for pre-production / rapid-evolution scope.



## Deferred from spec-conformance review — feat-split-adminsubaccountdetailpage (2026-05-15)

**Captured:** 2026-05-15T14:26:25Z
**Source log:** `tasks/review-logs/spec-conformance-log-feat-split-adminsubaccountdetailpage-2026-05-15T14-26-25Z.md`
**Spec:** `tasks/builds/feat-split-adminsubaccountdetailpage/spec.md`

- [x] **E4 — Host retains shared `error` state + banner that spec §8 and plan §Chunk 4 said to remove.** RESOLVED 2026-05-15: option (b) applied — host `error` state renamed to `loadError`, the tab-switch `setError('')` clear and the line-115 banner removed, the early-return at the loading guard now uses `{loadError || 'Subaccount not found'}`. Subsequent-refresh failures inside `load()` still set `loadError` but the banner above tab dispatch is gone (cannot fire on a hydrated `sa`, matches spec §8). Typecheck + build clean.



## Deferred from spec-conformance review — feat-split-layout (2026-05-15)

**Captured:** 2026-05-15T01:10:00Z
**Source log:** `tasks/review-logs/spec-conformance-log-feat-split-layout-2026-05-15T01-10-00Z.md`
**Spec:** `tasks/builds/feat-split-layout/spec.md`

- [x] **REQ #14 — Optimistic subaccount addition on new-client create dropped.** RESOLVED 2026-05-15: option (b) applied — `addSubaccount(sa: ClientOption)` added to `useLayoutIdentity.ts` (dedupes by id), wired into `Layout.tsx`'s `CreateClientModal.onCreated` as `identity.addSubaccount(client); identity.selectClient(client);`. CreateClientModal's wasteful background `api.get('/api/subaccounts')` discard was also removed. Icon now appears in the rail immediately on create, matching pre-refactor behaviour.
- [x] **REQ #15 — `SidebarShell` prop contract divergence.** RESOLVED 2026-05-15: option (a) applied — the two redundant `isSystemAdmin` / `activeOrgName` props removed from both the `SidebarShellProps` interface and the host invocation. Component now consumes `identity.isSystemAdmin` and `identity.activeOrgName` directly. The spec §8.2 prop list is the contract drift; mentioned here so a future spec-touch can clean it up.

## Deferred from spec-conformance review — feat-split-subaccountknowledgepage (2026-05-15)

**Captured:** 2026-05-15T17:21:49Z
**Source log:** `tasks/review-logs/spec-conformance-log-feat-split-subaccountknowledgepage-2026-05-14T17-21-49Z.md`
**Spec:** `tasks/builds/feat-split-subaccountknowledgepage/spec.md`

- [x] **REQ #1 — `ReferencesTab.tsx` exceeds the §10 Chunk 4 conditional extraction threshold.** RESOLVED 2026-05-15: extracted `RenameReferenceModal.tsx` per spec §10 Chunk 4 with the named prop shape (`subaccountId`, `reference`, `initialTitle`, `onClose`, `onRenamed`). The modal owns its `title` state seeded from `initialTitle`, calls `api.patch` + `toast.success('Reference renamed')` + `await onRenamed()` directly. `ReferencesTab.tsx` now shrunk and the rename modal is fully self-contained. Typecheck + build clean.

---

## 2026-05-15 — page-splits chatgpt-pr-review Round 1 deferrals

**Captured:** 2026-05-15 (PR #313 chatgpt-pr-review Round 1)
**Source log:** `tasks/review-logs/chatgpt-pr-review-page-splits-2026-05-14T21-53-53Z.md`

- [ ] **PAGE-SPLITS-T1 — Consolidate duplicate `formatTime` / `formatConvDate` helpers across agent-chat and config-assistant.** ChatGPT-suggested follow-up. The page-split refactor authored these helpers separately under `client/src/components/agent-chat/format.ts` and `client/src/components/config-assistant/format.ts` to keep each split atomic. Move to a shared `client/src/components/chat/format.ts` (or `lib/dateFormat.ts`) in a follow-up. Acceptable for this PR.
- [ ] **PAGE-SPLITS-T2 — Tighten weak error handling in extracted components.** Pre-existing weak error handling (swallowed `create-project` errors, `category`/`workflow` delete calls without catch) was carried through unchanged by the splits. Not introduced by PR #313 but worth a cleanup pass.

---

## Deferred from spec-conformance review — feat-split-skillexecutor (2026-05-14)

**Captured:** 2026-05-14T19:26:46Z
**Source log:** `tasks/review-logs/spec-conformance-log-feat-split-skillexecutor-2026-05-14T19-26-46Z.md`
**Spec:** `tasks/builds/feat-split-skillexecutor/spec.md`

- [ ] SKILLEXEC-SPLIT-DEF-CONF-1 — Spec self-contradiction: §5.2 names both `capabilities.ts` (line 123, "capability discovery skills — re-export thin shells calling existing capability handlers") and `capabilityDiscovery.ts` (line 145, eight specific slugs); §7 Chunk 11 references `handlers/capabilities.ts` while §7 Chunk 10c references `handlers/capabilityDiscovery.ts`. The two descriptions overlap in responsibility.
  - Spec section: §5.2 lines 123 & 145; §7 Chunk 10c & Chunk 11
  - Gap: Implementation consolidated to a single `handlers/capabilityDiscovery.ts` covering all 8 named slugs (`list_platform_capabilities`, `list_connections`, `check_capability_gap`, `request_feature`, `ask_clarifying_questions`, `ask_clarifying_question`, `challenge_assumptions`, `request_clarification`). No separate `capabilities.ts` was created. Slug coverage matches the union, but the spec's two-module phrasing is internally inconsistent.
  - Suggested approach: Amend the spec (post-merge erratum) to delete the `capabilities.ts` row from §5.2 and consolidate into the `capabilityDiscovery.ts` entry. Do NOT split into two modules — the consolidation is the correct outcome; only the spec text needs cleanup.

- [ ] SKILLEXEC-SPLIT-DEF-CONF-2 — Spec §5.5 narrative incorrectly claims `executeSpawnSubAgents` uses `enqueueHandoff`; implementation correctly preserves source behaviour (synchronous spawn via `agentExecutionService.executeRun`).
  - Spec section: §5.5 line 217 ("Handlers that need to enqueue a handoff (currently `executeReassignTask` and `executeSpawnSubAgents`) import `enqueueHandoff` from `pipeline.ts`"); §5.3 line 197 cross-edge claim "(b) `handlers/tasks.ts` and `handlers/handoff.ts` both import `enqueueHandoff` from `pipeline.ts`".
  - Gap: `handlers/handoff.ts` does NOT import `enqueueHandoff`. `executeSpawnSubAgents` calls `agentExecutionService.executeRun` directly (synchronous in-process) — the spec's behaviour claim conflicts with the source's actual behaviour. Only `handlers/tasks.ts` (executeReassignTask path) imports `enqueueHandoff`. The implementation respects the spec's binding constraint (§2 "No behaviour change") which dominates the §5.5 narrative.
  - Suggested approach: Amend the spec (post-merge erratum) — strike `executeSpawnSubAgents` from §5.5 line 217 and revise §5.3 line 197 cross-edge (b) to name only `handlers/tasks.ts` as the consumer of `enqueueHandoff`. No code change required; behaviour is correct as shipped.

---

## Deferred from codebase audit — 2026-05-14 (Track A: RLS + agent-execution)

**Captured:** 2026-05-14T13-14-38Z
**Source log:** tasks/review-logs/codebase-audit-log-rls-agent-exec-2026-05-14T13-14-38Z.md

- [x] [origin:audit:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:329] **F2 — `verify-rls-protected-tables.sh` silent exit 123 on Windows Git Bash.** Wrapped the rename-map `xargs -0 grep ... | sed ...` pipeline with `|| true` so a zero-match grep under `set -euo pipefail` + Git Bash does not abort the gate. Inline comment cites F2. Linux CI behaviour unchanged (the pipeline still produces the same MIGRATION_TABLES output).
- [x] [origin:audit:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:tbd-wave-5] **F3 — `verify-rls-contract-compliance.sh` allowlist on `server/services/` masks raw-db usage at the service tier.** medium/medium. 231 of 526 service files import `db`; many call `db.select(...)` on tenant-scoped tables outside the ALS `withOrgTx` block. App-layer `where(eq(table.organisationId, orgId))` is the only defence — RLS-as-defence-in-depth depends on whether the prod DB role enforces RLS (TI-008 tracks the dev gap). Recommended action: architectural migration to `getOrgScopedDb()` for tenant-scoped service-tier queries; widen `verify-with-org-tx-or-scoped-db.sh` to flag the pattern. Per-service work — no bulk auto-fix.
- [x] [origin:audit:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:tbd-wave-5] **F4 — `agentExecutionService.executeRun` (2,807 LOC) uses raw `db` extensively while `resumeAgentRun` in the same file uses `getOrgScopedDb`.** medium/high. Lines 477, 496, 513, 540 (and elsewhere) hit organisations, subaccounts, agent_runs, subaccountAgents on the unscoped pool. The mixed posture suggests an incomplete migration. Recommended action: migrate `executeRun` to `getOrgScopedDb('agentExecutionService.executeRun')` and verify every call site (HTTP routes, pg-boss jobs, scheduled tasks, recovery paths) opens `withOrgTx` first. Defer to F3 / F4 combined remediation.
- [x] [origin:audit:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:318] **F5 — `GET /api/agents` lacks `requireOrgPermission`.** low/medium. `server/routes/agents.ts:36`: any authenticated user (including users with zero agent permissions) can list org-scoped agents. Other agent routes gate via `requireOrgPermission(AGENTS_VIEW)`. May be intentional ("everyone sees owned agents") but undocumented. Recommended action: either add `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` for consistency, OR add a one-line comment documenting the intent. Product call.
- [x] [origin:audit:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:329] **F6 — God-files persist after the operator-stated splits.** medium/high. Verified 2026-05-16: `server/services/skillExecutor.ts` 4 LOC (barrel, PR #317), `agentExecutionService.ts` 248 LOC (PR #314), both under hard cap. `agentExecutionLoop.ts` remaining open is tracked under a separate Area 10 follow-up.
- [x] [origin:audit:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:tbd-wave-5] **F7 — `server/services/skillExecutor.ts:4302` raw `db.update(tasks)` write.** medium/medium. Carries a `guard-ignore-next-line` annotation citing prior `taskService.updateTask` org verification, but the trust chain is fragile — the earlier call closes its own tx and this write opens a fresh unscoped one. Same root cause as F3 / F4. Recommended action: use `getOrgScopedDb()` and pass the active tx through.
- [x] [origin:audit:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:operator-decision:doc-only:wave-5-session-k] **F8 — Manual-run idempotency key time-buckets to 10 seconds.** low/medium. `server/routes/agentRuns.ts:54-55` — `manual:${agentId}:${subaccountId}:${userId}:${taskId??'heartbeat'}:${Math.floor(Date.now()/10000)}`. Two intentional triggers within the same 10s window with the same defaults (e.g. user clicks "Run" twice fast on heartbeat with no taskId) collide. Mitigation exists (caller may supply explicit `idempotencyKey`). Operator decision 2026-05-15: documented-trade-off-only. Inline comment present at agentRuns.ts:55-62; KNOWLEDGE.md pattern entry at line 1980 (Idempotency keys with time-bucketed defaults). Verified in main 2026-05-16 Wave 5 Session K.

## Prevention proposals from codebase audit — 2026-05-14 (Track A: RLS + agent-execution)

**Captured:** 2026-05-14T13-14-38Z
**Source log:** tasks/review-logs/codebase-audit-log-rls-agent-exec-2026-05-14T13-14-38Z.md

- [x] [origin:audit:prevention:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:317] [target:gate] **P1 — Tighten `verify-org-id-source.sh` default exit code from 2 (warning) to 1 (blocking) on post-baseline regressions.** Currently new code can warn-and-merge — the F1 portal.ts regression (9 violations introduced 2026-05-05) sat in main for over a week. Pairs with a baseline-freeze rule: any future increase requires an explicit baseline bump in the same commit. Closes findings: F1. Leverage tier 1 (block at write time).
- [ ] [origin:audit:prevention:rls-agent-exec:2026-05-14T13-14-38Z] [status:open] [target:gate] **P2 — Widen `verify-with-org-tx-or-scoped-db.sh` to flag service-tier raw-db query patterns on tenant-scoped tables.** Specifically, flag `db.(select|insert|update|delete)(<RLS_PROTECTED_TABLE>)` inside `server/services/` that does not have a sibling `getOrgScopedDb()` call in the same function scope. Allowlist via `guard-ignore`. Closes the false-negative from `verify-rls-contract-compliance.sh`'s `server/services/` directory allowlist. Closes findings: F3, F4, F7. Leverage tier 1.
- [ ] [origin:audit:prevention:rls-agent-exec:2026-05-14T13-14-38Z] [status:open] [target:gate] **P3 — Windows-portable harness test for `scripts/verify-*.sh`.** For each gate, run on a freshly-cloned repo (Linux CI is sufficient — goal is OS-parity behaviour) and assert exit ∈ {0, 1, 2} AND non-empty stdout. Catches scripts that silently die under `set -euo pipefail` + Git Bash quirks. Closes findings: F2. Leverage tier 1.
- [x] [origin:audit:prevention:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:329] [target:DEVELOPMENT_GUIDELINES.md] **P4 — Add convention rule: services that read or write tenant-scoped tables MUST use `getOrgScopedDb()`.** Added as §8.40 in DEVELOPMENT_GUIDELINES.md. Documents the two-layer defence model (Layer A app-side predicate + Layer B RLS via the GUC bound by `withOrgTx`), allowlist escape via `withAdminConnection` and `rls-not-applicable-allowlist.txt`, and the `guard-ignore-next-line: rls-contract-compliance` marker. Pairs with P2 (deferred — separate gate-hardening PR).
- [x] [origin:audit:prevention:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:317] [target:architecture.md] **P5 — Document the mixed posture in `agentExecutionService.ts`.** `executeRun` runs on raw `db` (pre-migration); `resumeAgentRun` runs on `getOrgScopedDb`. State the target and link to F4. Prevents future maintainers from assuming the file is fully migrated. Closes findings: F4. Leverage tier 2.
- [x] [origin:audit:prevention:rls-agent-exec:2026-05-14T13-14-38Z] [status:closed:pr:317] [target:KNOWLEDGE.md] **P6 — Pattern entry: god-files persisting after a 'split' commit.** `skillExecutor.ts` was claimed split but is still 6,133 LOC. Splits should produce a single PR that drops the original file under its hard cap, not just adds a `*Pure.ts` companion. Closes findings: F6. Leverage tier 3 (lesson via context).

## Deferred from codebase audit — 2026-05-14 (Track A2: workflowEngine split)

**Captured:** 2026-05-14T16-30-31Z
**Source log:** tasks/review-logs/codebase-audit-log-workflow-engine-2026-05-14T16-30-31Z.md

- [ ] [origin:audit:workflow-engine:2026-05-14T16-30-31Z] [status:open] **WF1 — Five FK-scoped tenant tables have NO RLS policies.** **high/high.** `workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs` hold tenant-private data (LLM payloads, agent outputs, HITL decisions, workflow studio chat sessions) but have zero Postgres-level isolation. They are FK-scoped to RLS-protected parents but lack their own `CREATE POLICY` statements. Concrete evidence: `server/services/workflowEngineService.ts:151-152` queries `workflow_step_runs` by id alone with no org filter. The gate `verify-rls-protected-tables.sh` misses this because it only inspects `organisation_id`-column-bearing tables. Recommended action: add a migration with EXISTS-based RLS policies joining through each parent (same shape as `document_bundle_members`/`subaccount_baseline_metrics` policies). Also add the five tables to the check2-exempt section of `scripts/rls-not-applicable-allowlist.txt` with rationale.
- [x] [origin:audit:workflow-engine:2026-05-14T16-30-31Z] [status:closed:wave-5-session-k:verified-in-main] **WF2 — `workflowEngineService.ts` god-file persists post-split.** *Verified in main 2026-05-16: `server/services/workflowEngineService.ts` is now 64 LOC (was 4,073).* medium/high. 4,073 LOC, 1.6× hard cap (2,500), 2.7× soft cap. The `workflowEngineServicePure.ts` companion landed (95 LOC) but the main file's 20-method surface (enqueueTick, tick, dispatchStep, resolveAgentForStep, findReusableOutputForStep, resumeInvokeAutomationStep, failStepRunInternal, editStepOutput, handleBulkFanOut, checkBulkParentCompletion, replayDispatch, createReplayRun, completeStepRunInternal, completeStepRunFromReview, completeStepRun, failStepRun, onAgentRunCompleted, handleDecisionStepCompletion, watchdogSweep, registerWorkers) was not reduced. Per Area 10, splits are always Pass 3. Recommended next: per-phase decomposition (workflowEngineDispatch, workflowEngineCompletion, workflowEngineBulkFanOut, workflowEngineReplay).
- [ ] [origin:audit:workflow-engine:2026-05-14T16-30-31Z] [status:open] **WF3 — `workflowEngineService.ts` uses raw `db` 18 times, `getOrgScopedDb` 0 times.** medium/medium. Same root cause as Track A F3/F4 (PR #308). Service does not import `getOrgScopedDb`. All tenant-touching queries on the unscoped pool. Recommended action: thread `getOrgScopedDb()` through the service; pair with the WF4 tick refactor.
- [ ] [origin:audit:workflow-engine:2026-05-14T16-30-31Z] [status:open] **WF4 — Workflow tick worker opts out of org context (`resolveOrgContext: () => null`) without re-opening `withOrgTx` after loading the run row.** medium/high. `server/services/workflowEngineService.ts:3897`. After looking up the org from the run, the rest of `tick()` (30+ DB calls) runs unscoped. `watchdogSweep` at line 3908 has the same issue at a per-iteration level. Recommended action: refactor `tick()` to wrap the run-loaded section in `withOrgTx({tx, organisationId: run.organisationId, ...}, ...)` and use `getOrgScopedDb()` thereafter; `watchdogSweep` should scope per iteration.
- [x] [origin:audit:workflow-engine:2026-05-14T16-30-31Z] [status:closed:wave-5-session-k:verified-in-main] **WF5 — Workflow run permission inconsistency: subaccount routes use `WORKFLOW_RUNS_*`, org routes reuse `AGENTS_VIEW`/`AGENTS_EDIT`.** medium/medium. `server/routes/workflowRuns.ts` lines 100, 152, 162, 177, 203, 247, 291, 311. The codebase has proper org-tier workflow perms (`WORKFLOW_TEMPLATES_READ`, `WORKFLOW_STUDIO_ACCESS`, `WORKFLOW_RUNS_START` org-scope variant) but no `WORKFLOW_RUNS_VIEW_ALL` / `WORKFLOW_RUNS_ADMIN`. Recommended action: either add the missing org-tier workflow perms and switch the routes, OR document the workflows-as-agents intent inline. Product call.
- [ ] [origin:audit:workflow-engine:2026-05-14T16-30-31Z] [status:open] **WF6 — `workflowAgentRunHook.ts:36-39` raw `db.select` on `agent_runs` by id with no org filter.** low/medium. Hook is invoked at agent-run completion. The chain breaks because the caller (`agentExecutionService`) itself uses raw db (Track A F4). Recommended action: use `getOrgScopedDb('workflowAgentRunHook.notifyOnComplete')`; defer to wider WF3 / Track A F3+F4 migration.
- [x] [origin:audit:workflow-engine:2026-05-14T16-30-31Z] [status:closed-during-audit] **WF7 — `workflowEngineService.tick()` advisory-lock comment stale.** RESOLVED 2026-05-14 in Pass 2: verified AR-3.1 was closed 2026-05-06 (PR #267, see `tasks/todo-archive-2026-Q2.md:3075`) — singletonKey-is-load-bearing rationale, full-tx wrap deferred to Phase 4 if profiling needs it. Updated the inline comment at `server/services/workflowEngineService.ts:837-847` to drop the stale "deferred to AR-3.1 / tracked in tasks/todo.md" pointer and replace with the closure rationale + Phase 4 profiling trigger.
- [ ] [origin:audit:workflow-engine:2026-05-14T16-30-31Z] [status:closure-pending-merge:slug:split-workflow-engine] **WF8 — `GET /api/workflow-runs/:runId` gates via `AGENTS_VIEW`.** low/medium. `server/routes/workflowRuns.ts:100`. User-facing form of WF5. Subsumed by WF5 fix.

## Prevention proposals from codebase audit — 2026-05-14 (Track A2: workflowEngine split)

**Captured:** 2026-05-14T16-30-31Z
**Source log:** tasks/review-logs/codebase-audit-log-workflow-engine-2026-05-14T16-30-31Z.md

- [x] [origin:audit:prevention:workflow-engine:2026-05-14T16-30-31Z] [status:closed:superseded:q2] [target:gate] **Q1 — Extend `verify-rls-protected-tables.sh` Check 1 to flag FK-scoped tables without `CREATE POLICY` and without a `# check2-exempt:` allowlist entry.** Superseded by Q2 (closed:pr:317) — `verify-fk-only-tenant-tables.sh` covers the same surface at lower complexity (schema-file level instead of extending the existing gate).
- [x] [origin:audit:prevention:workflow-engine:2026-05-14T16-30-31Z] [status:closed:pr:317] [target:gate] **Q2 — Add a gate `verify-fk-only-tenant-tables.sh` walking schema files for pgTable definitions that reference a tenant-scoped parent but have no `organisation_id` column AND no migration-level `CREATE POLICY` AND no allowlist entry.** Lower-cost alternative to Q1 — works at the schema-file level. Closes findings: WF1. Leverage tier 1.
- [x] [origin:audit:prevention:workflow-engine:2026-05-14T16-30-31Z] [status:closed:pr:317] [target:architecture.md] **Q3 — Document the FK-scoped RLS pattern explicitly: "A table holding tenant-private data and referencing a tenant-scoped parent via FK MUST either (a) carry its own `organisation_id` column + RLS policy, OR (b) carry an EXISTS-based policy joining through the parent FK. FK-alone is not protection."** Cite existing examples (`connector_location_tokens`, `document_bundle_members`, `subaccount_baseline_metrics`). Closes findings: WF1. Leverage tier 2.
- [x] [origin:audit:prevention:workflow-engine:2026-05-14T16-30-31Z] [status:closed:pr:317] [target:DEVELOPMENT_GUIDELINES.md] **Q4 — Add convention: "A pg-boss worker that sets `resolveOrgContext: () => null` MUST re-open `withOrgTx` after loading the run/job's organisation. The opt-out is for the initial cross-tenant lookup only."** Closes findings: WF4. Leverage tier 2.
- [x] [origin:audit:prevention:workflow-engine:2026-05-14T16-30-31Z] [status:closed:pr:317] [target:KNOWLEDGE.md] **Q5 — Pattern entry: "FK-scoped tenant data ≠ RLS-protected." Five workflow tables held tenant-private payloads with no Postgres-level isolation; the audit found this via grepping `migrations/*.sql` for policy statements against the table names.** Closes findings: WF1. Leverage tier 3.
- [x] [origin:audit:prevention:workflow-engine:2026-05-14T16-30-31Z] [status:closed:pr:317] [target:gate] **Q6 — New lint gate flags any `requireOrgPermission(AGENTS_*)` call inside a file matching `server/routes/workflow*.ts`.** Forces deliberate choice: rename to `WORKFLOW_*` perms or add `guard-ignore` comment. Closes findings: WF5, WF8. Leverage tier 1.

## Deferred from codebase audit — 2026-05-14 (Track A3: skillAnalyzerServicePure split)

**Captured:** 2026-05-14T16-53-39Z
**Source log:** tasks/review-logs/codebase-audit-log-skill-analyzer-2026-05-14T16-53-39Z.md

- [x] [origin:audit:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:320] **SA1 — `skill_analyzer_results` lacks RLS policy.** medium/high. FK-scoped to `skill_analyzer_jobs` (RLS-protected) but no `CREATE POLICY` of its own. Holds per-tenant classification data (candidateSlug, classification, diff_summary). Mitigation: routes are system-admin-only (`skillAnalyzer.ts:28-29`); narrower blast radius than Track A2 WF1. Recommended action: migration with parent-EXISTS policy + allowlist entry.
- [x] [origin:audit:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:320] **SA2 — Inverted god-file split.** medium/high. `skillAnalyzerService.ts` 2,642 LOC + `skillAnalyzerServicePure.ts` 3,727 LOC. The Pure module is larger than its impure shell — total 6,369 LOC across the "split". Recommended action: decompose `skillAnalyzerServicePure.ts` by pipeline stage (parsePure, hashPure, embedPure, comparePure, classifyPure, writePure).
- [x] [origin:audit:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:327] **SA3 — `skillAnalyzerJob.ts` 2,254 LOC.** medium/high. Split by pipeline stage in PR #327 (split-services-soft-cap-batch): 1 LOC barrel + 16 stage sub-modules under `server/jobs/skillAnalyzerJob/`. R5 (extending Area 10 caps to jobs) already shipped separately in PR #317.
- [x] [origin:audit:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:320] **SA4 — `server/index.ts:691` uses `boss.work` directly, bypassing `createWorker`.** medium/high. The skill-analyzer worker never enters the canonical `withOrgTx` prelude. Same family as Track A2 WF4 (workflow tick worker, different bypass mechanism). Recommended action: convert to `createWorker({queue: 'skill-analyzer', boss, ..., resolveOrgContext: (job) => /* look up org */, handler: ...})`.
- [x] [origin:audit:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:329] **SA5 — Route URL UK spelling vs file/service US spelling.** Operator-confirmed 2026-05-15: keep both forms (UK at URL surface, US internal). Documented as "URL naming conventions" subsection under `architecture.md § Route Conventions § Shared route helpers`. Closes finding without renaming.
- [x] [origin:audit:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:320] **SA6 — `skillAnalyzerService.ts:2001,2009` raw `db.insert` on `skill_analyzer_results` outside `getOrgScopedDb`.** medium/high. Same family as Track A F3/F4, Track A2 WF3. Worsened because SA4 (no upstream withOrgTx). Recommended action: migrate once SA4 lands.

## Prevention proposals from codebase audit — 2026-05-14 (Track A3: skillAnalyzerServicePure split)

**Captured:** 2026-05-14T16-53-39Z
**Source log:** tasks/review-logs/codebase-audit-log-skill-analyzer-2026-05-14T16-53-39Z.md

- [x] [origin:audit:prevention:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:317] [target:gate] **R1 — Gate flags any `boss.work(...)` call outside `server/lib/createWorker.ts` and `server/lib/__tests__/`.** Forces canonical worker registration or explicit annotation. Closes findings: SA4. Tier 1.
- [x] [origin:audit:prevention:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:317] [target:architecture.md] **R2 — Document the canonical worker registration pattern.** "Every pg-boss queue handler MUST be registered via `createWorker(...)`. Bare `boss.work(...)` is reserved for the wrapper itself and boot-time DLQ wiring." Closes findings: SA4. Tier 2.
- [x] [origin:audit:prevention:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:320] [target:gate] **R3 — Extend Track A2 Q1/Q2 gates to also cover `skill_analyzer_results`.** FK-scoped tenant tables without explicit RLS. Closes findings: SA1. Tier 1.
## 2026-05-15 — split-skill-analyzer spec-conformance deferred items

- [ ] [origin:spec-conformance:split-skill-analyzer:2026-05-15] [status:open] **SC-1 — `NameMismatch` and `detectNameMismatch` are in `validation.ts` (not `collisions.ts`).** Spec §5.2 places them in `skillAnalyzerServicePure/collisions.ts`; they landed in `validation.ts` due to tight coupling with `validateMergeOutput` during the Chunk 4/5 split. Public surface unaffected (barrel re-exports both files). Move them to `collisions.ts` and update import in `validation.ts` + `collisions.ts` post-merge when circular-import risk is low. Review log: `tasks/review-logs/spec-conformance-split-skill-analyzer-2026-05-15T05-37-50Z.md`.
- [x] [origin:audit:prevention:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:317] [target:KNOWLEDGE.md] **R4 — Pattern entry: a 'split' commit can land two god-files instead of one.** `skillAnalyzerServicePure.ts` (3,727 LOC) larger than its impure shell (2,642 LOC). Check `wc -l` on both sides of every split-PR. Closes findings: SA2. Tier 3.
- [x] [origin:audit:prevention:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:317] [target:docs/codebase-audit-framework.md] **R5 — Extend Area 10 caps table to cover `server/jobs/*.ts` at the same soft/hard thresholds as services.** Closes findings: SA3. Tier 2.
- [x] [origin:audit:prevention:skill-analyzer:2026-05-14T16-53-39Z] [status:closed:pr:317] [target:KNOWLEDGE.md] **R6 — Pattern entry: URL paths can diverge from file/service spelling.** Audit spot-check: grep route file for `router.*` and compare URL to identifiers. Closes findings: SA5. Tier 3.

## Deferred advisory — fix-route-db-support-agent (2026-05-15, chatgpt-pr-review Round 2)

**Source:** tasks/review-logs/chatgpt-pr-review-fix-route-db-support-agent-2026-05-15T03-51-10Z.md
**PR:** #318
**Tag:** fix-route-db-support-agent, advisory

- [x] [origin:chatgpt-pr-review:fix-route-db-support-agent:2026-05-15] [status:closed:pr:329] [tag:hardening] **SUPPORT-PATCH-SCOPE-ORDER** — Operator-approved 2026-05-15: add pre-validation scope check so sibling-subaccount PATCH always returns 403 regardless of payload validity. Implemented in this PR: `assertInboxScope(inbox, principal)` helper added to `server/services/supportInboxService.ts` and called from `server/routes/support/supportAgentRoutes.ts` after `getInboxForOrg` and before any `req.body` validation. `updateAgentConfig` refactored to call the same helper (DRY).

## Deferred from spec-conformance review — split-services-soft-cap-batch (2026-05-15)

**Captured:** 2026-05-15T12:35:05Z
**Source log:** `tasks/review-logs/spec-conformance-log-split-services-soft-cap-batch-2026-05-15T12-35-05Z.md`
**Spec:** `tasks/builds/split-services-soft-cap-batch/spec.md`

- [x] [status:closed:pr:327] REQ #7 — Positional gate-baseline drift after `queueService.ts` split (5 entries across 2 baseline files). Rebased in commit `fe6357ca` per spec-conformance R2; counts preserved 4→4 and 1→1 across `canonical-retry.txt` and `no-silent-failures.txt`. spec-conformance moved to CONFORMANT after rebase.

## Wave 2 audit sweep — 2026-05-15

**Captured:** 2026-05-15T07-19-34Z
**Branch:** `claude/wave-2-audit-sweep`
**Source logs:**
- `tasks/audit-logs/codebase-audit-log-wave-2-frontend-2026-05-15T07-19-34Z.md` (7 findings, 1 medium, 6 low) — Operator HomePage hits 4-KPI cap; suspect dashboard pages need Wave 3 deep-read.
- `tasks/audit-logs/codebase-audit-log-wave-2-skills-2026-05-15T07-19-34Z.md` (5 findings, 3 medium, 2 low) — preliminary grep found ~95 candidate unmatched skill `.md` files; comparator is unstable pending runtime `Object.keys(ACTION_REGISTRY)` enumeration; no enforced bidirectional check.
- `tasks/audit-logs/codebase-audit-log-wave-2-circular-deps-2026-05-15T07-19-34Z.md` (10 findings, 1 high, 5 medium, 4 low) — 73 server cycles + 4 client cycles; skillExecutor ↔ workflowEngine super-cycle dominates.
- `tasks/audit-logs/codebase-audit-log-wave-2-duplication-2026-05-15T07-19-34Z.md` (10 findings, 1 high, 8 medium, 1 low) — Top server clone 87L within `workflowEngine/queueLifecycle/agentStep.ts`; top client clone 213L between Skills pages and ClientPulse `HistoryTab.tsx`.
- `tasks/audit-logs/codebase-audit-log-wave-2-agent-execution-2026-05-15T07-19-34Z.md` (5 findings, 2 high, 2 medium, 1 low) — Handoff event writes are fire-and-forget; spawn-sub-agents is not queue-backed (durability gap).
- `tasks/audit-logs/critical-path-coverage-matrix-2026-05-15T07-19-34Z.md` (12 paths, 6 gates-only) — 6 critical paths have no named test (pg-boss handler idempotency, handoff durability, service-principal leak, cost-ledger retry, payload retention tier, workflow-engine tick worker).

### Wave 2 — Symptom-fix items

- [x] [origin:audit:wave-2-frontend:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **FE1 — `operate/HomePage.tsx` 4× MetricCard tiles + RunActivityChart hero.** medium/high. Hits the §*Complexity budget per screen* cap (`KPI tiles: 0 by default`). Re-evaluate which tiles are load-bearing for the primary task; the operator's Home was already trimmed (see file header) but the four-tile row remains.
- [x] [origin:audit:wave-2-frontend:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **FE4 — `SystemIncidentsPage.tsx` 491 LOC.** low/medium. Above the long-page heuristic. System-admin so relaxed budget applies, but length suggests sub-component extraction.
- [x] [origin:audit:wave-2-frontend:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **FE5+FE6 — Wave 3 deep-read for `ClientPulseDashboardPage`, `ClientPulseDrilldownPage`, `JobQueueDashboardPage`, `SpendLedgerPage`.** low/low. Dashboard-named pages with no canonical Card/Stat literals detected — needs manual read to confirm whether dashboards are decoration or load-bearing.
- [ ] [origin:audit:wave-2-skills:2026-05-15T07-19-34Z] [status:open] **SK1 — Preliminary grep found ~95 skill `.md` candidates with no direct snake_case slug match in `actionRegistry`.** medium/medium. **Count is not grounded to a canonical comparator** — three grep methods give different baselines (raw object-literal keys = 103 incl. nested non-actions like `annotations`/`mcp`; explicit `slug:` field captures = 62). True unmatched count is somewhere between ~50 and ~95. **Recommended first step: a runtime enumeration of `Object.keys(ACTION_REGISTRY)` (single 5-line script) to produce the authoritative comparator before further work.** Examples of likely-orphaned slugs (still valid as examples): `analyse_42macro_transcript`, `audit_geo`, `book_meeting`, `classify_email`, `derive_test_cases`, `discover_prospects`, `draft_*`, `generate_competitor_brief`. Possible legitimate methodology-only skills; possible drift. Needs operator architectural call: where are methodology-only skills declared if not in `ACTION_REGISTRY`?
- [ ] [origin:audit:wave-2-skills:2026-05-15T07-19-34Z] [status:open] **SK2 — Naming convention drift between `.md` slug and registry slug.** medium/medium. `calendar-create-event.md` (kebab) vs `create_task` (snake) — no canonical alias map source file located (only a `__tests__/actionSlugAliasesPure.test.ts` references the concept).
- [ ] [origin:audit:wave-2-skills:2026-05-15T07-19-34Z] [status:open] **SK3 — `UNIVERSAL_SKILL_NAMES` is hand-maintained.** low/medium. Header says "must stay in sync" with `ACTION_REGISTRY.isUniversal` — no enforced bidirectional check.
- [x] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **CD1 — skillExecutor ↔ workflowEngine super-cycle (cycles 19–61, ≈43 of 73 server cycles, ≈59% on its own; CD1+CD2+CD3 combined ≈85%).** high/high. Long chains routing through `workflowEngine/queueLifecycle/dispatch.ts > workflowActionCallExecutor.ts > skillExecutor.ts > skillExecutor/registry.ts > skillExecutor/handlers/*.ts > tools/*.ts > services/*.ts > workflowEngineService.ts > ...`. Architectural — invert handler imports via a `HandlerContext` injection pattern.
- [ ] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:open] **CD2 — `agentExecutionService` <-> `agentExecutionLoop` <-> `executionBackends` triangle (cycles 64–71).** medium/high. `executionBackends/options.ts` types pull back into orchestration layer; move offending types to pure-types-only module.
- [ ] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:open] **CD3 — `workflowEngineService` post-split residual cycles.** medium/high. Despite PR #319 dropping main file 4,073 → 64 LOC, queueLifecycle dispatch chain still routes through.
- [ ] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:open] **CD4 — `notifyOperatorFanoutService` <-> channels.** low/medium. Three-line fix.
- [ ] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:open] **CD5–CD10 — Misc small cycles** (`agentExecutionServicePure` inverted import; `MacroReport.tsx` server template cycle; `mcpServer.ts` self-cycle; `sandboxProviderResolver` provider-imports-impl; `govern/components/*Tab.tsx <-> Modal.tsx` x 4). low/high. Each is a 5-minute fix once a baseline gate exists.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **DUP1 — 213L + 209L Skills pages <-> pulse/HistoryTab.tsx.** high/high. Extract shared rendering logic.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **DUP2 — `AdminPermissionSetsPage` <-> `org-settings/PermissionsTab` triple-clone (176L total).** medium/high. Lift `<PermissionsEditor>` component.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **DUP3 — `OrgApprovalChannelsPage` <-> `SubaccountApprovalChannelsPage` triple-clone (178L total).** medium/high. Lift `<ApprovalChannelsEditor>` component.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **DUP4 — `AgentChatPage` <-> `ConfigAssistantPage` clones (125L + 68L `messageRender.tsx` 100% duplicated extraction).** medium/high. Combine the two extracted `messageRender.tsx` copies into `components/chat/messageRender.tsx`.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **DUP5 — 143L `SubaccountBlueprintsPage` <-> `SystemOrganisationTemplatesPage`.** medium/high. Template-rendering UI cloned.
- [ ] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:open] **DUP6 — 87L same-file clone in `workflowEngine/queueLifecycle/agentStep.ts:397-483` <-> `:225-307`.** medium/high. Extract helper.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **DUP7 — `hierarchyTemplateService` <-> `systemTemplateService` clones (44L + 33L).** medium/high. Single source of truth.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **DUP8 — Prune-job family clones (4 jobs, 28–33L blocks each).** medium/medium. Extract `definePruneJob({table, retentionConfig})` factory.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] **DUP9 — `calendarActionService` <-> `slackActionService` 32L clone.** medium/high. Shared dispatch helper.
- [x] [origin:audit:wave-2-agent-execution:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1669] [candidate:v1-blocker] **AE1 — Fire-and-forget `void insertExecutionEventSafe` writes can lose audit-trail rows on worker restart.** high/high. `handoff.ts` lines 107, 128, 140, 227, 249, 340, 449. Convert critical-event subset (errors, outcomes) to `await`, OR add a graceful-shutdown drain hook. *Closed via PR #332 — see canonical closure at line 1669.*
- [ ] [origin:audit:wave-2-agent-execution:2026-05-15T07-19-34Z] [status:open] [candidate:v1-blocker] **AE2 — `executeSpawnSubAgents` uses sync `Promise.all(executeRun)` without queue backing.** high/high. Worker restart mid-spawn loses children silently. Contrast with `executeReassignTask` which is queue-backed. Either route through `enqueueHandoff` or document the intentional best-effort posture in architecture.
- [x] [origin:audit:wave-2-frontend:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1627] **FE1 — `operate/HomePage.tsx` 4× MetricCard tiles + RunActivityChart hero.** medium/high. Hits the §*Complexity budget per screen* cap (`KPI tiles: 0 by default`). Re-evaluate which tiles are load-bearing for the primary task; the operator's Home was already trimmed (see file header) but the four-tile row remains. *Verified in main 2026-05-16: MetricCard count is now 0 in `operate/HomePage.tsx`. Canonical closure at line 1627.*
- [x] [origin:audit:wave-2-frontend:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1628] **FE4 — `SystemIncidentsPage.tsx` 491 LOC.** low/medium. Above the long-page heuristic. System-admin so relaxed budget applies, but length suggests sub-component extraction. *Verified in main 2026-05-16: `SystemIncidentsPage.tsx` now 239 LOC. Canonical closure at line 1628.*
- [x] [origin:audit:wave-2-frontend:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1629] **FE5+FE6 — Wave 3 deep-read for `ClientPulseDashboardPage`, `ClientPulseDrilldownPage`, `JobQueueDashboardPage`, `SpendLedgerPage`.** low/low. Dashboard-named pages with no canonical Card/Stat literals detected — needs manual read to confirm whether dashboards are decoration or load-bearing. *Verified in main 2026-05-16: all four pages carry the documented-acceptance header. Canonical closure at line 1629.*
- [ ] [origin:audit:wave-2-skills:2026-05-15T07-19-34Z] [status:closed:pr:332] **SK1 — Preliminary grep found ~95 skill `.md` candidates with no direct snake_case slug match in `actionRegistry`.** medium/medium. **Count is not grounded to a canonical comparator** — three grep methods give different baselines (raw object-literal keys = 103 incl. nested non-actions like `annotations`/`mcp`; explicit `slug:` field captures = 62). True unmatched count is somewhere between ~50 and ~95. **Recommended first step: a runtime enumeration of `Object.keys(ACTION_REGISTRY)` (single 5-line script) to produce the authoritative comparator before further work.** Examples of likely-orphaned slugs (still valid as examples): `analyse_42macro_transcript`, `audit_geo`, `book_meeting`, `classify_email`, `derive_test_cases`, `discover_prospects`, `draft_*`, `generate_competitor_brief`. Possible legitimate methodology-only skills; possible drift. Needs operator architectural call: where are methodology-only skills declared if not in `ACTION_REGISTRY`?
- [ ] [origin:audit:wave-2-skills:2026-05-15T07-19-34Z] [status:closed:pr:332] **SK2 — Naming convention drift between `.md` slug and registry slug.** medium/medium. `calendar-create-event.md` (kebab) vs `create_task` (snake) — no canonical alias map source file located (only a `__tests__/actionSlugAliasesPure.test.ts` references the concept).
- [ ] [origin:audit:wave-2-skills:2026-05-15T07-19-34Z] [status:closed:pr:332] **SK3 — `UNIVERSAL_SKILL_NAMES` is hand-maintained.** low/medium. Header says "must stay in sync" with `ACTION_REGISTRY.isUniversal` — no enforced bidirectional check.
- [x] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1633] **CD1 — skillExecutor ↔ workflowEngine super-cycle (cycles 19–61, ≈43 of 73 server cycles, ≈59% on its own; CD1+CD2+CD3 combined ≈85%).** high/high. Long chains routing through `workflowEngine/queueLifecycle/dispatch.ts > workflowActionCallExecutor.ts > skillExecutor.ts > skillExecutor/registry.ts > skillExecutor/handlers/*.ts > tools/*.ts > services/*.ts > workflowEngineService.ts > ...`. Architectural — invert handler imports via a `HandlerContext` injection pattern. *Verified in main 2026-05-16: tightened C1.9 grep (F-1) returns 0 hits — `buildHandlerContext.ts` is the only file value-importing both `skillExecutor` and `workflowEngineService`. Canonical closure at line 1633.*
- [ ] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:closed:pr:332:verified-in-main] **CD2 — `agentExecutionService` <-> `agentExecutionLoop` <-> `executionBackends` triangle (cycles 64–71).** medium/high. `executionBackends/options.ts` types pull back into orchestration layer; move offending types to pure-types-only module.
- [ ] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:closed:pr:332:verified-in-main] **CD3 — `workflowEngineService` post-split residual cycles.** medium/high. Despite PR #319 dropping main file 4,073 → 64 LOC, queueLifecycle dispatch chain still routes through.
- [ ] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:closed:pr:332:verified-in-main] **CD4 — `notifyOperatorFanoutService` <-> channels.** low/medium. Three-line fix.
- [ ] [origin:audit:wave-2-circular-deps:2026-05-15T07-19-34Z] [status:closed:pr:332:verified-in-main] **CD5–CD10 — Misc small cycles** (`agentExecutionServicePure` inverted import; `MacroReport.tsx` server template cycle; `mcpServer.ts` self-cycle; `sandboxProviderResolver` provider-imports-impl; `govern/components/*Tab.tsx <-> Modal.tsx` x 4). low/high. Each is a 5-minute fix once a baseline gate exists.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1638] **DUP1 — 213L + 209L Skills pages <-> pulse/HistoryTab.tsx.** high/high. Extract shared rendering logic. *Verified in main 2026-05-16: `client/src/components/skills/HistoryRender.tsx` present. Canonical closure at line 1638.*
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1639] **DUP2 — `AdminPermissionSetsPage` <-> `org-settings/PermissionsTab` triple-clone (176L total).** medium/high. Lift `<PermissionsEditor>` component. *Verified in main 2026-05-16: `client/src/components/permissions/PermissionsEditor.tsx` present. Canonical closure at line 1639.*
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1640] **DUP3 — `OrgApprovalChannelsPage` <-> `SubaccountApprovalChannelsPage` triple-clone (178L total).** medium/high. Lift `<ApprovalChannelsEditor>` component. *Verified in main 2026-05-16: `client/src/components/approval/ApprovalChannelsEditor.tsx` present. Canonical closure at line 1640.*
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1641] **DUP4 — `AgentChatPage` <-> `ConfigAssistantPage` clones (125L + 68L `messageRender.tsx` 100% duplicated extraction).** medium/high. Combine the two extracted `messageRender.tsx` copies into `components/chat/messageRender.tsx`. *Verified in main 2026-05-16: `client/src/components/chat/messageRender.tsx` present (named exports `renderAssistantContent`, `renderInlineMarkdown`, `renderBold`). Canonical closure at line 1641.*
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1642] **DUP5 — 143L `SubaccountBlueprintsPage` <-> `SystemOrganisationTemplatesPage`.** medium/high. Template-rendering UI cloned. *Verified in main 2026-05-16: `client/src/components/templates/TemplateGrid.tsx` present. Canonical closure at line 1642.*
- [ ] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:pr:332] **DUP6 — 87L same-file clone in `workflowEngine/queueLifecycle/agentStep.ts:397-483` <-> `:225-307`.** medium/high. Extract helper.
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1644] **DUP7 — `hierarchyTemplateService` <-> `systemTemplateService` clones (44L + 33L).** medium/high. Single source of truth. *Verified in main 2026-05-16: `server/services/templates/templateHelpers.ts` present. Canonical closure at line 1644.*
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1645] **DUP8 — Prune-job family clones (4 jobs, 28–33L blocks each).** medium/medium. Extract `definePruneJob({table, retentionConfig})` factory. *Verified in main 2026-05-16: `server/jobs/lib/definePruneJob.ts` is in use by all 6 prune jobs (incl. `webhookReplayNoncePruneJob` migrated in this PR via F-3 closure). Canonical closure at line 1645.*
- [x] [origin:audit:wave-2-duplication:2026-05-15T07-19-34Z] [status:closed:wave-5-session-k:duplicate-of-line-1646] **DUP9 — `calendarActionService` <-> `slackActionService` 32L clone.** medium/high. Shared dispatch helper. *Verified in main 2026-05-16: `server/services/actions/dispatchHelper.ts` present. Canonical closure at line 1646.*
- [ ] [origin:audit:wave-2-agent-execution:2026-05-15T07-19-34Z] [status:closed:pr:332] [candidate:v1-blocker] **AE1 — Fire-and-forget `void insertExecutionEventSafe` writes can lose audit-trail rows on worker restart.** high/high. `handoff.ts` lines 107, 128, 140, 227, 249, 340, 449. Convert critical-event subset (errors, outcomes) to `await`, OR add a graceful-shutdown drain hook.
- [ ] [origin:audit:wave-2-agent-execution:2026-05-15T07-19-34Z] [status:closed:pr:332] [candidate:v1-blocker] **AE2 — `executeSpawnSubAgents` uses sync `Promise.all(executeRun)` without queue backing.** high/high. Worker restart mid-spawn loses children silently. Contrast with `executeReassignTask` which is queue-backed. Either route through `enqueueHandoff` or document the intentional best-effort posture in architecture.
- [ ] [origin:audit:wave-2-agent-execution:2026-05-15T07-19-34Z] [status:open] **AE4 — Worker-restart recovery for in-flight handoffs not documented.** medium/medium. Wave 3 deeper read of `agentExecutionLoop.ts` (1,415 LOC) needed.
- [ ] [origin:audit:wave-2-agent-execution:2026-05-15T07-19-34Z] [status:closed:pr:332] **AE5 — Critical-severity error-path emissions also use `void insertExecutionEventSafe`.** low/high. Hierarchy errors, cross-subtree spawn, delegation-out-of-scope — at minimum `await` these before returning.
- [ ] [origin:audit:wave-2-critical-path-coverage:2026-05-15T07-19-34Z] [status:closed:pr:332] **MC2 — Idempotency-key dedup logic has no named canonical test.** medium/high. Add `server/lib/__tests__/idempotencyKey.dedup.test.ts` exercising concurrent insert against the unique constraint.
- [ ] [origin:audit:wave-2-critical-path-coverage:2026-05-15T07-19-34Z] [status:closed:pr:332] **MC3 — `agentRunVisibility.ts` impure read path has no integration test.** medium/high. Add `agentRunVisibility.integration.test.ts`.
- [ ] [origin:audit:wave-2-critical-path-coverage:2026-05-15T07-19-34Z] [status:closed:pr:332] **MC4 — No gate proves every LLM call site goes through `llmRouter`.** medium/medium. Add gate `verify-llm-call-site-routes-through-router.sh`.
- [ ] [origin:audit:wave-2-critical-path-coverage:2026-05-15T07-19-34Z] [status:closed:pr:332] [candidate:v1-blocker] **MC7 — No meta-test that every pg-boss handler is idempotent under retry.** medium/high.
- [ ] [origin:audit:wave-2-critical-path-coverage:2026-05-15T07-19-34Z] [status:closed:pr:332] [candidate:v1-blocker] **MC8 — No test for handoff durability under simulated worker restart.** medium/high. Pairs with AE1, AE2.
- [ ] [origin:audit:wave-2-critical-path-coverage:2026-05-15T07-19-34Z] [status:closed:pr:332] [candidate:v1-blocker] **MC10 — No test for three-tier service-principal trace boundary.** medium/high.
- [ ] [origin:audit:wave-2-critical-path-coverage:2026-05-15T07-19-34Z] [status:closed:pr:332] **MC11 — No test for cost-ledger increments-once under retry.** medium/medium. v2 backlog.
- [ ] [origin:audit:wave-2-critical-path-coverage:2026-05-15T07-19-34Z] [status:closed:pr:332] **MC12 — No test for LLM payload retention tier boundary transition.** low/medium. v2 backlog.

### Wave 2 — Prevention proposals

- [x] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:tbd-wave-5] [target:gate] **PP-CD1 — `npm run check:circular` as warn-gate.** Baseline 73 server + 4 client cycles. Any net-new cycle fails the PR. Closes CD1–CD10. Leverage tier 1.
- [x] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:wave-4-architectural-and-duplication] [target:architecture.md] **PP-CD2 — Document the "handler-imports-via-interface, never via service" rule.** Closes CD1, CD2. Leverage tier 2.
- [x] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:tbd-wave-5] [target:gate] **PP-DUP1 — `npm run check:duplication` (jscpd) baseline gate.** Baseline 4,298 server + 3,495 client duplicated lines. Closes DUP1–DUP10. Leverage tier 1.
- [ ] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:open] [target:gate] **PP-SK1 — `verify-skill-registry-alignment.sh`.** Closes SK1, SK2, SK5. Leverage tier 1.
- [x] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:tbd-wave-5] [target:gate] **PP-SK2 — Bidirectional `UNIVERSAL_SKILL_NAMES` <-> `ACTION_REGISTRY.isUniversal` lint.** Closes SK3. Leverage tier 1.
- [ ] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:332] [target:gate] **PP-AE2 — `verify-critical-event-emission-awaited.sh`.** Closes AE1, AE5. Leverage tier 1.
- [ ] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:332] [target:architecture.md] **PP-AE1 — Document audit-trail durability invariants.** Closes AE1, AE5. Leverage tier 2.
- [ ] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:332] [target:DEVELOPMENT_GUIDELINES.md] **PP-AE3 — "Handoff dispatch paths must agree on durability posture."** Closes AE2. Leverage tier 2.
- [x] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:tbd-wave-5] [target:gate] **PP-FE2 — `verify-page-complexity-budget.sh`.** Closes FE1, FE2. Leverage tier 1.
- [ ] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:332] [target:docs/codebase-audit-framework.md] **PP-MC1 — Module C must require each critical path name a test, gate, or documented `wont-test`.** Leverage tier 2.
- [ ] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:332] [target:gate] **PP-MC2 — `verify-critical-path-coverage.sh` consuming `tasks/critical-paths-manifest.yml`.** Pairs with PP-MC1. Leverage tier 1.
- [ ] [origin:audit:prevention:wave-2:2026-05-15T07-19-34Z] [status:closed:pr:332] [target:KNOWLEDGE.md] **PP-CD3 — Pattern entry: post-split file size can drop without resolving the underlying cycle / durability semantics.** Closes CD3, AE1. Leverage tier 3.

## PR Review deferred items

### PR #336 — claude-wave-5-cleanup-and-ci-consolidation (2026-05-16)

- [ ] **F1 — Restore dedicated `verify-workspace-actor-coverage` enforcement on `push: [main]` + every PR** — `user`. Wave 5 Session K consolidated CI by deleting `.github/workflows/workspace-actor-coverage.yml` and folding `npx tsx scripts/verify-workspace-actor-coverage.ts` into the `unit_tests` job in `.github/workflows/ci.yml`. The `unit_tests` job is gated on `pull_request` AND `contains(github.event.pull_request.labels.*.name, 'ready-to-merge')`. The retired standalone workflow ran on `pull_request` (every PR, unlabelled) AND `push: [main]`. Net regression: (a) `main`-branch enforcement gone — direct pushes / merges to `main` no longer trip the gate; (b) PR enforcement weaker — early PR iterations no longer surface workspace-actor coverage regressions until the operator labels `ready-to-merge`. Workspace-actor coverage is a tenant-isolation gate; per KNOWLEDGE.md `[2026-05-16] Pattern — CI job consolidation can silently shrink the enforcement surface of a gate`, tenant-isolation gates MUST run unconditionally on every PR and on `push: [main]`. Recommended fix: restore a dedicated lightweight workflow (or add a separate unconditional `workspace_actor_coverage:` job in `ci.yml` with no `if:` clause and `on: [pull_request, push: { branches: [main] }]` at the workflow level). Keep the body identical (Postgres service container + `npm run migrate` + `npx tsx scripts/verify-workspace-actor-coverage.ts`). Source: ChatGPT PR review F1, 2026-05-16. Session log: `tasks/review-logs/chatgpt-pr-review-wave-5-cleanup-and-ci-consolidation-2026-05-16T12-24-09Z.md`.

### PR #327 — claude-split-services-soft-cap-batch (2026-05-15)

- [x] [status:closed:wave-5-session-k:pr-336] **F1 — stage5cSourceFork.ts loses sibling references when candidate names collide** — Fixed in Wave 5 Session K (PR #336): filter changed to index-based in `server/jobs/skillAnalyzerJob/stage5cSourceFork.ts:33-44`; pinned by new test `server/jobs/skillAnalyzerJob/__tests__/stage5cSourceFork.filterByIndex.test.ts`.
- [ ] **T1 — Budget-block "ghost" path only logs locally, no metric/alert** — `auto`. Pre-existing log line carried forward verbatim from `server/services/llmRouter.ts:694` on `main`. The `llm_router.budget_block_upsert_ghost` warn condition likely indicates a state-machine race or unexpected terminalisation ordering — a metric/counter (or alert routing) would prevent these audit drops from disappearing into logs under load. Not introduced by this PR. Target file: `server/services/llmRouter/routeCall.ts:449`.
- [x] [status:closed:wave-5-session-k:pr-336] **T2 — `WORKSPACE_MIGRATION_CONCURRENCY` is unbounded** — Fixed in Wave 5 Session K (PR #336): `clampMigrationConcurrency` pure helper extracted to `server/services/queueService/maintenanceJobs/clampMigrationConcurrency.ts`; pinned by `clampMigrationConcurrency.test.ts`.

## From builder — 2026-05-16

From chunk 0 of `wave-4-audit-absorber`. Surfaced during evidence gathering; not fixed per surgical-changes rule.

- [x] [status:closed:wave-5-session-k:pr-336] **W4AA-DEBT-1 — 17 action-registry entries have no skill definition file on disk.** Fixed in Wave 5 Session K (PR #336): all 17 stub `.md` files created under `server/skills/` (assign_task, cached_context_budget_breach, canonical_dictionary, compute_staff_activity_pulse, config_deliver_workflow_output, config_weekly_digest_gather, crm/*, cross_owner/ask_initiator_decision, notify_operator, scan_integration_fingerprints, update_record, update_thread_context, workflow/run/start). All marked `[INTERNAL: no LLM description needed]` where appropriate.

- **W4AA-DEBT-2 — Naming convention mismatch between action-registry snapshot and skill filenames for calendar/slack/ea skills.** The snapshot uses dot-qualified keys (`calendar.create_event`, `slack.post_dm`, `ea.*` not present) while on-disk files normalize to flat underscore keys (`calendar_create_event`, `slack_post_dm`). After the SK2 rename in chunk 9, the mismatch persists. The snapshot comparator gate (if any) must apply the rule `X.Y` snapshot key ↔ `X_Y` disk key for single-level namespaces. Source: `skill-unmatched-preview.md`.

- **W4AA-DEBT-3 — `workflow-bulk-parent-check` registered in JOB_CONFIG but has no `boss.work` / `createWorker` handler anywhere in the codebase.** Found during handler-registry-inventory sweep (chunk 0). Tagged as `MISSING_HANDLER` in `handler-registry-fixture-seed.md`. Source: Sprint 4 P3.1 placeholder. Action: implement the handler or remove from JOB_CONFIG.

- **W4AA-DEBT-4 — madge peer deps not installed locally (`dependency-tree`, `commander` missing from `node_modules`).** `madge` v8.0.0 is in `package.json` but transitive deps are absent. The `verify-no-new-cycles.sh` gate works in CI (where `npm ci` uses the full lock-file resolution) but cannot be run locally. Action: investigate `npm ci` vs `npm install` inconsistency; ensure lock-file pins madge's deps so `npm install` resolves them locally. Source: `cycle-verification-log.md`.

- **W4AA-DEBT-5 (chunk 2a) — `agentScheduleService.ts` required a 1-line update not listed in the plan's canonical 2-file scope.** The plan's Pattern A path lists only `pipeline.ts` + `tasks.ts`, but `setHandoffJobSender`'s callback signature in `agentScheduleService.ts` needed to accept an optional `options?: PgBoss.SendOptions` parameter so the adapter's `{ db }` can be threaded through to `boss.send`. This is an implied dependency of Pattern A that the plan did not enumerate. Future plan reviews should list all callers of `setHandoffJobSender` when the sender signature changes.

- **W4AA-DEBT-6 (chunk 2b) — Plan §chunk-2b lists file `server/jobs/agentHandoffRunJob.ts` as the target, but that file does not exist.** The chunk 0 inventory (`handler-registry-inventory.md`) correctly records the handler at `server/services/agentScheduleService.ts:124`. The plan's "Files to modify" section was not updated after chunk 0 corrected the path. The change was applied to the correct file (`agentScheduleService.ts`). Future chunk authors should treat the inventory md as ground truth over the plan's file path when they differ. Also noted: the plan says "logs `critical`" but the project logger (`server/lib/logger.ts`) has no `critical` level — highest available is `error`. The fail-loud logs use `logger.error` with a `severity: 'critical'` data field to preserve operator-visibility intent.

- **W4AA-DEBT-7 (chunk 2d) — Plan §chunk-2d lists `server/services/agentRunService.ts` as the cancel-API file, but that file does not exist.** The actual cancel service is `server/services/agentRunCancelService.ts`. Same pattern as W4AA-DEBT-6. Change applied to correct file.

- **W4AA-DEBT-8 (chunk 2d) — Plan §chunk-2d lists `server/config/actionRegistry/core.ts` as the file to update for `spawn_sub_agents`, but there is no `spawn_sub_agents` entry in that file.** The skill's LLM-visible description lives in `server/skills/spawn_sub_agents.md`. The plan likely used a theoretical file name. The `pending` field documentation was added to the correct markdown file.

- **W4AA-DEBT-9 (chunk 2d) — Pre-existing unused `sql` import in `server/services/agentRunCancelService.ts`.** The `sql` identifier is imported from `drizzle-orm` but is never used. Not fixed per surgical-changes rule. Future cleanup can remove it.

- **W4AA-DEBT-10 (chunk 2d) — `agentExecutionService.ts` noted as the cooperative-cancel file in the plan, but the actual agentic loop lives in `agentExecutionLoop.ts`.** The plan meant the loop file; `agentExecutionService.ts` is now a thin orchestrator that delegates through the lifecycle phase functions. The parent-status observer was added to `agentExecutionLoop.ts` at the existing cancel observation boundary.

## From builder — 2026-05-16

- **W4AA-DEBT-11 (chunk 3a)** [status:deferred:v2-backlog:wave-5-session-k] — `comparesTables` values in `idempotencyContract` are best-effort guesses based on job names and handler file names. For accurate verification, a reviewer should cross-check each `handler_tested` entry's `comparesTables` against the actual SQL writes in the handler implementation. Per spec §6.1 C1, completeness of the declared set is a review responsibility in v1, not a gate check. Deferred to the v2 backlog per launch prompt: not a blocking gate, requires per-handler audit beyond the Wave 5 scope.

- **W4AA-DEBT-12 (chunk 3a) — `workflow-drafts-cleanup` was registered via `boss.work` in `pgBossRegistrations.ts:201` but was absent from the chunk-0 `handler-registry-inventory.md` drift-candidates list.** Added to `JOB_CONFIG` in this chunk regardless. Future inventory passes should include a grep for this queue name.

- **W4AA-DEBT-13 (chunk 3a) — `iee-cost-rollup-daily` and `iee-browser:daily-cost-rollup` are two distinct queue names for logically related daily cost rollup jobs.** `iee-cost-rollup-daily` is consumed by the external IEE worker; `iee-browser:daily-cost-rollup` is the main-app handler in `ieeBrowserDailyRollupJob.ts`. Both are now in `JOB_CONFIG` with appropriate verdicts. A future cleanup should determine if these queues should be unified.

- **W4AA-DEBT-14 (chunk 3a) — `refresh_optimiser_peer_medians` and `refresh_memory_utility_30d` use underscore naming inconsistent with the project's kebab-case convention for queue names.** These names are driven by the constants `PEER_MEDIANS_QUEUE` and `MEMORY_UTILITY_QUEUE` in `agentScheduleService.ts`. A future cleanup could rename both the queues and their constants to kebab-case (with a pg-boss schedule migration). Out of scope for this chunk.

- [x] [status:closed:wave-4-session-g:pr-332:verified-in-main-2026-05-16] **W4AA-DEBT-15 (chunk 11) — PP-AE2 gate flags 3 violations in `server/services/skillExecutor/handlers/tasks.ts`.** Fixed in Wave 4 Session G (PR #332): lines 575→581, 693→699, 711→717 now use `await` per §5.1 critical-event invariant. Remaining `void` at line 786 is intentional (per `// Write accepted outcome rows (fire-and-forget per INV-3)` comment). Verified in main 2026-05-16 Wave 5 Session K.


## Deferred from spec-conformance review — wave-4-audit-absorber (2026-05-16)

**Captured:** 2026-05-16T06:59:14Z
**Source log:** `tasks/review-logs/spec-conformance-log-wave-4-audit-absorber-2026-05-16T06-59-14Z.md`
**Spec:** `tasks/builds/wave-4-audit-absorber/spec.md`

- [x] [status:closed:wave-5-session-k:pr-336] REQ #36 — MC7 double-fire equivalence assertion. Added in Wave 5 Session K (PR #336): `server/lib/__tests__/handlerIdempotency.meta.test.ts` now includes `describe('MC7 — step 6: double-fire equivalence')` with the equivalence contract. Runs in integration mode (NODE_ENV=integration) per the v1 testing posture.

- [x] [status:closed:wave-5-session-k:pr-336:accepted-posture] REQ #37 — Integration tests skip behavioral assertions outside NODE_ENV=integration. Accepted as v1 documented stance per approach in REQ #36 implementation: integration-mode guard is the canonical pattern. Tests run when `NODE_ENV=integration` in CI's integration_tests job. No further change needed.


## Deferred from pr-reviewer round 3 / reality-checker — wave-4-audit-absorber (2026-05-16)

**Captured:** 2026-05-16T09:50:00Z
**Source logs:**
- `tasks/review-logs/pr-review-log-wave-4-audit-absorber-2026-05-16T09-50-00Z.md`
- `tasks/review-logs/reality-check-log-wave-4-audit-absorber-2026-05-16T09-30-00Z.md`

- [x] [status:closed:wave-5-session-k:pr-336] W4AA-DEBT-16 — Missing Vitest unit test for `persistAndAnnounce` UPDATE-claim branch. Added in Wave 5 Session K (PR #336): `server/services/__tests__/persistAndAnnounce.updateClaim.test.ts`.

- [x] [status:closed:wave-5-session-k:pr-336] W4AA-DEBT-17 — Re-seed `scripts/.gate-baselines/duplicate-blocks.txt` post-DUP6 extract. Done in Wave 5 Session K (PR #336): `scripts/.gate-baselines/duplicate-blocks.txt` updated to reflect post-DUP6 baseline.
## Deferred spec decisions — wave-4-architectural-and-duplication

- [ ] **AUTO-DECIDED (accept)** — spec-reviewer iteration 1 (2026-05-16). Split `HandlerContext` into a pure type module (`server/services/handlerContextTypes.ts`) and a boot-time wiring factory (`server/lib/buildHandlerContext.ts`). Rationale: without the split the cycle returns through the type module and the CD1 break does not actually land — separation is what enables the dependency-direction inversion the spec exists to achieve. Operator may collapse to one file if architect's chunk 0 confirms no cycle reintroduction, but default is split.

## Deferred from spec-conformance review — wave-4-architectural-and-duplication (2026-05-16)

**Captured:** 2026-05-16T05:19:16Z
**Source log:** `tasks/review-logs/spec-conformance-log-wave-4-architectural-and-duplication-2026-05-16T05-19-16Z.md`
**Spec:** `tasks/builds/wave-4-architectural-and-duplication/spec.md`

- [ ] **F-1 (REQ C1.9) — Spec §8 acceptance #1 literal grep test is over-broad and returns 7 hits.** Semantic CD1 cycle break is achieved (only `buildHandlerContext.ts` value-imports both `skillExecutor` and `workflowEngineService`), but the literal grep captures unrelated value-imports (`setHandoffJobSender`, `SKILL_HANDLERS` in 4 files, an `export type` re-export in `tools/meta/types.ts`, a test fixture).
  - Spec section: §8 acceptance #1
  - Gap: spec test is too strict; semantic intent satisfied; literal acceptance not.
  - Suggested approach: tighten the spec grep (add `export type`, `__tests__/`, `setHandoffJobSender`, `SKILL_HANDLERS` exclusions) or rewrite as a `madge`-based assertion. Do not change the code — the cycle is genuinely broken.

- [ ] **F-2 (REQ D4.2) — DUP4 spec §6.4 references a `MessageRender` named export that doesn't exist.** Actual extracted exports are `renderAssistantContent`, `renderInlineMarkdown`, `renderBold` — matching the source copies. Same kind of drift as DUP1/DUP5 where the spec was annotated with a "Note: spec originally specified ..." line; DUP4 was missed.
  - Spec section: §6.4
  - Gap: spec text references a non-existent export. Functional intent (delete dupes, both pages import unified module) IS satisfied.
  - Suggested approach: append an analogous "Note: spec originally specified ..." annotation to §6.4 documenting the actual exports `renderAssistantContent`, `renderInlineMarkdown`, `renderBold`.

- [x] [status:closed:wave-5-session-k:pr-336] **F-3 (REQ D8.2) — DUP8 missing `webhookReplayNoncePruneJob` conversion.** Done in Wave 5 Session K (PR #336): `server/jobs/webhookReplayNoncePruneJob.ts` migrated to `definePruneJob` factory. Composite-key fix applied (`RETURNING 1` instead of `RETURNING id` — see dual-reviewer P1 fix). See `tasks/review-logs/dual-review-log-wave-5-cleanup-and-ci-consolidation-2026-05-16T12-17-28Z.md`.

- [ ] **F-4 (REQ A.4) — `npm run build:server` fails on pre-existing main-branch issue (missing `docx` + `mammoth` modules).** Both files are unchanged on this branch; failure exists on `main` at the merge-base commit. Branch did not introduce the failure.
  - Spec section: §8.4
  - Gap: spec gate is unsatisfied due to upstream defect; not caused by this build.
  - Suggested approach: separate single-purpose PR — `npm install docx mammoth` (and `@types/mammoth` if needed). Not blocking for wave-4 merge per build-introduced-defects principle, but the §8.4 gate stays technically open until fixed.
## Deferred from wave-3 review pipeline (2026-05-16, PR #330)

Review pass: spec-conformance (n/a — no spec) → adversarial-reviewer (HOLES_FOUND, 1 confirmed + 3 likely) → pr-reviewer (APPROVED, 3 should-fix + 4 consider). C1 confirmed hole was fixed in-PR. L2 exported helper was scoped internal in-PR. Misleading comment fixes applied in-PR for prepare.ts + voiceProfileService.ts. Items below are the explicit deferrals.

### Targeted Vitest tests for new invariants (pr-reviewer should-fix 3)

- [x] [status:closed:wave-5-session-k:pr-336] **Test `clampMigrationConcurrency` (T2 fix)** — Done in Wave 5 Session K (PR #336): pure helper `server/services/queueService/maintenanceJobs/clampMigrationConcurrency.ts` extracted; pinned by `clampMigrationConcurrency.test.ts`.
- [x] [status:closed:wave-5-session-k:pr-336] **Test `assertInboxScope` SUPPORT-PATCH-SCOPE-ORDER invariant** — Done in Wave 5 Session K (PR #336): `server/services/__tests__/assertInboxScope.test.ts` added.
- [x] [status:closed:wave-5-session-k:pr-336] **Test `stage5cSourceFork` filter-by-index (F1 fix)** — Done in Wave 5 Session K (PR #336): `server/jobs/skillAnalyzerJob/__tests__/stage5cSourceFork.filterByIndex.test.ts` added.

### F4 raw-db urgency (pr-reviewer should-fix 1+2)

- [ ] **F4 raw-db migration is more urgent than "residue" tier** — pr-reviewer surfaced that `voice_profiles` (FORCE RLS, migration 0328) and `agent_runs` (FORCE RLS, migration 0079) are both written via raw `db.*` today. Under FORCE RLS the writes are filtered to `rowCount=0`. Two effects: (a) `agentRuns.appliedMemoryBlockIds` / `injectedEntryIds` / `threadContextVersionAtStart` provenance fields are permanently NULL until F4 ships — currently marked "graceful degradation" but worth restoring; (b) `voiceProfileService.deriveProfile` atomic claim at `voiceProfileService.ts:29-39` returns zero rows under FORCE RLS, which would mean the function throws 409 `DERIVATION_IN_PROGRESS` on every call in production. **Operator action — confirm production behaviour**: check whether the prod `db` pool runs as a `BYPASSRLS` service role, or whether voiceProfileService is in fact broken end-to-end. If broken: hotfix priority. If BYPASSRLS pool: update the comments to acknowledge that path and rethink the layered-defence assumption. Target files: `server/services/agentExecutionService/runLifecycle/prepare.ts` (~6 LOC migration to getOrgScopedDb across the 3 .catch sites), `server/services/voiceProfile/voiceProfileService.ts` (~15 LOC migration across 4 updates + 2 selects).

### Other deferrals

- [ ] **Mechanical-batch task UNIVERSAL_SKILL_NAMES dual-source** — launch-prompt line 323 specified auto-generating from `ACTION_REGISTRY` into `shared/derived/universalSkillNames.ts` and deleting the hand-maintained source. Not implemented in this PR — `verify-universal-skill-sync.sh` catches drift but the dual-source maintenance burden remains. Pure-generator task; ~30 LOC.
- [ ] **KNOWLEDGE.md duplicates pointer** — KNOWLEDGE.md lines 1855 / 1910 are duplicate "When telling builder to move X to file Y" entries; lines 1867 / 1924 are duplicate "Static gate path-pattern regexes" entries. Line 1910 has a malformed body (`**Detection.** After a move-chunk, run:` with no code block; trailing line truncated mid-sentence). Append-only policy forbids deletion; the right fix is a short pointer entry that names the canonical row to save future grep time.
- [ ] **`scripts/verify-rls-protected-tables.sh:127-132` comment accuracy nit** — comment attributes the fix to Windows Git Bash; under `set -o pipefail` Linux would also fail the same way if the migrations directory ever loses its RENAME statements. One-line rewrite.
- [ ] **W1 (adversarial) — dual `assertInboxScope` call fragility** — route layer calls `assertInboxScope` at `supportAgentRoutes.ts:62`, then `updateAgentConfig` (`supportInboxService.ts:260`) calls it again internally. Idempotent so no current bug, but a future refactor that drops the route-level call and trusts only the service-level call would silently regress the SUPPORT-PATCH-SCOPE-ORDER invariant. Worth either documenting the duality in the helper docstring or consolidating to a single call site with a typed marker.
- [ ] **W2 (adversarial) — pre-existing `page.html` rendering surface** — `server/routes/public/pageServing.ts` renders `page.html ?? ''` directly into the HTML shell without sanitisation; CSP includes `script-src 'self' 'unsafe-inline'`. NOT introduced by wave-3 (this PR only changed type imports). Worth a separate audit of the page-CMS persistence path to confirm HTML is validated/sanitised before save.


## Deferred from adversarial-reviewer — wave-5-cleanup-and-ci-consolidation (2026-05-16)

**Captured:** 2026-05-16T11:36:44Z
**Source log:** `tasks/review-logs/adversarial-review-log-wave-5-cleanup-and-ci-consolidation-2026-05-16T11-36-44Z.md`
**Verdict:** NO_HOLES_FOUND — both items below are `worth-confirming`, Phase 1 advisory, non-blocking.

- [ ] **W5K-ADV-1 — `extraWhere` partial-prefix regex in `definePruneJob`** — `server/jobs/lib/definePruneJob.ts:50-61` validates only the prefix (`/^(AND|OR)\s/i`), then passes the entire string to `sql.raw()`. Every current caller supplies a hardcoded module-level constant, so there's no user-controlled path today. Risk is an internal developer accidentally writing a malicious literal in a future job. Recommend either a tighter validator (allowlist of column names + operators) or a CI gate that scans `definePruneJob` callers. ~10 LOC for the validator change.

- [ ] **W5K-ADV-2 — `persistAndAnnounce` UPDATE-claim WHERE clause has no `organisationId` predicate** — `server/services/agentExecutionService/runLifecycle/persistRun.ts:73-76` filters only on `id = preCreatedRunId AND status = 'pending'`. Pre-existing pattern; not introduced by this PR. `preCreatedRunId` is generated internally and flows through validated job payloads, so external injection is not realistic. Defence-in-depth fix: add `eq(agentRuns.organisationId, request.organisationId)` to the WHERE clause. ~3 LOC.

## Deferred from chatgpt-pr-review round 2 — wave-4-audit-absorber (2026-05-16)

**Captured:** 2026-05-16T10:50:00Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-wave-4-audit-absorber-2026-05-16T10-30-00Z.md`

- [x] [status:closed:wave-5-session-k:pr-336] **W4AA-DEBT-18 — Warning path in `verify-handler-registry-fixture.sh` does not propagate to shell.** Fixed in Wave 5 Session K (PR #336) via chatgpt-pr-review F2: `|| echo 0` pattern replaced with `|| true` + `${VAR:-0}` guard in `scripts/verify-handler-registry-fixture.sh`. Commit 5b7a2614.

- [x] [status:closed:wave-5-session-k:pr-336] **W4AA-DEBT-19 — `verify-handler-registry-fixture.sh` Node heredoc path expansion fails on Windows dev.** Fixed in Wave 5 Session K (PR #336): Node code moved to separate `scripts/lib/check-handler-registry-verdicts.mjs` file; heredoc eliminated; Windows path issue resolved.

- [x] [status:closed:wave-5-session-k:pr-336] **CI workflow consolidation — 6 jobs → 3** — Done in Wave 5 Session K (PR #336): `.github/workflows/workspace-actor-coverage.yml` deleted; grep invariants + portable framework tests folded into `lint_and_typecheck` job in `.github/workflows/ci.yml`. Post-merge operator action still required: update GitHub branch-protection required-checks to remove dropped check names.


## Deferred spec decisions — wave-5-prevention-gates-and-rls

**Captured:** 2026-05-16T10:25:31Z by spec-reviewer (iteration 1)
**Source log:** `tasks/review-logs/spec-review-log-wave-5-prevention-gates-and-rls-1-2026-05-16T10-25-31Z.md`

These were autonomously decided during the spec-review loop using the conservative-default heuristic. Each is informational — the spec already incorporates the decision. The operator may revisit any of these at leisure.

- [ ] **App-layer `where(eq(table.organisationId, orgId))` predicate retention (Codex #3)** — Decision: **accept** (keep the predicate as defence-in-depth). Rationale: this build's stated goal is closing a defence-in-depth gap; removing the app-layer predicate now would undercut the goal. The spec §6.1 explicitly keeps the predicate and marks predicate removal out of scope for this build, requiring a separate narrower spec with explicit per-path proof of org-context establishment. Reconsider if a future post-RLS audit confirms the predicate is genuinely redundant on every migrated path.

- [ ] **Gate verdict summary in PR body (Codex #15)** — Decision: **accept** (add a per-gate verdict table to the PR body alongside the existing per-service-tier summary). Rationale: minimal addition, symmetric with the existing summary, prevents "seeded and passing" handwave at merge time. No testing-posture / rollout-posture / new-primitive impact. Now codified in §9 acceptance criterion 10.

- [ ] **Per-callsite tier verdict granularity for mixed Tier 1+2 files (Codex iter2 #2)** — Decision: **accept** (canonical verdict is per raw-`db` callsite, not per file; file-level rollup is summary metadata only). Rationale: mixed-posture files are exactly where bugs hide — a per-file verdict can hide a forgotten Tier 1 callsite in a file otherwise stamped Tier 2. Codified in §8.

---

## Wave 5 knip candidate triage

These 134 files were previously listed in `knip.json` `ignore` to suppress knip dead-code warnings. Per CLAUDE.md §6 "Surface, don't smuggle", candidate dead code is routed here for triage rather than silently ignored. Each entry needs a human decision: delete the file, wire it into a route/entry point, or confirm it's a legitimate false positive and re-add to `knip.json`.

Added: 2026-05-17 (wave-5-prevention-gates-and-rls fix-loop).

### Client — 101 candidates

- [ ] `client/src/api/goals.ts`
- [ ] `client/src/components/BriefLabel.ts`
- [ ] `client/src/components/ClarificationInbox.tsx`
- [ ] `client/src/components/DropZone.tsx`
- [ ] `client/src/components/EmailChannelTile.tsx`
- [ ] `client/src/components/EmailConfigEditor.tsx`
- [ ] `client/src/components/EmailConfigSetupCard.tsx`
- [ ] `client/src/components/ExecutionPlanPane.tsx`
- [ ] `client/src/components/HealthAuditWidget.tsx`
- [ ] `client/src/components/InvocationChannelTile.tsx`
- [ ] `client/src/components/InvocationsCard.tsx`
- [ ] `client/src/components/McpCatalogue.tsx`
- [ ] `client/src/components/McpToolBrowser.tsx`
- [ ] `client/src/components/MemoryInspectorChat.tsx`
- [ ] `client/src/components/PortalConfigEditor.tsx`
- [ ] `client/src/components/RichTextEditor.tsx`
- [ ] `client/src/components/SchedulePicker.tsx`
- [ ] `client/src/components/TeamHeartbeatView.tsx`
- [ ] `client/src/components/TeamPicker.tsx`
- [ ] `client/src/components/TraceChainSidebar.tsx`
- [ ] `client/src/components/TraceChainTimeline.tsx`
- [ ] `client/src/components/agent-run-chat/**`
- [ ] `client/src/components/baseline/**`
- [ ] `client/src/components/brief-artefacts/**`
- [ ] `client/src/components/dashboard/**`
- [ ] `client/src/components/invocations-card/**`
- [ ] `client/src/components/openTask/**`
- [ ] `client/src/components/operator/**`
- [ ] `client/src/components/pulse/**`
- [ ] `client/src/components/recommendations/**`
- [ ] `client/src/components/rules/**`
- [ ] `client/src/components/run-trace/**`
- [ ] `client/src/components/spend/**`
- [ ] `client/src/components/subaccount-agents/**`
- [ ] `client/src/components/subaccount-knowledge/**`
- [ ] `client/src/components/system-incidents/**`
- [ ] `client/src/components/workspace/**`
- [ ] `client/src/config/capabilityGroups.ts`
- [ ] `client/src/hooks/useAgentPresence.ts`
- [ ] `client/src/hooks/useAgentRecommendations.ts`
- [ ] `client/src/hooks/useAgentRecommendationsTotal.ts`
- [ ] `client/src/hooks/useWorkspacePresence.ts`
- [ ] `client/src/lib/accessibility/**`
- [ ] `client/src/lib/agentPresenceStream.ts`
- [ ] `client/src/lib/api/memoryBlocks.ts`
- [ ] `client/src/lib/briefArtefactLifecycle.ts`
- [ ] `client/src/lib/runPlanView.ts`
- [ ] `client/src/pages/AdminPermissionSetsPage.tsx`
- [ ] `client/src/pages/AdminSettingsPage.tsx`
- [ ] `client/src/pages/AgentsPage.tsx`
- [ ] `client/src/pages/BriefDetailPage.tsx`
- [ ] `client/src/pages/ConnectorConfigsPage.tsx`
- [ ] `client/src/pages/HierarchyTemplatesPage.tsx`
- [ ] `client/src/pages/IntegrationsAndCredentialsPage.tsx`
- [ ] `client/src/pages/McpServersPage.tsx`
- [ ] `client/src/pages/OrgAgentConfigsPage.tsx`
- [ ] `client/src/pages/ProjectsPage.tsx`
- [ ] `client/src/pages/SpendLedgerPage.tsx`
- [ ] `client/src/pages/SptOnboardingPage.tsx`
- [ ] `client/src/pages/SubaccountAgentsPage.tsx`
- [ ] `client/src/pages/SubaccountKnowledgePage.tsx`
- [ ] `client/src/pages/SystemOrganisationTemplatesPage.tsx`
- [ ] `client/src/pages/agents/**`
- [ ] `client/src/pages/govern/components/ConnectionTestButton.tsx`
- [ ] `client/src/pages/govern/components/DisclosureVersionBumpModal.tsx`
- [ ] `client/src/pages/skills/SkillCreatePage.tsx`

### Server — 33 candidates

- [ ] `server/db/rlsExclusions.ts`
- [ ] `server/lib/briefVisibility.ts`
- [ ] `server/lib/canonicaliseUrl.ts`
- [ ] `server/lib/workflow/index.ts`
- [ ] `server/lib/workflowLogger.ts`
- [ ] `server/schemas/common.ts`
- [ ] `server/schemas/index.ts`
- [ ] `server/services/adminOpsService.ts`
- [ ] `server/services/alertFatigueGuard.ts`
- [ ] `server/services/briefArtefactBackstop.ts`
- [ ] `server/services/bundleResolutionService.ts`
- [ ] `server/services/bundleResolutionServicePure.ts`
- [ ] `server/services/cachedContextOrchestrator.ts`
- [ ] `server/services/configAssistantModeService.ts`
- [ ] `server/services/contextAssemblyEngine.ts`
- [ ] `server/services/crmQueryPlanner/resultNormaliser.ts`
- [ ] `server/services/crossOwnerDelegationRequestAssembler.ts`
- [ ] `server/services/dataRetentionService.ts`
- [ ] `server/services/executionBudgetResolver.ts`
- [ ] `server/services/executionBudgetResolverPure.ts`
- [ ] `server/services/leadDiscovery/**`
- [ ] `server/services/orchestratorTaskCommentTemplate.ts`
- [ ] `server/services/principal/**`
- [ ] `server/services/processedResourceService.ts`
- [ ] `server/services/retentionSuccessService.ts`
- [ ] `server/services/sdrService.ts`
- [ ] `server/services/skillAnalyzerServicePure/tableRemediation.ts`
- [ ] `server/services/systemIncidentFatigueGuard.ts`
- [ ] `server/services/systemMonitor/baselines/refreshJobPure.ts`
- [ ] `server/services/topicClassifier.ts`
- [ ] `server/services/trajectoryService.ts`
- [ ] `server/services/trustCalibrationService.ts`
- [ ] `server/tools/meta/types.ts`

### Shared — 4 candidates

- [ ] `shared/types/capabilityMap.ts`
- [ ] `shared/types/errorCodes.ts`
- [ ] `shared/types/slackAction.ts`
- [ ] `shared/types/systemIncidentEvent.ts`
