# PR Review — oss-pattern-lifts-bundle (waitpoint primitive)

**Reviewed:** 2026-05-18T21:28:36Z — independent post-implementation review
**Branch:** spec-review/oss-pattern-lifts-bundle
**Spec:** docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md
**Plan:** tasks/builds/oss-pattern-lifts-bundle/plan.md

Files reviewed:
- migrations/0379_waitpoints_primitive.sql + .down.sql
- server/db/schema/waitpoints.ts
- server/services/waitpointService.ts
- server/services/waitpointServicePure.ts
- server/services/agentResumeService.ts
- server/services/agentExecutionLoop.ts (OAuth create-side gate)
- server/services/workflowEngine/queueLifecycle/dispatch.ts (approval create-side gate)
- server/services/workflowEngine/stepLifecycle.ts (refactor to consume helper)
- server/services/workflowEngine/stepLifecyclePure.ts (new helper)
- server/services/reviewService.ts (approval complete-side gate)
- server/jobs/agentRunResumeFromWaitpointJob.ts
- server/jobs/waitpointExpirySweepJob.ts
- server/config/jobConfig.ts (+2 entries)
- server/config/rlsProtectedTables.ts (+1 entry)
- server/services/queueService/maintenanceJobs/pgBossRegistrations.ts (worker + schedule)
- server/lib/env.ts (WAITPOINT_PRIMITIVE_ENABLED)
- docs/env-manifest.json
- server/services/__tests__/waitpointServicePure.test.ts
- server/services/workflowEngine/__tests__/stepLifecyclePure.test.ts

---

Blocking: 6 / Should-fix: 9 / Consider: 3
**Verdict:** CHANGES_REQUESTED

---

## Blocking — must be fixed before merge

[🔴] server/services/agentExecutionLoop.ts:874-940 — OAuth create-side waitpoint INSERT, agent_runs UPDATE, and agent_messages INSERT execute as three independent statements; no surrounding transaction.
Why: A failure or process crash between createWaitpoint (returns plaintext to user) and the agent_runs update leaves a "live" pending waitpoint whose token has been generated but the run is NOT marked blocked. The approval path at dispatch.ts:564-606 wraps the same three writes in `scopedDb.transaction(async (tx) => { ... })` and passes `tx` to `createWaitpoint(params, { tx })` — atomic. The OAuth side must adopt the same pattern. Fix: wrap lines 874-940 in `await scopedDb.transaction(async (tx) => { ... })`, pass `tx` into `createWaitpoint`, and switch the agentRuns.update and agentMessages.insert to the same `tx`.

[🔴] server/services/waitpointService.ts:236-481 — `expireWaitpoints` runs the entire cross-org sweep inside one admin transaction with no per-row try/catch; a single bad row aborts the whole batch.
Why: Spec §5.3 says to mirror `blockedRunExpiryJob.runFn`. That reference (server/jobs/blockedRunExpiryJob.ts:76-150) wraps every per-row update in a try/catch and continues on InvalidTransitionError or generic errors. The new sweep does not — one bad `sendWithTx`, one malformed payload cast, one InvalidTransitionError rolls back EVERY downstream cleanup and the waitpoint UPDATEs themselves. Next cycle re-finds the same candidates and fails again on the same poison row. Fix: wrap each per-row branch (oauth, approval) in `try { ... } catch (err) { logger.warn('waitpoint.expiry.row_failed', { waitpointId: wp.id, kind: wp.kind, error: err instanceof Error ? err.message : String(err) }); }`. Use SAVEPOINT per row if waitpoint UPDATE needs to roll back with its downstream cleanup.

[🔴] server/services/waitpointService.ts:323-368 — OAuth-kind expiry transitions agent_runs to terminal without calling `assertValidTransition`; the `guarded: true` flag on the state_transition log (line 359) is a lie.
Why: DEVELOPMENT_GUIDELINES.md §8.18 mandates every terminal write on agent_runs flow through `assertValidTransition`. Spec §5.3 explicitly says "using `assertValidTransition` (kind='agent_run') and the predicate-checked UPDATE pattern from `blockedRunExpiryJob.runFn`" — the reference at blockedRunExpiryJob.ts:78-83 calls the guard before the UPDATE. Also missing: the candidate set is not filtered to non-terminal source statuses (`status NOT IN (TERMINAL_RUN_STATUSES)`) the way blockedRunExpiryJob.ts:57-65 does, so an already-terminal run could surface here and silently fail the predicate UPDATE (or worse, succeed because the guard never ran). Fix: import `assertValidTransition`, `describeTransition`, `InvalidTransitionError`, `TERMINAL_RUN_STATUSES` from shared; call the guard before each UPDATE; catch InvalidTransitionError per row (composes with the per-row try/catch Blocking above).

[🔴] server/services/waitpointService.ts:191 — `getJobConfig(resumeQueue as JobName)` casts a DB-sourced string to the JobName union with no validation.
Why: The DB CHECK constraint only enforces "resume_queue IS NOT NULL for kind='oauth'", not "resume_queue ∈ JobName". An arbitrary value lands as `getJobConfig(name) → undefined`, then `jobCfg.retryLimit` throws TypeError at runtime. Same defect class as the null-resume_queue case the spec already mandates a guard for; the value-not-in-set case is equally unsafe. Fix: validate `Object.prototype.hasOwnProperty.call(JOB_CONFIG, resumeQueue)` BEFORE the cast, throw `INTERNAL_ERROR` with a clear message if missing. Optionally enforce in `validateCreateWaitpointParams` so a malformed value never reaches the DB.

