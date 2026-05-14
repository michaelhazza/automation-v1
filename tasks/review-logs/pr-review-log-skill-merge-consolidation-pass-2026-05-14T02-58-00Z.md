# PR Review Log — skill-merge-consolidation-pass (Round 2)

**Build slug:** skill-merge-consolidation-pass
**Branch:** claude/improve-skill-analyzer-RiFpB
**HEAD reviewed:** 17d9d930
**Reviewer:** pr-reviewer (independent, post-fix-loop round 1)
**Reviewed at:** 2026-05-14T02:58:00Z
**Files reviewed:**
- server/jobs/skillAnalyzerJob.ts (lines 1140-1420)
- server/services/skillAnalyzerServicePure.ts (lines 3320-3677)
- server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts (lines 86-114)
- server/services/__tests__/skillAnalyzerServicePure.orchestration.test.ts (lines 31-64)

Blocking: 0 / Should-fix: 0 / Consider: 2

**Verdict:** APPROVED

---

## Blocking

No blocking issues. All three Round 1 blockers verified resolved:

- **Round 1 Blocking 1 (rationale threading)** — `mergeForConsolidation = { ...storedMerge, mergeRationale: mergeRationale ?? undefined }` constructed at line 1279 and fed to both `buildConsolidationPrompt` (line 1281) and `parseConsolidationResponse` (line 1332). Round-trip can now succeed. Pinned by the new orchestration test (orchestration.test.ts:31-64).
- **Round 1 Blocking 2 (rationale leak)** — Line 1401 writes `storedMerge = { ...postConsolidationMerge, mergeRationale: undefined } as StoredMerge;`. Four-field invariant for `proposedMergedContent` / `originalProposedMerge` preserved. Sub-revert branch at line 1385 already retains the four-field shape via `slotPreConsolidationMerge` deep-clone at line 1270.
- **Round 1 Blocking 3 (fallback guard)** — Gate predicate at line 1264 now includes `&& !classifierFallbackApplied`. Both inline rule-based-fallback paths (line 1030 LLM-merge-missing, line 1076 LLM-call-failed) set the flag before the gate.

## Should-fix

No should-fix issues. Round 1 should-fixes resolved:

- **Round 1 Should-fix 1 (duplicate HITL phrase)** — `'confirm before'` removed from `CONSOLIDATION_TIER2_HITL_PHRASES` (servicePure:3344-3347). Test (consolidation.test.ts:99-105) splits at the `### Tier 2` header and asserts Tier-1-only.
- **Round 1 Should-fix 2 (rationale round-trip test)** — orchestration.test.ts:31-64. Asserts `userMessage.toContain('Original rationale.')` after prompt build, then asserts parser returns `ConsolidationParseResult` (not rejection).

## Consider

[NIT] server/services/skillAnalyzerServicePure.ts:3595 — `JSON.stringify(cm.definition) !== JSON.stringify(original.definition)` still order-sensitive. Carried forward from Round 1 per caller instruction (deferred).

[NIT] server/jobs/skillAnalyzerJob.ts:1279 — When source merge has no rationale (`finalResult.proposedMerge.mergeRationale === undefined`), `mergeForConsolidation.mergeRationale` becomes `undefined`, `JSON.stringify` omits the field, and parser rejects with `rationale_missing_or_invalid`. Graceful degradation, not a defect. Surface only if telemetry shows an unexpected `parse_rejected: rationale_missing_or_invalid` floor; fix would be to synthesise a stand-in rationale in the orchestration before the consolidation prompt builder, or require rationale at merge-parse time.

---

## Files NOT read

No files were skipped beyond the focus areas the caller scoped.

---

## Notes

Round 1 blockers resolved with minimal collateral. The fix-loop choices are clean:
- Single source of truth for `mergeForConsolidation` constructed once and reused for both LLM-input and parser-side `original` argument.
- The post-success strip at line 1401 mirrors the entry-point strip pattern (line 1147-1152) and the retry path (skillAnalyzerService.ts:2442-2444), so the four-field invariant is uniformly enforced.
- The `&& !classifierFallbackApplied` predicate is the right granularity.

Verdict: APPROVED.
