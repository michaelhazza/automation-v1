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

## Deferred from chatgpt-pr-review — PR #174 (2026-04-22)

**Captured:** 2026-04-22T10-22-29Z
**Source log:** `tasks/review-logs/chatgpt-pr-review-create-spec-conformance-2026-04-22T10-22-29Z.md`

Strategic follow-ons surfaced by the ChatGPT PR review of the `spec-conformance` agent introduction. Out-of-scope for PR #174; captured for future consideration once the three-layer validation pattern has bedded in.

- [ ] **Spec coverage metrics** — surface % of spec requirements implemented, with a breakdown by category (files / exports / schema / contracts / behavior). Output of `spec-conformance` already enumerates every REQ and its verdict; an aggregator could roll these up across a slug's review logs to produce a coverage dashboard. Gate on: first production use where a reviewer asks "how much of the spec did this PR land?".
- [ ] **Drift detection over time** — periodic re-verification of merged features against their original specs to catch post-merge implementation drift (refactor silently changes behavior the spec named). Would require a durable mapping from spec → merged branch/PR plus a scheduled re-run. Gate on: first confirmed drift incident.
- [ ] **Automated plan validation (plan → spec mismatch detection)** — before a chunked implementation starts, verify that `tasks/builds/<slug>/plan.md`'s chunk decomposition actually covers every REQ in the spec. Would close the "plans are loosely mapped to specs" gap ChatGPT flagged. Lighter lift than drift detection — can reuse the REQ-extraction pass from `spec-conformance`. Gate on: next feature where `feature-coordinator` + `spec-conformance` are run end-to-end on a multi-chunk plan.
