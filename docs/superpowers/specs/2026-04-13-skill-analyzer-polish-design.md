# Skill Analyzer Polish — Design Spec

**Date:** 2026-04-13
**Status:** Approved for implementation

---

## Contents

1. [Overview](#overview)
2. [Issue 1 — Classification Accuracy](#issue-1--classification-accuracy)
3. [Issue 2 — LLM Failure Resilience](#issue-2--llm-failure-resilience)
4. [Issue 3 — New Skill Import UX + Generic Handler](#issue-3--new-skill-import-ux--generic-handler)
5. [Files Changed Summary](#files-changed-summary)
6. [Out of Scope](#out-of-scope)
7. [Success Criteria](#success-criteria)

---

## Overview

Three related improvements to the Skill Analyzer import pipeline, motivated by a real import session:

1. **Classification accuracy** — `DUPLICATE` is too permissive; skills with richer incoming content are mis-classified instead of routing to the merge flow
2. **LLM failure resilience** — a transient API failure (likely 429 rate limit) permanently stuck 14 rows as `PARTIAL_OVERLAP confidence:0.3` with no way to retry short of re-running the entire job
3. **New skill import UX** — the "No handler registered" red error on DISTINCT cards is an internal engineering detail that is meaningless and alarming to users; importing new LLM-guided skills requires a manual code change per skill

These are addressed as one cohesive spec because they share the same job/service layer and affect the same UI surface.

---

## Issue 1 — Classification Accuracy

### Problem

The `DUPLICATE` LLM prompt definition reads: *"Functionally identical skills. Same purpose, approach, scope. Different wording acceptable."* The phrase "different wording acceptable" allows the model to overlook genuine additive content in the incoming skill. The `likely_duplicate` band hint (>0.92 cosine similarity) further biases toward `DUPLICATE` by phrasing it as "likely DUPLICATE or IMPROVEMENT."

**Example:** `email-sequence` (incoming) vs `draft_sequence` (library). The incoming covers more sequence types and provides richer contextual guidance. The LLM classified it `DUPLICATE` at 92% confidence instead of routing it to `IMPROVEMENT` + merge.

### Solution

Prompt-only changes in `server/services/skillAnalyzerServicePure.ts` — no schema or API changes.

**1. Tighten the DUPLICATE definition** in both `buildClassifyPrompt` and `buildClassifyPromptWithMerge`:

> DUPLICATE — The incoming skill contains no new information: no additional context, no broader coverage, no improved guidance, no extra examples. The skills are equivalent in all meaningful respects. If the incoming adds *anything* of value — even a paragraph of richer context — choose IMPROVEMENT instead.

**2. Change the `likely_duplicate` band hint** (>0.92 similarity):

> Old: "very high embedding similarity (>0.92). This is likely DUPLICATE or IMPROVEMENT."
> New: "very high embedding similarity (>0.92). Prefer IMPROVEMENT unless the incoming is genuinely word-for-word equivalent with zero additive value."

**3. Add anti-bias instruction** to the prompt preamble (both `buildClassifyPrompt` and `buildClassifyPromptWithMerge`):

> "Do not rely solely on embedding similarity. Evaluate actual content differences carefully."

No threshold changes. No new categories.

---

## Issue 2 — LLM Failure Resilience

### Problem

The classify stage uses up to 5 concurrent Haiku calls. HTTP 429 (rate limit) is not in the retryable error set — only 503 and 529 are. When 429s occur under load, the catch block fires immediately, setting:

```
classification: PARTIAL_OVERLAP, confidence: 0.3,
reasoning: "LLM classification failed...", proposedMerge: null
```

These rows are indistinguishable from genuine `PARTIAL_OVERLAP` results. There is no retry path — the user must create a new job, re-parsing and re-embedding everything.

### 2a — Add 429 to retryable errors

**File:** `server/jobs/skillAnalyzerJob.ts`

Add `e?.statusCode === 429` to the `isRetryable` predicate in the classify stage retry wrapper. This handles the most likely cause of batch failures under load.

### 2b — Track classification failure separately

**File:** `server/db/schema/skillAnalyzerResults.ts`

Add two columns:
```
classificationFailed: boolean('classification_failed').notNull().default(false)
classificationFailureReason: text('classification_failure_reason')  -- nullable: 'rate_limit' | 'parse_error' | 'unknown'
```

**File:** `server/jobs/skillAnalyzerJob.ts`

In the fallback path, inspect the caught error to set the appropriate reason:
- `statusCode === 429` → `'rate_limit'`
- Zod parse failure → `'parse_error'`
- anything else → `'unknown'`

Set `classificationFailed: true` and `classificationFailureReason` accordingly. Genuine `PARTIAL_OVERLAP` results keep the defaults (`false`, `null`).

**Migration:** `migrations/XXXX_skill_analyzer_results_classification_failed.sql`

### 2c — Per-result retry endpoint

**File:** `server/routes/skillAnalyzer.ts`

```
POST /api/system/skill-analyser/jobs/:jobId/results/:resultId/retry-classification
POST /api/system/skill-analyser/jobs/:jobId/retry-failed-classifications
```

Per-result behaviour:
- Validates job + result belong to the org
- **Idempotency guard**: if `classificationFailed` is `false`, return the current result immediately — no-op, no LLM call. This prevents duplicate work from UI double-clicks or network retries.
- Re-runs only the classify stage using the already-stored `parsedCandidates[result.candidateIndex]` and `result.similarityScore` — no re-parse, no re-embed
- On success: updates classification, confidence, reasoning, proposedMergedContent, originalProposedMerge, clears `classificationFailed` and `classificationFailureReason`
- Uses optimistic concurrency on `updatedAt` to guard against concurrent retry races

Bulk endpoint retries all rows in the job where `classificationFailed = true`, sequentially (no parallel LLM burst) to avoid re-triggering rate limits. Adds a **500–1500ms jittered delay between calls** — prevents immediately re-triggering a 429 during provider throttling.

**File:** `server/services/skillAnalyzerService.ts`

Add `retryClassification(jobId, resultId, organisationId)` and `bulkRetryFailedClassifications(jobId, organisationId)`. Extract the single-result classify logic from `skillAnalyzerJob.ts` into a reusable pure function in `skillAnalyzerServicePure.ts` so both the job and the retry service share the same path without duplication.

### 2d — UI changes

**File:** `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx`

- Results where `classificationFailed: true` render a distinct state: amber badge "Couldn't classify (temporary issue)" + "Retry" button, separate from normal `PARTIAL_OVERLAP` merge cards. The `classificationFailureReason` can inform a tooltip or sub-label (e.g. "Rate limit" vs "Unknown error") without changing the primary copy.
- "Retry all failed" bulk action appears in the section header when any failed results exist in the job
- Bulk retry shows inline progress: "Retrying 3 of 14…" — prevents double-click re-submission and communicates progress on large batches
- On retry success the card transitions to its correct classification section (optimistic update or targeted re-fetch — no full page reload)

---

## Issue 3 — New Skill Import UX + Generic Handler

### Problem

Two interlinked issues:

1. **UX**: DISTINCT cards show a red "No handler registered for this skill" block with a reference to `SKILL_HANDLERS`. This is an internal engineering detail — the user importing skills has no idea what `SKILL_HANDLERS` is, and the message implies something is broken when it is not. The correct user-facing story is simply: "this is a new skill; here are the agents it will be linked to."

2. **Code**: Every imported LLM-guided methodology skill requires a manual engineer step: add a `SKILL_HANDLERS` entry in `server/services/skillExecutor.ts`. For skills where the handler is trivially `executeMethodologySkill(slug, input, { template: {...}, guidance: '...' })`, this is pure boilerplate with no real logic. The skill's actual behaviour already lives in its `instructions` DB field, injected into the agent's context before any tool call.

### 3a — Generic methodology handler

**File:** `server/services/skillExecutor.ts`

Add a new entry to `SKILL_HANDLERS`:

```typescript
generic_methodology: async (input, context) => {
  if (!context.instructions) {
    return { success: false, error: 'Skill instructions are missing. Ensure the skill has an instructions field before executing.' };
  }
  const skillName = typeof input.skillName === 'string' ? input.skillName : 'unknown';
  return {
    success: true,
    skillName,
    guidance: 'Follow the methodology instructions in your skill context to complete this task.',
  };
},
```

This is entirely data-driven: the skill's behaviour comes from its `instructions` DB field, which is injected into the agent's context before any tool call — exactly the same mechanism all existing methodology skills use. No hardcoded template or guidance strings per-skill.

The `instructions` guard prevents silent failure: an imported skill with an empty or missing `instructions` field would otherwise appear to succeed while giving the agent nothing useful to work with.

### 3b — Auto-assign handler at execute time

**File:** `server/services/skillAnalyzerService.ts`

In `executeApproved`, when creating a new `DISTINCT` skill row, set `handlerKey: 'generic_methodology'` unconditionally. Remove the existing `SKILL_HANDLERS` pre-check guard that currently blocks execution and produces the red error.

Skills that genuinely require custom handlers (real API integrations, review gating, action records) are built by engineers rather than imported from catalogs. If an edge-case imported skill needs a custom handler, it will fail at agent execution time with a clear "unknown skill" error — not silently at import time. This tradeoff is acceptable.

### 3c — Remove handler block from DISTINCT cards

**File:** `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx`

- Remove the `HandlerStatusBlock` component from DISTINCT cards entirely
- Remove the Approve button gate based on `unregisteredHandlerSlugs` for DISTINCT results
- The Approve button is always enabled for DISTINCT skills
- DISTINCT cards show: skill name, slug, classification reasoning, and agent proposal chips (pre-checked where score ≥ 0.50)

**File:** `server/services/skillAnalyzerService.ts` + `server/routes/skillAnalyzer.ts`

Remove the `unregisteredHandlerSlugs` computation and response field entirely — it has no remaining consumers once the gate is removed.

---

## Files Changed Summary

| File | Change |
|------|--------|
| `server/services/skillAnalyzerServicePure.ts` | Tighten DUPLICATE prompt definition; update `likely_duplicate` band hint |
| `server/jobs/skillAnalyzerJob.ts` | Add 429 to retryable errors; set `classificationFailed: true` in fallback |
| `server/db/schema/skillAnalyzerResults.ts` | Add `classificationFailed` boolean + `classificationFailureReason` text columns |
| `server/services/skillAnalyzerService.ts` | Add retry service fns; extract shared classify logic; remove handler guard; auto-assign `generic_methodology`; remove `unregisteredHandlerSlugs` |
| `server/routes/skillAnalyzer.ts` | Add per-result + bulk retry endpoints; remove `unregisteredHandlerSlugs` from job response |
| `server/services/skillExecutor.ts` | Add `generic_methodology` handler entry |
| `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` | Render failed classification state + retry UI; remove `HandlerStatusBlock` and Approve gate for DISTINCT |
| `migrations/XXXX_skill_analyzer_results_classification_failed.sql` | Add `classification_failed` + `classification_failure_reason` columns |

---

## Out of Scope

- **Approach C** — migrating hardcoded methodology skill templates to DB (future improvement)
- Changes to IMPROVEMENT, PARTIAL_OVERLAP, or DISTINCT prompt definitions
- Changes to similarity thresholds or band boundaries
- Retry logic for the embed or compare stages

---

## Success Criteria

1. `email-sequence` vs `draft_sequence` (or equivalent richer-incoming case) classifies as `IMPROVEMENT` and generates a merge proposal rather than `DUPLICATE`
2. A job run during an Anthropic 429 spike retries affected calls with backoff rather than silently falling back to the 0.3-confidence placeholder
3. Failed classification rows are visually distinct from genuine `PARTIAL_OVERLAP` and can be retried per-result or in bulk without re-running the full job; bulk retry shows progress and cannot be double-submitted
4. DISTINCT skill cards show no handler-related messaging; Approve works immediately for all new skills; imported skills execute via `generic_methodology` without any manual engineer step
5. A skill with missing `instructions` fails explicitly at execution time rather than silently proceeding

---

## Architectural Note

This spec implicitly moves the system from **code-defined skills** toward **data-defined skills**. `generic_methodology` is the first handler that is pure infrastructure — it carries no logic, only an invocation contract. The skill's behaviour lives entirely in its `instructions` DB field.

Second-order implications to track (not implement now):

- Instruction quality becomes the product surface, not handler code
- Skill versioning becomes important as instructions evolve
- The execution layer can thin further over time

Design principle going forward: **handlers are infrastructure, instructions are logic.**
