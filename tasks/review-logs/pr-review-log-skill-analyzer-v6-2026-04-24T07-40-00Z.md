# PR Review — v6 skill-analyzer fixes (commit 1a8c31fc)

**Files reviewed**
- `server/services/skillAnalyzerServicePure.ts`
- `server/jobs/skillAnalyzerJob.ts`
- `client/src/components/skill-analyzer/mergeTypes.ts`
- `client/src/components/skill-analyzer/MergeReviewBlock.tsx`

**Timestamp:** 2026-04-24T07-40-00Z
**Branch:** bugfixes-april26
**Commit:** 1a8c31fc

---

## Blocking Issues

**None.** Nothing in this commit is incorrect-enough to block — the partition in `MergeReviewBlock` preserves all warnings, approval-gate blocking is unchanged, `classifierFallbackApplied` bookkeeping survives the Fix 5 reclassification cleanly, the validator-vs-recovery `covered` flag stays consistent across both call sites, and the DISTINCT_FALLBACK reclassification is correctly placed before the validation block (so `storedMerge` is null and validation is skipped). No security, no soft-delete, no auth, no direct-db issues — this is all pure logic on in-memory structures.

---

## Strong Recommendations

### 1. SOURCE_FORK confidence deduction is dead code

**Location:** `server/services/skillAnalyzerServicePure.ts` line 614 and `server/jobs/skillAnalyzerJob.ts` line 1307.

`adjustClassifierConfidence` is called per-candidate inside the `Promise.all` at Stage 5 (line ~795 — `await Promise.all(resumedLlmQueue.map(...))`), and `insertSingleResult` writes the confidence to the DB immediately afterwards (line 1348). SOURCE_FORK warnings are computed in Stage 5c (lines 1468–1500), **after** all per-candidate work has completed, and get appended to the DB via `appendBatchCollisionWarnings`. The warning is never present in `mergeWarnings` when `adjustClassifierConfidence` runs, so the `warnings.some(w => w.code === 'SOURCE_FORK')` check at line 614 always evaluates false.

**Proposed fix:** Either (a) move the SOURCE_FORK detection earlier (before per-candidate Stage 5 finishes), or (b) add a post-Stage-5c confidence re-adjustment pass that updates the stored confidence for forked rows and UPDATEs the `skill_analyzer_results.confidence` column for any candidates whose slug appears in `forkWarningsBySlug`. (b) is simpler and keeps the ordering clean. Either way, add a test that exercises the fork path.

**RECOMMENDATION:** implement — caller (main session) will address in follow-up commit via option (b): re-run confidence adjustment after Stage 5c batch warnings are computed, and persist via UPDATE on affected rows.

### 2. Row-level substring match is brittle against reworded cells (confirmed)

**Location:** `server/services/skillAnalyzerServicePure.ts` lines 2793–2850.

`cleanCellForMatch` strips backticks/asterisks/underscores and lowercases, but does not normalise singular/plural forms ("headlines" vs "Headline") or word substitutions ("chars" vs "characters"). For the ad-creative example, source "30 chars each, up to 15" won't match restructured "30 characters" + "Up to 15" across cells.

**Proposed fix:** Tokenise each cell on `/[\s,/|-]+/`, filter informative tokens (length ≥ 3, not stopwords), require ≥ 50% of the source row's informative tokens to appear as whole tokens in the merged text.

**RECOMMENDATION:** implement — token-based matching is the stated goal of Fix 1 and the brittleness is the exact failure mode the brief flagged.

### 3. `classifyDemotedFields` short-slug and broad-fuzz false positives

**Location:** `server/services/skillAnalyzerServicePure.ts` lines 530–573.

- `field.replace(/s$/, '')` turns non-plurals like `"address"` → `"addres"` (rarely collides, but noisy).
- Bidirectional `includes` over a base like `"user"` matches any property containing "user" (e.g. `user_agent`, `admin_user_id`), and the shortest-wins tiebreaker picks the most generic.

**Proposed fix:** Token-aware matching — split field and property on `_`, require ≥ 2 shared tokens OR one shared token + explicit pluralisation/suffix. Below threshold falls back to `removed_entirely`.

**RECOMMENDATION:** implement — low cost, improves signal quality.

### 4. `REQUIRED_FIELD_DEMOTED` confidence deduction weighted equally regardless of status

**Location:** `server/services/skillAnalyzerServicePure.ts` lines 603–607.

`parseDemotedFields` returns all demoted fields without status; Fix 4 deducts 0.05 × count (cap 0.15) regardless of whether each field was made-optional, replaced, or removed entirely. A "made optional — still in schema" field is a much softer signal than "removed entirely".

**Proposed fix:** Read `fieldStatus` from detail JSON and weight — `removed_entirely` × 0.05, `replaced_by` × 0.03, `made_optional` × 0.01. Keep the 0.15 cap.

**RECOMMENDATION:** implement — one-line structural fix that makes Fix 3's classification actually feed Fix 4's differentiation.

### 5. Missing test coverage for every new pure function

Three new exported functions plus a significant new validator branch, zero tests added.

**RECOMMENDATION:** implement — add a v6 test file covering the happy-path + edge cases for `mergedOutputCoversTableData`, `classifyDemotedFields`, `parseDemotedFieldStatuses`, and `adjustClassifierConfidence`.

---

## Non-Blocking Improvements

### A. `adjustClassifierConfidence` applies 0.20 floor to ALL classifications

Called unconditionally, including for DISTINCT/DUPLICATE with no warnings/instructions. A DISTINCT result with LLM confidence 0.10 gets bumped to 0.20.

**RECOMMENDATION:** implement — add short-circuit `if (warnings.length === 0 && !opts.mergedInstructions) return llmConfidence`.

### B. Short-slug self-ref false positive

`relatedSection.includes(slug)` is substring match — a 3-char slug like `"ads"` matches literal "ads" anywhere.

**RECOMMENDATION:** implement — bump min length to 5 and use word-boundary regex.

### C. TABLE_ROWS_DROPPED text doesn't reflect appendix recovery

Pre-existing; not introduced here.

**RECOMMENDATION:** defer — scope creep; addressable in a follow-up.

### D. `classifierFallbackApplied` dual-semantics after DISTINCT_FALLBACK reset

Cosmetic analytics concern; not a correctness bug.

**RECOMMENDATION:** defer — schema-level decision, no concrete query is broken today.

### E. Duplicate filter in MergeReviewBlock

Minor code-organisation nit.

**RECOMMENDATION:** implement — extract `FORMATTING_WARNING_CODES` const.

---

## Verdict

APPROVE with recommended follow-ups (primarily #1 SOURCE_FORK dead-code fix and #5 tests).