[🔴] server/services/waitpointService.ts:446-457 — `sendWithTx('workflow-run-tick', ...)` in the approval-kind expiry path omits `useSingletonQueue: true` that the canonical `enqueueTick` (server/services/workflowEngine/constants.ts:34) sets.
Why: Spec §5.3 says the sweep's tick is "equivalent to `failStepRunInternal`'s `enqueueTick(sr.runId)` call (which uses the same queue, payload, and singletonKey shape)". `enqueueTick` uses `useSingletonQueue: true` — the pg-boss flag for per-queue dedup, separate from per-row singletonKey. Without it, two ticks for the same runId can be picked up by concurrent workers, breaking the §5.6 layer-1 queue-deduplication guarantee. Fix: extend `sendWithTx`'s options shape (server/lib/pgBossTxSend.ts) to accept and forward `useSingletonQueue`, then pass `true` here. Alternative: call `enqueueTick(workflowRunId)` directly after the admin tx commits.

[🔴] server/db/schema/waitpoints.ts:38 — `waitpoints_bound_run_idx` is declared as a non-partial index in Drizzle, but the migration creates it as partial `WHERE bound_run_id IS NOT NULL`.
Why: Drizzle schema and live DB are out of sync. The next `npm run db:generate` will emit a destructive diff (drop the partial, recreate as full). Spec §4.1 explicitly specifies the partial form. Fix: declare the partial in Drizzle: `index('waitpoints_bound_run_idx').on(table.boundRunId).where(sql\`bound_run_id IS NOT NULL\`)`. Confirm with `npm run db:generate` produces zero new diff.

---

## Should-fix — non-blocking but expected to be addressed in-PR unless explicitly deferred

[🟡] server/services/waitpointService.ts:67-88 — `createWaitpoint` has two completely separate INSERT paths (Drizzle-typed for scopedDb branch, raw `tx.execute(sql\`INSERT INTO waitpoints...\`)` for opts.tx branch). Schema-drift trap; new columns must be remembered in two places.

[🟡] server/services/waitpointService.ts (six unwrap blocks) — every DB result is double-shaped to handle both `Array<...>` and `{ rows: Array<...> }`. Extract `unwrapRows<T>` or pick one shape.

[🟡] server/services/waitpointService.ts:36-38 — `TxHandle = { execute }` is narrower than every actual caller's Drizzle tx; every caller widens with `as unknown as TxHandle`. Shallow-module smell.

[🟡] server/services/waitpointService.ts:222-227 — `logger.info('waitpoint.completed', ...)` emitted while the caller's transaction is STILL OPEN on the approval path. Spec §15.4 says post-commit; risk of phantom emit on rollback.

[🟡] Missing test coverage for `completeWaitpoint`'s SQL path (queue validation, idempotent already_completed).

[🟡] Missing test coverage for `expireWaitpoints` per-row error recovery (once the Blocking try/catch fix lands).

[🟡] server/services/agentResumeService.ts:60-106 — Waitpoint path pre-fetches `bound_run_id` then calls `completeWaitpoint` which itself reads-then-updates the row; two reads where one would do. Extend completeWaitpoint return shape to include boundRunId.

[🟡] server/jobs/agentRunResumeFromWaitpointJob.ts:30-34 — `agent_runs` SELECT reads by id without an explicit org predicate; DEV_GUIDELINES §1 requires defence-in-depth org predicate alongside RLS.

[🟡] docs/env-manifest.json — `WAITPOINT_PRIMITIVE_ENABLED` declared with `variableType: 'identifier'` but it's a boolean flag.

---

## Consider — taste / future-proofing / nice-to-have

[💭] server/services/waitpointService.ts:191-202 — Extract `buildSendWithTxOptions(jobCfg, runId)` to waitpointServicePure (mirrors buildFailStepRunColumnSet pattern).

[💭] server/services/waitpointService.ts:282-475 — Extract `expireOauthWaitpoint` and `expireApprovalWaitpoint` from the for-loop body once per-row try/catch lands. Loop becomes 6-line dispatcher.

[💭] server/services/workflowEngine/stepLifecycle.ts:45-53 — Pre-existing: `failStepRunInternal` doesn't call `assertValidTransition`. Now that buildFailStepRunColumnSet is shared, two call sites write the failed terminal state — both need the guard.

---

## Files NOT read

```
architecture.md (Waitpoint Primitive section) — not deeply audited (doc-sync handles).
KNOWLEDGE.md (Trigger.dev entry) — not deeply audited.
server/services/reviewService.ts lines 252-end — confirmed the inside-tx call site only.
server/services/agentExecutionLoop.ts lines 0-873 + 940-end — verified bounds of WAITPOINT_PRIMITIVE_ENABLED branch only.
```

Unread regions could NOT invalidate the verdict — all Blocking findings live in code that was read fully.
