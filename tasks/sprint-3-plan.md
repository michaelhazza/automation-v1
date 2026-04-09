# Sprint 3 Implementation Plan

**Status:** draft (architect)
**Branch:** `claude/sprint-3-hOHYM` (the session is running on `claude/sprint-3-handoff-cOHYM` already)
**Base commit:** 1f1e93b (PR #93 — Sprint 2 P1.1 + P1.2 merged to main)
**Roadmap reference:** `docs/improvements-roadmap-spec.md` §P2.1, §P2.2, §P2.3
**Framing reference:** `docs/spec-context.md` — pre-production, `commit_and_revert`, `feature_stability: low`, `runtime_tests: pure_function_only`
**Session brief:** `tasks/sprint-3-5-handoff.md`

---

## Table of contents

1. Reconciliation decisions (spec vs brief)
2. Files to touch (grouped by item)
3. Build order
4. Sprint 3 gates to add
5. Risks and sharp edges
6. Spec update diff
7. Out-of-scope explicit list

---

## 1. Reconciliation decisions

Three material divergences between the roadmap spec (canonical) and the
Sprint 3-5 handoff brief. Each is resolved here with a concrete decision and
rationale. Where a decision differs from the spec, Section 6 contains the
exact diff to bring the spec back in sync in the same commit.

### 1.1 P2.2 — reflection loop: sync inline middleware (spec wins)

**Decision: ship the spec's synchronous `postTool` middleware.** New files
`server/services/middleware/reflectionLoopMiddleware.ts` and
`server/services/middleware/reflectionLoopPure.ts` with `parseVerdict()`.
The middleware lives in `pipeline.postTool`, observes every `review_code`
result, tracks verdict state in `MiddlewareContext.lastReviewCodeVerdict` /
`reviewCodeIterations`, blocks `write_patch` without a preceding APPROVE,
and escalates to HITL after `MAX_REFLECTION_ITERATIONS = 3` via a new
`escalate_to_review` post-tool action.

**Why not the brief's async `reflection-tick` job:** the spec's stated goal
for P2.2 is *"Make the existing prompt-level max 3 self-review iterations
mechanically enforced, not vibes-based"*. That is a guardrail inside the
agent loop — it must fire before the LLM's next tool call, not after the
fact. The brief's async model is a different feature (a learning loop on
rejected actions) and it cannot block `write_patch` without APPROVE, which
is the core requirement. The brief's wording appears to have conflated two
unrelated ideas. Pick the inline guardrail; defer any "learn from rejection"
work to a later sprint if it resurfaces.

**Contract change this implies:** `PostToolResult` in
`server/services/middleware/types.ts` grows two new variants —
`inject_message` and `escalate_to_review` — and the post-tool loop in
`runAgenticLoop` gains handlers for both. The spec lists
`escalate_to_review` explicitly; `inject_message` is needed for iteration
1/3 and 2/3 critique injection when verdict is BLOCKED but
`reviewCodeIterations < MAX_REFLECTION_ITERATIONS`. The brief's async model
does not need this — its mention is only in the spec.

**Escalation sink:** the middleware itself does NOT call `reviewService`
(per the spec's circular-dependency note). It returns
`{ action: 'escalate_to_review', reason, pendingAction? }` and the loop in
`runAgenticLoop` calls `reviewService.createReviewItem(...)` and sets the
run's `finalStatus = 'awaiting_review'`. Because Sprint 3A (see §1.3) does
NOT refactor HITL to async resume, the run then terminates like any other
HITL handoff today — the process ends, the human decides, and on approval
the existing Sprint 2 resume path (re-enqueue a fresh run) takes over.
Sprint 3B will replace that with the `agent-run-resume` pg-boss job.

### 1.2 P2.3 — confidence scoring (spec wins); policy DSL deferred

**Decision: ship the spec's P2.3 — confidence scoring + decision-time
guidance, in three slices.** Migration 0085 adds `confidence_threshold real`
and `guidance_text text` to `policy_rules`. `policyEngineService` gains
`getDecisionTimeGuidance()` and an auto→review upgrade when
`ctx.confidence < CONFIDENCE_GATE_THRESHOLD`. A new pure helper
`extractToolIntentConfidence(messages, toolName)` lives in
`agentExecutionServicePure.ts`. Agent prompts gain a one-line `tool_intent`
convention.

**Why not the brief's policy DSL slices (any_of/all_of, numeric comparators,
time predicates):** those are valuable work and they genuinely fit the P2.3
"slice" shape, but they are not in the spec for Sprint 3. The brief's author
almost certainly confused sprints — the DSL expansion reads like a P4.*
hardening item. Shipping the brief's DSL work would leave the spec's P2.3
behaviour-critical pieces (confidence gate upgrade, decision-time guidance)
undone, while the confidence-scoring work is on the HITL quality critical
path. Stay on the spec.

**What this leaves on the table:** the brief's DSL expansion is genuinely
useful and the `matchesRule` export is already in place. It is not shipped
in this session. Section 7 lists it explicitly for a follow-up. If the
current equality-only matcher proves too limiting for confidence-threshold
per-rule overrides during implementation, we can add a *minimal* numeric
comparator (`lt` only, for the confidence threshold override) as a bounded
exception — but anything larger than that defers. Document any such
minimal exception inline at the call site.

### 1.3 P2.1 — scope split: Sprint 3A ships the append-only + checkpoint write path, Sprint 3B defers HITL-async + inner-loop refactor

**Decision: split the spec's P2.1 into two phases. Ship Sprint 3A this
session; defer Sprint 3B to a follow-up session.** The spec's full P2.1
(messages table + checkpoint column + per-tool-call inner loop refactor +
HITL async resume + `agent-run-resume` + `agentRunCleanupProcessor` + two
new forward-compat gates + integration test I2) is too large for one
session given the Sprint 3 surface also includes P2.2 + P2.3.

**Sprint 3A (this session) ships:**

1. Migration 0084 creates `agent_run_messages` with its RLS policy in the
   same SQL file, adds `checkpoint jsonb` to `agent_run_snapshots`, and
   adds `run_retention_days integer` to `organisations`. The spec's
   "RLS-in-same-migration" rule is respected.
2. `server/db/schema/agentRunMessages.ts` Drizzle mirror + re-export from
   `server/db/schema/index.ts`.
3. `server/config/rlsProtectedTables.ts` appends `agent_run_messages` in
   the same commit (same rule enforced by `verify-rls-coverage.sh`).
4. `server/services/agentRunMessageService.ts` — append-only write service,
   `appendMessage()` and `streamMessages()`.
5. `AgentRunCheckpoint` + `SerialisableMiddlewareContext` interfaces
   declared in `server/services/middleware/types.ts` (extending the
   existing module, adjacent to `MiddlewareContext`). The `middlewareVersion`
   field is pre-seeded at 1 and `MIDDLEWARE_CONTEXT_VERSION = 1` lives in
   `server/config/limits.ts` — but no gate enforces it yet in 3A.
6. `serialiseMiddlewareContext()` / `deserialiseMiddlewareContext()` pure
   helpers in `server/services/agentExecutionServicePure.ts` + round-trip
   unit test `serialiseMiddlewareContext.test.ts`.
7. `persistCheckpoint()` call site added inside `runAgenticLoop` **after
   the existing inner `for (const toolCall of response.toolCalls)` loop
   finishes** — one checkpoint per iteration, not per tool call. (See
   rationale below. This is the 3A→3B trade-off.) Messages from the
   iteration are also written to `agent_run_messages` via the service at
   the same point.
8. `resumeAgentRun(runId, { useLatestConfig = false })` service entry
   point that loads the latest checkpoint, streams messages up to
   `messageCursor`, rehydrates `mwCtx`, and calls `runAgenticLoop` with
   `startingIteration: checkpoint.iteration + 1`. The config-snapshot
   enforcement (`hash(configSnapshot) === checkpoint.configVersion`) ships.
9. `toolCallsLogProjectionService` (tiny) — reads `agent_run_messages` at
   run completion and projects the tool-call subset into
   `agent_run_snapshots.toolCallsLog` for the existing debug UI.
