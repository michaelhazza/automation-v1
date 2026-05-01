# Spec Conformance Log — Tier 1 UI Uplift

**Spec:** `tasks/brief-tier-1-ui-uplift.md` (brief is the spec; `tasks/builds/tier-1-ui-uplift/plan.md` operationalises it as builder contracts)
**Spec commit at check:** `5c646982` (HEAD on `claude/improve-ui-design-2F5Mg`)
**Branch:** `claude/improve-ui-design-2F5Mg`
**Base:** merge-base with `main`
**Scope:** ALL chunks A through E (caller confirmed all-of-spec coverage; implementation is end-of-feature, not mid-build)
**Changed-code set:** 51 committed files + 2 uncommitted (`DEVELOPMENT_GUIDELINES.md`, `client/src/pages/AdminAgentEditPage.tsx`); ~7,181 net additions
**Run at:** 2026-04-30T10:51:32Z
**Commit at finish:** `072ace20`

---

## Contents

1. Summary
2. Requirements extracted (full checklist by chunk)
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Next step

---

## Summary

| Verdict | Count |
|---|---|
| Requirements extracted | 73 |
| PASS | 60 |
| MECHANICAL_GAP → fixed | 0 |
| DIRECTIONAL_GAP → deferred | 13 |
| AMBIGUOUS → deferred | 0 |
| OUT_OF_SCOPE → skipped | 0 |

> AMBIGUOUS findings are reported separately for diagnostic visibility — none in this run; conservative classification combined directional ambiguity into DIRECTIONAL.

**Verdict:** **NON_CONFORMANT** — 13 directional gaps identified across all five chunks; all routed to `tasks/todo.md`. The implementation has substantive divergences from the plan in cost-rollup approach (Chunk B), Thread Context plumbing (Chunk A→E interaction), and Chunk E's `integrationBlockService` ships as a non-functional stub.

---

## Requirements extracted (full checklist by chunk)

### Chunk B — Cost meter

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| B1 | Endpoint `GET /api/agents/:agentId/conversations/:convId/cost` registered | PASS | `server/routes/agents.ts:228` |
| B2 | `conversationCostService.getConversationCost` exists | PASS | `server/services/conversationCostService.ts:24` |
| B3 | Canonical I-5 SQL: `SELECT DISTINCT triggered_run_id` JOIN `cost_aggregates` | DIRECTIONAL | Implementation queries `agent_messages.cost_cents` directly; bypasses both `triggered_run_id` and `cost_aggregates`. See B-D1. |
| B4 | Response shape: `runCount`, `totalCostCents`, `totalTokensIn/Out`, `totalTokens`, `modelBreakdown[]`, `computedAt` | DIRECTIONAL | Field renamed to `messageCount`; `runCount` field absent. See B-D2. |
| B5 | `modelBreakdown` sorted by `costCents` DESC | PASS | `conversationCostService.ts:83` |
| B6 | `formatCost.ts` with `formatCostCents` + `formatTokenCount` | PASS | `client/src/lib/formatCost.ts` |
| B7 | `CostMeterPill.tsx` renders pill + dropdown | PASS | `client/src/components/CostMeterPill.tsx` |
| B8 | Pill placed in `AgentChatPage` header next to model id | PASS | `client/src/pages/AgentChatPage.tsx:441` |
| B9 | Refetch on `conversation:message` socket event | PASS | `client/src/pages/AgentChatPage.tsx:286` |
| B10 | Structured log `conversation_cost_computed` | PASS | `conversationCostService.ts:102` |
| B11 | Permission: 403 when conversation owned by another user (non-admin) | PASS | `conversationCostService.ts:49-51` |
| B12 | 404 when conversation not found | PASS | `conversationCostService.ts:44-46` |
| B13 | LLM prompt teaches the closed enum format (Chunk C cross-ref) | PASS | `server/services/conversationService.ts:235` |

