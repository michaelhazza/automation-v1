# Spec Review Log — hermes-audit-tier-1, Iteration 2

**Timestamp:** 2026-04-21T01:57:28Z
**Spec commit at start of iteration:** `947111d0ddb919023ddb7bdfd58af8579197499a` + Option B edit applied (framing-deviation paragraph added to §9)
**Codex output:** `tasks/bhee53tb3.output` (5495 lines, research-heavy)

Note: the Option B paragraph from iteration 1's HITL was applied at the start of iteration 2 before the Codex pass.

---

## Findings (summary table)

| # | Source | Section | Classification | Disposition |
|---|--------|---------|----------------|-------------|
| 1 | Codex P1 | §4.2 | mechanical | auto-apply |
| 2 | Codex P1 | §4.1 / §5.2.1 / §5.3 | mechanical | auto-apply |
| 3 | Codex P1 | §4.2 / §6.4 / §8.3 / §8.6 | mechanical | auto-apply |
| 4 | Codex P1 | §4.2 / §6.3.1 | mechanical | auto-apply |
| 5 | Codex P1 | §4.5 / §6.4 / §8.3 | ambiguous → directional | HITL-checkpoint |
| 6 | Codex P1 | §4.5 / §6.5 / §6.7 / §8.4 | directional | HITL-checkpoint |
| 7 | Codex P1 | §7.4 / §7.4.1 / §7.9 / §9.3 | directional | HITL-checkpoint |
| 8 | Codex P2 | §6.7.1 | mechanical | auto-apply |
| 9 | Codex P2 | §11 | mechanical | auto-apply |

Counts:
- mechanical_accepted: 6 (findings 1, 2, 3, 4, 8, 9)
- mechanical_rejected: 0
- directional_or_ambiguous: 3 (findings 5, 6, 7)

## Mechanical fixes applied

[ACCEPT] §4.2 `agentExecutionService.ts` row — contradiction with §6.3 truth table (missing `cancelled`, wrong else-branch for non-terminal statuses).
  Fix applied: §4.2 row rewritten to delegate to `computeRunResultStatus` and explicitly list the four buckets (success, partial, failed, null) matching §6.3 exactly.

[ACCEPT] §4.1 / §5.2.1 / §5.3 — `TERMINAL_RUN_STATUSES.has(run.status)` does not compile (array, not Set).
  Fix applied: all four caller snippets in §4.1 and the §5.2.1 helper paragraph now use `isTerminalRunStatus(run.status)`, matching the exported helper in `shared/runStatus.ts`.

[ACCEPT] §4.2 / §6.4 / §8.6 — second caller `outcomeLearningService.ts:50` missing.
  Fix applied: §4.2 gains an `outcomeLearningService.ts` row with neutral-outcome update instructions; §6.4 rewritten to list both callers; §8.6 feature-flags wording updated to reference both call sites.

[ACCEPT] §4.2 / §6.3.1 — `agentRunFinalizationService.ts` missing from file inventory despite §6.3.1 making its finalizer path load-bearing for the write-once invariant.
  Fix applied: §4.2 gains an `agentRunFinalizationService.ts` row; §6.3.1 prose tightened to name the file, point at the two update sites (lines 259, 278), and reference `computeRunResultStatus` as the shared derivation helper; §4.2 totals line updated.

[ACCEPT] §6.7.1 — `needsCorroboration` fallback contradicts §3 / §4.5 / §8.4 (no new columns / no migrations / schema file not modified).
  Fix applied: fallback clause rewritten to explicitly forbid the new-column path and instead require consumer-side fixes in the same commit, with deferral (not a workaround migration) as the escape hatch.

[ACCEPT] §11.1 / §11.2 / §11.3 / §11.5 — retired production-rollout framing (query production, all orgs, week-after-rollout, page-view logs).
  Fix applied: §11.1 rewritten for pre-production `commit_and_revert` posture (no feature flags, no staged deploy, no live customers to audit); §11.2 replaced "pre-deploy" with "pre-merge" checklist and removed the production `SELECT` query; §11.3 risks table recalibrated for dev-environment impact; §11.5 rewritten as "post-merge dev-environment observation" with no week-after window and no real-traffic metrics.

---

## Directional / ambiguous findings sent to HITL

- **Finding #5** — `trajectoryPassed` read path is under-specified. Two reasonable options: (a) always-null for Phase B and defer, (b) name a persistence mechanism. HITL.
- **Finding #6** — `qualityScoreUpdater='outcome_bump'` blocked by CHECK + trigger; resolution either adds a migration (violates §3 / §4.5) or drops the audit distinction (ripples through §6.5 / §6.7 / §8.4 / §9.2 / §10). HITL.
- **Finding #7** — "one-call-cost overshoot max" invariant stated without serialization mechanism. Resolution either adds an advisory lock (new mechanism) or relaxes the invariant. HITL.

See `tasks/spec-review-checkpoint-hermes-audit-tier-1-2-<timestamp>.md` for the HITL checkpoint with recommendations.

---

## Iteration 2 Summary

- Mechanical findings accepted:  6 (findings 1, 2, 3, 4, 8, 9)
- Mechanical findings rejected:  0
- Directional findings:           2 (findings 6, 7)
- Ambiguous findings:             1 (finding 5)
- Reclassified → directional:     0
- HITL checkpoint path:           tasks/spec-review-checkpoint-hermes-audit-tier-1-2-2026-04-21T01-57-28Z.md
- HITL status:                    pending
- Spec commit after iteration:    (working tree — uncommitted)