10. `agent-run-cleanup` pg-boss cron + `agentRunCleanupProcessor` +
    `idempotencyStrategy: 'fifo'` + `withAdminConnection` +
    `SET LOCAL ROLE admin_role`. Uses the new `organisations.run_retention_days`
    column with `DEFAULT_RUN_RETENTION_DAYS = 90` fallback from `limits.ts`.
11. Pure-helper unit tests: `serialiseMiddlewareContext.test.ts`,
    `buildResumeContext.test.ts` (checkpoint → LoopParams reconstruction
    shape), `toolCallsLogProjection.test.ts`.

**Sprint 3B (deferred to a follow-up session) covers:**

1. Per-tool-call inner loop refactor (execute one tool call, checkpoint,
   next — LangGraph-style). This is a real behaviour change to the hot
   path and needs its own architect pass + integration tests.
2. HITL refactor from `hitlService.awaitDecision` blocking to
   `hitlService.triggerResume` enqueue-on-decide.
3. `agent-run-resume` pg-boss job + `agentRunResumeProcessor` worker +
   `agent-run-resume` entry in `jobConfig.ts`.
4. `awaiting_review` agent run status + the admin-only
   `POST /api/agent-runs/:id/resume?useLatestConfig=true` endpoint.
5. `MIDDLEWARE_CONTEXT_VERSION` forward-compat guard (compare checkpoint
   version against runtime, refuse on newer).
6. Two new gates `verify-middleware-state-serialised.sh` and
   `verify-run-state-source-of-truth.sh`.
7. Integration test I2 (`agentRun.crash-resume-parity.test.ts`).

**Why split this way:** 3A delivers concrete, verifiable value
(append-only message log, pointer-based checkpoint, pruning, config-snapshot
enforcement, `agent_run_messages` with RLS) without touching the hot path
tool-execution loop. Every piece in 3A is additive — if resumes are broken
at the end of 3A, the existing behaviour is identical to today because
`runAgenticLoop` still runs its inner tool loop unchanged and the
checkpoint column on `agent_run_snapshots` is only written, never read on
the happy path. 3B is the hot-path refactor and the async HITL refactor,
which together need dedicated review.

**The trade-off this makes explicit:** in 3A, if the process crashes
mid-iteration (tool N of M in a multi-tool response), resume will replay
the entire iteration from tool 1. This is strictly better than today
(total run loss) but weaker than the spec's final state (replay from
tool N+1). The race-window narrowing is a 3B deliverable. Since
we're pre-production, this is acceptable — no live users will hit it.

**What this does NOT break:** the config-snapshot enforcement, RLS on the
new table, the deprecation contract for `toolCallsLog`, the
messages/pointers three-way division, and the pruning cron all ship in 3A.
The remaining 3B work is a layered addition on top, not a rewrite.

## 2. Files to touch

Every path is absolute-from-repo-root. `C` = create, `M` = modify.

### 2.1 P2.2 — reflection loop

| File | C/M | Change |
|---|---|---|
| `server/services/middleware/reflectionLoopMiddleware.ts` | C | The middleware. Lives in `pipeline.postTool`. Imports `parseVerdict` from the pure sibling. |
| `server/services/middleware/reflectionLoopPure.ts` | C | `parseVerdict(output: string): 'APPROVE' \| 'BLOCKED' \| null`. Regex over the last ~200 chars: `/Verdict[\s\S]*?(APPROVE\|BLOCKED)/`. Fully pure. |
| `server/services/__tests__/reflectionLoop.test.ts` | C | Pure tests for `parseVerdict` (APPROVE, BLOCKED, malformed, missing verdict, mixed-case, extra whitespace) + middleware decision logic (inject on iter 1/3, inject on 2/3, escalate on 3/3, block `write_patch` without APPROVE). Imports statically from `../reflectionLoopPure.js` and `../middleware/reflectionLoopMiddleware.js`. |
| `server/config/limits.ts` | M | Add `export const MAX_REFLECTION_ITERATIONS = 3;` adjacent to `MAX_LOOP_ITERATIONS`. |
| `server/services/middleware/types.ts` | M | Extend `MiddlewareContext` with `lastReviewCodeVerdict?: 'APPROVE' \| 'BLOCKED' \| null;` and `reviewCodeIterations?: number;`. Extend `PostToolResult` union with `\| { action: 'inject_message'; message: string }` and `\| { action: 'escalate_to_review'; reason: string; pendingAction?: { toolName: string; input: Record<string, unknown>; toolCallId: string } }`. |
| `server/services/middleware/index.ts` | M | Register `reflectionLoopMiddleware` in `createDefaultPipeline().postTool`. |
| `server/services/agentExecutionService.ts` | M | Post-tool loop gains handlers for `inject_message` (queue into `pendingInjectedMessages`) and `escalate_to_review` (call `reviewService.createReviewItem` outside the middleware, then `break outerLoop` with `finalStatus = 'awaiting_review'`). Zero changes to the pre-tool pipeline. |

### 2.2 P2.3 — confidence scoring + decision-time guidance

| File | C/M | Change |
|---|---|---|
| `migrations/0085_policy_rules_confidence_guidance.sql` | C | `ALTER TABLE policy_rules ADD COLUMN confidence_threshold real;` and `ADD COLUMN guidance_text text;`. No RLS change (`policy_rules` is not RLS-protected today — verify manifest before committing). |
| `migrations/_down/0085_policy_rules_confidence_guidance.sql` | C | `ALTER TABLE policy_rules DROP COLUMN confidence_threshold;` `DROP COLUMN guidance_text;`. |
| `server/db/schema/policyRules.ts` | M | Mirror the two new columns (`confidenceThreshold: real('confidence_threshold')` and `guidanceText: text('guidance_text')`). |
| `server/services/policyEngineService.ts` | M | Extend `PolicyContext` with `confidence?: number`. After the existing first-match loop, upgrade `auto` → `review` when `ctx.confidence !== undefined && ctx.confidence < CONFIDENCE_GATE_THRESHOLD` (respect per-rule `confidence_threshold` override on the matched rule if set). Add a new method `getDecisionTimeGuidance(ctx: PolicyContext): Promise<string \| null>` that reuses `getRulesForOrg`, filters by `matchesRule(r, ctx) && r.guidanceText`, and joins them with newlines. |
| `server/services/agentExecutionServicePure.ts` | M | Add `export function extractToolIntentConfidence(messages: LLMMessage[], toolName: string): number \| undefined`. Walks messages backwards, looks for the most recent `tool_intent` block matching `toolName`, extracts `confidence`. Fully pure. |
| `server/services/middleware/proposeAction.ts` (or a new `server/services/middleware/decisionTimeGuidance.ts`) | M or C | In the existing `proposeActionMiddleware` preTool flow, after policy evaluation: (a) pass `confidence` into the `PolicyContext`, (b) call `policyEngineService.getDecisionTimeGuidance(ctx)` and, if non-null, emit an `inject_message` action with a `<system-reminder>` block containing the guidance text. **Decision: add a new middleware `decisionTimeGuidanceMiddleware.ts` rather than bloating `proposeAction.ts`.** Keeps single-responsibility clean. |
| `server/services/middleware/decisionTimeGuidanceMiddleware.ts` | C | New preTool middleware. Runs after `proposeActionMiddleware`. Calls `getDecisionTimeGuidance`, returns `{ action: 'inject_message', message: '<system-reminder>...</system-reminder>' }` when guidance exists, `{ action: 'continue' }` otherwise. |
| `server/services/middleware/index.ts` | M | Register `decisionTimeGuidanceMiddleware` in `createDefaultPipeline().preTool` AFTER `proposeActionMiddleware`. |
| `server/config/limits.ts` | M | Add `export const CONFIDENCE_GATE_THRESHOLD = 0.7;`. |
| `server/services/__tests__/policyEngineService.scopeValidation.test.ts` | M | Append Sprint 3 assertions: confidence gate upgrade (auto → review on low confidence), per-rule threshold override, guidance text concatenation via `getDecisionTimeGuidance` mock (pure — stub `getRulesForOrg` via a new exported `matchesRuleWithConfidence` helper or split `matchesRule` variants). **Note:** `getDecisionTimeGuidance` touches the DB via `getRulesForOrg`, so the unit test must target either the pure `matchesRule` extended form or a new pure helper `selectGuidanceTexts(rules, ctx)` that can be tested without a DB. Create `server/services/policyEngineServicePure.ts` holding `selectGuidanceTexts` and the confidence upgrade logic; `policyEngineService.ts` imports from it. |
| `server/services/policyEngineServicePure.ts` | C | New pure helper file. Contains `selectGuidanceTexts(rules, ctx)` and `applyConfidenceUpgrade(decision, ctx, CONFIDENCE_GATE_THRESHOLD, matchedRule?.confidenceThreshold)`. Zero DB imports. |
| `server/services/__tests__/agentExecutionServicePure.toolIntent.test.ts` | C | Pure tests for `extractToolIntentConfidence` — various message shapes, no `tool_intent` (returns undefined), multiple `tool_intent` blocks (most recent wins), malformed JSON. Imports statically from `../agentExecutionServicePure.js`. |
| `server/services/__tests__/policyEngineServicePure.confidence.test.ts` | C | Pure tests for `applyConfidenceUpgrade` and `selectGuidanceTexts`. |
| Agent master prompt templates under `server/db/seeds/` or similar | M | One-line addition: *"When you call a tool, prefix it with a brief confidence assessment. For each tool call, emit a `tool_intent` block with `{ tool, confidence: 0.0-1.0, reasoning }` immediately before the tool call itself."* Confirm location during implementation — likely `server/services/agentConfig.ts` or the master prompt assembly function. |

