# Codebase Audit — Pre-Testing Fix List

**Date**: 2026-04-01  
**Branch**: `claude/codebase-audit-fixes-rjk6f`

---

## Audit Summary

Full audit of routes, services, DB schema, client-side code, auth/security, and config.

### Critical Findings (Must Fix Before Testing)

| # | Category | Issue | Location | Severity |
|---|----------|-------|----------|----------|
| 1 | **Routes** | ~145 routes across 25 files use manual try/catch instead of `asyncHandler` | `server/routes/*` | CRITICAL |
| 2 | **Org Scoping** | `skillService.getSkill()` and `getSkillBySlug()` don't filter by organisationId | `server/services/skillService.ts` | CRITICAL |
| 3 | **Org Scoping** | `fileService.downloadFile()` doesn't scope file lookup by org | `server/services/fileService.ts` | CRITICAL |
| 4 | **Org Scoping** | `taskService` activities query lacks organisationId filter | `server/services/taskService.ts` | CRITICAL |
| 5 | **Soft Delete** | `skillService` queries don't filter `isNull(deletedAt)` | `server/services/skillService.ts` | CRITICAL |
| 6 | **Schema** | `processes.organisationId` is nullable — should be `.notNull()` | `server/db/schema/processes.ts` | CRITICAL |
| 7 | **TypeScript** | `HeartbeatEditor.tsx` uses `clientWidth` on `DOMRect` (wrong API) | `client/src/components/HeartbeatEditor.tsx:75` | HIGH |
| 8 | **TypeScript** | `AdminAgentEditPage.tsx` passes wrong props to component | `client/src/pages/AdminAgentEditPage.tsx:1035` | HIGH |
| 9 | **Transactions** | `reviewService` updates actions + reviewItems without transaction | `server/services/reviewService.ts` | HIGH |
| 10 | **JSON Parse** | Unsafe `JSON.parse()` without try/catch in `executions.ts` route | `server/routes/executions.ts:54` | HIGH |
| 11 | **Hard Delete** | `taskService` hard-deletes deliverables instead of soft-delete | `server/services/taskService.ts` | HIGH |

### Important Findings (Should Fix)

| # | Category | Issue | Location | Severity |
|---|----------|-------|----------|----------|
| 12 | **Schema** | Missing `organisationId` indexes on agentTriggers, processConnectionMappings, processedResources, reviewItems | `server/db/schema/*` | MEDIUM |
| 13 | **Config** | `connectionTokenService` doesn't validate TOKEN_ENCRYPTION_KEY on startup | `server/services/connectionTokenService.ts` | MEDIUM |
| 14 | **Client** | `OrgAdminGuard` in App.tsx has no role/permission check — just null check | `client/src/App.tsx:82-85` | MEDIUM |
| 15 | **Client** | No API request timeout configured on axios instance | `client/src/lib/api.ts` | MEDIUM |
| 16 | **Client** | 12+ API calls silently swallow errors with `.catch(() => {})` | `client/src/components/Layout.tsx` and pages | MEDIUM |
| 17 | **Error Format** | Inconsistent error throw formats across services (plain objects vs Error instances) | Multiple services | MEDIUM |
| 18 | **Race Condition** | Budget reservation in llmRouter lacks transaction protection | `server/services/llmRouter.ts` | MEDIUM |

### Security Findings (from auth/security audit)

| # | Category | Issue | Location | Severity |
|---|----------|-------|----------|----------|
| 19 | **Security** | Helmet CSP disabled — no Content-Security-Policy header | `server/index.ts:72-76` | HIGH |
| 20 | **Security** | CORS allows wildcard origins with credentials enabled | `server/index.ts:77-80` | HIGH |
| 21 | **Security** | In-memory rate limiting lost on restart; bypassed in multi-process | `server/routes/auth.ts:6-20` | HIGH |
| 22 | **Security** | Webhook auth optional — no HMAC validation if WEBHOOK_SECRET unset | `server/services/webhookService.ts:72-74` | HIGH |
| 23 | **Security** | System admin cross-org access via X-Organisation-Id has no audit trail | `server/middleware/auth.ts:42-48` | HIGH |
| 24 | **Security** | Multer memory storage accepts 500MB — OOM DoS risk | `server/middleware/validate.ts:16-19` | MEDIUM |
| 25 | **Security** | No rate limiting on password reset / forgot-password routes | `server/routes/auth.ts:72-85` | MEDIUM |
| 26 | **Security** | Error messages leak internal details to clients in production | `server/index.ts:149-153` | MEDIUM |
| 27 | **Security** | Missing security audit trail — no logging of auth/permission events | No centralized audit | MEDIUM |