### Chunk C — Suggested next-action chips

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| C1 | Migration 0263 adds `suggested_actions JSONB NULL` to `agent_messages` | PASS | `migrations/0263_message_suggested_actions.sql` |
| C2 | Drizzle schema declares `suggestedActions` column | PASS | `server/db/schema/agentMessages.ts:38` |
| C3 | `SUGGESTED_ACTION_KEYS` closed enum: `save_thread_as_agent` / `schedule_daily` / `pin_skill` | PASS | `shared/types/messageSuggestedActions.ts:3` |
| C4 | Discriminated union schema with `kind: prompt | system` | PASS | `shared/types/messageSuggestedActions.ts:6` |
| C5 | Max 4 chips enforced | PASS | `messageSuggestedActions.ts:21,85` |
| C6 | `parseSuggestedActions` drops unknown keys with structured warn-log | PASS | `messageSuggestedActions.ts:76` |
| C7 | Block-stripping regex extracts `<suggested_actions>` from message tail | PASS | `messageSuggestedActions.ts:23,42` |
| C8 | `suggestedActionDispatchService` maps key → handler | PASS | `server/services/suggestedActionDispatchService.ts` |
| C9 | Dispatch route `POST /api/agents/:agentId/conversations/:convId/messages/:messageId/dispatch-action` mounted | PASS | `server/routes/suggestedActions.ts:21`, `server/index.ts:380` |
| C10 | `SuggestedActionChips.tsx` renders chips on most recent assistant message only; prompt fill (no auto-send), system POSTs to dispatch with pending/done/error states | PASS | `client/src/components/SuggestedActionChips.tsx`, `AgentChatPage.tsx:670-686` |
| C11 | Permission check at dispatch time | PASS | `server/routes/suggestedActions.ts:23,37-52` |

### Chunk A — Thread Context

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| A1 | Migration 0264 creates `conversation_thread_context` with FK + RLS | PASS-with-issue | `migrations/0264_conversation_thread_context.sql`. RLS uses single combined `USING` clause without separate `WITH CHECK`. See A-D3. |
| A2 | `RLS_PROTECTED_TABLES` manifest entry | PASS | `server/config/rlsProtectedTables.ts:919` |
| A3 | Drizzle schema with `decisions/tasks/approach/version/createdAt/updatedAt` | PASS | `server/db/schema/conversationThreadContext.ts` |
| A4 | Shared types: `ThreadContextDecision`, `ThreadContextTask`, `ThreadContextPatch`, `ThreadContextReadModel` | PASS | `shared/types/conversationThreadContext.ts` |
| A5 | `update_thread_context` registered in `ACTION_REGISTRY` with `keyed_write` strategy | PASS | `server/config/actionRegistry.ts:2889` |
| A6 | `update_thread_context` handler registered in `SKILL_HANDLERS` | PASS | `server/services/skillExecutor.ts:1882` (added in commit 5c646982) |
| A7 | Patch-op semantics (add/update/remove/replace per section) | PASS | `server/services/conversationThreadContextServicePure.ts` |
| A8 | Server-generated IDs returned via `createdIds` map | PASS | `conversationThreadContextService.ts:271-275` |
| A9 | Caps: 50 tasks, 100 decisions, 10000 chars approach | PASS | `actionRegistry.ts` Zod max(); pure-test coverage |
| A10 | Pruning: oldest-completedAt removed when task cap exceeded | PASS | unit test `conversationThreadContextServicePure.test.ts` |
| A11 | Idempotency keyed_write `${runId}:${sha256(normalizePatch)}`; cache size cap | PASS | `conversationThreadContextService.ts:96-104, 277-285` |
| A12 | `buildThreadContextReadModel` produces canonical projection | PASS | `conversationThreadContextService.ts:62` |
| A13 | Read route `GET /api/agents/:agentId/conversations/:convId/thread-context` returning empty on missing | PASS | `server/routes/conversationThreadContext.ts` |
| A14 | Live update via `conversation:thread_context_updated` socket event | PASS | `conversationThreadContextService.ts:265`, `AgentChatPage.tsx:294` |
| A15 | `ThreadContextPanel.tsx` renders Tasks/Approach/Decisions; completed-above-pending; isLive pulse | PASS | `client/src/components/ThreadContextPanel.tsx` |
| A16 | `agentExecutionService` injects read model at run start AND captures `runMetadata.threadContextVersionAtStart` | DIRECTIONAL | No `buildThreadContextReadModel` call in `agentExecutionService.ts`; no `threadContextVersionAtStart` write. See A-D1. |
| A17 | Optimistic-concurrency UPDATE predicate `WHERE id = ? AND version = ?` | DIRECTIONAL | Implementation uses plain UPDATE-by-id; race-retry path applies patch but not via versioned predicate. See A-D2. |
| A18 | Structured log `thread_context_patched` with `{ conversationId, runId, version, opsApplied, action }` | PASS | `conversationThreadContextService.ts:246` |
| A19 | Approach cap rejection logs `approach_cap_rejected` | PASS | `conversationThreadContextService.ts:142` |
| A20 | No-op remove logs `thread_context_noop_remove` | PASS | `conversationThreadContextService.ts:255-262` |

