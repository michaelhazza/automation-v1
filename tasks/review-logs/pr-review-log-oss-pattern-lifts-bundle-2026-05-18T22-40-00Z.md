# PR Review (Round 3) — oss-pattern-lifts-bundle (waitpoint primitive)

**Reviewed:** 2026-05-18T22:40:00Z — independent post-fix-loop review (round 3)
**Branch:** spec-review/oss-pattern-lifts-bundle
**Round 2 log:** tasks/review-logs/pr-review-log-oss-pattern-lifts-bundle-2026-05-18T22-30-00Z.md
**Round 2 fix commit:** 8f207f3b

Files reviewed (round 3 focus):
- server/services/waitpointService.ts (rB1 SAVEPOINT verification — full file)
- server/lib/adminDbConnection.ts (outer-tx confirmation for nested savepoint behaviour)

Blocking: 0 / Should-fix: 3 / Consider: 2
**Verdict:** APPROVED

---

## Round 2 closure status

- **rB1 (SAVEPOINT-per-row in expireWaitpoints)** — CLOSED.
  - `SAVEPOINT row_sp` at `waitpointService.ts:301` is the first SQL statement inside the for-loop body. Only `const orgId = wp.organisation_id` (pure JS) precedes it. The bulk UPDATE at lines 264-277 (step 1) is untouched and commits outside the savepoint scope.
  - All four early-exit `continue` paths release first: `:311-312` (oauth no boundRunId), `:344-345` (oauth run terminal/missing), `:420-421` (approval no stepRunId), `:452-453` (approval step missing).
  - End-of-iteration RELEASE at `:519` covers the remaining success paths (oauth UPDATE result, approval UPDATE+sendWithTx result, approval 0-row-matched warn-only, and `external_event` no-op).
  - Catch at `:520-528` issues `ROLLBACK TO SAVEPOINT row_sp` at `:521` BEFORE `logger.warn` at `:522`. Order is correct.
  - PostgreSQL allows `SAVEPOINT row_sp` reuse across iterations: after `RELEASE` the name is freed; after `ROLLBACK TO` the savepoint persists and the next `SAVEPOINT row_sp` shadows it. No name conflict, no resource leak that affects correctness within a sweep.

## 🔴 Blocking

No blocking issues found.

## 🟡 Should-fix (deferred from round 2 — re-confirmed)

[🟡] server/lib/pgBossTxSend.ts:67-71 — ON CONFLICT inference predicate does not exactly match either pg-boss partial unique index; widens under `useSingletonQueue: true`. Pre-existing pattern, observable failure mode (insert errors, not silent data loss). Defer to follow-up.

[🟡] server/services/waitpointService.ts:316-325 — `sql.raw` with template-string interpolation of DB-returned UUIDs. Injection infeasible today; pattern is a footgun. Defer to follow-up with parameterised placeholders.

[🟡] Missing test for SAVEPOINT-per-row recovery. Given three expired waitpoints A/B/C where B's downstream UPDATE raises a DB error: A and C committed, B rolled back, all three remain expired, exactly one `waitpoint.expiry.row_failed` emitted. Add at `server/services/__tests__/waitpointService.test.ts` — Vitest.

## 💭 Consider (deferred from round 2)

[💭] server/services/agentExecutionLoop.ts:871-872 — outer `let resumePlaintext` / `let cardExpiresAt` no longer read after B1 fix; tighten scope.

[💭] server/services/agentExecutionLoop.ts:906-919 vs 961-976 — flag-ON branch omits `agent_runs.blocked_expires_at` / `integration_resume_token` writes that flag-OFF retains; mid-flight flag flip is a rollback hazard. Document in rollback runbook if not covered by spec §17.

---

## Closure summary

The waitpoint primitive lift is ready to merge. Round 1 raised six blockers covering tx-wrapping, transition guards, JOB_CONFIG safety, pg-boss singleton-queue plumbing, and Drizzle schema parity — all closed in round 1's fix loop. Round 2 found that the per-row try/catch alone was insufficient because Postgres marks the outer tx as `25P02 in_failed_sql_transaction` on a single DB error. Round 3's commit `8f207f3b` adds the missing SAVEPOINT-per-row primitive. The bulk UPDATE remains committed outside the savepoint, so per-row failures are observable, durable, and isolated. No regressions identified. The three Should-fix items are explicitly deferred and do not gate merge.

Blocking: 0 / Should-fix: 3 / Consider: 2
**Verdict:** APPROVED