### Noted (Lower Priority / Post-Testing)

- Route files exceeding 200-line limit: `subaccounts.ts` (758L), `permissionSets.ts` (587L), `llmUsage.ts` (524L), `portal.ts` (502L)
- Auth tokens stored in localStorage (XSS risk — migrate to httpOnly cookies later)
- No React ErrorBoundary component
- Silent promise rejections in `workspaceMemoryService.ts`
- Missing cascade delete rules on parent-child task/agent relationships
- Deprecated columns in agents schema (`sourceTemplateId`, `sourceTemplateVersion`)
- OAuth state JWT window too long (10 min, recommend 5 min)
- No refresh token rotation on OAuth integrations
- JWT session expiry at 24h with no forced logout on password change

---

## Fix Progress

- [x] Fix TypeScript compile errors
- [x] Convert manual try/catch routes to asyncHandler (25 files)
- [x] Fix missing org scoping in services
- [x] Fix missing soft-delete filters
- [x] Add missing DB indexes
- [x] Fix unsafe JSON.parse calls
- [x] Wrap multi-step DB operations in transactions
- [x] Convert hard-delete to soft-delete in taskService
- [x] Validate TOKEN_ENCRYPTION_KEY on startup
- [x] Add API request timeout
- [x] Final build & type check (server + client clean)

### Migration Required

The following schema changes need a DB migration before testing:
- `skills` table: new `deleted_at` column (for soft-delete support)
- `task_deliverables` table: new `deleted_at` column (for soft-delete support)

Generate with: `npm run db:generate` then `npm run migrate`

---

## Hermes Tier 1 — Deferred Item (S1 from pr-reviewer)

**Captured**: 2026-04-21  
**Branch**: `claude/hermes-audit-tier-1-qzqlD`

### §6.8 errorMessage gap on normal-path failed runs

**File**: `server/services/agentExecutionService.ts` lines 1350-1368

When `finalStatus` is `'failed'` but the loop produces a non-empty `loopResult.summary` via the normal terminal path (not a thrown exception), `errorMessage: null` is passed to `extractRunInsights`. The §6.8 short-summary guard then falls back entirely to the `hasMeaningfulSummary >= 100` check. A failed run with a 50-char summary but no thrown exception gets its memory extraction skipped — even if `agent_runs.errorMessage` was set before the loop terminated.

**Why it's deferred**: Pre-existing limitation. Documented at lines 1355-1360 as known; acceptable per spec §11.4 deferred items. The §6.8 "either signal is sufficient" contract is only half-enforced for normal-path failures.

**Suggested fix**: Thread `errorMessage` from `preFinalizeMetadata` (already in scope) into the extraction call when `derivedRunResultStatus === 'failed'`. No new DB read required if a future loop result carries an `errorMessage` field.

---

## Hermes Tier 1 — deferred review follow-ups

Captured from the second-pass code review on branch
`claude/hermes-audit-tier-1-qzqlD` (2026-04-21). Not blocking merge of
the Tier 1 build; queued for Tier 2.

### H1 — Add `successfulCostCents` to the `/api/runs/:runId/cost` response

**Context.** The Tier 1 response has an intentional asymmetry: `totalCostCents`
reads from `cost_aggregates` (includes failed calls) while `llmCallCount`,
`totalTokensIn/Out`, and `callSiteBreakdown` read from `llm_requests_all`
with a success/partial filter (excludes failed calls). This is documented
but UI consumers will misinterpret it eventually (e.g. compute an implied
cost-per-call by dividing totalCostCents / llmCallCount and get a biased
number when failures contributed non-trivial ledger cost).

