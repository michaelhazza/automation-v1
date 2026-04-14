# Skill Analyzer — Processing UX & Reliability

**Date:** 2026-04-14
**Status:** Draft — pending user review
**Classification:** Standard
**Affects:** `server/db/schema/skillAnalyzerJobs.ts`, `server/services/skillAnalyzerService.ts`, `server/jobs/skillAnalyzerJob.ts`, `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx`

---

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Design Principles & Constraints](#2-design-principles--constraints)
- [3. Schema Changes](#3-schema-changes)
- [4. Service Layer](#4-service-layer)
- [5. Job Changes — Backend](#5-job-changes--backend)
- [6. Frontend Changes](#6-frontend-changes)
- [7. Implementation Plan](#7-implementation-plan)
- [8. Verification Checklist](#8-verification-checklist)

---

## 1. Problem Statement

The Skill Analyzer processing page gives almost no useful feedback during the longest stage (LLM classification). The user sees "Classified 11 / 16" ticking up every few seconds, then nothing — no indication of which skills are being processed, which are queued, or whether the job has silently stalled. When a job does lock up (as observed: stuck at 81% for 9+ minutes), there is no automatic detection, no inline error information, and no server-side record of which specific call hung.

Root causes identified:

| Issue | Root cause |
|-------|-----------|
| No per-skill visibility | LLM calls run in a `Promise.all` pool; results are batch-inserted only at the end (Stage 8), so the poll endpoint returns no partial results during classification |
| No stale detection | The UI has no concept of "last meaningful update" — it shows the same spinner whether the job updated 2 seconds ago or 9 minutes ago |
| Jobs hang indefinitely | `anthropicAdapter.call()` has no timeout; a single stalled HTTP connection freezes all 5 concurrent slots if they share the same stall condition, or one slot silently for the entire `expireInSeconds: 900` window |
| No diagnostic trail | There is no structured per-call logging; when a job fails it is impossible to identify which skill caused the hang or how long it was in flight |

This spec addresses all four.

---

## 2. Design Principles & Constraints

1. **Meet the user where they are.** All diagnostic information surfaces inline on the processing page — no separate admin view required.
2. **Incremental, not rearchitected.** The polling mechanism stays (2s interval is fine given 5–15s LLM call durations). No WebSocket infrastructure.
3. **Atomic JSONB writes.** The `p-limit(5)` concurrency pool means up to 5 concurrent writes to `classifyState`. Each write targets only its own slug key using Drizzle `sql` template JSONB operators — no read-modify-write race.
4. **Timeout without AbortSignal.** Neither `withBackoff` nor `anthropicAdapter` support `AbortSignal`. Timeout is implemented via `Promise.race` wrapping the entire `withBackoff` call. The underlying HTTP request may continue in the background until the server closes it, but the job slot is unblocked within the timeout window.
5. **Incremental result writes.** LLM-classified results are inserted individually as each call completes. Exact duplicate and distinct result rows continue to be written in Stage 8. This means partial results are visible during classification without changing Stage 8's responsibility for non-LLM rows.
6. **No new tables.** All new state fits in a single JSONB column on the existing job row.

### Key constraints from codebase audit

- `withBackoff` (`server/lib/withBackoff.ts`): no `AbortSignal` support — timeout must be external `Promise.race`
- `anthropicAdapter.call()` (`server/services/providers/anthropicAdapter.ts`): no `signal` parameter — same constraint
- `updateJobProgress` (`server/services/skillAnalyzerService.ts`): accepts a partial update object; needs one new field added
- `AnalysisJob` client interface (`SkillAnalyzerWizard.tsx` lines 61–81): needs `classifyState` field added
- Skill analyzer job files have no recent changes — clean baseline

---

## 3. Schema Changes

### Migration: next available sequence number

File: `migrations/XXXX_skill_analyzer_classify_state.sql`

```sql
ALTER TABLE skill_analyzer_jobs
  ADD COLUMN classify_state jsonb NOT NULL DEFAULT '{}';
```

No index needed — `classifyState` is only read as part of the full job row fetch (`getJob`), never queried independently.

### Drizzle schema: `server/db/schema/skillAnalyzerJobs.ts`

Add one field to the existing table definition:

```typescript
classifyState: jsonb('classify_state').notNull().default({}),
```

### TypeScript shape of `classifyState`

```typescript
interface ClassifyState {
  queue?: string[];                        // slugs entering LLM classification, written once at Stage 5 start
  inFlight?: Record<string, number>;       // slug → startedAtMs, updated atomically per-call
}
```

`queue` is written once and never mutated after Stage 5 begins. `inFlight` is the only field that changes during processing. Completed skills are not tracked here — their presence in the `results` array (returned by the poll endpoint) is the completion signal.

---

## 4. Service Layer

### 4.1 `updateJobProgress` — add `classifyState` field

Extend the existing update parameter type:

```typescript
classifyState?: ClassifyState;
```

The function already sets `updatedAt: new Date()` on every call. No other changes needed to the function body — Drizzle handles JSONB serialisation.

### 4.2 New: `insertSingleResult`

```typescript
export async function insertSingleResult(
  row: typeof skillAnalyzerResults.$inferInsert
): Promise<void>
```

A thin wrapper around a single-row insert. Used by the classify loop to write each result as it completes. The existing `insertResults` (bulk, 100-row batched) is retained for Stage 8.

### 4.3 New: `markSkillInFlight`

Atomically adds a slug to `classifyState.inFlight` without reading the current value first:

```typescript
export async function markSkillInFlight(
  jobId: string,
  slug: string,
  startedAtMs: number
): Promise<void>
```

Implementation uses a Drizzle `sql` template:

```typescript
await db.update(skillAnalyzerJobs)
  .set({
    classifyState: sql`jsonb_set(
      coalesce(classify_state, '{}'),
      '{inFlight,${sql.raw(slug)}}',
      ${startedAtMs}::jsonb
    )`,
    updatedAt: new Date(),
  })
  .where(eq(skillAnalyzerJobs.id, jobId));
```

### 4.4 New: `unmarkSkillInFlight`

Atomically removes a slug from `classifyState.inFlight`:

```typescript
export async function unmarkSkillInFlight(
  jobId: string,
  slug: string
): Promise<void>
```

Implementation:

```typescript
await db.update(skillAnalyzerJobs)
  .set({
    classifyState: sql`classify_state #- '{inFlight,${sql.raw(slug)}}'`,
    updatedAt: new Date(),
  })
  .where(eq(skillAnalyzerJobs.id, jobId));
```

The `#-` operator removes a key from a JSONB object. Both operations are safe under concurrent writes because each call touches only its own slug key — there is no read-modify-write cycle.

**Note on slug safety in `sql.raw`:** Slugs are generated by the LLM via `skillParserServicePure` and normalised to `[a-z0-9_-]` before reaching the database. The `sql.raw` usage is safe for this character set. If slug validation ever changes, this must be revisited.

---

## 5. Job Changes — Backend

All changes are confined to `server/jobs/skillAnalyzerJob.ts` and `server/config/limits.ts`.

### 5.1 New limit constant

Add to `server/config/limits.ts`:

```typescript
export const SKILL_CLASSIFY_TIMEOUT_MS = 60_000; // per-call budget including withBackoff retries
```

### 5.2 Stage 5: write `queue` before starting `Promise.all`

At the top of Stage 5, before `Promise.all` begins, write `classifyState.queue` (the list of slugs entering LLM classification) and initialise `inFlight` to `{}`:

```typescript
await updateJobProgress(jobId, {
  status: 'classifying',
  progressPct: 60,
  progressMessage: 'Classifying with AI...',
  classifyState: {
    queue: llmQueue.map((m) => candidates[m.candidateIndex].slug),
    inFlight: {},
  },
});
```

`queue` is never written again. It is the frontend's source of truth for which skills are in the LLM pipeline.

### 5.3 Per-call: `markSkillInFlight` + timeout + `insertSingleResult` + `unmarkSkillInFlight`

Replace the inner `limit(async () => { ... })` body with this sequence:

```
1. await markSkillInFlight(jobId, candidate.slug, Date.now())
   [structured log: classify:start { slug, candidateIndex, jobId }]

2. const startMs = Date.now();
   const timeoutPromise = new Promise<never>((_, reject) =>
     setTimeout(() => reject(Object.assign(
       new Error('LLM classify timed out'),
       { code: 'CLASSIFY_TIMEOUT' }
     )), SKILL_CLASSIFY_TIMEOUT_MS)
   );

3. let classificationResult / classificationApiError — same logic as today, but:
   - isRetryable guard adds: if (e?.code === 'CLASSIFY_TIMEOUT') return false;
   - Entire withBackoff call is wrapped: await Promise.race([withBackoff(...), timeoutPromise])

4. On timeout catch: set classificationResult = null, classificationApiError = timeoutError
   (the existing null-result fallback path then applies — PARTIAL_OVERLAP for human review,
    classificationFailed: true, classificationFailureReason: 'timed_out')

5. Determine finalResult (same logic as today)

6. await insertSingleResult({ ...row })   ← NEW: write immediately, not deferred to Stage 8

7. await unmarkSkillInFlight(jobId, candidate.slug)   ← NEW: atomic remove

8. [structured log: classify:end { slug, durationMs: Date.now() - startMs, classification, failed }]

9. classifiedCount++; updateJobProgress({ progressPct, progressMessage })  ← same as today
```

The `classifiedResults` array is still populated in memory (needed for Stage 8's agent-proposal lookup), but result rows are no longer deferred — they are in the DB as each call finishes.

### 5.4 Stage 8: skip LLM rows

Stage 8 (Write Results) currently builds `resultRows` from three sources: `exactDuplicates`, `distinctResults`, and `classifiedResults`. After this change, `classifiedResults` rows are already in the DB. Stage 8 only inserts `exactDuplicates` and `distinctResults` rows via the existing bulk `insertResults`. The `classifiedResults` loop in Stage 8 is removed.

### 5.5 Structured logging

Two `console.log` calls per LLM classification call:

```typescript
// Before call
console.log('[SkillAnalyzer] classify:start', { jobId, slug: candidate.slug, candidateIndex: match.candidateIndex });

// After call (success or failure)
console.log('[SkillAnalyzer] classify:end', {
  jobId,
  slug: candidate.slug,
  durationMs: Date.now() - startMs,
  classification: finalResult.classification,
  failed: classificationFailed,
  failureReason: classificationFailureReason ?? undefined,
});
```

These are `console.log`, not `console.warn/error`, except for actual errors which use `console.error`. This keeps the log level semantics consistent with the rest of the job.

---

## 6. Frontend Changes

All changes are in `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx`. No other frontend files change except the `AnalysisJob` type definition in `SkillAnalyzerWizard.tsx`.

### 6.1 `AnalysisJob` type — add `classifyState`

In `SkillAnalyzerWizard.tsx`, add to the `AnalysisJob` interface:

```typescript
classifyState?: {
  queue?: string[];
  inFlight?: Record<string, number>; // slug → startedAtMs
} | null;
```

### 6.2 `SkillAnalyzerProcessingStep` — per-skill rows

The component receives `job: AnalysisJob` and `results: AnalysisResult[]` from the poll response (already available via `onComplete` callback). The poll response already returns `results` — these are partial during classification after this change.

**State additions:**

```typescript
const [lastProgressAt, setLastProgressAt] = useState<number>(Date.now());
const [nowMs, setNowMs] = useState<number>(Date.now());
const [liveResults, setLiveResults] = useState<AnalysisResult[]>([]);
```

- `lastProgressAt`: updated whenever `job.updatedAt` changes between polls. Used for the aggregate stale guard.
- `nowMs`: updated every 1s by a `useEffect` interval. Used for per-row age calculation and "last updated X ago" display.
- `liveResults`: updated on every successful poll response (not just terminal state). The current component only passes `results` to `onComplete` at job completion — this needs to be tracked throughout so the per-skill rows can reflect completed classifications as they arrive. On each poll, set `setLiveResults(results)`. Pass `liveResults` (not `results` from `onComplete`) to `deriveRowStatus`.

**Per-skill row derivation** (computed during render, not stored in state):

```typescript
type SkillRowStatus = 'done' | 'classifying' | 'stale' | 'failed' | 'queued';

function deriveRowStatus(
  slug: string,
  results: AnalysisResult[],
  inFlight: Record<string, number>,
  nowMs: number,
): SkillRowStatus {
  const result = results.find((r) => r.candidateSlug === slug);
  if (result) return result.classificationFailed ? 'failed' : 'done';
  const startedAt = inFlight[slug];
  if (startedAt !== undefined) {
    return nowMs - startedAt > 30_000 ? 'stale' : 'classifying';
  }
  return 'queued';
}
```

**Aggregate stale guard:** rendered when `nowMs - lastProgressAt > 45_000` AND `job.status === 'classifying'`:

```
⚠ No progress for over 45s — one or more classification calls may be stalled.
  The job will auto-recover via timeout within 60s.
```

**"Last updated" ticker:** displayed below the rows:

```
Last update: Xs ago
```

Computed from `nowMs - new Date(job.updatedAt).getTime()`, formatted as seconds (< 60s) or minutes.

**Render logic:**

```
if (job.status === 'classifying' && classifyQueue.length > 0) {
  → render per-skill rows panel
} else {
  → render existing progress bar + spinner (unchanged)
}
```

`classifyQueue` = `job.classifyState?.queue ?? []`.

### 6.3 Per-skill row visual spec

Each row contains: status icon | skill slug | status label | (if failed) failure reason chip

| Status | Icon | Label colour | Label text |
|--------|------|-------------|-----------|
| `queued` | `○` muted | muted | "queued" |
| `classifying` | `●` indigo pulse | indigo | "classifying…" |
| `stale` | `●` amber | amber | "stalled >30s" |
| `done` | `✓` green | classification colour | DISTINCT / PARTIAL OVERLAP / IMPROVEMENT / DUPLICATE |
| `failed` | `✗` red | red | failure reason (e.g. "timed out", "rate limited", "parse error") |

Failure reason values map from `classificationFailureReason` DB field:
- `'timed_out'` → "timed out"
- `'rate_limit'` → "rate limited"
- `'parse_error'` → "parse error"
- `'unknown'` → "classification failed"
- `null` (classificationFailed = false) → not shown

The rows list is scrollable with a max-height of `320px` — enough to show ~10 rows before scrolling.

The overall job progress bar and phase label remain above the rows panel, giving dual-level visibility: macro (overall %) and micro (per-skill).

---

## 7. Implementation Plan

### Files changed

| File | Action | Description |
|------|--------|-------------|
| `migrations/XXXX_skill_analyzer_classify_state.sql` | Create | `ALTER TABLE skill_analyzer_jobs ADD COLUMN classify_state jsonb NOT NULL DEFAULT '{}'` |
| `server/db/schema/skillAnalyzerJobs.ts` | Modify | Add `classifyState` field |
| `server/services/skillAnalyzerService.ts` | Modify | Add `classifyState` to `updateJobProgress` params; add `insertSingleResult`, `markSkillInFlight`, `unmarkSkillInFlight` |
| `server/config/limits.ts` | Modify | Add `SKILL_CLASSIFY_TIMEOUT_MS = 60_000` |
| `server/jobs/skillAnalyzerJob.ts` | Modify | Write `classifyState.queue` at Stage 5 start; add timeout + `markSkillInFlight` + `insertSingleResult` + `unmarkSkillInFlight` per call; add structured logs; remove `classifiedResults` loop from Stage 8 |
| `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` | Modify | Add `classifyState` to `AnalysisJob` interface |
| `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx` | Modify | Add per-skill rows panel, stale guards, "last updated" ticker |

### Phases

**Phase 1 — Backend (1 day):**
1. Migration + schema + `classifyState` field on Drizzle schema
2. `insertSingleResult`, `markSkillInFlight`, `unmarkSkillInFlight` in service
3. `SKILL_CLASSIFY_TIMEOUT_MS` in limits
4. Job: write queue at Stage 5 start, per-call mark/unmark + timeout + incremental insert + structured logs
5. Job: remove `classifiedResults` loop from Stage 8
6. Run `npm run db:generate` and verify migration

**Phase 2 — Frontend (0.5 day):**
7. Add `classifyState` to `AnalysisJob` type
8. Add per-skill rows panel to `SkillAnalyzerProcessingStep`
9. Add stale guards + "last updated" ticker
10. Run `npm run typecheck` and `npm run build`

### Total effort: 1.5 days

---

## 8. Verification Checklist

### Schema & backend
- [ ] Migration applies cleanly: `npm run migrate`
- [ ] `npm run db:generate` produces no unexpected diff
- [ ] `npm run typecheck` passes with no new errors
- [ ] `classifyState.queue` is written once at Stage 5 start and contains the correct slugs (those in `llmQueue`, not exact duplicates or distinct)
- [ ] `classifyState.inFlight` adds a slug when a call starts and removes it when it completes or fails
- [ ] `markSkillInFlight` and `unmarkSkillInFlight` are atomic: running both concurrently for different slugs does not corrupt the JSONB object
- [ ] `insertSingleResult` writes a result row immediately on LLM call completion — poll endpoint returns it on next request (within 2s)
- [ ] Stage 8 no longer inserts LLM-classified rows (they are already in DB); no duplicate rows
- [ ] Timeout fires at 60s: a simulated hanging call results in `classificationFailed: true` and `classificationFailureReason: 'timed_out'` on the result row
- [ ] Job continues after a timeout — remaining skills are classified, job reaches `completed`
- [ ] `classify:start` log emitted before each LLM call with `{ jobId, slug, candidateIndex }`
- [ ] `classify:end` log emitted after each call with `{ jobId, slug, durationMs, classification, failed }`
- [ ] `withBackoff` `isRetryable` guard correctly rejects `CLASSIFY_TIMEOUT` code (timeout is not retried)

### Frontend
- [ ] During non-classifying stages: existing progress bar + spinner renders unchanged
- [ ] During `classifying`: per-skill rows panel replaces spinner
- [ ] Queued skills show muted "queued" state
- [ ] In-flight skills show indigo pulsing "classifying…"
- [ ] In-flight skill stalled >30s shows amber "stalled >30s"
- [ ] Completed skill shows green ✓ with classification label
- [ ] Failed skill shows red ✗ with human-readable failure reason
- [ ] Aggregate stale banner appears after 45s with no `job.updatedAt` change
- [ ] "Last updated X ago" ticker updates every second
- [ ] Rows list is scrollable at max-height 320px when >10 skills
- [ ] `liveResults` state is updated on every poll (not just terminal state) — per-skill rows update in real time as calls complete
- [ ] After job completes, `onComplete` is called as before — results step loads correctly
- [ ] `npm run build` passes with no new TypeScript errors
