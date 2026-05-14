# PR Review Log — skill-merge-consolidation-pass

**Build slug:** skill-merge-consolidation-pass
**Branch:** claude/improve-skill-analyzer-RiFpB
**HEAD reviewed:** b47b1019
**Reviewer:** pr-reviewer (independent, post-spec-conformance)
**Reviewed at:** 2026-05-14T02:39:41Z
**Files reviewed:**
- migrations/0358_skill_merge_consolidation.sql
- migrations/0358_skill_merge_consolidation.down.sql
- server/db/schema/skillAnalyzerResults.ts
- server/db/schema/skillAnalyzerConfig.ts
- server/services/skillAnalyzerConfigService.ts
- server/services/skillAnalyzerServicePure.ts (consolidation additions, lines 3320-3680 + union/tier-map/RESOLUTIONS_FOR_CODE extensions at 412-414, 452-454, 571-573)
- server/services/skillAnalyzerService.ts (read paths, getJob projection, patchMergeFields, resetMergeToOriginal, insertSingleResult)
- server/jobs/skillAnalyzerJob.ts (consolidation gate at lines 1100-1620; non-merging path inserts at 690-693, 791-794, 858-861, 1887, 1917)
- server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts
- server/services/__tests__/skillAnalyzerServicePure.orchestration.test.ts
- client/src/components/skill-analyzer/MergeReviewBlock.tsx (ConsolidationBanner)
- client/src/components/skill-analyzer/types.ts
- client/src/components/skill-analyzer/mergeTypes.ts

Blocking: 3 / Should-fix: 2 / Consider: 1

**Verdict:** CHANGES_REQUESTED (3 blocking, 2 should-fix)

---

## Blocking

[BLOCKING] server/jobs/skillAnalyzerJob.ts:1269,1279,1330 — Consolidation success path is structurally unreachable: orchestration passes `storedMerge` (whose `mergeRationale` was explicitly set to `undefined` at line 1150) into both `buildConsolidationPrompt` and `parseConsolidationResponse`. The system prompt at `skillAnalyzerServicePure.ts:3460,3473` instructs the LLM to echo `mergeRationale` verbatim, but `JSON.stringify(mergedForPrompt, …)` (line 3509) omits the field entirely because it is undefined. The parser at `skillAnalyzerServicePure.ts:3601-3611` then rejects: any non-string/empty value → `rationale_missing_or_invalid`; any non-empty string from the LLM → `mutated_rationale` (since `<string> !== undefined`). Every consolidation call resolves to `consolidationOutcome='failed'` with `failureReason='parse_rejected: rationale_missing_or_invalid'` (or `mutated_rationale`). The build pays for an extra LLM call per SCOPE_EXPANSION merge and never produces a `succeeded` outcome. This invalidates the manual smoke step in spec §11 and the operator-supplied SCOPE_EXPANSION reproducer.
Why: this is the core feature the PR is shipping; the success path is the only path that actually delivers the user-visible benefit, and it cannot execute.
Fix: thread the real `mergeRationale` (the local variable already in scope at `skillAnalyzerJob.ts:1140,1159`) into both calls. Build the prompt against `{ ...storedMerge, mergeRationale }` and pass the same enriched object to `parseConsolidationResponse(..., { ...storedMerge, mergeRationale })`. Add a Vitest case that constructs a synthetic LLM response echoing the rationale and asserts the parser returns a `ConsolidationParseResult`, not a rejection.