### 2.3 P2.1 (Sprint 3A subset) — messages table + checkpoint column + resume read path

| File | C/M | Change |
|---|---|---|
| `migrations/0084_agent_run_checkpoint_and_messages.sql` | C | Single migration with: (a) `CREATE TABLE agent_run_messages (...)` + indexes (unique `(run_id, sequence_number)`, non-unique `(run_id)`), (b) `ALTER TABLE agent_run_snapshots ADD COLUMN checkpoint jsonb`, (c) `ALTER TABLE organisations ADD COLUMN run_retention_days integer`, (d) `ALTER TABLE agent_run_messages ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`, (e) `CREATE POLICY agent_run_messages_org_isolation ON agent_run_messages USING (...) WITH CHECK (...);` — mirror the 0083 pattern exactly. |
| `migrations/_down/0084_agent_run_checkpoint_and_messages.sql` | C | Rollback in reverse order: drop policy, disable RLS, drop table, drop checkpoint column, drop `run_retention_days` column, remove manifest entry. |
| `server/db/schema/agentRunMessages.ts` | C | Drizzle mirror of the table. Exports `agentRunMessages`, `AgentRunMessage`, `NewAgentRunMessage`. |
| `server/db/schema/index.ts` | M | Re-export from `./agentRunMessages.js`. |
| `server/db/schema/agentRunSnapshots.ts` | M | Add `checkpoint: jsonb('checkpoint').$type<AgentRunCheckpoint>()`. Add deprecation comment on `toolCallsLog` pointing at `agent_run_messages`. Import `AgentRunCheckpoint` from the types module. |
| `server/db/schema/organisations.ts` | M | Add `runRetentionDays: integer('run_retention_days')` (nullable). |
| `server/config/rlsProtectedTables.ts` | M | Append `agent_run_messages` with `policyMigration: '0084_agent_run_checkpoint_and_messages.sql'`. |
| `server/config/limits.ts` | M | Add `MAX_REFLECTION_ITERATIONS = 3` (also used by P2.2), `CONFIDENCE_GATE_THRESHOLD = 0.7` (also P2.3), `DEFAULT_RUN_RETENTION_DAYS = 90`, `MIDDLEWARE_CONTEXT_VERSION = 1`. |
| `server/services/middleware/types.ts` | M | Add `interface AgentRunCheckpoint { version: 1; iteration: number; totalToolCalls: number; totalTokensUsed: number; messageCursor: number; middlewareContext: SerialisableMiddlewareContext; lastCompletedToolCallId?: string; resumeToken: string; configVersion: string; }` and `interface SerialisableMiddlewareContext { middlewareVersion: number; iteration: number; tokensUsed: number; toolCallsCount: number; toolCallHistory: Array<{ name: string; inputHash: string; iteration: number }>; lastReviewCodeVerdict?: 'APPROVE' \| 'BLOCKED' \| null; reviewCodeIterations?: number; preToolDecisions?: Record<string, { decision: 'auto' \| 'review' \| 'block'; actionId?: string }>; }`. |
| `server/services/agentRunMessageService.ts` | C | `appendMessage(runId, organisationId, sequenceNumber, role, content, toolCallId?)` — single insert, uses the org-scoped db handle (NOT `db` directly). `streamMessages(runId, { fromSequence?, toSequence? })` — ordered select, returns an array (no real streaming in 3A — just ordered fetch). Exports `nextSequenceNumber(runId)` helper that reads the current max + 1 inside a transaction; callers must use this inside `withOrgTx` to avoid a race. |
| `server/services/agentExecutionServicePure.ts` | M | Add `serialiseMiddlewareContext(ctx: MiddlewareContext): SerialisableMiddlewareContext` and `deserialiseMiddlewareContext(s: SerialisableMiddlewareContext, runtimeDefaults): MiddlewareContext`. Add `buildResumeContext(checkpoint, runMetadata): { startingIteration, messageCursor, serialisedMwCtx }`. All pure — no DB imports. |
| `server/services/agentExecutionService.ts` | M | (a) Inject `agentRunMessageService.appendMessage` calls at the two points where messages are pushed to the in-memory array today: after the LLM response (assistant message with tool_use blocks) and after the tool_results batch (user message with tool_result blocks). The in-memory `messages[]` is **unchanged** — this is an append-only mirror, not a replacement. (b) After the inner tool loop completes (after the `messages.push(tagIteration(...))` at line ~1608), call `persistCheckpoint(runId, { iteration, totalToolCalls, totalTokensUsed, messageCursor, middlewareContext: serialiseMiddlewareContext(mwCtx), resumeToken, configVersion })`. (c) Add `persistCheckpoint` as a private helper in this file — single upsert into `agent_run_snapshots`. (d) Compute `configVersion` once at the top of `runAgenticLoop` by hashing the `configSnapshot` from the `agent_runs` row. (e) Add a new exported function `resumeAgentRun(runId, options = { useLatestConfig: false })` — see below. (f) At run completion (the existing finalisation path), call `toolCallsLogProjectionService.project(runId)` to populate the deprecated `toolCallsLog` column. |
| `server/services/toolCallsLogProjectionService.ts` | C | `project(runId): Promise<void>`. Reads `agent_run_messages` for the run, filters tool-call-shaped records, writes the derived blob into `agent_run_snapshots.toolCallsLog`. Single function, small. |
| `server/services/__tests__/serialiseMiddlewareContext.test.ts` | C | Pure round-trip test: build a `MiddlewareContext`, serialise, deserialise, assert equality. Edge cases: empty tool history, reflection state set, `preToolDecisions` populated. Imports statically from `../agentExecutionServicePure.js`. |
| `server/services/__tests__/buildResumeContext.test.ts` | C | Pure test for `buildResumeContext` — given a known checkpoint + run metadata, asserts the reconstructed LoopParams shape. |
| `server/services/__tests__/toolCallsLogProjection.test.ts` | C | Pure test for the projection function using a fake `streamMessages` and a fake `persistToolCallsLog` wired via function arguments. **The projection service itself touches the DB, so the test targets a pure helper `projectToolCallsLog(messages)` in `toolCallsLogProjectionServicePure.ts` — create that file too.** |
| `server/services/toolCallsLogProjectionServicePure.ts` | C | Pure helper `projectToolCallsLog(messages: AgentRunMessage[]): unknown[]`. |
| `server/services/__tests__/agentRunMessageService.test.ts` | C | Pure-friendly test: does NOT touch the DB. Tests the pure sequence-number logic and content shape validation only. Alternatively, create `server/services/agentRunMessageServicePure.ts` with `validateMessageShape(role, content, toolCallId)` and test that. |
| `server/services/agentRunMessageServicePure.ts` | C | Pure helpers extracted per the convention: `validateMessageShape`, `computeNextSequenceNumber(currentMax)`. |
| `server/routes/agentRuns.ts` | **NOT touched in 3A** | The admin resume endpoint is Sprint 3B. |
| `server/services/hitlService.ts` | **NOT touched in 3A** | `awaitDecision` blocking behaviour is unchanged. The reflection loop escalation path uses the existing review creation flow. |

