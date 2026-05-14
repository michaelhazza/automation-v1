# Tier 1 UI Uplift — Progress

**Branch:** `claude/improve-ui-design-2F5Mg`
**Status:** REVIEWING — running review pipeline (spec-conformance → pr-reviewer → dual-reviewer)
**Last updated:** 2026-04-30

---

## Review pipeline state

### 1. spec-conformance — COMPLETE (2026-04-30)
- Verdict: **NON_CONFORMANT** — 13 directional gaps, 0 mechanical fixes auto-applied
- Log: `tasks/review-logs/spec-conformance-log-tier-1-ui-uplift-2026-04-30T10-51-32Z.md`
- Backlog: `tasks/todo.md § Deferred from spec-conformance review — tier-1-ui-uplift (2026-04-30)`
- Agent commit: `072ace20`

### 2. pr-reviewer — COMPLETE (2026-04-30)
- Verdict: **CHANGES_REQUESTED** — 5 blocking, 7 strong, 5 deferrable
- All 5 blocking fixed in working tree:
  - **#1+#2** `blockedRunExpiryJob` — restructured to `withAdminConnection` + `SET LOCAL ROLE admin_role`, gated each transition with `assertValidTransition` (kind=`agent_run`), predicate the UPDATE on observed status to prevent terminal-clobber races, emit `state_transition` log with `guarded: true`
  - **#3** `conversationCostService` — added `innerJoin(agentConversations)` + explicit `eq(agentConversations.organisationId, organisationId)` filter on the SUM query (defence-in-depth per §1)
  - **#4** `suggestedActionDispatchService` — fixed `logger.info('suggested_action_dispatched', {...})` signature (was passing object as first arg)
  - **#5** `InlineIntegrationCard` (5 buttons) + `CostMeterPill` (1 button) — added `type="button"` per §8.25 (the rule this PR added). Verified other new components (`InvocationsCard`, `InvocationChannelTile`, `SuggestedActionChips`) already had `type="button"`.
- 3/7 strong fixed:
  - **#7** `appendNote` cap — added `.max(10000)` to action registry schema
  - **#10** resume-route token regex — mirrored `/^[a-f0-9]{64}$/` validation from OAuth callback path
  - **#11** `agentResumeService` transaction wrap — both UPDATE statements now run inside `db.transaction(...)` so they are atomic
- 4/7 strong deferred (out of scope for this session — substantive work):
  - **#6** `integration_dedup_key` SELECT-before-block dedup — substantive new logic in `agentExecutionService` block path; route to backlog
  - **#8** routes import `db` directly — pre-existing pattern in `conversationThreadContext` and `suggestedActions` routes; needs services-refactor (a separate PR's worth of work). Same pattern in `agentRuns` route was already present before this PR. CI gate `verify-rls-contract-compliance.sh` may flag.
  - **#9** `parseSuggestedActions` `console.warn` — file lives in `shared/` so cannot import server logger; the cleaner refactor (drop log, surface `dropped` count) is a separate change
  - **#12** missing pure unit test for resume idempotency — add as follow-up
- 5/5 deferrable routed to backlog (none fixed this session)

### 3. dual-reviewer — COMPLETE (2026-04-30)
- Verdict: **APPROVED** — clean adversarial pass, zero findings on iteration 1 / 3
- Codex explicitly verified the four hot-spot areas: rewritten `blockedRunExpiryJob`, transaction-wrapped `agentResumeService`, `conversationThreadContextService` retry-on-conflict path (pulled in `*Pure.ts` companion to verify `applyPatchToPureState` semantics on retry), and `conversationCostService` JOIN.
- Quote: "I did not identify any discrete regressions introduced by the current staged, unstaged, or untracked changes. The changes appear consistent with the surrounding code and existing contracts."
- Log: `tasks/review-logs/dual-review-log-tier-1-ui-uplift-2026-04-30T11-29-24Z.md`
- No commits created (zero-changes empty-commit guard).

