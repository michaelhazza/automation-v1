# Skill Analyzer — Processing UX & Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-skill classification rows with stale detection, a 60s per-call timeout, incremental result writes, and structured logging to the Skill Analyzer processing page.

**Architecture:** One new JSONB column (`classify_state`) on `skill_analyzer_jobs` tracks which skills are queued vs. in-flight during Stage 5. LLM result rows are inserted immediately as each call completes (instead of batch at end). The frontend derives per-skill UI state from `classifyState.inFlight` + the live `results` array returned by every poll. Timeout is `Promise.race` wrapping `withBackoff` — no changes to `withBackoff` or `anthropicAdapter` needed.

**Tech Stack:** PostgreSQL / Drizzle ORM, pg-boss, Node.js, React, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `migrations/XXXX_skill_analyzer_classify_state.sql` | Create — ADD COLUMN |
| `server/db/schema/skillAnalyzerJobs.ts` | Modify — add `classifyState` field + `ClassifyState` interface |
| `server/config/limits.ts` | Modify — add `SKILL_CLASSIFY_TIMEOUT_MS` |
| `server/services/skillAnalyzerService.ts` | Modify — extend `updateJobProgress`; add `insertSingleResult`, `markSkillInFlight`, `unmarkSkillInFlight` |
| `server/services/skillAnalyzerServicePure.ts` | Modify — extend `deriveClassificationFailureReason` for `'timed_out'` |
| `server/jobs/skillAnalyzerJob.ts` | Modify — Stage 5 queue write; per-call mark/timeout/insert/unmark/log; Stage 8 remove LLM rows |
| `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` | Modify — add `classifyState` to `AnalysisJob` interface |
| `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx` | Modify — per-skill rows, `liveResults` state, stale guards, ticker |

---

### Task 1: Migration, schema column, and limits constant

**Files:**
- Create: `migrations/XXXX_skill_analyzer_classify_state.sql` (replace XXXX with next sequence: `ls migrations/ | tail -5` to find it)
- Modify: `server/db/schema/skillAnalyzerJobs.ts`
- Modify: `server/config/limits.ts`

- [ ] **Step 1: Find the next migration sequence number**

```bash
ls migrations/ | sort | tail -5
```

Note the highest number shown (e.g. `0114_...`), then use the next one (e.g. `0115`).

- [ ] **Step 2: Create the migration file**

```sql
-- migrations/0115_skill_analyzer_classify_state.sql
ALTER TABLE skill_analyzer_jobs
  ADD COLUMN classify_state jsonb NOT NULL DEFAULT '{}';
```

- [ ] **Step 3: Add `ClassifyState` interface and Drizzle field**

In `server/db/schema/skillAnalyzerJobs.ts`, add the interface before the table definition:

```typescript
export interface ClassifyState {
  queue?: string[];                   // slugs entering LLM queue, written once at Stage 5 start
  inFlight?: Record<string, number>;  // slug → startedAtMs (server Date.now())
}
```

Then add the column inside the table columns object (after `parsedCandidates`):

```typescript
classifyState: jsonb('classify_state').$type<ClassifyState>().notNull().default({}),
```

- [ ] **Step 4: Add the timeout limit constant**

In `server/config/limits.ts`, add after the existing skill analyzer constants:

```typescript
/** Maximum ms budget for a single skill LLM classification call, including all withBackoff retries. */
export const SKILL_CLASSIFY_TIMEOUT_MS = 60_000;
```

- [ ] **Step 5: Run generate and typecheck**

```bash
npm run db:generate
npm run typecheck
```

Expected: migration snapshot file updated, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add migrations/ server/db/schema/skillAnalyzerJobs.ts server/config/limits.ts
git commit -m "feat: add classify_state column and SKILL_CLASSIFY_TIMEOUT_MS"
```

---

### Task 2: Extend `updateJobProgress` to accept `classifyState`

**Files:**
- Modify: `server/services/skillAnalyzerService.ts`

- [ ] **Step 1: Read the current `updateJobProgress` signature**

Open `server/services/skillAnalyzerService.ts` and find the `updateJobProgress` function. Note the existing update parameter type.

- [ ] **Step 2: Add `classifyState` to the update param type and import**

Add to the update parameter object type:

```typescript
classifyState?: ClassifyState;
```

Add to the import from the schema file at the top:

```typescript
import { ..., ClassifyState } from '../db/schema/skillAnalyzerJobs.js';
```

No changes needed to the function body — Drizzle serialises JSONB values automatically.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/services/skillAnalyzerService.ts
git commit -m "feat: extend updateJobProgress to accept classifyState"
```