### 2.4 Agent-run-cleanup cron

| File | C/M | Change |
|---|---|---|
| `server/config/jobConfig.ts` | M | Add `'agent-run-cleanup': { expireInSeconds: 600, idempotencyStrategy: 'fifo' as const }` in the Tier 3 maintenance section (next to `maintenance:security-events-cleanup`). Single entry for Sprint 3A. |
| `server/jobs/agentRunCleanupJob.ts` | C | `runAgentRunCleanupTick(): Promise<{ pruned: number; skipped: number }>`. Uses `withAdminConnection` + `SET LOCAL ROLE admin_role` (copy the `runRegressionReplayTick` shape from `server/jobs/regressionReplayJob.ts`). For each org, read `run_retention_days` (fallback `DEFAULT_RUN_RETENTION_DAYS`) and delete `agent_runs` rows with `status IN ('completed','failed','timeout','cancelled')` AND `created_at < NOW() - retention_days * interval '1 day'`. The CASCADE on `agent_run_snapshots` and `agent_run_messages` handles dependent rows. Logs a single `agent_run_cleanup_tick_complete` JSON event at the end. |
| `server/jobs/agentRunCleanupJobPure.ts` | C | Pure helpers: `computeCutoffDate(now: Date, retentionDays: number): Date`, `resolveRetentionDays(orgRetentionDays: number \| null, defaultDays: number): number`. |
| `server/workers/index.ts` (or wherever pg-boss workers are registered) | M | Register the `agent-run-cleanup` worker with daily cron `'0 3 * * *'` (03:00). Confirm during implementation — location depends on existing worker registration pattern. |
| `server/services/__tests__/agentRunCleanupJobPure.test.ts` | C | Pure tests for `computeCutoffDate`, `resolveRetentionDays` (null → default, explicit → explicit, zero → treated as default or as "keep forever" — decide in impl). |

### 2.5 Gates and baselines

| File | C/M | Change |
|---|---|---|
| `scripts/verify-reflection-loop-wired.sh` | C | Greps `server/services/middleware/index.ts` for `reflectionLoopMiddleware` registration in the `postTool` list. Greps `server/services/agentExecutionService.ts` for `escalate_to_review` handling. Fails if either is missing. |
| `scripts/verify-checkpoint-rls-coverage.sh` | **NOT created** | The existing `verify-rls-coverage.sh` already enforces this structurally when `agent_run_messages` lands in the manifest. Adding `agent_run_messages` to `RLS_PROTECTED_TABLES` in the same commit as migration 0084 is the only thing needed. **No new gate.** |
| `scripts/verify-tool-intent-convention.sh` | C | Greps agent master prompt files for the `tool_intent` convention string. Fails if no master prompt mentions it. Structural parallel to `verify-idempotency-strategy-declared.sh`. |
| `scripts/guard-baselines.json` | M | Add `"reflection-loop-wired": 0` and `"tool-intent-convention": 0`. |
| `scripts/run-all-gates.sh` | M | Add a new `# ── Sprint 3 (P2.1 + P2.2 + P2.3) gates ──` section at the bottom, registering `verify-reflection-loop-wired.sh` and `verify-tool-intent-convention.sh`. |

**Sprint 3B gates (deferred):** `verify-middleware-state-serialised.sh`,
`verify-run-state-source-of-truth.sh`, `verify-policy-dsl-comparators.sh`
(the last one is only needed if the DSL work ever ships).

### 2.6 Documentation

| File | C/M | Change |
|---|---|---|
| `docs/improvements-roadmap-spec.md` | M | Apply the exact diff in Section 6 below. |
| `tasks/todo.md` | M | Add a Sprint 3 checklist with every chunk from Section 3. Mark as in progress at the start, check items off as they land. |
| `tasks/sprint-3-plan.md` | M | This file. Update the Status line from `draft` to `approved` once the user confirms Section 1 reconciliation decisions. |

## 3. Build order

Strict sequencing. At the end of each chunk the codebase must be buildable
(`npm run build:server` exits 0) and `GUARD_BASELINE=true bash scripts/run-all-gates.sh`
must pass with no new regressions. If a chunk breaks that invariant, stop
and fix before moving on.

The handoff brief's suggested order (P2.2 → P2.3 → P2.1 → cleanup) is
sound — earliest items are the smallest and additive, the biggest
refactor is last. I keep that ordering with one refinement: the
`MiddlewareContext` type extensions (reflection state + serialisable
shape) are split so P2.2 only ships the runtime fields and P2.1 (3A)
ships the serialisable mirror. This way P2.2 lands cleanly without
pulling in the whole checkpoint contract on day 1.

### Chunk A — Update the spec (in the same commit as code)

Apply the Section 6 diff to `docs/improvements-roadmap-spec.md`. This is
chunk A because every subsequent chunk is implementing against the
reconciled spec — the spec update must not lag behind the code.

### Chunk B — P2.2 Reflection loop (additive, smallest)

1. Add `MAX_REFLECTION_ITERATIONS = 3` to `server/config/limits.ts`.
2. Create `server/services/middleware/reflectionLoopPure.ts` with
   `parseVerdict(output: string): 'APPROVE' | 'BLOCKED' | null`.
3. Create `server/services/__tests__/reflectionLoop.test.ts` — pure
   tests for `parseVerdict` only at this sub-step. Assert the regex
   handles APPROVE, BLOCKED, malformed, missing, leading/trailing
   whitespace, mixed case.
4. Extend `MiddlewareContext` in `server/services/middleware/types.ts`
   with the two optional reflection fields. Extend `PostToolResult`
   with the two new variants (`inject_message`, `escalate_to_review`).
5. Create `server/services/middleware/reflectionLoopMiddleware.ts`
   implementing the decision logic.
6. Extend `server/services/__tests__/reflectionLoop.test.ts` with the
   middleware decision-logic tests.
7. Handle `inject_message` and `escalate_to_review` in the post-tool
   loop inside `agentExecutionService.ts`. Escalation calls
   `reviewService.createReviewItem(...)` from outside the middleware
   (in the loop), sets `finalStatus = 'awaiting_review'`, and breaks
   the outer loop.
8. Register `reflectionLoopMiddleware` in
   `server/services/middleware/index.ts` `createDefaultPipeline()`.
9. Create `scripts/verify-reflection-loop-wired.sh` and add it to
   `scripts/run-all-gates.sh` + `scripts/guard-baselines.json`.
10. Run `npm run build:server && npm run test:unit && GUARD_BASELINE=true bash scripts/run-all-gates.sh`.
    Must pass.

### Chunk C — P2.3 Confidence scoring + decision-time guidance

1. Add `CONFIDENCE_GATE_THRESHOLD = 0.7` to `server/config/limits.ts`.
2. Create migration 0085 + down migration + Drizzle schema mirror for
   the two new `policy_rules` columns.
3. Create `server/services/policyEngineServicePure.ts` with
   `applyConfidenceUpgrade(decision, ctx, threshold, ruleOverride?)` and
   `selectGuidanceTexts(rules, ctx, matchesRule)`.
4. Create `server/services/__tests__/policyEngineServicePure.confidence.test.ts`
   — pure tests for both helpers.
5. Wire `applyConfidenceUpgrade` into `policyEngineService.evaluatePolicy`
   right after the first-match loop. Wire `selectGuidanceTexts` into a
   new `policyEngineService.getDecisionTimeGuidance(ctx)` method that
   loads rules via `getRulesForOrg` and filters via `selectGuidanceTexts`.
6. Create `extractToolIntentConfidence(messages, toolName)` in
   `server/services/agentExecutionServicePure.ts`. Pure.
7. Create `server/services/__tests__/agentExecutionServicePure.toolIntent.test.ts`
   — pure tests.
