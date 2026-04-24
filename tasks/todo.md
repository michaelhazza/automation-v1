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

---

### LAEL-RELATED — `External Call Safety Contract` abstraction (cross-feature, unscoped)

**Not a LAEL deliverable.** Extract the pattern from `llmRouter.ts` — `intent-record → external-side-effect → single-terminal-transition → ghost-arrival-detection → caller-owned-retry → observable-in-flight → best-effort-history` — into a reusable platform primitive so payments, webhook dispatch, integration adapters, and long-running agent tasks can all inherit it without reintroducing unsafe retry logic.

**Why it's filed here.** Called out post-in-flight-tracker merge + reinforced during LAEL reviews. Has no spec yet.

---

## PR Review deferred items

### PR #182 — claude/build-paperclip-hierarchy-ymgPW (2026-04-23 — ChatGPT review round 2)

- [ ] [user] **Split `agent_runs` into `agent_runs_core` / `agent_runs_context` / `agent_runs_delegation`** — ChatGPT reviewer flagged that `agent_runs` is now a high-width, high-churn table (cached-context fields + delegation telemetry + execution metadata), approaching TS inference limits. We hit it once during the merge (`handoffSourceRunId` self-reference made the whole table `any`) and fixed it surgically by dropping the Drizzle-side `.references()` clause. Reviewer explicitly said "not now, but soon." Triggers for revisiting: (a) a second TS-inference wall we can't fix by dropping one FK declaration, (b) `agent_runs` column count crosses ~40, (c) we introduce a new subsystem that wants to add a fourth column group. The split itself is a weeks-of-work refactor — migration sequence, view-compatibility shim, audit of ≈40+ consumers that read across column groups, query-planner overhead on hot paths. Don't trigger pre-emptively. Source: ChatGPT review round 2 (2026-04-23); session log `tasks/review-logs/chatgpt-pr-review-claude-build-paperclip-hierarchy-ymgPW-2026-04-23T23-33-00Z.md`.

### paperclip-hierarchy

- [ ] **REQ #C4a-6 — Return-shape contract for delegation errors (architectural).** `spawn_sub_agents` and `reassign_task` return `{ success: false, error: <string code>, context }` but spec §4.3 mandates `{ success: false, error: { code, message, context } }`. The telemetry event payloads already use the spec-correct nested envelope; only the skill handler return values diverge. Fixing this either (a) introduces return-shape inconsistency across the ~40 other skills in `skillExecutor.ts` that return `error: string`, or (b) implies a broader migration of the string-error pattern. Architect decision needed: is the legacy string pattern grandfathered and spec §4.3 describes only new-delegation-skills-only contracts, or must all three codes adopt the nested envelope? If nested, audit `executeWithActionAudit`, LLM-facing serialisation, and agent prompt parsing for breakage. Source: spec §4.3 lines 316–322; `spec-conformance-log-paperclip-hierarchy-chunk-4a-2026-04-24T00-00-00Z.md`.

### PR #171 — claude-md-updates (2026-04-22)

- [ ] Add non-goals enforcement gate to spec-reviewer — valid improvement but requires spec-reviewer to reason about product strategy (not just structural spec quality); out of scope for this PR; revisit when spec-reviewer is next revised.

## Deferred from pr-reviewer review — Universal Brief

**Captured**: 2026-04-22
**Branch**: `claude/implement-universal-brief-qJzP8`
**Source log**: [tasks/review-logs/pr-review-log-universal-brief-2026-04-22T07-35-39Z.md](./review-logs/pr-review-log-universal-brief-2026-04-22T07-35-39Z.md)

