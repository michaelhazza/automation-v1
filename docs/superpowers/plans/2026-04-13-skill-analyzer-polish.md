# Skill Analyzer Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three issues in the Skill Analyzer: classification accuracy (DUPLICATE too permissive), LLM failure resilience (no retry on 429 + no retry path for failed rows), and new-skill import UX (misleading handler error, manual code step per imported skill).

**Architecture:** Prompt-only fix for classification. New `classificationFailed`/`classificationFailureReason` columns track API failures separately from model output; a `retryClassification` service function re-runs classify-only using stored job data. A `generic_methodology` SKILL_HANDLERS entry makes all imported LLM-guided skills executable without per-skill code.

**Tech Stack:** Drizzle ORM, pg-boss, Anthropic Haiku (claude-haiku-4-5-20251001), withBackoff, React, TypeScript.

---

## File Map

| File | What changes |
|------|-------------|
| `server/db/schema/skillAnalyzerResults.ts` | Add `classificationFailed` + `classificationFailureReason` columns |
| `migrations/0109_skill_analyzer_classification_failed.sql` | Generated migration |
| `server/services/skillAnalyzerServicePure.ts` | Tighten prompts; add `deriveClassificationFailureReason` |
| `server/services/__tests__/skillAnalyzerServicePure.test.ts` | Tests for new pure helpers + prompt assertions |
| `server/jobs/skillAnalyzerJob.ts` | Add 429 to retryable; track error in catch; populate new fields |
| `server/services/skillAnalyzerService.ts` | Add `classifySingleCandidate`, `retryClassification`, `bulkRetryFailedClassifications`; auto-assign `generic_methodology`; remove handler guard + `unregisteredHandlerSlugs` |
| `server/routes/skillAnalyzer.ts` | Add retry endpoints; remove `unregisteredHandlerSlugs` from GET response |
| `server/services/skillExecutor.ts` | Add `generic_methodology` handler |
| `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` | Update `AnalysisResult` + `AnalysisJob` types |
| `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` | Remove handler block; add failed-classification state + retry UI |

---

## Task 1: DB Schema — classification failure columns

**Files:**
- Modify: `server/db/schema/skillAnalyzerResults.ts`
- Create: `migrations/0109_skill_analyzer_classification_failed.sql` (generated)

- [ ] **Step 1: Add two columns to the schema**

  In `server/db/schema/skillAnalyzerResults.ts`, after the `classificationReasoning` column (line ~51), add:

  ```typescript
  // Tracks API-level failure during the classify stage. True only when the
  // LLM call failed (429, timeout, parse error) — NOT set for genuine
  // PARTIAL_OVERLAP results. Used to distinguish retryable failures from
  // model output.
  classificationFailed: boolean('classification_failed').notNull().default(false),
  // Reason for the failure: 'rate_limit' | 'timeout' | 'parse_error' | 'unknown'.
  // Null on all rows where classificationFailed is false.
  classificationFailureReason: text('classification_failure_reason'),
  ```

- [ ] **Step 2: Generate migration**

  ```bash
  npm run db:generate
  ```

  Expected: a new file `migrations/0109_skill_analyzer_classification_failed.sql` containing two `ALTER TABLE` statements.

- [ ] **Step 3: Verify migration content**

  Open the generated file. It should contain:
  ```sql
  ALTER TABLE "skill_analyzer_results" ADD COLUMN "classification_failed" boolean DEFAULT false NOT NULL;
  ALTER TABLE "skill_analyzer_results" ADD COLUMN "classification_failure_reason" text;
  ```
  If Drizzle generated extra statements, verify they are not destructive before proceeding.