---

### Task 3: Add `insertSingleResult`, `markSkillInFlight`, `unmarkSkillInFlight` to service

**Files:**
- Modify: `server/services/skillAnalyzerService.ts`

- [ ] **Step 1: Add `insertSingleResult`**

Add after `insertResults` in `server/services/skillAnalyzerService.ts`:

```typescript
export async function insertSingleResult(
  row: typeof skillAnalyzerResults.$inferInsert,
): Promise<void> {
  await db.insert(skillAnalyzerResults).values(row);
}
```

- [ ] **Step 2: Add `markSkillInFlight`**

The JSONB path is parameterized as a PostgreSQL text array — no `sql.raw` needed, fully injection-safe:

```typescript
export async function markSkillInFlight(
  jobId: string,
  slug: string,
  startedAtMs: number,
): Promise<void> {
  await db
    .update(skillAnalyzerJobs)
    .set({
      classifyState: sql`jsonb_set(
        coalesce(classify_state, '{}'),
        ARRAY['inFlight', ${slug}]::text[],
        ${String(startedAtMs)}::jsonb
      )`,
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));
}
```

- [ ] **Step 3: Add `unmarkSkillInFlight`**

```typescript
export async function unmarkSkillInFlight(
  jobId: string,
  slug: string,
): Promise<void> {
  await db
    .update(skillAnalyzerJobs)
    .set({
      classifyState: sql`classify_state #- ARRAY['inFlight', ${slug}]::text[]`,
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));
}
```

Ensure `sql` and `eq` are imported from `drizzle-orm` at the top of the service (they likely already are).

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/services/skillAnalyzerService.ts
git commit -m "feat: add insertSingleResult, markSkillInFlight, unmarkSkillInFlight"
```

---

### Task 4: Extend `deriveClassificationFailureReason` to handle `'timed_out'`

**Files:**
- Modify: `server/services/skillAnalyzerServicePure.ts`

- [ ] **Step 1: Read the current function**

Open `server/services/skillAnalyzerServicePure.ts` and find `deriveClassificationFailureReason`. It currently returns `'rate_limit' | 'parse_error' | 'unknown'`.

- [ ] **Step 2: Add `'timed_out'` to return type and handle it**

Update the return type and add a check for the timeout error code before the existing checks:

```typescript
deriveClassificationFailureReason(
  err: unknown,
): 'rate_limit' | 'parse_error' | 'timed_out' | 'unknown' {
  if (!err) return 'unknown';
  const e = err as { statusCode?: number; code?: string };
  if (e.code === 'CLASSIFY_TIMEOUT') return 'timed_out';   // ADD THIS LINE
  if (e.statusCode === 429) return 'rate_limit';
  // ... rest of existing logic unchanged
  return 'unknown';
}
```

- [ ] **Step 3: Update `ClassifiedResult` type in the job file**

In `server/jobs/skillAnalyzerJob.ts`, find the `ClassifiedResult` type definition. Update `classificationFailureReason`:

```typescript
classificationFailureReason: 'rate_limit' | 'parse_error' | 'timed_out' | 'unknown' | null;
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If the `skillAnalyzerResults` schema has a TypeScript union for `classificationFailureReason`, update it there too.

- [ ] **Step 5: Commit**

```bash
git add server/services/skillAnalyzerServicePure.ts server/jobs/skillAnalyzerJob.ts
git commit -m "feat: add timed_out classification failure reason"
```

---

### Task 5: Write `classifyState.queue` at Stage 5 start

**Files:**
- Modify: `server/jobs/skillAnalyzerJob.ts`

- [ ] **Step 1: Import new service functions**

At the top of `server/jobs/skillAnalyzerJob.ts`, extend the import from `skillAnalyzerService`:

```typescript
import {
  updateJobProgress,
  getJobById,
  clearResultsForJob,
  insertResults,
  insertSingleResult,       // ADD
  markSkillInFlight,        // ADD
  unmarkSkillInFlight,      // ADD
} from '../services/skillAnalyzerService.js';
```

Also import the new limit constant:

```typescript
import { SKILL_CLASSIFY_TIMEOUT_MS } from '../config/limits.js';
```

- [ ] **Step 2: Replace the Stage 5 opening `updateJobProgress` call**

Find the existing call at the start of Stage 5 (around line 403–409). Replace it:

```typescript
await updateJobProgress(jobId, {
  status: 'classifying',
  progressPct: 60,
  progressMessage: classificationFallback
    ? 'LLM classification unavailable - marking candidates for human review...'
    : 'Classifying with AI...',
  classifyState: {
    queue: llmQueue.map((m) => candidates[m.candidateIndex].slug),
    inFlight: {},
  },
});
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add server/jobs/skillAnalyzerJob.ts
git commit -m "feat: write classifyState.queue at Stage 5 start"
```

---

### Task 6: Per-call — timeout, mark/unmark, incremental insert, structured logs

**Files:**
- Modify: `server/jobs/skillAnalyzerJob.ts`

This is the largest change. Read the current `limit(async () => { ... })` body carefully before editing (lines ~496–625).

- [ ] **Step 1: Add `markSkillInFlight`, timeout, and structured log before the `withBackoff` call**

Inside the `limit(async () => {` body, immediately after the early-return guard for missing `matchedLib || candidate`, add before the `buildClassifyPromptWithMerge` call:

```typescript
const startMs = Date.now();
console.log('[SkillAnalyzer] classify:start', {
  jobId,
  slug: candidate.slug,
  candidateIndex: match.candidateIndex,
});
await markSkillInFlight(jobId, candidate.slug, startMs);

const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(
    () => reject(Object.assign(new Error('LLM classify timed out'), { code: 'CLASSIFY_TIMEOUT' })),
    SKILL_CLASSIFY_TIMEOUT_MS,
  )
);
```

- [ ] **Step 2: Wrap `withBackoff` in `Promise.race` and update `isRetryable`**

Find the existing `try { classificationResult = await withBackoff(...)` block. Wrap it:

```typescript
try {
  classificationResult = await Promise.race([
    withBackoff(
      async () => {
        const response = await anthropicAdapter.call({
          model: 'claude-sonnet-4-6',
          system,
          messages: [{ role: 'user', content: userMessage }],
          maxTokens: 8192,
          temperature: 0.1,
        });
        const parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
        if (parsed === null) throw PARSE_FAILURE;
        return parsed;
      },
      {
        label: `skill-classify-${match.candidateIndex}`,
        maxAttempts: 3,
        correlationId: jobId,
        runId: jobId,
        isRetryable: (err: unknown) => {
          if (err === PARSE_FAILURE) return true;
          const e = err as { statusCode?: number; code?: string };
          if (e?.code === 'PROVIDER_NOT_CONFIGURED') return false;
          if (e?.code === 'CLASSIFY_TIMEOUT') return false;   // NEW — don't retry timeout
          return (
            e?.statusCode === 429 ||
            e?.statusCode === 503 ||
            e?.statusCode === 529 ||
            e?.code === 'PROVIDER_UNAVAILABLE'
          );
        },
      }
    ),
    timeoutPromise,
  ]);
} catch (err) {
  classificationResult = null;
  classificationApiError = err === PARSE_FAILURE ? undefined : err;
}
```

- [ ] **Step 3: Add `insertSingleResult` + `unmarkSkillInFlight` + end log after `classifiedResults.push`**

After the existing `classifiedResults.push({ ... })` call, add:

```typescript
// Write result immediately — don't wait for Stage 8
await insertSingleResult({
  jobId,
  candidateIndex: r.candidateIndex,
  candidateName: r.candidate.name,
  candidateSlug: r.candidate.slug,
  candidateContentHash: getCandidateHash(r.candidateIndex),
  matchedSkillId: r.libraryId ?? undefined,
  classification: r.classification,
  confidence: r.confidence,
  similarityScore: r.similarityScore ?? undefined,
  classificationReasoning: r.classificationReasoning ?? undefined,
  diffSummary: r.diffSummary ?? undefined,
  proposedMergedContent: r.proposedMerge ?? undefined,
  originalProposedMerge: r.proposedMerge ?? undefined,
  classificationFailed: r.classificationFailed ?? false,
  classificationFailureReason: r.classificationFailureReason ?? null,
});

await unmarkSkillInFlight(jobId, candidate.slug);

console.log('[SkillAnalyzer] classify:end', {
  jobId,
  slug: candidate.slug,
  durationMs: Date.now() - startMs,
  classification: finalResult.classification,
  failed: classificationFailed,
  failureReason: classificationFailureReason ?? undefined,
});
```

Note: the code above uses `r.*` for clarity. In the actual job code, these values are local variables at this point in the function — use them directly: `candidateIndex` is `match.candidateIndex`, `classification` is `finalResult.classification`, `confidence` is `finalResult.confidence`, `proposedMerge` is `finalResult.proposedMerge`, `classificationFailed` and `classificationFailureReason` are the local variables computed just above. Map them from the existing `classifiedResults.push({ ... })` call — the fields are identical.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/jobs/skillAnalyzerJob.ts
git commit -m "feat: add timeout, incremental inserts, and structured logs to classify stage"
```

---

### Task 7: Remove LLM rows from Stage 8

**Files:**
- Modify: `server/jobs/skillAnalyzerJob.ts`

- [ ] **Step 1: Find the Stage 8 `classifiedResults` loop**

In Stage 8 (Write Results), there is a `for (const r of classifiedResults)` loop that pushes rows into `resultRows`. Remove that entire loop — those rows are now written in Task 6.

The `resultRows` array and its bulk `insertResults(resultRows)` call remain for `exactDuplicates` and `distinctResults` only.

- [ ] **Step 2: Verify `classifiedResults` is still populated in memory**

The `classifiedResults` array is still needed by Stage 7 (Agent-propose) which iterates over it to find `classification === 'DISTINCT'` entries for agent ranking. Confirm it is still being pushed to inside the `limit()` body — only the `insertSingleResult` call is new, the push is unchanged.

- [ ] **Step 3: Run lint, typecheck, and tests**

```bash
npm run lint
npm run typecheck
npm test
```

Expected: all pass. If any test references the old batch-insert behaviour of classified results, update it to reflect the new incremental write.

- [ ] **Step 4: Commit**

```bash
git add server/jobs/skillAnalyzerJob.ts
git commit -m "feat: remove deferred LLM row insert from Stage 8 (now written incrementally)"
```

---

### Task 8: Frontend — `AnalysisJob` type + `liveResults` state

**Files:**
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx`
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx`

- [ ] **Step 1: Add `classifyState` to `AnalysisJob` interface**

In `SkillAnalyzerWizard.tsx`, find the `AnalysisJob` interface (around line 61). Add:

```typescript
classifyState?: {
  queue?: string[];
  inFlight?: Record<string, number>; // slug → startedAtMs (server ms)
} | null;
```

- [ ] **Step 2: Add `liveResults` state and update the polling callback**

In `SkillAnalyzerProcessingStep.tsx`, add to the existing state declarations:

```typescript
const [liveResults, setLiveResults] = useState<AnalysisResult[]>([]);
```

Find the polling `useEffect` — specifically where a successful poll response is processed. After the job state is updated, add:

```typescript
setLiveResults(data.results ?? []);
```

This must happen on every successful poll, not just when the job reaches a terminal state. The existing `onComplete(job, results)` call at terminal state is unchanged.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx
git commit -m "feat: add classifyState to AnalysisJob type and liveResults polling state"
```

---

### Task 9: Frontend — per-skill rows panel

**Files:**
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx`

- [ ] **Step 1: Add `deriveRowStatus` helper**

Add this pure function at the top of the file (outside the component):

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

- [ ] **Step 2: Add the failure reason label helper**

```typescript
function failureReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'timed_out':   return 'timed out';
    case 'rate_limit':  return 'rate limited';
    case 'parse_error': return 'parse error';
    default:            return 'classification failed';
  }
}
```

- [ ] **Step 3: Add `nowMs` state and 1s interval**

Inside the component, add:

```typescript
const [nowMs, setNowMs] = useState<number>(Date.now());

useEffect(() => {
  const id = setInterval(() => setNowMs(Date.now()), 1_000);
  return () => clearInterval(id);
}, []);
```

- [ ] **Step 4: Render the per-skill rows panel**

In the render, find the block that shows the progress bar and spinner during `classifying` status. Wrap it so that when `classifyQueue.length > 0` the rows panel shows instead of the spinner:

```typescript
const classifyQueue = job.classifyState?.queue ?? [];
const inFlight = job.classifyState?.inFlight ?? {};

// Replace or supplement the existing spinner block:
{job.status === 'classifying' && classifyQueue.length > 0 ? (
  <div className="mt-4 space-y-1 max-h-80 overflow-y-auto">
    {classifyQueue.map((slug) => {
      const status = deriveRowStatus(slug, liveResults, inFlight, nowMs);
      const result = liveResults.find((r) => r.candidateSlug === slug);
      return (
        <div
          key={slug}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
            status === 'done'        ? 'bg-green-950 text-green-200' :
            status === 'failed'      ? 'bg-red-950 text-red-300' :
            status === 'stale'       ? 'bg-amber-950 text-amber-300' :
            status === 'classifying' ? 'bg-indigo-950 text-indigo-200' :
                                       'bg-zinc-900 text-zinc-500'
          }`}
        >
          <span className="w-4 text-center shrink-0">
            {status === 'done'        ? <span>✓</span> :
             status === 'failed'      ? <span>✗</span> :
             status === 'stale'       ? <span>●</span> :
             status === 'classifying' ? <span className="animate-pulse">●</span> :
                                        <span>○</span>}
          </span>
          <span className="flex-1 truncate font-mono text-xs">{slug}</span>
          <span className="text-xs shrink-0">
            {status === 'done'        ? (result?.classification ?? '') :
             status === 'failed'      ? failureReasonLabel(result?.classificationFailureReason) :
             status === 'stale'       ? 'stalled >30s' :
             status === 'classifying' ? 'classifying…' : 'queued'}
          </span>
        </div>
      );
    })}
  </div>
) : (
  // The existing spinner/loading JSX goes here — leave it exactly as-is.
  // Only the wrapping conditional is new; the else branch is the original content.
  null /* replace this null with the original spinner block from the file */
)}
```

Keep the progress bar above this block (it renders regardless).

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: no TypeScript or build errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx
git commit -m "feat: add per-skill classification rows to processing step"
```