- [ ] **B10 — maintenance jobs bypass the admin/org tx contract (architectural).** `server/jobs/ruleAutoDeprecateJob.ts`, `fastPathDecisionsPruneJob.ts`, and `fastPathRecalibrateJob.ts` read/write RLS-protected tables (`memory_blocks`, `fast_path_decisions`) from outside any `withAdminConnection` / `withOrgTx` block. Without `app.organisation_id` or `SET LOCAL ROLE admin_role`, the selects return zero rows per org and the jobs are silent no-ops. Fix: enumerate orgs inside `withAdminConnection({ source: 'rule-auto-deprecate' })` with `SET LOCAL ROLE admin_role`, then wrap each per-org iteration in `withOrgTx({ organisationId: org.id, source: '…' })`. Mirrors the `memoryDedupJob.ts` pattern. Not blocking end-user functionality (the feature still works), but the decay/pruning never runs until fixed.
- [ ] **S2 — add skill definition .md files for `ask_clarifying_questions` and `challenge_assumptions`.** Handlers are wired in `SKILL_HANDLERS` so runtime dispatch works, but the file-based definitions pattern (`server/skills/*.md` with frontmatter) expects them. Without the .md these capabilities won't surface in the config assistant or skill studio UIs. Reference: `architecture.md` §Skill System.
- [ ] **S3 — strengthen rule-conflict parser tests.** `ruleConflictDetectorServicePure.parseConflictReportPure` drops malformed items silently via `continue`; production could let users save conflicting rules if the LLM returns malformed conflict objects. Add tests for: (a) existingRuleId not in candidatePool → dropped; (b) invalid `kind` → dropped; (c) confidence out of [0,1] → dropped.
- [ ] **S4 — remove or re-label `cheap_answer` canned replies.** `briefSimpleReplyGeneratorPure` emits `source: 'canonical'` artefacts with hardcoded placeholder rows ("See revenue data"). Users see properly-sourced-looking results that are actually stubs. Either (a) add `'canned' | 'stub'` to `BriefResultSource` and re-label, or (b) remove the cheap_answer route from the tier-1 classifier until real data resolvers land. Option (b) is simpler.
- [ ] **S6 — add trajectory tests for Phase 4 orchestrator gates.** The clarify/challenge gates are wired via masterPrompt text only (migration 0196). No runtime test pins "clarifyingEnabled=false → no `ask_clarifying_questions` tool call" or "estimatedCostCents > 20 AND sparringEnabled → `challengeOutput` on ApprovalCard". Prompt-only wiring regresses easily; a fixture under `tests/trajectories/` would catch drift.
- [ ] **S8 — move conversation-message websocket emits to a post-commit boundary.** `briefConversationWriter.writeConversationMessage` emits websocket events inline after the insert. If the outer request tx rolls back after the insert but before response, clients see an "artefact appeared" event for a row that was never persisted. Options: defer emits until `res.finish`, or adopt a tx-outbox pattern.
- [ ] **N1 — validate `artefactId` UUID shape in `briefArtefactValidatorPure.validateBase`.** Currently `requireString` accepts `""`. Add a UUID regex.
- [ ] **N2 — add prominent comment at `getBriefArtefacts` noting the backstop is a no-op until Phase 6.4 resolvers land** (`briefArtefactBackstop.ts` sets `idScopeCheck` and `scopedTotals` to `undefined`).
- [ ] **N3 — make `conversations_unique_scope` index org-scoped.** Change to `(organisation_id, scope_type, scope_id)` so the uniqueness invariant also holds formally across orgs (UUID collision is improbable but the index semantically belongs org-scoped). Needs a new migration that drops + recreates the index.
- [ ] **N4 — document the `scopeType` ↔ parent-table mapping** on `conversations.scope_id` in the Drizzle schema so future readers know which scope maps to `subaccount_agents.id` vs `agents.id` vs `tasks.id` vs `agent_runs.id`.
- [ ] **N5 — inject clock into `ruleTeachabilityClassifierPure`.** Replace inline `new Date()` with a `now: Date` parameter to match the pure-module convention.
- [ ] **N6 — inject `artefactIdProvider: () => string` into `briefSimpleReplyGeneratorPure`.** Currently uses `crypto.randomUUID()` inline; injection makes tests deterministic.
- [ ] **N7 — paginate `GET /api/briefs/:briefId/artefacts`.** Currently pulls all artefacts and flattens client-side; a long-running Brief conversation could accumulate hundreds. Add `limit`/`cursor` query params before marketing demos.

## Deferred from dual-reviewer review — Universal Brief

