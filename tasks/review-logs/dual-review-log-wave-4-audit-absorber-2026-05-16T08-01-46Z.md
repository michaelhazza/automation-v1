# Dual Review Log — wave-4-audit-absorber

**Files reviewed:** branch `claude/wave-4-audit-absorber` vs `main` (17 commits, audit-sweep absorber)
**Iterations run:** 3/3
**Timestamp:** 2026-05-16T08:01:46Z
**Branch HEAD before dual-review:** `d0b64844`

---

## Iteration 1

### Codex output summary
Codex raised one [P1] finding:

> **[P1] Use the pre-created handoff run in the worker — `server/services/agentScheduleService.ts:176-185`**
> When `data.runId` is present, this worker validates the pre-created `agent_runs` row but then calls `executeRun`, whose lifecycle still inserts a separate new run. The original `runId` returned by `enqueueHandoff` remains `pending`, so `executeSpawnSubAgents` polls the wrong row and will time out even when the child actually completed, while also creating duplicate run records for every spawned child.

### Decision

```
[ACCEPT] server/services/agentScheduleService.ts:176-185 — worker validates pre-created runId but does not pass it through to executeRun, leaving the pre-created row stuck in 'pending' while persistAndAnnounce inserts a duplicate row
  Reason: Direct violation of spec §5.2 step 1 which explicitly states "The pg-boss payload then carries the pre-created `runId` alongside the existing fields, and the worker reads the existing row (by id) instead of inserting a new one." Confirmed by reading:
    - server/services/skillExecutor/pipeline.ts:265-303 (enqueueHandoff inserts an agent_runs row with status='pending' and id `runId`, sends job carrying that `runId`)
    - server/services/agentExecutionService/runLifecycle/persistRun.ts:42-72 (persistAndAnnounce unconditionally INSERTs a new agent_runs row — no `preCreatedRunId` plumbing)
    - server/services/agentScheduleService.ts:176-196 (worker validates `data.runId` then calls `executeRun(request)` without passing runId)
  Downstream consequence: `executeSpawnSubAgents` (handoff.ts) polls `runId` returned by `enqueueHandoff` — the row that stays `pending` forever — producing false `spawn_timeout` results and one orphaned `agent_runs` row per spawned child. The MC8 integration tests in this build are structural-schema-only, so they did not catch this.
```

### Implementation

Three files touched (minimal, surgical):

1. `server/services/agentExecutionService/types.ts` — added `preCreatedRunId?: string` to `AgentRunRequest` with a doc comment referencing spec §5.2 step 1.
2. `server/services/agentExecutionService/runLifecycle/persistRun.ts` — branched the run-record creation: when `request.preCreatedRunId` is set, UPDATE the row from `pending` → `running` with the concurrency guard `WHERE id = $preCreatedRunId AND status = 'pending'`. If the UPDATE returns zero rows (concurrent transition), throw fail-loud per spec §5.2 worker-side guard semantics. When unset, fall through to today's INSERT (back-compat for non-AE2 callers).
3. `server/services/agentScheduleService.ts:189` — pass `preCreatedRunId: data.runId` in the `executeRun` call from the handoff worker.

`npm run lint` — 0 errors.
`npm run typecheck` — clean.

---

## Iteration 2

### Codex output summary

> **[P2] Preserve idempotent handoff retries after claiming runs — `server/services/agentScheduleService.ts:190-194`**
> When a handoff job is retried after the first attempt has claimed the pre-created row, `preCreatedRunId` causes that row to be moved from `pending` to `running`; on the retry, the worker's existing pre-check sees `running` and throws before `executeRun` can return the existing run via its idempotency key. Since `agent-handoff-run` has retries enabled, this turns normal at-least-once delivery/timeouts into a failed/DLQ job for an already-started run rather than an idempotent no-op.

### Decision

```
[ACCEPT] server/services/agentScheduleService.ts:164-173 — worker-side guard throws on `running` status, regressing idempotent at-least-once delivery
  Reason: Spec §6.2 (d) explicitly requires "the second worker run mutates agent_runs to the same end-state as the first" — the payload-key idempotency contract. With my iter-1 fix (preCreatedRunId claiming), a pg-boss retry of an in-flight job sees the row in 'running' and would throw via the chunk 2b guard. That contradicts the spec contract. The fix is to widen the worker-side "exit cleanly on terminal" branch to "exit cleanly on any non-pending status" — any non-pending state means a previous dispatch already took ownership; the retry is a duplicate dispatch, not a failure. Recovery for genuinely crashed mid-flight runs is handled by the existing `staleRunCleanupService` (server/services/staleRunCleanupService.ts:23-127), which sweeps stranded `running` rows after a 10-min heartbeat threshold and transitions them to `failed`.
```