---

## Backlog routing for unfixed pr-reviewer findings

| ID | Finding | Recommendation |
|---|---|---|
| pr-#6 | `integration_dedup_key` is dead-weight (written, never queried) — dedup is a no-op | Add SELECT-before-block check in `agentExecutionService.ts:2775` block path |
| pr-#8 | Routes (`conversationThreadContext`, `suggestedActions`, also pre-existing `agentRuns`) import `db` directly | Refactor to call services. Will need `conversationOwnershipService.assertOwnership()` helper. Likely surfaced by CI gate. |
| pr-#9 | `parseSuggestedActions` uses `console.warn` not structured logger | Refactor: drop logging from shared/, surface `dropped` count via return value, log at caller |
| pr-#12 | Missing pure unit test for resume already-resumed path | Author `server/services/__tests__/agentResumeService.test.ts` covering token-hash idempotency + token-mismatch 410 |
| pr-#13 | Idempotency cache key includes patch SHA but not `conversationId` (defensive) | Include `conversationId` in cache key |
| pr-#14 | `popup.status === 'success'` never auto-resets — stale "Connected!" banner | Auto-reset to `idle` after 5s, or unmount on next assistant message |
| pr-#15 | `meta: cardContent as any` — sloppy cast | Replace with `satisfies IntegrationCardContent` |
| pr-#16 | `ThreadContextPanel` re-sorts on every render | `useMemo` keyed on `rawTasks`/`rawDecisions` |
| pr-#17 | `InvocationsCard` `onChange` typing erodes type safety | Tighten `Partial<Record<string, unknown>>` to a proper field type |

---

## Triage of spec-conformance findings (2026-04-30)

13 directional gaps fall into three buckets. **The agent could not auto-fix any** — each required a design decision or substantive new logic. The main session triaged them as below.

### Closed in this session (correctness fixes)

| ID | Gap | Fix |
|---|---|---|
| **E-D5** | OAuth callback decoded `payload.conversationId` from JWT state but never passed it to `resumeFromIntegrationConnect` | Added `conversationId: payload.conversationId` to the resume call in `server/routes/oauthIntegrations.ts:277` |
| **A-D2** | Thread-context UPDATE used `WHERE id = ?` only — silent lost-update class on concurrent writes | Added `AND version = ?` predicate + retry-once-on-conflict path in `server/services/conversationThreadContextService.ts:228-285` |

### Needs user triage (architectural re-decisions or substantial follow-up)

These are NOT bugs the main session can autonomously fix. Each is either (a) a deliberate design re-decision the implementer made vs the plan (decide: amend plan or close gap), or (b) substantive deferred work the implementer marked TODO(v2) at ship time. **The user must decide whether each is acceptable as-is or warrants a follow-up branch before merge.**

