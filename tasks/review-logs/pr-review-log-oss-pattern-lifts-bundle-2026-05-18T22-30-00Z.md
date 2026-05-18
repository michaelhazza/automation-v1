# PR Review (Round 2) — oss-pattern-lifts-bundle (waitpoint primitive)

**Reviewed:** 2026-05-18T22:30:00Z — independent post-fix-loop review (round 2 of N)
**Branch:** spec-review/oss-pattern-lifts-bundle
**Round 1 log:** tasks/review-logs/pr-review-log-oss-pattern-lifts-bundle-2026-05-18T21-28-36Z.md
**Round 1 fix commit:** 521873cc

Files reviewed (round 2 focus):
- server/services/agentExecutionLoop.ts (B1 verification)
- server/services/waitpointService.ts (B2, B3, B4 verification — full file)
- server/lib/pgBossTxSend.ts (B5 verification — full file)
- server/db/schema/waitpoints.ts (B6 verification — full file)
- migrations/0379_waitpoints_primitive.sql (cross-check schema parity)
- server/services/workflowEngine/queueLifecycle/dispatch.ts:560-606 (approval path unaffected)
- server/lib/adminDbConnection.ts (tx-aborted semantics confirmation)
- node_modules/pg-boss/src/plans.js + manager.js + attorney.js (singleton-queue index verification)
- server/jobs/scorecardJudgeJob.ts + server/services/skillAmendmentService.ts (sendWithTx caller compat check)

---

Blocking: 1 / Should-fix: 3 / Consider: 2
**Verdict:** CHANGES_REQUESTED

---

## Round 1 closure status

- **B1 (OAuth create-side tx wrap)** — CLOSED. `agentExecutionLoop.ts:879-946` wraps `createWaitpoint`, `agentRuns.update`, and `agentMessages.insert` inside `scopedDb.transaction(async (tx) => {...})` with `tx` threaded through every write. Matches the approval-side pattern at `dispatch.ts:564-606`.
- **B2 (per-row try/catch in expireWaitpoints)** — PARTIALLY CLOSED. Try/catch added at `waitpointService.ts:295-516`, but the SAVEPOINT-per-row half of the original Blocking remains missing. See new Blocking finding below.
- **B3 (assertValidTransition + TERMINAL_RUN_STATUSES filter)** — CLOSED. Imports at lines 26, 29; terminal filter at 308-315; guard call at 342-347; `guarded: true` is now accurate.
- **B4 (JOB_CONFIG hasOwnProperty guard)** — CLOSED. `Object.prototype.hasOwnProperty.call(JOB_CONFIG, resumeQueue)` at line 196 runs BEFORE the `as JobName` cast at line 202.
- **B5 (useSingletonQueue on workflow-run-tick)** — CLOSED. `pgBossTxSend.ts:35` adds the option to the shape; lines 49-53 prepend the `__pgboss__singleton_queue` sentinel correctly (verified against pg-boss/src/attorney.js); `waitpointService.ts:483` passes `useSingletonQueue: true`.
- **B6 (Drizzle partial-index declaration)** — CLOSED. `waitpoints.ts:39` now reads `.on(table.boundRunId).where(sql\`bound_run_id IS NOT NULL\`)` — matches migration line 44-45.

Backward compatibility on `sendWithTx`: the new `useSingletonQueue?: boolean` option is optional. The two existing callers (`scorecardJudgeJob.ts:196` and `skillAmendmentService.ts:243`) do NOT pass it, so no regression.

---

## 🔴 Blocking — must be fixed before merge

[🔴] server/services/waitpointService.ts:295-516 — per-row try/catch inside a single open `withAdminConnection` transaction is insufficient; one DB-level error mid-row aborts the entire transaction and silently drops downstream cleanup for every remaining row, with no recovery path on the next sweep.
Why: `withAdminConnection` (server/lib/adminDbConnection.ts:87-92) opens ONE `db.transaction` for the whole sweep. If any `tx.execute` inside the per-row body raises a Postgres error (FK violation on stranded `agent_runs.id`, deadlock against a concurrent writer, the `sendWithTx` ON CONFLICT inference failure, an InvalidTransitionError that escapes the JavaScript guard via an unrelated SQL path), Postgres sets the tx to `25P02 in_failed_sql_transaction`. The catch at line 508-515 swallows the error and continues — but every subsequent `tx.execute` in the for-loop will now fail with `current transaction is aborted, commands ignored until end of transaction block`, and the catch logs `row_failed` for each. Meanwhile the bulk `UPDATE ... SET status = 'expired'` at line 264-275 has already moved every row to `expired`, so the next sweep's `WHERE status = 'pending'` filter will NOT re-find them. Result: stranded `agent_runs` stuck at `pending`/`running` and stranded `workflow_step_runs` stuck at `awaiting_approval` indefinitely after a single poison row.

