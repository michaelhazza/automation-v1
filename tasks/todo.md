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

- [ ] **LAEL-P1-1** — Finish `llmRouter` `llm.requested` / `llm.completed` emission + `agent_run_llm_payloads` writer integration. Files: `server/services/llmRouter.ts` (TODO near `llmInflightRegistry.add()`), `server/services/agentRunPayloadWriter.ts`, `server/services/agentExecutionEventEmitter.ts`. Spec refs §4.5, §5.3, §5.7. Without this, the Live Log shows no "doing" phase between `prompt.assembled` and `run.completed`. Full deferred-item context in archive.
- [ ] **LAEL-P1-2** — Remaining P1 emission sites: `memory.retrieved` (workspaceMemoryService, memoryBlockService), `rule.evaluated` (decisionTimeGuidanceMiddleware), `skill.invoked` / `skill.completed` (skillExecutor), `handoff.decided` (agentExecutionService). All non-critical except `handoff.decided`. Spec §5.3 + §6.2.
- [ ] **LAEL-P2** — Edit audit trail (Phase 2). Migration `0194_agent_execution_log_edits.sql`, `agent_execution_log_edits` table, optional `triggeringRunId` query param on memory/rule/skill/data-source edit surfaces, `EditedAfterBanner` component on `AgentRunLivePage`. Spec §8.
- [ ] **LAEL-P3 / P3.1** — Retention tiering + cold archive restore (Phase 3). Spec §9 / §9.1.
- [ ] **LAEL-FUTURE-{1..6}** — Admin-visible drop/gap metrics; trigger-based FK enforcement on `agent_run_llm_payloads.run_id`; `run.created` boundary event; causal grouping for parallel writers; deeper `prompt.assembled` layer attributions; per-run payload-persistence kill-switch. Each item is non-blocking; see archive for full context.

### Hermes Tier 1 — execution-cost deferred follow-ups

Branch `claude/hermes-audit-tier-1-qzqlD` merged 2026-04-21.

- [ ] **H1** — Add `successfulCostCents` to `/api/runs/:runId/cost` response. Removes the cost-per-call divide-by-zero / failed-call bias trap. Touches `shared/types/runCost.ts`, `server/routes/llmUsage.ts`, `client/src/components/run-cost/RunCostPanel.tsx`.
- [ ] **H2** — Rollup-vs-ledger breaker asymmetry (Slack / Whisper). LLM path now uses direct-ledger breaker; Slack / Whisper still rely on `cost_aggregates` async rollup. Becomes a real consistency risk only if those paths become hot.
- [ ] **H3** — `runResultStatus='partial'` coupling to summary presence. Decide whether `!hasSummary` is a downgrade signal or an orthogonal field. Monitor production `partial` rates first.
- [ ] **§6.8 errorMessage gap** — `agentExecutionService.ts:1350-1368`. When `finalStatus === 'failed'` via the normal terminal path, `errorMessage: null` is passed to `extractRunInsights`. Thread `preFinalizeMetadata.errorMessage` into the call. Pre-existing limitation per spec §11.4.

### Sandbox isolation (PR #287)

