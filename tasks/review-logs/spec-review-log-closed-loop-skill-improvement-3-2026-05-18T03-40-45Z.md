# Spec Review — Iteration 3 — closed-loop-skill-improvement

**Spec:** `docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md`
**Iteration:** 3 of 5 lifetime.
**Started:** 2026-05-18T03:40:45Z.

## Codex output

`tasks/review-logs/_codex_closed-loop-skill-improvement_iter3_2026-05-18T03-40-45Z.txt`. 5 NEW findings, verdict "Needs revision". All findings are real and are direct downstream consequences of iteration 2's fixes (cache key needs to handle the new `composeAmendmentsPure` split's org-tier case; freeze uniqueness needs to handle the `scope='org' with scope_id=null` case; drop-path idempotency needs to handle the new null-amendment regression-case write).

## Findings and dispositions

### #1 — §8.4 cache key incomplete for org-tier + freeze state

- **Classification:** MECHANICAL — load-bearing claim with insufficient mechanism. Org-tier collision risk; freeze state ignored.
- **Disposition:** ACCEPT. Expanded cache key to 5-tuple including `org_id`, `COALESCE(system_skill_id, org_skill_id)`, and an active-freeze-id component.

### #2 — Freeze uniqueness null-safety

- **Classification:** MECHANICAL — `scope_id IS NULL` (org-wide freezes) requires `NULLS NOT DISTINCT` for uniqueness to work.
- **Disposition:** ACCEPT. Updated §18.1 and §12 unique-partial-index spec to include `NULLS NOT DISTINCT`.

### #3 — Idempotency for peer-review drop paths

- **Classification:** MECHANICAL — drop paths write 2 non-amendment rows; retries can duplicate. Job-level idempotency key only covers the amendment row.
- **Disposition:** ACCEPT. Added `UNIQUE (scorecard_judgement_id)` to `peer_reviewer_drops` (§7.3); added `UNIQUE (scorecard_judgement_id) WHERE amendment_id IS NULL` partial to `skill_regression_cases` (§7.2); updated §18.1 with a new compound idempotency row for the drop path.

### #4 — §9.2 regression replay semantics underspecified

- **Classification:** MECHANICAL — load-bearing claim ("flips from pass to fail") without per-case baseline.
- **Disposition:** ACCEPT. Added a "Per-case expected verdict (derived from tag)" subsection to §9.2 deriving the expected verdict from the tag (`fix_proposed`=pass, `fix_wrong`=fail, `unresolved`=not replayed). Clarified that only `fix_proposed`→fail flips trigger rollback; `fix_wrong` results are advisory.

### #5 — §17 Step 2 step-range off-by-one

- **Classification:** MECHANICAL — count drift.
- **Disposition:** ACCEPT. Updated §17 Step 2 to reference §9.1 steps 1–6 and Step 3 to reference §9.1 steps 7–12.

## Iteration 3 Summary

- Mechanical findings accepted: 5
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration: untracked working tree

Stopping heuristic check: iterations 2 AND 3 are BOTH mechanical-only (0 directional, 0 ambiguous in each). Per heuristic #2 ("two consecutive mechanical-only rounds = stop before cap"), the loop SHOULD EXIT after iteration 3. The spec has converged on its current framing; remaining iterations would surface progressively smaller editorial issues that don't materially affect implementation.

**Decision: stop the loop after iteration 3.** Exit condition: `two-consecutive-mechanical-only`.