**Captured**: 2026-04-22
**Branch**: `claude/implement-universal-brief-qJzP8`
**Source log**: [tasks/review-logs/dual-review-log-universal-brief-2026-04-22T08-02-50Z.md](./review-logs/dual-review-log-universal-brief-2026-04-22T08-02-50Z.md)

- [ ] **DR1 — add `POST /api/rules/draft-candidates` route to wire `ApprovalSuggestionPanel` to `ruleCandidateDrafter.draftCandidates`.** The client panel posts to `/api/rules/draft-candidates` with `{ artefactId, wasApproved }` but no route exists, so every click on “Yes, suggest a rule” 404s and the panel silently dismisses. Wiring requires non-trivial server logic: scan `conversation_messages.artefacts` JSONB for the `artefactId`, verify kind === 'approval', load the parent brief for `briefContext`, look up existing related rules, then call `draftCandidates(...)`. Non-blocking because the rest of the Universal Brief flow works; only the approval→rule teach-loop is dark. Defer to the same follow-up pass as S3 (rule-conflict parser tests). Pre-existing from commit 6af10f1 — not introduced by the pr-reviewer fix pass.
- [ ] **DR2 — re-invoke fast-path + Orchestrator on follow-up conversation messages (spec §7.11/§7.12).** `POST /api/conversations/:conversationId/messages` and `POST /api/briefs/:briefId/messages` currently only write the user turn into `conversation_messages` and return. Per spec §7.11 ("Re-invokes the fast path + Orchestrator if the message looks like a follow-up intent rather than a passive 'thanks'"), follow-up turns should run `classifyChatIntent` on the new text and — for `needs_orchestrator` / `needs_clarification` — re-enqueue `orchestratorFromTaskJob`. Without this, chat surfaces become one-way after the initial response: the user can send questions but the system never agent-runs on them. Architectural scope — needs design for non-Brief scopes (`task`, `agent_run`) that don't currently enqueue orchestration, idempotency for passive acks, and whether simple_reply/cheap_answer can produce new inline artefacts on follow-ups. Pre-existing from commit 6af10f1 — not introduced by the pr-reviewer fix pass.
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

- [ ] **REQ #WB-1 — INV-1.2 `agent_runs.handoff_source_run_id` is never written; handoff edges cannot render in the delegation graph (architectural).** The spec's run-id continuity invariant (§10.6 clause 2) requires every handoff-created `agent_runs` row to carry `handoffSourceRunId = context.runId` of the `reassign_task` call. The column exists on the Drizzle schema (`agentRuns.ts:211`) and is read by `delegationGraphServicePure.ts:72` to produce handoff edges, but no write site populates it: `AgentRunRequest` has no `handoffSourceRunId` field, `agentExecutionService`'s `agent_runs` INSERT (lines ~395–412) does not set it, and the handoff worker at `agentScheduleService.ts:127` routes `sourceRunId → parentRunId` instead. Consequences: (1) handoff edges are invisible in the `/api/agent-runs/:id/delegation-graph` response (spawn edges still render because `parentRunId + isSubAgent` gate); (2) INV-1.3 "both pointers when both caused it" is unreachable; (3) INV-1.4 "`delegation_outcomes.runId === child.handoffSourceRunId` for handoffs" is structurally broken. Because `parentRunId` is currently reused for handoff chains by pre-existing code (the trace-session logic at `agentExecutionService.ts:1226-1232` and `agentActivityService.getRunChain` read `parentRunId` for handoff chains), the fix is cross-cutting — it requires a design call (keep `parentRunId` for handoff runs alongside the new `handoffSourceRunId`, or clear it and migrate downstream chain logic to the new column). Deferring as architectural. Suggested approach: (a) add `handoffSourceRunId?: string` to `AgentRunRequest`; (b) propagate it into the `agent_runs` INSERT in `agentExecutionService.executeRun`; (c) extend the `agent-handoff-run` worker payload and pass it through; (d) decide whether `parentRunId` is ALSO set (backward-compat) or null for handoff runs, and update pure graph emission + run-chain consumers accordingly. Source: `docs/hierarchical-delegation-dev-spec.md` §5.3 + §7.2 + §10.6; log `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-2026-04-23T23-05-56Z.md`.