| ID | Gap | Posture | Recommendation |
|---|---|---|---|
| **E-D3** | `integrationBlockService.checkRequiredIntegration` is a stub returning `{ shouldBlock: false }` always — entire Chunk E feature is wired but inert | Marked `TODO(v2)` by implementer — explicit deferral | Decide: ship Chunk E as scaffolding-only (UI + plumbing prove out, gating activates in v2 once `ACTION_REGISTRY.requiredIntegration` is wired) **or** block merge until v2 is built. Recommend ship-as-scaffold given the parallel-card UX is already valuable when the user manually triggers a connection. |
| **A-D1** | `buildThreadContextReadModel` not injected into agent prompt at run start; `runMetadata.threadContextVersionAtStart` not captured; resume re-injection (E-7) missing | Substantial prompt-assembly refactor — touches `agentExecutionService` core path | Critical functional gap — the LLM never sees thread context during execution. Without this, Chunk A delivers UI value only, not agent value. Recommend a follow-up branch BEFORE merge: implement the run-start injection + version capture in `agentExecutionService` and the resume-time re-injection in `agentResumeService`. |
| **E-D1** | `agent_runs.status` enum extended with `'blocked_awaiting_integration'` despite plan E-1 explicitly rejecting this | Plan-vs-impl re-decision | Both `status` enum and `blocked_reason` parallel column are now in use. Decide: amend plan to permit dual-signal (current state) or revert enum addition. Current dual-signal works correctly; recommend amending plan §E-1 to acknowledge the chosen approach. |
| **E-D2** | Resume already-resumed path validates only `lastResumeTokenHash`; `lastResumeBlockSequence` not validated against incoming token | Cross-block replay claim | Tokens are 32-byte random and unique per block, so token-hash uniqueness implies block-sequence uniqueness — the existing check is functionally correct. Recommend amending plan §7.5 to remove the redundant `(3)` condition or noting that token-hash uniqueness subsumes it. |
| **B-D1** | Cost rollup uses `agent_messages.cost_cents` directly; plan I-5 mandated `SELECT DISTINCT triggered_run_id JOIN cost_aggregates` | Architectural re-decision | The implementation works (per-message cost is summed deterministically), but plan I-5 named a different pivot. Decide: amend plan I-5 to reflect the chosen `agent_messages.cost_cents` approach, OR refactor `conversationCostService` to use `cost_aggregates`. Per-row approach has the advantage of not needing `triggered_run_id` infrastructure (Cross-1). Recommend amending plan. |
| **B-D2** | `ConversationCostResponse.runCount` field replaced with `messageCount`; per-model `runCount` also missing | Contract shape divergence | Mechanical fix once the B-D1 decision is made. If plan amended (B-D1 approach), keep `messageCount`. If plan kept (cost_aggregates approach), restore `runCount`. |
| **E-D6** | `dismissed` state is client-local only — no PATCH endpoint persists it | Implementer left TODO at `InlineIntegrationCard.tsx:54` | Decide: ship without persistence (re-shows after refresh; acceptable if cards rarely persist past user decision) or build the PATCH endpoint as a follow-up. Low user impact. |
| **E-D4** | `tool_not_resumable` enforcement for `unsafe` strategies not implemented | Same root as E-D3 — activates once ACTION_REGISTRY is wired | Closed by E-D3 decision. |
| **A-D3** | Migration 0264 RLS uses combined `USING` without separate `WITH CHECK` clause | Postgres semantics question | If migration tests pass with FORCE RLS, the existing policy is fine. Verify with the audit-runner RLS check; otherwise add `WITH CHECK` clause in a follow-up migration. |
| **D-D1** | Email tile renders placeholder text instead of inline email config UI | Implementer ship choice | Verify with PM whether per-agent email config exists today. If not, placeholder is correct (config lives elsewhere). |
| **Cross-1** | Plan §11 named `triggered_run_id` write-layer enforcement as deferred follow-up; B-D1 makes it moot | Book-keeping | Closed by B-D1 decision. |

---

## What's committed vs uncommitted

### Committed (14 commits ahead of `origin/main`)
- Chunks A through E shipped (Thread Context + cost meter + suggested chips + invocations card + integration card)
- Latest: `5c646982` — wire `update_thread_context` into `SKILL_HANDLERS` + emit `integration_card` log
- spec-conformance log + `tasks/todo.md` updates: `072ace20`

### Uncommitted (in working tree)
- `DEVELOPMENT_GUIDELINES.md` — added §§8.23–8.25 (ACTION_REGISTRY ↔ SKILL_HANDLERS rule, module-level cache size cap, `<button type="button">` rule)
- `client/src/pages/AdminAgentEditPage.tsx` — replaces inline scheduling UI with `<InvocationsCard>` (completion of Chunk D D9)
- `server/routes/oauthIntegrations.ts` — E-D5 fix
- `server/services/conversationThreadContextService.ts` — A-D2 fix
- `tasks/builds/tier-1-ui-uplift/progress.md` — this file

User to commit explicitly after reviewing.
