# PR Review — skill-analyzer stale-job sweep + Stage 7b heartbeat

**Commit:** 2f988043
**Branch:** bugfixes-april26
**Reviewed:** 2026-04-24T08-50-00Z

**Files reviewed:**
- server/jobs/staleAnalyzerJobSweepJob.ts (new)
- server/jobs/staleAnalyzerJobSweepJobPure.ts (new)
- server/jobs/__tests__/staleAnalyzerJobSweepJobPure.test.ts (new)
- server/jobs/skillAnalyzerJob.ts (Stage 7b heartbeat)
- server/services/queueService.ts (worker + cron registration)

---

## Blocking Issues

### B1. Mid-flight status set includes a phantom status and omits a real one

`STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES` declares `['parsing', 'hashing', 'embedding', 'matching', 'classifying']`. The canonical schema enum is `'pending' | 'parsing' | 'hashing' | 'embedding' | 'comparing' | 'classifying' | 'completed' | 'failed'`. There is no `'matching'` status; Stage 4 writes `'comparing'` for the full 40%→60% similarity-computation window.

A worker crash during Stage 4 leaves the row in `'comparing'`, which the sweep doesn't include — never reaped, defeating the purpose. The test asserts the same phantom status so the bug ships unflagged.

**RECOMMENDATION:** implement — replace `'matching'` with `'comparing'` in the constant + the test assertion. Also strongly consider type-coupling the sweep set to the schema enum so this drift is caught at compile time.

## Strong Recommendations

### S1. Test the error-message preservation policy
`COALESCE(j.error_message, '…')` is a deliberate choice — pin it.
**RECOMMENDATION:** defer — codebase has no integration test harness for pg-boss-touching sweeps; sibling `llmStartedRowSweepJob` doesn't either. Pure tests for the SQL would require a real Postgres fixture. Worth filing in todo.md backlog.

### S2. Test the pg-boss UPDATE correctness
**RECOMMENDATION:** defer — same reason as S1, integration-level concern.

### S3. Test the prior-status RETURNING columns
**RECOMMENDATION:** defer — same reason as S1.

### S4. Heartbeat counter race comment
JS single-threaded → `++` + modulo is atomic per microtask. Worth a one-line clarifying comment.
**RECOMMENDATION:** implement — one line in skillAnalyzerJob.ts at the heartbeat declaration.

### S5. Drop dead `thresholdMs: 0` test
**RECOMMENDATION:** reject — keep. Pins behaviour of the override path even if unused today; future "disable sweep" code paths might use it.

## Non-Blocking Improvements

### N1. architecture.md not updated
**RECOMMENDATION:** defer — small docs follow-up; commit alongside the next architecture-affecting change.

### N2. Admin-bypass log volume
No change needed — within budget.

### N3. Logger event name consistency
No change needed — follows precedent.

### N4. JSONB operator choice
No change needed — sibling `resumeJob` uses the same `->>` + `ANY(text[])` form.

## Verdict

Block on B1 — fix + re-verify. Apply S4 inline. S1-S3 deferred to backlog. N1 deferred.
