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
| 19 | **Security** | **[CLOSED 2026-04-29]** Helmet CSP enabled in production with non-trivial directives (`server/index.ts:188-213`); dev intentionally `false`. Originally: "Helmet CSP disabled" | `server/index.ts:188-213` | HIGH |
| 20 | **Security** | **[CLOSED 2026-04-29]** CORS allowlist read from `env.CORS_ORIGINS`; prod fails fast on `*`. Originally: "CORS allows wildcard origins with credentials enabled" | `server/index.ts:215-228` | HIGH |
| 21 | **Security** | **[OPEN — pre-prod-boundary-and-brief-api Phase 2]** In-memory rate limiting lost on restart; bypassed in multi-process | `server/routes/auth.ts:14-30` | HIGH |
| 22 | **Security** | **[OPEN — pre-prod-boundary-and-brief-api Phase 3]** Webhook auth optional — no HMAC validation if WEBHOOK_SECRET unset | `server/services/webhookService.ts:74-77` | HIGH |
| 23 | **Security** | **[CLOSED 2026-04-29]** Cross-org access logged via `auditService.log({ action: 'cross_org_access', … })` (persisted, queryable — stricter than the `logger.info` originally requested) | `server/middleware/auth.ts:82-96` | HIGH |
| 24 | **Security** | **[OPEN — pre-prod-boundary-and-brief-api Phase 1]** Multer memory storage accepts 500MB — OOM DoS risk | `server/middleware/validate.ts:17-20` | MEDIUM |
| 25 | **Security** | **[CLOSED 2026-04-29 — route wiring; primitive swap remaining in pre-prod-boundary-and-brief-api Phase 2]** Forgot/reset-password rate-limited via `express-rate-limit` 5/15min at `server/routes/auth.ts:11-12,108,120`. Swap to DB-backed primitive folded into Phase 2. | `server/routes/auth.ts:11-12,108,120` | MEDIUM |
| 26 | **Security** | **[CLOSED 2026-04-29]** Production error envelope `{ error: { code, message }, correlationId }` strips internals; 5xx `message` replaced with "Internal server error" in prod | `server/index.ts:436-443` | MEDIUM |
| 27 | **Security** | **[OPEN — out of scope for pre-prod-boundary-and-brief-api per brief; broader follow-up]** Missing security audit trail — no logging of auth/permission events | No centralized audit | MEDIUM |

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

### Deferred from chatgpt-spec-review — riley-observations-dev-spec (2026-04-23)

**Captured:** 2026-04-23
**Source log:** `tasks/review-logs/chatgpt-spec-review-riley-observations-2026-04-23T08-33-46Z.md`
**Spec:** `docs/riley-observations-dev-spec.md`
**PR:** #179 — https://github.com/michaelhazza/automation-v1/pull/179

Deferred items from the 3-round ChatGPT review + closing verdict. All items are **reconsider-per-trigger** — explicitly out of scope for v1 but with a named condition that would force revisiting. Pre-launch posture (no live consumers, no partner capability ingestion, no queue-prioritisation layer) keeps them out of v1; each item has its own re-evaluation trigger captured below.

- [ ] **Automation + Workflow versioning and marketplace-readiness.** Full lifecycle ownership for shared/partner/BYO capabilities — immutable execution versions pinned on runs, opt-in upgrade paths, cross-tenant isolation, partner-provided capability ingestion, marketplace distribution primitives. **Reconsider per trigger:** (a) external party needs to publish capabilities the platform consumes, OR (b) in-place upgrades to a shared Automation cause a customer-visible break — whichever surfaces first. Spec foundation is already forward-compatible: §5.10a composition constraints (depth=1, no recursive Workflow calls, no callback composition) are the ruleset a future multi-party graph will inherit from. No v1 migration or schema accommodation required beyond §5.4a + §5.10a. (§9b main entry.)
- [ ] **`automations.deterministic` flag — capability-contract extension.** Declares whether the Automation is a pure function of its inputs. Not added in v1 because no subsystem currently keys on it. **Reconsider per trigger:** when/if Automation-response caching or memoisation lands — at that point cached-result safety needs the author's declaration. (§9b sub-block.)
- [ ] **`automations.expected_duration_class` flag — capability-contract extension.** Declares typical latency band (e.g. `fast < 5s`, `normal < 60s`, `slow < 300s`). Not added in v1 because the dispatcher has a single timeout constant and no queue-prioritisation layer. **Reconsider per trigger:** when queue prioritisation / SLA routing lands. Related-but-distinct: **per-row `timeout_ms` override column** is already tracked as a separate deferral under §9b Workflow-composition Part 2 — the timeout override is a hard ceiling, `expected_duration_class` would be a scheduling hint. (§9b sub-block.)
- [ ] **`irreversible` as third `side_effects` enum value — capability-contract extension.** Would distinguish `mutating-but-reversible` (create-contact, which we can delete) from `mutating-and-irreversible` (send-email, which we cannot unsend). Deliberately NOT added to the v1 enum — §5.4a keeps `read_only | mutating | unknown` only. **Reconsider per trigger:** if the platform's auto-gate-bypass posture changes post-launch (i.e. if "Execute Mode skips review for `mutating`" ever becomes the default, we would need `irreversible` as the explicit "always review regardless of mode" class). Until then, `mutating` is sufficient. (§9b sub-block.)

### Implementation-time follow-ups for riley-observations

Captured from ChatGPT's closing verdict on PR #179 — actions that belong in the build phase, not the spec.

- [ ] **Thin execution test harness — contract-behaviour validation before full build-out.** ChatGPT's highest-leverage next-step recommendation after spec finalisation: define a thin execution test harness that validates capability-contract behaviour before the full Part 2 build lands. Specifically, the harness validates the runtime behaviour declared by **§5.4a (Automation capability contract — `side_effects` / `idempotent` gate-resolution defaults, engine-enforced non-idempotent retry guard, `overrideNonIdempotentGuard` opt-in, hard `maxAttempts ≤ 3` ceiling with dispatcher clamp semantics)** and **§5.10a (composition constraints — depth=1, no `invoke_workflow` step type, no callback composition, dispatcher one-step-one-webhook defence-in-depth)**. The harness should exercise: (a) every `side_effects` × `gateLevel` default-resolution branch, (b) the engine-enforced non-idempotent retry guard with and without `overrideNonIdempotentGuard`, (c) the `maxAttempts ≤ 3` clamp path including authored `maxAttempts > 3` values, (d) both §5.10a error surfaces (authoring-time `workflow_composition_invalid` validator rejection + dispatch-time `automation_composition_invalid` defence-in-depth rejection). Goal is to surface engine-drift-from-contract before the full Part 2 implementation bakes assumptions in. **Not a v1 blocker** but the recommended first build-phase deliverable against this spec.

### hierarchical-delegation-dev-spec (2026-04-23)

**Source log:** `tasks/review-logs/chatgpt-spec-review-hierarchical-delegation-dev-spec-2026-04-23T08-31-11Z.md`
**Spec:** `docs/hierarchical-delegation-dev-spec.md`
**Branch:** `claude/paperclip-agent-hierarchy-9VJyt`

- [ ] **Nearest-common-ancestor routing for cross-subtree reassignment** — ChatGPT suggested automatic NCA-based routing so two peer subtrees can exchange work without requiring the subaccount root as middleman. Out of scope for v1 where root-only is a deliberate simplification; revisit when a real cross-subtree workflow emerges that root-funnelling demonstrably bottlenecks. Requires algorithmic design + prompt-scaffolding decision about how the NCA is surfaced to the caller.
- [ ] **Violation sampling / alerting tier above §17.3 rejection-rate metric** — ChatGPT suggested a sampling-based alert ladder (page on sustained rejection-rate anomalies, digest on daily trend breaks). Ops/observability concern rather than a delegation-contract concern; belongs in a post-launch monitoring spec or the ops playbook, not in this spec. Revisit after Phase 4 ships and there is a baseline rejection-rate distribution to calibrate against.

### system-monitoring-coverage (2026-04-28)

**Source log:** `tasks/review-logs/chatgpt-spec-review-system-monitoring-coverage-2026-04-28T06-54-48Z.md`
**Spec:** `docs/superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md`
**PR:** #226 — https://github.com/michaelhazza/automation-v1/pull/226
**Branch:** `claude/add-monitoring-logging-3xMKQ`

- [ ] [auto] **Convert `withOrgTx` invariant from grep-check to lint rule or AST test** — Round 2 ChatGPT verdict surfaced this as the one minor observation (explicitly NOT a blocker, "natural evolution"). The §5.2 invariant "A handler passed to `createWorker` MUST NOT open its own org-scoped transaction" is currently enforced via `grep -n "withOrgTx" <file>` against each converted handler. The grep + decision table works for the current scope (3 handlers being converted) but is human-executed — every future `createWorker` call site re-introduces the verification burden. Long-term: replace with either (a) an ESLint custom rule that flags `withOrgTx(...)` calls inside the handler argument of `createWorker(...)`, or (b) a test-time AST check that walks `createWorker` call sites and asserts no nested `withOrgTx` in the handler body. **Reconsider per trigger:** when adding a 4th `createWorker` conversion OR when a `withOrgTx` regression slips past the grep check in code review. Until then, the human-executed grep is sufficient. Rationale: "not needed now, just a natural evolution" — ChatGPT Round 2 verdict.

---

### LAEL-RELATED — `External Call Safety Contract` abstraction (cross-feature, unscoped)

**Not a LAEL deliverable.** Extract the pattern from `llmRouter.ts` — `intent-record → external-side-effect → single-terminal-transition → ghost-arrival-detection → caller-owned-retry → observable-in-flight → best-effort-history` — into a reusable platform primitive so payments, webhook dispatch, integration adapters, and long-running agent tasks can all inherit it without reintroducing unsafe retry logic.

**Why it's filed here.** Called out post-in-flight-tracker merge + reinforced during LAEL reviews. Has no spec yet.

---

## PR Review deferred items

### PR #233 — brief-feature-updates (2026-04-29 — ChatGPT review round 1)

