# Dual Review Log — skill-merge-consolidation-pass

**Files reviewed:** branch `claude/improve-skill-analyzer-RiFpB` vs `2c98f6df` (S1 sync merge base), focused on the 19-file skill-merge-consolidation-pass diff (`migrations/0358_*.sql`, `server/db/schema/skillAnalyzer*.ts`, `server/services/skillAnalyzerConfigService.ts`, `server/services/skillAnalyzerServicePure.ts`, `server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts`, `server/services/__tests__/skillAnalyzerServicePure.orchestration.test.ts`, `server/jobs/skillAnalyzerJob.ts`, `client/src/components/skill-analyzer/{MergeReviewBlock.tsx,mergeTypes.ts,types.ts}`)
**Iterations run:** 2/3
**Timestamp:** 2026-05-14T03:09:46Z
**HEAD at review start:** 17d9d930
**Commit at finish:** b7432cf1
**Task class:** Significant
**Codex CLI:** v0.130.0 (upgraded from v0.118.0 mid-session — v0.118.0 default model `gpt-5.5` requires CLI ≥ v0.130.0; ChatGPT-account auth on v0.118.0 rejected `gpt-5-codex` / `gpt-5.1-codex` / `gpt-5` overrides)

---

## Iteration 1

### Codex findings

**Codex raised exactly one structured finding (P2):**

> [P2] Reject non-shortening consolidation successes — `server/jobs/skillAnalyzerJob.ts:1403-1407`
> When the consolidation LLM returns valid JSON with instructions that are unchanged or longer, and no new hard-constraint warning is introduced, this branch still marks the pass as `succeeded` and emits `CONSOLIDATION_APPLIED`. That can store a non-tightened merge and show a banner like "-10% shorter" even though the feature's success path is supposed to apply only to genuinely shortened output. Check `postWords < preWords` before setting the succeeded outcome, otherwise revert/decline/fail instead.

### Decisions

```
[ACCEPT] server/jobs/skillAnalyzerJob.ts:1398-1417 — non-shortening consolidation marked succeeded
  Reason: Real bug. Spec §6 "Outcome classification rule" (line 155 of spec.md) is explicit:
  `succeeded` requires "shorter than the pre-consolidation draft AND passes hard-preservation
  validation". Spec §4.4 self-check (line 92) requires "output is shorter than the draft (or
  equal, with a justification)" — the equal/longer case is supposed to surface as
  `declinedToConsolidate=true`. A non-shortening response with declinedToConsolidate=false
  is therefore a protocol violation by the LLM. The current code path treats it as
  `succeeded`, persists a non-tightened merge, and emits user-facing telemetry
  ("0% shorter" or worse — the formula `Math.round((1 - postWords/preWords) * 100)`
  produces 0 when equal and negative when post > pre). The UI banner renders "AI tightened
  this merge from {n} to {n} words (0% shorter)" — exactly the misleading copy the spec
  forbids ("the UI banner copy must reflect" actual shortening). Fix routes the case to
  `failed` via the existing parse_rejected-style failureReason pathway, mirroring the
  hard-constraint-violation branch's revert-and-fail shape.
```

### Implementation

Restructured the provisional-success branch at `server/jobs/skillAnalyzerJob.ts:1398-1442` to compute pre/post word counts before classifying the outcome. When `postWords >= preWords`, the branch now:

1. Reverts `storedMerge` to `slotPreConsolidationMerge` (mirrors the hard-constraint-violation branch above).
2. Restores `mergeWarnings` to `preConsolidationMergeWarnings`.
3. Sets `slotConsolidationOutcome = 'failed'`, `slotConsolidationNote = null`.
4. Appends `CONSOLIDATION_FAILED` with `detail: { failureReason: 'not_shortened', preWords, postWords }` (extending the spec's existing failureReason enum convention).
5. Logs `outcome: 'failed', failureReason: 'not_shortened'` for telemetry.

The shortened-output branch is preserved verbatim with the same telemetry message and `CONSOLIDATION_APPLIED` emission.

### Verification

- `npm run lint`: 0 errors, 899 warnings (all pre-existing, none in changed file).
- `npm run typecheck`: clean pass on both `tsconfig.json` and `server/tsconfig.json`.
- `npx vitest run server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts`: 26/26 passing.
- `npx vitest run server/services/__tests__/skillAnalyzerServicePure.orchestration.test.ts`: 3/3 passing.

---

## Iteration 2

### Codex findings

**Zero structured findings.** Codex's closing note:

> The code change enforces the intended strict-shortening requirement and reverts to the pre-consolidation merge on non-shortening outputs without introducing an evident regression. The remaining changes are audit/log documentation only.

Codex separately observed the working tree contains a pre-existing reality-check log and a progress.md edit that were not part of this dual-review's scope — those are noted as audit/documentation, not code findings.

### Decisions

No new recommendations to adjudicate. Loop terminates per Step 4: zero findings.

---

## Changes Made

- `server/jobs/skillAnalyzerJob.ts:1398-1442` — split provisional-success branch into shortened-success vs non-shortening-failed paths; non-shortening case reverts to pre-consolidation draft and emits `CONSOLIDATION_FAILED` with `failureReason='not_shortened'`.

## Rejected Recommendations

None this run — only one Codex recommendation surfaced, and it was accepted.

---

**Verdict:** APPROVED (2 iterations, 1 accepted P2 fix, 0 rejected)