### Chunk E — Inline integration card

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| E1 | New columns on `agent_runs`: `blocked_reason`, `blocked_expires_at`, `integration_resume_token`, `integration_dedup_key` | PASS | `migrations/0265_agent_run_blocked_state.sql`, `agentRuns.ts:198-201` |
| E2 | `status` enum NOT extended (parallel-column approach) | DIRECTIONAL | Schema added `'blocked_awaiting_integration'` to status union. `agentRuns.ts:92`, `agentExecutionService.ts:285,1375,2823`. See E-D1. |
| E3 | Partial index `agent_runs_blocked_expiry_idx` on `(blocked_expires_at)` WHERE `blocked_reason IS NOT NULL` | PASS | `migrations/0265_*.sql:11-13` |
| E4 | `meta` JSONB column on `agent_messages` for typed UI extensions | PASS | `migrations/0265_*.sql:16-17`, `agentMessages.ts:42` |
| E5 | `IntegrationCardContent` discriminated union variant with all required fields | PASS | `shared/types/integrationCardContent.ts` |
| E6 | `dismissed` is the only persisted card state; other states derived | DIRECTIONAL | `dismissed` is currently set in CLIENT-LOCAL state only — no PATCH endpoint persists it (TODO in `InlineIntegrationCard.tsx:54`). See E-D6. |
| E7 | `deriveCardState` computes active/dismissed/expired/connected from card + runMetadata | PASS | `integrationCardContent.ts:40-58` |
| E8 | `integrationBlockService.checkRequiredIntegration` decides block | DIRECTIONAL | Implementation is a stub returning `{ shouldBlock: false }` always. ACTION_REGISTRY-lookup logic is `TODO(v2)`. See E-D3. |
| E9 | 32-byte plaintext token via `crypto.randomBytes(32).toString('hex')`; SHA-256 stored in DB | PASS | `integrationBlockService.ts:106-107`, `agentResumeService.ts:51` |
| E10 | `integration_dedup_key = sha256(toolName + runId + blockSequence)` | PASS | `integrationBlockService.ts:110-113` |
| E11 | `agentResumeService.resumeFromIntegrationConnect` with optimistic predicate UPDATE | PASS | `server/services/agentResumeService.ts:85-105` |
| E12 | Idempotent already-resumed path validates BOTH token hash AND blockSequence | DIRECTIONAL | Only `lastResumeTokenHash` checked (line 78); `lastResumeBlockSequence` write happens but is not validated against the submitted token's blockSequence. See E-D2. |
| E13 | OAuth callback decodes `state.resumeToken` and triggers resume server-side | PASS | `server/routes/oauthIntegrations.ts:273-296` |
| E14 | OAuth callback decodes `state.conversationId` and forwards to resume service | DIRECTIONAL | `payload.conversationId` is destructured into the cast type but not passed to `resumeFromIntegrationConnect`. See E-D5. |
| E15 | `POST /api/agent-runs/resume-from-integration` route mounted | PASS | `server/routes/agentRuns.ts:496` |
| E16 | `BlockedRunExpiryJob` recurring every 5 minutes; cancels expired blocked runs | PASS | `server/jobs/blockedRunExpiryJob.ts`, `queueService.ts:799-814,1099` |
| E17 | TTL expiry cancels run with `runMetadata.cancelReason: 'integration_connect_timeout'` | PASS | `blockedRunExpiryJob.ts:54` |
| E18 | `useOAuthPopup` hook with popup-blocker fallback | PASS | `client/src/hooks/useOAuthPopup.ts` |
| E19 | `InlineIntegrationCard.tsx` renders all 4 visual states + dismiss stub | PASS | `client/src/components/InlineIntegrationCard.tsx` |
| E20 | `tool_not_resumable` enforcement at block time for `unsafe` strategies | DIRECTIONAL | TODO in `integrationBlockService.ts:62-65`; not implemented. See E-D4. |
| E21 | Structured logs `run_blocked` / `run_resumed` / `run_blocked_expired` / `integration_card_emitted` | PASS | All four emit at `info` level with required fields (some carry empty `conversationId` due to no FK on `agent_runs.conversation_id`) |
| E22 | Re-inject `buildThreadContextReadModel` on resume (A+E interaction E-7) | DIRECTIONAL | Same root as A-D1 — `buildThreadContextReadModel` not called anywhere in `agentExecutionService.ts` or `agentResumeService.ts`. See A-D1. |