**Fix.** Add an explicit `successfulCostCents` field to `RunCostResponse`
sourced from the same success/partial filter as the other new fields.
Remove the mental arithmetic trap; keep `totalCostCents` for accounting
completeness.

**Scope.** `shared/types/runCost.ts`, `server/routes/llmUsage.ts`,
`client/src/components/run-cost/RunCostPanel.tsx`, the pure module + test
matrix. Small but touches the API contract so warrants its own ship.

### H2 — Rollup-vs-ledger breaker asymmetry (Slack / Whisper)

**Context.** After Tier 1 Phase C, the LLM path uses the direct-ledger
breaker (`assertWithinRunBudgetFromLedger`) and is strongly consistent
with committed ledger rows. The Slack and Whisper paths still use the
rollup-based breaker (`assertWithinRunBudget`) which reads
`cost_aggregates`, updated asynchronously by
`routerJobService.enqueueAggregateUpdate`. Those paths can under-count
momentarily under concurrency — fine for their much-lower call volume,
but a long-term inconsistency risk if Slack/Whisper become hot paths.

**Fix.** Decide per caller whether the ledger read is worth the extra
DB hit. If yes, introduce sibling ledger-based helpers for
non-LLM cost boundaries (currently only `llm_requests` carries the
ledger shape; Slack/Whisper costs live in `cost_aggregates` only).
May require a unified per-run cost ledger before Slack/Whisper can use
a ledger-style breaker.

### H3 — `runResultStatus='partial'` coupling to summary presence

**Context.** `computeRunResultStatus(finalStatus, hasError, hadUncertainty,
hasSummary)` in `agentExecutionServicePure.ts` currently demotes a `completed`
run to `partial` when `!hasSummary`. Summary generation is not guaranteed
deterministic (reporting skill can fail, LLM can return empty), so a
semantically-successful run with no summary gets the `partial` outcome
tag — which then suppresses the success-only memory promotion and lowers
retrieval-quality scoring in `workspaceMemoryService`.

**Fix.** Decide whether `!hasSummary` is a downgrade signal or an
orthogonal field. Options:
  - Add a separate `hasSummary` flag on `agent_runs` and keep
    `runResultStatus` purely about task outcome.
  - Change the `completed + !hasSummary` branch to return `success`
    with a `summaryMissing=true` side channel.
  - Leave as-is but monitor production: if `partial` rates spike on
    the happy path, revisit.

Monitor for now; revisit before Tier 2 memory promotion work.

---

## Live Agent Execution Log — deferred items

**Captured**: 2026-04-21
**Branch the items are deferred FROM**: `claude/build-agent-execution-spec-6p1nC` (Phase 1 merge-ready after five external-review passes; review logs under `tasks/review-logs/`)
**Spec**: `tasks/live-agent-execution-log-spec.md`

This is the single source of truth for everything the Live Agent Execution Log build has deferred. Any future session working on this surface should start here, not by re-reading the review logs or the spec §9.

### LAEL-P1-1 — Finish `llmRouter` `llm.requested`/`llm.completed` emission + `agent_run_llm_payloads` writer integration

**Scope.** Most operationally valuable remaining item — without this, the Live Log timeline shows no "doing" phase between `prompt.assembled` and `run.completed`.

**Files.** `server/services/llmRouter.ts` has a scaffold TODO near the `llmInflightRegistry.add()` site. `server/services/agentRunPayloadWriter.ts::buildPayloadRow` + `server/services/agentExecutionEventEmitter.ts::tryEmitAgentEvent` are ready.

**Work.**
- Thread the provisional `'started'` ledger-row id from the idempotency-check transaction up to the emit call site.
- Emit `llm.requested` (critical) before `providerAdapter.call()` — guard on `ctx.sourceType === 'agent_run' && ctx.runId`.
- Inside the terminal ledger-write transaction (success / failure / budget_blocked / etc.), call `buildPayloadRow({ systemPrompt, messages, toolDefinitions, response, toolPolicies, maxBytes })` and insert into `agent_run_llm_payloads`. Populate `run_id` from `ctx.runId` (denormalised FK added in migration 0192).
- Emit `llm.completed` (critical) in the same `finally` block that writes the terminal row.
- Never emit for pre-dispatch terminal states (`budget_blocked`, `rate_limited`, `provider_not_configured`) — the adapter was never called.

