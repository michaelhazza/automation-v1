# PR Review Log — wave-4-audit-absorber (Round 3, dual-reviewer re-review)

**Branch:** `claude/wave-4-audit-absorber`
**HEAD:** `cc1e6c0f` (vs round-2 HEAD `d0b64844`)
**Reviewed at:** 2026-05-16T09:50:00Z
**Reason:** §8.6 re-review check after dual-reviewer (Codex) applied AE2 worker pre-created runId fix in commit `56cd5f9a`

Blocking: 0 / Should-fix: 1 / Consider: 2
**Verdict:** APPROVED (dual-reviewer fix correctly resolves round-2-missed P1)

---

## What dual-reviewer caught and fixed

P1 spec §5.2 step 1 contract violation: handoff worker validated the pre-created `agent_runs` row but did not pass its `runId` into `executeRun`, causing `persistAndAnnounce` to INSERT a duplicate row while the pre-created row stayed `pending`. Parent spawn poll-loop polled the wrong runId. Three production files changed:

- `server/services/agentExecutionService/types.ts` — added `preCreatedRunId?: string` to `AgentRunRequest`
- `server/services/agentExecutionService/runLifecycle/persistRun.ts` — UPDATE-claim pending row when `preCreatedRunId` is set, else INSERT
- `server/services/agentScheduleService.ts` — worker passes `preCreatedRunId: data.runId`; non-pending status widened from "throw" to "exit cleanly" per spec §6.2 (d) idempotency

## Round-3 verification

- **UPDATE-claim concurrency guard:** `WHERE id = R AND status = 'pending'` — correct optimistic concurrency
- **Field coverage:** every INSERT-path field either pre-written by `enqueueHandoff` or explicitly set by UPDATE-claim. No field dropped.
- **Idempotency key plumbing:** `handoff:${agentId}:${job.id}` — pg-boss retry early-exits via `validateAndPrepare`
- **Worker-side guard:** "exit cleanly on non-pending" matches spec §6.2 (d) idempotency. Stranded-`running` rows recovered by `staleRunCleanupService` after 10 min (verified at `staleRunCleanupService.ts:46-53`)
- **Fail-loud throw:** raw `Error` correct for worker-internal invariant violation

## 🟡 Should-fix

[🟡] Missing Vitest unit test for `persistAndAnnounce` UPDATE-claim branch (deferred to `tasks/todo.md`).
Why: the dual-reviewer-caught P1 shipped past two prior pr-reviewer rounds because the only existing handoff test is structural-schema-only. Targeted behavioural coverage on the UPDATE-claim branch would catch any future regression. Spec §4 testing-posture deviation does not apply to pure unit tests, but the build is APPROVED and Phase 3 transition is in flight — routed for follow-up.

## 💭 Consider

[💭] `agentScheduleService.ts:170-178` — "duplicate dispatch" log message uses `info` level for both heartbeat-miss-retry and crashed-and-recovered cases. Future observability tweak could branch on terminal-vs-active status.

[💭] `architecture.md:417` — one-line addition referencing the concrete `preCreatedRunId` field would make contract more grep-discoverable.

---

**Verdict:** APPROVED
