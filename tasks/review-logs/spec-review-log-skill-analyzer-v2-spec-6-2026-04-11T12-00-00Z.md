# Spec Review Iteration 6 Log — skill-analyzer-v2-spec

**Invocation context:** Post-final-report re-invocation. Iterations 1-5 completed previously with final report at `tasks/spec-review-final-skill-analyzer-v2-spec-2026-04-11T11-35-00Z.md`. Human applied a Model 1 fix for a product-direction gap (data-refers-to-code drift around DB-editable system skills with handler code in `skillExecutor.ts`). This iteration re-reviews the post-edit spec.

## Classification log

FINDING #1 (Codex, critical) — Section: §5.5, §8 DISTINCT branch, §10 Phase 0.
handlerKey introduced as row-to-code binding but runtime dispatch still uses skillName; handlerKey is never enforced at execution.
Classification: directional. Architecture signal — "Change the interface of X"; validation-only vs dispatch-key posture cascades across §5.5, §7.1, §7.4, §8, §10 Phase 0, §10 Phase 1.
Disposition: HITL-checkpoint (6.1).

FINDING #2 (Codex, important) — Section: §5.5, §10 Phase 0 createSystemSkill / updateSystemSkill.
handlerKey UNIQUE vs non-unique not specified.
Classification: ambiguous. Downstream of 6.1. Either choice is defensible.
Disposition: HITL-checkpoint (6.2).

FINDING #3 (Codex, important) — Section: §5.5, §10 Phase 0 updateSystemSkill, §7.1, §7.4, §8, §10 Phase 1.
handlerKey / slug divergence rules not specified; updateSystemSkill signature allows handlerKey patch without saying when divergence is allowed.
Classification: directional. Architecture signal — "Change the interface of X". Three coherent resolutions. Coupled to 6.1.
Disposition: HITL-checkpoint (6.3).

FINDING #4 (Codex, important) — Section: §10 Phase 1 handler-gate bullet, §7.4 unregisteredHandlerSlugs.
Direct import from skillAnalyzerService.ts into skillExecutor.ts introduces potential circular-dep risk not addressed.
Classification: ambiguous. No actual cycle today (grep-verified). Prose-only is mechanical; file extraction is directional.
Disposition: HITL-checkpoint (6.4).

FINDING #5 (Codex, important) — Section: §10 Phase 2.
Phase 2 calls createSystemSkill(candidate, { tx }) but Phase 0 signature requires handlerKey — direct contradiction.
Classification: mechanical. File-inventory drift between §10 Phase 2 and §8 / §10 Phase 0.
Disposition: auto-apply.
[ACCEPT] §10 Phase 2 — Phase 2 createSystemSkill call missing handlerKey
  Fix applied: Changed "createSystemSkill(candidate, { tx })" to "createSystemSkill({ ...candidate, handlerKey: candidate.slug }, { tx })" with explicit reference to §8 DISTINCT branch and Phase 0 signature.

FINDING #6 (Codex, important) — Section: §7.1, §10 Phase 1 scope notes, PR cut line.
Phase 1→3 null-guard window is documented; parallel Phase 1→4 window for server-only handler gate is not.
Classification: mechanical. Structurally identical to an existing scope note.
Disposition: auto-apply.
[ACCEPT] §10 Phase 1 Scope notes — Phase 1→4 handler-gate UI gap
  Fix applied: Added a third bullet to "Scope notes for Phase 1" describing the server-only handler gate between Phase 1 and Phase 4, the expected reviewer UX (click Approve, execute-time failure), accepted pre-production posture, and test-plan requirement for the "execute-time handler-gate rejection" path.

FINDING #7 (Codex, important) — SPLIT.
Section: §7.1 vs §10 Phase 0 startup validator. Invariant "every existing row is paired" is false because the validator only checks isActive = true rows.

  Part 7a (mechanical): tightening language to "every active existing row".
  Classification: mechanical. Single-word fix closes the contradiction.
  Disposition: auto-apply.
  [ACCEPT] §7.1 — Invariant language tightening
    Fix applied: Changed "every existing row is paired" to "every **active** existing row is paired", added explicit callout that inactive rows are a known gap, cross-referenced HITL checkpoint 6.7b for the residual product question.

  Part 7b (directional): deciding what the UI does on partial-overlap matches against inactive-unregistered rows.
  Classification: directional. Product-direction call with three coherent options.
  Disposition: HITL-checkpoint (6.7b).

FINDING #8 (Codex, important) — Section: §10 Phase 0 startup validator.
Bootstrap ordering "called from server/index.ts before HTTP starts" is load-bearing but not implementation-provable.
Classification: mechanical. Verified server/index.ts:365 is the httpServer.listen() line so the fix can cite the exact call site.
Disposition: auto-apply.
[ACCEPT] §10 Phase 0 startup validator — tighten bootstrap ordering
  Fix applied: Added sentence "The bootstrap sequence must `await validateSystemSkillHandlers()` before calling `httpServer.listen()` (currently at `server/index.ts:365`); if the validator throws, no socket is bound and the process exits non-zero."

FINDING #9 (Codex, minor) — Section: §7.1 warning copy, §8 DISTINCT error text.
Prose still says "add a case to skillExecutor.ts" even though §10 Phase 0 retires the switch/case dispatcher in favor of SKILL_HANDLERS.
Classification: mechanical. Stale retired language in three places.
Disposition: auto-apply.
[ACCEPT] §7.1 handler warning box + tooltip + §8 DISTINCT error text
  Fix applied: Replaced "add a case to server/services/skillExecutor.ts SKILL_HANDLERS" with "add an entry to SKILL_HANDLERS in server/services/skillExecutor.ts" in three locations.

FINDING #10 (Codex, minor) — Section: §7.3, §6.2 manual-add flow, §10 Phase 4.
Manual-add wire contract is inconsistent — §7.3 defines one PATCH but §10 Phase 4 re-opens it as "architect to decide".
Classification: ambiguous. Three resolutions (extend PATCH with addIfMissing / sibling POST / defer to §11) each coherent.
Disposition: HITL-checkpoint (6.10).

## Rubric pass

Rubric findings this iteration: 0 new findings. The 10 Codex findings covered every applicable rubric category. No additional rubric-only findings surfaced.

## Iteration 6 Summary

- Mechanical findings accepted:  5 (findings 5, 6, 7a, 8, 9)
- Mechanical findings rejected:  0
- Directional findings:          3 (findings 1, 3, 7b)
- Ambiguous findings:            3 (findings 2, 4, 10)
- Reclassified -> directional:   0
- HITL checkpoint path:          tasks/spec-review-checkpoint-skill-analyzer-v2-spec-6-2026-04-11T12-00-00Z.md
- HITL status:                   pending
- Spec commit after iteration:   untracked working-tree (HEAD = 9b75c17)

## Stopping heuristic evaluation

This iteration surfaced six directional/ambiguous findings (non-zero). The two-consecutive-mechanical-only heuristic from iterations 4-5 no longer applies because the post-final-report human edits reopened the loop with new material. Iteration 6 is itself non-mechanical-only, so a second confirmatory iteration cannot run in this invocation — the loop cannot proceed to iteration 7 until the HITL checkpoint is resolved.

**Exit:** HITL-pending. Return control to caller.