8. Wire `extractToolIntentConfidence` into `proposeActionMiddleware`:
   before calling `policyEngineService.evaluatePolicy`, walk the
   conversation history (available via `mwCtx.request` or by plumbing
   `messages` into the middleware — verify during implementation) and
   extract the confidence value, then pass it on `PolicyContext`.
9. Create `server/services/middleware/decisionTimeGuidanceMiddleware.ts`.
   Runs AFTER `proposeActionMiddleware` in the preTool list. Calls
   `policyEngineService.getDecisionTimeGuidance(ctx)` and emits
   `inject_message` with the `<system-reminder>` wrapper when non-null.
10. Register `decisionTimeGuidanceMiddleware` in `createDefaultPipeline()`
    after `proposeActionMiddleware`, before `toolRestrictionMiddleware`.
11. Update agent master prompt template with the one-line `tool_intent`
    convention. Create `scripts/verify-tool-intent-convention.sh` and
    wire it up.
12. Extend `policyEngineService.scopeValidation.test.ts` with Sprint 3
    assertions (confidence gate upgrade via the pure helper).
13. Run full verification.

### Chunk D — P2.1 (Sprint 3A) schema + append-only write path

This chunk ships the migration and the service writes but **does not**
yet add the resume read path or the checkpoint writes. Landing the
schema + writes separately lets us prove the messages table works
under load before adding resume.

1. Write migration 0084 (table + indexes + RLS + checkpoint column +
   `run_retention_days` column) and its down migration. Copy the
   0083 RLS shape exactly.
2. Create `server/db/schema/agentRunMessages.ts` Drizzle mirror.
3. Update `server/db/schema/agentRunSnapshots.ts` with the `checkpoint`
   column and the deprecation comment on `toolCallsLog`.
4. Update `server/db/schema/organisations.ts` with `runRetentionDays`.
5. Re-export from `server/db/schema/index.ts`.
6. Append `agent_run_messages` to `server/config/rlsProtectedTables.ts`.
7. Add `DEFAULT_RUN_RETENTION_DAYS = 90` and `MIDDLEWARE_CONTEXT_VERSION = 1`
   to `server/config/limits.ts`.
8. Add `AgentRunCheckpoint` and `SerialisableMiddlewareContext` types to
   `server/services/middleware/types.ts` (next to `MiddlewareContext`).
9. Create `server/services/agentRunMessageServicePure.ts` with
   `validateMessageShape` and `computeNextSequenceNumber`.
10. Create `server/services/agentRunMessageService.ts` — impure wrapper
    that calls the pure helpers and runs the actual insert/select.
    Uses `withOrgTx` for sequence-number race safety.
11. Create `server/services/__tests__/agentRunMessageService.test.ts`
    (imports statically from `../agentRunMessageServicePure.js`).
12. Run `npm run db:generate` on the Drizzle schema changes; diff the
    generated output against the hand-written migration to confirm
    they match. Fix any drift.
13. Run `npm run build:server && npm run test:unit && GUARD_BASELINE=true bash scripts/run-all-gates.sh`.
    The `verify-rls-coverage` gate should accept the new manifest entry
    because the migration has matching `CREATE POLICY` + `ENABLE ROW
    LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` statements.

### Chunk E — P2.1 (Sprint 3A) serialise/deserialise pure helpers

1. Add `serialiseMiddlewareContext` and `deserialiseMiddlewareContext`
   to `server/services/agentExecutionServicePure.ts`.
2. Add `buildResumeContext(checkpoint, runMetadata)` to the same file.
3. Create `serialiseMiddlewareContext.test.ts` and
   `buildResumeContext.test.ts` in `server/services/__tests__/`.
4. Run verification.

### Chunk F — P2.1 (Sprint 3A) checkpoint write path

1. In `runAgenticLoop` (inside `agentExecutionService.ts`), add the
   `configVersion` hash computation at the top of the function.
2. Instrument the two message-push points to ALSO call
   `agentRunMessageService.appendMessage` (assistant message after the
   LLM response; tool-results user message after the inner tool loop).
   The in-memory array is unchanged.
3. Add `persistCheckpoint` as a private helper that does an upsert
   into `agent_run_snapshots` keyed on `runId`. It takes a
   `SerialisableMiddlewareContext` and builds the full
   `AgentRunCheckpoint` payload.
4. Call `persistCheckpoint` after the inner tool loop completes in
   each iteration (3A: once per iteration, not per tool call). The
   call site is right after the `messages.push(tagIteration(...))` at
   ~line 1608, before `iterationSpan.end(...)`.
5. Run verification.

### Chunk G — P2.1 (Sprint 3A) resume read path + projection

1. Create `server/services/toolCallsLogProjectionServicePure.ts` with
   `projectToolCallsLog(messages)`.
2. Create `server/services/toolCallsLogProjectionService.ts` with
   `project(runId)`.
3. Create `toolCallsLogProjection.test.ts` under `__tests__/`.
4. Add a call to `toolCallsLogProjectionService.project(runId)` at the
   run-completion hook in `agentExecutionService.ts`.
5. Add `resumeAgentRun(runId, { useLatestConfig = false })` as a new
   exported function. Loads the run row, loads the checkpoint, asserts
   `hash(configSnapshot) === checkpoint.configVersion`, streams
   messages up to `messageCursor`, rehydrates `mwCtx`, calls
   `runAgenticLoop` with `startingIteration: checkpoint.iteration + 1`.
   **Not wired to any HTTP route or pg-boss job in 3A.** It is a
   library function only.
6. Add a `startingIteration` parameter to `runAgenticLoop` with default
   0. The existing outer-loop `for` becomes
   `for (let iteration = startingIteration; ...)`.
7. Run verification.

### Chunk H — Agent-run-cleanup cron

1. Add `'agent-run-cleanup'` to `server/config/jobConfig.ts`.
2. Create `server/jobs/agentRunCleanupJobPure.ts` with
   `computeCutoffDate` and `resolveRetentionDays`.
3. Create `server/jobs/agentRunCleanupJob.ts` following the
   `regressionReplayJob.ts` shape: `withAdminConnection` + `SET LOCAL
   ROLE admin_role`.
4. Register the worker with daily cron `0 3 * * *`.
5. Create `agentRunCleanupJobPure.test.ts` under `__tests__/`.
6. Run verification.

### Chunk I — Final verification + reviewer passes

1. `npm run lint` — must pass.
2. `npm run typecheck` — client + server must pass.
3. `npm run build:server` — must pass.
4. `npm run test:unit` — all pure tests green.
5. `GUARD_BASELINE=true bash scripts/run-all-gates.sh` — 21
   pre-existing blocking failures still present, zero new regressions,
   new Sprint 3 gates all at baseline 0.
6. `pr-reviewer: review the Sprint 3 changes` — address findings.
7. `dual-reviewer: Sprint 3 — reflection loop (sync), confidence
   scoring, P2.1 Sprint 3A append-only message log + checkpoint write
   path, agent-run-cleanup cron` — address findings.
8. Stop before creating the PR — the user commits explicitly.

## 4. Sprint 3 gates to add

Two new gates. Both start at baseline 0 — the code they enforce is being
introduced in the same commit, so a non-zero baseline is a red flag.

### 4.1 `scripts/verify-reflection-loop-wired.sh`

**What it enforces:**
- `server/services/middleware/index.ts` imports `reflectionLoopMiddleware`.
- `createDefaultPipeline()` registers `reflectionLoopMiddleware` inside the
  `postTool` array.
- `server/services/agentExecutionService.ts` contains at least one
  reference to `escalate_to_review` (the post-tool handler).

**Why a gate and not just a test:** the reflection loop is a cross-cutting
guardrail — if a future refactor removes it from the pipeline, there's no
runtime signal because the behaviour degrades silently (write_patch
without APPROVE simply works again). The gate structurally enforces the
wiring the same way `verify-job-idempotency-keys.sh` enforces job
declarations.

**Baseline in `guard-baselines.json`:** `"reflection-loop-wired": 0`.

**Wire-up in `scripts/run-all-gates.sh`:** add under a new
`# ── Sprint 3 gates ──` section at the bottom of the file:

