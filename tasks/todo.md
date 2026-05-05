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
| 27 | **Security** | **[CLOSED 2026-05-05 — pre-launch-phase-2]** Security audit trail now lives in the dedicated `security_audit_events` table (migration 0281) with `securityAuditService` writing `auth.login.failure`, `auth.login.success`, oauth state events, abuse events. Sentinel-org row anchors orgless events; boot-time invariant in `securityAuditSentinelValidation.ts`. Stream split documented in `architecture.md` §Layer 4. | `server/services/securityAuditService.ts` + migration `0281_security_audit_events.sql` | MEDIUM |

### Noted (Lower Priority / Post-Testing)

- Route files exceeding 200-line limit: `subaccounts.ts` (758L), `permissionSets.ts` (587L), `llmUsage.ts` (524L), `portal.ts` (502L)
- Auth tokens stored in localStorage (XSS risk — migrate to httpOnly cookies later)
- ~~No React ErrorBoundary component~~ **[CLOSED 2026-05-05 — pre-launch-phase-2]** `client/src/components/ErrorBoundary.tsx` now ingests client errors via `/api/client-errors` endpoint (16kb tight body cap; rate-limited).
- Silent promise rejections in `workspaceMemoryService.ts`
- Missing cascade delete rules on parent-child task/agent relationships
- Deprecated columns in agents schema (`sourceTemplateId`, `sourceTemplateVersion`)
- ~~OAuth state JWT window too long (10 min, recommend 5 min)~~ **[CLOSED 2026-05-05 — pre-launch-phase-2]** Tightened to 5min. Revert decision pending telemetry — see deferred CHATGPT-R1-7.
- No refresh token rotation on OAuth integrations
- ~~JWT session expiry at 24h with no forced logout on password change~~ **[CLOSED 2026-05-05 — pre-launch-phase-2]** `passwordChangedAt` JWT iat invalidation wired with second-precision alignment (write-side `authService.resetPassword` floors to whole seconds; read-side `middleware/auth.ts` compares whole seconds with strict `>`). See KNOWLEDGE.md [2026-05-05] JWT iat invalidation.

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

### agentic-engineering-notes (2026-04-30)

**Source log:** `tasks/review-logs/chatgpt-spec-review-agentic-engineering-notes-2026-04-30T09-14-16Z.md`
**Spec:** `docs/agentic-engineering-notes-dev-spec.md`
**PR:** #243 — https://github.com/michaelhazza/automation-v1/pull/243
**Branch:** `claude/agentic-engineering-notes-WL2of`

- [ ] [user] **Standardise canonical log schema across all review agents** — ChatGPT Round 1 surfaced as F5: add a single invariant requiring all review-agent logs to conform to a shared schema `{ agent, timestamp, target, verdict, findings[], metadata }`, even if persisted as markdown. Deferred from this spec because it is a cross-agent contract change — scope is `pr-reviewer`, `spec-conformance`, `dual-reviewer`, `spec-reviewer`, `audit-runner`, `chatgpt-pr-review`, `chatgpt-spec-review`, and the future `adversarial-reviewer`. Adding it here would expand this spec's boundary from "add adversarial-reviewer" to "standardise log schemas across the review fleet." **Home:** the canonical contract belongs in `tasks/review-logs/README.md` (single source of truth for log conventions, already referenced by every agent definition); each agent's `.claude/agents/<agent>.md` then points to it. **Reconsider per trigger:** when Mission Control's parser starts losing fidelity on real findings, OR when a new review agent ships and surfaces a third schema variant. Until then, the existing per-agent verdict-header convention is sufficient and the cost of retrofitting all seven agents simultaneously outweighs the drift risk.

  **Round 2 additions (2026-04-30):** ChatGPT Round 2 surfaced two more cross-agent items with the same trigger condition (revisit when auto-invocation lands or when cross-agent log schema is designed) and the same canonical home (`tasks/review-logs/README.md`). Bundle with the F5 entry above when the standardisation work is picked up.

  - [ ] [user] **Idempotency invariant for adversarial-reviewer** — Round 2 F1: add an explicit invariant guaranteeing that a second run of `adversarial-reviewer` against an unchanged diff produces identical findings (or a documented "no-op, already reviewed" log). Implementation cost too high for Phase 1 manual non-blocking — would require a finding-fingerprint scheme, parsing the prior log, comparing fingerprints, and skipping or no-op'ing on match. Defer until auto-invocation lands (re-running on every push amplifies the noise risk). **Home:** belongs in the cross-agent log-schema work above — idempotency is naturally expressed via the `findings[]` fingerprint field if the canonical schema is designed first.
  - [ ] [user] **Log header schema fields (`gitHeadSha`, `filesChanged`)** — Round 2 F4: ChatGPT proposed adding `gitHeadSha` and `filesChanged` to every review log's Session Info header so logs are self-contained snapshots of what was reviewed. Deferred for two reasons: (1) asymmetry — none of the existing review-log producers (`pr-reviewer`, `spec-conformance`, `dual-reviewer`, `spec-reviewer`, `audit-runner`, `chatgpt-pr-review`, `chatgpt-spec-review`) emit these fields today, so adding them only to `adversarial-reviewer` creates the schema drift the F5 standardisation is meant to prevent; (2) Mission Control's parser has no read-side consumer for either field — adding them to the producer with no reader is dead weight until the dashboard surfaces them. Bundle with the F5 standardisation work so the header schema is designed once across all seven agents.

### lint-typecheck-post-merge-spec (2026-05-01)

**Source log:** `tasks/review-logs/chatgpt-spec-review-lint-typecheck-post-merge-spec-2026-05-01T02-26-36Z.md`
**Spec:** `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md`
**Branch:** `lint-typecheck-post-merge-tasks`

- [ ] [user] **Add concurrency guard to CI `lint_and_typecheck` job** — Round 1 ChatGPT finding: add `concurrency: group: lint-typecheck-${{ github.ref }}, cancel-in-progress: true` to prevent duplicate runs on rapid pushes. Out of scope for this spec's goal ("drive to exit 0, wire the gate"); valid CI optimization for a follow-up CI hygiene pass.

### subaccount-optimiser (2026-05-02)