[BLOCKING] server/jobs/skillAnalyzerJob.ts:1398,1575-1576 — `mergeRationale` leaks into `proposedMergedContent` and `originalProposedMerge` on successful consolidation, breaking the documented contract that the rationale is stripped from those jsonb columns (see `server/services/skillAnalyzerService.ts:2440-2444` "Strip mergeRationale before persisting to proposed_merged_content — the rationale lives in its own DB column", `docs/superpowers/specs/2026-04-15-merge-quality-fixes-design.md:300`, and this same file's line 1147-1152 stripping). When `succeeded`, line 1398 reassigns `storedMerge = postConsolidationMerge`, and `postConsolidationMerge` (returned by `parseConsolidationResponse`) carries `mergeRationale` (line 3651). That object is then written to both jsonb columns verbatim. The next `patchMergeFields` call (`server/services/skillAnalyzerService.ts:1048-1053`) silently drops it, so the shape oscillates row→edit→reset; Reset re-introduces it.
Why: contract violation on a load-bearing column; downstream readers (patchMergeFields, Reset, Execute) assume the four-field shape, and any future code that consumes `proposedMergedContent.mergeRationale` sees inconsistent presence between consolidation-succeeded rows and every other row. Latent only because finding 1 makes the success path unreachable today; fixing 1 surfaces this immediately.
Fix: after the success branch, strip `mergeRationale` before assigning into `storedMerge` (or before calling `insertSingleResult`): `storedMerge = { ...postConsolidationMerge, mergeRationale: undefined } as StoredMerge;`. The rationale field already flows separately into the dedicated column via the existing `mergeRationale: mergeRationale` insert arg at line 1578.

[BLOCKING] server/jobs/skillAnalyzerJob.ts:1261-1266 — Consolidation gate predicate does not check `classifierFallbackApplied`, so a classifier-failure-then-rule-based-fallback merge (entered at lines 1056-1077, with `classifierFallbackApplied = true` set at 1076) can still trip the gate if `validateMergeOutput` emits SCOPE_EXPANSION on the fallback merge. Spec §12 (deferred items, first bullet) and plan R16 explicitly forbid this: "this branch never runs consolidation — `consolidationOutcome` stays `not_triggered`." The orchestration correctly routes around the bulk fallback path (lines 760-779, 858-862) but the inline classifier-failure path is not excluded.
Why: spec / plan deviation; consumes LLM tokens on a code path the spec marked as out of scope, and produces row state the spec said cannot happen.
Fix: extend the gate predicate at line 1261 to include `&& !classifierFallbackApplied`. Add a test pinning the invariant: GIVEN a result with `classifierFallbackApplied=true` and `mergeWarnings` containing `SCOPE_EXPANSION`, WHEN the gate predicate is evaluated, THEN it returns false and `consolidationOutcome` remains `'not_triggered'`.

## Should-fix

[NON-BLOCKING] server/services/skillAnalyzerServicePure.ts:3340,3345 — `'confirm before'` appears in both `CONSOLIDATION_TIER1_HITL_PHRASES` (line 3340) and `CONSOLIDATION_TIER2_HITL_PHRASES` (line 3345). Plan §1.2 designed the two tiers to be disjoint (Tier 2 = "lower-confidence HITL phrases"). The current code emits a duplicate inventory entry whenever the phrase matches: once under "Tier 1 — verbatim preservation required" and again under "Tier 2 — best-effort preservation". The test at `…consolidation.test.ts:99` does not catch this because it only asserts `userMessage.toContain('confirm before')`, not per-tier classification.
Why: noise in the prompt and a drift between plan-time tiering intent and shipped behaviour; either Tier 1 is authoritative (and Tier 2 should be filtered to remove overlaps) or `'confirm before'` should be removed from Tier 1.
Fix: remove `'confirm before'` from `CONSOLIDATION_TIER2_HITL_PHRASES`. Update the test to assert it appears exactly once and under Tier 1.

[NON-BLOCKING] server/services/__tests__/skillAnalyzerServicePure.orchestration.test.ts — Missing test coverage for the rationale round-trip invariant. The two existing tests only cover the violation set diff; no test pins the round-trip of `mergeRationale` through `buildConsolidationPrompt` → synthetic LLM response → `parseConsolidationResponse`. A test here would have caught finding 1 before merge.
Why: defence-in-depth against regression of the most consequential bug in this PR.
Fix: add a Vitest case — GIVEN a `ProposedMerge` with `mergeRationale='Original rationale.'`, WHEN `buildConsolidationPrompt` is called and a synthetic LLM response (echoing the input rationale verbatim) is fed to `parseConsolidationResponse(raw, original)`, THEN the parser returns a `ConsolidationParseResult` (NOT a `ConsolidationParseRejection`) and `result.consolidatedMerge.mergeRationale === 'Original rationale.'`.

## Consider

[NIT] server/services/skillAnalyzerServicePure.ts:3596 — `JSON.stringify(cm.definition) !== JSON.stringify(original.definition)` is order-sensitive. An LLM that returns the same logical definition with keys in a different order (a common Sonnet jaggedness on nested objects) is rejected as `mutated_definition`. The spec asks for deep-equal; recursive comparison would be more robust.
Why: reliability of the success path against a known LLM failure mode, once finding 1 is fixed.
Fix: replace with a recursive structural deep-equal (or a stable canonicalising stringify) on the `definition` object.

---

## Files NOT read

No files were skipped. All 19 changed files in the diff were inspected.

---

## Notes for the implementer

Findings 1 and 2 are coupled: fix 1 first by threading `mergeRationale` through the prompt builder and parser, then fix 2 by stripping `mergeRationale` from the post-consolidation merge before it gets assigned to `storedMerge`. The new orchestration test in finding 5 should be added alongside fix 1 — it pins the regression.

Finding 3 is independent and lands in the same commit as the gate-predicate change.
