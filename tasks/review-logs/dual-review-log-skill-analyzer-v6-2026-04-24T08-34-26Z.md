# Dual Review Log — skill-analyzer-v6

**Files reviewed:**
- `server/services/skillAnalyzerServicePure.ts`
- `server/services/skillAnalyzerService.ts`
- `server/jobs/skillAnalyzerJob.ts`
- `client/src/components/skill-analyzer/mergeTypes.ts`
- `client/src/components/skill-analyzer/MergeReviewBlock.tsx`
- `server/services/__tests__/skillAnalyzerServicePureV6.test.ts`

**Iterations run:** 3 / 3
**Timestamp:** 2026-04-24T08:34:26Z
**Base for review:** branch `bugfixes-april26` vs `5c7cd01b` (parent of v6 commits `1a8c31fc` + `cb7e72de`)
**Commit at finish:** `7fcb3a83`

---

## Iteration 1

Codex raised 3 findings. All 3 accepted.

### [ACCEPT] server/services/skillAnalyzerServicePure.ts:2918-2922 — extractRowKeyTokens too weak (P1)

**Codex finding:** Row-matching heuristic drops short numerals and only looks at first two cells. Rows like `Headline 1 | 30 chars` collapse to generic tokens (`headline`, `char`). A stray "headline" mention in merged text marks most rows covered, causing `validateMergeOutput` to downgrade a genuinely truncated table to `restructured` and skip `recoverDroppedTableRows`.

**Reason accepted:** Valid. Traced through the logic manually. For a source spec table with intentionally-repeated leading cells (e.g. `Phase 1 | 30d | team`, `Phase 2 | 60d | marketing`), the first-2-cells extraction plus 0.5 threshold lets a single token match in merged instructions mark all rows covered.

**Fix applied:** Rewrote `extractRowKeyTokens` to use ALL cells of the row. Added an absolute-minimum guard (`rowTokenAbsoluteMin = 2`) so a row must have at least 2 distinct tokens matched, not just a fractional share. Also deduped token matches via `Set<string>` so repeated tokens across cells don't double-count.

### [ACCEPT] server/jobs/skillAnalyzerJob.ts:1077-1085 — retryClassification missing Fix 5 mirror (P2)

**Codex finding:** The new post-Stage-5 DISTINCT_FALLBACK only runs in `processSkillAnalyzerJob`. `retryClassification` / `classifySingleCandidate` does not apply the post-parse cross-reference check. A retry can clobber what should have been a DISTINCT classification back to PARTIAL_OVERLAP/IMPROVEMENT.

**Reason accepted:** Partially valid. The narrow scenario is: failed-classify → successful-retry where the candidate meets Fix 5 criteria. Without the mirror, retry re-introduces the confused merge Fix 5 exists to prevent. The existing "full validateMergeOutput/remediateTables not mirrored on retry" comment acknowledges this pattern, but DISTINCT_FALLBACK is lightweight (just cross-reference + similarity) and keeping the retry path in lockstep with the main path is the documented discipline.

**Fix applied:** Added the same Fix 5 check in `retryClassification` after `classifySingleCandidate` returns. Same similarity threshold (0.70), same confidence (0.5), same reasoning suffix.

### [ACCEPT] server/services/skillAnalyzerService.ts:2507-2510 — non-idempotent confidence deduction (P2)

**Codex finding:** The batch confidence deduction subtracts from stored confidence each time it runs. `processSkillAnalyzerJob` rebuilds `classifiedResults` on resume and re-executes Stage 5c unconditionally — fork rows lose another 0.05 every resume, drifting toward the 0.20 floor.

**Reason accepted:** Valid. Verified via inspection of the resume hydration at skillAnalyzerJob.ts:589-624 and the unconditional Stage 5c re-execution.

**Fix applied (iter 1):** Added optional `markerWarningCode` parameter to `applyBatchConfidenceDeductions`. WHERE clause skips rows that already carry the marker warning. Call-site order flipped to deduct first (marker not yet present), then append the warning. (Superseded in iter 2 — see below.)

---

## Iteration 2

Codex raised 2 new findings targeting the iter-1 fixes. Both accepted.

### [ACCEPT] server/jobs/skillAnalyzerJob.ts:1507-1508 — non-atomic SOURCE_FORK deduction and warning append (P2)

**Codex finding:** If the worker crashes after `applyBatchConfidenceDeductions` commits but before `appendBatchCollisionWarnings` runs, the row keeps the lower confidence without the SOURCE_FORK marker. On resume, `notAlreadyMarked` is still true, and the same slug is deducted again. The crash window the iter-1 fix aimed to close still reproduces.

**Reason accepted:** Structurally correct. Marker-based idempotency only works if the marker and the effect it guards commit together.