### Chunk D — Invocations card

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| D1 | `InvocationsCard.tsx` renders 6-tile grid (Scheduled, Webhook, Slack, Email, SMS, MCP) | PASS | `client/src/components/InvocationsCard.tsx:308-348` |
| D2 | `InvocationChannelTile.tsx` shared tile component | PASS | `client/src/components/InvocationChannelTile.tsx` |
| D3 | Click-to-expand accordion with existing config UI inline | PASS | `InvocationsCard.tsx:117-152, 354-657` |
| D4 | Scheduled tile hosts the existing heartbeat editor inline | PASS | `InvocationsCard.tsx:354-513` |
| D5 | Webhook tile hosts existing webhook config | PASS | `InvocationsCard.tsx:516-604` |
| D6 | Slack tile shows `Active · {n} channels` (channel-count source) | PASS | `InvocationsCard.tsx:202`, route `agents.ts:259-271` |
| D7 | Email tile shows existing email mailbox config inline | DIRECTIONAL | Email accordion shows static placeholder text, not the existing email config UI. See D-D1. |
| D8 | SMS / MCP rendered as disabled "Soon" stubs | PASS | `InvocationsCard.tsx:339-348, 640-657` |
| D9 | `AdminAgentEditPage.tsx` Scheduling tab uses InvocationsCard, removes scattered sections | PASS | uncommitted diff in `client/src/pages/AdminAgentEditPage.tsx:1407-1424` |
| D10 | `InvocationKind` type exported and referenced in tile component | PASS | `InvocationsCard.tsx:58` |

### Cross-cutting invariants (I-1 through I-7)

| # | Invariant | Verdict |
|---|---|---|
| I-1 | Thread Context single writer / DB-canonical | PASS (one writer via `update_thread_context` registered) but I-1 anchor at runtime injection is partially weakened by A-D1 (no run-start injection) |
| I-2 | Agent UI extensions are structured message metadata | PASS (`suggestedActions`, `meta` JSONB) |
| I-3 | LLM never emits raw action slugs | PASS (`SuggestedActionKey` enum closed; unknown dropped at parse) |
| I-4 | Resumable executions idempotent + versioned | PARTIAL — token-hash idempotency holds; blockSequence guard incomplete (E-D2) |
| I-5 | Cost aggregation deterministic + tied to scope | DIRECTIONAL — implementation deviates from canonical pattern (B-D1) |
| I-6 | Cross-boundary structured logs with `{conversationId, runId, state, action}` | PASS (some logs carry empty `conversationId` because `agent_runs` has no FK to conversation — known plan limitation, not a regression) |
| I-7 | Every assistant message participating in cost rollup carries `triggered_run_id` | DIRECTIONAL — `triggered_run_id` column does not exist on `agent_messages`; cost rollup uses different pivot (`cost_cents` directly). See B-D1. |