- [ ] **Step 4: Run typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add server/db/schema/skillAnalyzerResults.ts migrations/0109_skill_analyzer_classification_failed.sql
  git commit -m "feat(skill-analyzer): add classificationFailed + classificationFailureReason columns"
  ```

---

## Task 2: Prompt hardening — tighten DUPLICATE + add anti-bias line

**Files:**
- Modify: `server/services/skillAnalyzerServicePure.ts`
- Modify: `server/services/__tests__/skillAnalyzerServicePure.test.ts`

- [ ] **Step 1: Write failing tests for the prompt changes**

  In `server/services/__tests__/skillAnalyzerServicePure.test.ts`, add after the existing `buildClassificationPrompt` tests:

  ```typescript
  // ---------------------------------------------------------------------------
  // DUPLICATE definition tightening
  // ---------------------------------------------------------------------------

  test('CLASSIFICATION_SYSTEM_PROMPT: DUPLICATE definition requires zero additive value', () => {
    const { system } = buildClassificationPrompt(
      { name: 'a', slug: 'a', description: '', definition: null, instructions: null },
      { id: null, slug: 'b', name: 'b', description: '', definition: null, instructions: null, isSystem: true },
      'ambiguous',
    );
    assert(
      system.includes('zero additive value'),
      'DUPLICATE definition should mention "zero additive value"',
    );
  });

  test('CLASSIFICATION_SYSTEM_PROMPT: contains anti-bias instruction', () => {
    const { system } = buildClassificationPrompt(
      { name: 'a', slug: 'a', description: '', definition: null, instructions: null },
      { id: null, slug: 'b', name: 'b', description: '', definition: null, instructions: null, isSystem: true },
      'ambiguous',
    );
    assert(
      system.includes('Do not rely solely on embedding similarity'),
      'system prompt should contain anti-bias instruction',
    );
  });

  test('buildClassificationPrompt: likely_duplicate band hint prefers IMPROVEMENT', () => {
    const { userMessage } = buildClassificationPrompt(
      { name: 'a', slug: 'a', description: '', definition: null, instructions: null },
      { id: null, slug: 'b', name: 'b', description: '', definition: null, instructions: null, isSystem: true },
      'likely_duplicate',
    );
    assert(
      userMessage.includes('Prefer IMPROVEMENT'),
      'likely_duplicate hint should prefer IMPROVEMENT',
    );
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  npx tsx server/services/__tests__/skillAnalyzerServicePure.test.ts
  ```
  Expected: 3 new FAILs for the new tests.

- [ ] **Step 3: Update CLASSIFICATION_SYSTEM_PROMPT — DUPLICATE definition**

  In `server/services/skillAnalyzerServicePure.ts`, replace the DUPLICATE line in `CLASSIFICATION_SYSTEM_PROMPT` (around line 107):

  Old:
  ```
  **DUPLICATE** — The skills are functionally identical. Same purpose, same approach, same scope. Different wording is acceptable; the underlying capability is the same. Recommended action: skip the incoming skill.
  ```

  New:
  ```
  **DUPLICATE** — The incoming skill contains no new information whatsoever: no additional context, no broader coverage, no improved guidance, no extra examples. The skills are equivalent in all meaningful respects. If the incoming adds *anything* of value — even a paragraph of richer context — choose IMPROVEMENT instead. Recommended action: skip the incoming skill.
  ```

- [ ] **Step 4: Add anti-bias instruction to Classification Rules section**

  In the same `CLASSIFICATION_SYSTEM_PROMPT` constant, find the `## Classification Rules` section (around line 115). Add a new rule 0 before the existing rule 1:

  ```
  ## Classification Rules

  0. Do not rely solely on embedding similarity. Evaluate actual content differences carefully.
  1. Focus on **functional capability**, not surface-level wording.
  ```

- [ ] **Step 5: Update likely_duplicate band hint in buildClassificationPrompt**

  In `buildClassificationPrompt` (around line 182–185), change:

  Old:
  ```typescript
  band === 'likely_duplicate'
    ? 'Note: These skills have very high embedding similarity (>0.92). This is likely DUPLICATE or IMPROVEMENT.'
  ```

  New:
  ```typescript
  band === 'likely_duplicate'
    ? 'Note: These skills have very high embedding similarity (>0.92). Prefer IMPROVEMENT unless the incoming is genuinely word-for-word equivalent with zero additive value.'
  ```

- [ ] **Step 6: Apply the same band hint change in buildClassifyPromptWithMerge**

  In `buildClassifyPromptWithMerge` (around line 361–364), apply the identical change to the `bandHint` variable.

- [ ] **Step 7: Run tests — all should pass**

  ```bash
  npx tsx server/services/__tests__/skillAnalyzerServicePure.test.ts
  ```
  Expected: all PASS.

- [ ] **Step 8: Run typecheck**

  ```bash
  npm run typecheck
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add server/services/skillAnalyzerServicePure.ts server/services/__tests__/skillAnalyzerServicePure.test.ts
  git commit -m "fix(skill-analyzer): tighten DUPLICATE prompt + add anti-bias instruction"
  ```

---

## Task 3: Job resilience — 429 retryable + failure tracking

**Files:**
- Modify: `server/services/skillAnalyzerServicePure.ts` (add `deriveClassificationFailureReason`)
- Modify: `server/services/__tests__/skillAnalyzerServicePure.test.ts`
- Modify: `server/jobs/skillAnalyzerJob.ts`

- [ ] **Step 1: Write failing test for deriveClassificationFailureReason**

  Add to `server/services/__tests__/skillAnalyzerServicePure.test.ts`:

  ```typescript
  // ---------------------------------------------------------------------------
  // deriveClassificationFailureReason
  // ---------------------------------------------------------------------------

  test('deriveClassificationFailureReason: null error → parse_error', () => {
    assert(deriveClassificationFailureReason(null) === 'parse_error', 'null → parse_error');
  });

  test('deriveClassificationFailureReason: 429 status → rate_limit', () => {
    assert(deriveClassificationFailureReason({ statusCode: 429 }) === 'rate_limit', '429 → rate_limit');
  });

  test('deriveClassificationFailureReason: unknown error → unknown', () => {
    assert(deriveClassificationFailureReason(new Error('boom')) === 'unknown', 'Error → unknown');
  });
  ```

  Also add `deriveClassificationFailureReason` to the import at the top of the test file.

- [ ] **Step 2: Run test to confirm fail**

  ```bash
  npx tsx server/services/__tests__/skillAnalyzerServicePure.test.ts
  ```
  Expected: 3 new FAILs.

- [ ] **Step 3: Add deriveClassificationFailureReason to the pure file**

  In `server/services/skillAnalyzerServicePure.ts`, add after the `classifyBand` function:

  ```typescript
  /** Derive a human-readable reason for a classification API failure.
   *  Pass the caught error, or null if the parse step returned null
   *  (meaning the API call succeeded but the response was unparseable). */
  export function deriveClassificationFailureReason(
    err: unknown,
  ): 'rate_limit' | 'timeout' | 'parse_error' | 'unknown' {
    if (err === null || err === undefined) return 'parse_error';
    const e = err as { statusCode?: number; code?: string };
    if (e?.statusCode === 429) return 'rate_limit';
    return 'unknown';
  }
  ```

- [ ] **Step 4: Run tests — all should pass**

  ```bash
  npx tsx server/services/__tests__/skillAnalyzerServicePure.test.ts
  ```

- [ ] **Step 5: Update the isRetryable predicate in skillAnalyzerJob.ts to include 429**

  In `server/jobs/skillAnalyzerJob.ts`, find the `isRetryable` function inside the classify stage (around line 542). Change:

  ```typescript
  return (
    e?.statusCode === 503 ||
    e?.statusCode === 529 ||
    e?.code === 'PROVIDER_UNAVAILABLE'
  );
  ```

  To:

  ```typescript
  return (
    e?.statusCode === 429 ||
    e?.statusCode === 503 ||
    e?.statusCode === 529 ||
    e?.code === 'PROVIDER_UNAVAILABLE'
  );
  ```

- [ ] **Step 6: Capture the error in the catch block**

  In `server/jobs/skillAnalyzerJob.ts`, find the try/catch around the Anthropic call (around line 524). Change:

  Old:
  ```typescript
  let classificationResult: ReturnType<typeof skillAnalyzerServicePure.parseClassificationResponseWithMerge>;

  try {
    const response = await withBackoff(...)
    classificationResult = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
  } catch {
    classificationResult = null;
  }
  ```

  New:
  ```typescript
  let classificationResult: ReturnType<typeof skillAnalyzerServicePure.parseClassificationResponseWithMerge>;
  let classificationApiError: unknown = undefined;

  try {
    const response = await withBackoff(...)
    classificationResult = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
  } catch (err) {
    classificationResult = null;
    classificationApiError = err;
  }

  // null result = either API error (classificationApiError set) or parse failure
  const classificationFailed = classificationResult === null;
  const classificationFailureReason = classificationFailed
    ? skillAnalyzerServicePure.deriveClassificationFailureReason(
        classificationApiError ?? null,
      )
    : null;
  ```

- [ ] **Step 7: Add the new fields to the classifiedResults.push() call**

  In `server/jobs/skillAnalyzerJob.ts`, find `classifiedResults.push({` (around line 572). Add the two new fields to the pushed object:

  ```typescript
  classifiedResults.push({
    candidateIndex: match.candidateIndex,
    candidate,
    classification: finalResult.classification,
    confidence: finalResult.confidence,
    similarityScore: match.similarity,
    classificationReasoning: finalResult.reasoning,
    libraryId: matchedLib.id,
    librarySlug: matchedLib.slug,
    libraryName: matchedLib.name,
    diffSummary,
    proposedMerge: finalResult.proposedMerge ?? null,
    classificationFailed,              // NEW
    classificationFailureReason,       // NEW
  });
  ```

- [ ] **Step 8: Write the new fields in Stage 8 (Write Results)**

  In `server/jobs/skillAnalyzerJob.ts`, find the LLM-classified loop in Stage 8 (around line 754). Add the two new fields to the `resultRows.push()` call:

  ```typescript
  // LLM-classified from Stage 5
  for (const r of classifiedResults) {
    resultRows.push({
      // ... existing fields ...
      classificationFailed: r.classificationFailed ?? false,        // NEW
      classificationFailureReason: r.classificationFailureReason ?? null,  // NEW
    });
  }
  ```

- [ ] **Step 9: Run typecheck**

  ```bash
  npm run typecheck
  ```

- [ ] **Step 10: Commit**

  ```bash
  git add server/services/skillAnalyzerServicePure.ts server/services/__tests__/skillAnalyzerServicePure.test.ts server/jobs/skillAnalyzerJob.ts
  git commit -m "fix(skill-analyzer): add 429 to retryable errors; track classificationFailed + reason"
  ```

---

## Task 4: Retry service + endpoints

**Files:**
- Modify: `server/services/skillAnalyzerService.ts`
- Modify: `server/routes/skillAnalyzer.ts`

- [ ] **Step 1: Add imports to skillAnalyzerService.ts**

  At the top of `server/services/skillAnalyzerService.ts`, add these imports alongside the existing ones:

  ```typescript
  import { withBackoff } from '../lib/withBackoff.js';
  import anthropicAdapter from './providers/anthropicAdapter.js';
  import { skillAnalyzerServicePure } from './skillAnalyzerServicePure.js';
  import type { LibrarySkillSummary } from './skillAnalyzerServicePure.js';
  import type { ParsedSkill } from './skillParserServicePure.js';
  ```

  (Some of these may already be imported — only add what's missing.)

- [ ] **Step 2: Add the shared classifySingleCandidate helper**

  In `server/services/skillAnalyzerService.ts`, add this function before `retryClassification`. This encapsulates the Anthropic call so the retry path and (optionally) the job can share it:

  ```typescript
  /** Run LLM classification for a single candidate/library pair.
   *  Reuses the same model, backoff, and prompt as skillAnalyzerJob.ts Stage 5.
   *  Returns the classification result plus failure metadata. */
  async function classifySingleCandidate(
    candidate: ParsedSkill,
    matchedLib: LibrarySkillSummary,
    similarityScore: number,
  ): Promise<{
    result: import('./skillAnalyzerServicePure.js').ClassificationResultWithMerge;
    classificationFailed: boolean;
    classificationFailureReason: 'rate_limit' | 'timeout' | 'parse_error' | 'unknown' | null;
  }> {
    const band = skillAnalyzerServicePure.classifyBand(similarityScore);
    const { system, userMessage } = skillAnalyzerServicePure.buildClassifyPromptWithMerge(
      candidate,
      matchedLib,
      band as 'likely_duplicate' | 'ambiguous',
    );

    let parsed: import('./skillAnalyzerServicePure.js').ClassificationResultWithMerge | null;
    let apiError: unknown = undefined;

    try {
      const response = await withBackoff(
        () =>
          anthropicAdapter.call({
            model: 'claude-haiku-4-5-20251001',
            system,
            messages: [{ role: 'user', content: userMessage }],
            maxTokens: 512,
            temperature: 0.1,
          }),
        {
          label: 'skill-classify-retry',
          maxAttempts: 3,
          isRetryable: (err: unknown) => {
            const e = err as { statusCode?: number; code?: string };
            if (e?.code === 'PROVIDER_NOT_CONFIGURED') return false;
            return (
              e?.statusCode === 429 ||
              e?.statusCode === 503 ||
              e?.statusCode === 529 ||
              e?.code === 'PROVIDER_UNAVAILABLE'
            );
          },
        },
      );
      parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
    } catch (err) {
      parsed = null;
      apiError = err;
    }

    const classificationFailed = parsed === null;
    return {
      result: parsed ?? {
        classification: 'PARTIAL_OVERLAP',
        confidence: 0.3,
        reasoning: 'LLM classification failed - defaulting to PARTIAL_OVERLAP for human review.',
        proposedMerge: null,
      },
      classificationFailed,
      classificationFailureReason: classificationFailed
        ? skillAnalyzerServicePure.deriveClassificationFailureReason(apiError ?? null)
        : null,
    };
  }
  ```

- [ ] **Step 3: Add retryClassification service function**

  ```typescript
  /** Retry classification for a single result row that has classificationFailed=true.
   *  Idempotent: returns immediately if the row is not in a failed state.
   *  Uses the stored parsedCandidates + similarityScore — no re-parse or re-embed. */
  export async function retryClassification(
    jobId: string,
    resultId: string,
    organisationId: string,
  ): Promise<void> {
    // Verify ownership
    const jobRows = await db
      .select()
      .from(skillAnalyzerJobs)
      .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
      .limit(1);
    if (!jobRows[0]) throw { statusCode: 404, message: 'Job not found' };
    const job = jobRows[0];

    const resultRows = await db
      .select()
      .from(skillAnalyzerResults)
      .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)))
      .limit(1);
    if (!resultRows[0]) throw { statusCode: 404, message: 'Result not found' };
    const result = resultRows[0];

    // Idempotency guard
    if (!result.classificationFailed) return;

    const candidates = (job.parsedCandidates ?? []) as ParsedSkill[];
    const candidate = candidates[result.candidateIndex];
    if (!candidate) throw { statusCode: 422, message: 'Candidate not found in job parsedCandidates' };
    if (!result.matchedSkillId) throw { statusCode: 422, message: 'No matched skill to classify against' };
    if (result.similarityScore == null) throw { statusCode: 422, message: 'Missing similarity score' };

    const matchedSkill = await systemSkillService.getSkillById(result.matchedSkillId);
    if (!matchedSkill) throw { statusCode: 422, message: 'Matched skill no longer exists' };

    const matchedLib: LibrarySkillSummary = {
      id: matchedSkill.id,
      slug: matchedSkill.slug,
      name: matchedSkill.name,
      description: matchedSkill.description,
      definition: matchedSkill.definition as object,
      instructions: matchedSkill.instructions,
      isSystem: true,
    };

    const { result: classification, classificationFailed, classificationFailureReason } =
      await classifySingleCandidate(candidate, matchedLib, result.similarityScore);

    const diffSummary = skillAnalyzerServicePure.generateDiffSummary(candidate, matchedLib);

    await db
      .update(skillAnalyzerResults)
      .set({
        classification: classification.classification,
        confidence: classification.confidence,
        classificationReasoning: classification.reasoning,
        diffSummary,
        proposedMergedContent: classification.proposedMerge ?? null,
        originalProposedMerge: classification.proposedMerge ?? null,
        classificationFailed,
        classificationFailureReason,
      })
      .where(
        and(
          eq(skillAnalyzerResults.id, resultId),
          eq(skillAnalyzerResults.classificationFailed, true), // optimistic concurrency
        ),
      );
  }
  ```

- [ ] **Step 4: Add bulkRetryFailedClassifications service function**

  ```typescript
  /** Retry all classificationFailed=true results in a job sequentially
   *  (no parallel burst) with jittered delay to avoid re-triggering 429s.
   *  Returns counts of retried and still-failed rows. */
  export async function bulkRetryFailedClassifications(
    jobId: string,
    organisationId: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<{ retried: number; stillFailed: number }> {
    const jobRows = await db
      .select({ id: skillAnalyzerJobs.id })
      .from(skillAnalyzerJobs)
      .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
      .limit(1);
    if (!jobRows[0]) throw { statusCode: 404, message: 'Job not found' };

    const failedResults = await db
      .select({ id: skillAnalyzerResults.id })
      .from(skillAnalyzerResults)
      .where(and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.classificationFailed, true),
      ));

    const total = failedResults.length;
    let retried = 0;

    for (let i = 0; i < failedResults.length; i++) {
      onProgress?.(i + 1, total);
      await retryClassification(jobId, failedResults[i].id, organisationId);
      retried++;
      // Jittered delay: 500–1500ms between calls to avoid re-triggering 429s
      if (i < failedResults.length - 1) {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
      }
    }

    const remaining = await db
      .select({ id: skillAnalyzerResults.id })
      .from(skillAnalyzerResults)
      .where(and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.classificationFailed, true),
      ));

    return { retried, stillFailed: remaining.length };
  }
  ```

- [ ] **Step 5: Add retry routes to skillAnalyzer.ts**

  In `server/routes/skillAnalyzer.ts`, add after the existing result PATCH endpoint:

  ```typescript
  // ---------------------------------------------------------------------------
  // POST /api/system/skill-analyser/jobs/:jobId/results/:resultId/retry-classification
  // Retry LLM classification for a single failed result row.
  // ---------------------------------------------------------------------------

  router.post(
    '/api/system/skill-analyser/jobs/:jobId/results/:resultId/retry-classification',
    asyncHandler(async (req, res) => {
      await skillAnalyzerService.retryClassification(
        req.params.jobId,
        req.params.resultId,
        req.orgId!,
      );
      return res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------------------
  // POST /api/system/skill-analyser/jobs/:jobId/retry-failed-classifications
  // Retry all failed classification rows in a job sequentially.
  // ---------------------------------------------------------------------------

  router.post(
    '/api/system/skill-analyser/jobs/:jobId/retry-failed-classifications',
    asyncHandler(async (req, res) => {
      const { retried, stillFailed } = await skillAnalyzerService.bulkRetryFailedClassifications(
        req.params.jobId,
        req.orgId!,
      );
      return res.json({ ok: true, retried, stillFailed });
    }),
  );
  ```

- [ ] **Step 6: Run typecheck**

  ```bash
  npm run typecheck
  ```

- [ ] **Step 7: Run lint**

  ```bash
  npm run lint
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add server/services/skillAnalyzerService.ts server/routes/skillAnalyzer.ts
  git commit -m "feat(skill-analyzer): add per-result and bulk classification retry"
  ```

---

## Task 5: Generic handler + remove handler gate

**Files:**
- Modify: `server/services/skillExecutor.ts`
- Modify: `server/services/skillAnalyzerService.ts`
- Modify: `server/routes/skillAnalyzer.ts`

- [ ] **Step 1: Add generic_methodology to SKILL_HANDLERS**

  In `server/services/skillExecutor.ts`, add the following entry in the `SKILL_HANDLERS` object after the methodology skills section (around line 848 after the `draft_sequence` entry):

  ```typescript
  // ── Generic methodology handler — used by imported skills that are
  //    purely LLM-guided. Behaviour comes from the skill's instructions
  //    field, which is injected into the agent's context before tool call.
  //    No hardcoded template or guidance strings per skill.
  generic_methodology: async (input) => {
    const skillName = typeof input.skillName === 'string' ? input.skillName : 'unknown';
    return {
      success: true,
      skillName,
      guidance: 'Follow the methodology instructions in your skill context to complete this task.',
    };
  },
  ```

- [ ] **Step 2: Remove the SKILL_HANDLERS guard from executeApproved**

  In `server/services/skillAnalyzerService.ts`, find the DISTINCT block in `executeApproved` (around line 859). Replace **Guard 1** (the handler check) with an instructions validation, and change `handlerKey: candidate.slug` to `handlerKey: 'generic_methodology'`:

  Old Guard 1:
  ```typescript
  if (!(candidate.slug in SKILL_HANDLERS)) {
    await failResult(
      result.id,
      `No handler registered for skill '${candidate.slug}'. An engineer must add an entry to SKILL_HANDLERS...`,
    );
    continue;
  }
  ```

  New Guard 1:
  ```typescript
  // Guard 1: generic_methodology requires instructions to be useful.
  // An imported skill with no instructions would silently give the agent nothing to work with.
  if (!candidate.instructions || candidate.instructions.trim().length === 0) {
    await failResult(
      result.id,
      `Skill '${candidate.slug}' has no instructions. The generic_methodology handler requires instructions to function.`,
    );
    continue;
  }
  ```

  And in the `createSystemSkill` call inside the transaction (around line 908), change `handlerKey: candidate.slug` to:

  ```typescript
  handlerKey: 'generic_methodology',
  ```

- [ ] **Step 3: Remove the SKILL_HANDLERS import from skillAnalyzerService.ts**

  Since the SKILL_HANDLERS check is gone, remove the import:

  ```typescript
  import { SKILL_HANDLERS } from './skillExecutor.js';
  ```

  (Verify no other usage of `SKILL_HANDLERS` remains in the file before removing.)

- [ ] **Step 4: Remove unregisteredHandlerSlugs from getJob**

  In `server/services/skillAnalyzerService.ts`, find the `getJob` function. Remove the block that computes `unregisteredHandlerSlugs` (around lines 202–207):

  ```typescript
  // DELETE these lines:
  const candidateSlugs = Array.from(new Set(rawResults.map((r) => r.candidateSlug)));
  const registeredHandlers = new Set(Object.keys(SKILL_HANDLERS));
  const unregisteredHandlerSlugs = candidateSlugs.filter((slug) => !registeredHandlers.has(slug));
  ```

  Update the function return type `GetJobResponse` to remove `unregisteredHandlerSlugs`, and update the return statement to remove it.

- [ ] **Step 5: Remove unregisteredHandlerSlugs from the GET route**

  In `server/routes/skillAnalyzer.ts`, find the GET job handler (around line 131). Change:

  ```typescript
  const { job, results, unregisteredHandlerSlugs, availableSystemAgents } =
    await skillAnalyzerService.getJob(req.params.jobId, req.orgId!);

  return res.json({
    job: { ...job, unregisteredHandlerSlugs, availableSystemAgents },
    results,
  });
  ```

  To:

  ```typescript
  const { job, results, availableSystemAgents } =
    await skillAnalyzerService.getJob(req.params.jobId, req.orgId!);

  return res.json({
    job: { ...job, availableSystemAgents },
    results,
  });
  ```

- [ ] **Step 6: Run typecheck**

  ```bash
  npm run typecheck
  ```

- [ ] **Step 7: Run lint**

  ```bash
  npm run lint
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add server/services/skillExecutor.ts server/services/skillAnalyzerService.ts server/routes/skillAnalyzer.ts
  git commit -m "feat(skill-analyzer): add generic_methodology handler; auto-assign to imported skills"
  ```

---

## Task 6: Client UI — remove handler block; failed classification state + retry

**Files:**
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx`
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx`

- [ ] **Step 1: Update AnalysisResult type in SkillAnalyzerWizard.tsx**

  In `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx`, add two new fields to the `AnalysisResult` interface (around line 88):

  ```typescript
  export interface AnalysisResult {
    // ... existing fields ...
    classificationFailed?: boolean;
    classificationFailureReason?: 'rate_limit' | 'timeout' | 'parse_error' | 'unknown' | null;
  }
  ```

- [ ] **Step 2: Update AnalysisJob type — remove unregisteredHandlerSlugs**

  In the same file, remove `unregisteredHandlerSlugs` from the `AnalysisJob` interface:

  ```typescript
  // DELETE this field:
  unregisteredHandlerSlugs?: string[];
  ```

- [ ] **Step 3: Remove HandlerStatusBlock from ResultCard**

  In `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx`:

  a) Delete the entire `HandlerStatusBlock` component (lines ~95–117).

  b) In `ResultCard`, remove the `unregisteredHandler` prop from the destructured props and from the `ResultCard` props type.

  c) Remove these lines from `ResultCard`:

  ```typescript
  // DELETE:
  const approveDisabled = isDistinct && unregisteredHandler;
  const approveTooltip = approveDisabled
    ? 'No handler registered for this skill...'
    : undefined;
  ```

  d) In the JSX, remove the conditional `HandlerStatusBlock` render:

  ```tsx
  // DELETE:
  {isDistinct && <HandlerStatusBlock unregistered={unregisteredHandler} />}
  ```

  e) On the Approve button, remove the `disabled={approveDisabled}` and `title={approveTooltip}` attributes. The button should always be enabled (other existing logic for non-DISTINCT may remain).

  f) On the card container, remove the `approveDisabled` conditional border class:
  ```tsx
  // Change this:
  <div className={`bg-white border rounded-lg p-4 ${approveDisabled ? 'border-red-200' : 'border-slate-200'}`}>
  // To:
  <div className="bg-white border border-slate-200 rounded-lg p-4">
  ```