- [ ] **SANDBOX-F1** — Real e2b publish/inspect wiring. Currently `templateDigest` falls back to placeholder `local-dev-*` value; publish workflow hard-fails until real e2b integration lands. Tracked by gate `verify-sandbox-template-version`.
- [ ] **SANDBOX-ADV-2.1** (likely-hole) — `templateVersion` from env var unvalidated at `server/services/executionBackends/ieeDevBackend.ts:131`. Audit rows can carry forged version strings. Fix: read pinned digest from `E2bSandbox.templateDigest`.
- [ ] **SANDBOX-ADV-3.1** (likely-hole) — Telemetry sequence allocator race silently drops events at `sandboxExecutionService.ts:63-73` + `sandboxHarvestService.ts:81-91`. `criticality='error'` events may be lost. Fix: `INSERT ... ON CONFLICT DO UPDATE SET sequence = ... RETURNING sequence` with retry, or advisory lock.
- [ ] **SANDBOX-ADV-6.1** (likely-hole) — Reconciliation hardcodes `credentialAliases: []` at `sandboxHarvestReconciliationJob.ts:183-187`. Latent until C13. Fix: add `credential_aliases` JSONB column to `sandbox_executions`.
- [ ] **SANDBOX-ADV-1.2 / 2.2 / 3.2 / 4.2 / 5.2** — Worth-confirming items: missing subaccount FKs on 5 new sandbox tables; inline-sandbox env-injection bypass via forged env object; race between provider success and ceiling-monitor `markForHarvest`; S3 path-traversal via filename; no per-tenant log-storage quota. Low priority; see archive for full context.
- [ ] **SANDBOX-R3-T1** (advisory) — Reconciliation eligibility uses Node `new Date()`; migrate to DB `SELECT NOW()` for consistency with ceiling monitor. `server/jobs/sandboxHarvestReconciliationJob.ts:72`. Single-file ~10-line change.

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

- [ ] **TI-001** — Make `build-code-graph-watcher.test.ts` parallel-safe.
- [ ] **TI-006** — Canonical subaccount UUID for integration fixtures.
- [ ] **TI-007** — Integration test conventions doc — real-DB vs mocked-DB rule.
- [ ] **TI-008** — Configure CI with a non-superuser app role for RLS coverage.

### CI gate hardening (Phase 4 pre-launch)

- [ ] **CHATGPT-R3-1** — Extend CI grep invariants to cover the remaining four pre-launch B.4 categories.
- [ ] **CHATGPT-R3-2** — Canonical error taxonomy: enumerate every `error.code` string in production and lock to a typed union.
- [ ] **CHATGPT-R3-6** — Audit event namespace consistency: extend `verify-audit-namespace.sh` to detect dynamic construction.
- [ ] **CHATGPT-R1-7** — OAuth state JWT window: tightened from 10min to 5min in pre-launch-phase-2. Revert pending telemetry — confirm 5min causes no real auth failures over 30 days, then close.

### Documentation / process

- [ ] **OAuth state security audit trail** — `auth.login.failure` / `auth.login.success` / OAuth state events / abuse events now live in `security_audit_events` (migration 0281). Architecture.md §Layer 4 documents the stream split. Operator action: confirm dashboards in Grafana / Mission Control surface the new stream before deprecating the legacy `audit_events` records.

## From builder — 2026-05-13

- **PA-V2-C4-1** — `cross_owner.ask_initiator_decision` action type is not registered in `server/config/actionRegistry/`. The `crossOwnerApprovalTimeoutSweep` ask_initiator branch wraps the `proposeAction` call in a try-catch and logs a warning if it fails. A registry entry is needed for the initiator-decision action to actually land in the approval queue. Suggest adding to `server/config/actionRegistry/agents.ts` or a new `crossOwner.ts` file.
- **PA-V2-C4-2** — `server/services/agentExecutionEventServicePure.ts` has no validator cases for `cross_owner_substep.awaiting_initiator_decision` or `cross_owner_substep.completed`. The `validateEventPayload` switch hits `default: never` and returns `{ ok: false }`, silently dropping these events. Needs two new case branches added to the switch statement.
- **PA-V2-C4-3** — `server/services/actionService.ts` line 2: `createHash` imported from `'crypto'` but unused — pre-existing dead import, not introduced by this chunk.
- **PA-V2-C4-4** — `listPendingApprovalsForUser` spec says apply `isActive(actions)` but the `actions` table has no `deletedAt` column so the filter was not applied. Spec note is incorrect — actions are not soft-deletable in the current schema.

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

- [ ] **PA-V2-OP-INFO-1** — The orchestrator routing module path was previously TBD in §4.3. Spec-reviewer resolved it to `server/tools/capabilities/capabilityDiscoveryHandlers.ts` (entry point: `executeCheckCapabilityGap`, dispatched by `server/services/skillExecutor.ts:1767-1770`). Informational only; recorded here so the next implementer/audit can confirm the path before Chunk 2 begins.

