# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md`
**Spec commit at start:** UNTRACKED (new spec)
**Spec commit at finish:** `ef9d26ee71b296388533ef7e53b636675f571ecb`
**Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
**Spec-context staleness:** GREEN (age 7 days, well under 60-day warn threshold)
**Iterations run:** 2 of 5
**Exit condition:** two-consecutive-mechanical-only (iter 1 and iter 2 both had zero directional, ambiguous, and reclassified findings — preferred exit; further Codex iterations unlikely to surface new concerns)
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 15 | 0 (rubric agreed with Codex coverage) | 15 | 0 | 0 | 0 | 0 |
| 2 | 2 | 0 | 2 | 0 | 0 | 0 | 0 |

Total: 17 mechanical findings accepted, 0 rejected, 0 directional, 0 ambiguous, 0 auto-decided requiring human follow-up. The two `AUTO-DECIDED` items logged to `tasks/todo.md` (BVG-SR-F13 pricing rates, BVG-SR-F15 grammar release pin) are deferred-to-architect-plan placeholders — both auto-applied as spec text with a "pin at architect plan" instruction; not blocking.

---

## Mechanical changes applied (by spec section)

### Frontmatter
- `Status:` flipped `draft` → `reviewing` per spec-authoring-checklist §11.

### §1 Goals
- **Goal 6:** weakened "runCostBreaker enforces per-run ceilings automatically" → "post-run accounting; mid-run enforcement deferred (§13)" to match the async pg-boss rollup execution model (iter 1 F9).
- **Goal 8 Success criteria:** split into V1-verifiable (static / structural) and follow-up-build (execution / regression) criteria; the stub-harness reality is no longer in tension with the criteria list (iter 1 F1).

### §3 Framing assumptions
- `runCostBreaker` framing assumption rewritten to "V1 enforces from FOLLOWING run; mid-run enforcement deferred" (iter 1 F9).
- Field count updated from "three" to "four" (`visionModelId` added) (iter 1 F3).

### §4 Existing primitives reused
- `HarnessInput` row updated from "three fields" to "four fields" (iter 1 F3).

### §6 Phase plan chunk table
- Added `Verdict` column; all chunks marked `BUILD` (iter 1 F14).
- C11 (`shared/visionInferencePricing.ts`) added as dependency of C6 and C8 (iter 2 F1).
- Added C10 (skillParserServicePure surfaces `iee_decision_mode`), C11 (visionInferencePricing), C12 (docs renumber). Chunk count went from 10 to 12 (iter 1 F5/F13).

### §7 File inventory lock
- `rlsProtectedTables.ts` removed from "New files" (was double-counted with "Modified files"); replaced by `shared/visionInferencePricing.ts` (iter 1 F4 + F13; iter 2 F2 moved it from `server/config/` to `shared/`).
- Added `server/services/skillParserServicePure.ts` to "Modified files" (was prose-referenced but missing from inventory) (iter 1 F5).
- "Modified files" count updated from 8 to 9. New files count remains 10. Reconciliation updated in §14.

### §8.1 Vision action schema
- Added "Parser input grammar" subsection naming the UI-TARS published action grammar as the parser input contract; lists rejection rules and notes that the architect plan pins the exact UI-TARS release (iter 1 F15).

### §8.2 SandboxRunTaskInput extension
- Added `visionModelId?: string | null` to the four-field set (iter 1 F3).

### §8.3 HarnessInput extension
- Added `visionModelId` field.
- Rewrote routing description: `visionDecisionLoop` owns DOM-first + vision-fallback orchestration for `hybrid` mode (resolving the §8.3 vs §8.9 contradiction iter 1 F2).

### §8.4 vision_calls.json artefact shape
- `modelId` field now explicitly threaded from `SandboxRunTaskInput.visionModelId`.
- Added `costCents` formula source-of-truth subsection naming `shared/visionInferencePricing.ts::computeCostCents` and pinning rounding behaviour; rate constants deferred to architect plan (iter 1 F13; iter 2 F2 moved the file under `shared/`).

### §8.6 visionGroundingService config contract
- Added "URL constraint" subsection requiring HTTPS endpoint URL; host:port parsed from URL (no hard-coded 443) (iter 1 F12).
- `resolveEndpointConfig` returns `modelId` threaded into `SandboxRunTaskInput.visionModelId` (iter 1 F3).