```bash
# ── Sprint 3 (P2.1 + P2.2 + P2.3) gates ──
run_gate "$SCRIPT_DIR/verify-reflection-loop-wired.sh"
run_gate "$SCRIPT_DIR/verify-tool-intent-convention.sh"
```

### 4.2 `scripts/verify-tool-intent-convention.sh`

**What it enforces:**
- At least one agent master prompt template file (under
  `server/db/seeds/` or wherever master prompts are assembled — confirm
  during implementation) contains the literal string `tool_intent`
  accompanied by the keyword `confidence`.

**Why:** Slice A of P2.3 is a **prompt-level** convention the runtime
depends on. `extractToolIntentConfidence` returns `undefined` when no
`tool_intent` block is present, which silently disables the confidence
gate. If someone edits the master prompt and removes the convention
line, the feature breaks with no test failure. This gate catches that.

**Baseline:** `"tool-intent-convention": 0`.

### 4.3 RLS coverage for `agent_run_messages` — reuses the existing gate

**No new gate script.** `scripts/verify-rls-coverage.sh` already walks
`RLS_PROTECTED_TABLES` and greps migrations for matching `CREATE POLICY`
+ `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` statements.
Appending `agent_run_messages` to the manifest + shipping migration 0084
with the matching policy clauses satisfies the existing gate. The
`verify-checkpoint-rls-coverage.sh` gate from the brief is redundant and
is NOT created.

### 4.4 Gates explicitly deferred to Sprint 3B

- `scripts/verify-middleware-state-serialised.sh` — enforces that every
  field on `MiddlewareContext` has a matching field on
  `SerialisableMiddlewareContext` (or an `// ephemeral:` comment).
  Deferred because the only new runtime fields in 3A are the reflection
  state fields, which are already on `SerialisableMiddlewareContext`.
  Without the per-tool-call inner loop refactor landing in 3B, there's
  nothing that can drift in 3A.
- `scripts/verify-run-state-source-of-truth.sh` — enforces that no new
  code reads `agent_run_snapshots.toolCallsLog` directly except the
  allow-listed debug UI file. Deferred because 3A doesn't introduce any
  new readers of the messages or the log — the projection service
  writes the log, but nothing reads it yet in new code.
- `scripts/verify-policy-dsl-comparators.sh` — only relevant if the
  brief's policy DSL expansion ever ships. Not in Sprint 3.

## 5. Risks and sharp edges

Top risks, ordered by probability × impact. The first three are near-certain
to bite during implementation if not explicitly watched for.

### 5.1 `PostToolResult` contract widening breaks existing `postTool` call sites

**What:** extending `PostToolResult` from `{ action: 'continue'; content? } | { action: 'stop' }` to also include `inject_message` and `escalate_to_review` is a discriminated-union widening. The existing post-tool loop in `runAgenticLoop` uses two `if` statements (`if (postResult.action === 'stop')` and `if (postResult.content)`). That pattern does NOT error on new union members — it silently drops them. New handlers must be added explicitly.

**Mitigation:** after widening the type, change the post-tool loop to a `switch (postResult.action)` with an `exhaustive default: never` check. TypeScript will then fail compilation until every variant is handled. Do this as the first step of Chunk B.7. Do not rely on the existing `if` chain.

**Secondary:** there is only one `postTool` middleware today (the list is empty). The widening is low-risk on the consumer side because nothing else consumes it yet. But the gate pattern is what catches this for future middleware authors.

### 5.2 Pure-helper gate will reject any new `*.test.ts` without a sibling import

**What:** Sprint 2's `verify-pure-helper-convention.sh` requires every `*.test.ts` under `__tests__/` to import statically from a sibling module in the parent directory. Several Sprint 3 test files target services that genuinely touch the DB (`policyEngineService.getDecisionTimeGuidance`, `agentRunMessageService.appendMessage`, `toolCallsLogProjectionService.project`, `agentRunCleanupJob.runAgentRunCleanupTick`). If you write `agentRunMessageService.test.ts` that imports from `../agentRunMessageService.js` directly, the test must not touch the DB — which means it has almost nothing to test.

**Mitigation:** for every DB-touching service, extract the decision/shape logic into a pure sibling (`*ServicePure.ts` or `*JobPure.ts`) and test THAT. This is why the Files-to-touch table in Section 2 creates five new pure-helper files (`policyEngineServicePure.ts`, `agentRunMessageServicePure.ts`, `toolCallsLogProjectionServicePure.ts`, `agentRunCleanupJobPure.ts`, and the existing `agentExecutionServicePure.ts` gains new functions). Do not attempt to use the `guard-ignore-file` escape hatch unless the test genuinely requires dynamic imports for the `DATABASE_URL`-not-set skip path — that hatch is only sanctioned for integration tests.

### 5.3 `verify-rls-coverage.sh` requires FORCE ROW LEVEL SECURITY — easy to miss

**What:** the existing gate checks for three clauses per table: `CREATE POLICY ... ON <table>`, `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY`, and `ALTER TABLE <table> FORCE ROW LEVEL SECURITY`. The spec's P2.1 SQL block in §P2.1 shows only `ENABLE`, not `FORCE`. If you copy the spec verbatim into migration 0084, the gate will fail with `Migration 0084 does not FORCE ROW LEVEL SECURITY on table 'agent_run_messages'`.

**Mitigation:** copy the 0083 (`regression_cases`) migration as the template, not the spec's SQL block. The 0083 migration has all three clauses and has already passed the gate. This is a mechanical lift — the only edits are the table name, columns, and policy name.

### 5.4 Sequence number race in `agent_run_messages`

**What:** the spec requires a monotonic `sequence_number` per `run_id` with a unique index on `(run_id, sequence_number)`. The naive implementation is `SELECT max(sequence_number) + 1 FROM agent_run_messages WHERE run_id = ?` → INSERT. That's a classic race: two concurrent writers on the same run will both read the same max and both write the same next sequence. The unique index catches it but the loser throws and the caller has to retry.

**Mitigation:** in 3A there is only ONE writer per run (the agent loop is single-process per run — crashes aside). The race is not genuinely possible today. But `resumeAgentRun` (also 3A) could theoretically race with a still-alive loop if the resume was triggered prematurely. Protect against this in one of two ways:
- **Option A:** run the `max(sequence_number) + 1` + INSERT inside a `withOrgTx` with `SELECT ... FOR UPDATE` on a sentinel row in `agent_runs`. Simple and correct.
- **Option B:** add a `nextSequenceNumber` integer column to `agent_runs` and increment it atomically via `UPDATE ... SET next_sequence_number = next_sequence_number + 1 RETURNING next_sequence_number`. Cheaper but requires a schema change not in the 3A scope.

**Decision:** use Option A. Put the logic in `agentRunMessageService.appendMessage` and make it the only supported entry point. Document the transaction requirement in the service header.

### 5.5 `configVersion` hash drift between write and read

**What:** the checkpoint stores `configVersion: string` as a hash of `agent_runs.configSnapshot`. On resume, we assert `hash(configSnapshot) === checkpoint.configVersion`. If the hash algorithm isn't deterministic (e.g. `JSON.stringify` over an object with non-deterministic key order), resume will falsely refuse. The regression-capture service from Sprint 2 already solved this problem with `fingerprint(...)` in `server/services/regressionCaptureServicePure.ts` — use that, or extract a shared `canonicalHash(jsonb)` helper.

**Mitigation:** import `fingerprint` from `regressionCaptureServicePure` at the top of `agentExecutionService.ts` and use it directly. Do NOT roll a new hash function. If the shape doesn't fit, extract a shared pure helper `shared/iee/canonicalHash.ts` in Chunk D and update both call sites.

### 5.6 `toolCallsLog` deprecation during the transition

**What:** the spec says `agent_run_messages` becomes the authoritative source, `toolCallsLog` becomes a derived projection written at run completion. But the existing run-detail UI reads `toolCallsLog` directly. Until the UI migrates, breaking that column = broken UI. The Sprint 3B gate `verify-run-state-source-of-truth.sh` exists to prevent new readers; but 3A doesn't have that gate yet.

