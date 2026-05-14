# Dual Review Log — pre-prod-boundary-and-brief-api

**Files reviewed:** full feature branch `pre-prod-boundary-and-brief-api` vs `main` (75 files, ~24.9 k insertions). Codex review focused on the Phase-1 Multer change + Phase-2 rate-limiter primitive + Phase-2 cleanup job — i.e. the runtime-critical infrastructure where regressions would block production boot.
**Iterations run:** 2/3
**Timestamp:** 2026-04-29T06:05:54Z
**Commit at finish:** 6b2f1f84

---

## Iteration 1

Codex `review --base main` returned three substantive findings against the feature branch.

[ACCEPT] `server/middleware/validate.ts:20` + 3 consumers — Restore upload buffer handling after disk storage switch (P1)
  Reason: real blocking regression. Verified by reading every caller of `validateMultipart`:
    - `server/routes/files.ts:33` → `fileService.uploadFile` reads `file.buffer` at `server/services/fileService.ts:34`.
    - `server/routes/agents.ts:78` → `agentService.uploadDataSourceFile` reads `file.buffer` at `server/services/agentService.ts:1012`.
    - `server/routes/scheduledTasks.ts:179` → `agentService.uploadScheduledTaskDataSourceFile` reads `file.buffer` at `server/services/agentService.ts:1597`.
  Under `multer.diskStorage` (spec §6.1), `file.buffer` is `undefined` — every upload would PUT `undefined` to S3. Routes `automations.ts:55` and `executions.ts:39` also use `validateMultipart` but their downstream services (`testProcess`, `createExecution`) do not read `.buffer`, so they are unaffected. All other `.buffer` reads in routes are bound to local `multer.memoryStorage()` instances (`configDocuments.ts`, `dropZone.ts`, `referenceDocuments.ts`, `systemAgents.ts`) and out of scope.
  Spec §AC1 explicitly says "existing file routes accept the new cap unchanged" — the spec author did not anticipate the buffer/path tension when picking pure disk-storage. Fixing the consumers (option B in the spec architect-decision lane) is the correct move; switching back to memory-storage (option A) defeats the entire G1 goal.
  Fix shape: stream from `file.path` via `fs.createReadStream` with explicit `ContentLength: file.size`. The cleanup hook at `validateMultipart` runs on `res.on('close')`, which fires after the route awaits `s3.send`, so the stream is fully consumed before unlink runs — safe ordering.

[ACCEPT] `server/lib/inboundRateLimiter.ts:111` — Treat `db.execute` results as the returned row array (P1)
  Reason: real blocking regression. `server/db/index.ts:13` constructs `drizzle(client)` from `drizzle-orm/postgres-js`, which returns the row array (a postgres-js `RowList`) directly from `db.execute()` — not a `{ rows }` wrapper. The codebase canonical pattern is `result[0]` / `result.length`:
    - `server/jobs/connectorPollingSync.ts:81-92` uses `leaseResult.length === 0` and `leaseResult[0]`.
    - `server/jobs/agentRunCleanupJob.ts:91` and `:123` cast directly to `Array<...>`.
    - Defensive jobs (`memoryBlockSynthesisJob.ts:33-41`, `memoryEntryQualityAdjustJob.ts:57-65`) handle both shapes via `Array.isArray(rows) ? rows : rows.rows ?? []`.
  As written, `result.rows[0]` evaluates to `undefined` (the array does not have a `rows` property) and the very next line — `if (!row) throw new Error('CTE produced no row')` — fires for every check. This breaks login (auth.ts), signup, public form submission, public page tracking, all four test-run routes, and `/api/session/message` rate limiting.
  Fix shape: cast `result` to `CheckRow[]` and read `rows[0]`. Conservative — matches `connectorPollingSync` exactly.

[ACCEPT] `server/lib/rateLimitCleanupJob.ts:42` — Read cleanup DELETE results from the row array (P2)
  Reason: same shape issue as the rate-limiter. `result.rows.length` evaluates to `undefined.length` and throws. The pg-boss-scheduled cleanup would fail silently every 5 minutes, letting `rate_limit_buckets` grow unbounded.
  Fix shape: same cast pattern as `inboundRateLimiter.check` — treat `result` as `Array<{ ok: number }>` and read `rows.length`.

## Iteration 2

Codex `review --uncommitted` against the working tree (post-fix state) returned no findings:

> "The code changes align with the repository's postgres-js `db.execute()` behavior and correctly adapt disk-backed multer uploads to stream from `file.path`. I did not identify any actionable regressions in the changed code."

Loop terminated — clean iteration after fixes.

---

## Changes Made

- `server/lib/inboundRateLimiter.ts` — cast `db.execute()` result to `CheckRow[]` and read `rows[0]` (matches `connectorPollingSync` canonical pattern).
- `server/lib/rateLimitCleanupJob.ts` — cast `db.execute()` result to `Array<{ ok: number }>` and read `rows.length`.
- `server/services/fileService.ts` — import `node:fs`, replace `Body: file.buffer` with `Body: fs.createReadStream(file.path)` + explicit `ContentLength: file.size`.
- `server/services/agentService.ts` — import `node:fs`, fix two S3 PutObject call sites (`uploadDataSourceFile` and `uploadScheduledTaskDataSourceFile`) to stream from `file.path` with explicit `ContentLength`.

Verification: `npx tsc --noEmit` clean across the whole repo. `npx tsx server/services/__tests__/rateLimiterPure.test.ts` — 7/7 pure-helper tests pass.

## Rejected Recommendations

None — all three Codex findings in iteration 1 were accepted (two P1 blockers + one P2). Iteration 2 produced no findings to adjudicate.

---

**Verdict:** APPROVED (2 iterations, 3 findings accepted, 0 rejected, 2 P1 production-blocking regressions caught and fixed).
