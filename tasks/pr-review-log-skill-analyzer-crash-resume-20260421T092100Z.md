```pr-review-log
# PR Review Log

**Branch:** bugfixes-april26
**Files reviewed:**
- `server/config/limits.ts`
- `server/index.ts`
- `server/jobs/skillAnalyzerJob.ts`
- `server/services/skillAnalyzerService.ts`

**Reviewed:** 2026-04-21T11:20:00Z
**Reviewer:** pr-reviewer (independent session)

---

## Blocking Issues

### 1. `listResultIndicesForJob` returns undeduped rows — resume seeding loop can push duplicate `classifiedResults` entries

**Files:** `server/services/skillAnalyzerService.ts:1881–1888`, `server/jobs/skillAnalyzerJob.ts:551–574`

`listResultIndicesForJob` is a bare `SELECT candidateIndex, classification FROM skill_analyzer_results WHERE job_id = $1` with no `DISTINCT` and no deduplication. `skill_analyzer_results` has no `UNIQUE(job_id, candidate_index)` constraint (confirmed in `migrations/0092_skill_analyzer.sql`).

Two rows for the same `candidateIndex` can exist if, for example, a run prior to this PR (which did call `clearResultsForJob`) left a partial state, or if `insertSingleResult` was called and committed successfully for a given index and then the process crashed before completion, and a second retry then also called `insertSingleResult` for that index (now impossible with the resume guard, but history can predate the guard).

When `existingResultRows` contains two entries for the same `candidateIndex`, the `for (const existing of existingResultRows)` seeding loop at job:551 pushes **two entries** into `classifiedResults` for the same index. If those two rows have different `classification` values (DISTINCT vs PARTIAL_OVERLAP is the worst case), Stage 7 agent-propose and Stage 8 backfill would process contradictory instructions for the same candidate.

Concretely:
- Stage 7 `classifiedDistinct` (job:1345) calls `updateResultAgentProposals` twice for the same `candidateIndex` — the second call overwrites the first (idempotent by content but wastes two DB round-trips).
- Stage 7b `distinctIndicesToEnrich` uses a `Set<number>` so it deduplicates correctly.
- Stage 8's `completedCandidateIndices` Set deduplicates the skip filter correctly.
- The `classifiedResults` array itself ends up with two entries for the same index, with the second entry's `classification` value being the one visible to Stage 7b's `classifiedDistinct` filter.

**Fix — option A (preferred, in the service):**

```typescript
// server/services/skillAnalyzerService.ts:1878
export async function listResultIndicesForJob(
  jobId: string,
): Promise<Array<{ candidateIndex: number; classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT' }>> {
  const rows = await db
    .select({
      candidateIndex: skillAnalyzerResults.candidateIndex,
      classification: skillAnalyzerResults.classification,
    })
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.jobId, jobId));

  // Deduplicate by candidateIndex — no UNIQUE(job_id, candidate_index)
  // constraint exists; duplicate rows are possible on pathological retries.
  const seen = new Set<number>();
  return rows.filter(r => !seen.has(r.candidateIndex) && seen.add(r.candidateIndex));
}
```

---

### 2. Stage 8 dedup filter contains a dead guard that is misleading (server/jobs/skillAnalyzerJob.ts:1334–1336)

```typescript
const resultRowsToWrite = resultRows.filter(
  (row) => row.candidateIndex === undefined ||  // ← this branch is unreachable
           !completedCandidateIndices.has(row.candidateIndex),
);
```

`candidateIndex` is a non-nullable required field in `typeof skillAnalyzerResults.$inferInsert`. It is never `undefined`. The `=== undefined` branch is dead code. It is harmless but misleading.

**Fix:**

```typescript
const resultRowsToWrite = resultRows.filter(
  (row) => !completedCandidateIndices.has(row.candidateIndex!),
);
```

---

## Strong Recommendations

### 3. `throw err` inside an EventEmitter callback should be replaced with an explicit `process.exit(1)` (server/index.ts:520–524)

The existing pattern relies on Node's internal EventEmitter emit machinery routing a throw-from-error-listener to `uncaughtException`. The real risk is a non-EADDRINUSE error arriving through the error event: if Node ever changes to route these as `unhandledRejection` (which currently logs and continues rather than exits), the server would silently run without a bound port.

**Recommended fix:**

```typescript
if (err.code === 'EADDRINUSE' && canRetryListen && attempt < MAX_LISTEN_RETRIES) {
  console.warn(`[SERVER] Port ${PORT} in use — retrying in ${LISTEN_RETRY_DELAY_MS / 1000}s [${attempt + 1}/${MAX_LISTEN_RETRIES}]`);
  setTimeout(() => listenWithRetry(attempt + 1), LISTEN_RETRY_DELAY_MS);
  return;
}
console.error(`[SERVER] Fatal: cannot bind port ${PORT} after ${attempt} attempts — ${err.code}: ${err.message}`);
process.exit(1);
```

---

### 4. Stage 1 defensive fallback for paste/upload with empty `parsedCandidates` produces a misleading error (server/jobs/skillAnalyzerJob.ts:122–125)

When this branch is hit, `candidates` is `[]`, and the job fails at line 144 with "No valid skill definitions found in the provided input." — a message that implies the user's input was bad, not that the DB row is corrupt.

**Recommended fix:**

```typescript
} else if (job.sourceType === 'paste' || job.sourceType === 'upload') {
  await updateJobProgress(jobId, {
    status: 'failed',
    errorMessage: 'parsedCandidates is missing on this job row — re-submit the analysis.',
  });
  return;
}
```

---

### 5. Missing test coverage for crash-resume with mixed Stage-5 prior completions

Test coverage gap for the mixed-classification resume scenario. Recommended location: `server/services/__tests__/skillAnalyzerJobResumePure.test.ts`.

---

## Non-Blocking Improvements

### 6. Progress formula denominator documentation

Add a short comment at job:1178 explaining that `llmQueue.length` (not `resumedLlmQueue.length`) is intentional for consistent 60→90% band.

### 7. Type-safety guard on storedCandidates

The `as ParsedSkill[]` cast is unverified. Predates PR, low priority.

---

## Verdict

Two blocking issues require fixes before merge:
1. Dedupe in `listResultIndicesForJob`.
2. Remove dead `=== undefined` guard in Stage 8 filter.

Core crash-resume logic is sound; the listen-retry loop is functionally correct in the happy path.
```