- [ ] [user] **Unify `/api/briefs` and `/api/session/message` contract** — F1, severity high, scope architectural. **[PARTIAL 2026-04-29]** Service extraction shipped: both routes already call `createBrief()` from `server/services/briefCreationService.ts`. Response-envelope harmonisation remaining in `pre-prod-boundary-and-brief-api` branch (Phase 4) — define a unified `BriefCreationEnvelope` type both routes return on the brief-creation path. Original: Two parallel brief-creation entry points have diverged: `/api/briefs` returns `{ briefId, conversationId, fastPathDecision }` while `/api/session/message` returns `{ type: 'brief_created', ...context }` with context-switch side effects. Layout modal still posts to `/api/briefs`; GlobalAskBar uses `/api/session/message`. Risk: future bugs where one path bypasses logic added to the other. Recommended approach: make `/api/briefs` a thin wrapper over `/api/session/message`, or extract a shared service that both routes call and emit a consistent response envelope. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-brief-feature-updates-2026-04-29T01-05-59Z.md`. PR #233 — https://github.com/michaelhazza/automation-v1/pull/233.
- [ ] [user] **Refactor `createBrief` into `normalizeBriefInput` + `classifyBriefIntent` + `persistBrief`** — F5, severity medium, scope architectural. `createBrief` now accepts text, explicitTitle, explicitDescription, derived classifyText with branching behaviour for modal vs chat — three responsibilities in one function. Hidden coupling between UI source and backend logic creates subtle bug surface. Pure refactor; no behaviour change expected. Better as a focused refactor PR with its own tests than appended to this feature PR. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-brief-feature-updates-2026-04-29T01-05-59Z.md`. PR #233 — https://github.com/michaelhazza/automation-v1/pull/233.
- [ ] [user] **Add rate limiting / abuse control to `/api/session/message`** — F6, severity medium. Endpoint does DB lookups + LLM classification + creates tasks with no visible throttling. Needs design: per-user vs per-org counters, 429 UX copy, telemetry. Quick guard would either annoy users or fail to protect — warrants dedicated implementation. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-brief-feature-updates-2026-04-29T01-05-59Z.md`. PR #233 — https://github.com/michaelhazza/automation-v1/pull/233.
- [ ] [user] **Bound `findEntitiesMatching` ILIKE search (min hint length / prefix fallback / pg_trgm)** — F7, severity medium. `scopeResolutionService.findEntitiesMatching` uses `%hint%` ILIKE with `.limit(10)` but no min-hint-length guard or trigram index — full scans on short queries. Right fix is one of: min-length guard (changes UX; need copy), prefix fallback (`hint%`), or pg_trgm index (migration). Pick after measuring perf at realistic table sizes. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-brief-feature-updates-2026-04-29T01-05-59Z.md`. PR #233 — https://github.com/michaelhazza/automation-v1/pull/233.
- [ ] [user] **Add tests for `/api/session/message` Path A/B/C, cross-tenant rejection, stale subaccount drop** — F8, severity medium-high. Pure helpers (parseContextSwitchCommand, scopeResolutionService) are well-tested; integration paths through `sessionMessage.ts` are not. Test scaffolding (mocks for path branches, principal context fixtures, stale-subaccount setup) is its own ~100–300-line effort — better as a focused test-coverage PR. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-brief-feature-updates-2026-04-29T01-05-59Z.md`. PR #233 — https://github.com/michaelhazza/automation-v1/pull/233.
- [ ] [user] **Return real `organisationName` and `subaccountName` from `/api/session/message` Path C** — F15, severity low. Path C currently always returns `organisationName: null` and `subaccountName: null` even when context is set. The client (GlobalAskBar) now tolerates this via fallback, but other consumers of the endpoint may not, and the divergence vs Path A/B is unnecessary. Fix: look up names server-side (or pass through from req.user/sessionContext where already known) and return them in the response envelope. Tightens contract for future consumers; not a bug today. Source: ChatGPT PR review round 3; session log `tasks/review-logs/chatgpt-pr-review-brief-feature-updates-2026-04-29T01-05-59Z.md`. PR #233 — https://github.com/michaelhazza/automation-v1/pull/233.

### PR #226 — claude-add-monitoring-logging-3xMKQ (2026-04-28 — ChatGPT review round 1)

- [ ] [user] **Add `createWorker`-only tripwire (CI grep against raw `boss.work(`)** — Reviewer flagged that two new direct `boss.work(...)` registrations in this PR ([server/index.ts:462](server/index.ts#L462) async-ingest worker, [server/index.ts:499](server/index.ts#L499) skill-analyzer worker) plus pre-existing [agentScheduleService.ts:92,183](server/services/agentScheduleService.ts) bypass the `createWorker` wrapper's instrumentation (timeout, retry classification, org-scoped tx, `withOrgTx` telemetry). Both new workers are deliberate system-level exceptions (no org context) and could move to `createWorker` with `resolveOrgContext: () => null`, but migrating mid-merge expands scope. Add a CI tripwire script (`scripts/verify-no-raw-boss-work.sh`) that fails the build on any new `boss.work(` outside an allowlist of explicit system-level exceptions; pair with code comments at the exception sites pointing to the allowlist. Trigger to act: when adding the next pg-boss worker registration, OR when an instrumentation regression slips past review. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-claude-add-monitoring-logging-3xMKQ-2026-04-28T22-09-33Z.md`. PR #226 — https://github.com/michaelhazza/automation-v1/pull/226.
- [ ] [user] **Centralise integration-test skip pattern (`shouldSkipIntegration()` helper)** — Four files use minor variants of `process.env.NODE_ENV !== 'integration'` (`server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts`, `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`, `server/services/__tests__/llmRouterLaelIntegration.test.ts`, `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts`); other files self-skip on missing `DATABASE_URL` instead. Drift risk: if one test wants to add `DATABASE_URL` checking it must do it independently. Centralise to `tests/utils/shouldSkipIntegration.ts` exporting a single boolean (or a `describe.skipIf(...)` wrapper if Vitest API supports it). Trigger to act: when adding the next integration test OR when the divergence between checks creates a real false-skip. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-claude-add-monitoring-logging-3xMKQ-2026-04-28T22-09-33Z.md`. PR #226 — https://github.com/michaelhazza/automation-v1/pull/226.

### PR #218 — create-views (2026-04-28 — ChatGPT review round 1)

- [ ] [user] **Spec ambiguity — "RLS protected tables list" in `docs/superpowers/specs/2026-04-26-home-dashboard-reactivity-spec.md`** — ChatGPT flagged the phrase as unclear. Not a runtime issue; the spec is finalised and merged-into-history for this PR. Resolve as part of a future spec-hygiene sweep (clarify which exact tables the spec considered "RLS protected" and whether the phrase was meant as a constraint or context). Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-create-views-2026-04-27T23-05-35Z.md`. PR #218 — https://github.com/michaelhazza/automation-v1/pull/218.
- [ ] [user] **Codify "Suppression is success" pattern under single-writer invariants — codebase-wide enforcement** — ChatGPT explicitly framed this as forward-looking standardisation across the codebase, not a change for PR #218 (reinforced again in round 2's "what I'd do next, optional, not blocking"). Single-writer event emitters that lose a coordination race must return `success: true, suppressed: true` rather than `success: false`; returning failure triggers retries, false incident signals, and broken metrics. The architecture.md one-liner at § "Home dashboard live reactivity" already names the pattern, and the system-monitoring `writeDiagnosis` enforces it. Follow-up work: (a) extract a reusable utility (e.g. `suppressedSuccess(reason)` returning `{ success: true, suppressed: true, reason }`) so single-writer emitters call one helper instead of hand-rolling the shape, (b) add a lightweight lint or grep-based guard that flags `success: false` returns in files matching the single-writer emitter pattern (or, conversely, requires `suppressed: true` whenever the emitter detects a coordination loser), (c) sweep existing single-writer emitters for the anti-pattern, (d) consider promoting to a `DEVELOPMENT_GUIDELINES.md §8` rule, (e) KNOWLEDGE.md pattern entry captured at session finalize. The lint/grep guard is what turns this from "well understood" into "impossible to violate quietly". Source: ChatGPT PR review rounds 1 & 2; session log `tasks/review-logs/chatgpt-pr-review-create-views-2026-04-27T23-05-35Z.md`. PR #218 — https://github.com/michaelhazza/automation-v1/pull/218.

### PR #182 — claude/build-paperclip-hierarchy-ymgPW (2026-04-23 — ChatGPT review rounds 2 & 3)

- [ ] [user] **Split `agent_runs` into `agent_runs_core` / `agent_runs_context` / `agent_runs_delegation`** — ChatGPT reviewer flagged that `agent_runs` is now a high-width, high-churn table (cached-context fields + delegation telemetry + execution metadata), approaching TS inference limits. We hit it once during the merge (`handoffSourceRunId` self-reference made the whole table `any`) and fixed it surgically by dropping the Drizzle-side `.references()` clause. Reviewer explicitly said "not now, but soon." Triggers for revisiting: (a) a second TS-inference wall we can't fix by dropping one FK declaration, (b) `agent_runs` column count crosses ~40, (c) we introduce a new subsystem that wants to add a fourth column group. The split itself is a weeks-of-work refactor — migration sequence, view-compatibility shim, audit of ≈40+ consumers that read across column groups, query-planner overhead on hot paths. Don't trigger pre-emptively. Source: ChatGPT review round 2 (2026-04-23); session log `tasks/review-logs/chatgpt-pr-review-claude-build-paperclip-hierarchy-ymgPW-2026-04-23T23-33-00Z.md`.
- [ ] [auto] **Designate a canonical source of truth for delegation analytics** (round 3 — future, not now). We now have two observability layers for delegation: `agent_runs` (inline telemetry columns — `delegationScope`, `delegationDirection`, `hierarchyDepth`, `handoffSourceRunId`) and `delegation_outcomes` (the event stream). They can drift under failure scenarios (outcome write fails → run still shows delegation happened, or vice versa). Trigger to resolve: before any analytics surface (admin dashboard, cost-attribution report, audit export) ships that reads delegation data, pick one as canonical and document. Recommended direction: `delegation_outcomes` is canonical for "what decisions were attempted and what was the outcome"; `agent_runs` telemetry columns are the per-run snapshot for joins, not authoritative history. Source: ChatGPT review round 3 (2026-04-23); session log `tasks/review-logs/chatgpt-pr-review-claude-build-paperclip-hierarchy-ymgPW-2026-04-23T23-33-00Z.md`.
- [ ] [auto] **Monitor cached-context cost under multi-level delegation chains** (round 3 — monitor, not act). The contract locked in round 2 says every delegated run resolves its own bundle snapshot. That's correct for isolation but means an N-deep delegation chain produces N bundle resolutions + N independent LLM cache lookups. Under deep chains with heavy context (20+ documents per run), cumulative cost could grow quadratically if chains themselves grow super-linearly. Trigger to act: (a) multi-level chains become a common production pattern, AND (b) cached-context observability shows repeated identical bundle resolutions across sibling runs. Potential fix (deferred): add the `reuseParentContext: true` opt-in on `spawn_sub_agents` as noted in `architecture.md` § Composition with cached-context infrastructure. Do not implement pre-emptively — current cost profile is the intended design. Source: ChatGPT review round 3 (2026-04-23); session log `tasks/review-logs/chatgpt-pr-review-claude-build-paperclip-hierarchy-ymgPW-2026-04-23T23-33-00Z.md`.

### paperclip-hierarchy

- [ ] **REQ #C4a-6 — Return-shape contract for delegation errors (architectural).** `spawn_sub_agents` and `reassign_task` return `{ success: false, error: <string code>, context }` but spec §4.3 mandates `{ success: false, error: { code, message, context } }`. The telemetry event payloads already use the spec-correct nested envelope; only the skill handler return values diverge. Fixing this either (a) introduces return-shape inconsistency across the ~40 other skills in `skillExecutor.ts` that return `error: string`, or (b) implies a broader migration of the string-error pattern. Architect decision needed: is the legacy string pattern grandfathered and spec §4.3 describes only new-delegation-skills-only contracts, or must all three codes adopt the nested envelope? If nested, audit `executeWithActionAudit`, LLM-facing serialisation, and agent prompt parsing for breakage. Source: spec §4.3 lines 316–322; `spec-conformance-log-paperclip-hierarchy-chunk-4a-2026-04-24T00-00-00Z.md`.

### PR #171 — claude-md-updates (2026-04-22)

- [ ] Add non-goals enforcement gate to spec-reviewer — valid improvement but requires spec-reviewer to reason about product strategy (not just structural spec quality); out of scope for this PR; revisit when spec-reviewer is next revised.

## Deferred from pr-reviewer review — Universal Brief

**Captured**: 2026-04-22
**Branch**: `claude/implement-universal-brief-qJzP8`
**Source log**: [tasks/review-logs/pr-review-log-universal-brief-2026-04-22T07-35-39Z.md](./review-logs/pr-review-log-universal-brief-2026-04-22T07-35-39Z.md)

- [ ] **B10 — maintenance jobs defense-in-depth: per-org `withOrgTx` (architectural, partial).** `server/jobs/ruleAutoDeprecateJob.ts`, `fastPathDecisionsPruneJob.ts`, and `fastPathRecalibrateJob.ts` already use `withAdminConnection({ source: ... })` + `SET LOCAL ROLE admin_role` for the org enumeration and per-org savepoints (`tx.transaction(async (subTx) => …)`). They are **no longer silent no-ops** — decay / prune / recalibrate run successfully against every org. Remaining gap: the per-org work runs under `admin_role` (which bypasses RLS) rather than dropping back into a per-org `withOrgTx({ organisationId, source })` connection that re-engages tenant-scoped policies. Upgrade is defense-in-depth, not correctness — and the canonical reference job `server/jobs/memoryDedupJob.ts` cited in the original brief also runs work directly under `admin_role` without per-subaccount `withOrgTx`, so this is a stronger pattern than the existing house style. Routed to the pre-prod-tenancy spec (Phase 3, optional) — see `docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`.
- [ ] **S2 — add skill definition .md files for `ask_clarifying_questions` and `challenge_assumptions`.** Handlers are wired in `SKILL_HANDLERS` so runtime dispatch works, but the file-based definitions pattern (`server/skills/*.md` with frontmatter) expects them. Without the .md these capabilities won't surface in the config assistant or skill studio UIs. Reference: `architecture.md` §Skill System.
- [ ] **S3 — strengthen rule-conflict parser tests.** `ruleConflictDetectorServicePure.parseConflictReportPure` drops malformed items silently via `continue`; production could let users save conflicting rules if the LLM returns malformed conflict objects. Add tests for: (a) existingRuleId not in candidatePool → dropped; (b) invalid `kind` → dropped; (c) confidence out of [0,1] → dropped.
- [ ] **S4 — remove or re-label `cheap_answer` canned replies.** `briefSimpleReplyGeneratorPure` emits `source: 'canonical'` artefacts with hardcoded placeholder rows ("See revenue data"). Users see properly-sourced-looking results that are actually stubs. Either (a) add `'canned' | 'stub'` to `BriefResultSource` and re-label, or (b) remove the cheap_answer route from the tier-1 classifier until real data resolvers land. Option (b) is simpler.
- [ ] **S6 — add trajectory tests for Phase 4 orchestrator gates.** The clarify/challenge gates are wired via masterPrompt text only (migration 0196). No runtime test pins "clarifyingEnabled=false → no `ask_clarifying_questions` tool call" or "estimatedCostCents > 20 AND sparringEnabled → `challengeOutput` on ApprovalCard". Prompt-only wiring regresses easily; a fixture under `tests/trajectories/` would catch drift.
- [x] **S8 — move conversation-message websocket emits to a post-commit boundary.** `briefConversationWriter.writeConversationMessage` emits websocket events inline after the insert. If the outer request tx rolls back after the insert but before response, clients see an "artefact appeared" event for a row that was never persisted. Options: defer emits until `res.finish`, or adopt a tx-outbox pattern. **DONE** commit `60a68d07`
- [ ] **N1 — validate `artefactId` UUID shape in `briefArtefactValidatorPure.validateBase`.** Currently `requireString` accepts `""`. Add a UUID regex.
- [ ] **N2 — add prominent comment at `getBriefArtefacts` noting the backstop is a no-op until Phase 6.4 resolvers land** (`briefArtefactBackstop.ts` sets `idScopeCheck` and `scopedTotals` to `undefined`).
- [ ] **N3 — make `conversations_unique_scope` index org-scoped.** Change to `(organisation_id, scope_type, scope_id)` so the uniqueness invariant also holds formally across orgs (UUID collision is improbable but the index semantically belongs org-scoped). Needs a new migration that drops + recreates the index.
- [ ] **N4 — document the `scopeType` ↔ parent-table mapping** on `conversations.scope_id` in the Drizzle schema so future readers know which scope maps to `subaccount_agents.id` vs `agents.id` vs `tasks.id` vs `agent_runs.id`.
- [ ] **N5 — inject clock into `ruleTeachabilityClassifierPure`.** Replace inline `new Date()` with a `now: Date` parameter to match the pure-module convention.
- [ ] **N6 — inject `artefactIdProvider: () => string` into `briefSimpleReplyGeneratorPure`.** Currently uses `crypto.randomUUID()` inline; injection makes tests deterministic.
- [x] **N7 — paginate `GET /api/briefs/:briefId/artefacts`.** Currently pulls all artefacts and flattens client-side; a long-running Brief conversation could accumulate hundreds. Add `limit`/`cursor` query params before marketing demos. **DONE** commit `04613015`

## Deferred from dual-reviewer review — Universal Brief

**Captured**: 2026-04-22
**Branch**: `claude/implement-universal-brief-qJzP8`
**Source log**: [tasks/review-logs/dual-review-log-universal-brief-2026-04-22T08-02-50Z.md](./review-logs/dual-review-log-universal-brief-2026-04-22T08-02-50Z.md)

- [ ] **DR1 — add `POST /api/rules/draft-candidates` route to wire `ApprovalSuggestionPanel` to `ruleCandidateDrafter.draftCandidates`.** The client panel posts to `/api/rules/draft-candidates` with `{ artefactId, wasApproved }` but no route exists, so every click on “Yes, suggest a rule” 404s and the panel silently dismisses. Wiring requires non-trivial server logic: scan `conversation_messages.artefacts` JSONB for the `artefactId`, verify kind === 'approval', load the parent brief for `briefContext`, look up existing related rules, then call `draftCandidates(...)`. Non-blocking because the rest of the Universal Brief flow works; only the approval→rule teach-loop is dark. Defer to the same follow-up pass as S3 (rule-conflict parser tests). Pre-existing from commit 6af10f1 — not introduced by the pr-reviewer fix pass.
- [x] **DR2 — re-invoke fast-path + Orchestrator on follow-up conversation messages (spec §7.11/§7.12).** **DONE** commit `4d64df6d` `POST /api/conversations/:conversationId/messages` and `POST /api/briefs/:briefId/messages` currently only write the user turn into `conversation_messages` and return. Per spec §7.11 ("Re-invokes the fast path + Orchestrator if the message looks like a follow-up intent rather than a passive 'thanks'"), follow-up turns should run `classifyChatIntent` on the new text and — for `needs_orchestrator` / `needs_clarification` — re-enqueue `orchestratorFromTaskJob`. Without this, chat surfaces become one-way after the initial response: the user can send questions but the system never agent-runs on them. Architectural scope — needs design for non-Brief scopes (`task`, `agent_run`) that don't currently enqueue orchestration, idempotency for passive acks, and whether simple_reply/cheap_answer can produce new inline artefacts on follow-ups. Pre-existing from commit 6af10f1 — not introduced by the pr-reviewer fix pass.
- [ ] **DR3 — wire approve/reject actions on `BriefApprovalCard` artefacts.** `BriefDetailPage.tsx` renders `<ApprovalCard />` without `onApprove`/`onReject` — the buttons render but clicks are silent no-ops. No server-side dispatch route exists either (grep for `/api/briefs/.*/approve` returns nothing). Blocks the entire write path: high-risk actions can be proposed by the Orchestrator but never approved through the primary detail surface. Architectural — needs: (1) new server route(s) to accept an approval decision and dispatch via `actionRegistry` / enqueue an orchestrator run, (2) execution record linkage so `executionId` + `executionStatus` on the artefact update, (3) client handlers that call the new route and refresh state. Pre-existing from commit 6af10f1 — not introduced by the pr-reviewer fix pass.

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

---

## Deferred from chatgpt-pr-review — PR #174 (2026-04-22)

**Captured:** 2026-04-22T10-22-29Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-create-spec-conformance-2026-04-22T10-22-29Z.md`

Strategic follow-ons surfaced by the ChatGPT PR review of the `spec-conformance` agent introduction. Out-of-scope for PR #174; captured for future consideration once the three-layer validation pattern has bedded in.

- [ ] **Spec coverage metrics** — surface % of spec requirements implemented, with a breakdown by category (files / exports / schema / contracts / behavior). Output of `spec-conformance` already enumerates every REQ and its verdict; an aggregator could roll these up across a slug's review logs to produce a coverage dashboard. Gate on: first production use where a reviewer asks "how much of the spec did this PR land?".
- [ ] **Drift detection over time** — periodic re-verification of merged features against their original specs to catch post-merge implementation drift (refactor silently changes behavior the spec named). Would require a durable mapping from spec → merged branch/PR plus a scheduled re-run. Gate on: first confirmed drift incident.
- [ ] **Automated plan validation (plan → spec mismatch detection)** — before a chunked implementation starts, verify that `tasks/builds/<slug>/plan.md`'s chunk decomposition actually covers every REQ in the spec. Would close the "plans are loosely mapped to specs" gap ChatGPT flagged. Lighter lift than drift detection — can reuse the REQ-extraction pass from `spec-conformance`. Gate on: next feature where `feature-coordinator` + `spec-conformance` are run end-to-end on a multi-chunk plan.

---

## Deferred from chatgpt-pr-review — Universal Brief (round 1)

**Captured:** 2026-04-22T11:13:14Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-universal-brief-2026-04-22T11-13-14Z.md`
**PR:** #176 — https://github.com/michaelhazza/automation-v1/pull/176

- [x] ~~CGF1 — backend lifecycle write-time enforcement.~~ **Implemented in round 3** via `validateLifecycleWriteGuardPure` + `validateLifecycleChainForWrite`, integrated in `briefConversationWriter.ts`. Scope: the "a parent can only be superseded once" invariant (duplicate-tip class) is enforced at write time; orphan parents remain an eventual-consistency case the UI resolves. 7 new tests cover the pure function (existing sibling blocks, batch-internal duplicates, idempotent rewrites, no-parent artefacts, independent chains).
- [ ] **CGF4b — extract shared `ConversationPane` component** (hook already shipped as `useConversation` in this PR — see round 2 decisions). The remaining duplication is the visual shell (message list, input, send button) which differs only in placeholder text and header copy. Low priority — revisit when a third chat pane pattern emerges. Until then, both panes share the hook so the fetch/state/send behaviour stays consistent.
- [ ] **CGF6 — idempotency key for `saveRule`.** Current `saveRule` path can duplicate rules on request retries (unique conflict detector operates on semantic overlap, not request retry). Proposed: add `idempotencyKey?: string` to `RuleCaptureRequest`, derive default from `condition + action + scope + normalised_text`, dedupe at write layer. Needs design on: (a) precise key derivation, (b) relationship with `ruleConflictDetectorServicePure` — is a retry a "conflict"? a "no-op"? a new insert?, (c) whether to enforce at DB layer with a unique partial index. Surfaced by ChatGPT round 4 — defer as focused follow-up PR, out of scope for Universal Brief v1.

---

## Deferred from dual-reviewer — cached-context-infrastructure

**Captured:** 2026-04-23T11-40-35Z
**Source log:** `tasks/review-logs/dual-review-log-cached-context-infrastructure-2026-04-23T11-40-35Z.md`
**Branch:** `claude/implementation-plan-Y622C`

Architectural findings surfaced by the Codex second-phase review on top of the PR-review fix pass. Out-of-scope for the current PR — these are pre-existing design inconsistencies in the cached-context spec, not regressions introduced by the dual-review loop.

- [ ] **`bundle_suggestion_dismissals` unique-key vs. org-scoped RLS mismatch.** The table has `organisation_id NOT NULL` plus org-scoped RLS, but the unique index is `(user_id, doc_set_hash)` — global per user, not per org. In a multi-org scenario (e.g. system_admin using `X-Organisation-Id` to jump orgs), a user who dismisses a doc set in Org A and then tries to dismiss the same set in Org B hits `ON CONFLICT (user_id, doc_set_hash)` on the Org A row. With FORCE RLS on, the DO UPDATE either fails the WITH CHECK (the Org A row's `organisation_id` does not match the Org B session var) or silently touches the Org A row only — either way the user never gets a visible Org B dismissal, and suggestBundle keeps firing under Org B. Spec §5.12 is internally inconsistent on this: line 1258 says "personal preference of the user" (implying cross-org dismissal carries), while line 1261 says "table is org-scoped via organisation_id". Resolution needs either: (a) new migration extending the unique index to `(organisation_id, user_id, doc_set_hash)` + matching conflict target in `dismissBundleSuggestion`, OR (b) drop `organisation_id` from the table + RLS to make dismissals truly cross-org per user. Either path requires a spec amendment to §5.12 to clarify the multi-org case. Low severity — only triggers for cross-org users, which in v1 is system_admin only.

---

## Deferred from chatgpt-pr-review — PR #183 (2026-04-23)

**Captured:** 2026-04-23T12:30:00Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-implementation-plan-Y622C-2026-04-23T12-30-00Z.md`
**PR:** #183 — https://github.com/michaelhazza/automation-v1/pull/183
**Branch:** `claude/implementation-plan-Y622C`

- [ ] **Subaccount isolation decision — document "Option B-lite" posture.** Migration `0213_fix_cached_context_rls.sql` intentionally dropped the subaccount-isolation RLS policies on the cached-context tables (`reference_documents`, `document_bundles`, `document_bundle_attachments`, `bundle_resolution_snapshots`, `bundle_suggestion_dismissals`) and relies on service-layer `subaccount_id` filters instead. The 0213 header comment explains the decision; the `docs/cached-context-infrastructure-spec.md` §RLS section should restate it as a first-class architectural decision (why DB-layer subaccount RLS is currently not enforced on these tables, which code path is the authority, what would trigger reinstating the policies, and how future cached-context tables should be registered). Keep the scope narrow: a short subsection in the spec, not a new doc. Chased from ChatGPT PR-review round 1 (finding #1).

---

## Deferred from spec-reviewer review — riley-observations-dev-spec (2026-04-22)

**Captured:** 2026-04-22T21-45-51Z
**Source log:** `tasks/review-logs/spec-reviewer-log-riley-observations-dev-spec-2026-04-22T21-45-51Z.md`
**Spec:** `docs/riley-observations-dev-spec.md`

AUTO-DECIDED items from the spec-reviewer iteration — directional and ambiguous findings that the agent resolved conservatively in-spec or routed here for human review. The spec's mechanical fixes have been applied in-session; these are the architecture-level questions that remain.

- [ ] **F6 / §6.3 / §12.25 — `safety_mode` vs pre-existing `run_mode` collision.** The spec's Part 3 originally tried to ADD a `run_mode` column with values `('explore', 'execute')` to the renamed `workflow_runs` table. That table already has a `run_mode` column (from migration `0086_playbook_run_mode.sql`) with four execution-style values (`auto|supervised|background|bulk`). The agent resolved mechanically by introducing a NEW column `safety_mode` to avoid overloading — preserves the architect's ability to decide the final shape. **Human to confirm:** is the split `run_mode` (execution style) / `safety_mode` (Explore/Execute) correct, OR do we want to migrate the existing `run_mode` to hold the safety enum and record execution-style on a different column? Alternative: a composite `runConfig` JSONB. Default: keep the split.
- [ ] **F10 / §6.8 / §12.13 — Portal run-mode field unnamed.** Customer-initiated Workflow runs in the portal "use agency-configured defaults." The spec does not name which `subaccount_agents` column carries that default. Architect must either (a) identify an existing column, OR (b) add a new column (recommendation: `subaccount_agents.portal_default_safety_mode text NOT NULL DEFAULT 'explore'`) to migration `0205` and inventory it in §4.8. Non-negotiable before Part 3 migration lands.
- [ ] **F11 / §6.4 / §12.22 — `side_effects` runtime storage — DB column, JSONB field, or seed-only?** Skills are DB-backed at runtime via `system_skills.definition` JSONB; the markdown files in `server/skills/*.md` are authoring seed. Three options: (a) top-level `system_skills.side_effects boolean NOT NULL DEFAULT true` column with backfill from markdown; (b) require `side_effects` inside the `definition` JSONB, validated by a parser gate; (c) keep frontmatter-only and regenerate `system_skills` from markdown at seed time. Agent recommendation: (a) — top-level column enables fast reads during gate resolution without JSONB unpacking per dispatch. Human to confirm before coding.
- [ ] **F15 / §5.4–§5.5 / §12.23 — `input_schema` / `output_schema` validator + format.** `processes.input_schema` and `output_schema` are plain `text` columns today with no canonical format. The spec's v1 validation is softened to best-effort (if parseable, validate; otherwise skip). Architect must pick: (a) validator library (ajv / zod / custom), (b) schema format (JSON Schema vs lighter), (c) whether `additionalProperties: false` is the default posture. Until resolved, `invoke_automation` input/output validation is non-authoritative.
- [ ] **F21 / §7.4 / §12.16 — Rule 3 "Check now" trigger mechanism OR Rule 3 removal.** Rule 3 in the heartbeat gate depends on a "Check now" button/API that does NOT exist in the current codebase. Two options: (a) add a new `subaccount_agents.check_now_requested_at timestamptz NULL` column + `POST /api/subaccount-agents/:id/check-now` route + admin UI button (extra scope for a "cheap observation fix"), OR (b) drop Rule 3 from v1 and ship the gate with 3 rules. Agent recommendation: (b). Human to confirm.
- [ ] **F22 / §7.6 / §12.17 — Definition of "meaningful" output for `last_meaningful_tick_at` update.** The spec resets `ticks_since_last_meaningful_run` when a run produces "meaningful" output but does not define "meaningful." Agent recommendation: `status='completed'` AND (at least one action proposed OR at least one memory block written). Architect confirms before coding, per §7.6's new prose.
- [ ] **Supervised-mode removal call-site audit (spec §6.8 + §12.14).** §6.8 decides the Supervised checkbox is removed; the spec-reviewer aligned §12.14 to treat this as an audit step rather than an open decision. Before Part 3 implementation, architect confirms every `runMode: 'supervised' | 'auto'` call site in `playbook_runs.run_mode` (which becomes `workflow_runs.run_mode`) is either migrated or deprecated cleanly. Not a decision, but a verification step that must happen.

---

## Deferred from spec-reviewer review — hierarchical-delegation-dev-spec (2026-04-22)

**Captured:** 2026-04-22T21-37-07Z
**Source log:** `tasks/review-logs/spec-review-log-hierarchical-delegation-1-2026-04-22T21-37-07Z.md`
**Spec:** `docs/hierarchical-delegation-dev-spec.md`
**Branch:** `claude/paperclip-agent-hierarchy-9VJyt`

Decisions the spec-reviewer committed autonomously during review round 1. Human review at your leisure — none of these block the spec from entering the architect pipeline.

- [ ] **AUTO-DECIDED (option b) — Upward reassign for non-root agents (§16.1).** Committed option (b): a narrow special case in `reassign_task` validator allows `target === context.hierarchy.parentId` regardless of `delegationScope`, marked `delegationDirection: 'up'`. Preserves the brief's "upward escalation allowed, logged" commitment with minimum surface area. §6.4 step 2 now encodes the check; §6.4 and §15.5 updated; §16.1 marked RESOLVED. **If you disagree:** options (a) drop it, (c) add `delegationScope: 'parent'`, (d) separate `escalate_upward` skill — any change needs §6.4 and §1 bullet 5 to be re-aligned.
- [ ] **AUTO-DECIDED (option a) — Permission key (§16.2).** Committed option (a): new permission `org.observability.view`. `org.health_audit.view` was considered and rejected to keep surfaces separable. §9.2 and §16.2 updated.
- [ ] **AUTO-DECIDED (option a) — No auto-creation of subaccount-level roots during Phase 2 migration (§16.3).** Committed option (a): operators opt in to per-subaccount CEOs by assigning a root when they want one; the `subaccountNoRoot` detector is the nudge. No auto-cloning of org-Orchestrator into every subaccount. §16.3 marked RESOLVED.
- [ ] **AUTO-DECIDED (option a) — Pure function (not recursive CTE) for descendants-scope subtree computation (§16.4).** Committed option (a): reuses `hierarchyContextBuilderService`'s downward walk over the active roster. §6.2 updated to remove "recursive CTE" language. §16.4 marked RESOLVED.
- [ ] **Permission-set seed file location (§14.1).** Spec lists the location as TBD by the implementer. The permission *key* lives in `server/lib/permissions.ts` (new `ORG_OBSERVABILITY_VIEW` export). The seed that grants it to `org_admin` needs its home pinned at implementation start — likely also `server/lib/permissions.ts` in the existing `ORG_ADMIN_PERMISSIONS` block, or wherever permission-set seeding currently lives. Resolve before Phase 1 coding starts.

## Deferred from spec-conformance review — paperclip-hierarchy-chunk-3b (2026-04-23)

**Captured:** 2026-04-23T00-00-00Z
**Source log:** `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-chunk-3b-2026-04-23T00-00-00Z.md`
**Spec:** `tasks/builds/paperclip-hierarchy/plan.md` § Chunk 3b
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`

All four items below form a single coherent finding: **behavioral tests for `executeConfigListAgents` are missing.** Only the pure helpers (`computeDescendantIds`, `mapSubaccountAgentIdsToAgentIds`) are tested. The handler-level adaptive/override/warn/fallthrough behaviour has no runtime assertion.

Classified DIRECTIONAL rather than MECHANICAL because adding these tests requires a design choice between (a) extracting a new pure helper `resolveEffectiveScope({ rawScope, hierarchy })` and unit-testing it, (b) introducing a new behavioral-test harness with mocks for `agentService` / `db` / `logger` in a file that currently follows `runtime_tests: pure_function_only`, or (c) accepting the current pure-only coverage. The spec does not name the approach.

- [ ] REQ #3 — Test: adaptive default with children → `children`.
  - Spec section: `plan.md` line 508.
  - Gap: No test exercises the adaptive-default-with-children branch of `executeConfigListAgents`.
  - Suggested approach: Extract adaptive logic into a pure helper in `configSkillHandlersPure.ts` and unit-test, or add a behavioral integration test with mocks.
- [ ] REQ #4 — Test: adaptive default without children → `subaccount`.
  - Spec section: `plan.md` line 508.
  - Gap: No test exercises the adaptive-default-without-children branch.
  - Suggested approach: Same as REQ #3.
- [ ] REQ #5 — Test: explicit scope overrides adaptive.
  - Spec section: `plan.md` line 508.
  - Gap: No test asserts that an explicit `scope: 'subaccount'` on an agent with children returns the full roster.
  - Suggested approach: Same as REQ #3.
- [ ] REQ #6 — Test: missing-hierarchy fallthrough + WARN log assertion.
  - Spec section: `plan.md` line 508.
  - Gap: No test asserts the `hierarchy_missing_read_skill_fallthrough` WARN fires when `context.hierarchy` is undefined, nor that the handler falls through to unfiltered behaviour.
  - Suggested approach: Needs a logger mock plus either a behavioral test or a pure helper that returns `{ effectiveScope, shouldWarn }` for pure assertion.

## Deferred from spec-conformance review — paperclip-hierarchy-chunk-4a (2026-04-23)

**Captured:** 2026-04-23T00:00:00Z
**Source log:** `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-chunk-4a-2026-04-24T00-00-00Z.md`
**Spec:** `docs/hierarchical-delegation-dev-spec.md` (§4.3, §6.3, §6.4, §12.2) + `tasks/builds/paperclip-hierarchy/plan.md` (Chunk 4a, lines 567–625)

- [ ] REQ #C4a-1 — `spawn_sub_agents` test: `effectiveScope === 'subaccount'` path rejects with `cross_subtree_not_permitted`.
  - Spec section: `plan.md` line 573; spec §6.3 step 2.
  - Gap: The pure-helper test file `skillExecutor.spawnSubAgents.test.ts` only exercises `classifySpawnTargets` + `resolveWriteSkillScope`. The subaccount-scope rejection lives in the outer `executeSpawnSubAgents` handler and has no coverage.
  - Suggested approach: Either extract the subaccount-gate branch into a pure helper (e.g. `evaluateSpawnPolicy({ effectiveScope, ... })`) and unit-test it, or add a behavioral integration test with DB + logger mocks. Pure-helper extraction is consistent with the existing `skillExecutorDelegationPure.ts` shape.

- [ ] REQ #C4a-2 — `spawn_sub_agents` test: `context.handoffDepth >= MAX_HANDOFF_DEPTH` rejects with `max_handoff_depth_exceeded`.
  - Spec section: `plan.md` line 573; spec §6.3 step 4.
  - Gap: No test asserts depth-limit enforcement in the full spawn handler. The spec §12.2 / Chunk 4a plan explicitly names this case.
  - Suggested approach: Same as REQ #C4a-1 — behavioural integration test, or pull the depth-gate into a pure helper alongside `classifySpawnTargets`.

- [ ] REQ #C4a-3 — `spawn_sub_agents` test: `context.hierarchy` undefined → `hierarchy_context_missing`.
  - Spec section: `plan.md` line 573; spec §4.3 "producer" bullet.
  - Gap: The pure test file does not cover the hierarchy-missing branch of the full handler.
  - Suggested approach: Behavioural test with a minimal `context` fixture (no `hierarchy` field). Assert both (a) the returned `{ success: false, error: 'hierarchy_context_missing', ... }` shape, and (b) that `insertExecutionEventSafe` is invoked with the `tool.error` envelope.

- [ ] REQ #C4a-4 — `spawn_sub_agents` test: adaptive default for a leaf caller resolves to `subaccount` and therefore the entire spawn is rejected.
  - Spec section: `plan.md` line 573.
  - Gap: `resolveWriteSkillScope` is tested in isolation and returns `subaccount` for a childless caller, but no test chains that into the spawn handler's rejection path (end-to-end "no children → subaccount → reject").
  - Suggested approach: Behavioural integration test combining `resolveWriteSkillScope` + the subaccount-gate rejection.

- [ ] REQ #C4a-5 — `reassign_task` test: `context.hierarchy` undefined → `hierarchy_context_missing`.
  - Spec section: `plan.md` line 574; spec §4.3.
  - Gap: The pure-helper test file does not cover the hierarchy-missing branch of `executeReassignTask`.
  - Suggested approach: Behavioural test — same pattern as REQ #C4a-3.

- [ ] REQ #C4a-6 — Return-shape contract: skill handlers return `{ success: false, error: <string code>, context }` but spec §4.3 mandates `{ success: false, error: { code, message, context } }`.
  - Spec section: spec §4.3 "Uniform contract" (lines 316–322 of the spec); applies to all three new codes (`hierarchy_context_missing`, `cross_subtree_not_permitted`, `delegation_out_of_scope`) in both handlers.
  - Gap: Current return value has `error` as a flat string and `context` hoisted to the top level. The telemetry event writes (`insertExecutionEventSafe` payloads) use the spec-correct nested envelope, so the split is return-value-only.
  - Suggested approach: This is a contract change. Legacy `skillExecutor` skills throughout the file return `error: string`, so moving delegation errors to a nested envelope either (a) introduces inconsistency across skills, or (b) implies a broader migration. Decide with architect whether the legacy string pattern is grandfathered and spec §4.3 describes the new-delegation-skills-only envelope, or whether the return shape should be changed and downstream consumers (agent prompts, action-audit wrapper `executeWithActionAudit`, any LLM-facing serialization) must be audited for breakage.

## Deferred from spec-conformance review — paperclip-hierarchy-chunk-4b (2026-04-24)

**Captured:** 2026-04-24T00:00:00Z
**Source log:** `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-chunk-4b-2026-04-24T00-00-00Z.md`
**Spec:** `tasks/builds/paperclip-hierarchy/plan.md` (Chunk 4b, lines 627–661) + `docs/hierarchical-delegation-dev-spec.md` (§6.5, §12.2)

- [x] REQ #C4b-1 — Pure test file `skillService.resolver.test.ts` does not cover the "WARN logged" assertion called out in the plan's Files-New bullet.
  - Spec section: `plan.md` line 632 ("`context.hierarchy` undefined → no derived skills, WARN logged"); acceptance criterion line 661 ("logs WARN `hierarchy_missing_at_resolver_time` once").
  - Gap: The pure test file only covers the "returns `[]`" half of the plan's undefined-hierarchy case. WARN emission lives inside the impure `resolveSkillsForAgent`; the test file explicitly notes (lines 7–10) that this case was deferred to integration-level coverage because it requires a logger mock plus DB scaffolding. No such integration test exists yet in this chunk.
  - Suggested approach: Either (a) mock the `logger` module and assert WARN in a thin integration test against `resolveSkillsForAgent` (will need to stub the `skills` table query or use an empty `skillSlugs` input so the DB path short-circuits on line 127's early return), or (b) refactor the WARN decision into a pure helper returning `{ derivedSlugs, warn: boolean, reason }` so the pure test can assert the boolean alongside the slug output. Option (b) is the cleaner pure-helper shape and keeps `skillServicePure.ts` authoritative for Chunk 4b's logic.
  - Closed 2026-04-24 (commit `8c68d8a9`): option (b) taken — `shouldWarnMissingHierarchy({ hierarchy, subaccountId })` extracted into `skillServicePure.ts`; `resolveSkillsForAgent` calls it; three new pure tests assert the full decision table (undefined/undefined, undefined/provided, present/provided). Re-verified by `spec-conformance` re-run — see `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-chunk-4b-recheck-2026-04-24T01-00-00Z.md`.

## Deferred from spec-conformance review — paperclip-hierarchy-chunk-4c (2026-04-24)

**Captured:** 2026-04-23T22:05:43Z
**Source log:** `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-chunk-4c-2026-04-24T22-05-43Z.md`
**Spec:** `tasks/builds/paperclip-hierarchy/plan.md` (Chunk 4c, lines 663–699) + `docs/hierarchical-delegation-dev-spec.md` §7.2, §8.2

- [ ] REQ #C4c-10 — Direction colour/style is applied to a text badge beside each node name, not to the edge connecting parent and child.
  - Spec section: `plan.md` line 671 ("Direction-colour: `'down'` green solid, `'up'` amber dashed, `'lateral'` amber dotted (spec §8.2)"); dev-spec §8.2 ("Arrow colour / icon coding by `delegationDirection`").
  - Gap: `DelegationGraphView.tsx` renders edges as a plain text label (`→ spawn` / `⇢ handoff`) between nodes with no colour or stroke styling, and puts the direction colour / style (`down` green solid, `up` amber dashed, `lateral` amber dotted) on a small node-adjacent badge (`DirectionBadge` at lines 51–66). Spec §8.2 places direction coding on the arrow itself. Functionally the information is available; visually the hierarchy is wrong.
  - Suggested approach: Either (a) render proper SVG arrows (or CSS-drawn connector lines) between parent and child and move the direction styling onto the connector, or (b) treat the node-badge as the canonical direction carrier and amend spec §8.2 to match the simplified rendering decision. Option (b) is cheaper and consistent with the "inline state beats dashboards" principle in `CLAUDE.md` § Frontend Design Principles; the spec edit would narrowly document that direction lives on the node, not the edge.

- [ ] REQ #C4c-11 — Clicking a node navigates via React Router to a new URL, which remounts `RunTraceViewerPage`; the active tab resets to `trace` and the user loses the Delegation Graph view.
  - Spec section: `plan.md` line 671 ("Click node → navigate to that run's trace tab (in-place)"); dev-spec §8.2 ("Click a node → navigate to that run's trace tab (in-place, preserves the graph selection)").
  - Gap: `DelegationGraphView.tsx:194–203` calls `navigate(...)` to a different URL. `RunTraceViewerPage.tsx:60` initialises `activeTab` to `'trace'` on every mount, so the graph tab selection is not preserved. The spec's phrase "preserves the graph selection" implies the graph tab should remain active (or at minimum the graph's collapse state should survive).
  - Suggested approach: Lift `activeTab` into the URL query string (`?tab=delegation-graph`) so a re-mount preserves it, or alternatively swap the runId in-place without triggering a full `RunTraceViewerPage` re-mount (pass `runId` as a prop + update it via `setActiveRunId` only, no `navigate`). The second approach matches "in-place" more literally. Either path is a small UI change, not a contract change.

- [ ] REQ #C4c-12 — Initial collapse state auto-expands the root AND its depth-1 direct children; spec says only the root should be expanded.
  - Spec section: `plan.md` line 671 ("Root expanded by default; descendants collapsed").
  - Gap: `DelegationGraphView.tsx:90` initialises `collapsed` with `useState(depth > 1)` — depth 0 (root) AND depth 1 (direct children) start expanded; only depth 2+ starts collapsed.
  - Suggested approach: Change the initial state to `useState(depth > 0)` so only the root is expanded by default. One-line fix; holding as directional because the UX author may have made this choice deliberately for first-landing legibility.

- [ ] REQ #C4c-15 — Plan's "third tab ... Existing tabs (Trace, Payload) unchanged" language contradicts the pre-chunk state of `RunTraceViewerPage.tsx`, which had no tabs at all. Implementation introduced a two-tab surface (Trace + Delegation Graph).
  - Spec section: `plan.md` line 675.
  - Gap: Spec presumes a two-tab baseline (Trace + Payload) that did not exist in `main`. Implementation decided to add exactly two tabs (Trace + Delegation Graph). Labelled the first "Trace" (title-case matches spec); labelled the second "Delegation Graph" (title-case — spec says "Delegation graph", lowercase `g`). This is a spec-vs-reality contradiction, not an implementation defect.
  - Suggested approach: Human call required. Three options: (a) accept the two-tab surface as final and edit the plan to remove the ghost "Payload" tab reference; (b) introduce a genuine "Payload" tab that renders some run-payload view (would need its own spec — the plan does not define Payload tab contents); (c) amend the plan to make the third-tab phrasing a typo and confirm two tabs is the shape. Recommend (a) or (c).

## Deferred from spec-conformance review — paperclip-hierarchy (2026-04-23)

**Captured:** 2026-04-23T23:05:56Z
**Source log:** `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-2026-04-23T23-05-56Z.md`
**Spec:** `docs/hierarchical-delegation-dev-spec.md` (whole-branch pass — all four phases)
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`

- [x] **REQ #WB-1 — INV-1.2 `agent_runs.handoff_source_run_id` is never written; handoff edges cannot render in the delegation graph (architectural).** **DONE (2026-04-29 verification):** shipped under pre-launch-hardening Phase 2 (commit `f2696a53`). `AgentRunRequest.handoffSourceRunId?: string` added at `agentExecutionService.ts:183`; INSERT propagation at `agentExecutionService.ts:407`; `agent-handoff-run` worker dual-writes both pointers at `agentScheduleService.ts:127-128`; `skill_executor.ts:2934, 3677` propagate `context.runId` per spec §10.6. Pure tests green: `agentExecutionServiceWb1Pure.test.ts` (4/4) + `delegationGraphServicePure.test.ts` (11/11 incl. handoff-edge + dual-pointer cases). Re-attempting via the `pre-prod-workflow-and-delegation` brief on 2026-04-29 confirmed everything is built; brief closed as no-op. The spec's run-id continuity invariant (§10.6 clause 2) requires every handoff-created `agent_runs` row to carry `handoffSourceRunId = context.runId` of the `reassign_task` call. The column exists on the Drizzle schema (`agentRuns.ts:211`) and is read by `delegationGraphServicePure.ts:72` to produce handoff edges, but no write site populates it: `AgentRunRequest` has no `handoffSourceRunId` field, `agentExecutionService`'s `agent_runs` INSERT (lines ~395–412) does not set it, and the handoff worker at `agentScheduleService.ts:127` routes `sourceRunId → parentRunId` instead. Consequences: (1) handoff edges are invisible in the `/api/agent-runs/:id/delegation-graph` response (spawn edges still render because `parentRunId + isSubAgent` gate); (2) INV-1.3 "both pointers when both caused it" is unreachable; (3) INV-1.4 "`delegation_outcomes.runId === child.handoffSourceRunId` for handoffs" is structurally broken. Because `parentRunId` is currently reused for handoff chains by pre-existing code (the trace-session logic at `agentExecutionService.ts:1226-1232` and `agentActivityService.getRunChain` read `parentRunId` for handoff chains), the fix is cross-cutting — it requires a design call (keep `parentRunId` for handoff runs alongside the new `handoffSourceRunId`, or clear it and migrate downstream chain logic to the new column). Deferring as architectural. Suggested approach: (a) add `handoffSourceRunId?: string` to `AgentRunRequest`; (b) propagate it into the `agent_runs` INSERT in `agentExecutionService.executeRun`; (c) extend the `agent-handoff-run` worker payload and pass it through; (d) decide whether `parentRunId` is ALSO set (backward-compat) or null for handoff runs, and update pure graph emission + run-chain consumers accordingly. Source: `docs/hierarchical-delegation-dev-spec.md` §5.3 + §7.2 + §10.6; log `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-2026-04-23T23-05-56Z.md`.

## Deferred from spec-conformance review — riley-observations wave 1 (2026-04-24)

**Captured:** 2026-04-24T05:37:51Z
**Source log:** `tasks/review-logs/spec-conformance-log-riley-observations-wave1-2026-04-24T05-37-51Z.md`
**Spec:** `docs/riley-observations-dev-spec.md` (Wave 1 only — §4 + §5)
**Branch:** `claude/start-riley-architect-pipeline-7ElHp`

- [ ] **REQ W1-6 — §4.6 column renames on automations table not applied (directional).** Spec §4.6 names three column renames on the renamed automations table: `workflow_engine_id → automation_engine_id`, `parent_process_id → parent_automation_id`, `system_process_id → system_automation_id`. Migration `0220_rename_processes_to_automations.sql` performs none of them (no `RENAME COLUMN` statements). Drizzle schema `server/db/schema/automations.ts` still declares `workflowEngineId`, `parentProcessId`, `systemProcessId` (lines 15, 38, 40) matching the legacy SQL columns. Plan `plan-w1-naming-and-composition.md` §4.2 omits these renames silently. 59 call sites across 15 files (`automationService.ts`, routes, `invokeAutomationStepService.ts`, workspace-health detectors, tests) reference the old identifiers. Fix requires a migration ALTER TABLE + Drizzle schema update + cross-file service/route/test updates. Classified directional because it touches dispatcher semantics and several unrelated subsystems — not a surgical spec-named gap. Suggested approach: add ALTER TABLE RENAME COLUMN statements to migration 0220 (with matching _down reversal), update schema, grep+replace call sites, re-run test suite. Source: §4.6 column-rename table; log `tasks/review-logs/spec-conformance-log-riley-observations-wave1-2026-04-24T05-37-51Z.md`.
- [ ] **REQ W1-29 — `*.playbook.ts` file extension convention not renamed to `*.workflow.ts` (directional).** Spec §4.8 "File-extension convention" mandates `*.playbook.ts → *.workflow.ts` and implies the `server/playbooks/` directory rename. Current state: `server/playbooks/event-creation.playbook.ts`, `intelligence-briefing.playbook.ts`, `weekly-digest.playbook.ts` retain the old suffix and the directory is still called `server/playbooks/`. Plan `plan-w1-naming-and-composition.md` §4.3 does not list this rename. Defer — touches file paths referenced from the seeder (`server/scripts/seedWorkflows.ts`), import resolution, and dependent build scripts. Suggested approach: rename directory + files in one commit with matching import-path updates across all consumers. Source: §4.8 file-extension convention table.
- [ ] **REQ W1-43 — Dispatcher §5.10a rule 4 defence-in-depth not implemented (directional).** Spec §5.10a rule 4 requires the step dispatcher to reject any `invoke_automation` resolution that would produce more than one outbound webhook (e.g. a mutated `automations` row embedding a list of webhook targets). The comment at `server/services/invokeAutomationStepService.ts:165–166` references rule 4 but no resolution-validation occurs. `automations` row fields (`webhookPath` single text column) enforce one-webhook by schema today, so the attack surface is limited to hand-mutated / migrated rows. Defer because implementing this requires a design call on what "multi-webhook resolution" looks like in practice (schema extension? plugin system? post-lookup audit?). Suggested approach: add a pure-function assertion inside `resolveDispatch` that verifies the automation row conforms to the single-webhook contract (one non-empty `webhookPath`, no alternative fields set) and emits `automation_composition_invalid` with `status: 'automation_composition_invalid'` at dispatch if violated. Source: `docs/riley-observations-dev-spec.md` §5.10a rule 4.
- [ ] **REQ W1-44 — Pre-dispatch connection resolution not implemented (directional).** Spec §5.8 requires the dispatcher to resolve each automation's `required_connections` field for the subaccount context before firing the webhook; any unresolved required connection must fail with `error_code: 'automation_missing_connection'`. The column `automations.requiredConnections` exists (`server/db/schema/automations.ts:34`) and `automation_connection_mappings` table holds the per-subaccount mappings, but `invokeAutomationStepService.ts` does not inspect either — the webhook fires without verifying credential availability. This is a missing feature, not a cosmetic gap. Defer because implementation requires the subaccount-connection-resolver pipeline (similar to what the existing `automationService.ts` legacy execute path does) to be refactored for the Workflow-call path. Suggested approach: (a) extract a pure function `resolveRequiredConnections(automation, subaccountId) → { ok } | { missing: string[] }` using the existing `automation_connection_mappings` query; (b) inject it into `invokeAutomationStep` service, call before fetch; (c) emit `automation_missing_connection` with `status: 'missing_connection'` on failure; (d) unit-test the resolver path. Source: §5.8 credential resolution and scoping.
- [ ] **REQ W1-52/53 — WorkflowsLibraryPage and AutomationsPage not simplified to Mock 08/09 posture (directional).** Spec §3a.2 lock 8 + Mocks 08/09 require libraries as single tables ≤ 4 columns with no KPI tiles, no filter chips, no per-row step-count chips, one primary CTA. Current state: `client/src/pages/WorkflowsLibraryPage.tsx` is the pre-rename `PlaybooksLibraryPage` shell — still a template-list + run-start modal rather than a simplified Mock-08 table. `client/src/pages/AutomationsPage.tsx` is a newly-created page but does not clearly match Mock 09's columns (name / tool / readiness). Defer because simplifying these pages is a product/UX decision that touches interaction patterns (start-run flow, template selection), not a mechanical rename. Suggested approach: post-rename, schedule a dedicated UI simplification pass per Mock 08/09 that rebuilds the page shell, cutting the multi-step run-start modal into a single-table-plus-primary-CTA layout. Tests: Puppeteer smoke for primary-action click path. Source: `docs/riley-observations-dev-spec.md` §3a.2 lock 8; mockups at `prototypes/riley-observations/08-workflows-library.html` + `09-automations-library.html`.
- [ ] **REQ W1-38 engine-not-found — dispatcher emits `automation_execution_error`, not in §5.7 vocabulary (ambiguous).** `invokeAutomationStepService.ts:95` (engine-not-found branch) emits `code: 'automation_execution_error'` with `type: 'execution'`. `automation_execution_error` is NOT a member of the §5.7 error-code vocabulary. Spec §5.10 edge 3 says "Automation engine offline — reuse whatever degraded-mode posture the existing process-execution path has; audit during architect pass". The existing path's code is what the rename carried forward, and the spec punts on a canonical code. Defer. Suggested approach: pick one of (a) introduce `automation_engine_unavailable` as a new §5.7 code (requires spec edit); (b) re-use `automation_not_found` semantics (engine-less automation is effectively non-dispatchable); (c) re-use `automation_missing_connection` (engine is a kind of connection). Route to `spec-reviewer` for the spec edit. Source: §5.10 edge 3 + §5.7 error-code vocabulary.

## PR Review deferred items / riley-observations

**Captured:** 2026-04-24 from pr-reviewer blocking finding #9
**Source log:** tasks/review-logs/pr-review-log-riley-observations-2026-04-24T06-20-00Z.md

- [ ] **Migration 0219 — rename `review_audit_records.workflow_run_id` column** (#9): The column on `review_audit_records` references `flow_runs` (post-M1) but is still named `workflow_run_id`. This is misleading post-M3 when a new `workflow_runs` table also exists. Add `ALTER TABLE review_audit_records RENAME COLUMN workflow_run_id TO flow_run_id` to migration 0219 and update `server/db/schema/reviewAuditRecords.ts` + the down migration. This is a schema change requiring a new migration if 0219 is already applied to any environment.

## Deferred from dual-reviewer review — riley-observations (2026-04-24)

**Captured:** 2026-04-24 from dual-reviewer iteration 2
**Source log:** tasks/review-logs/dual-review-log-riley-observations-2026-04-24T08-00-00Z.md

- [x] **Review-gated `invoke_automation` steps never dispatch after approval** (Codex iter 2 finding #4). **DONE (2026-04-29 verification):** spec'd at `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md` §1.3, shipped via `28f7b371 feat(approval): extract resolveApprovalDispatchAction pure helper + tests (§1.3)` + `47777472 feat(pre-launch-hardening): Phase 6 — wire dead paths DR1/DR2/DR3/C4a-REVIEWED-DISP`. Resolution: option (b) — `resolveApprovalDispatchAction` pure helper at `server/services/resolveApprovalDispatchActionPure.ts` decides; `decideApproval` at `workflowRunService.ts:577-584` routes invoke_automation through `WorkflowEngineService.resumeInvokeAutomationStep` (dedicated resume path at `workflowEngineService.ts:1749`). Audit-trail decision: mutate-existing row (UPDATE awaiting_approval → running, same `flow_step_run` id). Pure tests green: `decideApprovalStepTypePure.test.ts` (9/9) + `resumeInvokeAutomationStepPure.test.ts` (10/10). Integration harness exists at `workflowEngineApprovalResumeDispatch.integration.test.ts` (3 cases incl. HMAC + sign-call boundary spy + concurrent double-approve) — note: end-to-end run is currently blocked by env.ts Zod enum not allowing `NODE_ENV='integration'`, separate bug worth filing. Re-attempting via `pre-prod-workflow-and-delegation` brief on 2026-04-29 confirmed everything is built; brief closed as no-op.

- [x] **Inline-dispatch step handlers do not re-check invalidation after awaiting external I/O** (Codex iter 3 finding #7). **DONE (2026-04-29 verification):** shipped under pre-launch-hardening Phase 5 (`35112d09 feat(hardening): Phase 5 — execution-path correctness`). `withInvalidationGuard` helper at `workflowEngineService.ts:128-139` re-reads the step row after external I/O and returns `{ discarded: true, reason: 'invalidated' }` if status flipped. Wrapped around every external-I/O dispatch site: action_call (line 1386), agent-step queue dispatch covering agent_call/prompt (line 1555), invoke_automation primary (line 1609), approval-resume path (line 1808). Each call site short-circuits on `'discarded' in guardedResult` before reaching `completeStepRunInternal`. Pure tests green: `invalidationRacePure.test.ts` (5/5: still-running / invalidated / completed-non-invalidated / failed / discarded-sentinel-distinct). Re-attempting via `pre-prod-workflow-and-delegation` brief on 2026-04-29 confirmed everything is built; brief closed as no-op.



## Deferred from chatgpt-pr-review — riley-observations (2026-04-24 round 2)

**Captured:** 2026-04-24 from ChatGPT PR-review round 2
**Source log:** tasks/review-logs/chatgpt-pr-review-riley-observations-2026-04-24T10-25-11Z.md

- [ ] **Server-side enforcement of non-idempotent retry contract** (R2-5 finding). UI surface in `EventRow.tsx` now guards retry on non-idempotent automations via `ConfirmDialog`, but the actual "Retry step" endpoint isn't built yet — the button just calls a callback prop. When that endpoint is built, the design must include: (1) server-side guard so a programmatic POST to the retry endpoint can't bypass the UI confirm — `attempt > 1 OR retried_via_user_action` flag should respect the existing `shouldBlock_nonIdempotentGuard` logic; (2) audit log entry for every retry attempt capturing actor + idempotent-flag-at-time-of-retry + whether `force: true` was set; (3) optional `force: true` query param the UI sets after the user has confirmed the dialog, so the server can grant exactly one bypass per confirmation. The endpoint design should also document whether retry creates a new `flow_step_run` row (recommended — keeps the audit trail clean) or mutates the existing one. This is non-blocking for the current PR because the retry button doesn't yet have a backend; it's a design constraint for whoever builds that endpoint.

- [ ] **Wire fallback warn codes into a counter metric when client metrics infra lands** (R3-1 finding from chatgpt-pr-review round 3 on PR #186). The `eventRowPure.ts` warn sink emits stable codes (`event_row.legacy_skill_slug_detection`, `event_row.legacy_provider_regex`) on every fallback hit, but right now there's no client-side metrics infrastructure to aggregate them — `grep -rn "metrics\.increment" client/src/` returns zero results. Once a client metrics system lands (statsd, OTel client SDK, or a custom `lib/metrics.ts`), increment a counter at the same callsite as the warn so dashboards can show fallback rate over time per emitter. This is the missing observability piece that lets us close out Phase 4 of the migration endgame documented in `eventRowPure.ts`. Without a counter, "warn rate is zero for ≥30 days" requires manual log inspection rather than a dashboard query.

---

## Deferred from spec-reviewer review — clientpulse-ui-simplification-spec

**Captured:** 2026-04-24T01:54:01Z
**Source log:** `tasks/review-logs/spec-review-log-clientpulse-ui-simplification-spec-1-2026-04-24T01-54-01Z.md`
**Spec:** `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`

- [ ] **Defer 24h button for pending-approval cards.** Spec initially specified Approve / Reject / Defer 24h on both the home-dashboard pending cards and the drilldown PendingHero. AUTO-DECIDED during review to DROP Defer 24h from v1 because the backend has no defer state (no column, no endpoint, no resume semantics) and adding one is a scope expansion beyond "UI simplification". Deferred to §11 of the spec. Re-open if an operator explicitly asks for a "snooze this decision for a day" flow.
- [ ] **CRM Queries workspace card on the home dashboard.** Spec initially placed it as 1 of 4 cards in a 2×2 grid pointing at `/crm`. AUTO-DECIDED during review to DROP for v1 because `/crm` is not a real route in the codebase. Re-open §2.3 to add the card (and graduate the grid back to 2×2) when the `/crm` route lands with a real landing page.
- [ ] **Agents workspace card on the home dashboard.** Spec initially placed it as 1 of 4 cards pointing at `/agents`. AUTO-DECIDED during review to DROP for v1 because `/agents` currently redirects to `/`. Re-open §2.3 when `/agents` has a real landing page.

---

## Deferred from chatgpt-pr-review — PR #185 (bugfixes-april26)

**Captured:** 2026-04-24T12:18:53Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-bugfixes-april26-2026-04-24T11-55-28Z.md`
**PR:** #185 — https://github.com/michaelhazza/michaelhazza/automation-v1/pull/185

- [ ] **[user] Resume response contract as tagged union with UI branching.** `POST /api/system/skill-analyser/jobs/:id/resume` currently returns the job object on success and throws 409 on conflict; the UI shows the extracted error message as a toast. ChatGPT round-1 finding 3 suggested a richer contract: return `{ status: 'resumed' | 'already_running' | 'rejected', job?, reason? }` so the UI can branch per outcome (e.g. "Already running — tailing" vs "Cannot resume — <reason>") instead of relying on error-message extraction. Scope: server route in `server/routes/skillAnalyzerSystem.ts` + `resumeJob` service response type in `server/services/skillAnalyzerService.ts` + mirror type in client `SkillAnalyzerWizard.tsx` / `mergeTypes.ts` + `SkillAnalyzerProcessingStep.tsx` branching + tests. User-facing architectural change — defer to a dedicated PR, not appropriate for the current bug-fix batch. Current behaviour is correct, just less explicit than it could be.
- [ ] **[user] Extract `SkillAnalyzerProcessingStep` polling lifecycle to a state machine or custom hook.** ChatGPT round-2 finding 4 (reviewer observation, explicitly "do nothing now"): the component is dense — `pollVersion`, `initialJob` vs `currentJob`, `lastProgressAt`, multiple terminal-state guards, stalled-UI threshold, resume button lifecycle, retry/pause/redirect branches. Stability-first shape is correct for the current bug-fix round; a clean extraction (e.g. `useAnalyzerJobLifecycle(jobId, initialJob)` returning a discriminated-union state or an xstate machine) is a meaningful refactor with non-trivial blast radius. Flagged for a future polish / DX pass, not for this PR. Complements the round-1 finding 3 deferral (which also scopes `SkillAnalyzerProcessingStep` branching) — both should likely land together.

## Deferred — Blueprint/template "Browse library" modal integration

**Captured**: 2026-04-24  
**Branch**: `feat/clientpulse-ui-simplification`

### Task 5.6 — Table column trims + "Browse shared library" demotion

The header-level "Browse Shared Library" buttons have been removed from both pages as part of the ClientPulse UI simplification (Task 5.6):
- `SubaccountBlueprintsPage.tsx`: removed button from header; empty-state version preserved
- `SystemOrganisationTemplatesPage.tsx`: removed button from header; empty-state version preserved

Full "Browse library" modal UX integration deferred to a follow-up task:
- [ ] **SubaccountBlueprintsPage**: merge "Browse Shared Library" into "+ New Template" modal as first step (tabbed choice: "Create from scratch" vs "Browse library")
- [ ] **SystemOrganisationTemplatesPage**: same pattern — integrate "Browse library" into the import flow

**Why deferred**: Maintains simplification goal (remove header clutter) while preserving discovery (empty-state button remains). Modal integration requires UX/interaction design for the tabbed flow, which is out of scope for the column-trim task.

---

## Deferred from spec-conformance review — clientpulse-ui-simplification (2026-04-24)

**Captured:** 2026-04-24T06:55:22Z
**Source log:** `tasks/review-logs/spec-conformance-log-clientpulse-ui-simplification-2026-04-24T06-55-22Z.md`
**Spec:** `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`

- [x] REQ 42 — `pulseService` `review:<id>` resolves to `/clientpulse/clients/:subaccountId`, not `/admin/subaccounts/:id/pulse` as stated in §2.2 table
  - Spec section: §2.2 Backend resolution rules table
  - Gap: spec resolver table still points at `/admin/subaccounts/<subaccountId>/pulse`, which §7.1 retires (now redirects to `/`). Implementation correctly resolves directly to the drilldown. Spec table is internally inconsistent.
  - Suggested approach: patch §2.2 resolver table row for `review:<id>` to `/clientpulse/clients/<subaccountId>` (matches retirement + tests + §11 deferred note); no code change needed.

- [x] REQ 43 — `PendingHero` `onReject` prop signature includes a `comment` parameter that is not in the spec contract
  - Spec section: §6.2.1 Component contract
  - Gap: spec signature is `(reviewItemId: string) => Promise<void>`; implementation is `(reviewItemId: string, comment: string) => Promise<void>`. Backend requires a non-empty comment (`COMMENT_REQUIRED`). The omission in the spec caused a prior `reject(id,'')` bug during build.
  - Suggested approach: patch §6.2.1 contract to add `comment: string` to the `onReject` signature; no code change needed.

- [x] REQ 44 — `?intent` destination contract is not implemented on the `task` and `failed_run` destination pages (deferred in §11)
  - Spec section: §2.2 `?intent` destination-page contract + G16 ship gate
  - Gap: only `ClientPulseDrilldownPage` reads `?intent`. `WorkspaceBoardPage` (`task:`) and `AgentRunLivePage` (`failed_run:`) do not. For those kinds, clicking Approve/Reject on a pending card will navigate without auto-opening an approval UI, violating G16's "at most one additional click" guarantee. §11 Deferred Items does not cover this.
  - Suggested approach: decide per kind — either (a) add intent detection to both destination pages (architectural change, touches 2 files + potentially their modal/UI state mgmt) OR (b) extend §11 Deferred Items with a named entry for `task` and `failed_run` intent contract. Escalate the choice to the user; pick one direction before PR.

- [x] REQ 45 — Layout.tsx breadcrumb default label reads "Pulse" when breadcrumbs list is empty
  - Spec section: §7.1 router retirement (implicit — retired surface's label leaked forward)
  - Gap: `client/src/components/Layout.tsx:867` renders `<span …>Pulse</span>` when `breadcrumbs.length === 0`. With home dashboard now at `/`, the home page shows a stale "Pulse" breadcrumb. Low-urgency UX inconsistency; not spec-enumerated but flows from §7.1 intent.
  - Suggested approach: change default label to "Home" (or omit the fallback span entirely and only render the breadcrumb bar when breadcrumbs exist). One-line edit.

- [ ] REQ 46 — §7.1 router transition manual QA checks not yet verified
  - Spec section: §7.1 Router transition guarantees table
  - Gap: spec requires five runtime checks (static grep ✓; browser back from approval; deep-link redirect; subaccount-scoped redirect; no React error boundary on redirect paths). Only the static grep has been confirmed. The remaining four require a manual browser pass.
  - Suggested approach: run the four runtime checks in a browser against the build output; record results in `tasks/builds/clientpulse-ui-simplification/progress.md` under a new "G6 manual QA" heading. Does not block PR creation if runtime smoke checks pass, but should complete before merge.

## Deferred from pr-reviewer review — clientpulse-ui-simplification (2026-04-24)

**Captured:** 2026-04-24T07:55:00Z
**Source log:** `tasks/review-logs/pr-review-log-clientpulse-ui-simplification-2026-04-24T07-55-00Z.md`
**Branch:** `feat/clientpulse-ui-simplification`

Strong Recommendations and Non-Blocking observations from PR review. Blocking findings (B1-B3) and S1 already addressed in commit `b1b16b72`.

- [ ] S2 — `PULSE_CURSOR_SECRET` fallback warning fires on every `/api/clientpulse/high-risk` request when unset
  - File: `server/services/clientPulseHighRiskService.ts` lines 162-169
  - Fix: one-shot process-level warning (module-init check + cached flag) or startup assertion in production

- [x] S3 — DashboardPage + ClientPulseDashboardPage error states are silent **DONE** commit `6ef1ea79`
  - Files: `client/src/pages/DashboardPage.tsx` lines 34-46; `client/src/pages/ClientPulseDashboardPage.tsx` lines 57-71
  - Every fetch swallows errors with console.error and returns null; user sees zero-state identical to real empty. Track hasError per source; surface inline retry banner

- [ ] S4 — DashboardPage telemetry fires before navigation, even if user backs out
  - File: `client/src/pages/DashboardPage.tsx` lines 62-65
  - Rename events to `pending_card_approve_clicked` / `_reject_clicked` OR move fire site into actual approve/reject success handler

- [ ] S5 — UnifiedActivityFeed receives unused `orgId` prop
  - File: `client/src/components/UnifiedActivityFeed.tsx` line 229
  - Remove prop from `UnifiedActivityFeedProps` (line 52) and caller in `DashboardPage.tsx` line 229

- [ ] S6 — No test coverage for idempotent approve/reject backend race path
  - File: `server/services/reviewService.ts` lines 83-183 / 274-395
  - Add integration tests for `idempotent_race` branch; spec §6.2.1 GWTs are not exercised

- [ ] S7 — ClientPulseDashboardPage socket merge validation missing
  - File: `client/src/pages/ClientPulseDashboardPage.tsx` lines 74-79
  - Validate keys against HealthSummary's known set before merging; only toast when at least one relevant field changed

- [ ] N1 — DashboardPage greeting hour computed once at render (stale past midnight/noon/17:00)
- [ ] N2 — `formatLastAction` produces "create_task · 0d ago" for today — awkward copy
- [ ] N3 — NeedsAttentionRow shows `↑0 / 7d` when delta is 0 — noisy
- [ ] N4 — PendingApprovalCard renders three disabled buttons when `isDisabled` — could split into empty-state variant
- [ ] N5 — WorkspaceFeatureCard CTA arrow always rendered even for minimal summary
- [ ] N6 — `resolvePulseDetailUrl.ts` WARN on every call (intentional; noise only if server regresses)
- [ ] N7 — `clientPulseHighRiskService.getPrioritisedClients` has 6 sequential DB round-trips; could parallelise with Promise.all after subIds known
- [ ] N8 — `resolvePulseDetailUrl` (client) and `pulseService._resolveUrlForItem` (server) have slightly different prefix shapes (`run` vs `failed_run`, `health` vs `health_finding`) — could share a single constant

## Deferred from chatgpt-pr-review — PR #187 clientpulse-ui-simplification (2026-04-24)

**Captured:** 2026-04-24T13:20:00Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-clientpulse-ui-simplification-2026-04-24T12-01-27Z.md`
**PR:** #187 — https://github.com/michaelhazza/automation-v1/pull/187
**Branch:** `feat/clientpulse-ui-simplification`

Low-severity polish items from Round 1 that are genuine observations but out-of-scope for this PR. Rounds 2 and 3 produced zero additional backlog items (all findings were either validation-only observations confirmed safe, or false positives). Item overlapping PR-review N6 (fallback WARN sampling) not duplicated here.

- [ ] [auto] **usePendingIntervention factory recreated per call** — `client/src/hooks/usePendingIntervention.ts`. Micro-refactor candidate: hoist the action factory or stabilise with `useMemo`. Current behaviour is safe (no referential-stability consequence for consumers — `approve`/`reject` are stable via `useCallback([isPending])` with `optionsRef` capture). No measurable impact; defer until a concrete need surfaces.
- [ ] [auto] **PendingHero error + conflict messaging can stack** — `client/src/components/clientpulse/drilldown/PendingHero.tsx`. Speculative; no specific scenario or reproduction. Revisit if users report confusing double-banners on simultaneous error + conflict.
- [ ] [auto] **NeedsAttentionRow fixed-width columns may truncate on small screens** — `client/src/components/clientpulse/NeedsAttentionRow.tsx`. Responsive-design pass — combine with a broader client-screen audit rather than spot-fix.
- [ ] [auto] **Telemetry is `console.debug` only; no structured sink** — pre-existing architectural gap (PostHog / internal collector integration). Not introduced by this PR. Platform-level decision — pair with the observability-primitive work referenced in PR-review N6 (fallback WARN sampling) so both land together.

## Deferred from chatgpt-pr-review — PR #188 (2026-04-25)

**Captured:** 2026-04-25T07:45:00Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-claude-system-monitoring-agent-PXNGy-2026-04-24T21-39-06Z.md`
**PR:** #188 — https://github.com/michaelhazza/automation-v1/pull/188
**Branch:** `claude/system-monitoring-agent-PXNGy`

Medium-leverage improvements deferred from ChatGPT round 1. All are valid observations but out-of-scope for the Phase 0/0.5 foundation — they belong in Phase 0.75 or Phase 1. User approved defer on all six. Finding #3 (process-local counter naming + warn log) implemented in-session; findings #4, #6, #7 rejected with rationale in the session log decision matrix.

- [ ] **#1 — Idempotency guard at `recordIncident` ingestion boundary.** `recordIncident` can be called multiple times for the same failure path; DB upsert + fingerprint dedupe stop duplicate incident rows, but event log (occurrence) duplicates and notify logic may double-trigger on edge cases. Proposed: add `idempotencyKey?: string` to `IncidentInput`, store last-seen key in event payload or short-term cache, skip on repeat. Needs design on key derivation (caller-supplied vs derived) and whether the dedupe window should be per-fingerprint or global.
- [ ] **#2 — Severity escalation policy beyond `max(existing, incoming)`.** Current escalation is monotonic-max only — no frequency-based or time-based escalation. Proposed Phase 0.5-lightweight rule: if `occurrenceCount >= 10 && severity === 'medium'` → `'high'`; `>= 100` → `'critical'`. Alternatives: sliding-window frequency escalation, SLA-aware aging. Needs a small design doc before implementation — thresholds are product decisions, not technical ones.
- [ ] **#5 — Per-fingerprint ingestion throttle (backpressure).** Tight-loop failures could generate thousands of `recordIncident` calls/sec; even with DB dedupe, the event log grows rapidly and the DB still takes the hit. Proposed: simple in-memory `lastSeen[fingerprint] < 1s ago → skip` guard at the top of `recordIncident`. Low effort, but deferred because Phase 0/0.5 has no tight-loop failure scenarios in the system-monitor surface — revisit once agent/skill ingestion traffic is observed.
- [ ] **#8 — Incident-lifecycle SLA/aging signals.** No time-to-ack, time-to-resolve, or stale-incident detection today. Needed for operator workflow beyond triage-only — compute these as derived columns/materialised view or on-read aggregation. Product-priority decision; pair with ops dashboard planning, not an isolated improvement.
- [ ] **#9 — Incident correlation clusters.** Group related incidents via `correlation_id` + `affected_resource_*` into logical clusters so operators see "one underlying cause" instead of N fingerprints. Requires a correlation-computation pass (batch job or on-write) and a cluster-summary surface in the admin UI. Phase 1 scope — out of scope for Phase 0/0.5.
- [ ] **#10 — `/api/system/incidents/badge-count` caching.** Badge-count query scans active incidents on every poll; becomes expensive at scale. Proposed: short-TTL cache (Redis or in-memory with revocation on write) or materialised-count table updated in the ingest path. Low priority until badge-count query shows up in slow-query logs.
- [ ] **#R3.1 — Service-layer `assertSystemAdminContext(ctx)` defence-in-depth on RLS-bypass tables.** Architectural decision deferred to Phase 2 system-principal work (cross-cutting principal context model). Per-service assertions diverge from existing `withPrincipalContext` / route-layer `requireSystemAdmin`. From ChatGPT PR-review round 3.
- [ ] **#R3.3 — Badge endpoint dual-count shape `{ criticalCount, totalActionableCount }`.** Speculative, no concrete UX requirement yet. Non-breaking-additive shape change available later when a real dual-count UX surfaces. From ChatGPT PR-review round 3.

## Deferred from codebase audit — 2026-04-25

**Captured:** 2026-04-25T00:00:00Z
**Source log:** `tasks/review-logs/codebase-audit-log-full-codebase-2026-04-25T00-00-00Z.md`
**Branch:** `audit/full-codebase-2026-04-25`
**Mode:** Full (Layer 1 Areas 1–9 + Layer 2 Modules I, J, K, L, M, A, B, E)
**Totals:** 11 critical / 8 high / 16 medium / 10 low = 47 findings. 0 auto-applied in pass 2.

Findings are grouped by remediation phase per the 2026-04-25 remediation plan.

---

### Phase 1 — Multi-Tenancy & RLS Hardening (Critical)

- [x] **P3-C5 — Phantom RLS session var `app.current_organisation_id`** in migrations 0205, 0206, 0207, 0208. critical/high. RLS policies reference a var that is never set by `withOrgTx` — policies silently fail-open. Fix: new corrective migration replacing all occurrences with `current_setting('app.organisation_id', true)` per migration 0213 pattern. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. DB state was repaired at runtime by `migrations/0213_fix_cached_context_rls.sql` and an idempotent audit-trail re-sweep was applied by `migrations/0228_phantom_var_sweep.sql`. The historical 0205–0208 files are deliberately not edited per the repo's append-only migration convention.
- [x] **P3-C1 — Missing `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` on `memory_review_queue`** (migration 0139). critical/high. Fix: new patch migration `ALTER TABLE memory_review_queue ENABLE ROW LEVEL SECURITY; ALTER TABLE memory_review_queue FORCE ROW LEVEL SECURITY;` + `CREATE POLICY` keyed on `app.organisation_id`. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. Fixed by `migrations/0227_rls_hardening_corrective.sql` lines 22–39 (ENABLE+FORCE+canonical org-isolation policy).
- [x] **P3-C2 — Missing `FORCE ROW LEVEL SECURITY` on `drop_zone_upload_audit`** (migration 0141). critical/high. Fix: new patch migration `ALTER TABLE drop_zone_upload_audit FORCE ROW LEVEL SECURITY`. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. Fixed by `migrations/0227_rls_hardening_corrective.sql` lines 41–59.
- [x] **P3-C3 — Missing `FORCE ROW LEVEL SECURITY` on `onboarding_bundle_configs`** (migration 0142). critical/high. Fix: new patch migration `ALTER TABLE onboarding_bundle_configs FORCE ROW LEVEL SECURITY`. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. Fixed by `migrations/0227_rls_hardening_corrective.sql` lines 61–79.
- [x] **P3-C4 — Missing `FORCE ROW LEVEL SECURITY` on `trust_calibration_state`** (migration 0147). critical/high. Fix: new patch migration `ALTER TABLE trust_calibration_state FORCE ROW LEVEL SECURITY`. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. Fixed by `migrations/0227_rls_hardening_corrective.sql` lines 81–99.
- [x] **P3-C6 — Direct `db` import in `server/routes/memoryReviewQueue.ts`** — bypasses RLS middleware. critical/high. Also missing `resolveSubaccount` call on `:subaccountId` param. Fix: move all DB access to `server/services/memoryReviewQueueService.ts`; add `resolveSubaccount(req.params.subaccountId, req.orgId!)`. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. Route now imports `memoryReviewQueueService` (no `db` import) and calls `resolveSubaccount(subaccountId, orgId)` on the subaccount-scoped path.
- [x] **P3-C7 — Direct `db` import in `server/routes/systemAutomations.ts`** — bypasses RLS middleware. critical/high. Fix: move DB access to service layer. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. Route now imports only `systemAutomationService` (no `db` / `drizzle-orm` imports).
- [x] **P3-C8 — Direct `db` import in `server/routes/subaccountAgents.ts`** — bypasses RLS middleware. critical/high. Fix: move DB access to service layer. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. Route now uses `subaccountAgentService`, `agentBeliefService`, `agentScheduleService`, `agentExecutionService` and carries 9 `resolveSubaccount(req.params.subaccountId, req.orgId!)` call sites.
- [x] **P3-C9 — Missing `resolveSubaccount` in `server/routes/clarifications.ts`** on `:subaccountId` param. critical/high. Fix: add `resolveSubaccount(req.params.subaccountId, req.orgId!)`. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. Route now uses `clarificationService` and calls `resolveSubaccount(subaccountId, orgId)`.
- [x] **P3-C10 — Missing `organisationId` filter in `server/services/documentBundleService.ts:679,685`** — queries `agents` and `tasks` tables by `id` only. critical/high. Fix: add `eq(table.organisationId, organisationId)` to both WHERE clauses. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. `verifySubjectExists` now uses `getOrgScopedDb(...)` and applies `eq(table.organisationId, organisationId)` on every branch (agent / task / scheduled_task).
- [x] **P3-C11 — Missing `organisationId` filter in `server/services/skillStudioService.ts:168,309`** — queries `skills` table by `id` only. critical/high. Fix: add `eq(skills.organisationId, organisationId)` to both WHERE clauses. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring (originally resolved 2026-04-25; see `## Deferred from spec-conformance review — audit-remediation (2026-04-25)` REQ #11/#12 entry below). Lines 168, 309, and 318 all carry the org filter; both `getSkillStudioContext` and `saveSkillVersion` throw when `orgId` is missing for non-system scopes.
- [x] **P3-H2 — Direct `db` import in `server/lib/briefVisibility.ts`** — bypasses RLS middleware. high/high. Fix: refactor to call `withOrgTx` or delegate to service layer. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. The lib file is now a thin re-export from `server/services/briefVisibilityService` (no `db` imports remain in `server/lib/briefVisibility.ts`).
- [x] **P3-H3 — Direct `db` import in `server/lib/workflow/onboardingStateHelpers.ts`** — bypasses RLS middleware. high/high. Fix: refactor to call `withOrgTx` or delegate to service layer. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. The lib file is now a thin re-export from `server/services/onboardingStateService` (no `db` imports remain).

---

### Phase 2 — Gate Compliance (High)

- [ ] **P3-H4 — `server/lib/playbook/actionCallAllowlist.ts` does not exist** but is expected by `verify-action-call-allowlist.sh`. high/high. Fix: create file at expected path or update gate path; confirm with domain owner.
- [ ] **P3-H5 — `measureInterventionOutcomeJob.ts:213-218` queries `canonicalAccounts` outside `canonicalDataService`**. high/high. Fix: move query into `canonicalDataService.getCanonicalAccounts()` or equivalent.
- [ ] **P3-H6 — `server/services/referenceDocumentService.ts:7` imports directly from `providers/anthropicAdapter`** — bypasses `llmRouter`. high/high. Fix: use `llmRouter.routeCall()` or expose token-count via router; no adapter imports from services.
- [ ] **P3-H7 — 5+ files import `canonicalDataService` without `PrincipalContext` / `fromOrgId` migration shim**: `actionRegistry.ts`, `intelligenceSkillExecutor.ts`, `connectorPollingService.ts`, `canonicalQueryRegistry.ts`, `ghlWebhook.ts`. high/medium. Fix: add `PrincipalContext` parameter or apply `fromOrgId()` shim per gate remediation notes.
- [x] **P3-H8 — 5 actions in `actionRegistry` missing `readPath` field** — `verify-skill-read-paths.sh` fails (94 literal entries vs 99 with readPath). high/high. Fix: add `readPath` tag to each of the 5 missing entries; re-run gate. Resolved in D3 — root cause was 5 crm.* dot-namespaced entries whose readPath fields were counted but whose actionType lines don't match the gate's `'[a-z_]+'` pattern; calibration constant updated from 2 to 7 with full per-occurrence comment listing; gate now exits 0.
- [ ] **P3-M15 — `canonical_flow_definitions` + `canonical_row_subaccount_scopes` missing from canonical dictionary registry**. medium/high. Fix: add both table entries to registry.
- [ ] **P3-M13 — `verify-input-validation.sh` WARNING** — some routes may lack Zod validation. medium/medium. Fix: manual scan of routes added in last 3 PRs; add Zod schemas where missing.
- [ ] **P3-M14 — `verify-permission-scope.sh` WARNING** — some permission checks incomplete. medium/medium. Fix: manual scan; add missing `requireOrgMember` / RBAC checks.

---

### Phase 3 — Architectural Integrity

- [ ] **P3-H1 — Root server circular dependency: `server/db/schema/agentRunSnapshots.ts` imports `AgentRunCheckpoint` from `../../services/middleware/types.js`**. high/high. This single schema-imports-service violation drives all 175 server circular dependency cycles. Fix: extract `AgentRunCheckpoint` to `shared/types/agentExecution.ts` or `server/db/schema/types.ts`; remove import from schema file.
- [ ] **P3-M7 — Client circular deps: `ProposeInterventionModal.tsx` ↔ sub-editors** (`CreateTaskEditor`, `EmailAuthoringEditor`, `FireAutomationEditor`, `OperatorAlertEditor`, `SendSmsEditor`) — 10 cycles. medium/medium. Fix: extract shared interfaces to `types.ts` in the `clientpulse/` directory.
- [ ] **P3-L8 — Client circular deps: `SkillAnalyzerWizard.tsx` ↔ step components** — 4 cycles. low/low. Fix: extract step interfaces to `types.ts` in wizard directory.

---

### Phase 4 — System Consistency

- [ ] **P3-M10 — Skill visibility drift**: `smart_skip_from_website` and `weekly_digest_gather` have visibility `internal`, expected `basic`. medium/high. Fix: run `npx tsx scripts/apply-skill-visibility.ts`; re-run `skills:verify-visibility`.
- [ ] **P3-M11 — 5 workflow skills missing YAML frontmatter**: `workflow_estimate_cost`, `workflow_propose_save`, `workflow_read_existing`, `workflow_simulate`, `workflow_validate`. medium/high. Fix: add YAML frontmatter block to each skill markdown file.
- [ ] **P3-M12 — `scripts/verify-integration-reference.mjs` crashes** with `ERR_MODULE_NOT_FOUND: 'yaml'`. medium/high. Fix: `npm install --save-dev yaml`; re-run gate to confirm pass.
- [ ] **P3-L1 — Missing explicit `package.json` deps**: `express-rate-limit`, `zod-to-json-schema`, `docx`, `mammoth` — currently hoisted from transitive deps. low/high. Fix: add as direct `package.json` dependencies.
- [ ] **P3-M16 — `docs/capabilities.md:1001` — "Anthropic-scale distribution" in customer-facing Non-goals section**. medium/high. Editorial rule violation (CLAUDE.md rule 1). Fix: human edit required — replace with "hyperscaler-scale distribution" or "provider-marketplace-scale distribution". Never auto-rewrite capabilities.md.

---

### Phase 5 — Controlled Improvements

- [ ] **P3-M1 — `server/lib/testRunRateLimit.ts` in-memory rate limiter** — not safe for multi-process deployments; `TODO(PROD-RATE-LIMIT)` comment in file. medium/high. Fix: replace with DB-backed or Redis-backed sliding window; affects `routes/public/formSubmission.ts` and `pageTracking.ts`.
- [ ] **P3-M2 — `verify-no-silent-failures.sh` WARNING** — at least one silent catch path detected. medium/medium. Fix: re-run gate with `--verbose`; add structured log or rethrow to each flagged site.
- [ ] **P3-M3 — 7 `as any` suppressions in `server/services/cachedContextOrchestrator.ts`** on `resolveResult.assemblyResult`, `bundleSnapshotIds`, `knownBundleSnapshotIds`. medium/low. Fix: derive correct discriminated union types when next touching this file.
- [ ] **P3-M4 — `as any` on Drizzle query results in `server/services/executionBudgetResolver.ts:71-72`**. medium/medium. Fix: replace with `InferSelectModel<typeof table>` types.
- [ ] **P3-M5 — `(boss as any).work(` in `server/services/dlqMonitorService.ts:28`** — pg-boss API not fully typed. medium/medium. Fix: check pg-boss type stubs; if `work` is missing, file upstream issue and add a typed wrapper.
- [ ] **P3-M6 — `toolCallsLog` column marked DEPRECATED in `server/db/schema/agentRunSnapshots.ts`** — Sprint 3B removal pending. medium/low. Fix: confirm Sprint 3B timeline; write removal migration.
- [ ] **P3-M8 — Agent handoff depth ≤ 5 not verified by code or named test**. medium/low. Fix: trace depth check in `server/services/agentRunHandoffService.ts`; add trajectory test.
- [ ] **P3-M9 — Degraded fallback (missing active lead) not covered by named test**. medium/low. Fix: add trajectory test for missing-lead fallback in `server/services/agentRunHandoffService.ts`.
- [ ] **P3-L2 — `server/routes/ghl.ts` Module C GHL OAuth stubs** — intentional deferred feature work. low/high. Track: feature implementation sprint.
- [ ] **P3-L3 — `server/services/staleRunCleanupService.ts:21` dual threshold** (`LEGACY_STALE_THRESHOLD_MS`) for pre-migration `agent_runs`. low/low. Fix: confirm whether rows with `lastActivityAt IS NULL` exist in production; remove legacy branch if safe.
- [ ] **P3-L4 — `actionRegistry.ts` stub comments** at lines 1342, 1428, 1577 (Support Agent, Ads Management Agent, Email Outreach Agent). low/high. Fix: convert stub labels to tracked tasks; gate or remove stub actions until implemented.
- [ ] **P3-L5 — `EventRow.tsx` exports `SetupConnectionRequest`** — possible shared-type duplication. low/low. Fix: trace all consumers before moving; verify no circular import.
- [ ] **P3-L6 — `ScheduleCalendar.tsx` exports `ScheduleCalendarResponse` locally**. low/low. Fix: consider moving to `shared/types/` if consumed by server.
- [ ] **P3-L7 — `bundleUtilizationJob.ts:125` — `utilizationByModelFamily as any`** type mismatch. low/medium. Fix: derive correct type from source.
- [ ] **P3-L9 — Test runs (`is_test_run = true`) cost-exclusion from ledger not verified by named test**. low/medium. Fix: add unit test asserting `is_test_run=true` runs are excluded from cost ledger in `queueService.ts` / `runCostBreaker.ts`.
- [ ] **P3-L10 — Prompt prefix caching (`stablePrefix`) not verified across all run types**. low/low. Fix: add to observability backlog; verify in live trace.

---

## Deferred from spec-conformance review — audit-remediation (2026-04-25)

**Captured:** 2026-04-25T11:00:13Z
**Source log:** `tasks/review-logs/spec-conformance-log-audit-remediation-2026-04-25T11-00-13Z.md`
**Spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`

- [x] **REQ #11 / #12 — `skillStudioService.ts` conditional org filter (§4.3).** RESOLVED in-branch (2026-04-25 main session). Both `getSkillStudioContext` and `saveSkillVersion` now throw if `orgId` is missing for non-system scopes, and apply the `and(eq(skills.organisationId, orgId))` filter unconditionally. System-scope paths take the existing `if (scope === 'system')` branch which never used the org filter and is unchanged.

- [ ] **REQ #35 — `verify-input-validation.sh` (44) and `verify-permission-scope.sh` (13) warnings (§5.7).** The two warning-level gates report violations. Spec §5.7 says "best-effort triage", not a Phase 2 ship blocker. However, spec §5.7 step 3 states "new regressions introduced by Phase 2 work itself MUST be resolved before merge"; no `main`-state baseline was captured pre-Chunk-2 to confirm whether the Chunk 2 PR introduced any of these warnings.
  - Spec section: §5.7, §5.8
  - Gap: cannot prove Phase 2 ship-gate compliance for the "no new regressions" sub-clause without a baseline.
  - Suggested approach: stash the working tree, check out `main`, run both warning gates, capture the counts; restore the working tree and diff. If counts are unchanged or lower, append baseline numbers to spec §5.7 / progress.md; if Phase 2 introduced any new warnings, fix them per spec §5.7 step 3 before considering Chunk 2 finalized.

- [ ] **REQ #43 — Server `madge --circular` count is 43, spec §6.3 DoD target is ≤ 5.** The schema-leaf root fix in `agentRunSnapshots.ts` worked — no cycles touch that file anymore. The 43 remaining cycles are unrelated pre-existing chains: (a) `services/skillExecutor.ts` <-> `tools/capabilities/*`, `tools/config/*`, `tools/internal/*`, `tools/readDataSource.ts`; (b) `services/agentExecutionService.ts` <-> `services/middleware/index.ts` chains; (c) `services/agentService.ts` <-> `services/llmService.ts` <-> `services/queueService.ts` <-> `jobs/proposeClientPulseInterventionsJob.ts` <-> `services/clientPulseInterventionContextService.ts` <-> `services/reviewService.ts` <-> `services/workflowActionCallExecutor.ts`. Spec §3.5 captured 175 cycles on `main` SHA `f8c8396` — the audit's 175 figure may have been inflated by counting derived edges of the now-fixed schema-leaf cascade; the true pre-existing count was likely closer to 43.
  - Spec section: §6.3, §13.3
  - Gap: Chunk 3's DoD checkbox `npx madge --circular --extensions ts server/ | wc -l ≤ 5` cannot be met without a Phase 5A-scope follow-up.
  - Suggested approach: (1) confirm against an isolated `main`-state run whether the 175 figure was real or an over-count (the gap cannot be diagnosed without that comparison); (2) if the 43-cycle base is genuinely pre-existing, update spec §6.3 / §13.3 / §13.5A so the DoD ≤ 5 target moves to Phase 5A and Phase 3's actual target reflects "schema-leaf cascade resolved" only; (3) if Chunk 3 is meant to drive ≤ 5 in absolute terms, extend Chunk 3 with an additional cycle-cluster fix (the `skillExecutor` <-> tools cluster is the largest). Operator picks the framing.

---

## Deferred from pr-reviewer review — audit-remediation (2026-04-25)

**Captured:** 2026-04-25T12:21:49Z
**Source log:** `tasks/review-logs/pr-reviewer-log-audit-remediation-2026-04-25T12-21-49Z.md`
**Spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`

### Resolved in-branch (no follow-up required)
- [x] **B-1 / B-2 / B-3 — Migration 0227 over-scope (`reference_documents` + `reference_document_versions`).** RESOLVED: removed both blocks from `migrations/0227_rls_hardening_corrective.sql`; added a header note explaining 0202/0203 hardening belongs in a follow-on migration with a parent-EXISTS policy variant.
- [x] **S-1 — `rollbackSkillVersion` signature footgun.** RESOLVED: tightened `scope` parameter type to `'system'` only (matches the only caller).
- [x] **S-3 — `automationConnectionMappingService.listMappings` / `cloneAutomation` defensive `organisationId` filter.** RESOLVED: added `eq(automationConnectionMappings.organisationId, organisationId)` to all three `listMappings`/`replaceMappings` queries (including the post-replace return SELECT and the delete WHERE); changed `cloneAutomation` source SELECT to filter by `(scope = 'system' OR organisationId = caller-orgId)` directly in the WHERE clause; updated route caller to pass `req.orgId!`.

### Routed to follow-on phases
- [ ] **S-2 — Principal-context propagation is import-only across 4 of 5 files.** `actionRegistry.ts`, `connectorPollingService.ts`, `canonicalQueryRegistry.ts`, `webhooks/ghlWebhook.ts` import `fromOrgId` to satisfy the gate but never call it. Spec §5.4 prescribes per-call-site `fromOrgId(...)` invocations at every `canonicalDataService` call. The mismatch likely needs the canonicalDataService signatures to accept `PrincipalContext` first (upstream change). `intelligenceSkillExecutor.ts` is import-presence-only per spec line 919 and is correct.
  - Spec section: §5.4
  - Gap: implementation does not reach defence-in-depth at the per-call boundary.
  - Suggested approach: (a) extend Phase 5 with a `canonicalDataService` signature migration to accept `PrincipalContext`, then thread `fromOrgId(...)` calls at all five call sites; OR (b) update spec §5.4 to acknowledge that the propagation work is import-presence-only across all five files in this phase and route the actual propagation to a later phase. Document the choice in the next PR description.

- [ ] **S-4 — Server cycle count 43 vs spec DoD ≤ 5.** Same item as the existing REQ #43 above; cross-reference only. Operator decision required on framing (re-scope DoD vs extend Chunk 3 vs accept residual to Phase 5A).

- [ ] **S-5 — Pure unit test for `saveSkillVersion` orgId-required throw contract.** Add `server/services/__tests__/skillStudioServicePure.test.ts` (or extend an existing pure test) covering: (1) `saveSkillVersion(id, 'org', null, …)` throws with message `saveSkillVersion: orgId is required for scope=org`; (2) same for `'subaccount'`; (3) `saveSkillVersion(id, 'system', null, …)` happy-path executes. Compatible with `runtime_tests: pure_function_only` posture — no DB required.

- [ ] **N-1 — `briefVisibilityService` and `onboardingStateService` use `db` direct, not `getOrgScopedDb`.** Pre-existing inconsistency; the new services lock in the older pattern. Future audit will surface; not a Phase 1 ship blocker.
- [ ] **N-2 — `measureInterventionOutcomeJob.resolveAccountIdForSubaccount` fetches all org accounts then `.find()`s.** Add a targeted `findAccountBySubaccountId(orgId, subaccountId)` to `canonicalDataService` if cost shows up. Phase 5+.
- [ ] **N-3 — `actionRegistry.ts:2-4` comment is aspirational.** Tighten to reflect that the file does not actually call `canonicalDataService` today; the import is gate-presence-only.
- [ ] **N-4 — Migration 0227 header says "8 tables".** Now correct after B-3 fix removed the 2 over-scope blocks. Verify on next pass.
- [ ] **N-5 — `configDocuments` route's in-memory `parsedCache` is per-process (multi-process bug class).** Pre-existing; flagged for Phase 5A `rateLimitStoreService` runbook to clean up alongside §8.1's rate-limiter durability work — same defect class (key-value with TTL, per-process state).

---

## C3 follow-up: add canonicalTable metadata to canonicalQueryRegistry; upgrade C3 drift test to three-set comparison

**Captured:** 2026-04-26
**Source:** C3 implementation — `canonicalQueryRegistry.ts` lacks a `canonicalTable` field on its entries (keys are semantic action identifiers like `contacts.inactive_over_days`, not table names). Per spec §C3 forced-decision rule, the test ships as a two-set comparison until the metadata field is added.

**Owner:** next developer adding a new `canonical_*` table OR authoring Phase-5A spec (whichever fires first).
**Trigger:** Phase-5A spec authoring OR any new `canonical_*` table addition.
**Back-link:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` §C3

**Work required:**
- [ ] Add a `canonicalTable: string` metadata field to each entry in `server/services/crmQueryPlanner/executors/canonicalQueryRegistryMeta.ts` (or wherever the meta is defined).
- [ ] Upgrade `server/services/__tests__/canonicalRegistryDriftPure.test.ts` to extract the `queryPlannerTables` set from the registry metadata and assert `queryPlannerTables ⊆ dictionaryTables`.
- [ ] Update the test's header comment to reflect three-set comparison.

**Phase-5A spec coupling (per spec §C3):** The Phase-5A spec, when authored, MUST include a checklist item in its own §1 (or equivalent scope section) reading exactly:
- [ ] C3 follow-up: upgrade canonicalRegistryDrift test from 2-set to 3-set comparison
  - Source: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §C3

---

## Deferred from spec-conformance review — audit-remediation-followups (2026-04-26)

**Captured:** 2026-04-26T05:34:10Z
**Source log:** `tasks/review-logs/spec-conformance-log-audit-remediation-followups-2026-04-26T05-34-10Z.md`
**Spec:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md`

- [ ] **SC-2026-04-26-1** — A2 schema-vs-registry gate fails on current main (`exit 1`, 64 violations: 60 unregistered tenant tables + 4 stale registry entries).
  - Spec section: §A2 Acceptance criteria — *"`bash scripts/verify-rls-protected-tables.sh` exits 0 on the current main"*.
  - Gap: `server/config/rlsProtectedTables.ts` covers 74 tables but `migrations/*.sql` declares ~134 tables with `organisation_id`. The 60-table delta is mostly real tenant-scoped tables that should either be registered (with a matching `CREATE POLICY` in their migration) or added to `scripts/rls-not-applicable-allowlist.txt` with a one-line rationale. The 4 stale entries (`document_bundle_members`, `reference_document_versions`, `task_activities`, `task_deliverables`) scope via parent FK and have no direct `organisation_id` column — registry should drop these or the diff logic should be taught to recognise FK-scoping.
  - Suggested approach: the cheapest path is a triage pass — for each of the 60 unregistered tables, `grep -l "<table>" migrations/*.sql` to find the migration, check whether it carries a `CREATE POLICY` block. If yes → add to `rlsProtectedTables.ts`. If no but the table is genuinely tenant-private → write the policy migration AND add the entry. If no and the table is a system/audit/cross-tenant ledger → add to `rls-not-applicable-allowlist.txt` with rationale. The 4 stale entries can be removed mechanically once you confirm their FK-scoping vs `organisation_id` from their schema files.
  - Back-link: `tasks/review-logs/spec-conformance-log-audit-remediation-followups-2026-04-26T05-34-10Z.md` REQ #15.

- [x] **SC-2026-04-26-2** — H1 helper `server/lib/derivedDataMissingLog.ts` has no unit tests. **CLOSED 2026-04-26** — added `server/lib/__tests__/derivedDataMissingLog.test.ts` with 6 cases (first-call WARN, repeat-DEBUG, multi-orgId / multi-field / multi-service distinct keys, `_resetWarnedKeysForTesting` boundary). Spies `logger.warn` / `logger.debug` directly via `node:test` `mock.method` so the test does not depend on `LOG_LEVEL` (which the logger captures at module-import time and would silently filter the DEBUG path).
  - Spec section: §H1 Approach step 3 ("Add unit tests asserting the 'upstream not populated yet' path returns null without throwing") + Approach step 5 ("Tests in step 3 cover both the first-occurrence emit AND the rate-limited-skip / debug-downgrade behaviour, so the contract is exercised").
  - Gap: H1's chosen Pattern B (first-occurrence WARN, subsequent DEBUG via in-memory `Set<string>`) is implemented but uncovered. Progress.md notes 0 refactors were needed at consumer sites, so no per-service `derivedDataNullSafety.test.ts` files were authored — but the helper itself still needs a test. The `_resetWarnedKeysForTesting()` export at line 60 was added FOR tests, yet no test file uses it.
  - Suggested approach: add `server/lib/__tests__/derivedDataMissingLog.test.ts` with three `node:test` cases — (1) first call for `(svc, field, orgId)` triple emits at WARN (mock `logger.warn`), (2) repeat call for the same triple emits at DEBUG (mock `logger.debug`), (3) `_resetWarnedKeysForTesting()` clears the set and the next call WARNs again. Use the existing `node:test` + `node:assert` harness; pattern matches `server/services/__tests__/skillStudioServicePure.test.ts`.
  - Back-link: `tasks/review-logs/spec-conformance-log-audit-remediation-followups-2026-04-26T05-34-10Z.md` REQ #59g.

- [x] **SC-2026-04-26-3** — H1 gate self-test fixture cannot fail. **CLOSED 2026-04-26** — `scripts/verify-derived-data-null-safety.sh` now accepts a `DERIVED_DATA_NULL_SAFETY_SCAN_DIR` env-var override; `scripts/__tests__/derived-data-null-safety/run-fixture-self-test.sh` runs the gate against the fixture dir and asserts a violation is reported on `fixture-with-violation.ts`. The fixture's `@null-safety-exempt` and `guard-ignore-next-line` annotations were removed so the gate fires. Both the gate and self-test are wired into `scripts/run-all-gates.sh`.
  - Spec section: §H1 Acceptance criteria — *"Gate self-test: deliberate-violation fixture must fail"*.
  - Gap: fixture at `scripts/__tests__/derived-data-null-safety/fixture-with-violation.ts` is structured to demonstrate a violation (`utilizationByModelFamily!` non-null assertion) but is unreachable: (a) the gate scans only `server/` (`find "$ROOT_DIR/server" -name "*.ts" ! -path "*/__tests__/*"` at gate line 27), and (b) the fixture line carries `// @null-safety-exempt: test fixture` AND `// guard-ignore-next-line` so even if the gate did scan it, both suppression mechanisms would silence the violation. The spec wants the fixture to PROVE the gate fires; today nothing wires it up.
  - Suggested approach: write `scripts/__tests__/derived-data-null-safety/run-fixture-check.sh` (mirror the shape of `scripts/__tests__/principal-context-propagation/run-fixture-check.sh`) that copies the fixture into a temp `server/` path, runs the gate, asserts at least one violation lands for the temp path, then cleans up. Alternatively: add a `--fixture-path <dir>` argument to the gate itself so a self-test runner can point it at the fixture directory without copying. Either approach takes <30 min.
  - Back-link: `tasks/review-logs/spec-conformance-log-audit-remediation-followups-2026-04-26T05-34-10Z.md` REQ #59h.

- [x] **GATES-2026-04-26-1** — `reference_documents` (0202) and `reference_document_versions` (0203) FORCE RLS hardening. **CLOSED 2026-04-29** — verified during pre-prod-tenancy spec authoring. Fixed by `migrations/0229_reference_documents_force_rls_parent_exists.sql` (FORCE RLS on both tables; canonical org-isolation policy on `reference_documents`; parent-EXISTS variant on `reference_document_versions`). The 0202/0203 baseline allowlist entries have been removed from `scripts/verify-rls-coverage.sh` (`HISTORICAL_BASELINE_FILES` now contains only 0204/0205/0206/0207/0208/0212).
  - **Severity: medium (security posture).** FORCE RLS prevents the table owner from bypassing the existing policies — the same risk that `DEVELOPMENT_GUIDELINES.md` §1.2 identifies as the entire reason FORCE matters. Without it, a malicious or accidentally privileged DB connection (e.g. a misconfigured admin pool) could read across tenants on these two tables. The ALS-managed application pool does not run as table owner, so production blast radius is bounded — but the gap is real and should not be lost.
  - Surfaced by: `scripts/verify-rls-coverage.sh` after the manifest entries were re-pointed at 0202/0203 in this session.
  - Status: both files are now baselined in `HISTORICAL_BASELINE_FILES` with `@rls-baseline:` annotations. CREATE POLICY exists (org-isolation on parent doc; parent-EXISTS on versions); FORCE RLS does not.
  - Suggested approach: write `migrations/02NN_reference_documents_force_rls.sql` adding `ALTER TABLE reference_documents FORCE ROW LEVEL SECURITY;` and `ALTER TABLE reference_document_versions FORCE ROW LEVEL SECURITY;`. Versions table needs a parent-EXISTS WITH CHECK clause matching the existing USING shape (no organisation_id column). Once shipped, drop both files from `HISTORICAL_BASELINE_FILES` and remove the `@rls-baseline` annotations.
  - Why deferred: the migration's correctness depends on careful reasoning about the WITH CHECK shape for versions table (parent-EXISTS write check is non-obvious — needs a written test against actual writes via INSERT INTO reference_document_versions to confirm FORCE RLS doesn't break authoring flows). Also the 0202 migration carries a second `subaccount_isolation` policy keyed on a non-canonical `app.current_subaccount_id` session var — the FORCE-RLS work should reconcile that policy too, otherwise multi-policy OR semantics could mask the canonical isolation.

- [ ] **GATES-2026-04-26-2** — `verify-rls-contract-compliance.sh` should skip `import type` lines.
  - Surfaced by: pr-reviewer S3 on commit `fd61246e`. The `rlsBoundaryGuard.ts` line-47 `guard-ignore-next-line` is the right tactical fix today, but every future legitimate type-only import of an org-scoped DB type will need its own per-line suppression with similar wording.
  - Suggested approach: prepend Rule 1's grep pipeline in `scripts/verify-rls-contract-compliance.sh` with `grep -v "^[[:space:]]*import type "` (or augment the per-line filter inside the while loop). Type-only imports are erased at compile time and issue zero queries, so the gate has no business flagging them. 2-line change.
  - Why deferred: the suppression in this branch is correct under the current rules; gate-level fix is hygiene improvement, not a correctness fix.

---

## Deferred from PR #203 (ChatGPT review) — candidates for next spec

**Captured:** 2026-04-26T08:00:00Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-claude-deferred-quality-fixes-ZKgVV-2026-04-26T07-57-14Z.md`
**PR:** #203 — https://github.com/michaelhazza/automation-v1/pull/203
**Branch:** `claude/deferred-quality-fixes-ZKgVV`

ChatGPT review of the audit-remediation-followups PR surfaced two architectural items that were deferred (after user review) for follow-up specs. Items below are not bugs in the current PR — they are scale/contract concerns that warrant their own scoped spec rather than being wedged into this branch.

- [ ] **CHATGPT-PR203-R2** — Replace per-row tx + advisory-lock pattern in `measureInterventionOutcomeJob` with a batched per-org claim model.
  - **Severity:** medium (throughput / scale).
  - **Scope:** architectural (changes documented concurrency model + likely requires schema work).
  - **Files affected:** `server/jobs/measureInterventionOutcomeJob.ts`, possibly `server/db/schema/interventionOutcomes.ts` (uniqueness constraint on `intervention_id`).
  - **Rationale for defer:** the current per-row tx + advisory lock is correct (claim+verify idempotency), but at high intervention throughput it serialises every row through a lock + transaction round-trip. ChatGPT's suggested `INSERT ... ON CONFLICT (intervention_id) DO NOTHING` would shed the lock and the per-row tx, but it presumes a unique constraint on `intervention_outcomes.intervention_id` that does not currently exist. The alternative (batch per org, single tx, conditional insert) changes the documented per-row claim+verify semantics that the spec explicitly chose. Either path is non-trivial reasoning + a migration; deserves its own spec.
  - **Suggested next-spec framing:** decide between (a) add unique constraint on `intervention_outcomes.intervention_id` and switch to `ON CONFLICT DO NOTHING`, or (b) keep claim+verify but batch per-org with a single tx and a single advisory lock per batch. (a) is simpler if the data model permits it; (b) preserves the current concurrency model but amortises lock overhead. Either way the spec should set a target throughput (rows/sec/org) and include a load-test acceptance criterion.

- [ ] **CHATGPT-PR203-BONUS** — Standardise a cross-job `JobResult` discriminated union (`ok | noop | partial | error`) with `queueService` logging + monitoring agent consumption.
  - **Severity:** low (system-thinking / observability hygiene).
  - **Scope:** architectural (cross-cutting refactor across all job files).
  - **Files affected:** every file under `server/jobs/*` (each job's return shape), `server/services/queueService.ts` (logging consumer), monitoring/alerting consumers (TBD), shared types (`shared/types/jobs.ts` or new).
  - **Rationale for defer:** valid system-thinking improvement that would unify how jobs report outcome and how monitoring acts on partial-success. Not a bug; ChatGPT explicitly tagged it "optional but powerful." Tacking it onto this PR would balloon scope across all jobs without a clear contract sketch. Better as a dedicated spec that defines the union, the queueService logging shape, the monitoring consumer's expectations, and a migration plan that converts jobs incrementally rather than in one commit.
  - **Suggested next-spec framing:** define `JobResult = { kind: 'ok', detail?: ... } | { kind: 'noop', reason: string } | { kind: 'partial', completed: N, failed: M, errors: ... } | { kind: 'error', cause: ... }`. Specify how `queueService` logs each kind (current `logger.info('job_noop', ...)` already covers `noop`). Specify which monitoring signals each kind raises. Migrate jobs file-by-file behind the new return shape; old plain-`Promise<void>` jobs continue to work as `kind: 'ok'` until migrated.

---

## Deferred from chatgpt-pr-review — PR #211 pre-launch-hardening (round 1)

**Captured:** 2026-04-26T23:59:09Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-impl-pre-launch-hardening-2026-04-26T23-59-09Z.md`
**PR:** #211 — https://github.com/michaelhazza/automation-v1/pull/211
**Branch:** `impl/pre-launch-hardening`

User reply: `all as recommended` — both items deferred per agent recommendation. Items below are real architectural concerns flagged by ChatGPT but out of scope for the pre-launch hardening PR; each warrants its own scoped spec.

- [ ] **CHATGPT-PR211-F2a** — Mechanical enforcement for **read-side** Option B-lite cached-context isolation: introduce a shared `assertSubaccountScopedRead(query, subaccountId)` helper used by every cached-context read site, plus a `scripts/verify-*.sh` CI gate that fails when a cached-context table is queried without the helper.
  - **Severity:** medium (security posture / engineering ergonomics).
  - **Scope:** architectural (new shared primitive + new CI gate + every cached-context call site).
  - **Files affected:** `referenceDocumentService`, `documentBundleService`, `bundleResolutionService` (~6–10 read paths), plus a new helper module and a new verify script.
  - **Rationale for defer:** spec § 8.7 (`docs/cached-context-infrastructure-spec.md`) explicitly names service-layer filtering as the **chosen authority** and Option B-lite as a first-class permanent decision. Adding the helper + CI gate is meaningful new architecture (`DEVELOPMENT_GUIDELINES.md § 8.4` requires a "why not reuse" paragraph for new primitives) and the scope_signal is architectural per the chatgpt-pr-review agent's escalation rules. Spec § 8.7 already documents the trigger for revisiting this: a concrete observed cross-subaccount data leak. Until that trigger fires, the existing service-layer-filter discipline is the locked design.
  - **Suggested next-spec framing:** define the helper signature (read-vs-write variants, return type, failure mode — throw vs filter), enumerate every cached-context table the gate must cover, decide whether the CI gate is grep-based (cheap, false-positive-prone) or AST-based (expensive, accurate), and specify the migration plan that introduces the helper one service at a time without forcing every site to convert in one commit.

- [ ] **CHATGPT-PR211-F2b** — Mechanical enforcement for **write-side** cached-context isolation: assert that every cached-context write either includes a non-null `subaccountId` OR explicitly declares `orgScoped: true`. Promote `server/lib/cachedContextWriteScope.ts` from observability-only logger to assertion that fails closed.
  - **Severity:** medium-high (write leakage = data corruption, larger blast radius than read leakage).
  - **Scope:** architectural (introduce explicit `{ orgScoped: true }` discriminator in input shapes; thread through every cached-context write helper).
  - **Files affected:** `referenceDocumentService` (create / update / archive / restore / deprecate), `documentBundleService` (create / update / archive), `bundleSuggestionDismissalService`, plus the input types in each.
  - **Rationale for split from F2a:** read leakage is exposure (one tenant sees another's data); write leakage is corruption (data lands on the wrong tenant — much larger blast radius). Splitting the two lets the spec author handle each with the right urgency. F2b's runtime log already exists as of PR #211 round 2 (`server/lib/cachedContextWriteScope.ts`); the deferred work is promoting log → assert and threading the explicit discriminator.
  - **Suggested next-spec framing:** define the `{ subaccountId: string } | { orgScoped: true; subaccountId: null }` discriminated input type, list every cached-context write entry point that must adopt it, pick the assertion failure mode (throw vs structured log), and specify the migration plan that converts call sites incrementally without leaving a half-typed surface.

- [ ] **CHATGPT-PR211-F6 (FOLLOW-UP — partial coverage shipped in round 2)** — Extend the centralised `assertValidTransition(from, to)` guard to all remaining run / step status-write sites and add transition tables for non-terminal-to-non-terminal moves.
  - **Status:** Round-2 minimal coverage SHIPPED in PR #211. `shared/stateMachineGuards.ts` carries the helper + tests; wired at `workflowEngineService.completeStepRunInternal`, `failStepRun`, dispatch-error path, the run-level context-overflow path, and `agentRunFinalizationService.finaliseAgentRunFromIeeRun`. Coverage scope: terminal-write boundaries (post-terminal mutation, terminal→terminal, unknown-status target). NOT covered: intermediate non-terminal transitions, `decideApproval`, `completeStepRunFromReview`, `workflowRunService` run-level terminal writes, agent-run aggregation paths.
  - **Severity:** low-medium (highest-blast-radius cases now covered; remaining gaps are defence-in-depth completion).
  - **Scope:** finishing work — extend existing helper to remaining sites, add per-kind transition tables for intermediate moves.
  - **Files affected:** `workflowEngineService` (~5 remaining status-write sites), `agentExecutionService` (terminal write in agentic loop), `briefApprovalService.decideApproval`, `workflowRunService` (run-level terminal aggregation), plus `shared/stateMachineGuards.ts` (extend with intermediate transition tables).
  - **Suggested next-spec framing:** enumerate every status-write site by kind, define the canonical transition tables (allowed `from → to` per status family), specify how the guard composes with the existing static-grep gate (grep-as-coverage, runtime-as-enforcement), and decide whether to promote intermediate-transition violations from warn-log to throw once telemetry confirms zero false-positives.

- [ ] **HOME-DASHBOARD-REACTIVITY-TASK14** — Wire `dashboard.queue.changed` emitter to job queue mutation path (best-effort, deferred from home dashboard reactivity spec §5.5).
  - **Captured:** 2026-04-27
  - **Severity:** low (QueueHealthSummary still refreshes on WebSocket reconnect; maximum staleness bounded by reconnect cycle)
  - **Scope:** find pg-boss enqueue/complete sites; add `emitToSysadmin('dashboard.queue.changed', 'system', { pendingDelta: 0 })` — payload ignored by client, used as invalidation signal only.
  - **Files to investigate:** `server/services/jobQueueHealthService.ts`, pg-boss wrapper if any.

- [ ] **CHATGPT-PR211-R4-RUN-DEBUGGER-VIEW** — Operability surface for run / approval / state-machine debugging. Reviewer round-4 post-merge non-blocking suggestion.
  - **Captured:** 2026-04-27 (chatgpt-pr-review round 4 — final verdict)
  - **Severity:** medium (operability bottleneck — system is now correct but non-trivial to reason about).
  - **Scope:** new product surface (admin / engineer-facing UI) + read-only query layer over existing event / status / artefact tables. NOT a new primitive — composes existing data.
  - **Surface (per round-4 reviewer):** unified timeline view per `agent_run` / `workflow_run` showing:
    1. **State transitions over time** — every `state_transition` log line (R3-2 `describeTransition` output) plotted on a timeline; distinguishes `guarded:true` (asserted) from `guarded:false` (logged-only).
    2. **Artefact chain evolution** — for `brief` runs, the lifecycle pointer graph (`parentArtefactId` → `artefactId`) animated forward through time; chainTips / superseded / current visible at each step.
    3. **Decision points** — every `proposeAction` audit + `decideApproval` outcome, with the artefact context that drove the decision.
    4. **Guard violations** — any `InvalidTransitionError` thrown / logged by `assertValidTransition`; any `cached_context.write_missing_scope` warning emitted by `logCachedContextWrite`.
  - **Why this is the next bottleneck:** rounds 2–3 of the chatgpt-pr-review iteration shipped layered defence (assert + WHERE-guard + log) and pointer-based lifecycle resolution. The system is now resistant to common failure modes — but when something DOES go wrong, the operator's only entry point is grepping logs across multiple services. A unified debugger view collapses that diagnostic loop. Reviewer R2-7 / R3-7 / R4-3 all converge on this as "the next bottleneck is operability, not correctness".
  - **Files affected:** new admin route under `client/src/pages/admin/` (or extend an existing `RunDetailPage`); new `server/routes/admin/runDebugger.ts` query layer aggregating from `agent_run_events`, `workflow_run_events`, `conversation_messages.artefacts`, application logs (state_transition / cached_context.write).
  - **Rationale for defer to Phase 2:** post-merge work — the PR #211 surface is correctness hardening; the debugger view is an observability product feature. Reviewer explicitly said "do NOT add more invariants" / "you're done for this phase". Worth a dedicated spec that decides log-source (structured DB events vs application log scrape), retention window, admin-only vs engineer-only access, and whether the view is real-time (WS) or post-hoc.
  - **Suggested next-spec framing:** start with a 2-day spike that prototypes the artefact-chain timeline only (lowest risk, highest reuse — same view feeds brief debugging, run debugging, approval-flow debugging). Confirm the data layer can answer the four query shapes above without a new schema. Then decide whether to extend or replace the existing `client/src/pages/admin/RunsPage` / `RunDetailPage`.

---

## Deferred from spec-conformance review — home-dashboard-reactivity (2026-04-27)

**Captured:** 2026-04-27T21:02:16Z
**Source log:** `tasks/review-logs/spec-conformance-log-home-dashboard-reactivity-2026-04-27T20-57-33Z.md`
**Spec:** `tasks/builds/home-dashboard-reactivity/spec.md` (paired plan: `docs/superpowers/plans/2026-04-27-home-dashboard-reactivity.md`)

Both items closed in this PR (2026-04-28) per user direction. Resolution:
- **REQ #13 — `action: 'new'` emit on review item creation.** RESOLVED. Emit added inside `reviewService.createReviewItem` (`server/services/reviewService.ts:60-67`). Single call site closes all 6 caller paths.
- **Bulk approve / bulk reject — `dashboard.approval.changed` not emitted from bulk paths.** RESOLVED. Single emit added per bulk request in `server/routes/reviewItems.ts` bulk-approve (after `reviewService.bulkApprove`) and bulk-reject (after `reviewService.bulkReject`). `subaccountId: null` per spec contract (string | null) — bulk batches may span subaccounts and the payload field is informational only (§4.3 payload-not-trusted rule).


---

## Deferred from plan review — pre-test-brief-and-ux (2026-04-28)

**Captured:** 2026-04-28
**Source:** Pre-build plan review for `tasks/builds/pre-test-brief-and-ux/plan.md`

- [ ] **PLAN-REVIEW-P4 — Error banner state type.** `DashboardErrorBanner` uses `Record<string, boolean>` per spec. Upgrade to `Record<string, 'ok' | 'failed'>` for richer observability (persistent-failure visibility, partial-retry tracking). Not scope creep today per §0.3 — spec names the boolean type explicitly.
  - **Severity:** low (nice-to-have observability improvement)
  - **Blocked on:** follow-up spec that updates §1.4 S3 type definition

- [ ] **PLAN-REVIEW-P5 — DR2 runtime branching guard.** Add a dev-mode runtime assertion in `routes/conversations.ts` that throws if both the brief branch and the noop branch execute (or if neither executes). Current enforcement is via code-grep per spec acceptance criteria — a runtime guard would catch regressions earlier.
  - **Severity:** low (defensive engineering)
  - **Blocked on:** follow-up spec that names the guard explicitly (out of §0.3 scope for this spec)

- [ ] **PLAN-REVIEW-P7 — Middleware ordering enforcement.** Tag `req.__txMounted = true` in the org-tx middleware; add an assertion in `postCommitEmitterMiddleware` that the tag is present on arrival. Current enforcement is manual PR-time inspection. The tag catches mount-order regressions without new infrastructure.
  - **Severity:** low (defensive engineering, fragile if manually enforced)
  - **Blocked on:** org-tx middleware being named in a follow-up spec (out of §0.3 scope for this spec)

- [ ] **PLAN-REVIEW-P8 — Log prefix standardisation.** Unify structured log event names: `brief.*`, `conversation.*`, `post_commit.*` instead of the mixed `post_commit_emit_*` / `conversations_route.*` / `brief_artefacts.*` naming. Pays off in observability tooling (log aggregation, alerting). Requires a spec update before changing.
  - **Severity:** cosmetic / low (no behaviour impact, audit-trail impact)
  - **Blocked on:** follow-up spec that updates §1.1–§1.2 log definitions

## Deferred from spec-conformance review — pre-test-brief-and-ux (2026-04-28)

**Captured:** 2026-04-28T03:07:52Z
**Source log:** `tasks/review-logs/spec-conformance-log-pre-test-brief-and-ux-2026-04-28T03-07-52Z.md`
**Spec:** `docs/superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md`

The structural surface of all four spec items (DR2 / S8 / N7 / S3) lands cleanly. The gaps below are about test-scope, manual-smoke recording, and PR-prep workflow checkpoints — none mechanical, all requiring human judgment.

- [ ] REQ S3-8 — DashboardPage + ClientPulseDashboardPage manual smoke unrecorded
  - Spec section: §1.4 DoD ("manual smoke recorded")
  - Gap: `tasks/builds/pre-test-brief-and-ux/progress.md` § Manual smoke test results lists §1.4 as "_pending_"
  - Suggested approach: stop API → reload → confirm banner names failed source → restart API → click Retry → confirm banner clears. Repeat per page. Paste outcome into the smoke table.

- [ ] REQ N7-11 — BriefDetailPage manual smoke for >50-artefact Brief unrecorded
  - Spec section: §1.3 DoD ("client smoke test recorded")
  - Gap: `progress.md` § Manual smoke test results lists §1.3 as "_pending_"
  - Suggested approach: open a Brief with > 50 artefacts in dev; verify initial 50; click "Load older"; verify next 50 prepend. Paste outcome.

- [ ] REQ S8-10 — Integration test scope materially smaller than spec
  - Spec section: §1.2 Tests ("Carved-out integration test... simulates a request lifecycle: middleware → writer enqueues → res.finish fires → assert emit invoked. Then a second case: middleware → writer enqueues → res.statusCode = 500 → res.finish fires → assert emit NOT invoked.")
  - Gap: `briefConversationWriterPostCommit.integration.test.ts` exercises raw `createPostCommitStore` + `flushAll`/`reset`; never invokes the actual middleware nor `briefConversationWriter`. The store-contract piece is already unit-tested in `postCommitEmitter.test.ts`; the middleware+writer composition is currently unverified by automated tests.
  - Suggested approach: either (a) wire a minimal Express app in the test that mounts `postCommitEmitterMiddleware`, calls a route that invokes `writeConversationMessage`, and asserts the emit fires after `res.finish` (and is dropped on `res.statusCode=500`), or (b) document the deferral in `progress.md` with a rationale that manual smoke + the existing unit tests give equivalent confidence.

- [ ] REQ S8-11 — §1.2 500-rollback manual smoke unrecorded
  - Spec section: §1.2 DoD ("manual smoke for the 500-rollback case completed and noted in progress.md")
  - Gap: `progress.md` does not show §1.2 manual smoke results
  - Suggested approach: trigger a contrived 500 in a route after `writeConversationMessage` runs; confirm in browser dev tools that NO websocket event arrives. Trigger happy-path; confirm event arrives. Paste outcome.

- [ ] REQ S8-12 — KNOWLEDGE.md entry for the post-commit emit pattern missing
  - Spec section: §4 Definition of Done item 6 ("KNOWLEDGE.md is updated with the post-commit emit pattern from §1.2 (it generalises beyond Brief artefacts and is the most reusable pattern surfaced by this spec)")
  - Gap: KNOWLEDGE.md has no entry capturing the pattern
  - Suggested approach: add a short ~2026-04-28 entry summarising (a) the failure mode (tx-rollback-then-emit produces ghost events), (b) the deferral primitive (AsyncLocalStorage-backed store, flush on `res.finish` 2xx/3xx, reset on 4xx/5xx + close, closed-state immediate-emit fallback), (c) the generalisation (any subsystem that emits via websocket inside a request-scoped tx benefits from the same pattern). Cite `server/lib/postCommitEmitter.ts` as the canonical source.

- [ ] REQ DR2-8 — Integration test punts LLM classify + orchestrator enqueue assertions to manual smoke
  - Spec section: §1.1 Tests ("Carved-out integration test... exercises the route end-to-end against a fake LLM provider, asserts user message is written once, fast-path classification fires, and orchestrator-routing job is enqueued for a `needs_orchestrator` decision")
  - Gap: `conversationsRouteFollowUp.integration.test.ts` covers only (i) noop-path one-row write, (ii) DB-row→predicate dispatch, (iii) writer no-built-in-dedupe. The fake-LLM + orchestrator-enqueue assertions are punted to manual smoke per the test header.
  - Suggested approach: either (a) wire a fake LLM provider stub (mock `classifyChatIntent` to return `{ route: 'needs_orchestrator', ... }`) and assert orchestrator-routing job appears in pg-boss, or (b) accept the punt and document it as a deliberate carve-out in `progress.md` with rationale ("hot-path carve-out: full DR2 chain requires live LLM + pg-boss; manual smoke + per-component unit + DB-row dispatch tests cover the failure modes the spec was protecting against").

- [ ] REQ DR2-10 — DR2 manual dev-DB smoke unrecorded
  - Spec section: §1.1 DoD ("route's brief-followup path verified manually against the dev DB — post a follow-up, confirm orchestrator job enqueues, observe the structured log line")
  - Gap: `progress.md` shows DR2 smoke as not yet recorded
  - Suggested approach: post a follow-up to a Brief-scoped conversation in dev; observe the `conversations_route.brief_followup_dispatched` log line; confirm an orchestrator-routing job appears in pg-boss. Paste outcome.

- [ ] REQ X-1 — `tasks/todo.md` spec-named tickoffs (DR2 / S8 / N7 / S3) all still unchecked
  - Spec section: §4 DoD item 2 + §5 Backlog tickoff checklist
  - Gap: lines 359 (S8), 366 (N7), 374-375 (DR2), 770 (S3) in `tasks/todo.md` still `[ ]`. Spec lists these as the canonical "closed" markers.
  - Suggested approach: tick each entry with a one-line resolution note pointing at the commit SHA or PR number. Conventionally done at PR open.

- [ ] REQ X-2 + X-3 — progress.md final summary missing; spec §5 Tracking table SHAs missing
  - Spec section: §4 DoD item 5 + §5 Tracking
  - Gap: `progress.md` only has a setup section (no per-task results). Spec §5 Tracking table still shows all four items as `pending` with `—` SHAs.
  - Suggested approach: at PR-prep time, append a session-end summary to `progress.md` and populate the spec §5 Tracking table with the four feature commits (`6ef1ea79` S3 / `04613015` N7 / `60a68d07` S8 / `4d64df6d` DR2).

## Deferred from pr-reviewer — pre-test-brief-and-ux (2026-04-28)

**Captured:** 2026-04-28
**Source:** pr-reviewer APPROVE WITH STRONG RECOMMENDATIONS

- [ ] **PR-S2 — writeConversationMessage dedupe: spec §0.5 claim vs. reality.** Spec §0.5 says DR2's "no duplicate user messages on retry" depends on `writeConversationMessage` dedupe. Integration test 4 (conversationsRouteFollowUp) proves the function has NO built-in dedupe — a second call produces a second row. Current protection is route-level (branch-before-write, exactly one call per request). For network-level retry safety, one of: (a) add idempotency key on `(conversationId, content, senderUserId)` within a short window per CLAUDE.md §8.11, (b) add HTTP-level idempotency key header at the route, or (c) amend spec §0.5 to say "route-level, not DB-level". Not blocking today (the route is correct); label as a future hardening item.

- [x] **PR-N3 — two DB reads for same conversation in brief-followup path.** *(resolved 2026-04-28 in `da1c4f72` via R-4)* — added optional `prefetchedConv` parameter to `handleConversationFollowUp`; route caller now passes its already-resolved conv to skip the duplicate select. The `briefs.ts` caller (where `briefId` comes from URL params, not a pre-fetched conv) intentionally does not pass `prefetchedConv` and continues to re-select.

## Deferred from spec-conformance review — pre-test-backend-hardening (2026-04-28)

**Captured:** 2026-04-28T03:19:37Z
**Source log:** `tasks/review-logs/spec-conformance-log-pre-test-backend-hardening-2026-04-28T03-19-37Z.md`
**Spec:** `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md`

- [x] **REQ §1.1 Gap D — failure-path `agent_run_llm_payloads` row not inserted** *(resolved 2026-04-28 via `pre-test-integration-harness` spec §1.5 Option A)*
  - Spec section: §1.1 Acceptance criteria ("A failed-mid-flight agent-run LLM call (provider error) produces llm.requested → llm.completed (with terminalStatus: 'failed' in the payload) and the corresponding agent_run_llm_payloads row.")
  - Resolution: failure-path branch in `server/services/llmRouter.ts` now builds + inserts the `agent_run_llm_payloads` row inside its own `db.transaction`, mirroring the success path. `buildPayloadRow` accepts `response: Record<string, unknown> | null` — null only when no usable provider output exists; partial responses are persisted whenever structurally valid (per spec §1.5 partial-response semantics). Migration 0241 makes the column nullable. `llm.completed` event now carries `payloadInsertStatus: 'ok'` + the inserted `payloadRowId` on the failure path.

- [ ] **REQ §1.1 Gap E — payload-insert catch path lacks contested-key DELETE**
  - Spec section: §1.1 Acceptance criteria ("the catch handler MUST treat that row as failed (set payloadInsertStatus: 'failed', payloadRowId: null) AND a follow-up DELETE on the contested key MUST run inside the same tx so the post-commit invariant holds")
  - Gap: catch at `server/services/llmRouter.ts:1619-1628` sets the marker but never issues a follow-up DELETE. Implementation comment at lines 1586-1591 explicitly argues the payload insert must NOT be in a shared tx with the ledger write ("changes ordering semantics for the cost breaker") — directly contradicts the spec MUST.
  - Suggested approach: either restructure so the payload insert + (on failure) DELETE run in a sibling tx that doesn't interleave with the cost-breaker logic, OR amend the spec to relax the post-commit invariant to "no-row-or-row, never partial" without the DELETE requirement. The current state silently accepts ambiguous post-commit visibility under driver retry conditions.

- [x] **REQ §1.1 Gap F — `llmRouterLaelIntegration.test.ts` is a stub** *(resolved 2026-04-28 via `pre-test-integration-harness` spec §1.3)*
  - Spec section: §1.1 Tests + Definition of Done ("one integration test added and green")
  - Resolution: three real-assertion tests now exercise the LAEL emission path against a real test DB using the new fake provider adapter (`server/services/__tests__/fixtures/fakeProviderAdapter.ts`) registered via `registerProviderAdapter` (provider registry test API). Tests cover happy-path emission ordering with sequence + atomicity invariants, `budget_blocked` silence, and non-agent-run silence. Pre-test cleanup via `assertNoRowsForRunId` makes a poisoned prior run recoverable.

- [x] **REQ §1.2 Gap B — AutomationStepError shape divergence on missing-connection** *(resolved 2026-04-28 via `pre-test-integration-harness` spec §1.6 Option A)*
  - Spec section: §1.2 Approach step 2 (literal example shape with `type: 'configuration'`, `status: 'missing_connection'`, `context: { automationId, missingKeys }`)
  - Resolution: `AutomationStepError.type` widened to include `'configuration'`. Optional `status` + `context` fields added. `KNOWN_AUTOMATION_STEP_ERROR_STATUSES = ['missing_connection'] as const` co-located with the type definition is the closed vocabulary; status field stays typed `string` for now (literal-union tightening deferred). `invokeAutomationStepService.ts` `automation_missing_connection` path produces the structured shape (`type: 'configuration'`, `status: 'missing_connection'`, `context: { automationId, missingKeys }`). Pure test (`invokeAutomationStepErrorShapePure.test.ts`) round-trips the shape and asserts vocabulary discipline.

- [x] **REQ §1.3 Gap C — `workflowEngineApprovalResumeDispatch.integration.test.ts` is a stub** *(resolved 2026-04-28 via `pre-test-integration-harness` spec §1.4)*
  - Spec section: §1.3 Tests + Definition of Done ("integration test added and green") and Acceptance ("a double-approve … results in exactly one webhook dispatch, asserted by direct call-count on the test webhook receiver — NOT inferred from terminal status alone")
  - Resolution: three real-assertion tests using the new fake webhook receiver (`server/services/__tests__/fixtures/fakeWebhookReceiver.ts`). Test 2 specifically asserts `receiver.callCount === 1` AND a paired DB-side uniqueness check (`workflow_step_runs.attempt === 1` with single `completed` terminal state). HMAC verification fails loudly if the signature header is missing. Test 3 (rejected) asserts negative-dispatch on both layers (HTTP `callCount === 0` + DB `attempt === 1` with `failed` status, no dispatch row).

- [ ] **REQ §1.7 Gap A — async-worker path transitively calls `checkThrottle`**
  - Spec section: §1.7 step 1 ("Async-worker exclusion contract (MUST hold): the async-worker ingestion path MUST NOT call checkThrottle.")
  - Gap: `incidentIngestorAsyncWorker.ts:15` calls `ingestInline(payload.input)`. The branch wired `checkThrottle` into `ingestInline`. Therefore the async-worker path now transitively calls `checkThrottle`. The spec's MUST is structurally violated by the implementation choice.
  - Suggested approach: choose one of (a) split the body of `ingestInline` so the worker calls a `_ingestInlineSkippingThrottle` variant — but that introduces a new primitive in violation of §0.3 (b) collapse the contract: amend the spec to drop the async-worker-exclusion MUST since `recordIncident` routes EITHER through async OR through sync (line 90: `if (isAsyncMode())`), so there's no double-throttle in any single request lifecycle anyway, OR (c) move the throttle check up into `recordIncident` and gate it on `isAsyncMode() === false`. Option (b) reflects what the implementer actually achieved (single throttle point, no double-throttle); option (c) is the closest mechanical fix to the spec's intent.
  - **Update 2026-04-28:** Resolved in commit `7ebac102` via Option (c) — throttle moved to `recordIncident`'s sync branch; `ingestInline` is now throttle-free. Async-worker exclusion test added in commit fixing pr-reviewer S2.

- [ ] **REQ §1.1 Gap E — payload-insert catch path lacks contested-key DELETE** *(superseded)*
  - **Update 2026-04-28:** Initially "fixed" by adding a defensive DELETE in commit `7ebac102`, but pr-reviewer S1 flagged residual non-atomicity (DELETE could itself throw, leaving payload row visible with `payloadInsertStatus: 'failed'` event). Resolved by wrapping the INSERT in a `db.transaction` so any thrown error inside auto-rolls-back — eliminating the defensive DELETE entirely. The post-commit invariant now holds structurally.

## Deferred from pr-reviewer review — pre-test-backend-hardening

**Captured**: 2026-04-28
**Branch**: `claude/pre-test-backend-hardening`
**Source log**: `tasks/review-logs/pr-review-log-pre-test-backend-hardening-2026-04-28T03-59-27Z.md`

- [ ] **S4 — `decideApproval` returns inflated `newVersion` for the loser of an approve/approve race**
  - File: `server/services/workflowRunService.ts:583`
  - Issue: both winner and loser of a concurrent `decideApproval('approved')` race receive `newVersion: stepRun.version + 1`, but the actual post-commit DB version is `stepRun.version + 2` (one bump for `awaiting_approval → running`, one for `running → completed`). The loser gets a stale client cache key indistinguishable from the winner's response.
  - Pre-existing behaviour, but spec §1.3 made the invocation pattern more concurrent. Worth a follow-up to either fetch the actual post-commit version after dispatch, or document `newVersion` as a "best-effort hint" in the API contract.

- [x] **N1 — Decision-type drift in `resolveApprovalDispatchActionPure` not surfaced in helper signature** *(resolved 2026-04-28)*
  - File: `server/services/resolveApprovalDispatchActionPure.ts`
  - Resolution: added `export type ApprovalDecision = 'approved' | 'rejected' | 'edited'` to the helper file (now the canonical source of truth for the runtime decision shape). Updated the helper signature and the production caller `workflowRunService.decideApproval` to import the type rather than re-declaring the inline union. Drift between spec wording (`'approve' | 'reject'`) and codebase reality is now surfaced in one place. Route-layer request-validation types and DB column types intentionally retain their inline unions — they're separate concerns (HTTP body shape, persisted enum) from the runtime dispatch decision.

- [ ] **N3 — Promote `requireUuid` to a shared validation helper when other boundaries hit malformed UUIDs**
  - File: `server/services/briefArtefactValidatorPure.ts:83`
  - Trigger: testing pass surfaces malformed UUIDs reaching other validation boundaries (`runId`, `subaccountId`, `automationId` from external clients with bad shape).
  - Action when triggered: grep for `requireString` calls on `*Id` fields across `server/services/*ValidatorPure.ts` and promote `requireUuid` to a shared helper (likely `server/lib/validation/requireUuid.ts` or extend an existing pure-validator module).

- [ ] **N4 — `__testHooks` discriminant-name regex test is fragile**
  - File: `server/services/__tests__/reviewServiceIdempotency.test.ts:445–459`
  - Issue: test reads `reviewService.ts` source via `readFileSync` and counts string-literal occurrences of `'idempotent_race'`. A future refactor that constants-extracts the literal (e.g. `const KIND_IDEMPOTENT_RACE = 'idempotent_race'`) preserves behaviour but reduces the count below 2, failing the test.
  - Fix: assert on return-value shape instead of source-text layout — trigger a race and assert `result.wasIdempotent === true && getKindFromAuditTrail() === 'idempotent_race'`.

- [ ] **N2 follow-up — Consider adding `firstObservedAt` to `clientpulse_cursor_secret_fallback` log entry**
  - File: `server/services/clientPulseHighRiskService.ts:172–178`
  - Spec §1.5 step 2 named the field; spec-conformance accepted the omission as PASS-with-deviation. Add the field if a downstream alert filter ever wants to deduplicate or correlate the one-shot warning across instances.

## Deferred from chatgpt-pr-review — pre-test-backend-hardening (2026-04-28)

**Captured**: 2026-04-28
**Branch**: `claude/pre-test-backend-hardening`
**Source**: ChatGPT final-review round 1

- [ ] **Migration 0240 — phase the conversations unique-index swap before any production deploy with a non-trivially-sized `conversations` table**
  - File: `migrations/0240_conversations_org_scoped_unique.sql`
  - Issue: current migration is a single-tx `DROP INDEX` → `CREATE UNIQUE INDEX` on `conversations`. Single-tx semantics mean no committed window where uniqueness protection is absent, but the `CREATE` takes an `ACCESS EXCLUSIVE` lock on the table for its full duration. Risk is lock duration, not data corruption — fine on a small / pre-launch table, painful on a non-trivial one.
  - Trigger: any production deploy that runs migrations against a `conversations` table large enough for the `CREATE UNIQUE INDEX` lock to become a perceptible outage (rule of thumb: tens of millions of rows, or any row count where index build crosses ~seconds).
  - Action when triggered: split into a two-step migration — (a) `CREATE UNIQUE INDEX CONCURRENTLY` on a temp name with the new column tuple; (b) once green, drop the old index and rename the new one. Both steps must run outside a transaction (`CONCURRENTLY` requires it). Accepts an intermediate state where both indexes coexist; safe because uniqueness is satisfied by either.
  - Decision (2026-04-28): accepted as-is for this PR per "table is small, pre-launch, single-tx wrapper closes the read-side window". Phased migration is overkill at current scale and adds rollout complexity. Revisit before any deploy that violates the trigger above.
  - Rejected option (2026-04-28): `CREATE UNIQUE INDEX CONCURRENTLY` with phased rollout. Rejected for this PR because (a) `CONCURRENTLY` cannot run inside a transaction (would force splitting into two migration files), (b) introduces an intermediate state where both indexes coexist, (c) adds rollout complexity disproportionate to current `conversations` table size and pre-launch posture. Becomes the correct option once the trigger condition above is met — operational interpretation: when a non-concurrent index build under production write load becomes observable in write-latency tail (rule of thumb ~100–300ms), not when row count crosses a specific threshold.

- [x] **LAEL + approval-resume integration test harness — convert deferred `test.skip` stubs to real assertions** *(resolved 2026-04-28 via `pre-test-integration-harness` spec)*
  - Files: `server/services/__tests__/llmRouterLaelIntegration.test.ts`, `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts`
  - Resolution: harness shipped — `fakeWebhookReceiver.ts` + `fakeProviderAdapter.ts` both under `server/services/__tests__/fixtures/` with self-tests covering body-fully-read invariant, header normalisation, `setDropConnection`, latency-on-error, restore-in-finally idempotency, and same-key parallel non-interference. Provider registry extended with `registerProviderAdapter(key, adapter) → restore()` (prior-state capture + idempotent restore). Six skipped stubs converted to real assertions exercising real DB transaction boundaries; HTTP-layer + DB-layer dual assertions throughout.

- [ ] `cachedSystemMonitorAgentId` cache key is global, not per-org
  - File: `server/services/systemMonitor/triage/triageHandler.ts` lines 64–82.
  - Pre-existing. Process-local cache that captures the first-seen org's agent row id and reuses it for the lifetime of the process. Production has a fixed system-ops org so this is fine today; future dual-org / test-env scenarios could collide. Cheap fix: switch to `Map<organisationId, agentId>`.

---

## Deferred from spec-conformance review — code-intel-phase-0 (2026-04-28)

**Captured:** 2026-04-28T04:04:26Z
**Source log:** `tasks/review-logs/spec-conformance-log-code-intel-phase-0-2026-04-28T04-04-26Z.md`
**Spec:** `tasks/builds/code-intel-phase-0/plan.md`

- [x] D1 — Watcher start failure logged to log file rather than dev-server stdout
  - Resolved in-session in commit `36d97be9`. plan.md line 112 updated to state the watcher subprocess logs init failures to `references/.code-graph-watcher.log`. Parent process already prints the spawn-time pointer (`[code-graph] watcher started in background (pid X). Tail logs with: …`).

- [x] D2 — `code-graph:rebuild` does not release a held watcher lock
  - Resolved in-session in commit `36d97be9`. Watcher now writes its PID to `references/.watcher.pid` after lock acquisition. `--rebuild` reads the PID, sends SIGTERM, waits 300ms, then force-clears the lock and PID artifacts before dropping the cache. Validated end-to-end: rebuild with a live watcher prints "sent SIGTERM to watcher (pid X)", terminates the old, spawns a new one with a fresh PID; PowerShell process count confirms the singleton invariant.

## Follow-ups surfaced during pr-reviewer pass — code-intel-phase-0 (2026-04-28)

- [x] Add executable test coverage for the watcher's load-bearing invariants (pr-reviewer S4)
  - **Singleton-lock contention:** ✅ Implemented in `scripts/__tests__/build-code-graph-watcher.test.ts`. Spawns watcher A, waits for the PID file to be written (lock acquired pre-tsmorph), spawns watcher B, asserts B exits code 0 within 15s with the "lock held by another process" log, and verifies the PID file still points to A. Verified passing locally on 2026-04-28.
  - **Topology-change discrimination:** Deferred — see ChatGPT R1 follow-ups below. The reviewer agreed this is the third-priority of the three and not strictly load-bearing for merge.
  - **No feedback loop:** ✅ Implemented in the same test file. Waits for "watcher ready" (chokidar live), writes a `.ts` probe file under `references/import-graph/`, waits 1.5s, asserts no `[code-graph] add|change|unlink` log line referencing `references/` or the probe path appears. Verified passing locally on 2026-04-28.

- [ ] Watcher: ts-morph alias re-resolution closure-staleness (pr-reviewer S3)
  - Editing a barrel-export file changes the resolved target of unrelated importers' `@/foo` aliases, but those importers' `imports[]` only re-extract on their next save. Same class as the rename eventual-consistency window — bounded and visible, not silent corruption. Acceptable for Phase 0; raw-source fallback in agent prompts is the mitigation. A code comment was added in commit `<this commit>` near `extractSingleFile`'s `refreshFromFileSystem` call. **Defer behavior fix to Phase 1** — the helper layer would be the right place to introduce reactive invalidation if usage data justifies it.

## Follow-ups surfaced during ChatGPT final-review — code-intel-phase-0 (2026-04-28, round 1)

Source: ChatGPT review (round 1) on branch `code-cache-upgrade`. Reviewer verdict: PASS with minor follow-ups. The "must-do" item — minimal invariant tests for singleton-lock and no-feedback-loop — is being implemented in this PR; the items below are accepted-but-deferred per the reviewer's "nice to have, can follow post-merge" framing.

- [ ] Watcher race hardening: cache/shard write generation marker (ChatGPT R1)
  - Edge case the reviewer named: old watcher ignores SIGTERM (or is mid-syscall), `--rebuild` force-clears the lock after the 2s wait, new watcher acquires; old watcher then completes a flushShards / saveCache write before the OS reaps it, momentarily corrupting the freshly-rebuilt artifacts. Probability low (requires the old watcher to be unresponsive AND mid-write at the exact 2s mark) but the failure is silent until next cold build.
  - Suggested approaches (pick one in Phase 1):
    1. Stamp each shard JSON and the cache file with a `watcherPid` field on write; on read, the parent process's `--rebuild` ignores any artifact whose `watcherPid` matches a process that's now gone. Cheap, correct under the failure mode, no extra IPC.
    2. The watcher polls `references/.watcher.pid` every flush and exits if the PID file no longer matches its own pid. Cuts the failure window to the poll interval; requires care to avoid races on the `--rebuild` unlink step.
  - Not blocking merge per reviewer; add to Phase 1 hardening if telemetry shows shard corruption complaints.

- [ ] Reseed restore script: wrap user-restore in a transaction (ChatGPT R1)
  - File: `scripts/_reseed_restore_users.ts`
  - Gap: restore inserts users (and any joined rows) outside of an explicit transaction. If interrupted mid-restore (Ctrl-C, machine sleep, DB blip), partial state is left in the DB and a re-run may collide on unique constraints or leave orphan FKs.
  - Suggested approach: wrap the entire restore body in `db.transaction(async (tx) => { ... })`. Verify all DML inside uses `tx`, not the global `db`. No behavior change on the success path; on failure the DB is unchanged so re-run is idempotent.

- [ ] Reseed drop-create script: env guard against running outside development (ChatGPT R1)
  - File: `scripts/_reseed_drop_create.ts`
  - Gap: script drops and recreates the DB unconditionally. Production safety relies entirely on operator vigilance.
  - Suggested approach: at the top of `main()`, fail-fast if `process.env.NODE_ENV !== 'development'` (or `process.env.DATABASE_URL` matches a known production host). Throw with a clear message explaining the guard.

- [ ] Refactor: split `scripts/build-code-graph.ts` into extractor / cache layer / watcher lifecycle (ChatGPT R1)
  - File is 1,113 lines (post-Phase-0). Reviewer flagged as a maintainability risk, not blocking. Split candidates: `scripts/code-graph/extractor.ts` (single-file extraction, ts-morph projects), `scripts/code-graph/cache.ts` (load/save, sha256, shard IO), `scripts/code-graph/watcher.ts` (lock, PID, chokidar, debounce, processEvents). Top-level `build-code-graph.ts` becomes the entry-point orchestrator.
  - Defer to Phase 1 once shape stabilises — premature split risks churn if Phase 1 reshuffles boundaries again.

## Deferred from spec-conformance review — dev-mission-control (2026-04-28)

**Captured:** 2026-04-28T06:32:35Z
**Source log:** `tasks/review-logs/spec-conformance-log-dev-mission-control-2026-04-28T06-29-40Z.md`
**Spec:** `docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md`

- [ ] [origin:spec-conformance:dev-mission-control:2026-04-28T06-29-40Z] [status:open] REQ — root `package.json` scripts `review:chatgpt-pr`, `review:chatgpt-spec`, `mission-control:dev` are not wired
  - Spec section: § 5 Modified files
  - Gap: Spec explicitly names three scripts to add to root `package.json`. Implementation deliberately deferred per the user (HITL approval avoidance); current invocations call the CLI directly via `npx tsx scripts/chatgpt-review.ts` and `cd tools/mission-control && npm run dev`. The spec's § 10 Deferred items list does NOT formally cover this deferral, so the spec and implementation drift here.
  - Suggested approach: either (a) add the three scripts in a follow-up commit with bodies that match the agent-definition invocations (`review:chatgpt-pr` → `git diff main...HEAD | tsx scripts/chatgpt-review.ts --mode pr`; `review:chatgpt-spec` → `tsx scripts/chatgpt-review.ts --mode spec --file`; `mission-control:dev` → `cd tools/mission-control && npm run dev`), or (b) update the spec § 10 to formally defer the script wiring with stated rationale.

- [ ] [origin:spec-conformance:dev-mission-control:2026-04-28T06-29-40Z] [status:open] REQ — `/api/github/prs` endpoint not implemented
  - Spec section: § 5 Modified files (server/index.ts row), § 7 Execution model
  - Gap: Spec § 5 lists `/api/github/prs` as one of the four endpoints the Express server exposes. Implementation has `/api/health`, `/api/in-flight`, `/api/builds`, `/api/current-focus`, `/api/review-logs` — no `/api/github/prs`. The PR + CI fetch logic exists in `server/lib/github.ts` and is consumed inside `composeInFlight`; `/api/in-flight` returns the PR data inline, so the dashboard works without a separate endpoint.
  - Suggested approach: either (a) add a thin GET route `/api/github/prs?branch=<branch>` that calls `fetchPRForBranch` and returns the `PRSummary` (or an array, if rethought to list-many), or (b) update spec § 5 to remove the standalone endpoint and document that PR data flows via `/api/in-flight`. Option (b) matches the as-built read-only single-feed posture better.

- [ ] [origin:spec-conformance:dev-mission-control:2026-04-28T06-29-40Z] [status:open] REQ — `tasks/current-focus.md` machine block disagrees with prose body
  - Spec section: § C3 (`Source-of-truth precedence: if the two disagree, the prose is canonical and the block is corrected`)
  - Gap: The new machine block at the top of `tasks/current-focus.md` names `dev-mission-control` / status `BUILDING`, but the prose below names `pre-test-backend-hardening` / status `MERGE-READY`. By spec rule the prose wins and the block must be corrected. This is a content-state mismatch (the prose has not been updated to reflect that the dev-mission-control branch is the active sprint, OR the block was set prematurely).
  - Suggested approach: human triage. Either (a) update the prose to reflect dev-mission-control as the active sprint, or (b) revert the block's `active_spec` / `active_plan` / `build_slug` / `branch` / `status` to mirror the pre-test-backend-hardening prose. Cannot be auto-resolved — requires knowing which is the truthful current sprint state.

- [ ] [origin:spec-conformance:dev-mission-control:2026-04-28T06-29-40Z] [status:open] REQ — `scripts/chatgpt-review.ts` was implemented as two files (`chatgpt-review.ts` + `chatgpt-reviewPure.ts`); spec named only one
  - Spec section: § 5 Files to change (New files)
  - Gap: Spec § 5 lists a single new file `scripts/chatgpt-review.ts`. Implementation split into `scripts/chatgpt-review.ts` (CLI entry) and `scripts/chatgpt-reviewPure.ts` (pure helpers). The split is sound — it keeps fetch / fs side effects out of the unit-tested pure code. Test file is at `scripts/__tests__/chatgpt-reviewPure.test.ts` rather than the spec-named `scripts/__tests__/chatgpt-review.test.ts`.
  - Suggested approach: low priority — the spec's intent (CLI + tsx unit tests for pure helpers) is met. Update spec § 5 in a follow-up to document the two-file shape, OR leave as a benign as-built improvement. Not blocking.

## Deferred from chatgpt-review-auto final pass — dev-mission-control (2026-04-28)

**Captured:** 2026-04-28T13:30:00Z
**Source:** ChatGPT round-3 final review (commits `c0b27e3` and `3ebb8ed` close the in-scope items; this section captures the explicitly-deferred future-proofing items).

- [ ] [origin:chatgpt-review-auto:dev-mission-control:2026-04-28T13-30-00Z] [status:open] CI grep test for spec invariants — guard against silent spec drift
  - Trigger: any future commit that edits `docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md` or the agent definitions in `.claude/agents/chatgpt-*-review.md`, `pr-reviewer.md`, `dual-reviewer.md`, `spec-reviewer.md`.
  - Suggested approach: add a small bash gate (model on `scripts/verify-rls-coverage.sh`) that greps the spec and the relevant agent definitions for the load-bearing invariant strings — `**Verdict:**`, `dataPartial`, `isPartial`, `ci_updated_at`, `mismatch`, `read-only`, `no manual override`. Fails CI if any string is removed without a corresponding spec update. ChatGPT reviewer's framing: "this is how you keep the spec from drifting."
  - Decision (2026-04-28): deferred per the reviewer's own guidance ("Not required now, but this is how you keep the spec from drifting"). Implement when the dashboard or CLI is touched in a meaningful way without an accompanying spec edit — that's the trigger that proves the gate is needed.
  - Rejected option (2026-04-28): inlining a JS/TS check inside the test runner. Rejected because the existing pattern in `scripts/verify-*.sh` is a portable bash gate; staying with the same idiom keeps the CI surface uniform.

- [ ] [origin:chatgpt-review-auto:dev-mission-control:2026-04-28T13-30-00Z] [status:open] Filesystem-error vs ENOENT differentiation for review/progress reads — extend `dataPartial` coverage
  - Currently only GitHub fetch errors flip `dataPartial`. Filesystem reads (`readIfExists` in `tools/mission-control/server/lib/inFlight.ts`) silently treat all errors as "no data" — ENOENT (intentional null) and EACCES/EIO (real error) are indistinguishable to the consumer.
  - Trigger: any reported case of "the dashboard says no review but I know there is one" or "Mission Control silently dropped my progress.md."
  - Suggested approach: change `readIfExists` to return `{ exists: boolean; content: string | null; errored: boolean }` and have the composer flip `dataPartial: true` on `errored`. Mirrors the github.ts FetchResult pattern.
  - Decision (2026-04-28): deferred. Negligible risk in single-developer dev contexts where filesystem permissions are stable; revisit only if a real case surfaces.

- [ ] [origin:chatgpt-review-auto:dev-mission-control:2026-04-28T13-30-00Z] [status:open] Wire `inFlight.test.ts` and `github.test.ts` into the dashboard's `npm test` script
  - Currently `tools/mission-control/package.json`'s `test` script only runs `logParsers.test.ts`; the other two tsx test files must be invoked directly.
  - Trigger: any time the user is comfortable approving the (HITL-protected) `package.json` edit. One-line change to chain the three test files via `&&`.
  - Suggested approach: change the `test` script to `tsx server/__tests__/logParsers.test.ts && tsx server/__tests__/inFlight.test.ts && tsx server/__tests__/github.test.ts` (or migrate to a small test-runner that globs `__tests__/*.test.ts`).
  - Decision (2026-04-28): deferred to keep the round-3 commit free of HITL approvals. Tests are runnable via `npx tsx` directly; this is convenience-only.

## Follow-ups surfaced during ChatGPT PR final-review — code-graph-health-check (2026-04-28, from main via PR #224)

Source: ChatGPT review on PR #224 (`feat(code-graph): on-demand CEO-level health check command`). Reviewer verdict: **Approve with minor changes**. The two must-fix items (zero-adoption RED softening, correction-RED ≥2 threshold) are implemented in the same PR; the items below are reviewer-acknowledged "safe to defer" or "nice to have."

- [ ] Performance scaling for transcript scanning at scale (ChatGPT R2 — health-check)
  - Current behaviour: every health-check pass streams every `.jsonl` transcript whose mtime falls in the 14-day window across every matched project directory. Wall-clock today ≈ 14–17s on ≈30 transcripts; reviewer flagged this will degrade as Claude usage grows (large teams, long-lived repos).
  - Suggested mitigations (pick one when the wall-clock budget tightens): (a) cap files per run (e.g. last N transcripts per dir, sorted by mtime); (b) short-circuit once any per-signal threshold is reached (e.g. once we've seen ≥10 cache references in section 1, stop scanning further files for that signal); (c) cache scan results per-transcript in a small SQLite or JSON sidecar keyed by file path + mtime, so re-scans are incremental.
  - Defer until wall-clock approaches the 30s budget. Not blocking.

- [ ] Walker alignment: log rawCoverage alongside clamped value (ChatGPT R2 — health-check)
  - Current behaviour: `collectCoverage()` clamps `coveragePct` at 100 because the script's local file walker and `build-code-graph.ts`'s walker have a one-file divergence on edge cases. Reviewer agreed this is cosmetic-fine for now but flagged that two systems defining "truth" differently is a smell that will confuse future debugging.
  - Suggested fix: surface both values in the collected JSON (`coverageRaw` + `coveragePct`) so the deterministic-data dump shows the divergence; the LLM prompt continues to use only the clamped value. Long-term: align the two walkers (pick one as canonical).
  - Defer; not blocking.

- [ ] Threshold versioning (ChatGPT R2 — health-check)
  - Current behaviour: heuristic thresholds (`COVERAGE_GREEN_PCT`, `SKIP_RATE_FAIL_PCT`, `ESCALATE_QUERIES_PER_MONTH`, `STALE_CACHE_MIN`, `LOG_SIZE_FLAG_BYTES`, `ZERO_ADOPTION_MEANINGFUL_QUERIES`, `CORRECTION_RED_THRESHOLD`) are top-of-file constants. Reviewer flagged risk of silent drift between spec values in `tasks/code-intel-revisit.md` / `tasks/builds/code-intel-phase-0/plan.md` and what the script enforces.
  - Suggested fix: centralise thresholds in a single `THRESHOLDS` config object; emit a `thresholdsVersion` field in the deterministic-data JSON for auditability; cross-reference each threshold to its spec source via inline comment. Optional: load from a checked-in config file so spec edits propagate without code changes.
  - Defer; not blocking.

- [ ] Trend awareness across dated reports (ChatGPT R2 — health-check)
  - Current behaviour: each run writes `references/.code-graph-health-YYYY-MM-DD.md` independently. Reviewer noted the structure already supports trend analysis (adoption rising/falling, errors increasing) — natural next step.
  - Suggested fix: on each run, read the most recent prior dated file, diff key metrics (adoption, archQueries, coverage, watcher-error count), and surface deltas in section 1 prose ("up from 60 last week" / "watcher errors trending up: 3 → 12 → 27").
  - Defer; not blocking. Implement once 3+ dated reports accumulate.

- [x] Watcher health: "lock without PID" should explicitly trigger YELLOW (ChatGPT R2 — health-check)
  - Resolved alongside the ChatGPT R3 P1/P2 fixes. `computeVerdict()` now classifies `watcherRunning === null` as YELLOW with reason "Watcher lock present but PID unknown — ambiguous state, investigate", and the TUNE recommendation triggers on this state too. Pulled in early because the script is now functioning as a decision engine — silent ambiguous states are the same defect class as P1's cross-project contamination.

- [ ] Richer adoption signal: per-session breakdown (ChatGPT R2 — health-check)
  - Current behaviour: section 1 reports total references and unique sessions. Reviewer suggested adding "references per session" and "sessions with usage / total sessions" for adoption-quality signal.
  - Suggested fix: `totalSessionsInWindow` is already collected in `QueryVolumeSignals` — expose it in the LLM prompt's data block plus a derived `sessionsWithUsage / totalSessions` ratio. Section 1 prose can then say "5 of 30 sessions consulted the cache" rather than just "5 sessions."
  - Defer; not blocking. Nice-to-have for narrative depth.

- [ ] LLM prompt verbosity reduction (ChatGPT R2 — health-check)
  - Current behaviour: ~750-token prompt, runtime cost negligible.
  - Suggested fix: if/when token cost matters, trim repeated explanations and condense the section 4 bucket guidance to a single sentence.
  - Defer; not blocking. Cosmetic.

## ChatGPT PR final-review — round 3 (P1 + P2 applied) — code-graph-health-check (2026-04-28)

Reviewer's framing: the script has crossed from "utility" to "decision engine," which raises the bar — silently misleading data and rule contradictions are now critical, not refinements.

- [x] **P1 — Cross-project transcript contamination** (resolved)
  - `resolveProjectDirs()` previously fell back to scanning every directory under `~/.claude/projects` when no exact / sibling match was found. That silently mixed adoption / correction / volume signals from unrelated codebases, producing a misleading "this repo's cache is healthy" report when the truth was "this repo has no transcripts." Resolved: the fallback block is removed; the function returns `[]` on no match, and the downstream `transcriptsAvailable === false` path correctly surfaces "no session data found." Code comment in the function explains the deliberate non-fallback.

- [x] **P2 — ESCALATE gated on healthy adoption** (resolved)
  - `recommendation = 'ESCALATE'` previously gated only on `adoption.references > 0`, which allowed the contradictory state of high query volume + 1 cache reference firing ESCALATE ("invest in Phase 1") when the truth was "no one is using it" (which should be TUNE). Resolved: introduced `const healthyAdoption = references >= 3 && !hasCacheLinkedYellow && !zeroAdoptionMeaningful` and gated the ESCALATE branch on it. Threshold of 3 mirrors the existing "marginal adoption" YELLOW boundary so the rule cells line up.

## ChatGPT PR final-review — round 4 (deferred refinements) — code-graph-health-check (2026-04-28)

Reviewer's final pass said "merge it" and flagged two optional notes explicitly framed as "not now" / "next evolution." Logged here so they aren't lost; both are post-merge work, not blockers.

- [ ] Ratio floor on `healthyAdoption` (ChatGPT R4 — health-check)
  - Current behaviour: `healthyAdoption = references >= 3 && !hasCacheLinkedYellow && !zeroAdoptionMeaningful` in `computeVerdict()`. The `references >= 3` floor encodes a minimum quality, but is decoupled from query volume — so 3 references against 100+ archQueries (a 3% consult rate) still counts as "healthy." Reviewer flagged this as "slightly optimistic, not wrong."
  - Suggested fix: add a ratio floor — `references / archQueries >= 0.1` — alongside the absolute threshold. Pick the floor's exact value once we have more dated reports to calibrate against.
  - Defer; reviewer explicitly said "later, not now." Implement only if the existing rule fires ESCALATE on a low-ratio scenario in real data.

- [ ] Booleans → weighted-score verdict architecture (ChatGPT R4 — health-check)
  - Current behaviour: rule-based thresholds + boolean gates compose the verdict in `computeVerdict()`. Works correctly for Phase 0's signal set.
  - Suggested fix: convert each signal class (adoption / correctness / operational) to a numeric score, compute the verdict from a weighted score composition. Reviewer's framing: this matters once trend analysis lands or weak signals start combining — neither is true today.
  - Defer; reviewer explicitly said "where this naturally evolves" and "not something to implement now." Revisit if/when the trend-awareness item (round 2) lands, since that's the natural co-arrival point.

## ChatGPT PR final-review — round 1 (deferred refinements) — pre-test-integration-harness (2026-04-28)

Reviewer's framing on PR #227: "Approve with minor fixes." Two must-fix items were either already correct or reduced to a comment update; the items below are the explicitly-deferred refinements the reviewer flagged as "strongly recommended" or "optional improvement," not blockers.

- [ ] Null-response invariant for downstream consumers of `agent_run_llm_payloads.response` (ChatGPT R1 — pre-test-integration-harness)
  - Current behaviour: schema, writer, event service, and shared types correctly model `response` as nullable on the failure path. Nothing centrally enforces "consumers must null-check before nested-field access" — a consumer writing `payload.response.content` will crash at runtime if the row originated from a failure-path insert.
  - Suggested fix: add an invariant comment block at the canonical entry point (e.g. `server/routes/agentExecutionLog.ts` or the schema file) stating "All consumers MUST null-check response before accessing nested fields." Optional but stronger: add a typed assertion helper, e.g. `function assertResponsePresent(r: unknown): asserts r is Record<string, unknown>` so consumers can narrow once and reuse the narrowed reference.
  - Defer; not blocking. Implement when the next consumer is added or when a `response.X` access shows up in a code-review diff — that's the natural inflection point where the helper earns its keep. Type-level nullability on the field already gives compile-time safety today; the helper is a developer-ergonomics layer on top.

---

## Deferred findings — system-monitoring-coverage build (2026-04-28)

### Webhook 5xx coverage gap — slackWebhook.ts + teamworkWebhook.ts

`server/routes/webhooks/slackWebhook.ts` and `server/routes/webhooks/teamworkWebhook.ts`
have inline `res.status(500)` paths that do not call `recordIncident`.
These were out-of-scope for the system-monitoring-coverage build (spec §6.1.3 locked
scope to GHL + GitHub only).

Follow-up: apply the same `recordIncident` pattern to each inline 500 path in
these files. Use `fingerprintOverride: 'webhook:slack:handler_failed'` and
`fingerprintOverride: 'webhook:teamwork:handler_failed'` respectively.

### workflow-bulk-parent-check JOB_CONFIG entry has no worker registration

`workflow-bulk-parent-check` exists in `server/config/jobConfig.ts` with a
`deadLetter` queue, so `dlqMonitorService` (via `deriveDlqQueueNames`) now
subscribes to `workflow-bulk-parent-check__dlq` — but no producer or worker
exists anywhere in the repository (`grep -rn "workflow-bulk-parent-check"
server` returns only the JOB_CONFIG row).

Origin: pr-reviewer SR-5. Spec §3.1 line 125 lists this queue's `createWorker`
match as expected, but spec §5.2 line 885 hedges with "if present". The plan's
preflight (Task 3.1 step 1) explicitly authorised omission when the queue isn't
found.

Follow-up: either find the missing worker registration site (audit log
mentioned "Sprint 4 P3.1 bulk parent completion check"), or remove the
`workflow-bulk-parent-check` entry from JOB_CONFIG if it's aspirational. Until
then the DLQ subscription is harmless but noisy.


---

## Follow-up: Remaining soft-delete join gaps (fix-logical-deletes-2)

**Source:** pr-reviewer on branch `fix-logical-deletes` (2026-04-29)

The `fix-logical-deletes` branch fixed the 24 join sites listed in
`docs/soft-delete-filter-gaps-spec.md`. The pr-reviewer found additional
unguarded joins not covered by the spec. These should be fixed in a follow-up PR
(`fix-logical-deletes-2`) to keep scope clean.

### WHERE-clause only (functionally correct, convention-violating — isNull in WHERE, not join)
- `server/tools/internal/assignTask.ts:55` — agents join
- `server/services/agentExecutionService.ts:3057` — agents join
- `server/services/agentScheduleService.ts:221` — agents join
- `server/services/capabilityMapService.ts:203` — agents join
- `server/services/scheduleCalendarService.ts:123` — agents join
- `server/services/skillExecutor.ts:3375,3589,3839` — agents joins (3 sites)

### No deletedAt filter at all (genuine Category A gaps)
- `server/services/subaccountAgentService.ts:227` — `getLinkById` innerJoin agents (operational)
- `server/services/subaccountAgentService.ts:390` — `getTree` innerJoin agents (org-chart, exact pattern that triggered the original bug)
- `server/services/hierarchyRouteResolverService.ts:58` — agents join, runtime routing path
- `server/services/workspaceHealth/workspaceHealthService.ts:266-267` — agents + subaccounts joins, no soft-delete filter
- `server/services/workspaceHealth/workspaceHealthService.ts:317` — subaccounts join
- `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.ts:41` — agents join
- `server/services/subaccountAgentService.ts:499` — leftJoin systemAgents, no isNull(systemAgents.deletedAt)
- `server/jobs/proposeClientPulseInterventionsJob.ts:309` — innerJoin systemAgents
- `server/services/clientPulseInterventionContextService.ts:366` — innerJoin systemAgents
- `server/services/configUpdateOrganisationService.ts:59` — innerJoin systemAgents
- `server/services/workflowActionCallExecutor.ts:74` — innerJoin systemAgents
- `server/tools/config/configSkillHandlers.ts:34` — innerJoin systemAgents (same file as fix-logical-deletes)

---

## Deferred from spec-reviewer review — pre-prod-boundary-and-brief-api

**Captured:** 2026-04-29
**Source log:** `tasks/review-logs/spec-review-log-pre-prod-boundary-and-brief-api-1-2026-04-29T02-31-12Z.md`

These directional findings surfaced during the spec-reviewer loop on the draft spec at `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`. They were resolved autonomously per the spec-reviewer's framing-assumption rules and are routed here for human review at your convenience. None of them blocks implementation.

- [ ] [origin:spec-review:pre-prod-boundary-and-brief-api:2026-04-29T02-31-12Z] [status:open] §12 Test matrix originally included non-F8 integration tests (rateLimiter concurrent-increment race + TTL cleanup; reseed rollback). The spec author explicitly acknowledged only F8 (`sessionMessage.test.ts`) as the framing deviation. The reviewer auto-collapsed the rateLimiter concurrent + cleanup rows into a pure-helper unit test of the sliding-window math (`computeEffectiveCount`), and replaced the reseed rollback row with static inspection (the rollback shape is structurally guaranteed by `pg`'s transaction semantics). **Decision required:** confirm the reduced surface is acceptable, or restore one of the integration tests with an explicit framing-deviation acknowledgement.
- [ ] [origin:spec-review:pre-prod-boundary-and-brief-api:2026-04-29T02-31-12Z] [status:open] `rate_limit_buckets` PRIMARY KEY is `(key, window_start)`; `windowSec` is not part of the key shape. If the same caller-defined `key` is ever reused with two different `windowSec` values, the sliding-window read corrupts (the `prev`/`curr` window pair would mix two different windows). Today every call site uses a single `windowSec` per key namespace, so the issue is latent. **Decision required:** either (a) name a convention in §7.1 — "callers MUST encode `windowSec` in the key string when reusing a namespace with multiple window sizes" — or (b) add a `window_sec` column to the PK and the contract. The reviewer recommends (a) for minimum schema impact; the architect should confirm.
- [ ] [origin:spec-review:pre-prod-boundary-and-brief-api:2026-04-29T02-31-12Z] [status:open] Login rate limiter (§6.2.5) is keyed on `ip + emailLower` but is invoked **before** `validateBody(loginBody)` (§8 access-control table). If the body is missing or malformed, `email` may be undefined. **Decision required:** either (a) move `validateBody` before the limiter so the email is known-valid, or (b) drop email from the login key and use IP only (loses per-account targeting on the same IP), or (c) defensively coerce a missing/blank email to a sentinel like `_invalid_` in the key. The reviewer recommends (a) since validation runs cheaply and the limiter's audit signal benefits from a normalised email.

---

## PR Review deferred items

### PR #234 — pre-prod-boundary-and-brief-api (2026-04-29)

- [ ] F6: Document increment-on-deny contract in `inboundRateLimiter.check()` jsdoc — "every call increments the bucket regardless of allowed/denied" — currently implicit, must be explicit [user]
- [ ] F7: Escalate `rate_limit.cleanup_capped` log event to a monitor/alert so backlog growth is visible in ops tooling [user]
- [ ] F8: Investigate res.on('close') → fs.unlink race in multer cleanup middleware — low-probability but worth a targeted fix in a follow-up PR [user]
- [ ] F9: Extract rate-limit check pattern to a shared `rateLimit({ keyBuilder, limit, window })` middleware — currently duplicated across all rate-limited routes [user]
- [ ] F10: Systematic coverage pass — audit all write endpoints for missing rate-limit protection (auth, public, session-message covered; others not) [user]
- [ ] F11: Add near-capacity and success-sampling log events to rate limiter for observability completeness [user]

### PR #235 — pre-prod-tenancy (2026-04-29)

- [ ] F2b: Add idempotency-invariant test for `measureInterventionOutcomeJob` — assert all reads happen before `recordOutcome`, and that two parallel runs over the same row produce exactly one outcome row (the comment is in place; the test would lock the invariant in CI) [auto]
- [ ] F3: Strengthen `@rls-allowlist-bypass` runtime enforcement — runtime assertion wrapper inside `withAdminConnectionGuarded` OR audit-log on every bypass read with caller + route. Architectural — touches `server/lib/adminDbConnection.ts` plus every annotated call site. Spec out audit-log vs hard-assert trade-off before implementing. [user]

---

## Deferred from pre-prod-tenancy spec

### Phase 2 §4.7 load-test — speedup re-measurement on production environment
`intervention_outcomes` ON CONFLICT throughput comparison was run on localhost loopback
(Intel Core Ultra 7 258V, PostgreSQL 18.3, Node.js v20.19.6).

Local result: 1.47× speedup (300 rows/sec/org new path vs 204 rows/sec/org legacy path).
Absolute floor: PASS (300 ≥ 200 rows/sec/org).
Correctness: PASS (200 rows written, 0 duplicates, concurrency check clean).

Speedup FAILS the ≥5× spec threshold locally because loopback eliminates per-round-trip
network latency — the dominant cost of the legacy 200-row per-row-transaction path in
production. On staging/prod with 5–20ms app→DB latency, expected speedup is 10×–40×.

Action: re-run `tasks/builds/pre-prod-tenancy/time_write_path_v2.ts` after deploy to
a staging environment with real app→DB network latency. Pass conditions remain:
≥5× speedup vs legacy advisory-lock path AND ≥200 rows/sec/org.

---

## Deferred from spec-conformance review — pre-prod-tenancy (2026-04-29)

**Captured:** 2026-04-29T06:57:41Z
**Source log:** `tasks/review-logs/spec-conformance-log-pre-prod-tenancy-2026-04-29T06-57-41Z.md`
**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`

- [x] **CONFORM-1 [CLOSED 2026-04-29]**: workflow_engines / workflow_runs manifest entries cite migrations that contain no `CREATE POLICY` block
  - **Resolution:** Option (a) — added `0000_wandering_firedrake.sql` and `0076_playbooks.sql` to `HISTORICAL_BASELINE_FILES` in `scripts/verify-rls-coverage.sh` with `@rls-baseline:` annotations in both migration files. Also fixed redundant `migrations/` prefix in registry `policyMigration` entries (convention is filename only). `verify-rls-coverage.sh` workflow_engines/workflow_runs violations now resolved (gate violation count 10 → 8; remaining 8 are pre-existing about other tables). Honors §3.4.1 registry-only rule, §7.1 CI invariant, and §0.4 sister-branch scope-out.

- [x] **CONFORM-2 [CLOSED 2026-04-29]**: Nullable-aware RLS policy on `org_margin_configs` and `skills` allows tenant code paths to write `organisation_id = NULL` rows
  - **Resolution:** Audit confirmed only one tenant write path on `skills` could hit NULL — `seedBuiltInSkills` at boot. Migration 0245 WITH CHECK clauses tightened to canonical shape (drop `IS NULL` from WITH CHECK; keep nullable-aware USING for read access). `seedBuiltInSkills` migrated to `withAdminConnection` + `SET LOCAL ROLE admin_role` (BYPASSRLS) so boot-time NULL writes go via admin path. `org_margin_configs` had no tenant writes at all — only migration 0024 seeds the platform-default NULL row. Now fully compliant with spec §2.1 canonical shape.

- [x] **CONFORM-3 [CLOSED 2026-04-29]**: Phase 3 §5.2.1 audit triplet line-number drift for ruleAutoDeprecateJob
  - **Resolution:** Updated per-job audit paragraph in `tasks/builds/pre-prod-tenancy/progress.md` to use commit-message line ranges (134-148 for per-org writes, 175 for lock acquisition). All three places now agree byte-identically per §5.2.1.

---

## Deferred from spec-conformance review — agent-as-employee (2026-04-29)

**Captured:** 2026-04-29T11:58:52Z
**Source log:** `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T11-58-52Z.md`
**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Scope verified:** Phases A, B, C only — Phases D and E not yet implemented and explicitly out of this run's scope.

- [ ] **D1** — `workspaceEmailPipeline.send` does not use `withOrgTx`; raw `db` import bypasses RLS session-var
  - Spec section: §10.5 (multi-tenant safety checklist), §10.2 (RLS); plan Task B6 step 1.
  - Gap: pipeline reads/writes 4 canonical tables outside any `withOrgTx`; works only because dev runs as a BYPASSRLS superuser.
  - Suggested approach: wrap audit-anchor TX1 and mirror-write TX2 in their own `withOrgTx(orgId, ...)` blocks. Same pattern for `ingest`.

- [ ] **D2** — Routes import `db` directly across all 4 new workspace route files
  - Spec section: §10.5; `DEVELOPMENT_GUIDELINES.md` §2.
  - Gap: `workspace.ts`, `workspaceMail.ts`, `workspaceCalendar.ts`, `workspaceInboundWebhook.ts` all import `db` and run inline lookups (resolveAgentSubaccountId, identity lookup, mailbox thread query).
  - Suggested approach: introduce `resolveAgentActiveIdentity(agentId, orgId)` and similar helpers in the workspace services, switch routes to call services. Each helper uses `withOrgTx`.

- [ ] **D3** — Adapters import `db` directly and write canonical rows outside `withOrgTx`
  - Spec section: §7 mirroring invariant; plan invariant #6.
  - Gap: `nativeWorkspaceAdapter` and `googleWorkspaceAdapter` both import `db` and insert into `workspace_identities` and `workspace_calendar_events` with no `withOrgTx`.
  - Suggested approach: caller (pipeline / onboarding service) opens `withOrgTx`, passes the scoped `db` into the adapter; or each adapter method opens its own `withOrgTx(organisationId, ...)` from the params it already receives.

- [ ] **D4** — Calendar invite iCal attachments dropped by transactional email provider
  - Spec section: §8.3 (RFC 5546 calendar-over-email).
  - Gap: `transactionalEmailProvider.sendThroughProvider` declares `attachments` in its options interface but the resend / sendgrid branches never forward them to the provider SDK. Native `createEvent` writes the local row but the email recipient receives a plain text body with no `.ics` payload.
  - Suggested approach: forward `attachments` to Resend (`attachments: [{filename, content, contentType}]`), SendGrid (`attachments: [{content, type, filename}]`), and SMTP (`attachments` array directly).

- [ ] **D5** — Native rate-limit caps deviate from spec §8.1 (amended)
  - Spec section: §8.1 amended — per-identity 60/min, 1000/hour, 5000/day; per-org 600/min, 20000/hour, 100000/day.
  - Gap: `workspaceEmailRateLimit.defaultRateLimitCheck` enforces only one window — 60/hour identity + 1000/hour org. Per-minute and per-day caps absent; identity cap is 60× tighter than spec, org cap 20× tighter.
  - Suggested approach: extend `inboundRateLimiter.check` to accept `[{cap, windowSec}]` arrays, check all in one round-trip, return whichever fails first (with the relevant `windowResetAt`).

- [ ] **D6** — `verify-pipeline-only-outbound.ts` allow-list missing the contract test fixture
  - Spec section: §7 (static check).
  - Gap: gate's `allowed = ['server/services/workspace/workspaceEmailPipeline.ts']` but `canonicalAdapterContract.test.ts:59` calls `adapter.sendEmail(...)`. Gate would fail in CI.
  - Suggested approach: extend `allowed` to also include `server/adapters/workspace/__tests__/**`. Spec intent is "production code goes through the pipeline" — test fixtures are not production code.

- [ ] **D7** — `AgentMailboxPage` Message shape mismatched with route response
  - Spec section: §5 mockup 10; §6.3.
  - Gap: page expects `toAddress: string` and `receivedAt: string`; route returns `toAddresses: string[]` and `receivedAt: string | null` directly from the Drizzle row.
  - Suggested approach: align UI types to schema names (`toAddresses`, `receivedAt`); compute `displayedAt = receivedAt ?? sentAt` for outbound rows that have null `receivedAt`.

- [ ] **D8** — `AgentCalendarPage` event shape mismatched
  - Spec section: §5 mockup 11; §6.4; §7 adapter `CalendarEvent`.
  - Gap: page expects `id, startAt, endAt, attendees, organizerEmail`; route returns adapter shape `{externalEventId, organiserEmail, startsAt, endsAt, attendeeEmails, ...}` (no `id`).
  - Suggested approach: change route to return `workspace_calendar_events` rows directly (which include `id`), or redefine `CalendarEvent` to be the canonical row shape and have UI consume those names.

- [ ] **D9** — `OnboardAgentModal` does not deep-link to identity tab on success
  - Spec section: §5 frontend modified row for `SubaccountAgentEditPage.tsx` — "Default to 'identity' when navigating from a freshly onboarded agent (`?newlyOnboarded=1` query param)".
  - Gap: modal calls `onSuccess(identityId)` callback but does not navigate; parent page `SubaccountAgentsPage` does not navigate either. `SubaccountAgentEditPage` reads `tab` URL param, not `newlyOnboarded`.
  - Suggested approach: parent page navigates on `onSuccess` to `/admin/subaccounts/:saId/agents/:linkId/manage?tab=identity&newlyOnboarded=1` (mockup 07 → 09). Either honour `newlyOnboarded` as default-to-identity or rely on `?tab=identity`.

- [ ] **D10** — Per-row "Onboard to workplace" CTA shown unconditionally on every agent row
  - Spec section: §2 — "per-row 'Onboard to workplace' action **on agents that aren't yet onboarded**".
  - Gap: CTA renders for every link in `SubaccountAgentsPage` regardless of identity status.
  - Suggested approach: include `link.workspaceIdentityStatus` in the `/api/subaccounts/:saId/agents` response; gate the CTA on `=== null`. Show an "Identity" badge for already-onboarded rows.

- [ ] **D11** — Signature template hard-coded; `WorkspaceTenantConfig` lookup unwired
  - Spec section: §12 contract `WorkspaceTenantConfig` — `defaultSignatureTemplate`, `discloseAsAgent`, `vanityDomain`. §17 Q3 — disclosure opt-in per subaccount.
  - Gap: `workspaceMail.ts:127-133` passes `subaccountName: subaccountId` (raw UUID) and `discloseAsAgent: false` literal; signature template comes from `identity.metadata.signature` instead of subaccount config.
  - Suggested approach: add `connectorConfigService.getWorkspaceTenantConfig(orgId, subaccountId)` returning the `WorkspaceTenantConfig` shape; pipeline's `signatureContext` is built from that.

- [ ] **D12** — `workspace_messages.actor_id == workspace_identities.actor_id` invariant not DB-enforced
  - Spec section: §6.3 trust invariant — "treated as a hard data-integrity invariant".
  - Gap: pipeline correctly populates `actor_id` from a fresh identity read, but no CHECK or trigger on the DB. Future writers that take `actor_id` from caller input would not be caught.
  - Suggested approach: add a BEFORE INSERT/UPDATE trigger on `workspace_messages` asserting `NEW.actor_id = (SELECT actor_id FROM workspace_identities WHERE id = NEW.identity_id)`. Mirrors `workspace_identities_actor_same_subaccount` already in 0254.

- [ ] **D13** — Onboarding service does not write `identity.provisioned` audit event
  - Spec section: §9.1 step 8 — emit three audit rows per onboarding (`actor.onboarded`, `identity.provisioned`, `identity.activated`).
  - Gap: `workspaceOnboardingService.onboard` writes only `actor.onboarded` + `identity.activated`. The `identity.provisioned` row is missing.
  - Suggested approach: insert the `identity.provisioned` row immediately after `adapter.provisionIdentity` returns, before `transition('activate')`. Single 3-row insert is fine.

- [ ] **D14** — Revoke `confirmName` checks against `workspace_actors.displayName` instead of UI-visible name
  - Spec / mockup: mockup 13 — "type the agent's name to confirm".
  - Gap: `workspace.ts:285-296` compares `confirmName` against the actor's `display_name`. If the operator edited the display name during onboarding (e.g. "Sarah" → "Sarah J"), the revoke dialog rejects valid input.
  - Suggested approach: clarify which name the dialog asks the operator to type (mockup says "agent's name"), then either compare against `agents.name` OR keep actor display_name and document that mockup 13 is "type the workspace display name". Front-end already has the comparison source; route should accept whichever the dialog prompts with.

- [ ] **D15** — `verify-workspace-actor-coverage.ts` not wired into a CI workflow
  - Spec section: §16 acceptance criterion — "`verify-workspace-actor-coverage.ts` passes in CI"; plan Task A10 step 4.
  - Gap: gate exists but `progress.md` notes ".github/workflows/ directory absent — CI wiring deferred". Acceptance criterion cannot currently be evaluated.
  - Suggested approach: confirm CI provider, wire the gate as a blocking step alongside `verify-rls-coverage.sh`. If CI is hosted outside `.github/workflows/`, document the integration point and add the same step there.

- [ ] **D16** — Permission key naming convention diverges from spec wording
  - Spec section: §10.1 (uses colon-separated form `agents:onboard`). Implementation uses dot-namespaced `subaccount.agents.onboard` per established convention.
  - Gap: documentation-only — keys are functionally correct but textually different.
  - Suggested approach: update spec wording in a follow-up `chatgpt-spec-review` cycle to reflect the established convention, OR document the convention in `docs/capabilities.md` once added. Do NOT rewrite the keys.

- [ ] **D17** — Contract test fixtures pass `signature: null` though contract types `signature: string`
  - Spec / contract: §7 `ProvisionParams.signature: string`.
  - Gap: `canonicalAdapterContract.test.ts:25` declares `signature: null` (and `photoUrl: null`); compiles only because the test isn't strictly typed against the interface.
  - Suggested approach: decide alongside D11 — if signature can be empty/absent, widen the contract to `string | null`; otherwise change fixtures to use empty strings. Pick one.

- [ ] **D18** — `rateLimitKey` always logged as `null` in pipeline INFO line
  - Spec / plan: invariant #10 — INFO log MUST include `rateLimitKey` when applicable.
  - Gap: `workspaceEmailPipeline.ts:87` always emits `rateLimitKey: null`; pipeline doesn't capture the actual key string from `defaultRateLimitCheck`.
  - Suggested approach: extend `defaultRateLimitCheck` return type to include the resolved key string for both identity and org scopes; pipeline logs the most-restrictive bucket key.

## Deferred from spec-conformance review — agent-as-employee (re-run, 2026-04-29)

**Captured:** 2026-04-29T12:45:59Z
**Source log:** `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T12-45-59Z.md`
**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Scope verified:** Phases A, B, C only — Phases D and E not yet implemented and explicitly out of this run's scope.

**Closed since previous run:** D1, D3, D4, D5, D6, D7, D8, D9, D10, D12, D13, D14, D18 (13 items).
**Closed with deviation:** D9 (uses `?tab=identity` instead of `?newlyOnboarded=1`), D16 (docs-only, always-was-deviation).
**Subsumed:** D2 — D2 is largely closed; remaining sub-finding split out as D19.

The 5 items below remain open. D19 and D20 are NEW gaps surfaced during the re-verification pass.

- [ ] **D11** — Signature template hard-coded; `WorkspaceTenantConfig` lookup unwired (carried forward from previous run)
  - Spec section: §12 contract `WorkspaceTenantConfig` — `defaultSignatureTemplate`, `discloseAsAgent`, `vanityDomain`. §17 Q3 — disclosure opt-in per subaccount.
  - Gap: `workspaceMail.ts:122-134` still passes `subaccountName: subaccountId` (raw UUID) and `discloseAsAgent: false` literal; signature template comes from `identity.metadata.signature` instead of subaccount config. No `connectorConfigService.getWorkspaceTenantConfig` exists.
  - Suggested approach: add `connectorConfigService.getWorkspaceTenantConfig(orgId, subaccountId)` returning the spec's `WorkspaceTenantConfig` shape; resolve subaccount display name via `subaccountService.getById`; pipeline's `signatureContext` is built from that.

- [ ] **D15** — `verify-workspace-actor-coverage.ts` not wired into a CI workflow (carried forward; awaiting CI infra)
  - Spec section: §16 acceptance criterion — "`verify-workspace-actor-coverage.ts` passes in CI"; plan Task A10 step 4.
  - Gap: `.github/workflows/` directory still does not exist in the repo. Acceptance criterion cannot currently be evaluated.
  - Suggested approach: confirm CI provider, wire the gate as a blocking step alongside `verify-rls-coverage.sh`. If CI is hosted outside `.github/workflows/`, document the integration point and add the same step there.

- [ ] **D17** — Contract test fixtures pass `signature: null` though contract types `signature: string` (carried forward)
  - Spec / contract: §7 `ProvisionParams.signature: string`.
  - Gap: `canonicalAdapterContract.test.ts:25` still declares `signature: null`; compiles only because the test isn't strictly typed against the interface.
  - Suggested approach: decide alongside D11 — if signature can be empty/absent, widen the contract to `string | null`; otherwise change fixtures to use empty strings. Pick one.

- [ ] **D19** — Inbound webhook bootstrap identity lookup uses raw `db` outside any tx (NEW)
  - Spec section: §10.5 multi-tenant safety; `DEVELOPMENT_GUIDELINES.md` §1 (RLS).
  - Gap: `workspaceInboundWebhook.ts:171-175` looks up `workspace_identities` by `email_address` with no `app.organisation_id` set. Provider has no JWT, so the org isn't known yet — but `workspace_identities` is RLS-protected. Currently masked by dev's BYPASSRLS superuser; would return zero rows under a non-bypass connection.
  - Suggested approach: wrap the email→identity lookup in `withAdminConnection` (admin role has BYPASSRLS, audited). Once identity is resolved, the existing `db.transaction()` + `set_config` + `withOrgTx({tx, organisationId, source: 'inbound-webhook'}, ...)` flow takes over correctly.

- [ ] **D20** — Pipeline `db.transaction()` blocks not wrapped in `withOrgTx` (NEW; stylistic, no functional bug today)
  - Spec section: §10.5; `DEVELOPMENT_GUIDELINES.md` §1.
  - Gap: `workspaceEmailPipeline.ts:71,124` opens `db.transaction(async (tx) => { … })` and issues `set_config('app.organisation_id', orgId, true)` directly, but does NOT wrap with `withOrgTx({tx, organisationId, source: ...})`. The RLS session var IS set, so writes are protected — but the AsyncLocalStorage org context is not extended. Any code inside the tx that tried `getOrgScopedDb()` would resolve to the OUTER tx, not this inner one.
  - Suggested approach: wrap each `db.transaction` block in `withOrgTx({tx, organisationId: orgId, source: 'workspaceEmailPipeline.send'}, ...)` matching the inbound-webhook pattern; preserve the `set_config` call.

## Test infrastructure hygiene

### TI-001: Make build-code-graph-watcher.test.ts parallel-safe
- File: scripts/__tests__/build-code-graph-watcher.test.ts
- Quarantine date: 2026-04-29
- Owner: unowned
- Reason: spawns `tsx scripts/build-code-graph.ts` subprocesses, holds the
  singleton lock at `references/.watcher.lock`, takes up to 120 s, and is
  destructive of in-flight watcher state. Pinned to single-fork to prevent
  collisions with any other test that touches the same lock or filesystem
  paths.
- Goal: refactor the test so its filesystem and subprocess effects are
  scoped to a temp directory + injected lock path, then remove the
  `poolMatchGlobs` entry and the `// @vitest-isolate` comment.
- Linked invariant: I-6 (quarantine contract with expiry pressure).