**Spec references.** §4.5, §5.3, §5.7.

**Hazard.** The `run_id`-populating path must stay inside the terminal tx so a rollback drops both the ledger row and the payload row together. The route-level double-check on the payload endpoint depends on `payload.runId === run.id`; null values break silently if the migration's denormalised FK is ever dropped.

### LAEL-P1-2 — Remaining P1 emission sites

All non-critical (graded-failure tier; drop + warn on transient DB failure, no retry).

- **`memory.retrieved`** at `server/services/workspaceMemoryService.ts::_hybridRetrieve` return boundary. Payload includes `queryText`, `retrievalMs`, top-N `topEntries: [{id, score, excerpt}]`, `totalRetrieved`. Link to `memory_entry` of `topEntries[0].id` when non-empty.
- **`memory.retrieved`** at `server/services/memoryBlockService.ts::getBlocksForInjection` return boundary. Same shape, link to `memory_block`.
- **`rule.evaluated`** at `server/services/middleware/decisionTimeGuidanceMiddleware.ts` — fires whether or not a rule matched. Payload `{ toolSlug, matchedRuleId?, decision, guidanceInjected }`. Link to `policy_rule` when matched.
- **`skill.invoked`** at `server/services/skillExecutor.ts::execute()` entry — carries `{ skillSlug, skillName, input, reviewed, actionId? }`.
- **`skill.completed`** at the same function's result-return (inside the existing try/finally). Payload `{ skillSlug, durationMs, status, resultSummary, actionId? }`.
- **`handoff.decided`** (critical) at the handoff site inside `agentExecutionService.ts` — payload `{ targetAgentId, reasonText, depth, parentRunId }`. Link to `agent` of the target.

**Spec references.** §5.3 taxonomy, §6.2 "Files to change" table.

### LAEL-P2 — Edit audit trail (Phase 2)

**Spec.** §8 Phase 2.

**Deliverables.**
- Migration `0194_agent_execution_log_edits.sql` with RLS + manifest entry.
- New table `agent_execution_log_edits` — see spec §5.8 schema.
- Optional `triggeringRunId` query param on the existing edit surfaces (memory edit, rule editor, skill edit, data-source edit) — each writes an audit row on save.
- Client surface: `EditedAfterBanner` component on `AgentRunLivePage` (shown for past runs only, queries `agent_execution_log_edits` by `(entity_type, entity_id)`). Linked-entity Edit CTAs pass `?triggeringRunId=`.

**Ship criterion.** Edits made via a log-link are auditable; past runs show a banner on events whose linked entity has been edited since.

### LAEL-P3 — Retention tiering (Phase 3)

**Spec.** §8 Phase 3.