### §8.7 Network policy extension
- Allowlist host:port now parsed from `VISION_INFERENCE_ENDPOINT_URL` rather than hard-coded `port: 443` (iter 1 F12).
- Added "Composition with broader browser navigation policy" subsection noting the vision allowlist is additive to whatever browser-navigation policy resolution (IEE-DEF-7) adopts (iter 1 F11).

### §10 Execution model
- `visionInferenceCostRollupJob` rollup-job description: `runCostBreaker` now described as enforcing from the FOLLOWING run, not the run that incurred the costs (iter 1 F9).

### §11 Phase sequencing
- Dependency graph rewritten to include the new C10/C11/C12 chunks and the explicit C11 → C6, C11 → C8 edges (iter 2 F1).
- "All 10 chunks" → "All 12 chunks" updated.

### §12.1 Idempotency
- Added "Ordering invariant" sentence: harvest completes BEFORE terminal `iee_runs.status` write; harvest failure prevents terminal write so retry re-attempts while status is still `running` (iter 1 F10).

### §12.2 Retry classification
- `vLLM HTTP call — click/type/hotkey` reclassified from `guarded` to `unsafe (V1)` to align with §13 deferred item (iter 1 F8).

### §14 Self-consistency pass
- "Every chunk has a verdict" note updated to reference the new `Verdict` column and 12-chunk count.
- Numeric-count reconciliation updated to 10 new + 9 modified = 19 file entries.

### §16 Open questions
- Item 11 rewritten to align with §8.8 / §12.5 dispatch-time failure (was "fail at first vision call" — stale residue) (iter 1 F7).

### §13 Deferred items
- Added "Mid-run vision cost-breaker enforcement" deferred item (iter 1 F9).

### Modified-file inventory rows
- `shared/types/sandbox.ts` row: lists all four new fields (iter 1 F3).
- `infra/sandbox-templates/iee-browser/harness/index.ts` row: lists all four new fields (iter 1 F3).
- `server/services/executionBackends/_ieeShared.ts` row: split into Dispatch + Finalisation responsibilities; finalisation-time harvest hook named (iter 1 F6, F10).
- New row: `server/services/skillParserServicePure.ts` (iter 1 F5).

---

## Rejected findings

None. All 17 Codex findings across two iterations were accepted as mechanical fixes.

---

## Directional and ambiguous findings (autonomously decided)

None. Every Codex finding classified as mechanical. Two findings (iter-1 F13 costCents formula, iter-1 F15 parser grammar) had a deferred-decision element but were auto-applied as spec text pinning the SOURCE of the decision (the file location, the published grammar reference) while explicitly deferring the exact rate constants / grammar release pin to architect-plan-authoring time. Both logged to `tasks/todo.md` under `## browser-vision-grounding spec-reviewer findings (2026-05-18)` so the architect sees them at plan kickoff. Non-blocking for spec acceptance.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across two iterations. Convergence reached the preferred exit condition (two consecutive mechanical-only rounds), meaning the spec's framing and scope are stable — Codex is no longer finding scope, sequencing, posture, or framing issues, only mechanical residue from earlier iterations. However:

- This review did not re-verify the framing assumptions in `docs/spec-context.md`. The spec-context file was last verified 2026-05-11 (7 days ago — green). Re-verification before the next major iteration of this spec is not required.
- This review did not catch directional findings Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement. Worth a final operator read of §1 Goals, §2 Non-goals, §3 Framing assumptions, §16 Open questions before committing to architect plan.
- This review did not pin the open architect-plan decisions: vendor + GPU class (§16 Q1), exact pricing rate constants in `shared/visionInferencePricing.ts` (deferred per BVG-SR-F13), exact UI-TARS release for the parser grammar (deferred per BVG-SR-F15). Those are architect-plan-level decisions, surfaced for the operator in `tasks/todo.md`.

**Recommended next step:** read §1 / §3 / §16 one more time, confirm the headline framing matches current intent, then hand off to architect for plan authoring (`tasks/builds/browser-vision-grounding/plan.md`).