---

### Task 10: Frontend — aggregate stale banner and "last updated" ticker

**Files:**
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx`

- [ ] **Step 1: Add `lastProgressAt` state and track it per poll**

Add state:

```typescript
const [lastProgressAt, setLastProgressAt] = useState<number>(Date.now());
```

In the polling callback, after updating the job state, compare `job.updatedAt` with the previously seen value. If it changed, update `lastProgressAt`:

```typescript
// Inside the poll success handler, after setJob(newJob):
setLastProgressAt((prev) => {
  const newTs = new Date(data.job.updatedAt).getTime();
  return newTs > prev ? newTs : prev;
});
```

- [ ] **Step 2: Render the aggregate stale banner**

Below the per-skill rows panel (or below the existing spinner block), add:

```typescript
{job.status === 'classifying' && nowMs - lastProgressAt > 45_000 && (
  <div className="mt-3 flex items-start gap-2 rounded border border-amber-700 bg-amber-950 px-3 py-2 text-sm text-amber-300">
    <span className="shrink-0">⚠</span>
    <span>
      No progress for over 45s — one or more classification calls may be stalled.
      The job will auto-recover via timeout within 60s.
    </span>
  </div>
)}
```

- [ ] **Step 3: Render the "last updated" ticker**

Below the stale banner, add:

```typescript
{job.status === 'classifying' && (
  <p className="mt-2 text-xs text-zinc-500">
    Last update:{' '}
    {(() => {
      const diffS = Math.floor((nowMs - new Date(job.updatedAt).getTime()) / 1_000);
      return diffS < 60 ? `${diffS}s ago` : `${Math.floor(diffS / 60)}m ago`;
    })()}
  </p>
)}
```

- [ ] **Step 4: Build and typecheck**

```bash
npm run typecheck && npm run build
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx
git commit -m "feat: add stale guard and last-updated ticker to processing step"
```

---