**Deliverables.**
- Migration `0193_agent_execution_log_retention.sql` — creates `agent_execution_events_warm`, `agent_run_prompts_warm`, `agent_execution_events_archive` (Parquet BYTEA) tables + RLS + manifest entries. Adds `archive_restored_at timestamptz` to `agent_runs`.
- Jobs: `server/jobs/agentExecutionLogArchiveJob.ts` (rotation worker, uses `createWorker()`) + `agentExecutionLogArchiveJobPure.ts` (pure cutoff math, mirrors `llmLedgerArchiveJobPure.ts`).
- Queue registration in `server/services/queueService.ts` as `maintenance:agent-execution-log-archive`, 03:30 UTC daily (offset from the ledger archive's 03:45 slot to avoid write contention).
- Env vars already declared in `server/lib/env.ts`: `AGENT_EXECUTION_LOG_HOT_MONTHS` (6) / `_WARM_MONTHS` (12) / `_COLD_YEARS` (7) / `_ARCHIVE_BATCH_SIZE` (500) / `_RESTORE_GRACE_DAYS` (30).

**Ship criterion.** Nightly job moves rows between tiers; read endpoints transparently fall through hot → warm → cold on lookup (cold returns a job handle + retrieval ETA, same pattern as the ledger archive).

### LAEL-P3.1 — Cold archive restore (trigger + worker, deferred)

**Spec.** §8 Phase 3.1.

**Schema support lands in P3** (migration 0193 adds `archive_restored_at` column). **Trigger endpoint + worker deferred** until a real operator request for a cold-archived run lands.

**Deliverables when the ask arrives.**
- `POST /api/admin/agent-runs/:runId/restore-archive` (system-admin only). Returns `{ jobId, estimatedAvailableAtMs }`.
- pg-boss handler `maintenance:agent-execution-log-restore` — unpacks Parquet blob, inserts with `ON CONFLICT DO NOTHING`, stamps `agent_runs.archive_restored_at = now()`.
- SLA target: best-effort <60 s per run; no hard guarantee.

### LAEL-FUTURE-1 — Admin-visible surface for drop + gap metrics

**Not blocking.** Counters exist server-side (`getAgentExecutionLogMetrics()` — `criticalDropsTotal`, `nonCriticalDropsTotal`, `capDropsTotal`) and client-side (`getAgentRunLiveClientMetrics()` — `sequenceGapsTotal`, `sequenceCollisionsTotal`). Per-incident log lines are wired. Surfacing on a system-admin dashboard is a separate small spec — recommend a row on `/system/llm-pnl` or a new `/system/agent-exec-log-health` page.

**Trigger to ship.** First production incident where an operator needs to correlate "timeline stopped at event 9_867" with "cap was hit".

### LAEL-FUTURE-2 — Trigger-based FK enforcement on `agent_run_llm_payloads.run_id`

**Not blocking.** Route-level double-check (the `llm_requests.run_id` pre-check plus the denormalised `payload.runId` secondary check) covers the read path today. Write-time enforcement lands implicitly with LAEL-P1-1 (payload writer will populate `run_id` from `ctx.runId` inside the terminal tx).

**Trigger to ship.** Never, unless a bypass-the-writer path ever lands that would insert a payload row without a `run_id` when a run exists.

### LAEL-FUTURE-3 — `run.created` boundary in the event taxonomy

**Not blocking.** Currently `run.started` is always sequence 1 (awaited at creation) and `orchestrator.routing_decided` (when present) is sequence 2.

**Trigger to ship.** If pre-run validation or routing retries land — then split `run.created` (pre-validation / dispatch decision) from `run.started` (post-validation / loop entry) so the timeline captures intent vs. execution separately.

### LAEL-FUTURE-4 — Causal grouping for parallel writers

**Not blocking.** Current single-writer-per-run model makes `sequenceNumber` both a total and a causal order.

**Trigger to ship.** If parallel sub-agent writers or async tool branches land — then `sequenceNumber` becomes total-only, and a separate `parentSequenceNumber` field (or a logical-clock variant) is needed for causal reconstruction. Operator-facing UI would need to clarify the semantic.

### LAEL-FUTURE-5 — Deeper `prompt.assembled` layer attributions

**Not blocking but visible.** Current emission records top-level layer lengths only (`master`, `taskContext`); `orgAdditional`, `memoryBlocks`, `skillInstructions` are emitted as `0`. Validator accepts this (non-negative check only) but the zeroes are misleading for the spec's "click a layer to see its contribution" UX.

**Work.** Refactor `buildSystemPrompt` in `server/services/llmService.ts` to return per-layer offsets natively alongside the assembled string. Plumb through to the `prompt.assembled` payload + `agent_run_prompts.layer_attributions` write. Unlocks the `LayeredPromptViewer` spec's intended drilldown.

### LAEL-FUTURE-6 — Per-run payload-persistence kill-switch

**Not blocking.** Per-tool `payloadPersistencePolicy: 'args-never-persisted'` already covers the per-tool case.

**Trigger to ship.** When an ops or compliance team asks for run-level "do not persist any payload for this run" — e.g. a regulated workload where even redacted payload bodies are out of scope.

---

## Spec Review deferred items

### LAEL-RELATED — `External Call Safety Contract` abstraction (cross-feature, unscoped)

**Not a LAEL deliverable.** Extract the pattern from `llmRouter.ts` — `intent-record → external-side-effect → single-terminal-transition → ghost-arrival-detection → caller-owned-retry → observable-in-flight → best-effort-history` — into a reusable platform primitive so payments, webhook dispatch, integration adapters, and long-running agent tasks can all inherit it without reintroducing unsafe retry logic.

**Why it's filed here.** Called out post-in-flight-tracker merge + reinforced during LAEL reviews. Has no spec yet.

---

## PR Review deferred items

### PR #171 — claude-md-updates (2026-04-22)

- [ ] Add non-goals enforcement gate to spec-reviewer — valid improvement but requires spec-reviewer to reason about product strategy (not just structural spec quality); out of scope for this PR; revisit when spec-reviewer is next revised.

---

## Deferred spec decisions — crm-query-planner

**Captured:** 2026-04-22
**Source log:** `tasks/review-logs/spec-review-log-crm-query-planner-1-20260422T023318Z.md`

- [ ] Finding #20 — §21.3 "Phased rollout per org" vs `staged_rollout: never_for_this_codebase_yet` framing — AUTO-DECIDED (accept clarifying sentence). Rationale: §21.3 describes per-org capability grants via the skill-permission system, not infrastructure-level traffic-shifted rollout. The framing assumption targets % traffic / feature flags / canary deploys; per-org permission grants are standard operational practice. Clarifying sentence added to §21.3 to pre-empt future confusion. Human to verify the distinction is still intentional at implementation time.

---

## Deferred testing — crm-query-planner

**Captured:** 2026-04-22
**Source:** P1 build audit (spec §5 / §20.2)

- [ ] **Author `server/services/crmQueryPlanner/__tests__/integration.test.ts`** — single RLS-isolation integration test per spec §20.2. Assert subaccount-A caller cannot see subaccount-B data via `POST /api/crm-query-planner/query` against a registry-matched intent. Use the existing `rls.context-propagation.test.ts` harness pattern. Deferred from P1 build because authoring it needs a local DB harness for verification. The planner's RLS is already structurally enforced (every canonical dispatch routes through `canonicalDataService.withPrincipalContext`), so the residual risk is low, but the spec carves this test out explicitly as a "hot-path cross-tenant correctness concern that can't be proven by pure tests alone." Pick this up before P1 ships to production.

---

## Deferred from spec-conformance review — crm-query-planner (2026-04-22)

**Captured:** 2026-04-22T09:17:12Z
**Source log:** `tasks/review-logs/spec-conformance-log-crm-query-planner-2026-04-22T09-17-12Z.md`
**Spec:** `tasks/builds/crm-query-planner/spec.md`

- [x] **REQ #40 — PlannerEvent `at` scalar type mismatch.** Closed 2026-04-22 in the same pr-review session: runtime now emits `Date.now()` (epoch ms); `PlannerEventEnvelope` in `plannerEvents.ts` is `at: number`, matching the shared contract at `shared/types/crmQueryPlanner.ts` §6.6.

- [x] **REQ #57 — `stage2_cache_miss` reason not discriminated.** Closed 2026-04-22: `planCache.get` returns a discriminated result (`{ hit: true, plan, entry } | { hit: false, reason: 'not_present' | 'expired' | 'principal_mismatch' }`); the service branches on `reason` when emitting `planner.stage2_cache_miss`. `planCachePure.test.ts` updated.

- [x] **REQ #68 — Canonical-precedence tie-breaker: missing hybrid-promotion case.** Closed 2026-04-22: `applyCanonicalPrecedence` now implements three cases (promote to canonical when no live-only filters; promote to hybrid with `hybridPattern: 'canonical_base_with_live_filter'` when exactly one live-only filter; stay live otherwise). Uses `isLiveOnlyField` from `liveExecutorPure.ts`. Tests extended in `validatePlanPure.test.ts`.

- [x] **REQ #99 — RLS wrapping not present at `runQuery` top.** Closed 2026-04-22: `runQuery` now wraps its pipeline body in `withPrincipalContext(toPrincipalContext(context), …)` when an outer `withOrgTx` context is active (HTTP auth middleware provides it). Programmatic callers without an outer org-tx skip the wrap via `getOrgTxContext()` guard rather than triggering the primitive's throw. PrincipalContext mapping: `'user' → 'user'`, `'agent' | 'system' → 'service'`.

- [x] **REQ #103 — `PlannerTrace` never built or embedded on `planner.result_emitted`.** Closed 2026-04-22: `runQueryPipeline` now threads a `PlannerTrace` accumulator (stage1 / stage2 / stage3 / validator / canonicalPromoted / executor / finalPlan / mutations / terminalOutcome / terminalErrorCode) and attaches a deep-frozen snapshot to every `planner.result_emitted` / `planner.error_emitted` payload via `freezeTrace()`.

- [x] **REQ #111 — Route-level capability check is hard-coded, not verified.** Closed 2026-04-22: `server/routes/crmQueryPlanner.ts` now calls `listAgentCapabilityMaps(organisationId, subaccountId)` and unions `capabilityMap.skills + capabilityMap.read_capabilities` across agents linked to the target subaccount. Missing `crm.query` → `403 { error: 'missing_permission', requires: 'crm.query' }`. The union is passed through as `ExecutorContext.callerCapabilities` so §12.1's skip-unknown-capability rule continues to apply downstream.

- [ ] **REQ #64 — Spec self-contradiction on `systemCallerPolicy` (ambiguous; spec fix, not code fix).**
  - Spec section: §10.1 says `'bypass_routing'`; §16.1 says `'strict'`
  - Gap: `llmRouter`'s valid enum is `'respect_routing' | 'bypass_routing'` — `'strict'` is not a valid value. Implementation correctly uses `'bypass_routing'` per §10.1. §16.1's `'strict'` appears to be a stale line.
  - Suggested approach: patch §16.1 of the spec to replace `'strict'` with `'bypass_routing'` (or clarify that §10.1 is canonical). Requires `spec-reviewer` or a manual spec edit pass; no code change.

---

## Deferred from dual-reviewer review — crm-query-planner (2026-04-22)

**Captured:** 2026-04-22T11:00:00Z
**Source log:** `tasks/review-logs/dual-review-log-crm-query-planner-2026-04-22T11-00-00Z.md`
**Spec:** `tasks/builds/crm-query-planner/spec.md`

- [ ] **Principal `teamIds` resolution is not wired into planner entry points (Codex iter-1 finding 3).** Both `server/routes/crmQueryPlanner.ts` and the `crm.query` handler in `server/services/skillExecutor.ts` pass `teamIds: []` into `ExecutorContext`. The PR introduces `withPrincipalContext` wrapping inside `runQuery`, which in turn sets `app.current_team_ids` to `''`. Any canonical row tagged `visibility_scope='shared_team'` will be invisible to planner queries — a behavioral regression for team-shared data if/when any ingestion path starts setting that scope. Default scope for canonical rows is `shared_subaccount`, which is visible regardless of team membership, so the immediate impact in production today is zero. When team-sharing semantics become active, the fix is a shared `resolveTeamIdsForPrincipal(userId, organisationId)` helper wired into auth middleware (populate `req.user.teamIds` once) and consumed by both entry points. Cross-cutting change — out of scope for this PR. Reject the proposed inline fix; route to backlog.

- [ ] **Hybrid executor's `applyLiveFilter` under-fetches for live-only fields not translated into provider params (Codex iter-1 finding 2).** `liveExecutorPure.translateToProviderQuery` only extracts `pipelineId` (opportunities) and `status` (conversations/tasks) into the GHL request; the other live-only fields (`city`, `country`, `calendarId`, `appointmentType`, `customFields`, `unreadCount`, `note`, `label`) are applied post-hoc via `matchesLiveFilter` against the provider's unfiltered top-50 rows. This means a hybrid query for "contacts in Austin" can silently drop matching rows beyond the provider's first page of 50. Iter-1 finding 1 is partially mitigated by the canonical-resolvable guard I added in this review, but the deeper issue — hybrid executor semantics when the live-only field can't be efficiently pushed down — remains. Options: (a) add per-(entity, field) pagination-aware fetch in `applyLiveFilter`; (b) restrict case (b) promotion to a whitelist of (entity, field) pairs the provider can natively filter; (c) document the v1 cap and surface it as a `truncated: true` signal. Decision needed before high-volume hybrid queries ship. Not fixing in this PR — surface-area is too broad and the safe behavior today (via the canonical-resolvable guard) is to keep drafts on `live` when the remaining filters aren't canonical-resolvable, so the most broken case is already neutralised.

---

## Deferred from chatgpt-pr-review — crm-query-planner (2026-04-22)

**Captured:** 2026-04-22T11:07:47Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-crm-query-planner-2026-04-22T11-07-47Z.md`
**PR:** #177 — https://github.com/michaelhazza/automation-v1/pull/177
**Spec:** `tasks/builds/crm-query-planner/spec.md`

- [ ] **Hybrid: ID-scoped live fetch (chatgpt finding #1 — remainder).** Replace the current "fetch all live rows for the entity, then reduce in memory" flow inside `hybridExecutor.applyLiveFilter` with an ID-scoped call that passes `canonicalBase.rows[].id` into the provider query so the live fetch returns only rows matching the canonical base. This is the mid-term form of the scalability guard ChatGPT flagged as [Must fix]. Overlaps with the dual-reviewer deferred item above (Codex iter-1 finding 2) — both items converge on the same primitive: per-(entity, field) pagination-aware, ID-scoped live fetch. Treat as a single follow-up PR. The short-term partial mitigation (warn log on `hybrid.base_at_plan_limit`) shipped in this review; the full fix requires extending `ghlReadHelpers.listGhl*` contracts to accept an `idsIn` array, which is a cross-cutting adapter change and out of scope for PR #177.

- [ ] **Runtime read-only enforcement on `ExecutorContext` (chatgpt finding #2).** Current read-only guarantee for the planner is structural: a CI grep guard (`scripts/verify-crm-query-planner-read-only.sh`) plus import discipline (executors may only import `*ReadHelpers` / canonical-read paths). ChatGPT's recommendation — mark `ExecutorContext.readOnly = true` and have every adapter throw on write when that flag is set — requires every `ghlAdapter` / `canonicalDataService` write helper to honour the flag, which is a cross-cutting adapter primitive. Approach to evaluate: a single session-level guard (e.g. `SET TRANSACTION READ ONLY` on the Drizzle tx inside `withPrincipalContext` when the caller is the planner) covers DB writes with one primitive; GHL-side writes are already blocked by import discipline. Defer to a separate PR that touches both ends.

- [ ] **Live executor retry on transient `rate_limited` (chatgpt finding #6).** Spec §13 and §14.3 explicitly document fail-fast behaviour for v1 live-call failures. ChatGPT's "minimal 1 retry on rate-limited + distinguish retryable vs terminal errors" is a valid hardening direction but changes a documented spec invariant. Before implementing: spec amendment (add a retry invariant to §13, define retry/backoff envelope, update §14.3 hybrid fail-fast to reflect), then implementation in `liveExecutor.ts`. Route through `spec-reviewer` before coding.

- [ ] **Planner metrics panel — Stage 1 vs Stage 3 hit rate + cache hit rate (chatgpt observation).** `/api/admin/llm-pnl/planner-metrics` currently surfaces Stage 3 totals only (total calls, escalation rate, avg cost, avg latency, total cost). The underlying data is already emitted via `plannerEvents.emit` (`planner.stage1_matched`, `planner.stage2_cache_hit`, `planner.stage2_cache_miss`, `planner.stage3_parse_started`) and forwarded to structured logs. Extend `systemPnlService.getPlannerMetrics` to compute `stage1HitRate`, `stage2HitRate`, `stage3Rate` from a log-aggregation source (requires a log-ingestion pipeline) OR add a lightweight in-process counter that flushes daily. Pure dashboard-surfacing work; no core planner change required. Defer until there's real traffic to justify the wiring.