**Fix applied:** Added a new atomic helper `applyBatchDeductionAndWarningAtomic` that performs both the deduction and the warning append in a single UPDATE statement per slug. The WHERE clause keeps the marker guard. Removed the now-unused `applyBatchConfidenceDeductions` entirely (it was added in the v6 commits and this change is what made it unused — per CLAUDE.md surgical-changes rule, remove imports/functions my changes made unused). Reworked Stage 5c to build `forkEntries` as `Array<{slug, deduction, warning}>` and call the atomic helper.

### [ACCEPT] server/services/skillAnalyzerServicePure.ts:2927-2936 — one-token rows inflate denominator (P2)

**Codex finding:** The new 2-token floor makes any row that tokenizes down to a single informative term impossible to count as covered, but those rows still contribute to `scoreable`. For terse tables like `| Banner | 1 |`, the scoreable-but-never-covered rows push total coverage below 80% even when the merged output preserves every row, triggering false TABLE_ROWS_DROPPED warnings.

**Reason accepted:** Valid. The absolute-minimum guard I added in iter 1 had an unintended side effect: single-token rows were marked scoreable but couldn't pass the new `present >= 2` bar.

**Fix applied (iter 2):** Skipped rows with fewer than `rowTokenAbsoluteMin` distinct tokens entirely (neither scoreable nor matched). (Superseded in iter 3 — see below.)

---

## Iteration 3

Codex raised 2 new findings. 1 accepted, 1 rejected.

### [ACCEPT] server/services/skillAnalyzerServicePure.ts:2931 — single-token rows should fall back to substring match, not be skipped (P1)

**Codex finding:** Skipping low-token rows from coverage math has the opposite failure mode: if a source table has terse rows like `| Banner | 1 |` and the merged output preserves only the richer rows, `mergedOutputCoversTableData` now reports the whole table as covered, causing `validateMergeOutput` to downgrade TABLE_ROWS_DROPPED and `recoverDroppedTableRows` to skip the appendix. Genuinely missing terse rows go unrecovered.

**Reason accepted:** Valid. This is the direct inverse of the iter-2 finding — a classic tension between "terse rows can't be scored through tokens" and "terse rows still need to be checked." The right resolution is a conditional path: low-token rows ARE scoreable, but via a different signal.

**Fix applied:** Replaced the skip with a low-token fallback path. For rows with fewer than 2 distinct informative tokens, the row is still `scoreable++`, but instead of token-matching we require every non-empty cell (filtered to length ≥ 3 to avoid false positives from standalone "1" / "2" etc.) to appear as a literal substring in the lowercased merged text. Rationale: terse rows can't be meaningfully restructured by an LLM (nothing to rephrase), so exact substring match is the appropriate signal. Also DRY'd up `extractRowKeyTokens` to delegate to a shared `extractRowCells` helper.

### [REJECT] server/services/skillAnalyzerService.ts:2567 — resumed pre-patch jobs receive no deduction (P2)

**Codex finding:** The new marker guard is only safe for rows written by the new atomic helper. A job resumed after deploy could already contain a SOURCE_FORK warning but still be missing the -0.05 confidence deduction (because the previous worker died between the old append and deduct calls). The new WHERE clause filters those rows out, so resume leaves their confidence permanently too high.

**Reason rejected:** Hypothetical migration concern that does not apply to unshipped code. The v6 commits `1a8c31fc` and `cb7e72de` are local-only — not yet pushed to origin, not yet deployed. No production jobs can exist in the "SOURCE_FORK warning present but no deduction" state because that code path has never executed against production data. When this branch ships, the atomic helper will be the first and only flow that writes SOURCE_FORK warnings alongside deductions. The hypothetical bad state Codex describes requires a deploy sequence (intermediate two-statement flow → crash → deploy atomic flow → resume) that never occurs. Adding migration logic for a phantom population would be unnecessary complexity.

---

## Changes Made

- `server/services/skillAnalyzerServicePure.ts` — `mergedOutputCoversTableData` rewritten: uses all row cells (not just first 2), requires ≥2 distinct matched tokens for rich rows, falls back to cell-substring match for low-token rows; introduced `extractRowCells` shared helper, `extractRowKeyTokens` delegates to it.
- `server/services/skillAnalyzerService.ts` — added atomic helper `applyBatchDeductionAndWarningAtomic` (single UPDATE per slug, marker-guarded idempotency); mirrored v6 Fix 5 DISTINCT_FALLBACK in `retryClassification`; removed unused `applyBatchConfidenceDeductions`.
- `server/jobs/skillAnalyzerJob.ts` — Stage 5c rebuilds `forkEntries` array, calls `applyBatchDeductionAndWarningAtomic` in one atomic step, dropped separate deduct/append pair and their imports.

## Rejected Recommendations

- **Iter 3 finding #2 (pre-patch resumed jobs)** — phantom migration concern; v6 commits are unshipped, no production jobs can be in the described bad state.

---

**Verdict:** PR ready. All critical and important issues resolved.
