# Spec Conformance Log

**Spec:** `tasks/builds/skill-merge-consolidation-pass/spec.md`
**Spec commit at check:** `65d8f4d41dfd89f4eb951e13cc41fa8f7a023f92`
**Branch:** `claude/improve-skill-analyzer-RiFpB`
**Base:** `a614b9bdd16ab7a1c89006fcb18772d60bdb6f73`
**Scope:** all spec (4 chunks complete per progress.md; single-phase build)
**Changed-code set:** 19 files (per caller invocation)
**Run at:** 2026-05-14T02-11-15Z

---

## Summary

- Requirements extracted:     69
- PASS:                       66
- MECHANICAL_GAP → fixed:     3
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT_AFTER_FIXES

---

## Mechanical fixes applied

### REQ #47 — Stage 2 DUPLICATE bulk insert missing `consolidationOutcome`

**File:** `server/jobs/skillAnalyzerJob.ts`
**Lines:** 1872-1888
**Spec quote (§10):** *"For rows written after migration `0358`, orchestration MUST always write one of `not_triggered | succeeded | declined | failed` (never NULL) — even when the consolidation gate does not fire, the orchestration writes `not_triggered`."* + *"DUPLICATE and DISTINCT classifications produce no merge, so the consolidation gate MUST NOT fire ... these rows write consolidationOutcome='not_triggered'."*
**Change:** Added `consolidationOutcome: 'not_triggered' as ConsolidationOutcome` to the Stage 2 exact-duplicate `resultRows.push({...})` call so the row carries a non-NULL outcome through the bulk `insertResults` path.

### REQ #48 — Stage 4 DISTINCT bulk insert missing `consolidationOutcome`

**File:** `server/jobs/skillAnalyzerJob.ts`
**Lines:** 1891-1919
**Spec quote (§10):** Same as REQ #47.
**Change:** Added `consolidationOutcome: 'not_triggered' as ConsolidationOutcome` to the Stage 4 distinct-results `resultRows.push({...})` call. The DISTINCT path through the incremental Stage 5 writer (line 858) was already covered; the bulk Stage 8 path was the gap.

### REQ #63 — Failed-banner copy used em-dash instead of semicolon

**Files:**
- `client/src/components/skill-analyzer/MergeReviewBlock.tsx:1057`
- `server/jobs/skillAnalyzerJob.ts:1319, 1341, 1390` (server-side warning message at three failure sites)

**Spec quote (§7):** *"`failed`: amber banner, copy 'Tightening pass did not complete; reviewer is seeing the original merge.'"*
**Change:** Replaced em-dash with semicolon in all four occurrences so the user-visible copy matches the spec verbatim AND complies with the user preference *"No em-dashes (—) in any UI copy, labels, or app-facing text. Use commas, colons, or rewrite the sentence."*

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None. Every spec requirement was either PASS or a closable MECHANICAL_GAP.

---

## Files modified by this run

- `server/jobs/skillAnalyzerJob.ts` (REQ #47, #48, #63 — three sites)
- `client/src/components/skill-analyzer/MergeReviewBlock.tsx` (REQ #63 — one site)

---

## Notable PASS verifications

- §1.1 placement authority: gate inserted after `validateMergeOutput` (line 1240) and before the downstream cohort (`recoverDroppedTableRows` 1430, `recoverOutputFormat` 1446, `CLASSIFIER_FALLBACK` prepend 1465, `detectSkillGraphCollision` 1479). Matches plan §1.1 exactly.
- §2 choice 3 single attempt / no escalation: one `routeCall` only; failures revert, never retry.
- §4.3 parser-rejection vs valid-decline distinction (F2 / Round 2 spec edit): parser returns discriminated rejection; orchestration routes parser rejection to `failed` with `parse_rejected: <rule>` and reserves `declined` for valid responses where `declinedToConsolidate=true`.
- §4.5 source-of-truth precedence: `originalProposedMerge` follows `storedMerge`, which is replaced on success and restored on revert/declined — implicit but correct.
- §4.4 telemetry rule: `preWords`/`postWords`/`reductionPct`/`declineReason`/`failureReason` ride on warning detail JSON, no dedicated columns. UI banner parses detail with defensive fallback.
- §5 step 6 warning-set replacement: caches pre-consolidation warnings before LLM call, restores from cache on every revert path before appending `CONSOLIDATION_FAILED`. Reviewer never sees post-consolidation warnings for a draft they're not looking at.
- §5 outcome-classification rule (T2): targeted test in `skillAnalyzerServicePure.orchestration.test.ts:12-17` pins "still-bloated-but-shorter = succeeded".
- §6 trigger-severity vs warningTierMap independence (R8): gate predicate reads raw warning codes only; never calls `effectiveTierMap()`. Changing tier map cannot change LLM spend.
- §10 idempotency posture: row-presence guard preserved; `consolidationOutcome` is audit-only. After this run's fixes, every post-migration row carries a non-NULL outcome.
- §10 no-consolidation guarantee for DUPLICATE/DISTINCT: gate is gated by `storedMerge` presence + classification check; verified that no `routeCall(featureTag: 'skill-analyzer-consolidate')` happens on non-merging paths.
- Pure-function tests cover all 11 parser rejection reasons individually, the preservation-inventory tiering, the prompt builder's target-ceiling formula, and the tier-map / RESOLUTIONS_FOR_CODE integration. 24 tests in `skillAnalyzerServicePure.consolidation.test.ts` + 2 in `.orchestration.test.ts`.

---

## Step 5 re-verification

- `npm run lint`: 0 errors, 899 warnings (identical to baseline before fixes).
- `npm run typecheck`: clean (both client and server tsconfigs).
- Read-back of fixed sites:
  - `skillAnalyzerJob.ts:1872-1888` — DUPLICATE block carries `consolidationOutcome: 'not_triggered'`.
  - `skillAnalyzerJob.ts:1905-1919` — DISTINCT block carries `consolidationOutcome: 'not_triggered'`.
  - `skillAnalyzerJob.ts:1319, 1341, 1390` — warning message uses semicolon.
  - `MergeReviewBlock.tsx:1057` — banner copy uses semicolon.

All three fixes landed cleanly. No test gates run (CI-only per `references/test-gate-policy.md`).

---

## Next step

**CONFORMANT_AFTER_FIXES** — three mechanical gaps closed in-session. The next reviewer should re-run `pr-reviewer` on the expanded changed-code set (the reviewer needs to see the final fixed state including these surgical additions to `skillAnalyzerJob.ts` and `MergeReviewBlock.tsx`, not the pre-fix state).