**Mitigation:** in 3A, `toolCallsLog` is still written by `toolCallsLogProjectionService.project` at run completion. The existing inline writes to `toolCallsLog` during the loop are **NOT removed** in 3A — they stay as a fallback so any code path that bypasses the new write path (e.g. an error path) still populates the log. The projection at run completion is additive on top. This is wasteful in the happy path but guarantees backward compatibility. Sprint 3B can clean up the inline writes once the gate is in place.

### 5.7 Admin-bypass sweep in the cleanup cron must NOT leak across orgs

**What:** `withAdminConnection` + `SET LOCAL ROLE admin_role` means the cleanup cron can see every org. If the `DELETE FROM agent_runs WHERE ...` loses its `created_at < cutoff` clause due to a typo, it will delete every terminal run in the platform.

**Mitigation:** the pure helper `computeCutoffDate` makes the date calculation testable in isolation. The SQL delete should parameterise the cutoff date — never string-interpolate. Use Drizzle's `lt(agentRuns.createdAt, cutoffDate)` rather than raw SQL. Add a test that asserts the cutoff date is ALWAYS in the past (never `now` or `now + 1 day`) and reject a zero or negative `retentionDays` value explicitly.

### 5.8 Documentation drift — the spec and this plan must stay in sync

**What:** this plan diverges from the spec in three ways (P2.1 split into 3A/3B, P2.2 scope clarification, P2.3 slice interpretation). If the spec diff in Section 6 isn't applied in the same commit as the code, future sessions will read the stale spec and either re-do the work or build on top of a wrong assumption.

**Mitigation:** Chunk A in the build order is "apply the spec diff". It happens FIRST, before any code. The final verification in Chunk I must include a visual diff of `docs/improvements-roadmap-spec.md` to confirm the Section 6 changes landed.

## 6. Spec update diff

These edits are applied to `docs/improvements-roadmap-spec.md` in the same
commit as the Sprint 3 code. Each edit keeps the spec consistent with what
actually shipped. Line numbers are approximate — use the anchor text as
the source of truth.

### 6.1 P2.1 verdict — re-label as 3A/3B and flag the deferral

**Anchor:** `### Verdict` subsection under `## P2.1` (around line 1333).

**Old text (around lines 1333-1350):**

```markdown
### Verdict

**BUILD WHEN DEPENDENCY SHIPS (Sprint 3, after P1.1 lands in Sprint 2).**

Sequence: P1.1 Layer 1 (RLS migrations) ships in Sprint 2, then P2.1 ships in Sprint 3. The reason to wait is still valid — checkpoints write into `agent_run_snapshots`, which P1.1 Layer 1 adds an RLS policy to, so checkpointing must respect the `app.organisation_id` setting already in place. Starting P2.1 before P1.1 means writing the checkpoint path twice.

Once Sprint 2 lands, P2.1 is a single-sprint item:

1. Migration 0084 adds ...
```

**New text:**

```markdown
### Verdict

**BUILD ACROSS SPRINTS 3A AND 3B (after P1.1 lands in Sprint 2).**

The original single-sprint verdict underestimated the refactor surface.
P2.1 is split into two phases that ship in separate sessions:

**Sprint 3A (ships in Sprint 3 with P2.2 and P2.3):**

1. Migration 0084 creates `agent_run_messages` with its RLS policy in the
   same SQL file, adds `checkpoint jsonb` to `agent_run_snapshots`, and
   adds `run_retention_days integer` to `organisations`.
2. `agentRunMessageService` — append-only write path. Messages from the
   agent loop are mirrored to the new table.
3. `SerialisableMiddlewareContext` + `AgentRunCheckpoint` types declared
   in `server/services/middleware/types.ts`. `serialiseMiddlewareContext`
   / `deserialiseMiddlewareContext` / `buildResumeContext` shipped as
   pure helpers in `agentExecutionServicePure.ts`.
4. `persistCheckpoint()` writes once per iteration (NOT per tool call —
   see 3B) from inside `runAgenticLoop`. The write path is additive;
   existing runs that are not aware of the checkpoint still work.
5. `resumeAgentRun(runId)` ships as a library function that reads the
   checkpoint, streams messages up to `messageCursor`, rehydrates `mwCtx`,
   and resumes `runAgenticLoop` with `startingIteration = checkpoint.iteration + 1`.
   Config-snapshot enforcement via `hash(configSnapshot) === checkpoint.configVersion`.
6. `toolCallsLogProjectionService` writes the deprecated `toolCallsLog`
   column at run completion for backward-compat debug UI reads.
7. `agent-run-cleanup` pg-boss cron shipped alongside (Tier 3 maintenance,
   `idempotencyStrategy: 'fifo'`, `withAdminConnection` + `SET LOCAL ROLE
   admin_role`). Uses `DEFAULT_RUN_RETENTION_DAYS = 90`.

**Sprint 3B (deferred to a follow-up session):**

1. Per-tool-call inner loop refactor: the `for (const toolCall of
   response.toolCalls)` loop becomes one-at-a-time with a checkpoint
   after each completed call, narrowing the race window described in
   the "Per-tool-call checkpoint rule" subsection above.
2. HITL refactor from `hitlService.awaitDecision` (blocking) to
   `hitlService.triggerResume` (enqueue-on-decide). New pg-boss job
   `agent-run-resume` with `singletonKey: 'run:${runId}'`.
3. `agentRunResumeProcessor` worker + `agent-run-resume` entry in
   `server/config/jobConfig.ts`.
4. New `awaiting_review` status on `agent_runs`. Admin-only endpoint
   `POST /api/agent-runs/:id/resume?useLatestConfig=true` with audit
   event on the override path.
5. `MIDDLEWARE_CONTEXT_VERSION` forward-compat guard — on resume,
   refuse if checkpoint version is newer than runtime.
6. Two new gates ship in Sprint 3B:
   - `scripts/verify-middleware-state-serialised.sh` enforces that every
     runtime `MiddlewareContext` field has a matching serialised field
     (or an `// ephemeral:` comment).
   - `scripts/verify-run-state-source-of-truth.sh` fails CI when new code
     reads `agent_run_snapshots.toolCallsLog` outside the allow-listed
     debug UI file.
7. Integration test I2 (`agentRun.crash-resume-parity.test.ts`) —
   kill-point matrix, config-snapshot enforcement, HITL async resume.

**Trade-off acknowledged in 3A:** a process crash mid-iteration (tool N of
M in a multi-tool LLM response) causes resume to replay from tool 1 of
the same iteration, not from tool N+1. This is weaker than the final
per-tool-call rule but strictly better than today (where a crash means
total run loss). Pre-production means no live users are exposed to the
difference.

**The old `AGENT_RUN_CHECKPOINTING_ENABLED` feature flag is deleted from the plan.** The new behaviour ships enabled.
```

### 6.2 P2.2 verdict — strike the ambiguous "capability vs wiring" phrasing

**Anchor:** `### Verdict` subsection under `## P2.2` (around line 1467).

**Old text:**

```markdown
All pieces ship together — the split between "capability" and "wiring" from the previous verdict is retired.
```

**New text:**

```markdown
All pieces ship together as a single synchronous `postTool` middleware. The
middleware is the ONLY mechanism P2.2 adds — there is no asynchronous
"reflection-tick" job, no separate service that runs on review rejection,
and no delayed learning loop. If those features are wanted later, they ship
as a distinct roadmap item, not as P2.2. The split between "capability" and
"wiring" from the previous verdict is retired.
```

**Rationale:** the Sprint 3-5 handoff brief describes an async reflection
loop that does not match this goal. Pinning the spec to the synchronous
guardrail prevents the ambiguity from propagating.

### 6.3 P2.3 verdict — clarify which slice set this is

**Anchor:** the opening line of `### Verdict` under `## P2.3` (around line 1592).

**Old text:**

```markdown
**BUILD IN SPRINT 3.**

Ships in Sprint 3 alongside P2.1 and P2.2. All three slices land together:

1. **Slice A** (`tool_intent` convention ...
```

**New text:**