Round 1's Blocking explicitly called for SAVEPOINT-per-row ("Use SAVEPOINT per row if waitpoint UPDATE needs to roll back with its downstream cleanup") — the fix author dismissed this in the inline comment at line 293-294, but the dismissal only addresses next-sweep recovery, not in-loop tx-poisoning.

Fix: wrap each iteration's body in `await tx.execute(sql\`SAVEPOINT row_sp\`)` ... `await tx.execute(sql\`RELEASE SAVEPOINT row_sp\`)` on success, `await tx.execute(sql\`ROLLBACK TO SAVEPOINT row_sp\`)` on catch (BEFORE the `logger.warn`). The bulk-expire UPDATE at step 1 stays committed — only the per-row downstream cleanup rolls back.

---

## 🟡 Should-fix

[🟡] server/lib/pgBossTxSend.ts:67-71 — `ON CONFLICT (name, singletonkey) WHERE state NOT IN ('expired','cancelled','failed','completed') AND singletonkey IS NOT NULL` does not match either of pg-boss's two partial unique indexes exactly; under `useSingletonQueue: true` the predicate gap widens.
Why: Postgres requires the inference predicate to imply the chosen index's predicate. pg-boss's `job_singletonKey` index requires `state < 'completed' AND singletonOn IS NULL AND NOT singletonKey LIKE '__pgboss__singleton_queue%'`; `job_singleton_queue` requires `state < 'active' AND singletonOn IS NULL AND singletonKey LIKE '__pgboss__singleton_queue%'`. Our inference does NOT mention `singletonOn IS NULL` or the LIKE predicate. Pre-existing — amplified by the new useSingletonQueue path.

[🟡] server/services/waitpointService.ts:308-317 — `sql.raw` with template-string interpolation of `wp.bound_run_id` and `orgId`. DB-returned UUIDs make injection infeasible today; the pattern is still a footgun. Replace with parameterised `sql\`${value}\`` placeholders.

[🟡] Missing test for SAVEPOINT-per-row recovery once Blocking lands. Author at `server/services/__tests__/waitpointService.test.ts` with the three-row scenario described.

---

## 💭 Consider

[💭] server/services/agentExecutionLoop.ts:871-872 — outer `let resumePlaintext: string;` and `let cardExpiresAt: string;` are no longer read outside the tx closure after the B1 fix. Move to `const` inside the closure or remove the outer `let` declarations.

[💭] server/services/agentExecutionLoop.ts:906-919 vs 961-976 — flag-ON branch does NOT set `agent_runs.blocked_expires_at` or `agent_runs.integration_resume_token`; flag-OFF branch does. Correct under the waitpoint primitive but creates a rollback hazard if `WAITPOINT_PRIMITIVE_ENABLED` flips OFF mid-flight. Document in the rollback runbook if not already covered by spec §17.

---

## Files NOT read

```
server/services/agentResumeService.ts — unchanged in round 1 fix commit.
server/jobs/agentRunResumeFromWaitpointJob.ts — unchanged.
server/jobs/waitpointExpirySweepJob.ts — unchanged.
server/services/waitpointServicePure.ts — unchanged.
server/services/__tests__/waitpointServicePure.test.ts — unchanged.
server/services/workflowEngine/stepLifecyclePure.ts — unchanged.
docs/env-manifest.json — round-1 Should-fix (variableType) not in round-2 scope.
architecture.md / KNOWLEDGE.md — doc-sync, not behavioural.
```

Unread regions could NOT invalidate the verdict — the single Blocking finding lives in `waitpointService.ts:295-516` which was read fully.

Blocking: 1 / Should-fix: 3 / Consider: 2
**Verdict:** CHANGES_REQUESTED (1 blocking, 3 should-fix)
