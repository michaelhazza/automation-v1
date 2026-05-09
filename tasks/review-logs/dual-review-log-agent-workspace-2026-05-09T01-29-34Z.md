# Dual Review Log — agent-workspace

**Files reviewed:** branch `claude/add-agent-cloud-compute-Kb4ii` vs `origin/main` (HEAD `58739da5`); 53 commits ahead.
**Iterations run:** 2/3
**Timestamp:** 2026-05-09T01:29:34Z
**Commit at finish:** _(populated after auto-commit)_

Codex CLI: `gpt-5.5` (Codex v0.125.0), authenticated via ChatGPT.

Raw Codex output:
- Iteration 1 — `tasks/review-logs/_codex_agent_workspace_dual_iter1_2026-05-09T01-14-28Z.txt`
- Iteration 2 — `tasks/review-logs/_codex_agent_workspace_dual_iter2_2026-05-09T01-25-50Z.txt`

---

## Iteration 1

Codex flagged 4 distinct findings. Each adjudicated independently against `architecture.md` (canonical event types in `shared/types/agentExecutionLog.ts` § Event-type union), the spec (`tasks/builds/agent-workspace/spec.md` §7.5, §13.5, §18 deferred items), the prior review history (AGW-DEF-1..6, AGW-ADV-1..3, Chunk 12 hard-block), and grep-confirmed production producer behaviour.

[ACCEPT] `server/db/schema/index.ts:295-299` — Add `.js` extensions to new schema re-exports
  Reason: All other re-exports in this file use `.js` per ESM convention (the project ships TypeScript ESM with `tsc` preserving extensions). Lines 281–293 use `.js`; lines 295–299 don't. Production builds would fail at startup with ESM resolver error: `dist/server/db/schema/index.js` would contain extensionless specifiers Node cannot resolve. Mechanical fix.

[ACCEPT] `server/routes/agentPresenceStream.ts:165-167` and `:185-187` — Enforce token scope kind, not just ID
  Reason: Real P1 security bug. The check `if (claimedAgentId && claimedAgentId !== req.params.agentId)` only fires when `claimedAgentId` is truthy. A workspace-scope token (`scope.kind === 'workspace'`, `agentId === undefined`) bypasses the check entirely on the agent-stream route — the operator could subscribe to any agent stream in their org with a token that was issued for a different scope kind. Symmetric problem on the workspace-stream route. Closes a missed scope-kind-confusion vector left over from the AGW-ADV-1 fix-loop. Replace conditional check with explicit `tokenScope.kind === '<expected>'` and `tokenScope.<id> === req.params.<id>` validation that rejects anything else.

[ACCEPT] `server/services/agentPresenceServicePure.ts:55-80` — Use canonical run event names (dotted, not underscored)
  Reason: Real correctness bug. Production producer emits `run.started` / `run.completed` (dotted form, see `server/services/agentExecutionService.ts:466,1652` and `shared/types/agentExecutionLog.ts § AgentExecutionEventType`). The new presence resolver looked for `run_started` / `run_completed` / `run_failed` (underscored). Underscored forms are NOT in the `AgentExecutionEventType` union and are never emitted by any producer. Net effect: `activeRunId` was never detected, `state: 'running'` was never returned for a real run, terminal failure was never detected from execution events, and the entire presence projection would have been stuck on `idle` in production. Fix: rename `run_started` → `run.started`, `run_completed` → `run.completed`, and detect failure via `run.completed` payload `finalStatus !== 'completed'` (since there is no separate `run.failed` event — failure rides on `run.completed`'s `finalStatus` discriminator per the `run.completed` payload shape in the type union). Updated the 11 test cases in `agentPresenceServicePure.test.ts` to match. Note: `step_started` left alone — see P2.4 rejection below.

[REJECT] `server/services/agentWorkingTimeService.ts:121-126` — Step events use deferred-contract names
  Reason: This is the same dotted-vs-underscored question, but the answer is different. Unlike `run.started`/`run.completed` (which production emits today), `step_started`/`step_completed` are NOT emitted by any current producer. The producer wiring is Chunk 12, which is **HARD-BLOCKED on Phase 1 contract lock** per the spec and is deliberately deferred (see `tasks/builds/agent-workspace/progress.md` Chunk 12 row). The spec uses underscored form throughout §7.5 ("heartbeat events emit `step_started` / `step_completed`"). The current consumer code is dead until Chunk 12 lands; renaming to dotted form now would either (a) drift from the locked spec, or (b) pre-empt a contract decision that belongs to Chunk 12. Note that `agentWorkingTimeService.ts` line 187 (`run.completed` handling) DOES use the dotted production form — the file is internally consistent: spec-deferred events use spec-locked names, production-emitted events use production names. Same disposition for `agentWorkingTimeServicePure.ts` (`accumulateWorkingTime` is only called by its own test; not on the production write path).

---

## Iteration 2

Codex re-reviewed the uncommitted fixes. Verdict: **"I did not identify any discrete correctness issues in the changed code. The scope validation tightening and event-name updates appear consistent with the surrounding token issuance and canonical run event types."**

Termination: zero new findings — break per playbook Step 4.

---

## Changes Made

- `server/db/schema/index.ts` — added `.js` extensions to 5 new agent-workspace schema re-exports (Codex P1.1)
- `server/routes/agentPresenceStream.ts` — both SSE endpoints now reject any token whose `scope.kind` does not match the route's expected scope kind, in addition to the prior ID-equality check (Codex P1.2)
- `server/services/agentPresenceServicePure.ts` — renamed `run_started`/`run_completed` to canonical dotted form; replaced non-existent `run_failed`/`run_error`/`run_terminated_with_error` checks with a `run.completed`-payload `finalStatus !== 'completed'` check (Codex P1.3)
- `server/services/agentPresenceServicePure.test.ts` — updated 11 fixtures to match the canonical event-type names; failure-path tests now assert against `run.completed` with `finalStatus: 'failed'` payload

Lint: 0 errors (888 pre-existing warnings, none new).
Typecheck: clean.
Targeted tests: `agentPresenceServicePure.test.ts` 11/11 pass; `agentWorkingTimeServicePure.test.ts` 9/9; `ieeSessionServicePure.test.ts` 15/15; `agentPresenceStreamPublisherPure.test.ts` 9/9.

---

## Rejected Recommendations

- **P2.4 (step_started/step_completed event-name mismatch in `agentWorkingTimeService.ts`)** — Rejected. These step-level events are part of Chunk 12, which is **HARD-BLOCKED on Phase 1 contract lock** per the spec and is deliberately deferred. No producer in the current codebase emits step_started or step_completed; the consumer code is dead-code-by-design until Chunk 12 lands and locks the producer contract. The spec text uses underscored form throughout §7.5. Renaming now would (a) introduce drift from the locked spec for events that don't yet exist, and (b) pre-empt a naming decision that belongs to the Chunk 12 work. Internal consistency holds: `agentWorkingTimeService.ts` already uses dotted `run.completed` for the production-emitted run-lifecycle event (line 187) while keeping spec-locked underscored forms for the deferred step events (lines 121, 126). The same applies to the dead `run_completed`/`run_failed` arms in `agentWorkingTimeServicePure.ts`'s `accumulateWorkingTime` helper, which is only called by its own test and is not on the production write path; flipping it now would create churn without resolving the deferred contract.

---

**Verdict:** APPROVED (2 iterations, 3 of 4 Codex findings accepted and implemented; 1 rejected as deferred-contract dead code consistent with spec)