- [ ] **Step 4: Remove unregisteredHandlerSlugs from ResultSection and its callers**

  In `SkillAnalyzerResultsStep.tsx`:

  a) Remove `unregisteredHandlerSlugs: Set<string>` from `ResultSection` props and its usage.

  b) Remove `unregisteredHandlerSlugs` from any `ResultCard` call sites inside `ResultSection`.

  c) Remove `unregisteredHandlerSlugs` from the top-level `SkillAnalyzerResultsStep` props and any derived Set computation from `job.unregisteredHandlerSlugs`.

- [ ] **Step 5: Add failed classification state rendering**

  In `SkillAnalyzerResultsStep.tsx`, inside `ResultCard`, add a failed-classification block. Place it after the `classificationReasoning` text and before the handler block you just removed:

  ```tsx
  {result.classificationFailed && (
    <div className="mt-2 p-2 rounded-lg text-xs bg-amber-50 border border-amber-200 text-amber-800">
      <p className="font-medium mb-1">
        Couldn't classify (temporary issue)
        {result.classificationFailureReason === 'rate_limit' && (
          <span className="ml-1 font-normal opacity-70">· Rate limit</span>
        )}
      </p>
      <button
        type="button"
        onClick={handleRetry}
        disabled={retrying}
        className="text-xs px-2 py-1 rounded border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50"
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  )}
  ```

  Add the `retrying` state and `handleRetry` handler inside `ResultCard`:

  ```typescript
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await api.post(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/retry-classification`,
      );
      // Re-fetch this result to get updated classification
      const { data } = await api.get<{ results: AnalysisResult[] }>(
        `/api/system/skill-analyser/jobs/${jobId}`,
      );
      const updated = data.results.find((r) => r.id === result.id);
      if (updated) onResultPatched(updated);
    } catch (err) {
      console.error('[SkillAnalyzer] Retry failed:', err);
    } finally {
      setRetrying(false);
    }
  }
  ```

- [ ] **Step 6: Add bulk retry with progress to ResultSection**

  In `ResultSection`, for the `PARTIAL_OVERLAP` section header, add a "Retry all failed" button when any failed results exist. Add state for progress:

  ```typescript
  const failedResults = results.filter((r) => r.classificationFailed);
  const [bulkRetryProgress, setBulkRetryProgress] = useState<{ current: number; total: number } | null>(null);

  async function handleBulkRetry() {
    setBulkRetryProgress({ current: 0, total: failedResults.length });
    try {
      await api.post(`/api/system/skill-analyser/jobs/${jobId}/retry-failed-classifications`);
      // Re-fetch to get updated results
      const { data } = await api.get<{ job: AnalysisJob; results: AnalysisResult[] }>(
        `/api/system/skill-analyser/jobs/${jobId}`,
      );
      data.results.forEach((r) => onResultPatched(r));
    } finally {
      setBulkRetryProgress(null);
    }
  }
  ```

  In the section header JSX, show the button when `classification === 'PARTIAL_OVERLAP'` and there are failed results:

  ```tsx
  {classification === 'PARTIAL_OVERLAP' && failedResults.length > 0 && (
    <button
      type="button"
      onClick={handleBulkRetry}
      disabled={bulkRetryProgress !== null}
      className="text-xs px-3 py-1 rounded-lg border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50"
    >
      {bulkRetryProgress
        ? `Retrying ${bulkRetryProgress.current} of ${bulkRetryProgress.total}…`
        : `Retry all failed (${failedResults.length})`}
    </button>
  )}
  ```

  Place this inside the bulk-action row, alongside the existing "Approve all partial overlaps" button.

- [ ] **Step 7: Build the client**

  ```bash
  npm run build
  ```
  Expected: no errors.

- [ ] **Step 8: Run typecheck**

  ```bash
  npm run typecheck
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx
  git commit -m "feat(skill-analyzer): remove handler block from DISTINCT cards; add retry UI for failed classifications"
  ```

---

## Self-Review Notes

**Spec coverage check:**
- Issue 1 (prompt hardening): Tasks 2 ✓
- Issue 2 (429 retryable + classificationFailed column): Tasks 1, 3 ✓
- Issue 2 (retry endpoint + bulk retry): Task 4 ✓
- Issue 2 (idempotency guard): Task 4 Step 3 (optimistic concurrency on classificationFailed=true check) ✓
- Issue 2 (jittered backoff): Task 4 Step 4 ✓
- Issue 3 (generic handler): Task 5 Step 1 ✓
- Issue 3 (instructions validation at import): Task 5 Step 2 ✓
- Issue 3 (remove handler gate UX): Tasks 5 Steps 3–5, Task 6 Steps 3–4 ✓
- Bulk retry progress ("Retrying 3 of 14…"): Task 6 Step 6 ✓

**Type consistency:**
- `classificationFailed` / `classificationFailureReason` used consistently across schema, job, service, and client types ✓
- `classifySingleCandidate` returns `result` (not `classification`) — Task 4 Step 3 uses `classification.classification` etc — matches the destructured `result` name ✓
- `deriveClassificationFailureReason` receives `null` for parse errors — test in Task 3 Step 1 covers this ✓

**Deviation from spec:**
- Spec suggested `if (!context.instructions)` in the generic handler. `SkillExecutionContext` has no `instructions` field — instructions live in the agent's system prompt. Validation moved to `executeApproved` import time (Task 5 Step 2) instead. Safer and catches the problem earlier.