---

## Mechanical fixes applied

**None.** Every gap identified required a design decision (which approach to take), touched cross-cutting code that the plan describes as carefully calibrated, or required new logic not surgically derivable from the plan. Per the agent's "when in doubt, classify as directional" posture, all findings route to `tasks/todo.md`.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

13 directional findings, summarised below. See `tasks/todo.md` § *Deferred from spec-conformance review — tier-1-ui-uplift (2026-04-30)* for full action items.

| ID | Chunk | Gap | Severity |
|---|---|---|---|
| B-D1 | B | Cost rollup uses `agent_messages.cost_cents` directly instead of canonical I-5 `triggered_run_id` JOIN to `cost_aggregates` | High — divergence from named architectural invariant |
| B-D2 | B | `ConversationCostResponse.runCount` field replaced with `messageCount`; per-model `runCount` also missing | Medium — contract shape divergence |
| A-D1 | A | `buildThreadContextReadModel` not injected into agent prompt at run start; `runMetadata.threadContextVersionAtStart` not captured; resume re-injection (E-7) also missing | High — feature works for direct UI but LLM never sees thread context |
| A-D2 | A | Concurrency guard does NOT use `version = ?` predicate per plan §6.5 | Medium — silent lost-update class |
| A-D3 | A | Migration 0264 RLS policy may need separate `WITH CHECK` clause for full three-layer enforcement | Low — likely covered by Postgres default but plan §6.4 says three-layer |
| E-D1 | E | `agent_runs.status` extended with `'blocked_awaiting_integration'` despite plan E-1 explicitly rejecting this approach (parallel-column was chosen) | High — direct violation of an "explicit rejection" plan decision |
| E-D2 | E | Resume already-resumed path validates only `lastResumeTokenHash`; `lastResumeBlockSequence` not validated against incoming token's blockSequence (cross-block replay gap) | High — plan §7.5 condition (3) not enforced |
| E-D3 | E | `integrationBlockService.checkRequiredIntegration` is a stub returning `{ shouldBlock: false }` always; the entire integration-block feature does not fire | Critical — feature is wired but inert |
| E-D4 | E | `tool_not_resumable` enforcement for `unsafe` idempotency strategies not implemented | Medium — TODO comment present; would activate when E-D3 is filled in |
| E-D5 | E | OAuth callback decodes `payload.conversationId` from JWT state but does not pass it to `resumeFromIntegrationConnect` | Medium — same-user enforcement on resume not validated through this path |
| E-D6 | E | `dismissed` state is client-local only; no PATCH endpoint to persist dismissal across sessions | Medium — TODO in `InlineIntegrationCard.tsx:54` |
| D-D1 | D | Email tile renders placeholder text instead of inline email config UI | Low — may be acceptable if no per-agent email config currently exists; verify with PM |
| Cross-1 | A+E | Plan §11 named `triggered_run_id` write-layer enforcement as a deferred follow-up; the current design choice in B-D1 makes that follow-up moot but should be acknowledged in plan amendment | Medium — book-keeping for plan §11 |

---

## Files modified by this run

None. (Mechanical-fix count was 0; only the final log itself and `tasks/todo.md` are touched.)

---

## Next step

**NON_CONFORMANT** — 13 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` under *Deferred from spec-conformance review — tier-1-ui-uplift (2026-04-30)*.

Several gaps (B-D1, A-D1, E-D1, E-D3) reflect substantive architectural divergence from the plan, not surface bugs. Some may turn out to be **deliberate re-decisions made during implementation** that supersede the plan; the human-driven triage should:

1. For each gap, decide: keep as-is (and amend the plan) or close the gap (and align with the plan).
2. Document each decision in the build's `progress.md` so future work knows which plan section is the source of truth and which has been retired.
3. Re-run `spec-conformance` after triage to confirm closure or plan amendment.

`pr-reviewer` may proceed in parallel with triage to surface unrelated quality issues, but the directional findings here are the dominant conformance signal for this PR.