```markdown
**BUILD IN SPRINT 3.**

P2.3 in this spec is specifically the confidence-scoring + decision-time
guidance feature set. It is NOT the policy DSL expansion (any_of / all_of /
numeric comparators / time predicates) that is sometimes conflated with
this item — that work does not ship in Sprint 3 and is not tracked in this
spec. If DSL expansion is wanted, a separate roadmap item must be opened.

Ships in Sprint 3 alongside P2.1 and P2.2. All three slices land together:

1. **Slice A** (`tool_intent` convention ...
```

### 6.4 Add a Sprint 3A/3B split summary note to the top of `## P2.1`

**Anchor:** the first line under `## P2.1` (around line 976).

**Old text:**

```markdown
## P2.1 — Agent run checkpoint + resume parity with Playbooks

### Goal
```

**New text:**

```markdown
## P2.1 — Agent run checkpoint + resume parity with Playbooks

> **Sprint 3 execution note (2026-04-09):** this item is split into Sprint
> 3A (append-only message log, lightweight checkpoint write path, resume
> library function, config-snapshot enforcement, `agent-run-cleanup` cron)
> and Sprint 3B (per-tool-call inner loop refactor, HITL async resume,
> `agent-run-resume` job, `awaiting_review` status, admin resume endpoint,
> two forward-compat gates, integration test I2). The design below is the
> end state after both phases ship. See the Verdict subsection for the
> phase boundary. See `tasks/sprint-3-plan.md` §1.3 for the architect-level
> reconciliation decision.

### Goal
```

### 6.5 Retention and pruning — update the cross-cutting table to reference Sprint 3A

If the spec has a "Retention and pruning policies" cross-cutting section
(search for `agent-run-cleanup` or `run_retention_days`), update the
`agent_run_cleanup` row to cite migration 0084 (Sprint 3A) and
`server/jobs/agentRunCleanupJob.ts` (also Sprint 3A). If no such section
exists or the row is already correct, skip this sub-edit.

### 6.6 Apply-step mechanics

Apply these edits via `Edit` (not `Write`) to `docs/improvements-roadmap-spec.md`.
Run `diff` against the original before committing to confirm only the
anchored blocks changed. The spec is long — a failed edit anywhere else is
a bug.

## 7. Out-of-scope explicit list

These items are intentionally NOT shipped this session. Each has a one-line
rationale so future sessions understand why.

### Deferred to Sprint 3B (a follow-up session, same spec item)

1. **Per-tool-call inner loop refactor** — `for (const toolCall of response.toolCalls)` becomes one-at-a-time with a checkpoint after each. *Reason: hot-path behaviour change that needs its own architect pass + integration tests; 3A ships the prerequisite schema so 3B is a pure refactor.*
2. **HITL async resume refactor** — `hitlService.awaitDecision` becomes `hitlService.triggerResume` + new `agent-run-resume` pg-boss job. *Reason: touches the HITL path end-to-end (hitlService, reviewItems API, agent run status enum, worker registration) and is a genuinely different feature from the reflection loop escalation.*
3. **`agentRunResumeProcessor` worker** — pg-boss handler for the new resume job. *Reason: coupled to item 2.*
4. **`awaiting_review` status + admin resume endpoint** — new run status value, `POST /api/agent-runs/:id/resume?useLatestConfig=true`. *Reason: coupled to items 2–3. The reflection loop escalation path in 3A uses the existing "run ends, review item created" flow and does not need a new status until the async refactor lands.*
5. **`MIDDLEWARE_CONTEXT_VERSION` forward-compat enforcement** — runtime check on resume. *Reason: pre-production, no in-flight runs to protect, no downside to shipping the version field without the runtime check.*
6. **`scripts/verify-middleware-state-serialised.sh` gate** — structural parallel between `MiddlewareContext` and `SerialisableMiddlewareContext`. *Reason: only meaningful once 3B adds more middlewares that need serialisation; 3A's reflection-state fields are already pre-declared.*
7. **`scripts/verify-run-state-source-of-truth.sh` gate** — fails CI when new code reads `toolCallsLog` directly. *Reason: 3A ships zero new readers of the log.*
8. **Integration test I2 (`agentRun.crash-resume-parity.test.ts`)** — kill-point matrix + HITL async parity. *Reason: spec-context.md says `runtime_tests: pure_function_only` — integration tests of this shape are not a supported test category in pre-production. The crash-resume behaviour is covered at the pure-helper level (`serialiseMiddlewareContext.test.ts`, `buildResumeContext.test.ts`).*

### Not in Sprint 3 at all (moved to a future roadmap item or explicitly rejected)

9. **Policy DSL expansion (any_of / all_of / numeric comparators / time predicates)** — the brief's P2.3 slices A/B/C. *Reason: the spec's P2.3 is confidence scoring + decision-time guidance, not DSL expansion. The DSL work is genuinely useful and may become a future sprint item; for now it is not on any roadmap and must be specced separately.*
10. **Async reflection-on-rejection learning loop** — the brief's P2.2 (`reflection-tick` job enqueued on HITL rejection). *Reason: this is a different feature from the spec's guardrail. If learning from rejection is wanted, it belongs in a cost-governance or observability sprint, not as P2.2.*
11. **Refactor of the 31 direct-`db` imports from `rls-contract-compliance` baseline** — `rls-contract-compliance` baseline stays at 31. *Reason: explicitly deferred to Sprint 5 P4.* in the handoff brief's §6 gotchas list. Touching them during Sprint 3 balloons the PR.*
12. **Frontend changes** — no React / client changes. *Reason: P2.1 Sprint 3A, P2.2, P2.3 are all server-side. The run detail UI continues to read `toolCallsLog` which is still populated. The existing HITL review UI is unchanged.*
13. **Removing the inline `toolCallsLog` writes from `runAgenticLoop`** — they stay, the projection service layers on top additively. *Reason: deprecation is a 3B concern once the `verify-run-state-source-of-truth.sh` gate exists; removing inline writes in 3A creates a single-source-of-truth question with no guardrail.*
14. **Any new RLS-protected tables beyond `agent_run_messages`** — no other new tenant-owned tables ship in Sprint 3. *Reason: P2.3's `policy_rules` additions are columns on an existing table and the table is not currently RLS-protected (verify in `rlsProtectedTables.ts` before committing).*
15. **Performance baselines / benchmarks for the new message write path** — no perf tests. *Reason: spec-context.md says `performance_baselines: defer_until_production`.*
16. **Vitest / Jest / Playwright / supertest** — none of these. *Reason: spec-context.md `convention_rejections` list — the pure-helper + tsx runner convention is the only sanctioned test infrastructure.*
17. **Feature flags for any of the new behaviours** — none. *Reason: `rollout_model: commit_and_revert`; the reflection middleware, confidence gate, and message append path all ship enabled.*

---

## Appendix — Open questions that need answers BEFORE implementation starts

These are not architectural blockers — they can be answered in 30 seconds by
grep — but they must be resolved at the start of each chunk, not during the
reviewer pass.

1. **Where is the agent master prompt assembled?** Need to confirm the exact
   file(s) for the `tool_intent` convention insertion (Chunk C.11) and the
   `verify-tool-intent-convention.sh` gate path. Search: `masterPrompt`
   assembly in `server/services/`.
2. **How is `configSnapshot` currently hashed for the idempotency key?**
   Chunk D.5 uses `fingerprint` from `regressionCaptureServicePure`; confirm
   the function signature accepts a plain jsonb object or needs pre-shaping.
3. **Where is pg-boss worker registration?** Chunk H.4 needs to add the
   daily cron — confirm the file (`server/workers/index.ts` or similar).
   Follow the pattern used by `regressionReplayJob` registration.
4. **Does `withOrgTx` exist as the org-scoped transaction helper?** Chunk
   D.10 relies on it. Search: `export function withOrgTx` in
   `server/db/`. If it doesn't exist by that name, find the equivalent.
5. **Is `proposeActionMiddleware` the right extraction point for
   `extractToolIntentConfidence`?** Chunk C.8 assumes yes. Confirm the
   middleware currently has access to the conversation history via
   `mwCtx` or the tool-call context. If not, plumb `messages` into the
   preTool middleware signature (a small contract widening that needs to
   be made explicit in `PreToolMiddleware`).

---

*End of Sprint 3 Implementation Plan.*