- [ ] **PA-V2-OP-INFO-2** — During spec authoring §13 listed an open authoring question: whether `runTraceProjectionForViewer` deserves a dedicated `*Pure.ts` split. Defers to the implementer's judgement on test surface during Chunk 3. No action needed pre-implementation.

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

- [ ] **PA-V2-LIST-APPROVALS-V1-ARM** — wire V1 initiator-defaulted arm into listPendingApprovalsForUser
  - Origin: chatgpt-pr-review Round 1 F5 (PR #299, personal-assistant-v2-operator).
  - Context: `listPendingApprovalsForUser` in `server/services/actionService.ts` was shipped with only the explicit-approver arm (`approver_user_id = $userId`). The earlier Arm 2 (`approver_user_id IS NULL`) was removed because it had no V1 initiator predicate and would have exposed every default-approver action in the org/subaccount to any caller.
  - When to wire: when a caller actually needs the V1 default-approver path through this function. Today the V1 default approver flow is handled elsewhere; this function's scope is the V2 cross-owner approval queue only.
  - Suggested approach: JOIN actions → agent_runs to derive the run's initiator (column TBD — `agent_runs` has `actingAsUserId` + the principal model; check whichever V1 uses today as the default-approver). Add an Arm 2 that returns `approver_user_id IS NULL` rows where the run's initiator equals `$userId`. Keep the org filter mandatory.

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

- [ ] **PA-V2-EVENT-IDEMPOTENCY** — content-keyed idempotency in appendEvent
  - Origin: chatgpt-pr-review Round 3 F10/F11 residual edge case (PR #299, personal-assistant-v2-operator).
  - Context: `appendEvent` in `server/services/agentExecutionEventService.ts` has no content-based dedupe key. The current claim+emit pattern in `crossOwnerApprovalTimeoutSweep` uses a stale-claim TTL (5 min) to retry crashed emissions, which means a process crash AFTER successful `appendEvent` but BEFORE the `emitted_at` UPDATE will produce a duplicate event when a future sweep re-claims past the staleness threshold.
  - Why deferred: full event-idempotency support requires extending the `agent_execution_events` schema with an optional `idempotency_key` column + unique index, plus an `appendEvent` API extension. That's a broader refactor than the PA-V2 build should carry, and the residual risk in this build is small (single-process transient between two adjacent DB writes; pg-boss singleton serialisation reduces concurrent-sweep risk further).
  - Suggested approach: add `agent_execution_events.idempotency_key` (nullable text) + `UNIQUE(run_id, event_type, idempotency_key) WHERE idempotency_key IS NOT NULL`; extend `appendEvent` to accept an optional `idempotencyKey` field that, when set, suppresses duplicate writes via `ON CONFLICT DO NOTHING RETURNING 1`. Then the sweep can append events idempotently and drop the stale-claim TTL altogether.

## Blockers

_None active._

When you hit a stuck-detection condition (per CLAUDE.md §1), append a Blocker subsection here with: what was attempted, exact failure, root-cause hypothesis, what you'd try next.

---

## Calendar

- [ ] [2026-06-12] Complete tasks/builds/iee-browser-on-e2b/cost-report-month-1.md from observed production traffic.

---

## iee-browser-on-e2b — deferred TODOs to wire when paths become live

These are dead-code TODOs accepted as non-blocking by pr-reviewer + reality-checker + chatgpt-pr-review Round 1 (PR #297). They are listed here so they don't get lost when the relevant code paths get wired up.

- [ ] **IEE-DEF-1** — `server/services/sandbox/browserWarmPool.ts::evictStale` outer FOR UPDATE SKIP LOCKED needs `withAdminConnection` for cross-tenant sweep. Currently dead code (zero callers); wire when warm-pool eviction is scheduled.
- [ ] **IEE-DEF-2** — `server/services/sandbox/browserWarmPool.ts::refillIfEligible` needs `organisationId` on its context and `setOrgAndSubaccountGUC` wrapping; currently inserts stub sandbox IDs (`stub-${randomUUID()}`). Wire when warm-pool refill is wired to a caller (today: dead code, zero callers).
- [ ] **IEE-DEF-3** — `server/services/sandbox/ieeBrowserProfileManager.ts::gcSweep` cross-tenant sweep needs `withAdminConnection`. Currently dead code; wire when profile GC is scheduled.
- [ ] **IEE-DEF-4** — `infra/sandbox-templates/iee-browser/` template is not yet buildable. Add CI sandbox-template-build pipeline when the e2b SDK is installed (SANDBOX-DEF-EGRESS-MECH). Pipeline: bundle `harness/index.ts` to `harness/dist/index.js`, publish image, write real digest into `PUBLISHED_VERSION`. Until then `assertNotLatestTemplateVersion` rejects the all-zero placeholder so production cannot accidentally use this template.
- [ ] **IEE-DEF-5** — Wire real Playwright executor into `infra/sandbox-templates/iee-browser/harness/index.ts`. Today the stub writes `status:'failed'` so any accidental deploy fails visibly. Pull the reference implementation from `worker/src/browser/executor.ts` when bundling.
- [ ] **IEE-DEF-6** — Pre-existing host-disk profiles (`BROWSER_SESSION_DIR`) migration decision was deferred during Phase 2 chunk 5 as no-op given dogfood-first launch. Revisit if production traffic shows profile-data continuity is needed across the substrate switch.
- [ ] **IEE-DEF-7** — Wire production network policy in `server/services/executionBackends/_ieeShared.ts::ieeDispatchBrowser` policy build. Today `network.mode='none'` makes Playwright tasks unable to navigate. Decide before any subaccount flips `rolloutApproved=true`: allowlist per skill, allowlist per subaccount, or open. The SDK-not-installed factory + `assertNotLatestTemplateVersion` placeholder guard prevent dispatch from reaching production today.
- [ ] **IEE-DEF-8** — Implement real assertions in `server/services/sandbox/__tests__/ieeBrowserProfileManager.serialization.test.ts`. Today the file is a scaffold gated behind `E2B_E2E=true`; the only assertion is a placeholder. Lands with the e2b SDK install + a real provider client so the test can spawn two concurrent mounts and assert serialisation + cross-tenant safety per spec §15 R2-F6.
- [ ] **IEE-DEF-9** — Add `template_name = 'iee-browser'` AND compatible-`template_version` filter to `browserWarmPool.checkout()` SELECT. Today only one template exists and refill is RUNTIME-DISABLED, so this is a forward-looking invariant. Wire before refillIfEligible (IEE-DEF-2) goes live, otherwise checkout could lease a warm session created against an incompatible template digest.

---

## Deferred spec decisions — development-lifecycle-governance-upgrade

Items routed here by `spec-reviewer` during the iteration loop for the spec at `tasks/builds/development-lifecycle-governance-upgrade/spec.md`. Each item is AUTO-DECIDED to keep the loop unblocked; review at your leisure and either confirm or amend the spec.

- **F14 — ABCd dimensions vs Asset Register row schema.** Codex flagged that ABCd captures four dimensions (Acquire / Build / Carry / decommission) but the Asset Register row only carries Carry notes and Decommission notes. AUTO-DECIDED: accept-minimum-change. Acquire and Build remain pre-merge planning context (visible in the spec, absent from the Register). The spec's §7.3 Consumer wording and §14 Deferred Items now state this explicitly. Rationale: minimum-schema posture; adding two more columns to the Asset Register is a schema expansion that could be opportunistically added later if recurring need surfaces. If you want the Register to also carry Acquire / Build context (e.g. for future Acquire-cost reporting), amend §7.4.1 and §14 before architect handoff.

---

## skill-merge-consolidation-pass — deferred (Phase 2 close 2026-05-14)

From the branch-level review pass on `claude/improve-skill-analyzer-RiFpB`. None are blocking for the build; all are advisory/non-blocking items routed for follow-up.

**From adversarial-reviewer (Phase 1 advisory):**

- [ ] **SKILL-MERGE-RLS-1** — Add `skill_analyzer_results` to `server/config/rlsProtectedTables.ts` with a join-based policy via `skill_analyzer_jobs.organisation_id`. The new `pre_consolidation_merge` JSONB column adds more sensitive content to a pre-existing RLS gap. Also add `-- system-scoped: singleton row, no per-org data` to `migrations/0358_skill_merge_consolidation.sql` for the `skill_analyzer_config` ALTER block. Reference: `tasks/review-logs/adversarial-review-log-skill-merge-consolidation-pass-2026-05-14T02-39-41Z.md` finding 1.
- [ ] **SKILL-MERGE-INJECTION-1** — Decide whether to guard the `instructions` field in `parseConsolidationResponse` against mutation (the existing `name/description/definition/mergeRationale` mutation guards leave `instructions` open to second-order prompt injection from a jailbroken upstream LLM). Accept the residual risk on system-admin-only surface, or add an `instructions`-length / heuristic guard.
- [ ] **SKILL-MERGE-BUDGET-1** — Verify whether `systemCallerPolicy: 'bypass_routing'` exempts consolidation calls from per-org LLM budget guards. If yes, add a per-job consolidation-call cap or budget-aware skip. File: `server/jobs/skillAnalyzerJob.ts` ~lines 1289-1306.
- [ ] **SKILL-MERGE-AUDIT-1** — Decide whether to add a durable `agent_execution_events`-style audit row for consolidation transformations (today the trail is logger-only).
- [ ] **SKILL-MERGE-AUTHGATE-1** — Verify the config-update route serving `consolidationEnabled` / `consolidationTriggerSeverity` is gated by `requireSystemAdmin`, not a tenant-scoped admin middleware.
- [ ] **SKILL-MERGE-RESET-UX-1** — Confirm Reset-button semantics change (Reset now rolls back to the consolidated draft on success; the first-pass LLM merge is only accessible via the read-only disclosure panel). Discoverability check with operator before merge.

**From pr-reviewer (round 3, non-blocking):**

- [ ] **SKILL-MERGE-TEST-1** — Add direct test coverage for the `postWords >= preWords` outcome-classification decision (the new `not_shortened` branch from dual-reviewer's fix). Easiest path: extract a small pure helper `classifyConsolidationOutcome({ preWords, postWords })` from `server/jobs/skillAnalyzerJob.ts` ~line 1407 and Vitest it. Reference: `tasks/review-logs/pr-review-log-skill-merge-consolidation-pass-2026-05-14T03-15-00Z.md` Should-fix #2.
- [ ] **SKILL-MERGE-COPY-1** (Consider/Nit) — Map `failureReason` enum values to plain-English copy in `MergeReviewBlock.tsx` failed banner (today the value renders verbatim, e.g. `Reason: not_shortened` — opaque to non-technical reviewers). Reference: round-3 pr-review-log Consider section.

**From chatgpt-pr-review (Phase 3, Round 1):**

- [ ] **SKILL-MERGE-RATIONALE-1** (Consider/Nit) — Short-circuit the consolidation gate when `mergeRationale` is null upstream, instead of routing to `parseConsolidationResponse` and letting it reject with `rationale_missing_or_invalid`. Today the LLM is prompted to always echo a rationale and fallback paths backfill it, so the null-path is theoretical — but a 2-line guard at the consolidation gate (`server/jobs/skillAnalyzerJob.ts` ~line 1267) would avoid one wasted LLM call per occurrence. Reference: chatgpt-pr-review Round 1 finding F5 (defer).

---

## Pointers

- **Archive of historical deferred items:** `tasks/todo-archive-2026-Q2.md`
- **Per-build deferred items for unmerged work:** `tasks/builds/<slug>/handoff.md`
- **Source-of-truth review logs:** `tasks/review-logs/`
- **Lessons + corrections:** `KNOWLEDGE.md` + `tasks/lessons.md`
- **Ideas captured mid-session:** `tasks/ideas.md`