### Implementation

`server/services/agentScheduleService.ts:164-173` — collapsed the "terminal → exit cleanly" + "non-pending → throw" branches into a single "non-pending → exit cleanly (duplicate dispatch)" branch. Missing-row case still throws (fail-loud preserved per chunk 2b).

`npm run lint` — 0 errors.
`npm run typecheck` — clean.

---

## Iteration 3

### Codex output summary

> **[P1] Do not acknowledge retries for stale running handoff runs — `server/services/agentScheduleService.ts:170-177`**
> When a worker crashes or times out after `persistAndAnnounce` has claimed the pre-created row and set it to `running`, pg-boss will redeliver the job with the row still in a non-terminal status. This branch now returns successfully for that retry, so pg-boss considers the job complete and the run can remain stuck in `running` forever instead of being retried or failed.

### Decision

```
[REJECT] server/services/agentScheduleService.ts:170-177 — "stuck in running forever" claim is factually incorrect
  Reason: The stranded-`running` recovery path is `staleRunCleanupService.cleanupStaleRuns()` at server/services/staleRunCleanupService.ts:23-127, scheduled every 5 minutes via the `stale-run-cleanup` pg-boss queue. After 10 min of no heartbeat (`STALE_THRESHOLD_MS = 10 * 60 * 1000`), it transitions the row to `failed` with `errorMessage: 'Run terminated: no activity detected (stale run cleanup)'` and emits the appropriate websocket events. The alternative Codex implies (throw on running → pg-boss DLQ) does NOT recover the row either — it just fails the job. Both paths produce the same stranded `agent_runs` row, recoverable only via the stale-run sweeper.
  Spec §6.2 (d) — "the second worker run mutates agent_runs to the same end-state as the first" — supports exit-cleanly: throwing would mutate the job state to a different end-state (failed/DLQ) than the first attempt's state (running, then eventually failed-by-sweeper), violating the payload-key idempotency contract.
  Pre-existing behaviour: even before the iter-1 fix, this scenario stranded the row — the original chunk 2b guard threw on non-pending and pg-boss DLQ'd after 1 retry; the row stayed in `running` either way. The iter-2 fix improves the FREQUENT case (legitimate heartbeat-miss retries) without making the RARE case (worker crash) any worse.
  Per dual-reviewer rules § Reject: "the fix would add complexity without meaningful benefit" applies — Codex's "fix" (throw on running) reverts the iter-2 spec-alignment without addressing the underlying stranded-row recovery, which is correctly handled elsewhere.

Termination: zero accepted findings this iteration → loop terminates per playbook Step 4.
```

---

## Changes Made

- `server/services/agentExecutionService/types.ts` — added `preCreatedRunId?: string` field to `AgentRunRequest` with doc comment.
- `server/services/agentExecutionService/runLifecycle/persistRun.ts` — branched `persistAndAnnounce` to UPDATE-claim the pre-created `pending` row when `request.preCreatedRunId` is set; fall through to the original INSERT path otherwise. UPDATE carries the concurrency guard `eq(agentRuns.status, 'pending')` and throws fail-loud on zero-row return.
- `server/services/agentScheduleService.ts` — handoff worker passes `preCreatedRunId: data.runId` into `executeRun`; worker-side guard's "throw on non-pending" branch collapsed into "exit cleanly on non-pending (duplicate dispatch)".

## Rejected Recommendations

- **Iter-3 [P1] "Do not acknowledge retries for stale running handoff runs"** — rejected because the stranded-row recovery mechanism (`staleRunCleanupService`) already handles this case, and Codex's proposed alternative (throw on running) would violate spec §6.2 (d) payload-key idempotency by producing a different end-state from the first attempt. The current "exit cleanly on non-pending" branch is spec-aligned for the frequent case (heartbeat-miss retry) and does not regress the rare case (worker crash) relative to pre-iter-1 behaviour.

---

## Re-review note for feature-coordinator

Production code changed across 3 files. Per playbook §8.6 re-review check, `pr-reviewer` should be re-invoked on the iter-1+iter-2 diff before final approval. The dual-review loop itself terminates here per Step 4 (zero acceptances in iter-3).

---

**Verdict:** APPROVED (3 iterations, 2 accepted Codex findings fixed; 1 rejected with rationale)