**Source log:** `tasks/review-logs/chatgpt-spec-review-subaccount-optimiser-2026-05-01T23-47-38Z.md`
**Spec:** `docs/sub-account-optimiser-spec.md`
**PR:** #250 — https://github.com/michaelhazza/automation-v1/pull/250
**Branch:** `claude/evaluate-new-features-waqfY` (spec-authoring branch for F1/F2/F3 wave; F2 implementation will move to `claude/subaccount-optimiser` per the spec's branch metadata)

- [ ] [user] **F8 — Routing-uncertainty trigger refinement using `downstreamOutcome`.** ChatGPT R1 proposed coupling the trigger to outcome quality (low confidence + bad outcome rate, OR high secondLook + low improvement) instead of confidence/secondLook thresholds in isolation. Deferred because the refined heuristic requires baseline outcome-quality data the v1 deployment will produce — no point tuning thresholds against a guessed distribution. **Reconsider per trigger:** when 30+ days of `fast_path_decisions.downstreamOutcome` data accumulate post-launch, OR when an operator complains that a "cautious" agent is being flagged. Until then the simpler `confidence < 0.5 OR secondLook > 30%` trigger ships in v1.
- [ ] [user] **F10 — Periodic schedule-rebalancing job for daily optimiser cron.** Phase 2 backfill staggers cron registration by `created_at` hash across 6 hours, which prevents pg-boss storms at deploy time but does not rebalance when many sub-accounts are added at once post-deploy. Deferred because v1's expected creation cadence (1-2 sub-accounts per agency per week) does not produce noticeable drift. **Reconsider per trigger:** when sub-account creation rate exceeds ~10/day OR when pg-boss queue depth metrics show optimiser cron contention.
- [ ] [user] **F14 — Stateful empty-state UX for the suggestions section.** ChatGPT R1 proposed showing the section after first-ever appearance for a scope, then hiding only when transitioning from non-empty back to empty (vs current "hide whenever empty" rule). Deferred because the simpler rule aligns with `frontend-design-principles.md § Default to hidden`, and the stateful version introduces UX state that needs a design pass (when does "first-ever" fire — first scope view ever? first run produces a row? first time the operator dismisses everything?). **Reconsider per trigger:** v1.1 redesign of the dashboard, OR when operator feedback indicates the disappearing-section is causing confusion.
- [ ] [user] **R2-F3 — Cap-eviction category-diversity bias.** ChatGPT R2 proposed preferring to evict same-category-as-incoming first when the cap is full, falling back to global lowest priority. Deferred because the simple form has correctness risks — without a priority floor, it could evict a `critical` rec of the same category to make room for a `warn` rec of the same category. **Reconsider per trigger:** when production cap-eviction logs show one category persistently dominating the cap. At that point, design a correctness-safe variant (likely "prefer same-category at-or-below incoming severity" rather than unconditional category preference).
- [ ] [user] **R2-F7 — `evidence_version` for evidence-shape evolution.** ChatGPT R2 proposed adding an optional `evidence_version: number` to evidence shapes, included in the `evidence_hash` input, so evolving a shape doesn't trigger unintended re-surfacing across already-stored rows. Deferred because (a) `render_version` already covers the prompt-template change axis, and (b) pre-production posture means an evidence-shape change can ship with a one-shot DB rewrite — no deployed users to disrupt. **Reconsider per trigger:** when the first evidence-shape evolution is required AND the one-shot rewrite pattern is impractical (e.g. real customers in production by then).
- [ ] [user] **R3-F3 — Acknowledge-clear ramp threshold.** ChatGPT R3 proposed only clearing `acknowledged_at` if severity increased OR delta > 2× the per-category material threshold, so borderline oscillations don't aggressively re-surface acknowledged findings. Deferred because the existing `materialDelta` floors already absorb most micro-noise, and the 2× multiplier needs production data to tune. **Reconsider per trigger:** when operators report that just-over-threshold deltas are training them to ignore the surface.
- [ ] [user] **R3-F4 — Soft global per-scope cap across producing agents.** Current cap is `(scope, producing_agent_id)` = 10 open. ChatGPT R3 flagged future fragmentation risk: when multiple agents write recommendations to the same scope, an operator could see 10 from each producer with no upper bound. Deferred because v1 ships only one optimiser agent. **Reconsider per trigger:** when a second agent (Portfolio Health, system-monitoring, custom user agents) starts writing recommendations to the same scope.
- [x] ~~[user] **R4-F3 — Eviction priority reorder (severity → updated_at → category → dedupe_key).** ChatGPT R4 proposed moving `updated_at` to position 2 to remove alphabetical-category bias. Deferred because the R4-F1 namespace hard rule (`optimiser.agent.*` vs `optimiser.memory.*`) scopes all bias within one agent — within-namespace alphabetical ordering is a stable, arbitrary tiebreaker. **Reconsider per trigger:** production eviction logs show a specific category systematically dominating the cap within the same namespace in a way operators notice.~~ **SUPERSEDED 2026-05-02 by R5-F4 apply** — ChatGPT R5 surfaced concrete impact (`optimiser.agent.*` consistently dominates `optimiser.skill.*` every run, not arbitrary). Reorder applied to spec in commit `dd27581e`. No further action.
- [ ] [user] **R4-F5 — Bypass-once-per-cooldown-window guard.** ChatGPT R4 proposed tracking `last_escalation_bypass_at` and allowing severity-escalation cooldown bypass only once per cooldown window, to prevent warn→critical oscillation causing flip-flop re-surfacing. Deferred because the scenario requires multiple severity oscillations within one cooldown window — implausible in pre-production. **Reconsider per trigger:** post-launch production logs show cooldown-bypass or eviction patterns for specific categories that indicate oscillation.
- [ ] [user] **R3-F7 — "Ongoing for X days" UI persistence indicator.** `created_at` and `updated_at` are both stored; the UI today sorts by `updated_at` desc but doesn't surface persistence ("open for 5 days"). Deferred because v1's surface is "what to look at right now" — persistence indicators need an established operator workflow that benefits from them, which doesn't exist pre-launch. **Reconsider per trigger:** when v1.1 surface design picks up dashboard refinements, OR when operator feedback indicates persistence context would help triage.

### workflows-dev-spec (2026-05-02)

**Source log:** `tasks/review-logs/chatgpt-spec-review-workflows-dev-spec-2026-05-02T10-00-00Z.md`
**Spec:** `docs/workflows-dev-spec.md`
**PR:** #252 — https://github.com/michaelhazza/automation-v1/pull/252
**Branch:** `claude/workflows-brainstorm-LSdMm`

All ten items below are **architect-time runtime quotas / picks** — none are spec-blocking. They surface during the `architect` decomposition pass as concrete numbers / endpoints to pin in the implementation chunks.

- [ ] [user] **M1 — Define max approver pool size.** UI guard (picker shows up to N users) + query-time performance cap. Architect to pick at decomposition.
- [ ] [user] **M2 — Define max Ask fields per step.** Validator rule + UX field-count limit. Architect to pick at decomposition.
- [ ] [user] **M3 — Define max files per task before grouping becomes mandatory.** UI threshold based on strip overflow profiling. Architect to pick after first real task with many files.
- [ ] [user] **M4 — Timeout for /run/resume race window.** Confirm against §19 open extension-cap parameters. Architect-time confirmation.
- [ ] [user] **F21 — Max step count per run runtime quota (e.g. 10k).** §4.4 prevents structural infinite loops at validation; this guards against Approval-on-reject runtime cycles. Simple `max_steps_per_run` quota; architect to pick value.
- [ ] [user] **F23 — Fan-in result ordering by `task_sequence` of producing event.** §4.3 fan-in doesn't address result aggregation order; the right answer is "by `task_sequence` of the producing event" so downstream LLM inputs are deterministic. Architect to confirm during decomposition; depends on existing engine fan-in semantics.
- [ ] [user] **F24 — Permission drift policy (snapshot for gates, live for controls).** Spec already has the consistent split (snapshot for `workflow_step_gates.approver_pool_snapshot` per §5.1; live for Pause/Stop buttons per §7.5). Worth a one-line statement in §14 making this split explicit. Not a blocking gap — architect-time clarification.
- [ ] [auto] **F38 — Max concurrent steps per run / per org runtime quota.** Same family as F21 — runtime safety rail; bundle the picks.
- [ ] [auto] **F40 — Hard upper bounds (max tasks per run, max steps per task, max runtime duration).** Same family as F21 + M1–M3 — architect-time quotas.
- [ ] [auto] **F42 — Visibility timeout / stuck execution recovery.** Engine/worker-level concern; existing `createWorker()` + `withBackoff` primitives handle worker death. Architect to confirm the recovery semantics are wired correctly during decomposition.

---

### LAEL-RELATED — `External Call Safety Contract` abstraction (cross-feature, unscoped)

**Not a LAEL deliverable.** Extract the pattern from `llmRouter.ts` — `intent-record → external-side-effect → single-terminal-transition → ghost-arrival-detection → caller-owned-retry → observable-in-flight → best-effort-history` — into a reusable platform primitive so payments, webhook dispatch, integration adapters, and long-running agent tasks can all inherit it without reintroducing unsafe retry logic.

**Why it's filed here.** Called out post-in-flight-tracker merge + reinforced during LAEL reviews. Has no spec yet.

---

### deferred-items-pre-launch (2026-05-01)

*(R1 deferred items F6 and F8 resolved in Round 2 — applied to spec)*

---

## PR Review deferred items

### PR #250 — claude-evaluate-new-features-waqfY / subaccount-optimiser chunk 1 (2026-05-02 — ChatGPT review rounds 1–2)

- [ ] [user] **F9: Add concurrency / duplicate-execution test for upsertRecommendation** — `skipReasonCoverage.test.ts` covers the deterministic skip paths exhaustively (cooldown / hash_match / sub_threshold / cap / eviction). Untested today: the 23505-race catch path (`agentRecommendationsService.ts:419–432`) and the per-`(scope, agent)` advisory-lock concurrency. Add (a) a unit test that mocks a 23505 throw on INSERT and asserts the re-lookup returns `was_new: false` with the existing id, and (b) an integration test exercising two parallel `upsertRecommendation` calls against the same dedupe key, asserting exactly one new row + one no-op return. Pair with TI-005 follow-up if the integration harness lands first. Source: ChatGPT PR review round 1 — user-approved as recommended (defer). PR #250 — https://github.com/michaelhazza/automation-v1/pull/250.
- [ ] [user] **F10: `subaccount_display_name` "sometimes-present" contract — consider always-present-with-null** — `agentRecommendationsService.ts:602` conditionally spreads `subaccount_display_name` into the response; it's omitted entirely on non-subaccount rows. Spec §6.5 + the `AgentRecommendationRow` type both pin the field as `subaccount_display_name?: string`, and the existing client check (`AgentRecommendationsList.tsx:156`) handles undefined safely. Switching to always-present-with-null is a minor public-API contract change but a contract change — should be raised as a spec amendment, not an ad-hoc PR change. Defer until a real client-friction case justifies the contract widening. Source: ChatGPT PR review round 1 — user-approved as recommended (defer). PR #250 — https://github.com/michaelhazza/automation-v1/pull/250.

### PR #247 — claude-deferred-items-pre-launch-5Kx9P (2026-05-01 — ChatGPT review round 1)

- [ ] [user] **R1/F3a: Resume path lacks 500ms thread-context build timeout** — `agentResumeService.ts:96` calls `buildThreadContextReadModel(resumeConvId, organisationId)` without the 500ms `Promise.race` timeout that `agentExecutionService.ts:832` uses. A slow context build during resume could delay the run. Fix: extract the timeout pattern into a small helper (`buildThreadContextWithTimeout(convId, orgId, timeoutMs = 500)`) and call it from both sites. Severity: medium. Source: ChatGPT PR review round 1 — user decision: defer.
- [ ] [user] **R1/F3b: Thread-context version persistence is fire-and-forget** — `agentExecutionService.ts:856` writes `threadContextVersionAtStart` via `void db.update(...).catch(() => {})`. If the write fails, the prompt still injected the context but the DB has no record. Spec §2.2 invariant 3 (fail-open) makes this intentional, but drift detection downstream may misfire. Consider: either accept the drift (close as wontfix) or move version persistence into the same transactional boundary as run-start. Severity: low. Source: ChatGPT PR review round 1 — user decision: defer.
- [ ] [user] **R1/F4: `findActiveConnection` ordering does not prefer subaccount-specific over org-level** — `integrationConnectionService.ts` orders by `updatedAt DESC, createdAt DESC, id DESC`. ChatGPT suggests `(subaccount_id IS NOT NULL) DESC` as primary sort to prefer subaccount connections. No spec or contract documents the expected precedence; current single caller (`integrationBlockService`) only tests `if (conn)` so ordering has no behavioural effect today. If the policy is "subaccount-specific overrides org-level for the same provider", spec it first then implement. Severity: medium. Source: ChatGPT PR review round 1 — user decision: defer.
- [ ] [user] **R1/F6: `integrationBlockServicePure.test.ts` mutates `ACTION_REGISTRY` for setup** — Tests cast and mutate the global registry then restore. Vitest's default sequential file-level execution makes this safe today, but parallel test runs would flake. Refactor to dependency-injection (pass action lookup as a parameter) or `vi.spyOn` once the test architecture is revisited. Severity: low. Source: ChatGPT PR review round 1 — user decision: defer.

### PR #244 — claude-improve-ui-design-2F5Mg / tier-1-ui-uplift (2026-04-30 / 2026-05-01 — ChatGPT review rounds 1–3)

- [ ] [user] **R5/F5: Optimistic "Connected! Continuing execution…" copy precedes Sprint 3B guarantee** — `InlineIntegrationCard.tsx:81` shows "Connected! Continuing execution…" as soon as OAuth popup succeeds, but execution restart (Sprint 3B) isn't wired. Fix: either land Sprint 3B first, or soften copy to "Connected — run will resume shortly." and add a WebSocket run-state listener to transition the card away from optimistic state once Sprint 3B ships. Source: ChatGPT PR review round 5 — user decision: defer.
- [ ] [user] **R5/F9: Dismissed integration card state lost on reload** — `InlineIntegrationCard.tsx:54` has `// TODO(v2): persist dismissed=true via PATCH /api/.../messages/:id/meta`. In-memory only; card reappears after reload. Already scoped as v2 work by the author. Source: ChatGPT PR review round 5 — user decision: defer.
- [ ] [auto] **R5/F8: useOAuthPopup postMessage origin check may fail in split-origin deployments** — `useOAuthPopup.ts:15` uses `event.origin !== window.location.origin` which is correct for same-origin setups but blocks messages if the OAuth callback is served from a different subdomain (e.g. `api.example.com` vs `app.example.com`). Fix: replace `window.location.origin` with a configured `VITE_API_ORIGIN` env var, validated against an explicit allowlist. Do NOT loosen to a substring check — that opens a postMessage spoofing vector. Source: ChatGPT PR review round 5.
- [ ] [user] **R4/F1: Execution restart (Sprint 3B) not wired — resume route never re-enqueues the blocked run** — `resumeFromIntegrationConnect()` clears the blocked state but no executor is restarted and `resumeAgentRun()` is never called. The PR shipped Sprint 3A (blocked-state infrastructure + resume service) without Sprint 3B (execution restart wiring). Result: OAuth connect flow shows success but the run never continues. Sprint 3B must land before this feature is customer-facing. PR description must document this gap. Severity: critical. Source: ChatGPT PR review round 4 — user decision: defer.
- [ ] [user] **R4/F5: Thread context panel is UI-only — LLM does not receive thread context at run start or resume** — `worker/src/loop/systemPrompt.ts` has no reference to `conversationThreadContextService`. The spec labels the service "Chunk A — Thread Context doc + plan checklist"; injection into the system prompt is Chunk B. Acceptable staged rollout if PR description documents that the context panel is display-only until Chunk B ships. Severity: medium. Source: ChatGPT PR review round 4 — user decision: defer.
- [ ] [auto] **R4/F6: Cost model diverges from plan** — `conversationCostService` sums per-message `cost_cents` from `agent_messages`; plan expected run-linked `cost_aggregates` table (schema exists). Current implementation is functional but the spec/plan must be amended or the implementation aligned before the cost layer scales. Severity: medium. Source: ChatGPT PR review round 4.
- [ ] [auto] **R3/F11: Observability gaps in resume + patch paths** — `run_resumed` log (`agentResumeService.ts:144`) has `conversationId: ''` with TODO(v2) marker; `applyPatch` has no start log before DB reads; race-condition retry path doesn't log retry count. Low severity — consistent with existing codebase logging patterns, not a correctness issue. Fix: store `conversationId` on `agent_runs` at block time, add it to the log; optionally add a `thread_context_patch_start` log and a `thread_context_race_retry` log for the retry path. Source: ChatGPT PR review round 3.
- [ ] [auto] **F8: Integration tests still mix real DB + mocks (test-strategy posture)** — Severity low, scope architectural. ChatGPT round 1 explicitly flagged this as "not a blocker, but note it." Concern: false confidence on transaction boundaries, RLS behaviour, and idempotency invariants when mocks stand in for the DB inside otherwise-integration tests. Out of scope for this PR — overlaps with the existing TI-005 follow-up (`docs/superpowers/specs/2026-04-30-integration-tests-fix-brief.md`) and PR #239 round-1 deferred items F1/F4/F6 above. Fold into the integration-test harness PR. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-claude-improve-ui-design-2F5Mg-2026-04-30T20-13-29Z.md`. PR #244 — https://github.com/michaelhazza/automation-v1/pull/244.

### PR #239 — vitest-migration-2026-04-29 (2026-04-30 — ChatGPT review round 1)

All four items are technical and recommended for the TI-005 follow-up branch. The brief at `docs/superpowers/specs/2026-04-30-integration-tests-fix-brief.md` already scopes most of this work.

- [ ] [user] **F1: Centralised `testBootstrap()` / `withTestDb()` integration harness** — Severity high, scope architectural. Failing integration tests (`briefsArtefactsPagination.integration.test.ts`, `conversationsRouteFollowUp.integration.test.ts`, `incidentIngestorThrottle.integration.test.ts`, `incidentIngestorIdempotency.test.ts`) hit FK violations because hardcoded `TEST_ORG_ID = '00000000-0000-0000-0000-000000000001'` is never seeded, plus `mock is not defined` errors because `mock.module(...)` (node:test API) was left in place after the Vitest cutover. Fix: a single bootstrap helper that seeds canonical org/subaccount/user before integration runs, plus systematic conversion of `mock.module(...)` → `vi.mock(...)`. Maps directly to TI-005 brief Phase 1 (`docs/superpowers/specs/2026-04-30-integration-tests-fix-brief.md`). Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-vitest-migration-2026-04-29-2026-04-30T03-25-03Z.md`. PR #239 — https://github.com/michaelhazza/automation-v1/pull/239.
- [ ] [user] **F3: Flip integration CI job `continue-on-error: true` → `false`** — Severity medium. Currently green CI is theatre — the integration job can fail silently. Flip the flag once F1 lands and the integration suite is genuinely passing. Pair with F1 in the same PR. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-vitest-migration-2026-04-29-2026-04-30T03-25-03Z.md`. PR #239 — https://github.com/michaelhazza/automation-v1/pull/239.
- [ ] [user] **F4: Centralised `isIntegrationEnv` helper + `test.skipIf(!isIntegrationEnv)`** — Severity low, scope standard. Replace ~36 ad-hoc `process.env.NODE_ENV === 'integration'` checks with a single exported boolean (e.g. `tests/utils/isIntegrationEnv.ts`) and use `test.skipIf(!isIntegrationEnv)(...)`. Aligns with the existing PR #226 deferred item ("Centralise integration-test skip pattern") — fold both into one cleanup pass. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-vitest-migration-2026-04-29-2026-04-30T03-25-03Z.md`. PR #239 — https://github.com/michaelhazza/automation-v1/pull/239.
- [ ] [user] **F6: Vitest workspace project split (`vitest run --project unit` / `--project integration`)** — Severity low, scope architectural. CI currently runs `npm test` (which calls test:gates + test:qa + test:unit) for the unit job and `npx vitest run` for the integration job — same vitest config, NODE_ENV switch is the only difference. Long-term cleaner: a `vitest.workspace.ts` declaring two projects with separate include/exclude globs, then CI invokes `--project unit` vs `--project integration`. Don't design pre-emptively — fold into the F1 harness PR so the harness wires up to the integration project directly. Source: ChatGPT PR review round 1; session log `tasks/review-logs/chatgpt-pr-review-vitest-migration-2026-04-29-2026-04-30T03-25-03Z.md`. PR #239 — https://github.com/michaelhazza/automation-v1/pull/239.

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

- [x] **D11** — Signature template hard-coded; `WorkspaceTenantConfig` lookup unwired
  - Status: **Routed to Phase E plan** (`docs/superpowers/plans/2026-04-29-agents-as-employees.md` § Task E0b + Phase E exit checklist item 7). Tracked there; do not reopen here unless Phase E drops it.

- [ ] **D15** — `verify-workspace-actor-coverage.ts` not wired into a CI workflow (carried forward; awaiting CI infra)
  - Spec section: §16 acceptance criterion — "`verify-workspace-actor-coverage.ts` passes in CI"; plan Task A10 step 4.
  - Gap: `.github/workflows/` directory still does not exist in the repo. Acceptance criterion cannot currently be evaluated.
  - Suggested approach: confirm CI provider, wire the gate as a blocking step alongside `verify-rls-coverage.sh`. If CI is hosted outside `.github/workflows/`, document the integration point and add the same step there.

- [x] **D17** — Contract test fixtures pass `signature: null` though contract types `signature: string`
  - Status: **Routed to Phase E plan** (§ Task E0c + Phase E exit checklist item 8). Decided alongside D11/E0b.

- [x] **D19** — Inbound webhook bootstrap identity lookup uses raw `db` outside any tx
  - Status: **Routed to Phase E plan** (§ Task E0a + Phase E exit checklist item 6). Phase E adds another transaction-heavy flow on top of the same pipeline; fix lands as a prerequisite.

- [x] **D20** — Pipeline `db.transaction()` blocks not wrapped in `withOrgTx`
  - Status: **Routed to Phase E plan** (§ Task E0a + Phase E exit checklist item 6). Same wrapper rules apply to the migration service introduced in E1.

---

## ChatGPT PR Review Deferred — feat/agents-are-employees (PR #237)

Captured 2026-04-30 from ChatGPT review of [PR #237](https://github.com/michaelhazza/automation-v1/pull/237). Findings #4/#7/#11 deferred from the review as out-of-scope or pre-existing patterns. Findings #2/#5/#8/#9/#10 implemented in the same review session; #1/#3/#6 rejected as false positives.

- [x] **CR-237-1** — Backend switching guard on `/api/subaccounts/:id/workspace/configure`
  - Status: **Folded into Phase E plan** (`docs/superpowers/plans/2026-04-29-agents-as-employees.md` § Task E0 + Phase E exit checklist item 5). Tracked there from now on; do not reopen here unless Phase E drops it.

- [ ] **CR-237-2** — Mailbox client never paginates beyond first page
  - Issue: the server's `GET /api/agents/:agentId/mailbox` returns `{ messages, nextCursor }` (cursor-based, page size 50), but `AgentMailboxPage.tsx` only fetches the first page and discards `nextCursor`.
  - Why deferred: server is correct; this is a UX/perf improvement, not a correctness bug. Mailbox volumes today are well under 50 messages per agent.
  - Suggested approach: thread `nextCursor` through `getAgentMailbox(agentId, cursor?)` (already supported by client wrapper), append-load on scroll to bottom, and dedupe by message id when merging.

- [ ] **CR-237-3** — Audit silent `.catch(() => …)` blocks across workspace UI
  - Issue: ChatGPT flagged silent catches as "dangerous in admin flows". Some are intentional (`.catch(() => setIdentity(null))` = "no identity yet → render onboarding CTA"), others swallow real errors (e.g. `.catch(() => setThreadMessages([]))`).
  - Why deferred: codebase-wide pattern, not specific to this PR. Blanket-fix would regress UX (the "no identity yet" path).
  - Suggested approach: pass: classify each catch — if the error is a meaningful state ("not found"), keep the silent transition but log at `console.warn`. Otherwise surface a toast or error banner. Worth a focused sweep across `client/src/pages/Agent*Page.tsx` and the workspace components.

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

### TI-002 + TI-003: [DONE 2026-04-30] verify-test-quality.sh
Discovery guard + harness-leftover guard merged into a single gate at
`scripts/verify-test-quality.sh` (wired into `scripts/run-all-gates.sh`).
Enforces seven rules: file location under `__tests__/`, no `node:test` /
`node:assert` imports, no handwritten-harness leftovers (`asyncTest`,
`pendingTests`, `passed++`, `failed++`, `Promise.all(pendingTests)`,
`Promise<T>[] = []`, `tests.push(async () => test(...))`), no `process.exit`
in tests, every file has at least one `test()` / `describe()` / `it()`
block, no bare top-level `await`, no module-level `process.env.X = '...'`
without `??=` or restore hook. Currently 282 files scanned, 0 violations.

### TI-005: Fix all integration CI test failures (full execution brief) — DONE
- Captured: 2026-04-30 (after PR #239 surfaced 24 failures across 14 files)
- Closed: 2026-04-30 by branch `claude/integration-tests-fix-2026-04-30`. Closeout summary: [tasks/builds/integration-tests-fix/progress.md](./builds/integration-tests-fix/progress.md).
- Brief: [docs/superpowers/specs/2026-04-30-integration-tests-fix-brief.md](../docs/superpowers/specs/2026-04-30-integration-tests-fix-brief.md).
- Outcome: integration_tests CI job is now load-bearing (`continue-on-error` removed). Five phases shipped: seeder + CI wiring (1), incident-ingestor reset-guard relaxation + Vitest-mock rewrite of the throttle integration test (2), TI-005 lifecycle refactor of five files (3), constraint / suppression / RLS-superuser fixes (4), and the gate flip itself (5).
- ChatGPT round 1 (Codex P1, accepted): superuser short-circuit reports SKIPPED, not PASSED — `ctx.skip()` in four test bodies.
- ChatGPT round 2 (verdict APPROVED, three P2 follow-ups deferred — see TI-006 / TI-007 / TI-008 below).

### TI-006: Canonical subaccount UUID for integration fixtures
- Captured: 2026-04-30 (PR #241 ChatGPT round 2 P2.2)
- Source: [tasks/review-logs/chatgpt-pr-review-claude-integration-tests-fix-2026-04-30-2026-04-30T05-02-40Z.md](./review-logs/chatgpt-pr-review-claude-integration-tests-fix-2026-04-30-2026-04-30T05-02-40Z.md)
- Issue: `scripts/seed-integration-fixtures.ts` uses `gen_random_uuid()` for the seeded subaccount. Tests rely on the "anchor" pattern — `SELECT … FROM organisations JOIN subaccounts … LIMIT 1` — which works while the seeded org has only one subaccount but becomes ambiguous if a future seed (or test) inserts a second. Pin a canonical UUID like `00000000-0000-0000-0000-000000000010` so seed inserts and test references stay deterministic; document the anchor-selection contract.
- Effort: 30 min. Touches `scripts/seed-integration-fixtures.ts` and the small handful of test files that read the anchor (currently only `workspaceMemoryService.test.ts`).

### TI-007: Integration test conventions doc — real-DB vs mocked-DB rule
- Captured: 2026-04-30 (PR #241 ChatGPT round 2 P2.3)
- Source: [tasks/review-logs/chatgpt-pr-review-claude-integration-tests-fix-2026-04-30-2026-04-30T05-02-40Z.md](./review-logs/chatgpt-pr-review-claude-integration-tests-fix-2026-04-30-2026-04-30T05-02-40Z.md)
- Issue: the `*.integration.test.ts` glob now contains a mix of real-DB tests and tests that mock the DB at the module boundary (e.g. `incidentIngestorThrottle.integration.test.ts` mocks `db`, `getPgBoss`, `logger`). Both shapes are intentional, but the convention is implicit; future contributors may misread the file naming as "always real DB". Write a short convention note ("integration tests may mock external boundaries but must preserve DB contract OR explicitly declare isolation in the file header") and link it from CLAUDE.md / `references/`.
- Effort: 15 min.

### TI-008: Configure CI with a non-superuser app role for RLS coverage
- Captured: 2026-04-30 (PR #241 ChatGPT round 2 P2.4 — also flagged in the closeout follow-ups)
- Source: [tasks/review-logs/chatgpt-pr-review-claude-integration-tests-fix-2026-04-30-2026-04-30T05-02-40Z.md](./review-logs/chatgpt-pr-review-claude-integration-tests-fix-2026-04-30-2026-04-30T05-02-40Z.md), [tasks/builds/integration-tests-fix/progress.md](./builds/integration-tests-fix/progress.md)
- Issue: CI's integration_tests job connects as the `postgres` superuser. Superusers bypass RLS unconditionally, so `rls.context-propagation.test.ts` and `crmQueryPlanner/__tests__/integration.test.ts` skip themselves at runtime via `ctx.skip()` — the cases are reported as SKIPPED rather than asserting tenant isolation. Provision a non-superuser app role in CI (a Postgres init script or a setup step that `CREATE ROLE app_test WITH LOGIN INHERIT` and grants admin_role membership) and connect `DATABASE_URL` as that role; then drop the `runningAsSuperuser` short-circuits in both files.
- Effort: 60 min. Touches `.github/workflows/ci.yml` plus the two test files (revert the runtime check + `ctx.skip()` once the role is in place).

### [DEPRECATED — see brief above] TI-005 (original): Refactor 2 legacy integration tests to vitest-idiomatic structure
- Captured: 2026-04-30
- Files:
  - `server/services/crmQueryPlanner/__tests__/integration.test.ts`
  - `server/services/__tests__/workspaceMemoryService.test.ts`
- Reason: Both use a flat `if (!SKIP) { ... } else { test.skip(...) }` module-
  level structure with column-0 `await` for tsx-runnable compatibility. Both
  carry `// guard-ignore-file: test-quality reason="..."` to bypass the
  test-quality gate. Concrete bug in workspaceMemoryService: `await
  client.end()` runs at module load — closes the DB before the registered
  test() blocks run. Currently masked because CI uses `NODE_ENV=test` and
  the entire file skips.
- Goal: convert each to `describe.skipIf(SKIP)('...', () => { beforeAll(...);
  afterAll(...); test(...); })`. Remove the guard-ignore directives. Verify
  by running with `NODE_ENV=integration` against the integration CI job.
- Linked: blocks flipping `.github/workflows/ci.yml` integration job from
  `continue-on-error: true` → `false`.

## Deferred from spec-conformance review — tier-1-ui-uplift (2026-04-30)

**Captured:** 2026-04-30T10:51:32Z
**Source log:** `tasks/review-logs/spec-conformance-log-tier-1-ui-uplift-2026-04-30T10-51-32Z.md`
**Spec:** `tasks/brief-tier-1-ui-uplift.md` (operationalised by `tasks/builds/tier-1-ui-uplift/plan.md`)

These are directional gaps where the implementation diverges from the plan in ways that need a human design decision (keep the new approach and amend the plan, or restore the planned approach). None are mechanical fixes; all require triage before merge.

- [ ] **B-D1 — Cost rollup approach diverges from canonical I-5 pattern.**
  - Spec section: plan §1 I-5; §4.3 (canonical SQL block); brief §5 (run→conversation linkage)
  - Gap: Plan I-5 mandates `SELECT DISTINCT triggered_run_id FROM agent_messages` JOINed to `cost_aggregates` as the single allowed implementation. The implementation instead added new columns (`cost_cents`, `tokens_in`, `tokens_out`, `model_id`) directly on `agent_messages` (migration 0262) and reads cost from those — bypassing both `triggered_run_id` and `cost_aggregates`.
  - Suggested approach: Decide whether (a) the on-row approach is better and amend plan §1 I-5 to declare it canonical (then update §11 deferred items to drop `triggered_run_id` enforcement); or (b) revert to the canonical query, drop migration 0262's columns, and add `triggered_run_id` to `agent_messages` per plan §11 backlog item. Picking (a) is faster and avoids a backfill but locks future cost surfaces (per-skill, org-wide) into the same pattern; picking (b) preserves the plan's "single canonical implementation" intent.

- [ ] **B-D2 — `ConversationCostResponse.runCount` field renamed to `messageCount`.**
  - Spec section: plan §4.3 TypeScript interface
  - Gap: plan defines `runCount` (count of distinct runs that produced ≥1 user-visible message); implementation returns `messageCount` (count of assistant messages). Per-model breakdown shape also differs (`messageCount` vs `runCount`).
  - Suggested approach: tie this to B-D1 — if (a) is chosen, the field name change is acceptable but needs the plan amended; if (b) is chosen, restore `runCount` to match the canonical implementation.

- [ ] **A-D1 — Thread Context not injected at run start; resume re-injection missing.**
  - Spec section: plan §6.2 ("Modify `agentExecutionService.ts`"), §2.4 E-7, §7.3 ("re-inject `buildThreadContextReadModel(conversationId, orgId)`")
  - Gap: `buildThreadContextReadModel` is exported and consumed by the `GET /thread-context` route, but **not** called inside `agentExecutionService.ts`. As a result the LLM never sees the conversation's tasks/approach/decisions during execution; the right-pane display works in isolation. `runMetadata.threadContextVersionAtStart` is also never written. Resume path (Chunk E) similarly does not re-inject.
  - Suggested approach: at run start (after the system prompt is assembled), call `buildThreadContextReadModel(conversationId, orgId)` and prepend its formatted projection as a system message. Capture `version` into `runMetadata.threadContextVersionAtStart`. Mirror the same call inside `resumeFromIntegrationConnect` after the optimistic UPDATE succeeds, before re-executing the blocked tool call. This is the highest-impact fix in the list — without it Chunk A's LLM-side value is missing entirely.

- [ ] **A-D2 — Concurrency guard does not use `version = ?` predicate.**
  - Spec section: plan §6.5 ("Concurrency guard: patch application is wrapped in `BEGIN; SELECT … FOR UPDATE; UPDATE … WHERE id = ? AND version = ?; COMMIT`")
  - Gap: `applyPatch` does a plain UPDATE-by-id without the version predicate. The race-retry path on insert collision applies the patch to the concurrent row's state (which is correct), but the UPDATE path on existing rows is non-versioned, so two concurrent writers on an existing row can produce a silent lost write.
  - Suggested approach: wrap the existing-row UPDATE in `WHERE id = ? AND version = ?` with the snapshot version captured at the start of `applyPatch`. On 0 rows updated (lost race), reload, re-apply, retry once. After 2 failures throw `CONCURRENT_PATCH_FAILURE` per plan. Acceptance test from §6.7 needs to exercise the failure path.

- [ ] **A-D3 — Migration 0264 RLS policy uses single combined `USING` clause.**
  - Spec section: plan §6.4 ("Three-layer policy (`organisation_id = app.organisation_id`)")
  - Gap: migration creates `CREATE POLICY conv_thread_ctx_org_isolation … USING (organisation_id = current_setting('app.organisation_id', true)::uuid)` — single policy, no separate `WITH CHECK`. Architecture.md § Row-Level Security canonical template typically separates `USING` and `WITH CHECK` for INSERT vs SELECT enforcement.
  - Suggested approach: align with the canonical template in `architecture.md § Row-Level Security` — most existing tenant tables use a paired `USING` + `WITH CHECK` policy. Confirm the canonical template and either add a corrective migration or document why a single combined clause is sufficient here.

- [ ] **E-D1 — `agent_runs.status` enum extended despite plan rejecting this approach.**
  - Spec section: plan §2.4 E-1 ("Parallel `blocked_reason` + `integration_resume_token` columns; status enum NOT extended … Rejected: extending the `status` enum")
  - Gap: `'blocked_awaiting_integration'` was added to the `agentRuns.status` type union (`server/db/schema/agentRuns.ts:92`) and is set by `agentExecutionService.ts` at lines 285, 1375, 2823. This contradicts the explicit "rejected" decision in the plan. The parallel `blocked_reason` column is also set, so both are now used.
  - Suggested approach: pick one approach and document. If keeping the status-extension, amend plan §2.4 E-1 (and document why every status-switching consumer was reviewed for the new value); also remove the redundant `blocked_reason = 'integration_required'` writes since the status is enough. If reverting, drop the new status value, restore the parallel-column-only pattern, and audit consumers (workspace health, dashboards) for any switch on the new status.

- [ ] **E-D2 — Resume already-resumed validation incomplete.**
  - Spec section: plan §7.5 ("validates both `runMetadata.lastResumeTokenHash === sha256(submittedToken)` and `runMetadata.lastResumeBlockSequence === token.blockSequence`")
  - Gap: `agentResumeService.ts:78` checks only `candidateMeta.lastResumeTokenHash === tokenHash`. The submitted token's `blockSequence` is not extracted (the token is a 32-byte random string with no embedded blockSequence) and not validated against `runMetadata.lastResumeBlockSequence`. As a result a stale token from block N could match the idempotent-success path even when block N+1 is currently active.
  - Suggested approach: either (a) bind the blockSequence into the token (e.g. `${blockSequence}.${randomHex}` and parse on resume), or (b) accept the gap and document it as a v1 limitation in plan §7.5. The gap is currently shielded by the optimistic-predicate UPDATE clearing `integration_resume_token` on resume — so a stale token from a *prior block* would not match the candidate read either, because the column is NULL after resume. Re-verify whether the actual replay-attack class is reachable before committing to a fix.

- [ ] **E-D3 — `integrationBlockService` is a stub; the entire block-on-integration feature is inert.**
  - Spec section: plan §7.2 ("Files to create"), §7.7 ("acceptance criteria — first row")
  - Gap: `integrationBlockService.checkRequiredIntegration` always returns `{ shouldBlock: false }` (file lines 67-75). The TODO comment on lines 52-66 describes the intended ACTION_REGISTRY-lookup logic. Consequence: the integration-block branch in `agentExecutionService.ts:2756` never fires in production — runs do not pause for missing integrations, no integration_card messages are emitted to conversations, the OAuth resume flow is unreachable from the agent loop. The infrastructure (token issuing, optimistic-resume UPDATE, expiry sweep) is correct but unused.
  - Suggested approach: implement the body of `checkRequiredIntegration` per the TODO. (i) Add a `requiredIntegration?: string` field to `ActionDefinition` in `actionRegistry.ts`. (ii) Tag the actions known to require external connections (Notion, Gmail, GHL, Slack, etc.). (iii) In `checkRequiredIntegration`, look up the action's `requiredIntegration`, query `integration_connections` for `(organisation_id, provider_type, connection_status='active', oauth_status='active')`, and call `generateBlockDecision(...)` if absent. This is roughly half a day of work and unblocks the entire feature.

- [ ] **E-D4 — `tool_not_resumable` enforcement missing for `unsafe` strategies.**
  - Spec section: plan §7.5 ("`unsafe` strategies are NOT permitted to participate in blocking — if a tool whose handler is `unsafe` ends up in `runMetadata.blockedToolCall`, the resume rejects with `errorCode: 'TOOL_NOT_RESUMABLE'`")
  - Gap: `integrationBlockService.ts:62-65` has TODO comment only. Currently no `unsafe` actions exist (every entry declares `'read_only' | 'keyed_write' | 'locked'`), so the gap is theoretical until a future action is registered with `unsafe`. But the plan explicitly named this as the safety guard.
  - Suggested approach: add the check inside `checkRequiredIntegration` once E-D3 is closed. Throw `{ statusCode: 409, errorCode: 'TOOL_NOT_RESUMABLE', toolName }` and have the caller catch it in `agentExecutionService.ts`, transition the run to `cancelled` with `cancelReason: 'tool_not_resumable'`, and emit a non-card error message. Pair with a unit test that registers a fake `unsafe` action and asserts the cancellation path.

- [ ] **E-D5 — OAuth callback does not pass `conversationId` to `resumeFromIntegrationConnect`.**
  - Spec section: plan §7.3 (resume endpoint receives `conversationId`); §7.4 (resume validates `agent_conversations.user_id === req.user.id`)
  - Gap: `oauthIntegrations.ts:273` calls `resumeFromIntegrationConnect({ resumeToken, organisationId })` without `conversationId`. The `payload.conversationId` is destructured from JWT into the cast type but discarded. `agentResumeService.ts:44` accepts `conversationId?` but never uses it. Net effect: the OAuth-callback resume path bypasses any conversation-ownership check at the resume boundary.
  - Suggested approach: pass `payload.conversationId` through to the resume service. In `agentResumeService.ts`, when a `conversationId` is provided, additionally validate that the run's conversation matches and that the conversation owner matches the OAuth-callback user (the JWT's user). The popup-postMessage path through `POST /api/agent-runs/resume-from-integration` already has user-auth via `requireOrgPermission(AGENTS_CHAT)`; this gap is specific to the server-side OAuth-callback path.

- [ ] **E-D6 — `dismissed` state is client-local only; no PATCH endpoint persists it.**
  - Spec section: plan §7.3 ("Only `dismissed` is persisted"), §7.7 ("Click `Dismiss` → card collapses to a 1-line stub")
  - Gap: `InlineIntegrationCard.tsx:54` has `// TODO(v2): persist dismissed=true via PATCH /api/.../messages/:id/meta`. Local React state holds the dismissed flag for the session; on page reload the card returns to its undismissed state. Dismiss is therefore not durable.
  - Suggested approach: add `PATCH /api/agents/:agentId/conversations/:convId/messages/:messageId/meta` route accepting `{ dismissed: true }` and updating `agent_messages.meta.dismissed`. RLS-protected via the existing conversation ownership check. Or document that v1 ships with session-only dismissal and amend plan §7.3 accordingly.

- [ ] **D-D1 — Email tile renders placeholder instead of inline config UI.**
  - Spec section: plan §8.1 ("Click expands to show the existing email/mailbox config UI"), §8.6 acceptance criteria
  - Gap: `InvocationsCard.tsx:626-637` shows static placeholder text instead of an embedded mailbox/inbound-email editor. The other channels (Scheduled, Webhook) host their existing UIs inline.
  - Suggested approach: confirm with the brief author whether per-agent email config currently exists. If yes, embed it. If no (email is workspace-wide-only), update plan §8.1 to clarify that Email is a "view-only / managed elsewhere" tile in v1 — the placeholder text then becomes a feature, not a gap.

- [ ] **Cross-1 — Plan §11 deferred item `triggered_run_id` write-layer enforcement is moot under the implemented approach.**
  - Spec section: plan §11 ("`triggered_run_id` write-layer enforcement (B)")
  - Gap: this item assumed cost rollup would key off `triggered_run_id`. With the implemented on-row cost approach (B-D1), `triggered_run_id` is no longer load-bearing for cost. The §11 backlog item should either be retired or rescoped to a different surface that relies on it.
  - Suggested approach: tie to the B-D1 decision. If (a) is chosen, drop §11's `triggered_run_id` enforcement item; if (b) is chosen, keep it as planned. Either way the plan needs an amendment so future readers do not chase a deferred item that no longer maps to the code.

---

## Deferred from spec-conformance review — external-doc-references (2026-04-30)

**Captured:** 2026-04-30T11:21:30Z
**Source log:** `tasks/review-logs/spec-conformance-log-external-doc-references-2026-04-30T11-21-30Z.md`
**Spec:** `docs/external-document-references-spec.md`

- [ ] REQ #C1 — `runContextData.externalDocumentBlocks` is computed but never injected into the system prompt
  - Spec section: §9.1 "Where external references inject" + §13.6 "agentExecutionService.ts add 'google_drive' branch"
  - Gap: `loadExternalDocumentBlocks` returns assembled provenance+content blocks on `runContextData.externalDocumentBlocks`, but `agentExecutionService.executeRun()` never reads or appends them. The Knowledge Base block in `buildSystemPrompt` only consumes `runContextData.eager`. As a result, attached Drive references resolve, write `document_fetch_events` rows, and update `attachment_state` — but their content never reaches the LLM.
  - Suggested approach: extend `agentExecutionService` to merge `externalDocumentBlocks` into the prompt (either folded into `dataSourceContents` as pseudo-sources, or as a sibling section after the Knowledge Base block). Decide whether the existing 60K-token Knowledge-Base budget governs the merged set or only the eager sources. Document the choice in the spec or an addendum.

- [ ] REQ #C2 — Resolver write atomicity contract not honoured
  - Spec section: §17.8 "Resolver write atomicity"
  - Gap: spec mandates the cache upsert + `document_fetch_events` append + `reference_documents.attachment_state` update execute in a single transaction using the caller's scoped DB client. Implementation in `externalDocumentResolverService.ts` opens its own `db.transaction(...)` only around the cache upsert; the audit-log insert and `transitionState` happen on module-level `db` outside any transaction. `params.db` is accepted but unused.
  - Suggested approach: thread the caller's scoped DB client through every write, or document an explicit deviation from §17.8 in the spec. The current single-flight + advisory-lock arrangement is intentional per plan invariant #1, so the deviation may be defensible — but it must be made explicit and the log/audit-row consistency surfaced (e.g., what happens if cache upsert succeeds and audit insert fails).

- [ ] REQ #C3 — Route paths and permission keys diverge from spec §10.2 / §12.2
  - Spec section: §10.2, §12.2, §13.7
  - Gap: spec lists routes as `POST /api/tasks/:taskId/external-references` etc. with permission `org.tasks.manage`. Implementation registers `POST /api/subaccounts/:subaccountId/tasks/:taskId/external-references` etc. with `WORKSPACE_MANAGE`. The route shape is consistent with the broader codebase's subaccount-scoped convention, and `WORKSPACE_MANAGE` may be the correct local equivalent of `org.tasks.manage`. Both need an explicit decision.
  - Suggested approach: amend the spec to acknowledge the codebase's actual `/api/subaccounts/:subaccountId/...` convention, or migrate the routes to match the spec verbatim. Either way, document the permission-key mapping (`org.tasks.manage` → `WORKSPACE_MANAGE`?) in `architecture.md` so the next reviewer doesn't re-flag it.

- [ ] REQ #C4 — Picker-token and verify-access routes lack permission guard
  - Spec section: §12.2 "Route guards"
  - Gap: spec requires `requirePermission('org.integrations.manage')` on `GET /api/integrations/google-drive/picker-token` and `GET /api/integrations/google-drive/verify-access`. Implementation only has `authenticate` — anyone authenticated against the org can mint a picker token or probe Drive metadata for any connection in the org.
  - Suggested approach: add the missing permission middleware. Verify the equivalent local permission key (likely `INTEGRATIONS_MANAGE` or similar) and apply it to both routes.

- [ ] REQ #C5 — Per-task connection_id validation does not check subaccount scope
  - Spec section: §10.4, §12.2
  - Gap: attach + scheduledTasks + agents data-source routes call `getOrgConnectionWithToken(connectionId, req.orgId!)` and check `providerType === 'google_drive'` and `connectionStatus === 'active'`. They do not verify that the connection belongs to the *caller's subaccount*. A user attaching to subaccount A could supply a connection_id that belongs to subaccount B in the same org.
  - Suggested approach: add a subaccount equality check (`conn.subaccountId === subaccountId`) on every attach path. Return `422 invalid_connection_id` per spec §17.6 when the check fails.

- [ ] REQ #C6 — `invalid_connection_id` error code not used
  - Spec section: §17.6 "Unique constraint HTTP mapping"
  - Gap: spec mandates `{ "error": "invalid_connection_id" }` for invalid-connection cases. Implementation returns `connection_not_found` (404) or `connection_not_active` (422) instead. Splitting into two error codes loses information for the client and diverges from the contract.
  - Suggested approach: either adopt the spec's single `invalid_connection_id` code (matching §17.6 verbatim) or amend the spec to allow the more granular pair. Pick one and align both server + client.

- [ ] REQ #C7 — `ExternalDocumentRebindModal` missing "Remove reference instead" button
  - Spec section: §10.5 "Re-attach modal"
  - Gap: spec lists five elements of the modal, including a "Remove reference instead" text button. Implementation has Cancel + Re-attach only. A user who realises mid-rebind that they don't want the reference at all has to close, scroll back to the broken row, and click delete.
  - Suggested approach: add a tertiary "Remove reference instead" button in the modal footer that calls `removeExternalReference(...)` and closes both the modal and (if applicable) refreshes the parent's reference list.

- [ ] REQ #C8 — `cache_minutes` / TTL fallback path for null-revisionId not exercised
  - Spec section: §7.2 "Null revisionId path"
  - Gap: spec defines a TTL-based freshness fallback when `checkRevision()` returns null (provider offered no revision token). Implementation in `externalDocumentResolverService.doResolve` treats null revisionId the same as a mismatched revision (always refetches), with no TTL check. This produces a permanent cache-miss loop for any provider/file that has no revisionId — the exact failure mode §7.2 was written to prevent.
  - Suggested approach: add the spec's null-revisionId branch — if `meta.revisionId === null` and the cache row's `revision_id` is also null, compare `cacheRow.fetchedAt` against `now() - cache_ttl_minutes` (default 60 minutes per §7.2) and serve cached content if within TTL. Otherwise refetch. Pull the TTL value from the spec's named constant (add it to `server/lib/constants.ts` if not present).

- [ ] REQ #C9 — `EXTERNAL_DOC_RESOLVER_VERSION` constant referenced by plan but absent
  - Spec section: §13.6 implementation notes; plan Phase 2 task list
  - Gap: plan Phase 2 task list (line 1113) names `EXTERNAL_DOC_RESOLVER_VERSION` as a constant to add to `server/lib/constants.ts`. Spec §6.3 explicitly says "no separate global constant" — the resolver's own `resolverVersion` property is the source of truth. Implementation matches the spec (no global constant, resolver carries `resolverVersion: 1`). The plan disagrees with the spec.
  - Suggested approach: spec is authoritative; this is informational. Update the plan to remove the misleading line so future contributors don't add a redundant constant.

- [ ] REQ #C10 — `loadExternalDocumentBlocks` injects placeholder lines that are not part of the spec's provenance contract
  - Spec section: §9.3 "Provenance metadata", invariant #10 "Deterministic ordering under failure"
  - Gap: implementation emits `[External document "{name}" skipped: {reason}]` for skipped/over-quota/budget-blown references. Plan invariant #10 specifies a specific shape: `--- Document: <name>\nStatus: skipped (reason: <reason>)\n---`. Current placeholders use a different format that mixes square brackets and colon-separated reasons rather than the document-block shape that mirrors the success case.
  - Suggested approach: align the placeholder format with invariant #10's prescribed shape. Reuse `buildProvenanceHeader` or extract a sibling helper so a future schema change to the header propagates uniformly.

- [ ] REQ #C11 — Wall-clock budget enforcement does not write `document_fetch_events` rows
  - Spec section: §6.5 "Provider call timeouts" / plan invariant #2 "Hard-fail timeout"
  - Gap: when `EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS` is exceeded mid-loop, `loadExternalDocumentBlocks` pushes a placeholder string into `blocks` and continues. No `document_fetch_events` row with `failure_reason = 'budget_exceeded'` is written for the skipped reference. Spec §17.5 ("no-silent-partial-success") requires every failure path to produce a visible audit trace.
  - Suggested approach: when the wall-clock budget is exceeded, write a `document_fetch_events` row directly (or call a helper on the resolver) with `failure_reason = 'budget_exceeded'`, `cache_hit = false`, `tokens_used = 0` for each skipped reference. Same treatment for the over-quota loop at the bottom of the function.

- [ ] REQ #C12 — Spec authoritative path mismatch with user invocation
  - Spec section: §13.7 — file inventory
  - Gap: user's invocation listed expected files including `client/src/lib/externalDocumentReferences.ts` (api client) and `client/src/components/GoogleDrivePickerButton.tsx`. Actual files are `client/src/api/externalDocumentReferences.ts` and `client/src/components/DriveFilePicker.tsx`. The actual paths are consistent with the spec (§13.9 names `DriveFilePicker.tsx`); the user's invocation message had stale names. Informational only — not a code gap.
  - Suggested approach: no action; flagged so future readers of this log can reconcile the user's invocation text with the actual file paths.

- [ ] PDF support requires `pdf-parse` dependency declaration (dual-reviewer 2026-04-30)
  - Source: dual-reviewer Codex P2 finding on `client/src/components/DriveFilePicker.tsx:4-7`
  - Spec section: §9.3 "MIME types" — PDF (`application/pdf`) is listed as Supported (line 384)
  - Gap: `server/services/resolvers/googleDriveResolver.ts` PDF branch dynamically imports `pdf-parse`, but the package is not declared in `package.json` dependencies. Every PDF picked through `DriveFilePicker.tsx` will fetch bytes and then fall into `unsupported_content` at run time, marking the reference `broken`.
  - Why deferred: dual-reviewer cannot edit `package.json` without explicit human approval (config-protection hook). Two fixes are possible:
    - **Preferred (spec-aligned):** add `"pdf-parse": "^1.1.1"` to `package.json` dependencies. Verify the dynamic import path matches the package's main export. This requires HITL approval to edit `package.json`.
    - **Alternative (capability-aligned):** drop `'application/pdf'` from `SUPPORTED_MIME_TYPES` in `client/src/components/DriveFilePicker.tsx` and from the resolver's `SUPPORTED_MIME_TYPES` set, plus update spec §9.3 to mark PDF as deferred to a follow-up.
  - Recommended action: take the preferred fix (add pdf-parse to package.json) on the next manual session; spec already promises PDF support.

---

## Deferred: agentic-engineering-notes follow-ups (2026-04-30)

**Branch:** `claude/agentic-engineering-notes-WL2of`

### D1. adversarial-reviewer chunk-slug gap

`tasks/review-logs/README.md:98` includes `[-<chunk-slug>]` in the log filename template for `adversarial-reviewer`. The agent definition (`adversarial-reviewer.md:55`) only specifies the non-chunk form. Currently moot — auto-invocation from `feature-coordinator` is deferred and the agent is manual-only. When auto-invocation lands, add chunk-slug handling to the agent definition and verify the README template remains consistent.

### D2. CLAUDE.md Task Classification table gap

`CLAUDE.md` Task Classification table (Significant and Major rows) mentions `dual-reviewer` as optional but does not mention `adversarial-reviewer`. The review pipeline (step 4) is correct. A future CLAUDE.md edit should add `adversarial-reviewer optionally — only if the user explicitly asks` to the Significant and Major rows to match the pattern.

### D3. logParsers.test.ts second adversarial test missing timestampIso assertion

`tools/mission-control/server/__tests__/logParsers.test.ts` — the second adversarial-review test (`parses adversarial-review log with hyphenated slug`) does not assert `timestampIso`. Consider adding `eq(m!.timestampIso, '2026-04-30T09:15:22Z', 'iso')` to lock the normalisation path for hyphenated slugs.

### D4. Spec § 4.2 input-detection wording contradicts § 4.1 tools list

`docs/agentic-engineering-notes-dev-spec.md` § 4.1 declares the agent has tools `Read, Glob, Grep` (no Bash); § 4.2 instructs "Same auto-detection logic as `spec-conformance` (committed + staged + unstaged + untracked)" — which requires shell access `spec-conformance` has but this agent does not. `dual-reviewer` (Codex pass) flagged this as `[P2] Give the agent a way to detect the diff` (`tasks/review-logs/dual-review-log-agentic-engineering-notes-*.md`). The agent definition has been updated in-branch to make the contract self-consistent (caller provides the changed-file set, mirroring `pr-reviewer`'s posture). The spec § 4.2 wording should be aligned in a follow-up commit — drop the "auto-detection" clause and replace with "caller provides the changed-file set, same posture as `pr-reviewer`." Same wording symmetry applies to whatever invocation snippets exist for `adversarial-reviewer`.

---

## Deferred from ChatGPT PR review — external-doc-references (2026-05-01)

**PR:** #242 (claude/agency-email-sharing-hMdTA)
**Source:** ChatGPT Round 1 review

### D-GPT-1: Retry suppression is process-local — multi-instance stampede risk

`server/services/externalDocumentRetrySuppression.ts` — `RetrySuppressor` uses an in-memory `Map`. Under multi-node deployment each instance suppresses independently; a failing document gets hammered once per instance per suppression window instead of once globally.

Options:
- Lightweight: read `document_fetch_events` for the reference and check `fetched_at > now() - suppression_window` before retrying. Adds one DB read per resolve call on the hot path.
- Preferred: persist `suppressUntil` to a shared cache (Redis or a `document_suppression` table). Requires infra decision.
- Minimum viable: note the single-node assumption in a code comment so future multi-node work doesn't miss this.

### D-GPT-2: Token counting uses character-approximation throughout

`server/services/externalDocumentResolverPure.ts` — `countTokensApprox` uses `Math.ceil(charCount / 4)`. Final prompt assembly re-uses the same approximation, so in theory the assembled prompt could exceed a model's true token limit by the approximation error margin (typically ±5–10% for structured data).

Fix when real token budget accuracy matters: add `tiktoken` or `@anthropic-ai/tokenizer` for a final boundary check after prompt assembly. Keep the approximation for all pre-checks (it's fast and conservative enough there).

### D-GPT-3: attachment_order defaults to 0 — ordering relies on created_at tiebreaker

`migrations/0262_external_doc_refs_google_drive.sql` — `attachment_order DEFAULT 0`. All newly attached references land at order 0, so ordering falls back to `created_at` ascending. This is deterministic but not semantically meaningful.

Address when a reordering UI is added: expose explicit `attachment_order` assignment on insert (e.g., `MAX(attachment_order) + 1` per bundle) and add an API endpoint for reorder operations.

### D-GPT-4: Additional observability signals missing

The `document_fetch_events` table is well-designed but the following runtime signals are not emitted:
- Retry suppression hits (when `shouldSuppress` returns true — currently silent)
- Single-flight collisions (when a duplicate key is already in-flight)
- Resolver timeout vs. failure distinction (network timeout vs. provider error)

Add structured log lines for each when the observability layer is extended.

### D-GPT-5: failure_reason is untyped at DB level

`migrations/0262_external_doc_refs_google_drive.sql` — `failure_reason varchar(64)` with no CHECK constraint. TypeScript `FetchFailureReason` union provides compile-time safety, but nothing prevents invalid strings via direct SQL.

Add `CHECK (failure_reason IN ('auth_revoked','file_deleted','rate_limited','network_error','quota_exceeded','budget_exceeded','unsupported_content'))` in a future migration. Low urgency — TS types already enforce this on all code paths.

---

## Deferred from pr-reviewer review — fix-doco-may2026

**Captured:** 2026-05-01
**Source log:** tasks/review-logs/pr-review-log-fix-doco-may2026-2026-05-01T00-30-00Z.md

- [ ] [origin:pr-review:fix-doco-may2026:2026-05-01T00-30-00Z] [status:open] Add `scripts/verify-doc-sync-parity.ts` — parse Final Summary templates in `chatgpt-pr-review.md` and `chatgpt-spec-review.md`, assert they match the field list in `docs/doc-sync.md` (PR agent omits spec-context.md; spec agent includes it). Guards against someone adding a new reference doc to doc-sync.md and forgetting to update the two agent templates and README.md table. Single test file; CI runs it.

## PR Review deferred items

### PR #245 — fix-doco-may2026 (2026-05-01)

- [ ] F4: feature-coordinator — add optional lightweight per-chunk doc-sync drift detection (read-only, no writes) after each chunk completes, so drift is surfaced early rather than accumulated until D.5. Current D.5 end-of-pipeline gate catches everything; this is a future refinement for long multi-chunk pipelines. [user]
- [ ] R3-F2: add lightweight validator script for doc-sync verdict format — reject bare `no` (no rationale), `yes` without section names, and missing fields. Extend or complement the existing `scripts/verify-doc-sync-parity.ts` queued item. Would make enforcement machine-verified rather than convention-enforced. [user]

## PR Review deferred items

### PR #248 — claude-audit-dev-agents-Op4XW (2026-05-01)

- [ ] F4: introduce a coordinator gate-type taxonomy (HARD BLOCK / SOFT BLOCK / WARNING) and audit every existing gate (G1/G2/G3/G4, doc-sync, environment snapshot drift, overlap detection, freshness thresholds, S2-conflict, plan-gate abort, etc.) to label each with its type. Real pattern, but the right implementation audits all existing gates at the same time as introducing the taxonomy — better as a scoped follow-up than tacked onto this PR. [user]

## PR Review deferred items

### PR #246 — lint-typecheck-baseline (2026-05-01)

- [ ] F5: align plan doc to reflect `sideEffectClass: 'none'` as a valid class alongside `'read'` and `'write'` — downstream logic (managerGuardPure) only gates on `'write'`, so `'none'` is safely handled; doc just needs to match implementation. [auto]
- [ ] F7: update plan doc to reflect that `agentDiagnosis` column is `jsonb` not `text` — JSONB is the correct type for structured diagnosis data and is already used by `writeDiagnosis.ts`; plan was written before the type decision was finalised. [auto]
- F14 + F28: see `## Deferred — testing posture (lint-typecheck-post-merge spec)` near the bottom of this file — those rows supersede the earlier sparse routing.

## Deferred from ChatGPT PR review — external-doc-references Round 1 (F5)

**PR:** #242 (claude/agency-email-sharing-hMdTA)
**Source:** ChatGPT Round 1 review — 2026-05-01

### D-R1-F5: Rebind modal does not verify access before confirm

`RebindReferenceModal` (TaskModal.tsx) submits the rebind without calling `verifyAccess(...)` first, even though the API exposes that endpoint. Server-side validation still catches broken connections on POST, so this is not a security hole — it's a UX improvement: surface the error before the user commits rather than after.

Fix when UX polish is prioritised: call `verifyAccess(connectionId, fileId)` on connection select, show an inline warning if it fails, disable the confirm button. Low urgency.


## Deferred spec decisions — workflows-dev-spec

**Source:** spec-reviewer iteration 1 — 2026-05-02T00-48-25Z
**Spec:** `docs/workflows-dev-spec.md` (v1)
**Brief:** `docs/workflows-dev-brief.md` (v2)

The spec-reviewer auto-decided the following directional findings during iteration 1. Each was accepted and applied to the spec mechanically using the most conservative resolution available; flagged here so a human can validate the resolution before implementation proceeds.

### D-W1-C2: Ask multi-submitter / quorum semantics — resolved as single-submit / first-wins

**Codex:** the spec inherits Approval-style `quorum` for Ask via the shared `submitterGroup` shape, but Ask runtime persists a single submitted-value JSON and never defines what multiple submitters mean.

**Resolution applied:** Ask is single-submit / first-submit-wins. Validator caps `quorum` at 1 for Ask in §4.8; subsequent submissions return 409 with the existing submitter info. Matches the brief's implicit model (one row of submitted values per Ask step) and avoids inventing a multi-submit aggregation concept.

**What to validate:** confirm with the brief author that "multiple people in the submitter group, only one fills the form" is the intended UX. If multi-submitter aggregation is wanted in V1, this needs a redo.

### D-W1-C3: Idempotency / concurrency / unique-constraint→HTTP for Approval and Ask writes — resolved with state-based predicate + UNIQUE on review row

**Codex:** new write paths had no idempotency posture, no concurrency guard, no duplicate-request HTTP mapping (spec-authoring-checklist §10 requires all three).

**Resolution applied:** standard repo posture (per checklist §10 examples) — Approval writes get key-based + state-based posture (UNIQUE on `(workflow_run_id, step_id, deciding_user_id)` for double-click idempotency, optimistic predicate on step status for first-commit-wins quorum-counting, 23505 → 200 idempotent-hit). Ask writes get state-based posture (predicate on step status, 0-rows-updated → 409 already_submitted). State machine closure pinned in §5.1.1 + §11.4.1.

**What to validate:** confirm the (workflow_run_id, step_id, deciding_user_id) UNIQUE constraint is the right granularity (vs (run_id, step_id) — but that disallows multi-approver quorum, which is wrong). Architect to verify the existing schema doesn't already have a conflicting constraint.

### D-W1-I6: Ask form `params` Contracts entry — applied with the seven field types pinned

**Codex:** Ask form contract underspecified — no canonical `params` schema, no `autoFillFrom` enum, skip-flag schema, `error_message` field.

**Resolution applied:** added a Contracts subsection to §3.2 pinning the full Ask `params` shape (prompt, fields[] with seven types + per-field error_message, submitterGroup, quorum=1, autoFillFrom enum 'none'|'last_completed_run', allowSkip:boolean default false).

**What to validate:** confirm the seven field types are the right V1 set. Confirm `autoFillFrom` is the right enum shape (vs a more flexible structure). Confirm reserved field-key list (currently unspecified — architect picks).

### D-W1-I7: Pause / resume / extend state machine + API — resolved with full pin (path b)

**Codex:** Pause system promised resume/extend but no endpoint, no persisted state, no permission contract, no state-machine closure.

**Resolution applied:** path b chosen (pin the full state machine + resume API rather than cutting extend from V1). Added a §7.5 subsection with: new `paused` status, valid transitions (running ↔ paused, running/paused → failed via Stop), forbidden transitions, resume API contract (`POST /api/tasks/:taskId/run/resume` with optional extension params), Stop API contract, idempotency posture (state-based), permission guard (§14.5 visibility set), default 2-extension cap per run.

**What to validate:** confirm the codebase wants to ship `Continue for another 30 minutes / $2.50` extension affordance in V1, OR whether path a (Stop only, no extend) is preferred for simplicity. The current spec assumes extend is in scope per §7.2 mock and spec-time decision #4.

### D-W1-R2: Staging deploy step — auto-rejected per framing

**Auto-rejected** because `docs/spec-context.md` declares `staged_rollout: never_for_this_codebase_yet` and `rollout_model: commit_and_revert`. §18.1 step 5 was rewritten to commit-and-revert; staging smoke-test step removed.

**What to validate:** if the codebase has actually moved to a staged rollout posture (e.g. an internal staging environment for the workflows feature specifically), the spec-context.md framing needs to be updated and this rejection re-litigated.

### D-W1-R4: Frontend `*.test.tsx` tests — auto-rejected per framing

**Auto-rejected** because `docs/spec-context.md` declares `frontend_tests: none_for_now` and `convention_rejections` explicitly says "do not add frontend unit tests". §17.5 .test.tsx block was removed and replaced with a deviation note pointing back at spec-context.md; one .test.tsx in §17.6 was renamed to a server-side .test.ts.

**What to validate:** if the codebase is ready to land a frontend testing posture for this feature specifically (justifiable because of the WebSocket-coordinated multi-pane UI), update spec-context.md first, then re-litigate.

---

## Deferred spec decisions — subaccount-optimiser

**Spec:** `docs/sub-account-optimiser-spec.md`
**Source:** spec-reviewer iteration 1 — 2026-05-01

Two AUTO-DECIDED items routed for human awareness. Both have already been applied to the spec; flag only if the decision feels wrong.

### F2-AD-1: `inactive.workflow` category trigger redefined to use `subaccount_agents` schedule columns

Original trigger referenced `autoStartOnSchedule: true` and a "(cadence × 1.5) days" rule, but neither exists on `workflowTemplates` or `flowRuns`. Rewrote the trigger to detect sub-account agents with `scheduleEnabled = true AND scheduleCron IS NOT NULL` whose most recent `agent_runs` row is older than 1.5× the expected cadence (computed via `scheduleCalendarServicePure`). This anchors the category against a real currently-shipped schedule mechanism.

Flag if: you wanted this category to track *workflow templates* specifically (in which case it has to wait until workflow templates carry schedule metadata), not scheduled agents.

### F2-AD-2: "Why not extend an existing primitive" paragraph added to §6

spec-authoring-checklist Section 1 expects a one-paragraph rationale comparing the new primitive against the closest existing primitives. Added a paragraph after §6.1 listing `system_incidents`, `feature_requests`, and `org_memories` / `workspace_memory` and explaining why none fit the recommendations lifecycle (operator-facing rows that dedupe by stable finding keys, render plain-English copy, acknowledge/dismiss in the UI without notifying anyone).

Flag if: you intended a tighter mapping to one of those existing tables and the paragraph misframes the design-review decision.

### F2-AD-3: Sub-account-settings UI for `optimiser_enabled` deferred (iter 2)

Iter-2 Codex finding #6: spec called the opt-out a "toggle on sub-account settings" but only added the DB column. Downgraded the prose to "backend boolean column flipped via admin SQL or Configuration Assistant" and added a Deferred Items entry calling out the missing settings UI. v1 has no operator-visible toggle.

---

## Deferred from spec-conformance review — subaccount-optimiser (2026-05-02)

**Captured:** 2026-05-02T05:06:28Z
**Source log:** `tasks/review-logs/spec-conformance-log-subaccount-optimiser-2026-05-02T05-00-11Z.md`
**Spec:** `docs/sub-account-optimiser-spec.md`

These are spec-vs-implementation divergences identified during the all-of-spec conformance audit on branch `claude/subaccount-optimiser` at HEAD `1ba02c3b`. None were auto-fixed (all required design judgment). Resolve before merge OR pin the spec to match the implementation choices.

- [ ] **REQ #B1 — `playbook.escalation_rate` severity drift**
  - Spec section: §2 line 109
  - Gap: spec says severity=`critical` at >60% over 14 days; implementation is severity=`warn` at >60% over 7 days (`recommendations/playbookEscalation.ts:39`, `queries/escalationRate.ts:46`).
  - Suggested approach: either flip to `critical` and widen window to 14 days OR pin spec to "warn at 7 days". Two divergences in one finding.

- [ ] **REQ #B2 — `inactive.workflow` severity drift**
  - Spec section: §2 line 111
  - Gap: spec=`warn`; implementation=`info` (`recommendations/inactiveWorkflow.ts:24`).
  - Suggested approach: bump severity to `warn` to match the spec, OR pin spec to `info`.

- [ ] **REQ #B3 — `escalation.repeat_phrase` severity drift**
  - Spec section: §2 line 112
  - Gap: spec=`info`; implementation=`warn` (`recommendations/repeatPhrase.ts:116`).
  - Suggested approach: lower to `info`, OR pin spec to `warn`. Note `info` was the spec author's deliberate choice — phrase repetition is informational, not actionable until the brand-voice profile (F1) ships.

- [ ] **REQ #B4 — `memory.low_citation_waste` severity + threshold drift**
  - Spec section: §2 line 118
  - Gap: spec=`warn` at `>50% scored <0.3`; implementation=`info` at `>40%` using `mcs.cited = false` flag (`recommendations/memoryCitation.ts:13–46`, `queries/memoryCitation.ts:48`).
  - Suggested approach: confirm whether `mcs.cited = false` is the schema's encoding of "scored below threshold" — if so, lift threshold to 50% and bump severity to `warn`. If not, the query is reading the wrong signal entirely.

- [ ] **REQ #B5 — `agent.routing_uncertainty` trigger semantics rewritten**
  - Spec section: §2 line 119
  - Gap: spec="confidence < 0.5 on > 30% of decisions, OR `secondLookTriggered` rate > 30%, sustained 7 days"; implementation uses 0.7 confidence threshold (not 0.5), drops the OR with `second_look_pct`, AND adds an undocumented `total_decisions >= 50` evaluator-level gate (`queries/routingUncertainty.ts:26`, `recommendations/routingUncertainty.ts:20–37`).
  - Suggested approach: align all three to spec — set `LOW_CONFIDENCE_THRESHOLD=0.5`, OR-combine with second_look_pct, remove the >=50 evaluator gate (the spec's volume floor of 10 already lives in `materialDelta`).

- [ ] **REQ #B6 — `llm.cache_poor_reuse` trigger semantics rewritten + missing volume floor**
  - Spec section: §2 line 120
  - Gap: spec="`cacheCreationTokens > cachedPromptTokens` AND total >= 5000"; implementation uses `reuse_ratio < 0.20` with NO volume floor (`recommendations/cacheEfficiency.ts:29–32`).
  - Suggested approach: switch to `creation_tokens > reused_tokens` AND `(creation_tokens + reused_tokens) >= 5000`. Without the volume floor, low-volume agents will produce noisy info recommendations.

- [ ] **REQ #B7 — `runOptimiser` orchestrator not wired to production schedule path**
  - Spec section: §6.2 Run-level atomicity
  - Gap: `optimiserOrchestrator.ts:runOptimiser` implements pre-sort + sequential calls + singleton key per spec, but no production callsite references it. The pg-boss schedule routes through `agentExecutionService.runAgent` (LLM-driven loop reading `AGENTS.md`), which provides no pre-sort guarantee.
  - Suggested approach: either (a) wire `runOptimiser` as the queue handler for `subaccount-optimiser` runs (specialised dispatch path), OR (b) accept LLM-mediated ordering and weaken the atomicity invariant in §6.2 to "best-effort sort via system prompt directive". This is the largest single conformance gap and the most architecturally consequential.

- [ ] **REQ #B8 — Cron timezone semantics divergence**
  - Spec section: §4
  - Gap: spec says "daily at sub-account local 06:00 (cron derived from sub-account's `timezone`)"; implementation runs at UTC 06:00–11:59 with deterministic stagger via `optimiserCronPure.ts`, ignoring `subaccounts.timezone` (`optimiserSubaccountHook.ts:131` registers with `'UTC'`).
  - Suggested approach: read `subaccounts.timezone` and pass it to `agentScheduleService.registerSchedule` as the `tz` argument, while keeping the deterministic minute-stagger inside the 06:00 hour. Spec §13 schedule-storm risk is preserved by the minute spread; sub-account-local timing is preserved by reading `timezone`.

- [ ] **REQ #B9 — `inactive.workflow` heartbeat-vs-cron path drift + grace buffer**
  - Spec section: §2 line 111 / §3 line 174 / §5 line 222
  - Gap: spec restricts to `subaccountAgents.scheduleEnabled = true AND scheduleCron IS NOT NULL` and "older than 1.5× expected cadence"; implementation ORs in `sa.heartbeat_enabled = true` (broadens scope) AND uses 1.25× grace buffer (tightens trigger) — both diverge from spec (`queries/inactiveWorkflows.ts:104–108, 70–71`).
  - Suggested approach: drop the heartbeat path branch (or update the spec to acknowledge it), and change the grace buffer from `*0.25` (1.25×) to `*0.5` (1.5×) to match the spec.

- [ ] **REQ #B10 — Acknowledge route response shape includes extra fields**
  - Spec section: §6.5
  - Gap: spec response is `{ success, alreadyAcknowledged }`; implementation returns `{ success, alreadyAcknowledged, scope_type, scope_id }` (the extras are read by the route layer to drive socket emission).
  - Suggested approach: either pin spec to allow the extra fields, OR move the `scope_type`/`scope_id` lookup out of the response shape into a separate `getById` call inside the route handler.

- [ ] **REQ #B11 — Cooldown / open-match queries lack explicit `organisation_id` predicate (RLS-only isolation)**
  - Spec section: §6.2 Step 1, §6.5
  - Gap: AMBIGUOUS — `agentRecommendationsService.ts:111–123, 167–175, 248–255, 300–312` all rely on connection-level `app.organisation_id` RLS to enforce isolation, but the service uses `db.transaction()` directly (not `withOrgTx`). If the calling context does not set `app.organisation_id`, RLS will see no session var and lookup will silently return zero rows.
  - Suggested approach: confirm that `output.recommend` and the HTTP routes both run inside `withOrgTx` (or equivalent) before this service is invoked, OR add an explicit `AND organisation_id = ${ctx.organisationId}::uuid` predicate to all four queries as defense in depth.

- [ ] **REQ #B12 — `listRecommendations` uses `sql.raw` with string interpolation**
  - Spec section: §6.5
  - Gap: `agentRecommendationsService.ts:530–544, 575–598` interpolates `orgId` and `scopeId` directly into `sql.raw(...)` strings. UUID format is validated for `scopeId` only; `orgId` comes from `req.orgId` (server-side), so practical injection is impossible — but the convention prefers parameterised drizzle-tagged-template `sql\`…\`` interpolation.
  - Suggested approach: refactor to drizzle composable conditions (the descendant-subaccount IN clause is the reason raw was used; `inArray` + a subquery would express the same shape parameterised). OR add an inline comment naming the safety invariant ("orgId is server-side only").

- [ ] **REQ #B13 — Defensive fallback can mask data corruption on dismiss path**
  - Spec section: §6.5
  - Gap: AMBIGUOUS — `agentRecommendationsService.ts:730` returns `target.dismissed_until ?? new Date().toISOString()` when the row's `dismissed_until` is NULL on an already-dismissed row. That state is impossible if the service is the only writer (single-writer invariant), so the fallback hides corruption rather than surfacing it.
  - Suggested approach: log a warning if `dismissed_at IS NOT NULL AND dismissed_until IS NULL` is observed (impossible state under invariant), then return the timestamp.

- [ ] **REQ #B14 — RLS policy variant on migration 0267 vs reference pattern in 0245**
  - Spec section: §6.1 / §10
  - Gap: AMBIGUOUS — migration 0267 uses one combined policy (`USING + WITH CHECK` on the same predicate). Spec references "per `0245_all_tenant_tables_rls.sql` pattern" without specifying single-policy vs split-policy convention. Verify against 0245.
  - Suggested approach: if 0245 splits SELECT/INSERT/UPDATE/DELETE into separate policies, refactor 0267 to match. Otherwise PASS.

- [ ] **REQ #B16 — Stale `progress.md` in main worktree**
  - Spec section: §9 Phase 4 / §11
  - Gap: AMBIGUOUS — main worktree `tasks/builds/subaccount-optimiser/progress.md` shows "IN PROGRESS — Phase 1 complete"; the feature-branch worktree shows "Status: COMPLETE" with full closeout. Resolution depends on which version lands on `main` after the merge.
  - Suggested approach: confirm the worktree's `progress.md` is what merges (most likely true given the branch HEAD), no further action needed. If main's version persists, copy the closeout block over.

Flag if: you intended an operator-visible UI in v1 (in which case settings page + route + schema entry need to be specced) rather than a backend-only flag.

## Deferred — testing posture (lint-typecheck-post-merge spec)

**Source:** spec-reviewer agent — review of `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md` Iteration 1, 2026-05-01. F14 and F28 were drafted as integration tests inside Task 7 of that spec, then auto-rejected on framing grounds (`docs/spec-context.md` `runtime_tests: pure_function_only`). Both are real tests worth writing — just not under the current testing posture. Picked up when posture changes (live data, integration-test budget approved, etc.).

- [ ] **F14 — migration compatibility test for null `agentDiagnosis` rows.** Originating file (when written): `server/services/systemMonitor/skills/__tests__/writeDiagnosisLegacyRows.test.ts`. Asserts that `agentDiagnosisRunId` and `agentDiagnosis` read as `null` for legacy pre-migration rows and that `diagnosisStatus = 'none'` is the canonical presence indicator (never filter on `agentDiagnosisRunId IS NOT NULL`). DB-backed integration test — not pure-function. [auto - spec-reviewer]
- [ ] **F28 — idempotency double-tap for `executeWriteDiagnosis`.** Originating file (when written): `server/services/systemMonitor/skills/__tests__/writeDiagnosis.test.ts`. Asserts that two calls with the same `(incidentId, agentRunId)` produce only one `diagnosis` event and a single row update. **Important contract correction:** the second call returns `{ success: true, suppressed: false }` per the actual implementation at `server/services/systemMonitor/skills/writeDiagnosis.ts:62-63, 124-127`; `suppressed: true` is reserved for the terminal-transition race path. Earlier draft of the test in the post-merge spec had this wrong — fix at write-time. [auto - spec-reviewer]

## PR Review deferred items

### PR — lint-typecheck-post-merge-tasks (2026-05-01)

- [ ] N-1: remove redundant `'no-undef': 'off'` from per-pattern blocks in `eslint.config.js` (lines 24, 39); global block at line 14 already disables it. [auto]
- [ ] N-2: combine the two `import type` lines for `PrincipalContext` and `SystemPrincipal` in `visibilityPredicatePure.test.ts:14-15`. [auto]
- [ ] N-3: tighten `registerProviderAdapter` local type in `fakeProviderAdapter.test.ts:159` from `(key, a: unknown)` back to `(key, a: LLMProviderAdapter)`. [auto]
- [ ] N-4: codemod sweep -- replace `npx tsx server/...` in Vitest test docstrings with `npx vitest run server/...` per DEVELOPMENT_GUIDELINES.md §7. [user]

### PR #249 — lint-typecheck-post-merge-tasks — chatgpt-pr-review round 1 (2026-05-01T08:50 UTC)

**Source:** ChatGPT-web review (manual mode); operator drove rounds inline in main session. Verdict: 3 auto-reject, 3 defer, 1 awaiting user. Log: `tasks/review-logs/chatgpt-pr-review-lint-typecheck-post-merge-tasks-2026-05-01T08-50-17Z.md`.

- [ ] **F3-cgpt:** `liveAgentCount` in `client/src/components/Layout.tsx:266` is set in 5 places (initial fetch, refresh, polling, two socket handlers) but the JSX that rendered it as a Dashboard badge was removed in a prior commit. Pre-existing dead state — not introduced by PR #249. Lint rule is `'warn'` so CI passes. Either restore the Dashboard badge JSX (`<NavItem ... badge={liveAgentCount > 0 ? liveAgentCount : undefined} badgeLabel={liveAgentCount > 0 ? \`${liveAgentCount} live\` : undefined} />`) or remove the state + setter + polling + socket handlers wholesale. [auto - chatgpt-pr-review]
- [ ] **F4-cgpt:** Hygiene audit of all `// eslint-disable-next-line` comments in the codebase — ensure each remains justified and the rule it disables hasn't been resolved upstream. Periodic; not introduced by PR #249. [auto - chatgpt-pr-review]
- [ ] **F6-cgpt:** Replace inline `Record<string, unknown>` casts with named row interfaces (~42 occurrences). Suggested per-file pass: introduce a small `type FooRow = { ... }` near each callsite where it's used, replace the cast. Mostly in `db.execute<T>()` callbacks. Out of scope for the lint cleanup spec (would expand the change set significantly). [auto - chatgpt-pr-review]
- [x] **F7-cgpt:** UX polish for silent UI catches — `client/src/pages/McpServersPage.tsx:317` sync button. **Resolved in PR #249 (operator approved fix-in-PR):** added `toast.error(msg)` with the codebase's standard error-message extraction (matching `AgentRunCancelButton.tsx`). [user - chatgpt-pr-review]

### PR #249 — lint-typecheck-post-merge-tasks — post-build pr-reviewer pass (2026-05-01T07:36 UTC)

**Source:** post-build pr-reviewer agent. Verdict APPROVED (0 blocking, 1 strong, 4 non-blocking). Log: `tasks/review-logs/pr-reviewer-log-lint-typecheck-post-merge-tasks-2026-05-01T07-36-42Z.md`. S-1 was the only Strong finding; routed here because the only fix path requires editing `eslint.config.js`, which is a HITL-protected config file and the user is away from the keyboard at review time.

- [x] **S-1 (Strong) — RESOLVED in PR #249 (operator approved at finalisation):** Worker T8 `no-restricted-imports` rule ported into `eslint.config.js` flat config (`files: ['worker/**/*.{ts,cjs,js}']` block at the bottom of the file); legacy `worker/.eslintrc.cjs` deleted; `'worker/.eslintrc.cjs'` ignore entry removed. Functionally verified — `ESLint.calculateConfigForFile('worker/src/loop/executionLoop.ts')` now returns the rule active; synthetic violation file produces the expected error `'../../server/db/schema/integrationConnections' import is restricted from being used by a pattern. Worker code must not import the integrationConnections table directly. ...` Stale doc references at `docs/reporting-agent-handoff.md:114` and `docs/reporting-agent-paywall-workflow-spec.md:942` updated in the same commit. [user]
- [ ] **N-1 (post-build):** `IdempotencyContract` interface at `server/config/actionRegistry.ts:62-71` has all four S1 fields, but `ActionDefinition` doesn't yet carry `idempotencyContract?: IdempotencyContract`. Type-only contract — no caller validates it. Plumb through when the next idempotency-aware action is added. [auto]
- [ ] **N-2 (post-build):** Pre-existing `await await expect(...).rejects.toThrow()` double-await typo in `server/services/__tests__/llmRouterTimeoutPure.test.ts:70` and `server/services/__tests__/canonicalDataService.principalContext.test.ts`. Drop the outer `await`. Harmless but confusing. [auto]
- [ ] **N-3 (post-build):** Implementation chose `req.user!.id` (non-null assertion) over the spec's literal `req.user?.id` (optional chain) in `server/routes/workspace.ts` and `server/routes/suggestedActions.ts`. The `!` is correct because `authenticate` middleware always sets `req.user`; `?.` would propagate `undefined` into downstream services. Document the deviation in a future spec-self-review pass; no code change. [auto]
- [ ] **N-4 (post-build):** `void _b;` dead-code noise at `server/services/dropZoneService.ts:280`. The `varsIgnorePattern: '^_'` already excludes `_b`; `void _b` is unnecessary. Drop in a future cleanup pass. [auto]
- [x] **N-5 (post-build) — RESOLVED in PR #249:** `'worker/.eslintrc.cjs'` ignore entry removed from `eslint.config.js:8` together with S-1. The legacy file is deleted and the rule lives in the flat config. [auto]

---

## Deferred spec decisions — dev-pipeline-coordinators

**Source:** spec-reviewer iteration 1, 2026-05-01

### [AUTO-DECIDED - reject] §6.2 "frontmatter description MUST include Step 1 TodoWrite skeleton"

The mandate in §6.2 says all agents "MUST include a Step 1 TodoWrite skeleton in its frontmatter `description`". However, YAML frontmatter `description` fields are by convention single-line strings — embedding a multi-step skeleton would break YAML parsing. All agents defined in this spec already have body-level "Step 1 — TodoWrite list" sections, which satisfy the spirit of the requirement.

**Decision:** AUTO-DECIDED reject. The §6.2 wording is an overspecification — the body Step 1 sections in each agent definition are the correct place for the skeleton, not the YAML description field. The spec text at §6.2 should be updated to say "body Step 1 section" instead of "frontmatter description".

**Rationale:** Prefer spec as-is (body Step 1 sections present in all agents); YAML description field cannot hold multi-step skeletons without breaking YAML parsing.

**Action if human agrees:** Clarify §6.2 wording to say "each agent's body MUST include a Step 1 — TodoWrite list section" rather than referencing the frontmatter description field.

### [AUTO-DECIDED - reject] Open Questions §1 — main-branch protection design question

**Source:** spec-reviewer iteration 2, 2026-05-01
**Finding:** Codex flagged that if the operator starts spec-coordinator on main/master/develop, all coordinator auto-commits and auto-pushes (§6.5) would land directly on main, bypassing the PR/CI flow. This is a real risk.

**Decision:** AUTO-DECIDED reject (close the open question as deferred). The spec explicitly lists this as Open Question #1 for chatgpt-spec-review and the operator. The two options ("refuse on integration branch" vs "auto-create feature branch") each have trade-offs the operator must evaluate. Auto-resolving this in a mechanical spec review would be out of scope — it is a product design decision.

**Rationale:** Prefer spec as-is; the open question is intentionally open and flagged for operator review. The risk is acknowledged in the spec.

**Action for operator:** Resolve Open Question #1 before the pipeline ships. Recommended decision: add a guard at spec-coordinator entry that refuses to start if the current branch is main/master/develop and prompts the operator to switch to a feature branch first. This is the safer option (no destructive auto-branch) and matches the commit-and-revert rollout model.

### [AUTO-DECIDED - accept] §2.16/§6.4.2 — Phase 2 hard-escalation current-focus.md state should be NONE

**Source:** spec-reviewer iteration 5, 2026-05-01
**Finding:** §6.4.2 says hard escalations "set tasks/current-focus.md status appropriately" but this is undefined for PHASE_2_PAUSED_PLAN and other Phase 2 paused states. Codex found that §2.3's entry check (BUILDING required) is inconsistent with the hard-escalation reset.

**Decision:** AUTO-DECIDED accept (minor clarification needed). Hard-escalation paths in §2.16 should explicitly set current-focus.md to `NONE` (not BUILDING) so the next re-launch sees NONE and can re-enter Phase 2 cleanly by re-setting BUILDING at entry. The §2.3 entry check remains correct (BUILDING = valid, anything else = refuse; re-launch writes BUILDING before starting).

**Rationale:** Phase 2 restart-not-resume posture means hard escalations should leave the repo in a clean state (NONE) rather than a stuck state (BUILDING). "Appropriately" in §6.4.2 should be interpreted as NONE for all Phase 2 PAUSED* escalations.

**Action if human agrees:** Add a line to each hard-escalation path in §2.16 specifying `current-focus.md → NONE`. Minor spec clarification; non-blocking for implementation.

---

## Spec Review deferred items

### dev-pipeline-coordinators (2026-05-01)

Deferred items from chatgpt-spec-review session (`tasks/review-logs/chatgpt-spec-review-dev-pipeline-coordinators-2026-05-01T02-20-30Z.md`). All items have explicit re-evaluation triggers.

- [ ] **Per-phase cost and time budgeting.** Optional per-phase budget caps (tokens/time) surfaced in `progress.md`. Re-evaluation trigger: `live_users: yes` in `docs/spec-context.md`. [user]
- [ ] **Overgrown progress.md compression.** Keep last N detailed entries; summarize older entries. Re-evaluation trigger: builds consistently exceed 20+ chunks. [user]
- [ ] **Runtime smoke check for routes/schema/integration chunks.** Lightweight runtime verification (hit endpoint, verify response shape) after chunks touching API routes, DB schema, or integration points. Re-evaluation trigger: `api_contract_tests: not none` in `docs/spec-context.md` (i.e. when `live_users: yes`). [auto]
- [ ] **Mid-run architecture checkpoint at 50% of chunks.** Re-invoke architect mid-build to catch slow architectural drift. Re-evaluation trigger: multi-month builds surface architectural drift as a recurring issue. [auto]
- [ ] **Simplification pass at end of Phase 2.** "What can be removed, merged, or simplified?" pass after all chunks built. Re-evaluation trigger: when builder surgical-changes rule + review stack prove insufficient for complexity control. [auto]
- [ ] **Confidence score per chunk (`confidence: HIGH/MEDIUM/LOW` in builder return).** Informational field only (no auto-trigger); operator uses it to decide manual review cadence. Re-evaluation trigger: when operator finds they regularly want to spot-review specific chunks based on complexity. [auto]

## Deferred from pr-reviewer — dev-pipeline-coordinators (2026-05-01)

**Captured:** 2026-05-01T17:30:00Z
**Source log:** `tasks/review-logs/pr-review-log-dev-pipeline-coordinators-2026-05-01T17-30-00Z.md`
**Spec:** `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`

- [ ] **Status-enum transition test coverage.** Author `tests/agents/dev-pipeline-coordinator-status-enum.test.ts` that reads all coordinator agent files, extracts every `status:` assignment, and asserts each is in the allowed-transition table from spec §6.1.1. Deferred: `docs/spec-context.md` sets `testing_posture: static_gates_primary`; revisit when posture changes. [auto-trigger: `testing_posture` changes]
- [ ] **`tier-1-ui-uplift.html` migration scope.** Spec §10.1.1 only names `org-chart-redesign.html`; `tier-1-ui-uplift.html` was also migrated to satisfy the directory removal. Additive but unspecced — add a note to §9.3 to explicitly name both files if the spec is ever revised. [editorial]
- [ ] **`chatgpt-plan-review.md` extra context loading.** Agent prepends CLAUDE.md + architecture.md + DEVELOPMENT_GUIDELINES.md before On Start (not specified in §4.3.4). Acceptable by convention; add to spec if formal review of §4.3.4 is done. [editorial]
- [ ] **`feature-coordinator.md` per-chunk push as bare prose.** Step 6 says "push after each chunk commit" in prose with no fenced `git push` block. Add explicit `git push` command block for clarity. [minor]

## Deferred spec decisions — pr-249-followups (2026-05-01)

**Captured:** 2026-05-01T23-04-17Z by `spec-reviewer` iteration 2
**Source log:** `tasks/review-logs/spec-review-log-pr-249-followups-2-2026-05-01T23-04-17Z.md`
**Spec:** `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md`

- [ ] **F6 (`Record<string, unknown>` audit) volume re-scope.** Codex flagged the per-callsite audit scope (`server/ client/ shared/ scripts/ worker/ tools/`) as "hundreds to over a thousand" matches; verified at 510 occurrences across 200 files. Spec keeps the per-callsite framing because acceptance criteria (A/B/C tallies + out-of-scope carve-out for the discriminated-union refactor) still bound the work. **If execution proves intractable in one PR**, consider re-scoping to a bounded subset (e.g. only newly-added casts, only F6 backlog files, or only `as Record<string, unknown>` casts where `as` is the cast operator) and split the remainder into a follow-up spec. Decision intentionally deferred to execution time so the operator can use real progress data. [user]
- [ ] **F6 — ClientPulse intervention-payload discriminated union (out-of-scope of pr-249-followups).** The intervention-payload type system would benefit from a `type InterventionPayload = CreateTaskPayload | FireAutomationPayload | NotifyOperatorPayload | SendEmailPayload | SendSmsPayload` discriminated union keyed on `actionType`. Substantive type-design refactor across many editor components in `client/src/components/clientpulse-settings/editors/payloadSubEditors/`. Worth its own spec when prioritised. Source: spec `2026-05-02-pr-249-followups-spec.md` §6.3. [user]

## Deferred from spec-conformance review — pr-249-followups (2026-05-02)

**Captured:** 2026-05-02T01:31:41Z
**Source log:** `tasks/review-logs/spec-conformance-log-pr-249-followups-2026-05-02T01-31-41Z.md`
**Spec:** `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md`

- [ ] **REQ #7 — F3 §4.4 concurrency invariant: socket handler-level `activeClientId` filter not implemented.** Spec §4.4 requires the `live:agent_started` / `live:agent_completed` handlers at `Layout.tsx:431-432` to read `activeClientId` from a ref or latest closure at event-handling time and ignore events whose payload subaccount differs. Current code unconditionally calls `setLiveAgentCount(c => c +/- 1)` with no payload inspection. Two of three §4.4 checkboxes are satisfied (initial fetch and reconnect resync both close over the latest `activeClientId`); the socket-handler checkbox is not.
  - Spec section: §4.4 (Concurrency invariant: scope events by `activeClientId`)
  - Gap: handler-level subaccount filter missing — relies entirely on Socket.IO room subscription as the cross-subaccount filter (which works at steady state but does not match the spec's defence-in-depth invariant for fast subaccount switches when in-flight events arrive after the leave-room emit).
  - Suggested approach: introduce an `activeClientIdRef` (mirrors the existing `eventsRef` / `reconnectRef` pattern in `useSocketRoom`), have `Layout` keep it current via a one-line `useEffect`, and wrap each handler with an early-return when the event payload's subaccount doesn't match the ref. Requires confirming the `live:agent_started` / `live:agent_completed` event payload shape includes the source subaccount (or extending the emitter to include it).
- [ ] **REQ #10 — F4 audit tallies row in spec §5.3 Self-review section is unfilled.** The F4 tallies table at lines 314-320 of `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md` still contains `<fill>` placeholders. The numbers exist in commit `e52f1f96` (F4 commit message: 0 disables removed, all surviving kept; diff stats: 26 files changed, 41 new `// reason:` justification lines). Spec §5.3 explicitly names this row as the destination and gives the format `<initial> → <final>; removed <N> redundant, kept <N> with one-line justifications`.
  - Spec section: §5.3 + Self-review tallies table
  - Gap: tally table cells contain `<fill>` placeholders rather than the audited values.
  - Suggested approach: operator decides whether to (a) fill the table inline in the spec via a follow-up `docs(pr-249-followups): F4 tallies` commit, or (b) move the tallies destination to the PR description and update the spec to point there. Spec-conformance does not auto-edit specs.
- [ ] **REQ #12 — F6 audit tallies row in spec §6.4 Self-review section is unfilled.** The F6 tallies table at lines 326-332 still contains `<fill>` placeholders. The numbers exist in commit `564eff20` (F6 commit message body: initial inventory 1294, Category A removed 7, Category B narrowed 0, Category C kept 1287; net 1287). Spec §6.4 explicitly names this row as the destination and gives the format `<initial inventory> → A: <removed N>, B: <narrowed N>, C: <kept N>`.
  - Spec section: §6.4 + Self-review tallies table
  - Gap: tally table cells contain `<fill>` placeholders rather than the audited values.
  - Suggested approach: same as REQ #10 — operator decides spec inline vs PR description; spec-conformance does not auto-edit specs.
- [ ] **REQ #13 — Doc-sync 7 verdicts not present in PR #251 description.** Spec §7 Verdict destination explicitly requires: *"record the seven verdicts in the closing PR description under a `## Doc-sync verdicts` section, one verdict per line in the format `- <doc>: yes (sections X, Y) | no — <rationale> | n/a`"*. PR #251 body currently contains only the round-1 chatgpt-spec-review commit message. The doc-sync sweep commit `fcc734a6` mentions "All other docs verified clean: architecture.md, capabilities.md, integration-reference.md, CLAUDE.md, DEVELOPMENT_GUIDELINES.md, frontend-design-principles.md, spec-context.md" — that's the right content but the wrong location.
  - Spec section: §7 (Doc-sync) Verdict destination paragraph
  - Gap: PR description does not contain the `## Doc-sync verdicts` section the spec mandates.
  - Suggested approach: operator runs `gh pr edit 251 --body "..."` to append the seven `<doc>: yes (sections X, Y) | no — <rationale> | n/a` lines, citing KNOWLEDGE.md (the one doc updated this branch) and `n/a` or `no — <rationale per investigation procedure>` for the remaining six per `docs/doc-sync.md § Verdict rule`.

## PR Review deferred items

### PR #251 — pr-249-followups (2026-05-02)

**Source log:** `tasks/review-logs/chatgpt-pr-review-pr-249-followups-2026-05-02T08-30-45Z.md`

- [ ] **P2.1 — Refactor inline async functions in `useEffect` to `useRef`/`useCallback` pattern** across ~10 client components and hooks to eliminate `react-hooks/exhaustive-deps` disables. Touches `client/src/components/Layout.tsx`, `client/src/components/PortalConfigEditor.tsx`, `client/src/components/UnifiedActivityFeed.tsx`, `client/src/components/agent/AgentActivityTab.tsx`, `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx`, `client/src/hooks/useSocket.ts`, `client/src/pages/AdminSubaccountDetailPage.tsx`, `client/src/pages/ClientPulseClientsListPage.tsx`, `client/src/pages/MemoryBlockDetailPage.tsx`, `client/src/pages/MemoryReviewQueuePage.tsx`, `client/src/pages/SubaccountKnowledgePage.tsx`, `client/src/pages/SubaccountOnboardingPage.tsx`. ChatGPT explicitly flagged "not a blocker, worth standardising later". [user] — out of scope for PR #251 cleanup; the disables now carry explicit reason comments which is the spec-mandated immediate fix.
- [ ] **P2.3 — Add observability hook on `budgetGuardrail` zero-cost short-circuit.** `server/processors/budgetGuardrail.ts:218` silently skips `costUsd === 0` results, but zero-cost may be meaningful (free-tier calls, cached responses). Add a debug log or metric so the skip is observable. [user] — pre-existing behaviour; this PR only removed a redundant cast on the line above. Out of scope for a lint/typing cleanup.
- [ ] **P2.5 — Extract `resolveDefault<T>(mod): T` helper for dynamic-import default-export pattern.** Centralises the `(mod as any).default ?? (mod as any).x` workaround currently duplicated across `cron-parser` (`server/services/__tests__/scheduleCalendarParity.test.ts`), `rrule` (used in scheduling helpers), and `pdf-parse` (used in document ingestion). Only 3 callsites today. [user] — premature abstraction at current callsite count; revisit if a 4th case appears.
- [ ] **P2.1 (R3) — CI enforcement check for `eslint-disable` requiring `// reason:` on the preceding line.** Add a CI step (script under `scripts/` or `.github/workflows/`) that walks line pairs across the codebase and fails the build when an `eslint-disable` directive is not preceded by a `// reason:` comment line. Naive `grep -v` matches reason anywhere on the same line; the correct check needs an awk/script that handles preceding-line semantics and skips block-comment regions. Belongs in its own focused PR with test coverage of the script itself. [user] — out of scope for the lint-cleanup PR; requires its own design + tests.
- [ ] **P2.4 (R3) — Add "React effect dependency policy" section to `CONTRIBUTING.md`.** Document the target pattern (`useCallback` or `useRef`-stabilised inline function) for `useEffect` bodies that close over component state, alongside the existing lint-suppression policy. Coupling: write this when the React effect refactor (R1 P2.1) lands so the doc describes the post-refactor pattern, not the current inline-async pattern. [user] — defer until the refactor PR ships so the policy and the code agree from day one.

## Deferred from spec-conformance review — stream-2-optimiser-finish (2026-05-04)

**Captured:** 2026-05-04T20:49:01Z
**Source log:** `tasks/review-logs/spec-conformance-log-stream-2-optimiser-finish-2026-05-04T20-49-01Z.md`
**Spec:** `docs/sub-account-optimiser-spec.md`
**Plan:** `tasks/builds/stream-2-optimiser-finish/impl-plan.md`
**Verdict:** NON_CONFORMANT → CONFORMANT_AFTER_FIXES on re-verification 2026-05-04T22:07:32Z. Re-verification log: `tasks/review-logs/spec-conformance-log-stream-2-optimiser-finish-2026-05-04T22-07-32Z.md`.

**Closed by stream-2-optimiser-finish (PR #262):** DG-1, DG-2, DG-3, DG-5, DG-7, DG-8 — see re-verification log for per-item resolution. Two items remain open:

- [ ] **DG-4 (NORMAL — completeness) — `registerOptimiserSchedule` hardcodes timezone to `'UTC'`.** UTC-fallback now documented in code comments at `server/services/agentScheduleService.ts:432` and `:472` as of 2026-05-04T22:07:32Z. The schema/spec choice remains a human call. `server/services/agentScheduleService.ts:412` and `:468` both pass `'UTC'` explicitly because `subaccounts` schema has no `timezone` column. Spec §4 says "daily at sub-account local 06:00 (cron derived from sub-account's `timezone`)"; plan §Contracts repeats it.
  - Spec section: §4 + plan §Contracts → `registerOptimiserSchedule` cron line.
  - Gap: timezone-aware scheduling impossible without a column on `subaccounts`.
  - Suggested approach: pick one — (a) add a `timezone TEXT NOT NULL DEFAULT 'UTC'` column to `subaccounts` in a follow-up migration and propagate it into `registerOptimiserSchedule`; or (b) accept UTC as the v1 stagger window and update spec §4 + plan §Contracts to match. (a) is the spec-honouring path; (b) is the simpler one.

- [ ] **DG-6 (NORMAL — verification) — Cost-gate measurement deferred to CI without ever running.** Plan-allowed CI deferral; the verification surface for `<$0.02/sa/day` is CI with live DB+LLM, not local conformance. Spec §11 done definition: "Cost stays under $0.02 per sub-account per day in measured production runs"; plan invariant 30: "Phase 4 measures actual token usage on a 5-subaccount × 7-day fixture. < $0.02/subaccount/day or the build does not ship." `server/services/optimiser/__tests__/verificationMatrix.test.ts:836-840` is `describe.skip`, and `progress.md` records "Integration cost gate (<$0.02/subaccount/day) deferred to CI with live DB + LLM access." No CI gate has run this measurement yet — there is no "yes, $X measured" record anywhere.
  - Spec section: §11 + plan invariant 30
  - Gap: required measurement not yet performed; verdict in progress.md is "deferred", not "PASS at $X measured".
  - Suggested approach: schedule the integration test in the next CI run that has DB+LLM access (or run it locally against a representative seeded fixture once). Block merge of any future optimiser-touching PR on the cost gate landing a measurement < $0.02/sa/day.

## PR Review Findings — stream-2-optimiser-finish (2026-05-04)

Advisory findings from pr-reviewer pass. Blocking (B-1) and N-1/N-3 were fixed in the same session. Remaining items below.

### S-1 — `agent.over_budget` evaluator threshold mismatches spec

Spec §3/§5 defines "monthly cost > 1.3× budget for 2 consecutive months". Current `agentBudget.ts` evaluator fires at `percentUsed > 0.9` (warn) and `> 1.0` (critical) with `last_month: 0` hardcoded. Fix: extend query module to expose `lastMonthSpendUsd` from `cost_aggregates` (second join filtered to previous calendar month) and update evaluator threshold to `ratio >= 1.3 AND last_month_ratio >= 1.3`.

### S-2 — No test asserts Phase 0 snake_case evidence keys

The 8 evaluator test files don't assert evidence key names against `shared/types/agentRecommendations.ts`. A regression re-introducing camelCase would not be caught. Add evidence-key assertion tests to `server/services/optimiser/recommendations/__tests__/`.

### S-3 — No test for `handleOptimiserScan`

`server/jobs/runOptimiserScanJob.ts` has no `*Pure.test.ts` peer. Add tests at `server/jobs/__tests__/runOptimiserScanJobPure.test.ts` covering: payload-to-arg plumbing, success log, error re-throw.

### S-4 — `median_version` not declared in shared evidence types

All 8 evaluators write `median_version` to evidence but `shared/types/agentRecommendations.ts` union members don't declare it. materialDelta doesn't read it, so a version-only delta triggers a spurious LLM re-render. Fix: add `median_version: number` to each evidence shape in the shared type (and doc-sync spec §6.5).

### N-2 — Undocumented placeholder values in evidence

`agentBudget.ts:65` `top_cost_driver: 'unknown'`, `cacheEfficiency.ts:64` `dominant_skill: 'unknown'`, `memoryCitation.ts:64` `projected_token_savings: 0`, `inactiveWorkflow.ts:78` `expected_cadence: 'daily'`. Add a comment marking these as future query-module work.

### N-4 — `subaccountAgentId` in `handleOptimiserScan` payload not logged

The job payload includes `subaccountAgentId` but it's not destructured in the handler's log lines. Useful for cross-referencing the SA row that fired the scan.

### OPS — Orphan `agent-scheduled-run:<optimiser-sa-id>` schedules

Any optimiser SA rows registered before this PR exist in pg-boss under `agent-scheduled-run:<id>`. These fire daily and hit the LLM agent loop. At next deploy: run a one-time `pgboss.unschedule('agent-scheduled-run:<id>')` for each optimiser SA (query: `SELECT sa.id FROM subaccount_agents sa JOIN agents a ON a.id = sa.agent_id JOIN system_agents sya ON sya.id = a.system_agent_id WHERE sya.slug = 'subaccount-optimiser'`). Optionally add an orphan handler on `agent-scheduled-run` that drops jobs from optimiser agents (pattern: lines 107-110 in agentScheduleService.ts).

## Spec Review deferred items

### agentic-commerce (2026-05-03)

- [ ] Shadow-vs-live delta panel — non-trivial UI surface; existing Spend Ledger `mode = 'shadow'` filter in Chunk 14 captures most value for the promotion decision; defer until v1 produces evidence operators can't decide without a side-by-side view. [user]
- [ ] Per-skill execution-timeout overrides (`executionTimeoutMinutes: number | null` on `ActionDefinition`) — v1 ships single global `EXECUTION_TIMEOUT_MINUTES` default 30; non-breaking addition when needed. Defer until a specific v1 skill produces evidence 30 min is too short. [user]
- [ ] Implementation Contract Checklist — pre-build artifact translating spec invariants to enforceable DB/code rules (constraint map, allowed-transitions table, idempotency enforcement points, webhook validation checklist, retry classification enforcement, required logs per transition). ChatGPT advisory from R4; high ROI for engineer handoff. [user]

### pre-launch-phase-3 (2026-05-05)

- [ ] CI gate: "no raw DB writes outside transaction helpers" — Phase 4 candidate. Source: chatgpt-spec-review round 1 finding F6. Forbids `db.insert/update/delete` outside `withOrgTx` / explicit `db.transaction(...)` blocks. Allowlist for system bootstrap, migrations, RLS policy enforcement queries, admin tooling. Aligns with org-scoping invariants but outside Phase 3's deferred-backlog charter. Co-locate with R3-2 `AppError` taxonomy backfill (also Phase 4) — both items "tighten the write surface." [user]

---

## Deferred from pr-reviewer + adversarial-reviewer (workflows-v1) — 2026-05-03

Source logs:
- `tasks/review-logs/pr-review-log-workflows-v1-2026-05-03T00-00-00Z.md`
- `tasks/review-logs/adversarial-review-log-workflows-v1-2026-05-03T00-00-00Z.md`

Branch: `claude/workflows-brainstorm-LSdMm`. Build slug: `workflows-v1`. All blocking findings (B1–B5) and CRITICAL/HIGH adversarial findings (F1, F2, F5, F6, F8) plus strong pr-reviewer findings (S1–S6) have been applied in-spec / in-plan in the same session. Remaining items below are non-blocking improvements and lower-severity adversarial concerns deferred to either the workflows-v1 implementation (where they land in the relevant chunk's acceptance criteria) or to a follow-up V2 spec.

### W1-N1 — Spec §3.1 `agent_execution_events` invariant duplicates §8.1

**Source:** pr-reviewer N1.
**Action:** condense §3.1 row to a one-line cross-reference to §8.1 (which has the canonical allocation invariant in full). Cleanup, not load-bearing.
**Owner:** spec polish; can fold into Chunk 1 PR or a docs-sync follow-up.

### W1-N2 — Plan Chunk 0 spike effort accounting

**Source:** pr-reviewer N2.
**Action:** clarify that the 2-day spike is on top of the ~40-day baseline, not inside it. Plan reads ambiguous; the operator should know the spike is a sunk cost on top.
**Owner:** plan polish; can fold into the next plan revision.

### W1-N3 — Spec §16.5 effort estimate (~59d) vs plan's revised baseline (~40d)

**Source:** pr-reviewer N3.
**Action:** spec §16.5 still cites ~59 engineer-days; plan's primitive-reuse re-baseline is ~40d. Either update spec §16.5 or add a one-line "plan-gate re-baseline: ~40 engineer-days (see plan.md line 303)" so future spec readers know the spec figure is stale.
**Owner:** spec polish.

### W1-N4 — Plan §Risks markdown anchor links

**Source:** pr-reviewer N4.
**Action:** for the most consequential risks, add `(Chunk N)` anchor links in the mitigation cells. Low-effort navigation improvement.
**Owner:** plan polish.

### W1-F3 — `assignable-users` email enumeration mitigation

**Source:** adversarial-reviewer F3 (MEDIUM).
**Action:** consider redacting email for users not in caller's subaccount membership; OR rate-limiting the endpoint (max 10 unique subaccount-IDs per minute per org admin); OR requiring an explicit "I want to assign across subaccounts" admin permission. V1 may ship as-is if the operator accepts the tradeoff (org admins are relatively trusted), but it should be a deliberate trade-off, not an oversight.
**Owner:** Chunk 10 acceptance criteria — operator decides ship-as-is vs. add mitigation.

### W1-F4 — Approver-pool snapshot UUID normalisation

**Source:** adversarial-reviewer F4 (LOW, worth-confirming).
**Action:** spec §5.1 should pin the `ApproverPoolSnapshot` normalisation contract — UUIDs lowercase, branded type, parsed at write-time. Without this, a `userInPool` equality check could fail for a legitimate approver if the snapshot captured uppercase UUIDs or surrogate IDs.
**Owner:** Chunk 4 acceptance criteria + spec §5.1 polish.

### W1-F7 — Stall-and-notify cancellation race verification

**Source:** adversarial-reviewer F7 (LOW, worth-confirming).
**Action:** verify at Chunk 8 implementation time that the `expectedCreatedAt` stale-fire guard correctly handles the race where the pg-boss job starts executing between `resolved_at` SET and the job-cancel call. Spec analysis suggests it does; confirm with a unit test.
**Owner:** Chunk 8 implementation + test author.

### W1-F9 — Cadence-detection NLP heuristic gameability note

**Source:** adversarial-reviewer F9 (LOW).
**Action:** add a one-line note in spec §13.1 that the cadence-detection heuristic is advisory only — any draft created from it goes through the standard publish flow with full validation, so user-tuned prompts can't bypass authorisation. Documentation only; no code change.
**Owner:** spec polish.

### W1-F10 — Aggregate cost cap across `workflow.run.start`-spawned children (V2)

**Source:** adversarial-reviewer F10 (MEDIUM).
**Action:** V1 acceptable as-is now that F6's depth cap (max 3) is in place (3 levels × ~10 children per level × $5 = $150 worst-case). V2 should add an aggregate "lineage cost" cap across a parent run and all `workflow.run.start`-spawned descendants. Track in workflows V2 spec.
**Owner:** workflows V2 spec.

### W1-F11 — `approval.queued` event approver-pool ID broadcast

**Source:** adversarial-reviewer F11 (LOW).
**Action:** verify at Chunk 9 implementation time whether the client resolves approver-pool IDs to display names. If yes, consider broadcasting only a hash + count rather than the full ID list, OR scope the broadcast to subscribers who are themselves in the pool.
**Owner:** Chunk 9 implementation + Chunk 11 (open task UI) consumer review.

### W1-spec19 — Confidence-chip cut-points decision before launch

**Source:** adversarial-reviewer additional observation.
**Action:** spec §19.1 #A (confidence-chip cut-points) is left to architect after collecting 100 internal cards. Track as a release blocker in spec §19; if never formally decided, `workflowConfidenceCopyMap.ts` ships with placeholder values producing misleading confidence in production.
**Owner:** architect post-Chunk-6.

### W1-pre-existing-1 — Pool-membership CI gap documentation

**Source:** adversarial-reviewer additional observation.
**Action:** add a note to `DEVELOPMENT_GUIDELINES.md` that `verify-rls-coverage.sh` does NOT catch pool-membership / authz checks (it's RLS-coverage only). Manual reviewer is the only gate today; improving CI coverage of authz patterns is a separate codebase-audit follow-up.
**Owner:** DEVELOPMENT_GUIDELINES.md docs-sync follow-up.

### W1-approval-pool-refresh — `approval.pool_refreshed` event payload

**Source:** adversarial-reviewer additional observation.
**Action:** confirm at Chunk 5 implementation time that the Approval card re-fetches the gate's authoritative pool snapshot after a `pool_refreshed` event (not just the `new_pool_size`). If the client renders pool members anywhere, stale display is possible without the re-fetch.
**Owner:** Chunk 5 + Chunk 11 consumer review.

---

## Deferred from spec-conformance review — ghl-module-c-oauth (2026-05-03)

**Captured:** 2026-05-03T04:47:51Z
**Source log:** `tasks/review-logs/spec-conformance-log-ghl-module-c-oauth-2026-05-03T04-47-51Z.md`
**Spec:** `docs/ghl-module-c-oauth-spec.md`

- [ ] REQ #25 — `autoStartOwedOnboardingWorkflows` partially executes inline; spec mandates pure pg-boss enqueue.
  - Spec section: §6 Phase 3 ("Queue invariant: `autoStartOwedOnboardingWorkflows` MUST enqueue each workflow job via pg-boss — never execute inline")
  - Gap: `subaccountOnboardingService.autoStartOwedOnboardingWorkflows` calls `startOwedOnboardingWorkflow` synchronously, which performs DB writes and `WorkflowEngineService.enqueueTick(runId)` — the run-row insert and template lookup happen inline. For a 500-location burst inside the OAuth callback, this serialises 500 workflow-resolution + insert round-trips before the callback returns. The TODO comment at `server/services/ghlAgencyOauthService.ts:242` acknowledges this gap.
  - Suggested approach: introduce a thin pg-boss job (e.g. `auto-start-onboarding`) whose payload is `(organisationId, subaccountId, startedByUserId)`; have the service publish one job per inserted location and let the existing handler invoke `startOwedOnboardingWorkflow` async. Migration concern: the run-deduplication logic at `startOwedOnboardingWorkflow:253-272` needs to stay correct under concurrent invocation. Decision needed on whether the OAuth callback path should still wait for any acknowledgement or fire-and-forget.

- [ ] REQ #23 / REQ #30 — `notify_operator` not actually fired for enumeration truncation or UNINSTALL.
  - Spec sections: §5.5 ("emit a single `notify_operator` event"), §5.4 ("(4) fire `notify_operator` (org-admin recipient)")
  - Gap: `server/services/ghlAgencyOauthService.ts:170-176` and `server/services/ghlWebhookMutationsService.ts:177-181` only emit `logger.warn`/`logger.info` — the spec-named `notify_operator` action (registered in `server/config/actionRegistry.ts:2776` as a workflow action) is never invoked. Both sites carry TODO comments stating "fire notify_operator skill when it is wired as a callable primitive".
  - Suggested approach: `notify_operator` is currently a workflow-action node, not a service-callable function. Two architectural options: (a) build a lightweight `operatorNotificationService` that creates an `agency_inbox_alerts` row directly without going through the workflow engine; (b) define a system workflow `ghl-truncation-alert` / `ghl-uninstall-alert` and dispatch via pg-boss with a templated payload. Option (a) is simpler but creates a parallel notification path; option (b) is consistent with the registry but requires authoring the workflow definitions. Needs a design decision before implementation.

- [ ] REQ #33 — Missing-`webhookId` for lifecycle events returns generic 400 with misleading message.
  - Spec section: §5.4 ("Events missing `webhookId` are rejected with **HTTP 400**")
  - Gap: `server/routes/webhooks/ghlWebhook.ts:45` uses `if (eventType && webhookId && companyId && lifecycleTypes.has(eventType))` — when a lifecycle event type arrives without `webhookId`, control falls through to the location flow at line 74 which 400s with `'Missing locationId'`. Status code is correct but the error code/message does not name the actual contract violation. A genuinely malformed lifecycle replay without `locationId` would also be misclassified.
  - Suggested approach: split the lifecycle gate so a lifecycle eventType with missing `webhookId` short-circuits to `400 { error: 'Missing webhookId', code: 'WEBHOOK_MISSING_ID' }` before the locationId fallback. The `classifyWebhookEvent` pure helper already throws on missing webhookId — reuse that path at the route layer. Watch for unintended impact on non-lifecycle events that legitimately lack webhookId today.

## Deferred from pr-reviewer + adversarial-reviewer — ghl-module-c-oauth (2026-05-03)

**Captured:** 2026-05-03T05:58:35Z
**Source logs:**
- `tasks/review-logs/pr-review-log-ghl-module-c-oauth-2026-05-03T05-58-35Z.md`
- `tasks/review-logs/adversarial-review-log-ghl-module-c-oauth-2026-05-03T05-58-35Z.md`

- [ ] **S1 — Lifecycle webhook `peek-before-dispatch` dedupe.** `server/routes/webhooks/ghlWebhook.ts:91` calls `webhookDedupeStore.isDuplicate(webhookId)` only AFTER side effects ran (correct per §5.4). On GHL retries the side effects re-fire — they are idempotent (xmax=0 upsert pattern), so this is "safe but wasteful, not a correctness bug" per the reviewer. To suppress wasted work, add a `peek(id)` method to `WebhookDedupeStore` and check it BEFORE calling `dispatchWebhookSideEffects`. Out of scope for the security-fix pass; only worth doing if the wasted dispatch cost (one GHL `/locations/search` enumeration per duplicate INSTALL) becomes measurable.

- [ ] **Adversarial confirmed-hole #2 — OAuth callback should verify session org matches state nonce.** `server/routes/oauthIntegrations.ts:307-414` consumes the state nonce → orgId without checking that the browser session at callback time belongs to a member of `ghlOrgId`. Cross-site delivery of an Org A nonce to an Org B user could cause Org B to complete Org A's install (leaking Org B's GHL credentials into Org A's namespace). Mitigation options: (a) require an authenticated session at callback time (re-using the existing session JWT) and assert `userOrg === stateOrg`; (b) bind a session fingerprint into the nonce at issue and verify at consume. Option (b) is more aligned with the unauthenticated-by-design webhook+callback pattern; option (a) breaks browser-redirect ergonomics for users not logged in. Decision needed before Stage 6b real-agency verification.

- [ ] **Agency-level canonical mutation rows.** `server/services/ghlWebhookMutationsService.ts dispatchWebhookSideEffects` now returns `organisationId` for INSTALL and UNINSTALL, but no `subaccountId` (those events are agency-scope). The Staff Activity Pulse (§2.0b) writer at `recordGhlMutation` short-circuits to `skipped_no_subaccount` when subaccountId is null. Two follow-up options: (a) extend `canonical_subaccount_mutations` to allow `subaccount_id IS NULL` for agency-scope rows (schema change + RLS-policy update + downstream readers handling null); (b) materialise an "agency root" subaccount per organisation and use it as the carrier for agency-level mutations. Decision needed before reporting on operator install/uninstall events.

- [ ] **In-memory `ghlOAuthStateStore` not cluster-safe.** `server/lib/ghlOAuthStateStore.ts` is a process-local Map — multi-instance deployments will fail nondeterministically as nonces issued on instance A are not visible to instance B. The file flags this in a header comment but no runtime assertion guards production deployment. Replace with Redis (matching `webhookDedupeStore`'s production replacement TODO) or a `ghl_oauth_states` DB table with TTL sweep. At minimum, add a startup assertion that fails loudly when `NODE_ENV === 'production'` and `OAUTH_STATE_STORE_DRIVER !== 'memory_acknowledged'`.

- [ ] **`enumerateAgencyLocations` cap can briefly overflow + no global circuit breaker.** `server/services/ghlAgencyOauthService.ts:100-151` — if GHL returns more than `GHL_PAGINATION_LIMIT` items in a single page (ignoring the `limit` param), the array can briefly exceed `GHL_LOCATION_CAP`. Tighten by `all.push(...page.slice(0, GHL_LOCATION_CAP - all.length))`. Separately, `withBackoff` retries (4 attempts × up to 4s × 10 pages) can wall-clock ~160s under sustained 5xx, with no per-org or global circuit breaker — only the OAuth-callback caller wraps a 15s timeout, the INSTALL_company webhook caller does not. Add a cumulative-time budget + a per-companyId circuit breaker.

- [ ] **`docs/create-ghl-app.md` env-var name drift.** The doc references `GHL_APP_WEBHOOK_SECRET` but the runtime uses `GHL_WEBHOOK_SIGNING_SECRET` (defined in `server/lib/env.ts` and consumed in `server/routes/webhooks/ghlWebhook.ts`). Align the doc to the runtime name to avoid operator misconfiguration.

- [ ] **Drop dynamic-import + duck-typed cast for `autoEnrolAgencyLocations` in OAuth callback.** `server/routes/oauthIntegrations.ts:399-402` imports the function via `await import(...) as unknown as { autoEnrolAgencyLocations?: ... }`. The function exists now; replace with a top-of-file static import.

- [ ] **`oauthProviders.ts` GHL `tokenUrl` duplication.** `server/config/oauthProviders.ts:52-72` defines a `tokenUrl`, but `exchangeGhlAuthCode` (`server/services/ghlAgencyOauthService.ts:26`) hard-codes the same URL. Either route the exchange through the registry-driven helper or remove the unused entry — do not let two sources drift.

- [ ] **GHL unauthenticated auto-start onboarding silently no-ops under FORCE RLS.** `server/services/subaccountOnboardingService.ts` uses module-level `db` and queries FORCE-RLS tables (`org_subscriptions`, `workflow_runs`, `workflow_templates`). Two callers reach this from unauthenticated contexts where no `app.organisation_id` GUC is set on the pool connection: (a) `server/services/ghlAgencyOauthService.ts:autoEnrolAgencyLocations` (OAuth callback + INSTALL_company webhook), (b) `server/services/ghlWebhookMutationsService.ts dispatchWebhookSideEffects` LocationCreate path. Result: every owed-onboarding lookup returns 0 rows, no auto-start fires. The previous `db.transaction(async (tx) => set_config; ...)` wrapper around the call did NOT scope the inner queries — drizzle's `tx` and module-level `db` use different pool connections. The wrapper has been removed (false confidence) — failure is now honest. Fix options: (i) refactor `subaccountOnboardingService` to accept an explicit `tx` parameter or use `getOrgScopedDb()` so callers can wire it through `withOrgTx`; (ii) extend admin-bypass to `subaccountOnboardingService` for the unauthenticated paths only — high blast radius because `WorkflowRunService.startRun` is invoked downstream and itself touches RLS-protected tables. Decision needed before Stage 6b real-agency verification — without it, GHL-installed subaccounts never auto-start their onboarding workflows. Source: codex dual-review 2026-05-03.

## Deferred from chatgpt-pr-review — PR #254 ghl-module-c-oauth (2026-05-03 round 1)

- [ ] **In-process `getLocationToken` mint lock is single-instance.** `server/services/locationTokenService.ts:29` uses a module-level `Map<string, Promise<string>>` to coalesce concurrent mints for the same `(configId, locationId)` pair. DB unique partial index `(connector_config_id, location_id) WHERE deleted_at IS NULL` is the authoritative correctness guard, so cross-instance racers correctly settle via the `INSERT … ON CONFLICT DO NOTHING RETURNING` race-loser re-read path. The lock is a perf optimisation only (avoids redundant cold-start mints in a single worker). When moving beyond single-instance, either accept the redundant mint cost or replace with an advisory lock keyed on `hashtext(connector_config_id || ':' || location_id)`. Source: chatgpt-pr-review PR #254 round 1 finding 5.

- [ ] **Centralise GHL retry classification.** Spec §5.8 documents the canonical retry policy (429 + 5xx retryable, 4xx hard fail). The implementation respects it but inlines the `isRetryable` predicate at every `withBackoff` call site in `server/services/locationTokenService.ts` and `server/services/ghlAgencyOauthService.ts`. Extract to a shared `isGhlRetryable(err)` helper so future call sites can't drift. Source: chatgpt-pr-review PR #254 round 1 finding 6.

- [ ] **Slug-collision third-tier fallback (UUID).** `server/services/ghlAgencyOauthService.ts:231` and `server/services/ghlWebhookMutationsService.ts:252` retry slug generation with `[baseSlug, baseSlug-${locId.slice(-4)}]` and on second-tier collision skip the location with a `slug_collision_unresolved` log line. GHL location IDs are 24-char unique opaque strings, so a same-`(name, last-4)` collision is vanishingly rare in practice — but possible. Add a third tier `${baseSlug}-${crypto.randomUUID().slice(0, 8)}` so we never need an operator runbook entry to resolve enrolment-time slug collisions. Source: chatgpt-pr-review PR #254 round 1 finding 7.

## Deferred from chatgpt-pr-review — PR #254 ghl-module-c-oauth (2026-05-03 round 2)

- [ ] **Cascade location-token soft-delete when agency token is permanently revoked.** When `connectorConfigService.refreshAgencyTokenIfExpired` flips `connector_configs.status='disconnected'` on a permanent 401 (lines 432-440 of `server/services/connectorConfigService.ts`), the existing per-connector `connector_location_tokens` rows are not soft-deleted. They become unreachable through any live code path because `findAgencyConnectionByCompanyId` filters `ne(status, 'disconnected')`, so the staleness is harmless — but the rows linger until the next UNINSTALL webhook (which mass-soft-deletes them) or a one-time cleanup query. Add a parallel `UPDATE connector_location_tokens SET deleted_at=now() WHERE connector_config_id=? AND deleted_at IS NULL` inside the same admin-bypass block so the table stays tidy. **When required:** before high-churn orgs (where stale-row buildup becomes operator-visible in counts/storage). Source: chatgpt-pr-review PR #254 round 2 finding 1.

- [ ] **Add `grant_type` / token-source column to `connector_location_tokens` and `connector_configs`.** Currently both tables persist tokens without recording how the token was acquired (`agency_oauth_mint`, `location_oauth`, `direct_install`, `manual_paste`, `user_oauth`, future provider-specific grant types). When a second OAuth provider lands or when GHL adds a new grant flow, distinguishing source is a join-on-nothing problem. Cheap migration now (`token_source text`, default backfill `'agency_oauth_mint'` for existing GHL rows) saves a debugging session later when an operator needs to filter by source. **When required:** when the second OAuth provider lands. Source: chatgpt-pr-review PR #254 round 2 finding 6.

- [ ] **Operator-facing kill switch UI / endpoint for `connector_configs.status='disconnected'`.** The status enum (`'active' | 'error' | 'disconnected'`) and short-circuiting at `findAgencyConnectionByCompanyId` + `connectorPollingTick` are already in place. What's missing is a one-click admin path: `POST /api/admin/connector-configs/:id/disable` that flips the status to `disconnected` and soft-deletes the location tokens (see related cascade item above). Useful in production incident response when a partner integration is misbehaving. **When required:** before the first production incident (operator response time gates this). Source: chatgpt-pr-review PR #254 round 2 finding 7.

## Deferred from setup refactor — 2026-05-03

**Captured:** 2026-05-03
**Source:** session refactoring agent fleet + adding ADR + context-pack + hotfix conventions
**Status update (2026-05-03 same day):** all 8 items addressed inline — see resolution notes per item.

- [x] [origin:setup-refactor:2026-05-03] [status:resolved] Migrate historical KNOWLEDGE.md "Decision" entries into proper ADRs under `docs/decisions/`
  - Resolution: 5 ADRs written (0001-0005) covering the clearest decisions: mixed-mode review agents, interactive vs walk-away review agents, workspace identity canonical pattern, GEO skills as methodology skills, risk-class split rollout. Remaining 6 historical Decision entries judged to be patterns/observations/research-notes rather than ADR-worthy and stay in KNOWLEDGE.md.

- [x] [origin:setup-refactor:2026-05-03] [status:resolved] Section-anchor architecture.md so context-packs can splice precisely
  - Resolution: 54 HTML anchors added via Python script. All 5 context-pack files updated to reference specific anchors (`architecture.md#service-layer`, etc.).

- [x] [origin:setup-refactor:2026-05-03] [status:resolved] Build the `context-pack-loader` skill that reads a pack and emits sliced content
  - Resolution: agent at `.claude/agents/context-pack-loader.md`. Inline playbook (not a sub-agent — that would defeat the token-savings point). Wired into CLAUDE.md fleet table. Auto-triggered by `current-focus.md` status when operator types "load context pack" without naming a mode.

- [x] [origin:setup-refactor:2026-05-03] [status:resolved] Slim `.claude/agents/spec-reviewer.md` by extracting the directional-signals classifier
  - Resolution: 70 lines extracted to `references/spec-review-directional-signals.md`. Agent file: 575 → 509 lines. Saves tokens on every spec-reviewer invocation.

- [x] [origin:setup-refactor:2026-05-03] [status:resolved] Archive sweep of `tasks/todo.md`
  - Resolution: 9 fully-resolved sections (every checkbox `[x]`) moved to `tasks/todo-archive/2026-Q2.md`. todo.md: 2,567 → 2,411 lines. Mixed and all-open sections kept — they're active backlog.

- [x] [origin:setup-refactor:2026-05-03] [status:resolved] Archive sweep of `docs/`
  - Resolution: 0 docs eligible for automated archive after re-verification (the original 4 candidates were false positives — see `tasks/docs-archive-triage-2026-05-03.md` for analysis). Durable enabler shipped instead: Status: header convention added to `docs/spec-authoring-checklist.md § 11`. Future archive sweeps will work once specs adopt the header.

- [x] [origin:setup-refactor:2026-05-03] [status:resolved] Add a "codebase-explainer" agent for external onboarding
  - Resolution: agent at `.claude/agents/codebase-explainer.md`. Produces `docs/codebase-tour.md`. Different audience from architecture.md (human-facing prose vs agent-facing dense reference). Wired into CLAUDE.md fleet table.

- [x] [origin:setup-refactor:2026-05-03] [status:resolved] Wire spec-reviewer to enforce `docs/spec-context.md` staleness check
  - Resolution: staleness gate added to `spec-reviewer.md § Step A`. Reads `last_reviewed_at` / `stale_after_days` / `stale_blocks_at_days` from spec-context.md YAML block. Yellow warning at `stale_after_days`, red block at `stale_blocks_at_days`. Falls back to yellow + deferred-item if the staleness header is missing.

## Deferred from setup audit — 2026-05-03

**Captured:** 2026-05-03 (audit pass before propagating framework to other repos)
**Scope:** items surfaced during the pre-propagation audit. Each is HIGH-VALUE but HIGH-COST — too risky to land in the same session as the smaller fixes.

- [ ] [origin:setup-audit:2026-05-03] [status:open] Extract shared boilerplate from `chatgpt-pr-review.md` (976 lines) and `chatgpt-spec-review.md` (667 lines) to `references/chatgpt-review-protocol.md`
  - **Why:** the two files have the EXACT same 7-section structure (`Configuration`, `Before doing anything else, read`, `On Start`, `Per-Round Loop`, `Finalization`, `Log Format`, `Rules`). Probably 30-40% shared content (round handling, finding triage shape, KNOWLEDGE.md sweep, doc-sync at finalisation, log format). Saves ~400 tokens/session when either agent runs.
  - **Approach:** read both end-to-end, identify shared sections, extract to `references/chatgpt-review-protocol.md`. Each agent then carries only its mode-specific content + a pointer.
  - **Risk:** breaking either agent's flow if the extraction over-merges. Agents are load-bearing for review pipeline. Test by running each on a real PR/spec after extraction.

- [ ] [origin:setup-audit:2026-05-03] [status:open] Move domain-specific subsystem sections out of `architecture.md` (3,542 lines) to `architecture/<domain>.md` files
  - **Why:** 15 of 19 agents always-load architecture.md. Domain-specific subsystems (IEE 423 lines, Playbooks 299 lines, ClientPulse Intervention Pipeline 190 lines, Scraping Engine 150 lines, Run Continuity 124 lines) only matter when working on those subsystems. Their full-load tax is paid every session whether the session touches them or not. Saves ~1,200 tokens always-loaded.
  - **Approach:** create `architecture/iee.md`, `architecture/playbooks.md`, etc. Replace each domain section in `architecture.md` with a one-paragraph summary + pointer. Update context-pack anchors that reference moved sections. Confirm `KNOWLEDGE.md` cross-references still resolve.
  - **Risk:** breaks every agent that loads `architecture.md` until their context-loading instructions are updated. Better done once context-pack-loader is wired to all agents (next deferred item below).

- [ ] [origin:setup-audit:2026-05-03] [status:open] Wire the agent fleet to use context packs by default (not opt-in)
  - **Why:** `context-pack-loader.md` ships in this version but is operator-invoked. Most agents still load full architecture.md. To realise the token savings, each agent's `Context Loading` step should default to its matching pack: `pr-reviewer` → review pack, `architect` → implement pack, etc.
  - **Approach:** edit each agent's Context Loading block to read "load context pack: <mode> (or fall back to listed full files if pack-loader is unavailable)". Pack name comes from a per-agent table.
  - **Risk:** agents need their packs to actually contain the sections they need. Requires the architecture.md domain-split above to land first, otherwise packs reference monolithic sections.

- [ ] [origin:setup-audit:2026-05-03] [status:open] Add a `validate-setup` skill that confirms the agent fleet is healthy in a new repo
  - **Why:** ADAPT.md Phase 4 does this once at setup time. After that, drift accumulates silently — anchors get renamed, agents get edited, the operator never re-runs ADAPT. A `validate-setup` skill would re-check on demand and emit a health report.
  - **Approach:** new agent at `.claude/agents/validate-setup.md`. Steps: (1) read every agent in fleet, confirm referenced files exist; (2) read every context pack, confirm referenced anchors exist; (3) check `FRAMEWORK_VERSION` against latest known; (4) check `KNOWLEDGE.md` size; (5) check `tasks/todo.md` size; (6) emit a report.

- [ ] [origin:setup-audit:2026-05-03] [status:open] Quarterly KNOWLEDGE.md grouping pass
  - **Why:** the size-bound policy (KNOWLEDGE.md preamble) prescribes a quarterly grouping pass but no agent runs it. Without an agent, the policy is aspirational.
  - **Approach:** extend `audit-runner` with a `knowledge` mode that reads KNOWLEDGE.md, identifies thematically duplicate entries, appends summary entries that cite originals by date, never edits originals. Run quarterly.

- [ ] [origin:setup-audit:2026-05-03] [status:open] Backfill `Status:` headers across the existing 84 specs in `docs/`
  - **Why:** the Status: convention added in this session is forward-looking only. The existing 84 specs lack it, so docs/ archive sweeps still produce 0 candidates (per the 2026-05-03 triage report). One-time backfill unlocks the future archive sweeps.
  - **Approach:** `audit-runner` mode that reads each spec, infers status from `tasks/builds/<slug>/handoff.md` (if it exists) and merge state, writes the header. Operator review before commit.

## Deferred from adversarial-reviewer — agentic-commerce (2026-05-03)

**Captured:** 2026-05-03T22:07:50Z
**Source log:** `tasks/review-logs/adversarial-review-log-agentic-commerce-2026-05-03T22-07-50Z.md`
**Spec:** `tasks/builds/agentic-commerce/spec.md`
**Branch:** `claude/agentic-commerce-spending`

One blocker fixed in branch (Finding 2.2 — webhook `connectionStatus` allowlist at `server/routes/webhooks/stripeAgentWebhook.ts:155`). Three reviewer findings dissolved as false positives or by-design. Items below are deferred.

- [ ] **AC-ADV-1** — Stylistic inconsistency: `chargeRouterService.updateChargeStatus` uses `SELECT set_config('app.spend_caller', $1, true)` while all other GUC setters in the same diff use `SET LOCAL "app.spend_caller" = $1`. Both are correct inside an active org-scoped transaction (which `getOrgScopedDb` guarantees), but mixing styles is a maintenance hazard. Convert to `SET LOCAL` for consistency.
  - File: `server/services/chargeRouterService.ts:138`

- [ ] **AC-ADV-2** — `GET /api/spending-budgets?subaccountId=<id>` accepts a raw `subaccountId` query param without calling `resolveSubaccount(...)`. Org-scoping is enforced (RLS + app-layer org filter), but a same-org caller with `SETTINGS_EDIT` can enumerate subaccount budget summaries by guessing IDs. Product question: should org-level SPEND_APPROVER see all subaccounts' budgets, or only ones they administer? If the latter, gate via subaccount membership.
  - File: `server/routes/spendingBudgets.ts:85-91`, `server/services/spendingBudgetService.ts:82-88`

- [x] **AC-ADV-3** — DELETE `/api/approval-channels/:channelId/grants/:grantId` does not validate that `grantId` belongs to `channelId`. **CLOSED 2026-05-04** in chatgpt-pr-review Round 3 after ChatGPT independently raised the same point. `revokeGrant` now takes an optional `expectedOrgChannelId` parameter and throws 404 on mismatch; route handler passes `req.params.channelId`. Original dissolution rationale (SETTINGS_EDIT org-wide) was correct but defense-in-depth justified the apply when a second reviewer flagged it.

- [ ] **AC-ADV-4** — `approvalChannelService.requestApproval` active-approval guard filters on `metadataJson->>'category' = 'spend'` and `metadataJson->>'chargeId' = ...` without an explicit `eq(actions.organisationId, ...)` filter and without a supporting index. RLS on `actions` is the primary defence against cross-org leakage, but adding the explicit filter is best-practice defense-in-depth and a GIN index on `actions.metadataJson` (or a partial btree on the extracted chargeId path) would address the per-approval full-table-scan cost.
  - File: `server/services/approvalChannelService.ts:95-101`

- [ ] **AC-ADV-5** — `approvalExpiryJob` uses `sql.raw` with string-interpolated `cutoff.toISOString()`. `cutoff` is internal-derived (`deriveApprovalCutoff(now)`) so there is no current SQL-injection vector, but `sql.raw` bypasses Drizzle parameterisation. Convert to `sql\`... WHERE approval_expires_at < ${cutoff.toISOString()}::timestamptz LIMIT 1000\`` for consistency with every other job in the diff and to future-proof against any later change that makes `cutoff` partially user-controlled.
  - File: `server/jobs/approvalExpiryJob.ts:46-52`

- [ ] **AC-ADV-6** — `WebhookDedupeStore` for `stripe_agent` is sized at `MAX_ENTRIES = 10000` with a 96h TTL. Layer 2 (`last_transition_event_id` row check) and Layer 3 (DB trigger) still protect against double-processing if the LRU evicts a still-relevant entry, but the *primary* dedupe layer's intent (avoid DB round-trip on retries) is silently degraded under load. Add an instrumented counter + alert when eviction fires, or raise `MAX_ENTRIES` based on a measured high-watermark.
  - File: `server/lib/webhookDedupe.ts:13`, `server/routes/webhooks/stripeAgentWebhook.ts:38-39`

- [ ] **AC-ADV-7** — `stripeAgentWebhookService` `recordIncident` payload for cross-tenant `provider_charge_id` collisions includes both `webhookOrg` and `rowOrg` UUIDs in `errorDetail`. Per-org incident readers therefore see another org's identifier on this incident class. Severity is low (Stripe charge IDs are globally unique; this is an attacker-with-Stripe-collusion scenario), but the incident-log identifier exposure should be redacted: store `rowOrg = '<other>'` or hash it.
  - File: `server/services/stripeAgentWebhookService.ts:255-269`

- [ ] **AC-ADV-8** — `agentSpendRequestHandler` infers `executionPath` from `chargeType` via an implicit switch (`invoice_payment → main_app_stripe`, else `worker_hosted_form`). This duplicates information already on `ActionDefinition.executionPath`. A new chargeType added without updating the switch will silently mis-route. Derive `executionPath` from the registered action definition instead.
  - File: `server/jobs/agentSpendRequestHandler.ts:229`

- [ ] **AC-ADV-9** — `stripeAgentWebhookService` out-of-order webhook handling logs a warning and returns silently for ambiguous-sequence events when `_retryCount < 3`, with an in-code TODO acknowledging the re-enqueue mechanism is "outside scope for this chunk." Three retries will each return without re-enqueueing; the charge stays stuck until the reconciliation poll job intervenes. Wire actual re-enqueue (push event back onto pg-boss with a delay).
  - File: `server/services/stripeAgentWebhookService.ts:332-358`

- [ ] **AC-ADV-10** — `spending_budgets` table has no FK constraint preventing hard delete when in-flight `agent_charges` rows reference the budget. An org admin with `SETTINGS_EDIT` could orphan in-flight charges. Add `ON DELETE RESTRICT` (or `ON DELETE SET NULL` with explicit audit trail) to `agent_charges.spending_budget_id`. A migration is needed.
  - File: `migrations/0271_agentic_commerce_schema.sql`

- [ ] **AC-ADV-11** — `PATCH /api/spending-budgets/:id` accepts `disabledAt` from the request body as a string and converts via `new Date(disabledAt)` without validation. A malformed string yields `Invalid Date` which Drizzle serialises as `NaN`, producing an obscure DB error rather than a clean 400. Validate via Zod/zod-derived schema like the other PATCH handlers in the diff.
  - File: `server/routes/spendingBudgets.ts`

## Deferred from chatgpt-pr-review — agentic-commerce (2026-05-03 round 1)

**Captured:** 2026-05-03T22:41:01Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-agentic-commerce-2026-05-03T22-41-01Z.md`
**PR:** #255 (`claude/agentic-commerce-spending`)

ChatGPT Round 1 produced 8 findings. 5 auto-applied in-branch (1, 2, 4, 5, 7); the 3 below routed here as follow-up items. ChatGPT's Round 1 final verdict was *Yellow → close to green*.

- [ ] **AC-CGPT-1** — Missing retry / error model on `GrantManagementSection.load()` failures. Today the catch only fires a `toast.error` and leaves the UI in a hard-failed state (no retry button, no degraded view, no exponential-backoff). UX decision: pick one of (a) explicit "Retry" button on the failed-load state, (b) auto-retry with backoff up to N attempts, (c) degraded-view fallback rendering empty grants list with a banner. Apply project-wide as a pattern if (a) or (b) is chosen.
  - File: `client/src/components/approval/GrantManagementSection.tsx:40-55`

- [ ] **AC-CGPT-2** — `groupByIntent` time-semantics in `client/src/components/spend/RetryGroupingPure.ts` and related grouping helpers assume `createdAt: string` is always ISO-8601 with no timezone drift. The codebase invariant is "server-generated timestamps only" (Drizzle `.defaultNow()` + `withTimezone: true`), but the client has no explicit parse step. Consider one of: (a) explicit `Date.parse(createdAt)` + invariant-violation `console.warn` on `NaN`, (b) extract a `compareCreatedAt(a, b)` comparator helper, (c) document the invariant as a JSDoc on `groupByIntent` and call it day. Lower priority — current behaviour is correct in practice.
  - File: `client/src/components/spend/RetryGroupingPure.ts`

- [ ] **AC-CGPT-3** — `ConservativeDefaultsButton` `POST /spending-budgets/:id/conservative-defaults` lacks operator-visible safety guards. ChatGPT recommends one of: (a) a confirmation modal listing the fields about to be overwritten with the conservative defaults, (b) a diff preview (current → defaults) before commit, (c) idempotency indicator (e.g. button disabled when already at defaults). UX decision required — applying defaults to a freshly-created budget vs an in-use one have different risk profiles.
  - File: `client/src/components/spend/ConservativeDefaultsButton.tsx`

## Deferred from chatgpt-pr-review — agentic-commerce (2026-05-03 round 2)

**Captured:** 2026-05-03T23:24:25Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-agentic-commerce-2026-05-03T23-24-25Z.md`
**PR:** #255 (`claude/agentic-commerce-spending`)

ChatGPT Round 2 produced 8 findings. 3 auto-applied in-branch (2, 4, 5); 1 was already done in Round 1 (1 — DB-level UNIQUE in migration 0275); 4 routed here as follow-ups. ChatGPT's Round 2 verdict was *Green with 2 minor caveats*; both caveats were resolved or already in place. A side-finding (frontend↔server route mismatch on `GrantManagementSection`) discovered during Round 2 work was also fixed in this round — see the review log for detail.

- [ ] **AC-CGPT-R2-1** — `GrantManagementSection.handleAdd` and `handleRevoke` `await load()` after every mutation, blocking the UI until the full reload completes. ChatGPT Round 2 Finding 3 recommends fire-and-forget reload OR optimistic-with-background-sync to reduce perceived latency. Trade-off: this conflicts with the Round 1 server-authoritative-reload pattern that resolved the original mixed-update-strategy bug. Prefer to defer until the admin-config UI sees enough use to measure actual latency stacking. If applied: keep server-authoritative as the source of truth, but render an optimistic insert/remove immediately and reconcile on `load()` completion.
  - File: `client/src/components/approval/GrantManagementSection.tsx`

- [ ] **AC-CGPT-R2-2** — `formatSpendCardPure` does not insert thousands separators for large amounts. `999999.99` could read as `$999,999.99` for clearer comprehension. ChatGPT itself recommends keeping the pure function deterministic (no locale-dependent `Intl.NumberFormat`) and adding an optional formatter layer at the rendering tier instead. Two-tier: pure helper produces canonical `999999.99`, render layer optionally formats with `Intl.NumberFormat` for display.
  - File: `client/src/components/spend/formatSpendCardPure.ts`

- [ ] **AC-CGPT-R2-3** — `PendingApprovalCardLaneConfig.test.ts` hardcodes `expectedLanes = ['client', 'major', 'internal', 'spend']`. If the server adds a new lane, the test still passes (it only checks the hardcoded list is covered, not that the server's actual emit set is covered). Consider extracting the canonical lane set into a shared types file (`shared/types/pulseAttention.ts` or similar) and importing it into both server and test for true drift detection.
  - File: `client/src/components/dashboard/__tests__/PendingApprovalCardLaneConfig.test.ts`

- [ ] **AC-CGPT-R2-4** — `GrantManagementSection.load()` fires three parallel `api.get()` calls every time `orgId` changes. For large orgs with many channels and subaccounts, this can be slow. Consider: (a) caching org channels and subaccounts client-side (rare changes), (b) consolidating into a single `/api/approval-channels/grants/management-data` endpoint that returns all three, (c) prefetching at app load. Lower priority — admin-config UI traffic is low-volume.
  - File: `client/src/components/approval/GrantManagementSection.tsx`

## Deferred from chatgpt-pr-review — agentic-commerce (2026-05-03 round 3)

**Captured:** 2026-05-03T23:40:43Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-agentic-commerce-2026-05-03T23-40-43Z.md`
**PR:** #255 (`claude/agentic-commerce-spending`)

ChatGPT Round 3 produced 6 findings. 2 auto-applied in-branch (2, 3); 1 rejected as false positive (1 — see review log for trace); 3 routed here as follow-ups. ChatGPT's Round 3 verdict was *🟢 Clean green (production-safe)*. **chatgpt-pr-review LOOP CLOSED at Round 3.**

- [ ] **AC-CGPT-R3-1** — `availableSubaccounts` is derived from client state only, so a multi-tab race could let a user submit a (channel, subaccount) pair that's already granted by another tab. The DB-level partial UNIQUE in migration 0275 catches the actual data corruption — the user just gets a 404 / unique-violation error response on submit. ChatGPT itself flagged this as "Not worth fixing now, just noting." Multi-tab UX consistency is a UX nicety, not a correctness bug.
  - File: `client/src/components/approval/GrantManagementSection.tsx`

- [ ] **AC-CGPT-R3-2** — `loading` flag has a micro-edge: load A starts → load B starts → A's fetch ignored (correctly) → B errors before `setLoading(false)`. The user sees a stuck spinner until manual reload. Probability is low (requires concurrent loads + a fetch error on the latest); manual refresh resolves. If applied, the fix is to move `setLoading(false)` outside the generation-equality check in the finally block — but that contradicts the cancellation guard's intent (older loads shouldn't touch state at all). Better: use a separate ref for "the latest load's loading state" rather than a setState.
  - File: `client/src/components/approval/GrantManagementSection.tsx`

- [ ] **AC-CGPT-R3-3** — `humaniseChannelType` returns `channelType` directly when no label is registered, which means multiple channels of the same type render identically (e.g. two `slack` channels with different config look identical to the operator). v1 only ships `in_app` so the ambiguity doesn't manifest today. When a second channel type lands AND multiple instances of the same type can coexist, add a `name` column to `org_approval_channels` (and `subaccount_approval_channels`) and render channel `name + type`. Couples to `[2026-05-04] Rule — Do not introduce "future-use" schema columns without active invariants` in KNOWLEDGE.md — defer the schema add until the multi-channel-type build needs it.
  - File: `client/src/components/approval/GrantManagementSection.tsx`, `server/db/schema/orgApprovalChannels.ts`

## Deferred from Workflows V1 Chunks 5–6 (2026-05-03)

- [ ] **Chunk 5: `task_requester` pool uses `workflowRuns.startedByUserId` instead of `tasks.created_by_user_id`.** `server/services/workflowApproverPoolService.ts` task_requester branch resolves from `workflowRuns.startedByUserId` because `tasks` has no `workflow_run_id` FK in V1. When a `workflow_run_id` FK is added to `tasks`, update this branch to resolve from `tasks.created_by_user_id` instead. A V1/V2 comment is already in the code at the resolution site.

- [ ] **Chunk 5: `approval.pool_refreshed` WebSocket event not emitted on `/refresh-pool`.** Spec §5.1.2 requires emitting `approval.pool_refreshed` so open clients update their Approval card. This emission is deferred to Chunk 9 which owns the event taxonomy and WebSocket transport layer. Implement in `workflowStepGateService.ts resolveGate` / `workflowGateRefreshPoolService.ts` once Chunk 9's `emitTaskEvent` primitive is available.

- [ ] **Chunk 6: Minor quality cleanup (non-blocking).** `workflowRunService.ts` has 4 identical V1-atomicity-gap NOTE blocks (lines ~558, 716, 774, 814) — extract to a single comment. `workflowStepGateService.ts` has inline `import('...')` types for `SeenPayload`/`SeenConfidence` — move to top-level import block. `workflowConfidenceServicePure.ts signals` array emits all 5 entries (0-weight non-firing rules) while the fallback path emits `[]` — align to one shape.


## Deferred from spec-conformance review — workflows-v1 (2026-05-03)

**Captured:** 2026-05-03T20:29:16Z
**Source log:** `tasks/review-logs/spec-conformance-log-workflows-v1-chunks-3-8-2026-05-03T20-29-16Z.md`
**Spec:** `docs/workflows-dev-spec.md`
**Scope verified:** Chunks 3-8

- [ ] **REQ 6.4 — `workflowSeenPayloadService.ts` (impure wrapper) does not exist.** Plan Chunk 6 named this file as an impure orchestrator that loads run context. Implementation calls the pure builder (`buildSeenPayload`) directly from `workflowStepGateServicePure.ts → buildGateSnapshot`. Whether this is a missing layer or an intentional simplification (avoiding premature abstraction; gate service already loads runContext) needs human judgment.
  - Spec section: Plan Chunk 6 file list
  - Gap: file named in plan does not exist on disk
  - Suggested approach: either (a) add a one-line passthrough wrapper to satisfy the literal plan requirement, or (b) update the plan to reflect the inlined call chain. Option (b) is cleaner — the impure wrapper would be redundant since the gate service already provides the run-context load step.

- [ ] **REQ 7.9 — Pause / Resume / Stop routes diverge from spec contract.** Spec §7 names `POST /api/tasks/:taskId/run/{pause,resume,stop}`; implementation lands them at `POST /api/workflow-runs/:runId/{pause,resume,stop}` (`server/routes/workflowRuns.ts` lines 274, 294, 331). Implementation pattern matches existing approval route (`/api/workflow-runs/:runId/steps/:stepRunId/approve`); migrating to task-scoped URLs requires a `tasks → workflow_runs` lookup that depends on the deferred `workflow_run_id` FK on tasks (already noted in this todo file).
  - Spec section: §7 (Pause/Resume/Stop routes)
  - Gap: route URLs are run-scoped instead of spec-mandated task-scoped
  - Suggested approach: defer until the `workflow_run_id` FK on tasks lands; then add task-scoped variants (or replace the run-scoped routes). Alternatively, amend spec §7 to use run-scoped URLs to match the existing approval route convention — that would be a `chatgpt-spec-review` decision. Chunk 11 (open task UI) will consume these endpoints, so the decision must be made before Chunk 11 ships.

---

## Deferred from spec-conformance review — workflows-v1-phase-2 (2026-05-04)

**Captured:** 2026-05-04T06:53:23Z
**Source log:** `tasks/review-logs/spec-conformance-log-workflows-v1-phase-2-2026-05-04T06-53-23Z.md`
**Spec:** `docs/workflows-dev-spec.md`
**Plan:** `tasks/builds/workflows-v1-phase-2/plan.md`
**Scope verified:** Pre-chunk P0–P6 + Chunks 9, 10, 11, 12, 13, 14a, 14b, 15, 16

NOTE: Items REQ 6.4 and REQ 7.9 in the prior section ("Deferred from spec-conformance review — workflows-v1") are now CLOSED — REQ 6.4 was verified by P0 (no impure wrapper exists; the inlined design is intentional) and REQ 7.9 was implemented by P3 (task-scoped pause/resume/stop routes shipped). Operator may remove those two entries from the prior section.

- [ ] **REQ P1-8 — direct INSERTs into `workflow_runs` bypass the SQLSTATE 23505 → 409 conversion.** `server/services/workflowEngineService.ts:2556` (bulk-child fanout) and `:2806` (replay) both call `db.insert(workflowRuns)` directly. The partial unique index `workflow_runs_one_active_per_task_idx` will fire `23505` on these paths; without the catch in `WorkflowRunService.startRun:282-286`, callers get a raw 5xx instead of `TaskAlreadyHasActiveRunError → 409`. Plan acceptance criterion P1-8 explicitly required zero matches outside the service.
  - Spec section: pre-chunk P1, plan acceptance criterion P1-8
  - Gap: two direct-INSERT paths bypass the structured-error conversion
  - Suggested approach: refactor `engine.dispatchBulkChildren` and `engine.startReplay` to route through `WorkflowRunService.startRun` (or extract the `try/catch + 23505 detect` block into a helper that both paths consume). Alternatively, broaden `startRun`'s shape to accept the bulk-child / replay cases natively and consolidate the path. Avoid swallowing `23505` in the engine code without the structured error mapping.

- [ ] **REQ 9-9 — `normaliseApproverPoolSnapshot` not consumed by any service.** `shared/types/approverPoolSnapshot.ts` exports the normaliser but no service writes through it. `WorkflowApproverPoolService.resolvePool` returns the raw resolver output and `WorkflowGateRefreshPoolService` writes it directly to `workflow_step_gates.approver_pool_snapshot`. Plan acceptance: *"every snapshot write goes through `normaliseApproverPoolSnapshot`"*. Without this, `userInPool(snapshot, callerUuid)` checks can false-negative when the snapshot captures uppercase UUIDs from the `specific_users` author input.
  - Spec section: Chunk 9, plan REQ 9-9 + spec §5.1
  - Gap: snapshot back-fill at write sites missing
  - Suggested approach: wrap every write to `workflow_step_gates.approver_pool_snapshot` (in both `WorkflowApproverPoolService` and `WorkflowGateRefreshPoolService`) with `normaliseApproverPoolSnapshot(...)`. Add a regression test asserting an uppercase-input snapshot resolves correctly via `userInPool`.

- [ ] **REQ 9-10 — `WorkflowGateRefreshPoolService` does not emit `approval.pool_refreshed` task event.** Plan acceptance: *"approval.pool_refreshed is emitted by WorkflowGateRefreshPoolService after a successful re-resolution"*. Currently the service only logs `workflow_gate_pool_refreshed`. Without the WebSocket emission, all open Approval cards will not update their pool size after a `/refresh-pool` admin call.
  - Spec section: Chunk 9, spec §5.1.2 + §8.2 (event taxonomy)
  - Gap: missing WebSocket emission downstream of successful refresh
  - Suggested approach: after the successful `WorkflowStepGateService.refreshPool` write at `workflowGateRefreshPoolService.ts:148-153`, call `appendAndEmitTaskEvent(taskId, ..., 'gate', { kind: 'approval.pool_refreshed', payload: { gateId, actorId: requestingUserId, newPoolSize: snapshot.length, newPoolFingerprint: poolFingerprint(snapshot), stillBelowQuorum } })`.

- [ ] **REQ 9-11 — `approval.queued` and `ask.queued` events never emitted; `poolFingerprint` never sent on the wire. Sub-finding: fingerprint algorithm divergence (FNV-1a vs spec-named SHA-256).** Spec §8.2 + plan reduced-broadcast contract requires these events with `poolSize + poolFingerprint` instead of full ID lists. The `poolFingerprint` function exists at `shared/types/approverPoolSnapshot.ts:35-48` but is never called from any service. Without the upstream emit, Chunk 11's Approval-card REST snapshot fetch trigger has no signal to react to. The sub-finding: fingerprint uses FNV-1a (spec quote: *"sha256(sortedJoinedIds).slice(0, 16) — 64 bits of entropy"*); switching to SHA-256 is mechanical but changes every emitted fingerprint.
  - Spec section: Chunk 9, spec §8.2 (event taxonomy + reduced-broadcast contract)
  - Gap: gate-open path missing event emission; fingerprint algorithm differs from spec
  - Suggested approach: in `WorkflowStepGateService.openGate` (or whichever call site creates the gate row), call `appendAndEmitTaskEvent` with `kind: 'approval.queued'` (or `'ask.queued'`) carrying `poolSize + poolFingerprint(snapshot) + seenPayload + seenConfidence`. Decide separately whether to migrate the fingerprint to SHA-256 (matches the spec literal) or amend the spec to allow FNV-1a (functionally equivalent, simpler bundle).

- [ ] **REQ 9-12 — `step.approval_resolved` event is never emitted from any path.** Plan acceptance lists both `step.awaiting_approval` (which IS emitted at `workflowEngineService.ts:1620`) AND `step.approval_resolved`. The latter has no producer. Spec scope covers both `reviewKind` values: workflow-internal action approvals AND agentic-commerce spend approvals (the plan's round-4 cross-system coupling rule explicitly says `workflowEngineService` is the SOLE emitter for both).
  - Spec section: Chunk 9, plan REQ 9-12 + plan §"Ownership of `step.approval_resolved`"
  - Gap: emission point in the engine resume / decision-resolution path missing
  - Suggested approach: in the action-approval resolution path AND in the spend-approval resume-poll path inside `workflowEngineService`, emit `step.approval_resolved` with `{ stepId, reviewKind, actionId, decision }` immediately before the next-step dispatch. Per plan ordering: emit MUST land before the next step is dispatched so the timeline shows resolved-then-next-started in order.

- [ ] **REQ 9-14 — observability counters named in plan not implemented.** Plan §Chunk 9 lists prom-style counters `workflow_run_paused_total`, `workflow_gate_open_total`, `workflow_gate_resolved_total`, `workflow_gate_stalled_total`, `workflow_gate_orphaned_cascade_total`, `task_event_gap_detected_total`, `task_event_subsequence_collision_total`, `task_event_invalid_origin_total`, `task_event_invalid_payload_total`, `workflow_cost_accumulator_skew_total`. Implementation has only a `console.log` event-stats counter in `emitters.ts`.
  - Spec section: Chunk 9, plan §"Observability metrics counters"
  - Gap: no Prometheus / equivalent counter primitive wired
  - Suggested approach: identify the project's existing `metrics.ts` infrastructure (or stand up a thin prom-client wrapper) and increment counters at the named emit sites (validator rejection paths, gate lifecycle paths, replay endpoints).

- [ ] **REQ 11-extra — server never emits `task.degraded` and never writes `workflow_runs.degradation_reason`.** Client `useTaskProjection` reacts to `task.degraded` by triggering a full rebuild (`useTaskProjection.ts:67-69`), but no server path emits the event. The `degradation_reason` column in `workflow_runs` ships unused. Plan §"Consumer-side gap that survives the buffer and replay" requires the server to emit + write column on consumer-gap detection.
  - Spec section: Chunk 9, plan §"Error handling — Consumer-side gap"
  - Gap: server-side gap-detection emission path missing
  - Suggested approach: in the replay endpoint and/or the WebSocket emit pipeline, when a consumer-gap pattern is detected (replay returns `hasGap: true` to a connected client), emit `task.degraded` with `reason: 'consumer_gap_detected'` and `UPDATE workflow_runs SET degradation_reason = ... WHERE id = ... AND degradation_reason IS NULL` (one-shot, first-write wins).

- [ ] **REQ 12-11 — sidebar badge for pending Asks alongside Approvals not directly verified.** Spec §11.6 routing UX requires three paths (sidebar nav, "Waiting on you" page, email notification) that all land on the task view with the form card. The sidebar badge extension (counting Asks alongside Approvals) was a Chunk 12 plan deliverable but not verified at file level in this review.
  - Spec section: Chunk 12, spec §11.6
  - Gap: sidebar badge extension status uncertain
  - Suggested approach: audit `client/src/components/sidebar/*` for the existing Approvals badge and confirm it has been extended to include pending Asks. If not, add the count.

- [ ] **REQ 13-9 — `file.created` task event never emitted.** `file.edited` is emitted from the per-hunk-revert path in `fileRevertHunkService.ts:71-72`. `file.created` is in the event taxonomy (spec §8.2) but never emitted from any service. Without it, the Files tab cannot react in real time when a new file lands; the auto-select-latest behaviour spec §9.4.3 names is broken.
  - Spec section: Chunk 13, spec §8.2 + §9.4.3
  - Gap: file-creation emission missing
  - Suggested approach: identify the existing file/version write path (the file-creation entry point used by agent skills) and wire `appendAndEmitTaskEvent(taskId, ..., 'engine', { kind: 'file.created', payload: { fileId, version, producerAgentId } })` after a successful insert.

- [ ] **REQ 14b-extra — `workflowDrafts` route missing the spec-§3.3-mandated `subaccount_id = resolvedSubaccount.id` check.** `server/routes/workflowDrafts.ts:30,70` reads/discards drafts only by `(draftId, organisationId)`. RLS only enforces org scope; a same-org cross-subaccount read by ID will leak. Spec §3.3 explicitly: *"every read endpoint MUST verify subaccount_id = resolvedSubaccount.id in the route handler — RLS only enforces org scope, so a same-org cross-subaccount read by ID would otherwise leak."* Security-critical.
  - Spec section: Chunk 14b, spec §3.3 (workflow_drafts authorisation contract)
  - Gap: route handler missing subaccount-scope verification
  - Suggested approach: in both `GET /api/workflow-drafts/:draftId` and `POST .../discard`, after `findById(draftId, organisationId)` succeeds, additionally verify `draft.subaccountId === req.subaccountId` (or via `resolveSubaccount(req.params.subaccountId, req.orgId)`); return 403 `gate_run_not_in_scope`-equivalent on mismatch (NOT 404, to avoid disclosing existence).

- [ ] **REQ 15-7 + 15-8 — depth fail-fast not enforced at every entry point named in plan; depth metadata persisted under wrong field name.** Plan REQ 15-7 names `orchestratorFromTaskJob`, the skill handler, every async pg-boss job that spawns/continues a run, every WebSocket dispatch, every retry path as MUST-validate sites. Implementation enforces only at `workflowRunStartSkillService.ts:28-29`. Other entry points pass `workflowRunDepth: 1` without the throw. Separately, REQ 15-8 says depth lives at `workflow_runs.metadata.workflow_run_depth`; implementation persists it to `workflow_runs.contextJson._meta.workflowRunDepth` (different JSON path).
  - Spec section: Chunk 15, plan REQs 15-7 and 15-8 + spec §13.4
  - Gap: partial entry-point coverage of fail-fast; metadata path naming differs
  - Suggested approach: extract a shared `validateWorkflowRunDepth(context)` helper from `workflowRunStartSkillService.ts:28-29`. Call it at the top of `orchestratorFromTaskJob`, the scheduler dispatch, every pg-boss job that spawns runs, the WebSocket dispatch path, and every retry path — pass top-level `workflowRunDepth: 1` only at the boundary, not as a safety fallback. Separately, decide between (a) renaming the persisted JSON path to spec-named `metadata.workflow_run_depth` (minor migration; affects downstream consumers reading the column) or (b) updating the plan/spec to use `_meta.workflowRunDepth` (zero code change). Prefer (a) since the spec is the contract.

---

## Deferred from review pipeline — workflows-v1-phase-2 Tier C + D (2026-05-04)

**Context:** Operator approved Option 1 fix scope (Tiers A + B from the consolidated triage on 2026-05-04). These Tier C (medium polish + hardening) and Tier D (cosmetic NIT) items are deferred to a follow-up branch.

**Source logs:**
- `tasks/review-logs/spec-conformance-log-workflows-v1-phase-2-2026-05-04T06-53-23Z.md`
- `tasks/review-logs/pr-review-log-workflows-v1-phase-2-2026-05-04T07-25-00Z.md`
- `tasks/review-logs/adversarial-review-log-workflows-v1-phase-2-2026-05-04T07-40-00Z.md`

### Tier C — medium polish + hardening

- [ ] **spec REQ 13-9 — `file.created` event has no producer.** The taxonomy in `shared/types/taskEvent.ts:19` defines the event but `referenceDocumentService.create` is currently only called from manual-upload routes (`server/routes/referenceDocuments.ts:62, 139`) which are not task-scoped. The intended producer is a skill-driven file-creation path that does not yet exist in the codebase. Wiring `file.created` requires either (a) building the skill-driven file-write path first, or (b) extending `referenceDocumentService.create` with an optional `taskEventContext` parameter and updating the manual-upload route to pass it when the upload happens within a task surface. Defer to the follow-up branch that adds the file-write skill.

- [ ] **pr-S1 — `appendAndEmitTaskEvent` events not durable; client full-rebuild incomplete.** (Half-done in Tier B fix wave 6 — cursor poisoning resolved by atomic `tasks.next_event_seq` allocation; persistence deferred because `agent_execution_events.run_id` is NOT NULL with FK to `agent_runs` but task-level events have no agent run association.) Required follow-up: schema migration making `agent_execution_events.run_id` nullable OR adding `workflow_run_id uuid` column with at-least-one-of constraint, then update `taskEventService.appendAndEmitTaskEvent` to accept `persistAs` and write the row inside the same transaction as the seq allocation. Until that lands, `run.paused.*`, `run.resumed`, `run.stopped.*`, `ask.submitted`, `ask.skipped`, `file.edited`, `chat.message`, `agent.milestone`, `step.awaiting_approval` are recoverable only via the live socket — a user opening the open-task view N seconds after one of these fired will see stale state until a synthetic refresh.

- [ ] **pr-S3 — Fire-and-forget `workflowDraftService.create` in orchestrator job.** `server/jobs/orchestratorFromTaskJob.ts:148-161` calls `.catch(...)` instead of `await`. If user navigates to Studio via cadence card before INSERT commits, StudioPage 404s on the draft fetch. Fix: `await` the create.

- [ ] **pr-S4 — `teams.ts` `checkOrgId` duplicates pattern; factor to shared helper.** Local helper at `server/routes/teams.ts:9-15` is duplicated in `assignableUsers.ts:16-19`. Factor into `server/lib/assertPathOrgMatchesAuthOrg.ts` and reuse.

- [ ] **pr-S5 — `assignableUsersService` deletedAt filter check on subaccount path.** `server/services/assignableUsersService.ts:103-120` joins through `subaccountUserAssignments` without `isNull(deletedAt)` (verify schema first; the assignments table may not have `deletedAt`). If present, add the filter.

- [ ] **pr-S6 — `useTaskProjection` full-rebuild request unbounded.** `client/src/hooks/useTaskProjection.ts:25` does not pass `?limit`. Server caps at 1000 silently. Add paginate-until-empty loop, or `hasMore` response field on the replay endpoint.

- [ ] **spec REQ 9-14 — observability counters not implemented.** Plan §Chunk 9 lists 10 prom-style counters (`workflow_run_paused_total`, `workflow_gate_open_total`, `workflow_gate_resolved_total`, `workflow_gate_stalled_total`, `workflow_gate_orphaned_cascade_total`, `task_event_gap_detected_total`, `task_event_subsequence_collision_total`, `task_event_invalid_origin_total`, `task_event_invalid_payload_total`, `workflow_cost_accumulator_skew_total`). Wire up metrics primitive and increment at named sites.

- [ ] **spec REQ 12-11 — sidebar badge for pending Asks alongside Approvals.** Spec §11.6 routing UX lists three paths (sidebar nav, "Waiting on you" page, email). Audit `client/src/components/sidebar/*` for the existing Approvals badge and extend to include pending Asks count.

- [ ] **adv Finding 2 — `workflowDraftService` / `teamsService` / `assignableUsersService` use bare `db` on FORCE-RLS tables.** Convention violation; matches pre-existing `taskService` pattern. Switch to `getOrgScopedDb('source')` for defence-in-depth (RLS safety net) and consistency.

- [ ] **adv Finding 4 — `streamEventsByTask` lacks explicit `organisationId` filter.** `server/services/agentExecutionEventService.ts:689-702` and `server/routes/taskEventStream.ts:53-58` filter only by `taskId` after pre-validating task ownership. Add explicit org filter as application-layer defence-in-depth (DEVELOPMENT_GUIDELINES §1).

- [ ] **adv Finding 6 — Depth guard not initialised at HTTP startRun boundary.** `server/routes/workflowRuns.ts:74` does not pass `workflowRunDepth: 1` baseline. The skill-layer guard fail-closes (hard error rather than bypass), so currently safe — but a future code path that catches the error would silently bypass the depth limit. Initialise at the HTTP boundary too. Related to spec REQ 15-7 above.

### Tier D — cosmetic NITs

- [ ] **chatgpt-pr-review R2-4 — `workflow_runs.task_id NOT NULL` migration not staged.** `migrations/0276_workflows_v1_additive_schema.sql:36` adds `task_id uuid NOT NULL REFERENCES tasks(id)` in a single ALTER, which would fail on apply if `workflow_runs` already contained rows. Safe today because pre_prod=yes and breaking_changes_expected=yes (per `docs/spec-context.md`) — dev DBs that ran chunks 1-8 wipe state before re-applying. **Pre-prod-to-prod migration prep:** before the first production deploy that includes this migration file, restructure as: (a) `ADD COLUMN task_id uuid REFERENCES tasks(id);` (nullable), (b) backfill existing rows from a join to tasks (or assert the table is empty), (c) `ALTER COLUMN task_id SET NOT NULL;`. The plan amendment A7 already noted "with backfill" — implement that backfill step before the production migration window.

- [ ] **chatgpt-pr-review F8 — `ActivityPane` timestamp rendering uses `toLocaleTimeString` (locale + tz drift).** `client/src/components/openTask/ActivityPane.tsx:73-77`. Consistency with the rest of the deterministic rendering surface would replace this with a standardised formatter (e.g. fixed `HH:mm:ss` in the user's tz, or a shared `formatTimeOfDay` helper). Cosmetic; does not affect correctness.

- [ ] **chatgpt-pr-review F9 — `ApprovalCard` pool-fetch leaky condition.** `client/src/components/openTask/ApprovalCard.tsx:11` — fires when `gate.poolFingerprint` is set and status is open, but does not re-fire when fingerprint changes due to a stale-vs-server case where the projection lags. Edge case; the `approval.pool_refreshed` envelope (REQ 9-10) refreshes the projection.fingerprint which retriggers naturally on the next render. Not critical.

- [ ] **chatgpt-pr-review F7 — `AskFormCard` hardcoded `'you'` identity string.** `client/src/components/openTask/AskFormCard.tsx:65, 88` — after submit/skip success the local UI shows `Submitted by you` until the projection round-trips. Functionally correct (the local actor IS the submitter), but the projection's `submittedBy` is the canonical user id. Consider reading `req.user.id` (passed as a prop or read from auth context) and rendering the user's display name instead. Operator decision: keep the friendly literal or wire to identity? **User-facing copy choice — needs operator approval before changing.**

- [ ] **pr-N1 — `filesTabPure.ts` sort tiebreakers are primary-key only.** `client/src/components/openTask/filesTabPure.ts:49-56` — add `.fileId` secondary tiebreaker on `recent` / `oldest` / `author` sorts (DEVELOPMENT_GUIDELINES §8.17 + §8.21).

- [ ] **pr-N2 — `taskEventService.ts` validation failure does not surface to caller.** `server/services/taskEventService.ts:31-38` returns void after `logger.warn` on validation failure. Consider returning `Promise<{ ok: true } | { ok: false, reason: string }>` so caller observability can branch.

- [ ] **pr-N3 — `workflowDraftsCleanupJob` no per-org partial-success logging.** Single admin-tx DELETE across all orgs. Move to per-org admin-tx + per-org log if drafts table grows (DEVELOPMENT_GUIDELINES §2 maintenance-jobs gotcha).

- [ ] **pr-N4 — `appendAndEmitTaskEvent` mixed promise-rejection patterns.** Most callers `void appendAndEmitTaskEvent(...)`; orchestrator-job sites use `.catch(logger.warn)`. Pick one pattern (`.catch` is more debuggable).

- [ ] **pr-N5 — `OpenTaskView.tsx:34` shows `Loading...` (three dots) instead of `Loading…` (single ellipsis char).** Cosmetic consistency with rest of codebase.

---

## Deferred from spec-conformance review — framework-standalone-repo (2026-05-04)

**Captured:** 2026-05-04T05:53:43Z
**Source log:** `tasks/review-logs/spec-conformance-log-framework-standalone-repo-2026-05-04T05-53-43Z.md`
**Spec:** `tasks/builds/framework-standalone-repo/spec.md`
**Scope verified:** Phase A (in-tree sync infrastructure under `setup/portable/`)

- [ ] **REQ #11 — §4.5 step 8 rename-detection INFO log not implemented.** Spec text: "Check: if a removed path and a newly-written path share the same directory + similar filename: Print 'INFO: possible rename detected — old: <removed-path>, new: <new-path>'." Implementation (`setup/portable/sync.js:1278-1289`) handles `removedFiles` warn-only (conforms to that part) but does NOT scan for renames.
  - Spec section: §4.5 step 8
  - Gap: rename-detection check missing from removed-files loop
  - Suggested approach: pick a similarity heuristic (suggest: same directory + filename Levenshtein distance ≤ 3, OR shared filename stem) — the spec leaves this undefined. Alternatively, defer to Phase B and amend spec §4.5 step 8 to remove the requirement (Phase A is in-tree-only and rename-detection has low ROI pre-public-launch).

- [ ] **REQ-extra (plan Chunk 1 verification) — `scripts/build-portable-framework.ts` preflight scan fails on intentional negative-test legacy placeholders.** Plan Chunk 1's verification command (`npx tsx scripts/build-portable-framework.ts # expect: exit 0`) currently exits 1 because `setup/portable/tests/substitute-write.test.ts` contains intentional `[PROJECT_NAME]` test fixtures (verifying the substitution engine ignores non-`{{...}}` formats). The legacy-placeholder walk in `scripts/build-portable-framework.ts:114-133` does not exempt the `tests/` directory.
  - Spec section: plan Chunk 1 verification commands (spec §4.5 invariant 1 substitution placeholder format)
  - Gap: build script's preflight false-positives on test fixtures
  - Suggested approach: add `tests/` to a path-prefix exclusion in the legacy-placeholder walk (mirrors the existing filename-set exemption for `CHANGELOG.md` / `README.md`). One-line addition; preserves test integrity without inventing escape syntax.

---

## Deferred from pr-reviewer review — framework-standalone-repo (2026-05-04)

Source: `tasks/review-logs/pr-reviewer-log-framework-standalone-repo-2026-05-04T05-59-12Z.md`. Items marked Strong/Nit not addressed in-branch — Tier 1 fixes (B1, B2, S1, plus all confirmed adversarial holes) landed; Tier 2 items deferred here.

- [ ] **S4. SYNC.md crash-recovery troubleshooting note.** If sync is killed mid-walk, files written before the crash exist but have no state entry; next run will write `.framework-new` for each, alarming the operator. Spec invariant ("re-run sync is always safe") is satisfied for state.json but introduces a noisy false-positive disk path. Add one paragraph to `setup/portable/SYNC.md § Troubleshooting` instructing the operator to run `sync.js --adopt` to rebaseline cleanly.
- [ ] **S5. validateSubstitutions on first-run --adopt symmetry.** If an operator runs `--adopt` with no pre-existing state.json AND pollutes substitutions later, validation is bypassed for the initial run. Add `validateSubstitutions(ctx.state.substitutions)` after the line ~1219 init for symmetry.
- [ ] **N2. mergeSettings malformed-JSON path should exit 1.** Currently warns and proceeds treating project hooks as `{}` — silently overwrites a malformed-but-recoverable settings.json. Exit 1 with "fix or delete settings.json before re-running sync" instead.
- [ ] **N3. classifyForAdopt sync vs async fs API consistency.** Lines ~993, 1000, 1005 use `require('fs').existsSync` / `readFileSync` while the rest of writers use `fs.promises`. Tiny consistency nit.
- [ ] **N4. writeNewFile Branch 2 lastAppliedHash initialised to ''.** When sync writes `.framework-new` for an untracked-but-existing file, state entry is created with `lastAppliedHash: ''`. On subsequent runs (after operator merges), `classifyFile` sees `targetHash !== ''` → `customised` → re-writes `.framework-new`. Operator falls back to `--adopt` rebaseline. Either record current target hash or document the path in SYNC.md.
- [ ] **N5. writeFrameworkNew mtime heuristic visibility.** The 5-second mtime heuristic emits `inline_check=hash_drift_no_priorMerge` but the meaning isn't surfaced to the operator. Promote to stderr INFO when it fires, or remove in favour of `--doctor`'s case(b) check.
- [ ] **N6. frameworkHookIdentity / isFrameworkOwnedCommand DRY.** Both functions duplicate the same regex + interpreter check. Extract a single helper returning `null | string`; boolean form is `frameworkHookIdentity(cmd) !== null`.
- [ ] **N7. classifyFile mode-change check (spec §4.5 step 7.b2).** Spec says "previous recorded mode === sync, new mode === adopt-only" triggers `ownership-transferred`. Impl returns `ownership-transferred` whenever state exists, mode is `adopt-only`, and `adoptedOwnership` is unset. No regression today (all current adopt-only files were always adopt-only at adoption time) but tighten the check for future adopters.

## Deferred from adversarial-reviewer review — framework-standalone-repo (2026-05-04)

Source: `tasks/review-logs/adversarial-review-log-framework-standalone-repo-2026-05-04T06-08-15Z.md`. Confirmed-holes (path traversal, shell injection) and high-leverage worth-confirming items (--check ownership-transferred, mergeSettings non-hooks keys, atomic-write race) were fixed in-branch. Remaining advisory items routed here per Phase 1 advisory non-blocking convention.

- [ ] **Symlink follow guard on writers.** `writeUpdated`, `writeNewFile`, `writeFrameworkNew` use `fs.writeFile` which follows symlinks unconditionally. A managed path that is itself a symlink (e.g. `.claude/agents/architect.md` → `/etc/passwd`) gets overwritten via the symlink. Mitigation: `fs.lstat` before each write; reject symlinks at managed paths. Threat depends on whether the deployment model allows untrusted contributors to add files to the target repo — currently low for single-operator usage.
- [ ] **Substitution values shell-metacharacter validation.** `validateSubstitutions` rejects `{{` (idempotency invariant) but does not restrict `$()`, backtick, `|`, `;`, `&`, newlines. Substitution values land verbatim in agent `.md` files; if any future hook templates a substituted value into a shell command, injection is possible. Currently low-exploit (agent files are prose context). Mitigation: at minimum document allowed character set; consider rejecting shell metacharacters for substitutions used in agent files.
- [ ] **`--force` silently replaces in-progress operator merge work.** `writeFrameworkNew` line ~641 logs `prior_framework_new=replaced` to stdout (not stderr) when `--force` overwrites an existing `.framework-new`. SYNC.md warns "not recommended" but doesn't call out specific data-loss scenario. Mitigations: write to `<file>.framework-new.incoming` instead, or emit replacement warning to stderr with stronger label.
- [ ] **No schema validation on `readState`.** `readState` does `JSON.parse(raw)` and returns the result with no field-level validation. An attacker who can write to `.framework-state.json` can set `lastAppliedHash` to forge a "clean" classification of a malicious file. Mitigations: document explicitly that `.framework-state.json` MUST be committed to source control and changes reviewed in PRs (add to SYNC.md / ADAPT.md). Add a `--verify` mode that recomputes all hashes from disk.

## Deferred from chatgpt-pr-review — framework-standalone-repo (2026-05-04 round 2)

Source: `tasks/review-logs/chatgpt-pr-review-framework-standalone-repo-2026-05-04T07-05-51Z.md` (round 2). Round 1 findings F1–F5 all actioned in-branch (commit `5e2163ce`). Round 2 surfaced 4 hardening items beyond the must-fix set; the 3 must-fix items (version authority strengthening, scanner case variants, CI test gate) were applied in-branch (commit pending). The 4 hardening items below routed here.

- [ ] **Scanner: positive-validation rules beyond the string blacklist.** Round 2 F2 deeper recommendation. Current scanner is reactive (blacklist + variants). Move toward positive validation: define allow-listed patterns, ban absolute paths in agent prose, ban project-specific directories (`apps/`, `services/`, `server/routes/...`) unless explicitly intentional, ban references to project-specific routes / DB tables / services. Wants architect input on the rule set; not a Round 2 fix because it's a meaningful enforcement-model redesign. Strong long-term value as the bundle reaches more consumer repos.
- [ ] **Agent duplication guard — root vs portable agents.** Round 2 F5. Today `.claude/agents/*` (root deployment) and `setup/portable/.claude/agents/*` (canonical bundle) are intentionally duplicated; nothing enforces that they stay in sync. Drift risk: bundle updates to an agent definition without root catching up, so this repo's local Claude sessions run a stale version. Add a build-step hash comparison (or a derived-from rule that root is generated from portable). Mostly addressable via Phase C self-adoption — at that point root becomes a sync.js output and the duplication question dissolves. Until Phase C, low priority.
- [ ] **Manifest schema validation in `sync.js`.** Round 2 F6. `manifest.json` is the single configuration input that drives everything sync.js does, but `loadManifest` performs no schema validation — a missing field or wrong type leads to undefined sync behaviour. Add a hand-rolled `validateManifestShape(m)` (no external deps per the bundle's no-deps invariant) that asserts required fields, allowed mode values, and glob string types. Wants architect input on whether to also version the manifest format itself (`manifest.json`'s top-level `frameworkVersion` field already exists; should we add `manifestSchemaVersion` independent of framework version?). Real concern but heavier than a Round 2 in-branch fix.
- [ ] **Sync engine observability — dry-run summary / machine-readable report.** Round 2 F7. `--dry-run` exists but emits one log line per file; no aggregated summary, no JSON output suitable for CI gating. Add a final-line summary block (`SYNC summary classified=X new=Y customised=Z customised-by-substitution=W ...`) and an opt-in `--report-json <path>` mode emitting the full classification + planned writes as a single JSON document. Useful when this engine is invoked across many consumer repos and the operator needs aggregate status. Polish, not blocker.

## Deferred from dual-reviewer — pre-launch-phase-1 (2026-05-04)

Source: dual-review log under `tasks/review-logs/`. Codex iteration 1 raised three findings; one was rejected with rationale and routed here.

- [ ] **Reconsider login rate-limit window — spec says 10/60s, prior was 10/900s.** `server/routes/auth.ts:51` — Codex flagged that the spec value (S-P0-5: `10 attempts per 60 seconds`) is materially weaker brute-force protection than the prior `10/900s` value. Online guessing rate increased ~15x (from ~960/day to ~14400/day per IP+email pair) at the same 10-attempts-per-window limit. Codex's mitigation suggestion is sound: keep the new short-window bucket for UX (10/60s prevents human accidental lockout) AND add a second, broader bucket (e.g. 30/900s or 50/3600s) so credential-stuffing attempts at sustained rate still trip the wider window. Decision deferred because the value was set in the spec — modifying without re-spec'ing would contradict source-of-truth. Owner: re-open the security spec, decide single-bucket vs dual-bucket, then implement. Does NOT block this branch.
- [ ] **`taskService.createTask` and `taskActivities` insert use module-level `db` — pre-existing.** `server/services/taskService.ts:158` and `:185`. The auto-start onboarding chain (`autoStartOwedOnboardingWorkflows` → `startOwedOnboardingWorkflow` → `taskService.createTask`) now correctly opens an org-scoped tx via `getOrgScopedDb` for the read path, but `taskService.createTask` writes via module-level `db`. Under FORCE-RLS on `tasks` and `task_activities`, those writes will be silently no-op'd or fail policy. Pre-existing across the codebase — every `taskService.createTask` caller has this issue. Out of scope for this dual-review (would touch dozens of call sites). Should be addressed as part of a wider service-layer migration to `getOrgScopedDb`.

## Deferred from adversarial-reviewer — pre-launch-phase-1 (2026-05-05)

Source: `tasks/review-logs/adversarial-review-log-pre-launch-phase-1-2026-05-05T00-00-00Z.md`. Three confirmed/likely holes were fixed in-branch (commit `38d7c495`). Four worth-confirming items deferred below.

- [ ] **`migrations/0277_oauth_state_nonces.sql` missing `-- system-scoped:` header.** Per DEVELOPMENT_GUIDELINES §6.3, every migration creating a non-RLS table should include a `-- system-scoped: <reason>` comment inline. The allowlist rationale lives in `rls-not-applicable-allowlist.txt` (correct) but is not repeated in the migration file itself. Add the inline comment in a follow-up. Low-risk — not a security hole; the allowlist entry exists and CI gate reads it.
- [ ] **Signup rate-limiter uses IP-only key — proxy-IP issue partially mitigated.** `server/routes/auth.ts:23`. The signup RL key uses only `req.ip`; the `trust proxy` fix (AR-2.1) means `req.ip` now correctly reflects the client IP. However if different users legitimately share a public IP (NAT, office networks), they share the 10/900s signup bucket. Consider adding an email dimension to the signup RL or relaxing the IP bucket in Phase 2.
- [ ] **OAuth `autoEnrolAgencyLocations` 15s timeout doesn't cancel in-flight DB transactions.** `server/routes/oauthIntegrations.ts:424-432`. `Promise.race(autoEnrol..., timeout(15s))` times out the outer promise but in-flight per-location `db.transaction()` calls continue running on their pool connections. For large-location agencies this causes a connection-pool burst for up to 15s after the response has already redirected. Add a location-count cap (`MAX_GHL_LOCATIONS_TO_ENROL`) as a guard until the enrolment path can be made cancellable. Phase 2 item.
- [ ] **`withOrgTx({ tx: db })` pattern in OAuth callback is fragile.** `server/routes/oauthIntegrations.ts:424-425`. Passing the module-level `db` as `tx` to `withOrgTx` fakes GUC context in ALS without actually setting a GUC. Works today because `autoEnrolAgencyLocations` opens its own `db.transaction()` with explicit GUC. Any future refactor that uses `getOrgScopedDb()` in that call chain would silently have no GUC set. **[KNOWLEDGE.md doc shipped 2026-05-05 in finalisation pass]** — see KNOWLEDGE.md "2026-05-05 Gotcha — `withOrgTx({ tx: db })` in unauthenticated callbacks fakes ALS context without setting a GUC". Code refactor (replace the pattern with a proper `db.transaction()` + GUC wrapper) remains deferred to Phase 2.

## Deferred from chatgpt-pr-review — pre-launch-phase-1 round 2 (2026-05-05)

Source: ChatGPT Round 2 feedback on PR #261. Two must-fix items applied in-branch. One worth-confirming deferred below.

- [ ] **Wire agent-triggered GHL OAuth resume path.** `server/routes/ghl.ts:36` — `setGhlOAuthState(nonce, orgId)` never passes `pendingRunId`. The `oauth_state_nonces.pending_run_id` column and `enqueueResumeAfterOAuth` function are pre-built infrastructure for a future path where an agent run triggers a GHL agency OAuth connect (as opposed to the current user-initiated settings/onboarding flow). When that path is built: (1) the initiation site (`routes/ghl.ts`) must pass `pendingRunId` to `setGhlOAuthState`, (2) the callback (`routes/oauthIntegrations.ts`) must call `enqueueResumeAfterOAuth({ runId: stateData.pendingRunId, organisationId: ghlOrgId })` when `stateData.pendingRunId` is non-null. The JWT-based OAuth flow already handles resume via `resumeFromIntegrationConnect`.

## Deferred from spec-conformance review — subaccount-artefacts (2026-05-04)

**Captured:** 2026-05-04T23:24:55Z
**Source log:** `tasks/review-logs/spec-conformance-log-subaccount-artefacts-2026-05-04T23-24-55Z.md`
**Spec:** `tasks/builds/subaccount-artefacts/plan.md`

- [ ] REQ #43-extension — `markArtefactSkipped` precondition is broader than spec §4B idempotency posture
  - Spec section: plan chunk 4B step 6 "Idempotency posture per route" — *"Skip: state-based; precondition `tier3.{slug}.status IN ('not_started')` — UPDATE WHERE that predicate. 0 rows affected = race; return 409 with the current state."*
  - Gap: implementation at `server/services/subaccountOnboardingService.ts:586-590` only blocks `status === 'completed'` (errorCode `ARTEFACT_ALREADY_COMPLETED`); skipping from `in_progress` or re-skipping a `skipped` artefact is allowed. Plan §4B literal precondition is `IN ('not_started')` only.
  - Suggested approach: decide whether to tighten the precondition to `not_started`-only (matches §4B; introduce errorCode `BASELINE_SKIP_PRECONDITION_FAILED` and wire 409 mapping in `server/routes/subaccounts.ts:867-879`), OR relax §4B in the spec to match the current operationally-permissive implementation. Not a regression — same behaviour the prior 2026-05-04T13-04-44Z conformance run marked PASS without flagging — so this is a follow-up cleanup, not a PR blocker.

## Deferred from spec-conformance review — baseline-capture (2026-05-05)

**Captured:** 2026-05-05T05:36:34Z
**Source log:** `tasks/review-logs/spec-conformance-log-baseline-capture-2026-05-05T05-36-34Z.md`
**Spec:** `docs/baseline-capture-spec.md`
**Status:** RESOLVED 2026-05-05 — both items closed in main session before pr-reviewer (see commit `feat(baseline-capture): F3 …` for routes wiring, and the follow-up commit closing REQ #24).

- [x] REQ #20 — `server/routes/baselines.ts` bypasses the §5.2 single-writer rule by writing directly to `subaccount_baselines` / `subaccount_baseline_metrics` instead of delegating to `captureBaselineService.runManual()` / `captureBaselineService.adminReset()`
  - Spec section: §5.2 single-writer rule, §6 manual entry, §10 hard invariants
  - Gap: the `POST /api/subaccounts/:subaccountId/baseline/manual` handler (lines 70-146) and `POST /api/admin/subaccounts/:subaccountId/baseline/reset` handler (lines 152-190) write to `subaccount_baselines` directly via Drizzle. The spec is explicit: *"`<ManualBaselineForm>` POST endpoint → Calls `captureBaselineService.runManual(subaccountId, metricInputs, userId)` … MUST NOT write directly"* and *"`<AdminBaselineResetButton>` POST endpoint → Calls `captureBaselineService.adminReset(subaccountId, reason, userId)` … MUST NOT write directly"*. Both service methods (`runManual`, `adminReset`) already exist in `captureBaselineService.ts` and are unreachable in the current wiring. The `baselineInvariants.test.ts` invariant-3 grep does NOT catch this because Drizzle's chained `tx\n.update(subaccountBaselines)` splits the call across two lines and the test pattern is single-line — the test passes while the spec invariant is violated.
  - Knock-on impacts of the bypass:
    - Admin-reset flow violates the §6/§10 transactional pattern. Spec requires *"Single transaction: UPDATE prior SET status='reset' THEN INSERT new with baseline_version+1 with status='pending'"*; the route only marks the prior row `reset` and never inserts a successor `pending` row. The §10 invariant *"after reset, the prior baseline row exists with `status='reset'` AND a new row exists with `baseline_version+1` AND `status='pending'`"* is not satisfied — re-baselining mid-engagement leaves the subaccount with no active baseline.
    - Manual flow bypasses the §6a `baseline.manual.applied` event with `metrics_overridden[]` — emitted by `captureBaselineService.runManual` but unreachable.
    - Admin-reset flow bypasses the `baseline.admin_reset` event with prior/new baseline_id, prior/new version, user_id, reason — emitted by `captureBaselineService.adminReset` but unreachable.
    - Manual flow bypasses the §5.10 `capturing`-lock check (route writes `status='manual'` regardless of in-flight auto capture). `runManual` already has the 409 BASELINE_CAPTURING guard.
    - Confidence recompute differs: route uses `hasAuto = …source === 'canonical_metric'` only, whereas `runManual` derives confidence from `optedIn.length` vs captured count.
    - Route handler `POST /api/admin/...` skips the org-scoping `resolveSubaccount`; the service-layer `adminReset` requires `organisationId` which the route doesn't have for sysadmin scope. Routing the call needs an org-resolution step (look up the subaccount's organisation_id by primary key).
    - The route's admin handler validates the `reason` via Zod schema AFTER selecting the baseline row — should fail-fast on malformed body before any DB read.
  - Suggested approach: rewrite both handlers to invoke the service methods. For the admin path, look up the subaccount's `organisationId` first (or refactor `adminReset` to accept just `subaccountId` and resolve the org internally). After the rewrite, re-author `baselineInvariants.test.ts` invariant-3 to use a multi-line / AST-aware pattern (or a `tsc --listFiles | xargs ts-morph` query) so chained Drizzle calls cannot escape the gate. Alongside, fix the §3 timestamp invariant: the route currently uses `new Date()` for `capturedAt` (line 124) and `resetAt` (line 183) — those will disappear when the route delegates to the service.
  - Resolution: closed in the implementation commit. `server/routes/baselines.ts` now delegates manual+reset to `captureBaselineService.runManual` / `.adminReset`; `baselineInvariants.test.ts` invariant 3 has both an SQL-level grep (`(INSERT INTO|UPDATE) subaccount_baselines`) and a Drizzle-level grep (`\.(insert|update|delete)\(subaccountBaselines`) excluding `__tests__/`, with `SINGLE_WRITER_ALLOWED` = `[captureBaselineService.ts, subaccountOnboardingService.ts]`. Both grep variants catch chained multiline calls.

- [x] REQ #24 — Manual entry validation does not enforce the lead-count cap or any server-side bounds
  - Spec section: §6 / §8 Phase 4
  - Gap: spec requires *"Validation: no negative values; lead count ≤ all-time-high seen in history; required currency unit"*. The shared `manualBaselineFormSchema` only validates `numeric: z.number().nonnegative()` and `currency: z.string().length(3).optional()`. There is no lead-count cap and no server-side reject path for the cap. The client-side form additionally has `min="0"` HTML attr and skips negatives in `handleSubmit`, but client-side checks are not enforcement.
  - Suggested approach: in `captureBaselineService.runManual` (once REQ #20 is wired) — for any input slug whose unit is `count` AND slug = `lead_count`, look up the all-time-high from `canonical_metric_history` for that subaccount, and reject (400 with `LEAD_COUNT_EXCEEDS_HISTORICAL_HIGH`) when `numeric > all_time_high`. Spec doesn't pin the exact lookup window or the historical-source table — confirm before implementing. Currency-unit requirement is already implicitly enforced because the form pulls `unit: 'cents'` from `V1_BASELINE_METRICS` for currency metrics and includes `currency` in the payload — the open question is whether the server should reject a `cents`-slug payload that omits `currency`. Spec implies yes; current schema has currency optional unconditionally.
  - Resolution: closed in main session (post-spec-conformance). `manualMetricInputSchema` now uses `.superRefine` to require `currency` for any slug with `metricMeta(slug).unit === 'cents'` (path: `currency`, custom code). `captureBaselineService.runManual` performs an `orgDb.execute(SELECT MAX(value::numeric) FROM canonical_metric_history INNER JOIN canonical_accounts …)` lookup before the metric upsert loop and throws `{ statusCode: 400, errorCode: 'LEAD_COUNT_EXCEEDS_HISTORICAL_HIGH' }` if the manual `lead_count` exceeds the historical max. Lookup is no-op when no history exists (so subaccounts with no canonical observations yet are not blocked). Schema test added at `shared/schemas/__tests__/baselineManualForm.test.ts` (14 cases: cents-without-currency / cents-with-currency / count-no-currency / percent / negative / boundary / 2-char and 4-char currency / form-level array bounds / mixed-types / invalid-bubble-up).

## Deferred from spec-conformance review — pre-launch-phase-2 (2026-05-05)

**Captured:** 2026-05-05T05:08:56Z
**Source log:** `tasks/review-logs/spec-conformance-log-pre-launch-phase-2-2026-05-05T04-56-49Z.md`
**Spec:** `docs/pre-launch-hardening-mini-spec.md`

- [ ] REQ #4 — Maintenance-job done criteria: pure-function tests vs real-row integration tests
  - Spec section: Mini-spec § Chunk 4 done criteria
  - Gap: mini-spec says "test added per job that verifies a real row is decayed/pruned/recalibrated"; implementation ships pure-function tests of computation logic only (`ruleAutoDeprecateJobPure.test.ts`, `fastPathDecisionsPruneJobPure.test.ts`, `fastPathRecalibrateJobPure.test.ts`).
  - Suggested approach: documented divergence — operator-locked decision per plan § 12 "no unit test suite during development" + memory note `feedback_unit-tests-mid-build`. Either (a) accept the divergence and amend the mini-spec done criteria to match the project's pure-test posture, OR (b) author DB-backed integration tests for the three jobs in a follow-up branch. No code change needed in this branch.

- [ ] REQ #15 — Skill error envelope CI grep gate not implemented (C4a-6-RETSHAPE adherence enforcement)
  - Spec section: Mini-spec § Chunk 5 done criteria — *"Skill error envelope contract is one of two documented options and 100% adherent."*
  - Gap: plan Task 6b.7 last bullet promised "Add a CI grep gate (Chunk 7) that asserts every skill handler return shape matches the flat-string pattern (no mixed shapes — invariant 2.4 closure)." Chunk 7 shipped audit-stream-split gate and RLS-CONTRACT-IMPORT gate but did NOT ship the skill envelope adherence gate. Grep finds nested `error: { code, message, ... }` shapes in `connectorConfigService.ts`, `ghlAgencyOauthService.ts`, `locationTokenService.ts`, `skillExecutor.ts` (delegation skills) — i.e. mixed shapes still in the code.
  - Suggested approach: author `scripts/verify-skill-error-envelope.sh` that scans `server/skills/**`, `server/tools/**`, and `server/services/skillExecutor.ts` `SKILL_HANDLERS` for return shapes; compare against the grandfather flat-string contract. Decisions required: (a) which file paths are in scope (skill handlers only, or every service that returns a skill envelope?), (b) whether the existing nested shapes in connector/oauth services represent skill returns or are out of scope (they appear to be event payloads, not skill envelopes — needs human confirmation). Not a mechanical fix because the scope decision is a design choice.

- [ ] REQ #29 — SC-COVERAGE-BASELINE numbers are placeholders, not actual CI counts
  - Spec section: Mini-spec § Chunk 6 — *"capture pre-Phase-2 baseline counts before testing changes them"*
  - Gap: `tasks/builds/pre-launch-phase-2/progress.md` records section heading but the two count rows are placeholder text ("update with actual count from first CI run"), not actual numbers from a CI run.
  - Suggested approach: after the next CI run on this branch, read the warning counts from `verify-input-validation.sh` and `verify-permission-scope.sh` outputs and update progress.md. Not auto-fixable from a local session because the values come from CI, not local invocation, and CLAUDE.md forbids local gate runs.

---

## Deferred from adversarial-review — pre-launch-phase-2 (2026-05-05)

**Captured:** 2026-05-05T07:11:14Z
**Source log:** `tasks/review-logs/adversarial-review-log-pre-launch-phase-2-2026-05-05T07-11-14Z.md`
**Branch:** `claude/pre-launch-phase-2`

**Confirmed hole — fixed in-session:**
- [x] AR-2.1 — Signup/acceptInvite JWT revoked on first use due to DB/Node clock skew. Fixed: `authService.signup()` now sets `passwordChangedAt: new Date(0)`; `acceptInvite` floors `now` to second-precision before storing. See commit following this entry.

**Likely holes — design decisions required:**

- [ ] AR-3.1 — Advisory lock scope ambiguity for pg-boss dispatch
  - `server/services/workflowEngineService.ts:840, 1897-1924`
  - `pg_try_advisory_xact_lock` at line 840 is `xact`-scoped (releases on commit). Confirm that `pgboss.send()` at line 1897 runs inside the same DB transaction so the lock holds for the full dispatch. If outside, two concurrent workers can both pass the lock check (though `singletonKey` deduplication at the pg-boss level prevents double-execution). Verify the transaction boundary; if send() is outside, either accept the singletonKey defence or move the lock to cover the send.

- [ ] AR-5.1 — Login rate limiter bypassable via IP rotation (no per-email bucket)
  - `server/lib/rateLimitKeys.ts:24-28`, `server/routes/auth.ts:64-77`
  - Both rate-limit windows key on `ip:email`. A botnet rotating IPs can exceed the nominal 50/hour limit against a single email. Add a separate `rl:v1:auth:login:email:<normalised-email>` bucket (e.g., 100/3600s) as a belt-and-suspenders cap. Design decision: what limit makes sense vs. false-positive risk for shared IPs (offices, universities)?

**Worth-confirming — may close without code change:**

- [ ] AR-1.1 — `security_audit_events` login-failure rows stored under sentinel UUID `00000000-0000-0000-0000-000000000000`
  - `server/routes/auth.ts:92`, `server/services/securityAuditService.ts:16`
  - Intentional for pre-auth events. Admin queries scoped to a real org UUID will not see login-failure rows. Confirm the admin login-failure audit query is aware of this and handles the sentinel UUID explicitly if needed.

- [ ] AR-2.2 — `requireSubaccountPermission` emits no `auth.permission_denied` security event
  - `server/middleware/auth.ts:349-394`
  - `requireOrgPermission` records the event; subaccount variant does not. Add `recordSecurityEvent({ eventType: 'auth.permission_denied', ... })` in the 403 branch of `requireSubaccountPermission`, matching the org-level pattern.

- [ ] AR-4.1 — PII blacklist in `normaliseSecurityEvent` is exact-key-match only
  - `server/services/securityAuditServicePure.ts:31-38`
  - `PII_BLACKLIST` does not match composite keys like `accessToken`, `refreshToken`, `passwordHash`. Extend to substring-match (e.g., `PII_SUBSTRINGS = ['password', 'token', 'secret', 'authorization', 'credential']`) so future callers can't accidentally store credential material. Low urgency — current callers are safe.

- [ ] AR-6.1 — `connectionTokenService.refreshIfExpired` relies on caller discipline for org scoping
  - `server/services/connectionTokenService.ts:147-174`
  - The `guard-ignore-next-line` exemption requires every caller to fetch the connection via an org-scoped query. Audit all call sites of `getAccessToken` to confirm each path obtains the connection through an org-scoped lookup before passing it here. If any admin-path caller exists, add an assertion: `if (connection.organisationId !== principalOrgId) throw new Error(...)`.

---

## Deferred from chatgpt-pr-review Round 1 — pre-launch-phase-2 (2026-05-05)

**Captured:** 2026-05-05
**Source log:** `tasks/review-logs/chatgpt-pr-review-pre-launch-phase-2-2026-05-05T08-52-25Z.md`
**Branch:** `claude/pre-launch-phase-2`
**PR:** #264

- [ ] CHATGPT-R1-4 — Tighten audit-stream split enforcement
  - Current `scripts/verify-audit-stream-split.sh` is a grep gate. Replace with either a centralised audit API that mechanically enforces routing (operational vs. security streams) or a TypeScript ESLint rule that flags writes to the wrong stream at lint time. Grep gates drift; an API or lint rule is structurally enforced.
  - Out of scope for this PR — design decision required on which approach (API vs. lint rule), and a non-trivial refactor of every audit call site.

- [ ] CHATGPT-R1-6 — Tighten `isActive` helper generic constraint
  - `server/lib/softDelete.ts` (or wherever the helper lives) — the generic constraint accepts any object with a `deletedAt` field, which is broader than the intended Drizzle-table use. Either narrow the generic to Drizzle table types (`PgTable` with a `deletedAt` column), or add overloads for the known soft-deletable tables (users, organisations, agents, …).
  - Mechanical-feeling but the constraint design is a small architecture call (do we want a single generic helper or per-table overloads?). Defer until we have time to decide.

- [ ] CHATGPT-R1-7 — Instrument OAuth state TTL before deciding on revert
  - `server/services/ghlAgencyOauthService.ts` (and similar OAuth state stores) — the state TTL was tightened from 10min → 5min in this branch. Before committing to the new value (or reverting), instrument the state-store with a metric for `expired-on-callback` vs `not-found-on-callback` rate and observe it for a week in staging. If `expired-on-callback` is non-trivial, revert to 10min.
  - Pre-launch we don't have telemetry yet, so this is correctly a follow-up after we have a baseline.
  - **UX-risk scenarios driving the revert decision (ChatGPT Round 2):** mobile users on flaky cellular paths (consent flow easily exceeds 5min); slow-consent paths where the IdP shows extra prompts (MFA, scope review, re-authentication); enterprise SSO with multi-factor or admin-approval interstitials. Any non-trivial `expired-on-callback` rate from these segments argues for the 10min default. Capture segment breakdown in the metric (mobile vs desktop, IdP type) so the revert call has signal, not just a global rate.

- [ ] CHATGPT-R1-8 — GHL auto-enrol pagination / partial-onboarding UX
  - `server/services/ghlAgencyOauthService.ts` `autoEnrolLocations` (or similar) — the auto-enrol loop iterates GHL locations to create/link subaccounts; for agencies with hundreds of locations, the request can time out or partially succeed without surfacing state to the operator. Either add a cursor/pagination strategy with a background-job continuation, or surface partial-onboarding status to the UI so the operator can resume.
  - Design call required (background job vs. UI surface). Defer until we have a concrete agency hitting the limit or post-launch telemetry suggesting risk.

---

## Deferred from chatgpt-pr-review Round 2 — pre-launch-phase-2 (2026-05-05)

**Captured:** 2026-05-05
**Source log:** `tasks/review-logs/chatgpt-pr-review-pre-launch-phase-2-2026-05-05T08-52-25Z.md` (Round 2 entry)
**Branch:** `claude/pre-launch-phase-2`
**PR:** #264

- [ ] CHATGPT-R2-2 — `logAndSwallow` production observability
  - `server/lib/logAndSwallow.ts` (or wherever the helper lives) — currently good for local debugging but provides no production observability. Either (a) sample-log to the backend at 1–5% so failures surface in System Monitor without flooding it, or (b) upgrade specific critical-path call sites to `console.warn` so they always emit. ChatGPT framing: "good for debugging, not for observability."
  - Defer because the right answer (sample vs upgrade) depends on which call sites we treat as critical, and that classification is post-launch work.

- [ ] CHATGPT-R2-3 — `/api/client-errors` endpoint dedupe
  - `server/routes/clientErrors.ts` — under heavy client-side error spam, identical errors flood the endpoint and consume rate-limit budget without informational value. Add a hash(message + stack) dedupe that drops duplicates within a short window (e.g. 60s) before they hit the rate-limiter. ChatGPT framing: "Future improvement (not now)."
  - Defer — endpoint is rate-limited (30/300s per user) and tight-bodied (16kb), so the abuse surface is bounded. Dedupe is an optimisation, not a correctness fix.

- [ ] CHATGPT-R2-6 — Pre+post invalidation guards double DB reads under heavy workflow load
  - The new validation/invalidation guards added in this branch read state both before and after the protected operation. Under heavy workflow load this doubles the read cost for the guarded paths. Options: (a) cache the pre-read for the duration of the call where consistency permits, (b) collapse to post-read only where the pre-read was defensive rather than load-bearing, or (c) accept the cost if profiling shows it's negligible. ChatGPT framing: "not a problem now, just something to track."
  - Defer — we don't have load profiling against the new guards yet. Re-evaluate after pre-launch load testing or first production traffic spike.

---

## Deferred from chatgpt-pr-review Round 3 — pre-launch-phase-2 (2026-05-05)

**Captured:** 2026-05-05
**Source log:** `tasks/review-logs/chatgpt-pr-review-pre-launch-phase-2-2026-05-05T08-52-25Z.md` (Round 3 entry)
**Branch:** `claude/pre-launch-phase-2`
**PR:** #264
**ChatGPT verdict:** "You are genuinely done." Round 3 closed all open findings; the items below are scoped follow-ups, not blockers.

- [ ] CHATGPT-R3-1 — Extend CI grep invariants pattern to additional safety guards
  - The audit-stream split grep guard added in Round 1 (`scripts/verify-audit-stream-split.sh`) is a useful pattern: a CI-grep that triggers on a known-bad usage. Extend the pattern to other invariants ChatGPT flagged in Round 3:
    - **`assertActive` on entity fetch paths** — every service-layer fetch that returns a soft-deletable entity should pass through `assertActive`/`isActive` before the row is consumed. Grep guard would fail-fast on any new fetch path that bypasses the helper.
    - **Forbid raw `console.*` outside allowed zones** — bootstrap, logger internals, build scripts, test fixtures. Production runtime paths must use the structured logger. Grep guard would catch new `console.*` regressions.
    - **Normalized email at rate-limit-key construction sites** — every call site that builds a rate-limit key from an email must use the normalised form (lowercased, trimmed). Grep guard would catch raw email-as-key regressions.
  - Wants its own scoped session: define the invariant set, write each guard, prove each one triggers on a known-bad fixture, then wire into CI.
  - **ChatGPT framing:** "Optional. The pattern is sound; extending it is leverage."

- [ ] CHATGPT-R3-2 — Canonical error taxonomy `{ code, statusCode, message, context? }`
  - Define a single error class shape across the server: `{ code: string, statusCode: number, message: string, context?: Record<string, unknown> }`. Every thrown error in `server/services/**`, `server/routes/**`, and `server/middleware/**` constructs through this shape. The error envelope at `server/index.ts` reads `code` and `statusCode` mechanically rather than mapping ad-hoc by `message` or `instanceof`.
  - Belongs in its own spec — touches every module that throws and every route that surfaces an error. Coordinate with the error-envelope and correlation-ID work already in place; this is the type-system follow-up that lets the envelope be authoritative.
  - **ChatGPT framing:** "Not urgent, but high leverage later."

- [ ] CHATGPT-R3-6 — Audit event namespace consistency
  - Audit event names currently mix conventions across the security-audit and operational-audit streams. Define the namespace convention and align existing call sites:
    - `auth.*` — user authentication events (login, logout, password change, MFA enrol/verify).
    - `oauth.*` — provider OAuth flows (state issued, callback success/expired, token refresh).
    - `security.*` — threat / abuse events (rate-limit trip, suspicious-activity, sentinel-row violation).
    - `audit.*` — business events (resource created/updated/deleted, ownership changed, permission granted).
  - Write a short convention doc (likely under `docs/` alongside the security runbook) and run a one-shot rename pass across existing audit call sites. Update `securityAuditService` typing if it currently accepts free-form strings.
  - **ChatGPT framing:** "Optional. Define a simple convention."

---

## Deferred from spec-reviewer — pre-launch-phase-3 iteration 3 (2026-05-05)

**Captured:** 2026-05-05T10-50-00Z
**Source log:** `tasks/review-logs/spec-reviewer-log-pre-launch-phase-3-2026-05-05T10-41-20Z.md` (Iteration 3 entry)
**Branch:** `claude/pre-launch-phase-3`
**Spec:** `tasks/builds/pre-launch-phase-3/spec.md`

- [ ] PARALLEL-BUILD-DASHBOARD-VISIBILITY — Mission Control parser does not understand parallel build pointers
  - `tasks/current-focus.md` carries a `<!-- mission-control-parallel ... -->` block alongside the canonical `<!-- mission-control ... -->` to track the Phase 3 build alongside `baseline-capture` (REVIEWING). The dashboard parser at `tools/mission-control/` reads only the canonical regex (`<!-- mission-control ... -->`), so the parallel block is invisible.
  - Two routes to close: (a) extend `parseCurrentFocusBlock` + `readActiveBuildSlug` to read the canonical block PLUS any `mission-control-parallel` blocks, returning a list rather than a single active build; (b) drop the parallel-block convention and use `tasks/builds/<slug>/progress.md` files alone for tracking concurrent builds (status pointer becomes informational only).
  - Out of scope for Phase 3 — this is dashboard tooling drift, not a spec or code-correctness issue. The Phase 3 build is correctly tracked via `tasks/builds/pre-launch-phase-3/progress.md` and the handoff file regardless of dashboard visibility. Operator authorised the parallel-build pattern explicitly in the Phase 3 invocation instructions.
  - **Codex framing:** "Either teach the parser about parallel blocks or use an existing supported mechanism for in-flight builds."
